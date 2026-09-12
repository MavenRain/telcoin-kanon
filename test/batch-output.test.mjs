import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,header,sequence,u16,u64,hash,authorityId} from './harness.mjs';
import {executionEngineOracleSources} from './execution-engine-oracle-sources.mjs';
import {batchWire} from './batch-validator-vectors.mjs';
const h=await harness({name:'batch-output',...executionEngineOracleSources,oracle:'test/batch-output-oracle.ml',
  fixtures:['test/batch-output.kan'],exports:['batchOutputTestAttach','batchOutputTestPlan']});
const zero='00'.repeat(32);
const body=options=>batchWire(options).slice(0,-66);
const bodies=[body({txs:[],worker:7}),body({txs:['aa'],epoch:99,fee:0n,worker:65535}),body({txs:['bb','cc'],fee:0xffffffffffffffffn,worker:3})];
const payload=indices=>indices.map(i=>'20'+hash(bodies[i])+u16(i)).sort();
const consensus=(headers,stored=2)=>'20'+zero+sequence(headers)+'0000'+u64(stored)+'20'+zero+u64(1)+'20'+zero;
const evaluate=([op,raw,values,missing,closing])=>op==='attach'
  ?h.text(h.e.batchOutputTestAttach(h.raw(raw),h.raw(values),h.raw(missing)))
  :h.text(h.e.batchOutputTestPlan(h.raw(raw),h.raw(values),h.raw(missing),Number(closing)));
const row=(op,raw,values=bodies,missing='-',closing=0)=>[op,raw,sequence(values),missing,String(closing)];
test('Payload attachment preserves certificate order and repeated batch references',()=>{
  const raw=consensus([header({seed:1,round:1,payload:payload([0,1,2])}),header({seed:2,round:2,payload:payload([1,2])})]);
  const rows=[bodies,[...bodies].reverse(),[...bodies,bodies[0]]].map(values=>row('attach',raw,values));
  h.compare(rows,evaluate,{requireSuccess:true});
  assert.equal(evaluate(rows[0]),evaluate(rows[1]));
  assert.equal(evaluate(rows[0]).split('|').at(-1).split(';').filter(Boolean).length,5);
});
test('Attachment errors preserve header address and batch lookup precedence',()=>{
  const raw=consensus([header({seed:1,round:1,payload:payload([0,1])}),header({seed:2,round:2,payload:payload([2])})]);
  const rows=[];
  for(const values of [[],bodies.slice(1),bodies.slice(0,2),bodies])for(const missing of ['-',authorityId(1),authorityId(2)])rows.push(row('attach',raw,values,missing));
  h.compare(rows,evaluate);
  assert.match(evaluate(row('attach',raw,[],authorityId(1))),/^error:unknown authority /);
  assert.match(evaluate(row('attach',raw,[],authorityId(2))),/^error:missing fetched batch /);
});
test('Empty output plans skip open epochs and create one closing specification',()=>{
  const rows=[];
  for(const epoch of [0,1,4294967295])for(const time of [0,1,10]){
    const raw=consensus([header({seed:2,round:12,epoch,time})],1);
    rows.push(row('attach',raw,[]),row('plan',raw,[],'-',0),row('plan',raw,[],'-',1));
  }
  h.compare(rows,evaluate,{requireSuccess:true});
  assert.equal(evaluate(rows[1]),'skip');assert.match(evaluate(rows[2]),/^close:/);
});
test('Block plans preserve worker positions, fees, mix hashes and final-only closing',()=>{
  const rows=[];
  for(const indices of [[0],[1],[0,1,2]])for(const closing of [0,1])for(const epoch of [0,17]){
    const raw=consensus([header({seed:1,round:1,epoch,payload:payload(indices)}),header({seed:2,round:2,epoch,time:9,payload:payload([2])})]);
    rows.push(row('plan',raw,bodies,'-',closing));
  }
  h.compare(rows,evaluate,{requireSuccess:true});
  for(const value of rows){
    const flags=evaluate(value).slice(8).split(';').filter(Boolean).map(spec=>spec.split(':').at(-1));
    assert.ok(flags.slice(0,-1).every(flag=>flag==='0'));assert.equal(flags.at(-1),value[4]);
  }
});
