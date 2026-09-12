import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,header,sequence,u16,u64,hash} from './harness.mjs';
import {driverOracleSources} from './driver-oracle-sources.mjs';
import {batchWire} from './batch-validator-vectors.mjs';
const h=await harness({name:'driver-pipeline',...driverOracleSources,oracle:'test/driver-pipeline-oracle.ml',
  fixtures:['test/crypto.kan','test/execution.kan','test/state.kan','test/evm-core.kan','test/evm-env.kan',
    'test/engine-state.kan','test/driver-pipeline.kan'],exports:['driverTestPipeline']});
const evaluate=([op,members,epoch,time,duration,gas,code,dags,bodies,sealed])=>h.text(h.e.driverTestPipeline(
  h.seeds(members),Number(epoch),h.raw(u64(time)),Number(duration),h.toBytes(gas),h.raw(code==='-'?'':code),
  h.raw(dags),h.raw(bodies),Number(sealed)));
const bodies=[{txs:[]},{txs:['ff'],worker:1},{txs:['aa','bb'],fee:9n,worker:2}].map(value=>batchWire(value).slice(0,-66));
const dag=(time,indices=[],{seed=1,epoch=0,round=1}={})=>{
  const payload=indices.map(i=>'20'+hash(bodies[i])+u16(i)).sort();
  return sequence([header({seed,epoch,round,time,payload})])+'0000'+u64(time)+'20'+'00'.repeat(32);
};
const row=(dags,options={})=>['fold',options.members??'1,2',String(options.epoch??0),String(options.time??0),
  String(options.duration??1000),String(options.gas??30000000),options.code??'-',sequence(dags),sequence(options.bodies??bodies),String(options.sealed??0)];
test('Driver folds forward complete outputs and preserve execution state and headers',()=>{
  const rows=[row([]),row([dag(1)]),row([dag(1,[0])]),row([dag(1,[1])]),row([dag(1,[0,1,2])]),
    row([dag(1,[0]),dag(2,[1],{round:2}),dag(3,[2],{seed:2,round:3})]),
    row([dag(1,[0]),dag(1,[0],{round:2})]),row([dag(1,[0]),dag(2)],{members:'1,2,3'})];
  h.compare(rows,evaluate,{requireSuccess:true});
  for(const value of rows)assert.match(evaluate(value),/^advance\|/);
});
test('Driver fold failures retain only completed advances and respect admission order',()=>{
  const rows=[row([dag(1,[0])],{bodies:[]}),row([dag(1),dag(2,[0])],{bodies:[]}),
    row([dag(1,[0],{seed:99})]),row([dag(1),dag(2,[0],{epoch:1,round:2})]),
    row([dag(1,[0],{epoch:1})],{bodies:[]}),row([dag(1,[0])],{epoch:1}),
    row([dag(1,[0])],{code:'ef0100'}),row([dag(1,[0])],{code:'ef01'})];
  h.compare(rows,evaluate);
  assert.match(evaluate(rows[1]),/^halted\|/);
  assert.match(evaluate(rows[4]),/leader epoch 1 does not match/);
});
test('Driver epoch boundaries and already-sealed folds preserve the unconsumed suffix',()=>{
  const rows=[];
  for(const duration of [1,2,3])rows.push(row([dag(1,[0]),dag(2,[1],{round:2}),dag(3,[2],{round:3})],{duration}));
  rows.push(row([],{sealed:1}),row([dag(1,[0]),dag(2,[1],{round:2})],{sealed:1}));
  rows.push(row([dag(1,[0],{epoch:1})],{sealed:1,bodies:[]}));
  h.compare(rows,evaluate);
  assert.match(evaluate(rows[3]),/^sealed\|/);
  assert.ok(evaluate(rows[4]).endsWith(sequence([dag(1,[0]),dag(2,[1],{round:2})])));
});
