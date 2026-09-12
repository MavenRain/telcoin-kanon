import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,header,sequence,u16,u64,hash} from './harness.mjs';
import {driverOracleSources} from './driver-oracle-sources.mjs';
import {batchWire} from './batch-validator-vectors.mjs';
const h=await harness({name:'driver-primitives',...driverOracleSources,oracle:'test/driver-primitives-oracle.ml',
  fixtures:['test/crypto.kan','test/execution.kan','test/state.kan','test/evm-core.kan','test/evm-env.kan',
    'test/engine-state.kan','test/batch-output.kan','test/driver-primitives.kan'],
  exports:['driverTestBooks','driverTestStore','driverTestReceive']});
const rawList=raw=>(raw==='-'?[]:raw.split(',')).reverse().reduce((tail,value)=>h.e.seqBytesCons(h.raw(value),tail),h.e.seqBytesEmpty());
const evaluate=([op,...a])=>{
  if(op==='books')return h.text(h.e.driverTestBooks(h.seeds(a[0]),h.seeds(a[1]),h.seeds(a[2])));
  if(op==='store')return h.text(h.e.driverTestStore(h.raw(a[0]),rawList(a[1])));
  return h.text(h.e.driverTestReceive(h.seeds(a[0]),h.raw(a[1]),h.raw(a[2])));
};
const bodies=[{txs:[]}, {txs:['aa'],worker:9}, {txs:['bb','cc'],epoch:7,fee:99n,worker:65535}].map(options=>batchWire(options).slice(0,-66));
const payload=indices=>indices.map(i=>'20'+hash(bodies[i])+u16(i)).sort();
const subdag=headers=>sequence(headers)+'0000'+u64(1)+'20'+'00'.repeat(32);
test('Address books preserve older-only seats and prefer newer committee addresses',()=>{
  const rows=[];
  for(const older of ['1,2','2,1','1,2,3','3,4'])for(const newer of ['2,3','4,5','1,2'])for(const queries of ['1,2,3,4,5,99','99','1,1,2']){
    rows.push(['books',older,newer,queries]);
  }
  h.compare(rows,evaluate,{requireSuccess:true});
});
test('Batch stores deduplicate bodies by digest and retain lookup results across insertion orders',()=>{
  const rows=[];
  for(const values of [[],[bodies[0]],bodies,[...bodies].reverse(),[bodies[0],bodies[0]]]){
    for(const queries of ['-',bodies.map(hash).join(','),'ff'.repeat(32)+','+hash(bodies[0])])rows.push(['store',sequence(values),queries]);
  }
  h.compare(rows,evaluate,{requireSuccess:true});
});
test('Subscriber mint and receive agree and attachment failure preserves the original subscriber',()=>{
  const dags=[subdag([header({seed:1,round:1})]),
    subdag([header({seed:1,round:1,payload:payload([0,1])}),header({seed:2,round:2,payload:payload([1,2])})]),
    subdag([header({seed:2,round:1,payload:payload([0])}),header({seed:3,round:2,payload:payload([2])})])];
  const rows=[];
  for(const members of ['1,2','2,3','1,2,3'])for(const dag of dags)for(const values of [bodies,[...bodies].reverse(),[],[bodies[0]]]){
    rows.push(['receive',members,dag,sequence(values)]);
  }
  h.compare(rows,evaluate);
  const accepted=evaluate(['receive','1,2',dags[0],sequence([])]).split('|');
  assert.deepEqual(accepted.slice(0,2),['0','1']);
  assert.equal(accepted[2],accepted[3]);
});
