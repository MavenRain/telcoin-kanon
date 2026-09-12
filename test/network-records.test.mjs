import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,protocolSources,protocolModules,uleb,sequence,u32,u64} from './harness.mjs';
const names=['var_bytes','bls_public_key','bls_signature','wire_scalar','epoch_vote','consensus_result','epoch_record','node_record'];
const h=await harness({name:'network-records',sources:[...protocolSources,...names.map(n=>`lib/network/${n}.ml`)],
  modules:[...protocolModules,...names.map(n=>`${n}.ml`)],oracle:'test/network-records-oracle.ml',
  fixtures:['test/state.kan','test/network-records.kan'],exports:['networkRecordTest']});
const evaluate=([kind,left,right])=>h.text(h.e.networkRecordTest(Number(kind),h.raw(left==='-'?'':left),h.raw(right==='-'?'':right)));
const row=(kind,left,right=left)=>[String(kind),left||'-',right||'-'];
const bytes=hex=>uleb(hex.length/2)+hex;
const text=s=>bytes(Buffer.from(s).toString('hex'));
const digest=n=>bytes(n.toString(16).padStart(64,'0'));
const key=n=>bytes(n.toString(16).padStart(192,'0'));
const sig=n=>bytes(n.toString(16).padStart(96,'0'));
const vote=(epoch=0,k=0)=>u32(epoch)+digest(k)+key(k)+sig(k);
const result=(epoch=0,round=0,n=0n,k=0)=>u32(epoch)+u32(round)+u64(n)+digest(k)+key(k)+sig(k);
const epoch=(e=0,keys=[],next=[],number=0n,k=0)=>u32(e)+sequence(keys.map(key))+sequence(next.map(key))+digest(k)+u64(number)+digest(k)+u64(number)+digest(k);
const rpc=(http,ws)=>text(http)+(ws===null?'00':'01'+text(ws));
const node=(current=true,metadata=null,stamp=0n,k=0)=>bytes('ff00')+sequence([bytes('ff'),bytes('0000'),bytes('ff')])+u64(stamp)
  +(current?(metadata===null?'00':'01'+metadata):'')+sig(k);
test('Epoch votes, consensus results and epoch records preserve every field and full u64 values',()=>{
  const rows=[];
  for(const e of [0,1,4294967295])for(const n of [0n,1n,9223372036854775808n,18446744073709551615n]){
    rows.push(row(0,vote(e,1)),row(1,result(e,4294967295,n,1)),row(2,epoch(e,[0,1,0],[2,1],n,1)));
  }
  for(const [kind,wire] of [[0,vote()],[1,result()],[2,epoch(0,[],[],0n)]]){
    rows.push(row(kind,wire));
    for(let i=0;i<wire.length;i+=2){
      const changed=wire.slice(0,i)+(Number.parseInt(wire.slice(i,i+2),16)^1).toString(16).padStart(2,'0')+wire.slice(i+2);
      rows.push(row(kind,wire,changed));
    }
  }
  h.compare(rows,evaluate,{requireSuccess:true});
});
test('Every record truncation and malformed length reports the source error and offset',()=>{
  const rows=[];
  for(const [kind,wire] of [[0,vote(1,2)],[1,result(1,2,3n,4)],[2,epoch(1,[1,2],[3],4n,5)],
    [3,node(true,rpc('https://node.test','wss://node.test'),18446744073709551615n,1)],[4,node(false,null,2n,3)]]){
    for(let i=0;i<wire.length;i+=2)rows.push(row(kind,wire.slice(0,i)));
    rows.push(row(kind,wire+'00'));
    for(let i=0;i<wire.length;i+=14)rows.push(row(kind,wire.slice(0,i)+'ff'+wire.slice(i+2)));
  }
  h.compare(rows,evaluate);
});
test('Node records distinguish current and legacy layouts, retain RPC data and reject malformed UTF-8',()=>{
  const rows=[];
  for(const stamp of [0n,1n,9223372036854775808n,18446744073709551615n]){
    for(const meta of [null,rpc('',null),rpc('https://node.test','wss://node.test'),rpc('https://例.test','')]){
      const current=node(true,meta,stamp,1),legacy=node(false,null,stamp,1);
      rows.push(row(3,current),row(3,current,node(true,null,stamp,2)),row(4,legacy),row(5,current),row(5,legacy));
    }
  }
  for(const wire of [node(true,'01ff00'),node(true,'00'+'01'+'02c080'),node(true,'00'+'02'),node(false)+'00']){
    rows.push(row(3,wire),row(5,wire));
  }
  for(let i=0;i<node(false).length;i+=2)rows.push(row(5,node(false).slice(0,i)));
  h.compare(rows,evaluate);
  assert.match(evaluate(row(5,node(true))),/^current:/);
  assert.match(evaluate(row(5,node(false))),/^legacy:/);
  assert.equal(evaluate(row(5,node(false))).slice(7),node(true));
});
test('Encoding a current node record in the legacy layout drops only RPC metadata',()=>{
  const rows=[];
  for(const stamp of [0n,18446744073709551615n])for(const signature of [0,1])
    for(const metadata of [null,rpc('',null),rpc('https://node.test','wss://node.test')])
      rows.push(row(6,node(true,metadata,stamp,signature)));
  h.compare(rows,evaluate,{requireSuccess:true});
  assert.equal(evaluate(row(6,node(true,rpc('https://node.test','wss://node.test')))),node(false)+':legacy:'+node(true));
});
