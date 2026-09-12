import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {harness,u32,u64} from './harness.mjs';
import {driverOracleSources} from './driver-oracle-sources.mjs';
const helperParts=readFileSync(new URL('./driver-pipeline-oracle.ml',import.meta.url),'utf8').split('\nlet run = function\n');
assert.equal(helperParts.length,2,'The shared oracle fixture section must have one dispatch boundary');
const h=await harness({name:'driver-handoff',...driverOracleSources,
  modules:[...driverOracleSources.modules,'driver_fixture_helpers.ml'],
  extraAliases:{...driverOracleSources.extraAliases,'driver_fixture_helpers.ml':helperParts[0]},
  oracle:'test/driver-handoff-oracle.ml',fixtures:['test/crypto.kan','test/execution.kan','test/state.kan','test/evm-core.kan',
    'test/evm-env.kan','test/engine-state.kan','test/driver-pipeline.kan','test/driver-handoff.kan'],exports:['driverTestHandoffWire']});
const evaluate=([op,members,epoch,next,nextEpoch,frontier,duration,sealed,leaders,code])=>h.text(h.e.driverTestHandoffWire(
  h.seeds(members),h.raw(u32(Number(epoch))),h.seeds(next),h.raw(u32(Number(nextEpoch))),h.raw(u64(frontier)),h.toBytes(duration),Number(sealed),
  h.seeds(leaders),h.raw(code==='-'?'':code)));
const row=(epoch,nextEpoch,frontier,duration,sealed)=>['handoff','1,2',String(epoch),'3,4',String(nextEpoch),String(frontier),String(duration),String(sealed),'1,1,2,99','-'];
test('Driver handoff distinguishes a running epoch, stale committees and a valid new epoch',()=>{
  const rows=[];
  for(const [epoch,next] of [[0,0],[0,1],[7,6],[7,7],[7,8],[4294967295,4294967295]]){
    for(const sealed of [0,1])for(const frontier of [0,108])rows.push(row(epoch,next,frontier,100,sealed));
  }
  h.compare(rows,evaluate,{requireSuccess:true});
  assert.match(evaluate(row(0,1,108,100,0)),/~error:epoch handoff refused: the epoch is still running/);
  const advanced=evaluate(row(0,1,108,100,1)).split('~');
  assert.ok(advanced[1].startsWith('1|'));
  assert.deepEqual(advanced.slice(2),['108','208']);
});
test('Driver boundary saturation preserves the overshoot and refuses a nonadvancing frontier',()=>{
  const rows=[];
  for(const frontier of [9223372036854775805n,9223372036854775806n,9223372036854775807n]){
    for(const duration of [1n,2n,100n,4611686018427387903n])rows.push(row(7,8,frontier,duration,1));
  }
  h.compare(rows,evaluate,{requireSuccess:true});
  assert.match(evaluate(row(7,8,9223372036854775807n,1,1)),/~error:/);
  assert.ok(!evaluate(row(7,8,9223372036854775806n,1,1)).split('~')[1].startsWith('error:'));
});
