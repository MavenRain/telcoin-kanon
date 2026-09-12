import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,protocolSources,protocolModules,uleb,u32} from './harness.mjs';
const leaves=['var_bytes','bls_public_key','bls_signature','wire_scalar','protocols','base58'];
const h=await harness({name:'network-leaves',sources:[...protocolSources,...leaves.map(n=>`lib/network/${n}.ml`)],
  modules:[...protocolModules,...leaves.map(n=>`${n}.ml`)],oracle:'test/network-leaves-oracle.ml',
  fixtures:['test/network-leaves.kan'],exports:['networkLeafTestRoundtrip','networkLeafTestConstruct','networkLeafTestOwned',
    'networkLeafTestProtocols','networkBase58Encode']});
const hex=bytes=>Buffer.from(bytes).toString('hex')||'-';
const raw=text=>h.raw(text==='-'?'':text);
const evaluate=([op,...a])=>{
  if(op==='decode')return h.text(h.e.networkLeafTestRoundtrip(Number(a[0]),raw(a[1])));
  if(op==='construct')return h.text(h.e.networkLeafTestConstruct(Number(a[0]),raw(a[1]),raw(a[2])));
  if(op==='owned')return h.text(h.e.networkLeafTestOwned(raw(a[0])));
  if(op==='protocols')return h.text(h.e.networkLeafTestProtocols(Number(a[0]),h.toBytes(a[1]),h.toBytes(a[2])));
  return h.text(h.e.networkBase58Encode(raw(a[0])));
};
const pattern=n=>Buffer.from(Array.from({length:n},(_,i)=>(i*79+133)&255)).toString('hex');
test('Wire scalar and opaque BLS codecs preserve widths, framing and rejection offsets',()=>{
  const rows=[];
  for(const [kind,width] of [[0,0],[0,1],[0,128],[1,96],[2,48],[3,32],[4,32],[5,32],[6,32],[7,4],[8,4]]){
    const wire=(kind<=5?uleb(width):'')+pattern(width);
    for(let i=0;i<=wire.length;i+=2)rows.push(['decode',String(kind),wire.slice(0,i)||'-']);
    rows.push(['decode',String(kind),wire+'00']);
    for(const bad of ['80','8000','8100','ffffffff0f','ffffffff10','808080808000','ff'])rows.push(['decode',String(kind),bad+wire]);
  }
  for(const kind of [7,8])for(const n of [0,1,2147483647,2147483648,4294967295])rows.push(['decode',String(kind),u32(n)]);
  h.compare(rows,evaluate);
  assert.equal(evaluate(['decode','1','60'+pattern(96)]),'ok:60'+pattern(96));
  assert.equal(evaluate(['decode','6',pattern(32)]),'ok:'+pattern(32));
  assert.match(evaluate(['decode','3',pattern(32)]),/^error:/);
});
test('Opaque byte constructors, equality and ordering retain their public behavior',()=>{
  const rows=[];
  for(const kind of [0,1,2])for(const n of [0,1,31,32,47,48,49,95,96,97,128]){
    const value=pattern(n)||'-';
    for(const other of [value,'-',pattern(Math.max(1,n-1)),'00'.repeat(n)||'-','ff'.repeat(n)||'-'])
      rows.push(['construct',String(kind),value,other]);
  }
  h.compare(rows,evaluate,{requireSuccess:true});
});
test('Protocol identifiers namespace all roles and preserve signed native integer formatting',()=>{
  const limits=['-4611686018427387904','-1','0','1','2017','4294967295','4611686018427387903'];
  const rows=[];
  for(const kind of [0,1])for(const worker of limits)for(const chain of limits)rows.push(['protocols',String(kind),worker,chain]);
  for(const value of ['', '/', '//', '/tn-primary-2017/0.0.2', 'name', '\nname', '\0/'])rows.push(['owned',hex(value)]);
  for(let i=0;i<256;i++)rows.push(['owned',hex([i])]);
  h.compare(rows,evaluate);
});
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const reference58=bytes=>{
  let value=bytes.length?BigInt('0x'+bytes.toString('hex')):0n,out='';
  while(value){out=alphabet[Number(value%58n)]+out;value/=58n;}
  for(const byte of bytes){if(byte!==0)break;out='1'+out;}
  return out;
};
test('Base58 agrees with OCaml and an independent integer encoder, including leading zeros',()=>{
  const samples=[Buffer.alloc(0),Buffer.from('hello world')];
  for(let i=0;i<256;i++)samples.push(Buffer.from([i]));
  for(const n of [2,3,7,16,32,48,64,96,128])for(const prefix of [0,1,7]){
    samples.push(Buffer.concat([Buffer.alloc(prefix),Buffer.from(pattern(n),'hex')]));
    samples.push(Buffer.alloc(n,0),Buffer.alloc(n,255));
  }
  const rows=samples.map(bytes=>['base58',hex(bytes)]);
  h.compare(rows,evaluate,{requireSuccess:true});
  for(const [i,row] of rows.entries())assert.equal(evaluate(row),reference58(samples[i]));
});
