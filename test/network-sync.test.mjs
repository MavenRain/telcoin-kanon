import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,protocolSources,protocolModules,u16,u32,u64,uleb,sequence} from './harness.mjs';
const names=['bls_signature','wire_scalar','roaring','certificate_wire','sync_request','sync_frame','sync_chunking','sync_reader'];
const h=await harness({name:'network-sync',sources:[...protocolSources,'lib/snappy/byte_reader.ml',...names.map(n=>`lib/network/${n}.ml`)],
  modules:[...protocolModules,'byte_reader.ml','tn_snappy.ml',...names.map(n=>`${n}.ml`)],extraAliases:{'tn_snappy.ml':['Byte_reader']},
  oracle:'test/network-sync-oracle.ml',fixtures:['test/state.kan','test/network-records.kan','test/network-roaring.kan','test/network-sync.kan'],
  exports:['networkSyncTestRecord','networkSyncTestFrameText','networkSyncTestPack','networkSyncTestGroups','networkSyncTestReader']});
const raw=s=>h.raw(s==='-'?'':s);
const evaluate=([op,...a])=>h.text(op==='record'?h.e.networkSyncTestRecord(Number(a[0]),raw(a[1]),raw(a[2])):
  op==='frame'?h.e.networkSyncTestFrameText(raw(a[0])):
  op==='pack'?h.e.networkSyncTestPack(Number(a[0]),h.toBytes(a[1]),raw(a[2])):
  op==='groups'?h.e.networkSyncTestGroups(Number(a[0]),h.seeds(a[1]),h.toBytes(a[2]),h.toBytes(a[3])):
  h.e.networkSyncTestReader(Number(a[0]),raw(a[1]),h.toBytes(a[2]),raw(a[3])));
