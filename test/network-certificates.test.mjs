import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,protocolSources,protocolModules,u16,u32,u64,uleb,sequence} from './harness.mjs';
const names=['var_bytes','bls_public_key','bls_signature','wire_scalar','roaring','vote_wire','certificate_wire','epoch_certificate','peer_exchange'];
const h=await harness({name:'network-certificates',sources:[...protocolSources,'lib/snappy/byte_reader.ml',...names.map(n=>`lib/network/${n}.ml`)],
  modules:[...protocolModules,'byte_reader.ml','tn_snappy.ml',...names.map(n=>`${n}.ml`)],extraAliases:{'tn_snappy.ml':['Byte_reader']},
  oracle:'test/network-certificates-oracle.ml',fixtures:['test/state.kan','test/crypto.kan','test/network-records.kan','test/network-certificates.kan'],
  exports:['networkWireRecordTest','networkPeerTestConstruct','networkWireBridgeTest','networkWirePublicErrorTest']});
const raw=s=>h.raw(s==='-'?'':s);
const evaluate=([op,...a])=>h.text(op==='record'?h.e.networkWireRecordTest(Number(a[0]),raw(a[1]),raw(a[2])):
  op==='peer'?h.e.networkPeerTestConstruct(raw(a[0])):
  op==='error'?h.e.networkWirePublicErrorTest(Number(a[0]),h.toBytes(a[1])):
  h.e.networkWireBridgeTest(Number(a[0]),h.toBytes(a[1]),h.seeds(a[2]),h.seeds(a[3]),raw(a[4])));
