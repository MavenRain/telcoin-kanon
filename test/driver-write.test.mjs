import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {harness,header,sequence,u16,u64,hash} from './harness.mjs';
import {driverOracleSources} from './driver-oracle-sources.mjs';
import {batchWire} from './batch-validator-vectors.mjs';
const parts=readFileSync(new URL('./driver-pipeline-oracle.ml',import.meta.url),'utf8').split('\nlet run = function\n');
assert.equal(parts.length,2);
const h=await harness({name:'driver-write',...driverOracleSources,
  modules:[...driverOracleSources.modules,'driver_fixture_helpers.ml'],
  extraAliases:{...driverOracleSources.extraAliases,'driver_fixture_helpers.ml':parts[0]},
  oracle:'test/driver-write-oracle.ml',fixtures:['test/crypto.kan','test/execution.kan','test/state.kan',
    'test/evm-core.kan','test/evm-env.kan','test/engine-state.kan','test/driver-pipeline.kan','test/driver-resume.kan','test/driver-write.kan'],
  exports:['driverTestWrite']});
const evaluate=([op,members,dags,other,bodies,prefix,mode,code])=>
  h.text(h.e.driverTestWrite(h.seeds(members),h.raw(dags),h.raw(other),h.raw(bodies),Number(prefix),Number(mode),h.raw(code==='-'?'':code)));
const bodies=[{txs:[]},{txs:['ff'],worker:1},{txs:['01'],worker:2}].map(value=>batchWire(value).slice(0,-66));
const dag=(time,indices=[])=>sequence([header({seed:1,epoch:0,round:time,time,
  payload:indices.map(i=>'20'+hash(bodies[i])+u16(i)).sort()})])+'0000'+u64(time)+'20'+'00'.repeat(32);
const row=(dags,prefix,mode=0,other=[])=>['write','1,2',sequence(dags),sequence(other),sequence(bodies),String(prefix),String(mode),'-'];
test('Live writes mint deterministically and execute the exact saved consensus block',()=>{
  const dags=[dag(1,[0]),dag(2,[1]),dag(3,[0,2])];
  const rows=[row([],0),...Array.from({length:4},(_,n)=>row(dags,n)),row([dag(1),dag(2)],2)];
  h.compare(rows,evaluate,{requireSuccess:true});
  for(const request of rows){
    const actual=evaluate(request),[trace,summary]=actual.split('~');
    assert.equal(summary.split(':')[0],request[5]);
    assert.equal((trace.match(/:true:true:/g)??[]).length,Number(request[5]));
  }
});
test('C2 retains the received record and earlier checkpoint after an attachment failure, then replays stored bodies',()=>{
  const rows=[row([dag(1,[0])],0,1),row([dag(1),dag(2,[1])],1,1),
    row([dag(1,[0]),dag(2,[1]),dag(3,[0,2])],2,1)];
  h.compare(rows,evaluate,{requireSuccess:true});
  for(const request of rows){
    const fields=evaluate(request).split('~'),prefix=Number(request[5]);
    assert.match(fields[2],/^error:.*batch/);
    assert.equal(fields[3].split(':')[0],String(prefix));
    assert.equal(fields[3].split('|').at(-1),String(prefix+1));
    assert.match(fields[4],new RegExp(`^advance\\|${prefix+1}\\|`));
  }
});
test('Resume rejects a crossed consensus history at the checkpoint floor',()=>{
  const a=[dag(1,[0]),dag(2,[1]),dag(3,[2])],b=[dag(2,[1]),dag(3,[2]),dag(4,[0])];
  const rows=[row(a,1,2,b),row(a,2,2,b),row(a,3,2,b),row(a,3,2,a)];
  h.compare(rows,evaluate,{requireSuccess:true});
  for(const request of rows.slice(0,3)) assert.match(evaluate(request).split('~')[2],/^error:.*fork/i);
  assert.match(evaluate(rows[3]).split('~')[2],/^advance\|3\|/);
});
