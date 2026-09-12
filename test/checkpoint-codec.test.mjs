import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,header,sequence,uleb,u16,u32,u64,hash} from './harness.mjs';
import {driverOracleSources} from './driver-oracle-sources.mjs';
import {batchWire} from './batch-validator-vectors.mjs';
import {word} from './transaction-vectors.mjs';
const h=await harness({name:'checkpoint-codec',...driverOracleSources,
  sources:[...driverOracleSources.sources,'lib/durable_store/record_codec.ml','lib/durable_checkpoint/checkpoint_codec.ml'],
  modules:[...driverOracleSources.modules,'tn_driver.ml','record_codec.ml','checkpoint_codec.ml'],
  extraAliases:{...driverOracleSources.extraAliases,'tn_driver.ml':['Chain_spec','Checkpoint','Driver']},
  oracle:'test/checkpoint-codec-oracle.ml',fixtures:['test/checkpoint-codec.kan'],
  exports:['checkpointTestRead','durableRecordTest']});
const evaluate=([op,kind,raw])=>h.text((op==='record'?h.e.durableRecordTest:h.e.checkpointTestRead)(Number(kind),h.raw(raw==='-'?'':raw)));
const row=(kind,raw)=>['codec',String(kind),raw||'-'];
const bytes=raw=>uleb(raw.length/2)+raw;
const addr=n=>BigInt(n).toString(16).padStart(40,'0');
const hostMax=(1n<<62n)-1n;
const withdrawal=(i=1,v=2,a=3,n=4)=>u64(BigInt(i))+u64(BigInt(v))+addr(a)+u64(BigInt(n));
const authority=(key,address)=>bytes(word(key))+addr(address);
const committee=(epoch=0,members=[authority(1,1),authority(2,2)])=>u64(BigInt(epoch))+sequence(members);
const storage=sequence([word(1)+word(2),word(3)+word(4)]);
const account=(nonce=1,balance=2,code='6001600055',slots=storage)=>u64(BigInt(nonce))+word(balance)+bytes(code)+slots;
const world=sequence([addr(1)+account(),addr(2)+account(0,3,'','00')]);
const recent=word(41)+sequence([word(42),word(43)]);
const counts=sequence([bytes(word(1))+u32(2),bytes(word(2))+u32(3)]);
const rewards='01'+committee()+counts;
const phase=(tag=0,epoch=0)=>String(tag).padStart(2,'0')+u64(1000n)+committee(epoch);
const headerWire=word(1)+word(2)+addr(3)+word(4)+word(5)+word(6)+'17'.repeat(256)+word(8)
  +u64(9n)+u64(30000000n)+u64(11n)+u64(12n)+bytes('aabbcc')+word(14)+u64(15n)+u64(16n)
  +word(17)+sequence([withdrawal(18,19,20,21),withdrawal(22,23,24,25)])+word(26)+word(27)+u64(28n)+u64(29n)+word(30);
const anchor='00'+word(31)+word(32)+u64(30000000n);
const persisted=(storedAnchor=anchor,storedPhase=phase())=>storedAnchor+world+recent+rewards+storedPhase;
const examples=[u64(1n),word(2),word(3),word(4),addr(5),word(6),word(7),word(8),u64(9n),u64(10n),u64(11n),
  u64(12n)+u64(13n),u64(14n),'15'.repeat(256),word(16),withdrawal(),bytes(word(17)),bytes(word(18)),authority(19,20),
  storage,account(),world,headerWire,anchor,recent,committee(),rewards,phase(),persisted(),persisted()+'00'];