const bytes=s=>uleb(s.length/2)+s;
const digest=(n=0)=>bytes(n.toString(16).padStart(64,'0'));
const authority=(n=0)=>n.toString(16).padStart(64,'0');
const worker=(digests=[],epoch=0)=>'00'+sequence(digests.map(digest))+u32(epoch);
const primary=(tag=0,n=0n)=>uleb(tag)+(tag===0?u32(Number(n)):tag===1?u32(Number(n))+sequence([authority()+bytes('ff'),authority()+bytes('ff00')]):tag===2?u32(4294967295)+u64(n):u64(n));
const row=(kind,a,b=a)=>['record',String(kind),a||'-',b||'-'];
const data=s=>'03'+bytes(s);
const header=authority()+u32(0)+u32(0)+u64(0)+'0000'+u64(0)+digest();
const certificate=header+'04'+bytes(u32(12346)+u32(0));
const batch=(n=0)=>sequence([bytes(n.toString(16).padStart(2,'0'))])+u32(0)+bytes('00'.repeat(20))+u64(0)+u16(0);
const reader=(kind,frames,cap=1000000,requested=[])=>['reader',String(kind),sequence(frames),String(cap),sequence(requested)];
test('Sync requests preserve u32/u64 fields, canonical digest sets and ordered opaque skip rounds',()=>{
  const rows=[];
  for(const values of [[],[0],[2,0,1,0],[4294967295,1,4294967295]])for(const epoch of [0,4294967295])rows.push(row(0,worker(values,epoch)),row(2,'00'+worker(values,epoch)));
  const requests=[primary(0),primary(0,4294967295n),primary(1),primary(1,4294967295n),primary(2),primary(2,18446744073709551615n),primary(3,9223372036854775808n),primary(3,18446744073709551615n)];
  for(const a of requests)for(const b of requests)rows.push(row(1,a,b),row(3,'00'+a,'00'+b));
  for(const [kind,wire] of [[0,worker([1,2])],[1,primary(1)],[2,'00'+worker([1,2])],[3,'00'+primary(2)]]){
    for(let at=0;at<wire.length;at+=2)rows.push(row(kind,wire.slice(0,at)));
    rows.push(row(kind,wire+'00'));
  }
  h.compare(rows,evaluate);
  assert.equal(evaluate(row(0,worker([2,0,1,0]))).split(':')[0],worker([0,1,2]));
});
test('Sync frame tags, payload equality, display and opening verdicts match the source',()=>{
  const frames=['01','0200','0201',data(''),data('ff00'),'04','0500','0501'];
  const rows=[];
  for(const a of frames)for(const b of frames)rows.push(row(2,a,b),row(3,a,b));
  for(const frame of ['00',...frames,'06','ff','8000','0202','0502','030200','0000'])rows.push(['frame',frame]);
  for(const bad of ['06','ff','8000','ffffffff0f','0202','0502','030200'])rows.push(row(2,bad),row(3,bad));
  h.compare(rows,evaluate);
  assert.equal(evaluate(['frame','01']),'Ack|proceed');
  assert.match(evaluate(['frame','04']),/unexpected opening sync frame$/);
});
test('Pack chunking includes the final End frame and respects custom, default and signed size boundaries',()=>{
  const rows=[];
  for(const size of [-4611686018427387904n,-1,0,1,2,7,128,4611686018427387903n])for(const count of [0,1,2,7,8,129])
    rows.push(['pack','0',String(size),'ab'.repeat(count)||'-']);
  for(const count of [0,1,262143,262144,262145])rows.push(['pack','1','0','cd'.repeat(count)||'-']);
  h.compare(rows,evaluate);
  assert.match(evaluate(['pack','0','2','0102030405']),/Data\(2 bytes\);Data\(2 bytes\);Data\(1 bytes\);End;$/);
});
test('Certificate batching includes cap-crossing items and digest groups preserve order at 200 entries',()=>{
  const rows=[];
  const sets=[[],[0],[1,1,1],[2,3,4,5],[10,1,2],[-1,2,3],[4611686018427387903n,2,3],[-4611686018427387904n,-1,1]];
  for(const values of sets)for(const target of [-1,0,1,5,4611686018427387903n])for(const cap of [-1,0,1,6,4611686018427387903n])
    rows.push(['groups','0',values.length?values.join(','):'empty',String(target),String(cap)]);
  for(const values of [[262143,1,1],[262145,1,67108864,1],[67108864,1],[67108863,2,1]])rows.push(['groups','1',values.join(','),'0','0']);
  for(const count of [0,1,199,200,201,400,401])rows.push(['groups','2',count?Array.from({length:count},(_,i)=>i).join(','):'empty','0','0']);
  for(const n of [-4611686018427387904n,-1,0,4611686018427387903n])rows.push(['groups','3','empty','0',String(n)]);
  h.compare(rows,evaluate,{requireSuccess:true});
  assert.equal(evaluate(['groups','0','2,3,4,5','5','6']),'groups:[2,3,][4,]');
});
test('Pack and certificate readers distinguish incomplete streams, post-End suffixes, controls and cumulative caps',()=>{
  const rows=[];
  const bodies=[[],[data('')],[data('ff00'),data('01')],[data('00')],['04'],[data('00'),'04','0500'],['04','00'],['01'],['0200'],['0500'],['0501']];
  for(const frames of bodies)rows.push(reader(0,frames));
  for(const cap of [-1,0,1,certificate.length/2,certificate.length/2+1,1000000]){
    for(const frames of [[],[data('')],[data('00')],[data(sequence([certificate]))],[data(sequence([certificate])),data(sequence([certificate]))],
      [data(sequence([certificate])),'04',data('ff')],['04','01'],['0501'],['0201'],['00']])rows.push(reader(1,frames,cap));
  }
  h.compare(rows,evaluate);
  assert.equal(evaluate(reader(0,[data('0102'),'04',data('ff')])),'020102|true');
  assert.equal(evaluate(reader(0,[data('0102')])),'020102|false');
  assert.match(evaluate(reader(1,[data('ff')],0)),/response of 1 bytes exceeds the 0 cap$/);
});
test('Batch readers apply count, decode, requested-membership and duplicate gates in source order',()=>{
  const rows=[];const a=batch(1),b=batch(2),c=batch(3);
  for(const requested of [[],[a],[a,b],[a,a]])for(const frames of [[],['04'],[data(a)],[data(a),data(b),'04'],[data(b),data(a)],
    [data(a),data(a)],[data(c)],[data('')],[data(a),data('')],[data(a),'04',data(c)],['0500'],['01']])rows.push(reader(2,frames,0,requested));
  h.compare(rows,evaluate);
  assert.match(evaluate(reader(2,[data('')],0,[])),/peer sent 1 items for 0 requested$/);
  assert.match(evaluate(reader(2,[data(a),data(a)],0,[a])),/peer sent 2 items for 1 requested$/);
  assert.match(evaluate(reader(2,[data(a),data(a)],0,[a,a])),/peer sent duplicate batch /);
});