const bytes=hex=>uleb(hex.length/2)+hex;
const digest=(n=0)=>bytes(n.toString(16).padStart(64,'0'));
const key=(n=0)=>bytes(n.toString(16).padStart(192,'0'));
const sig=(n=0)=>bytes(n.toString(16).padStart(96,'0'));
const authority=(n=0)=>n.toString(16).padStart(64,'0');
const header=(round=0,n=0)=>authority(n)+u32(round)+u32(0)+u64(0)+'0000'+u64(0)+digest();
const bitmap=(values=[])=>values.length?u32(12346)+u32(1)+u16(0)+u16(values.length-1)+u32(16)+values.map(u16).join(''):u32(12346)+u32(0);
const state=(tag,n=0)=>uleb(tag)+(tag===4?'':sig(n));
const certificate=(tag=4,indices=[],round=0)=>header(round)+state(tag)+bytes(bitmap(indices));
const vote=(r=0,e=0,n=0)=>digest(n)+u32(r)+u32(e)+authority(n)+authority(n+1)+sig(n);
const epoch=(n=0,indices=[])=>digest(n)+sig(n)+bytes(bitmap(indices));
const entry=(n,net='ff',addrs=['ff','00','ff'])=>key(n)+bytes(net)+sequence(addrs.map(bytes));
const row=(kind,left,right=left)=>['record',String(kind),left||'-',right||'-'];
test('Vote and certificate codecs preserve each field, all five states and canonical signer bitmaps',()=>{
  const rows=[];
  for(const n of [0,1,255])for(const r of [0,1,4294967295])rows.push(row(0,vote(r,r,n)));
  for(let tag=0;tag<5;tag++)for(let other=0;other<5;other++){
    rows.push(row(1,state(tag),state(other)),row(2,certificate(tag,[0,2,4]),certificate(other,[0,2,4])));
  }
  for(const indices of [[],[0],[0,3,65535]])for(const n of [0,1,255])rows.push(row(3,epoch(n,indices)));
  for(const [kind,wire] of [[0,vote()],[2,certificate(0,[0,1])],[3,epoch(0,[0,1])]])
    for(let at=0;at<wire.length;at+=2){const changed=wire.slice(0,at)+(Number.parseInt(wire.slice(at,at+2),16)^1).toString(16).padStart(2,'0')+wire.slice(at+2);rows.push(row(kind,wire,changed));}
  h.compare(rows,evaluate,{requireSuccess:true});
  assert.equal(evaluate(row(1,'04')),'04:true:true');
});
test('Wire record decoders report every truncation, malformed tag and bitmap refinement offset',()=>{
  const rows=[];
  for(const [kind,wire] of [[0,vote(1,2,3)],[1,state(0)],[2,certificate(2,[0,3])],[3,epoch(2,[0,3])],[4,sequence([entry(0),entry(1)])]]){
    for(let at=0;at<wire.length;at+=2)rows.push(row(kind,wire.slice(0,at)));
    rows.push(row(kind,wire+'00'));
    for(let at=0;at<wire.length;at+=14)rows.push(row(kind,wire.slice(0,at)+'ff'+wire.slice(at+2)));
  }
  for(const bad of ['05','ff','8000','ffffffff0f','808080808000','003100'])rows.push(row(1,bad),row(2,header()+bad+bytes(bitmap())));
  rows.push(row(2,header()+'04'+bytes('00')),row(3,digest()+sig()+bytes(u32(0))));
  h.compare(rows,evaluate);
});
test('Peer exchange sorts map keys, rejects duplicates and preserves first-occurrence address order',()=>{
  const rows=[];
  for(const keys of [[],[0],[1,0],[0,1],[1,1],[3,1,2,0],[0,1,0]])for(const addresses of [[],[''],['ff','00','ff',''],['00','ff','00']]){
    const wire=sequence(keys.map(n=>entry(n,'ff00',addresses)));
    rows.push(['peer',wire],row(4,wire));
  }
  for(const wire of [sequence([entry(0)]),sequence([entry(0),entry(1)])]){
    rows.push(row(4,wire,sequence([entry(0,'00')])));
    rows.push(row(4,wire,sequence([entry(0,'ff',['00','ff'])])));
  }
  h.compare(rows,evaluate);
  assert.equal(evaluate(['peer','00']),'00:0:true');
  assert.match(evaluate(['peer',sequence([entry(1),entry(1)])]),/^error:peer exchange: duplicate map key$/);
  assert.equal(evaluate(['peer',sequence([entry(1),entry(0)])]).split(':')[0],sequence([entry(0,'ff',['ff','00']),entry(1,'ff',['ff','00'])]));
});
test('Wire bridges map committee positions and preserve genesis checking and simulation signature refusal',()=>{
  const rows=[];
  for(const roster of ['1,2,3,4','4,3,2,1','1,2,3,4,5'])for(const indices of [[],[0],[0,2],[0,1,2,3],[4],[65535]])
    for(const mode of [0,1,2])rows.push(['bridge',String(mode),'1',roster,'empty',bitmap(indices)]);
  for(const mode of [3,4,5,6,7])for(const signers of ['empty','1','4,2,1','1,1,2','99','1,99'])
    rows.push(['bridge',String(mode),'1','1,2,3,4',signers,bitmap()]);
  rows.push(['bridge','0','99','1,2,3,4','empty',bitmap()]);
  h.compare(rows,evaluate);
  assert.match(evaluate(rows[0]),/^ok:/);
  assert.match(evaluate(['bridge','0','1','1,2,3,4','empty',bitmap([4])]),/committee position 4$/);
  assert.match(evaluate(['bridge','2','1','1,2,3,4','empty',bitmap()]),/not genesis$/);
  for(const mode of [3,4,5])assert.match(evaluate(['bridge',String(mode),'1','1,2,3,4','empty',bitmap()]),/crypto seam refused the signature$/);
});
test('Public adapter errors retain signed committee positions and distinct signature failures',()=>{
  const rows=[];for(let kind=0;kind<5;kind++)for(const index of [-4611686018427387904n,-1,0,4294967295,4611686018427387903n])rows.push(['error',String(kind),String(index)]);
  h.compare(rows,evaluate,{requireSuccess:true});
});