const truncations=(kind,raw)=>Array.from({length:raw.length/2},(_,n)=>row(kind,raw.slice(0,n*2)));
test('All 30 checkpoint codecs match pinned bytes and every truncation of representative values',()=>{
  const rows=examples.flatMap((raw,kind)=>[row(kind,raw),row(kind,raw+'ab'),...truncations(kind,raw)]);
  h.compare(rows,evaluate);
  for(let kind=0;kind<examples.length;kind++) assert.doesNotMatch(evaluate(row(kind,examples[kind])),/^error:/);
});
test('Checkpoint scalar refinements enforce host, u32, signed timestamp, key and width limits',()=>{
  const rows=[];
  for(const kind of [0,8,9,10,12]) for(const value of [0n,1n,4294967295n,4294967296n,hostMax,hostMax+1n,(1n<<63n)-1n,1n<<63n,(1n<<64n)-1n])
    rows.push(row(kind,u64(value)));
  for(const kind of [16,17]) for(const width of [0,1,31,32,33,48,96]) rows.push(row(kind,bytes('a5'.repeat(width))));
  for(const index of [0,1,3]) for(const value of [hostMax,hostMax+1n,(1n<<64n)-1n]){
    const fields=[1n,2n,3,4n];fields[index]=value;rows.push(row(15,withdrawal(...fields)));
  }
  for(const raw of ['020000','8000','80'.repeat(5)]) rows.push(row(27,raw));
  h.compare(rows,evaluate);
  assert.equal(evaluate(row(0,u64(hostMax))),u64(hostMax));
  assert.match(evaluate(row(0,u64(hostMax+1n))),/^error:/);
  assert.equal(evaluate(row(10,u64((1n<<63n)-1n))),u64((1n<<63n)-1n));
});
test('State codecs restore constructors, canonical maps, committee identity and bounded hash windows',()=>{
  const zeroSlot=sequence([word(1)+word(0)]),zeroAccount=account(0,0,'','00');
  const longRecent=word(1)+sequence(Array.from({length:260},(_,i)=>word(i+2)));
  const rows=[row(19,zeroSlot),row(19,sequence([word(2)+word(3),word(1)+word(4)])),
    row(19,sequence([word(1)+word(2),word(1)+word(3)])),
    row(20,account(0,0,'',zeroSlot)),row(21,sequence([addr(1)+zeroAccount])),
    row(21,sequence([addr(2)+account(),addr(1)+account()])),row(21,sequence([addr(1)+account(),addr(1)+account()])),
    row(24,longRecent),row(25,committee(0,[])),row(25,committee(0,[authority(1,1)])),
    row(25,committee(0,[authority(1,1),authority(1,2)])),row(25,committee(4294967295,[authority(2,2),authority(1,1)])),
    row(26,'00'+sequence([bytes(word(1))+u32(0)])),row(26,'00'+counts),
    row(26,'00'+sequence([bytes(word(2))+u32(1),bytes(word(1))+u32(1)])),
    row(26,'00'+sequence([bytes(word(1))+u32(1),bytes(word(1))+u32(1)])),
    row(23,'01'+headerWire),row(23,'02'+headerWire),row(27,phase(1,3)),row(28,persisted('01'+headerWire,phase(1,3))),
    row(29,persisted('01'+headerWire,phase(1,3))+'00')];
  h.compare(rows,evaluate);
  assert.equal(evaluate(row(19,zeroSlot)),'00');
  assert.equal(evaluate(row(21,sequence([addr(1)+zeroAccount]))),'00');
  assert.equal(evaluate(row(24,longRecent)),word(1)+sequence(Array.from({length:255},(_,i)=>word(i+2))));
  assert.equal(evaluate(row(26,'00'+sequence([bytes(word(1))+u32(0)]))),'0000');
});
const oracle=request=>{
  const result=h.runOracle([],request.join(' ')+'\n');assert.equal(result.status,0,result.error?.message??result.stderr);
  return result.stdout.trimEnd();
};
test('Record payloads rebuild attached bodies and preserve exact trailing and metadata errors',()=>{
  const bodies=[{txs:[]},{txs:['ff'],worker:1}].map(options=>batchWire(options).slice(0,-66));
  const dag=sequence([header({seed:1,epoch:0,round:1,time:1,payload:bodies.map((body,i)=>'20'+hash(body)+u16(i)).sort()})])
    +'0000'+u64(1n)+'20'+'00'.repeat(32);
  const block=oracle(['block',dag]);assert.match(block,/^[0-9a-f]+$/);
  const record=block+sequence(bodies),meta=u64(0n)+u64(1n)+word(2);
  const recordRow=(kind,raw)=>['record',String(kind),raw||'-'];
  const rows=[...Array.from({length:record.length/2+1},(_,i)=>recordRow(0,record.slice(0,i*2))),
    recordRow(0,record+'aabb'),recordRow(0,block+'00'),recordRow(0,block+sequence(bodies.slice(1))),
    recordRow(0,block+sequence([...bodies,bodies[0]])),recordRow(0,block+sequence([...bodies].reverse())),
    ...Array.from({length:meta.length/2+1},(_,i)=>recordRow(1,meta.slice(0,i*2))),recordRow(1,meta+'ff')];
  for(const epoch of [4294967295n,4294967296n,hostMax+1n,1n<<63n]) rows.push(recordRow(1,u64(epoch)+u64(1n)+word(2)));
  for(const number of [hostMax,hostMax+1n,1n<<63n]) rows.push(recordRow(1,u64(0n)+u64(number)+word(2)));
  rows.push(row(29,persisted()+'01'+block),row(29,persisted('01'+headerWire,phase(1,3))+'01'+block));
  h.compare(rows,evaluate);
  assert.match(evaluate(recordRow(0,record+'aabb')),/2 byte\(s\) left over/);
  assert.match(evaluate(recordRow(0,block+'00')),/^error:record payload:.*batch/);
});
