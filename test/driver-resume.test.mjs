import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {harness,header,sequence,u16,u32,u64,hash} from './harness.mjs';
import {driverOracleSources} from './driver-oracle-sources.mjs';
import {batchWire} from './batch-validator-vectors.mjs';
const parts=readFileSync(new URL('./driver-pipeline-oracle.ml',import.meta.url),'utf8').split('\nlet run = function\n');
assert.equal(parts.length,2);
const h=await harness({name:'driver-resume',...driverOracleSources,
  modules:[...driverOracleSources.modules,'driver_fixture_helpers.ml'],
  extraAliases:{...driverOracleSources.extraAliases,'driver_fixture_helpers.ml':parts[0]},
  oracle:'test/driver-resume-oracle.ml',fixtures:['test/crypto.kan','test/execution.kan','test/state.kan',
    'test/evm-core.kan','test/evm-env.kan','test/engine-state.kan','test/driver-pipeline.kan','test/driver-resume.kan'],
  exports:['driverTestResume']});
const evaluate=([op,members,supplied,epoch,suppliedEpoch,storeEpoch,dags,bodies,prefix,sealed,code])=>
  h.text(h.e.driverTestResume(h.seeds(members),h.seeds(supplied),h.raw(u32(Number(epoch))),h.raw(u32(Number(suppliedEpoch))),
    h.raw(u32(Number(storeEpoch))),h.raw(dags),h.raw(bodies),Number(prefix),Number(sealed),h.raw(code==='-'?'':code)));
const bodies=[{txs:[]},{txs:['ff'],worker:1}].map(value=>batchWire(value).slice(0,-66));
const dag=(time,indices=[],epoch=0)=>sequence([header({seed:1,epoch,round:time,time,
  payload:indices.map(i=>'20'+hash(bodies[i])+u16(i)).sort()})])+'0000'+u64(time)+'20'+'00'.repeat(32);
const row=(dags,prefix,options={})=>['resume','1,2',options.members??'1,2',String(options.epoch??0),
  String(options.suppliedEpoch??options.epoch??0),String(options.storeEpoch??options.epoch??0),sequence(dags),sequence(bodies),String(prefix),String(options.sealed??0),'-'];
test('Restart replays exactly the received records after the executed checkpoint',()=>{
  const rows=[row([],0),row([dag(1)],0),row([dag(1,[0])],0),row([dag(1,[0]),dag(2,[1])],1),
    row([dag(1),dag(2,[0]),dag(3)],1),row([dag(1,[0]),dag(2)],2)];
  h.compare(rows,evaluate,{requireSuccess:true});
  for(const request of rows){
    const actual=evaluate(request),[checkpoint,resumed]=actual.split('~');
    assert.equal(checkpoint.split(':')[0],request[8]);
    assert.match(resumed,/^advance\|/);
  }
});
test('Restart cross-checks committee identity and store epoch before replay',()=>{
  const rows=[row([],0,{suppliedEpoch:1}),row([],0,{members:'3,4'}),row([],0,{members:'2,1'}),
    row([],0,{storeEpoch:1}),row([],0,{storeEpoch:1,sealed:1}),row([],0,{storeEpoch:2,sealed:1}),
    row([dag(1),dag(2)],1,{sealed:1,storeEpoch:1}),row([dag(1)],1,{sealed:1,storeEpoch:1}),
    row([],0,{epoch:4294967295,storeEpoch:4294967295,sealed:1})];
  h.compare(rows,evaluate,{requireSuccess:true});
  assert.match(evaluate(rows[0]),/~error:.*epoch/);
  assert.match(evaluate(rows[1]),/~error:.*committee/);
  assert.match(evaluate(rows[4]),/~sealed\|/);
  assert.match(evaluate(rows[6]),/~error:.*epoch/);
});
