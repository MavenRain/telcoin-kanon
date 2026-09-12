import assert from 'node:assert/strict';
import test from 'node:test';
import {harness} from './harness.mjs';
import {executionEngineOracleSources} from './execution-engine-oracle-sources.mjs';
import {batchWire} from './batch-validator-vectors.mjs';
import {transactionGoldens,type4Golden,txFields,wire,scalar} from './transaction-vectors.mjs';
const h=await harness({name:'batch-payload',...executionEngineOracleSources,oracle:'test/batch-output-oracle.ml',
  fixtures:['test/batch-output.kan'],exports:['batchOutputTestPayload']});
const row=txs=>['payload',batchWire({txs}).slice(0,-66)];
const evaluate=([op,raw])=>h.text(h.e.batchOutputTestPayload(h.raw(raw)));
test('Execution payloads retain signed order and canonicalize tagged legacy transactions',()=>{
  const goldens=[...transactionGoldens,type4Golden].map(g=>g.encoded_2718);
  const legacy=goldens.find(tx=>parseInt(tx.slice(0,2),16)>127);
  const rows=[row([]),row(goldens),row(['00'+legacy]),row([goldens[0],goldens[0]])];
  h.compare(rows,evaluate,{requireSuccess:true});
  assert.equal(evaluate(rows[1]),'payload:'+goldens.map(tx=>tx+';').join(''));
  assert.equal(evaluate(rows[2]),'payload:'+legacy+';');
});
test('Payload filtering drops malformed, blob and executor-unrepresentable envelopes',()=>{
  const positive=transactionGoldens[0].encoded_2718;
  const base=txFields(2),blob=[...base.slice(0,9),'01',['11'.repeat(32)],...base.slice(9)];
  const rejected=['','00','02','c0',wire(3,blob)];
  for(const index of [1,4])for(const n of [1n<<62n,1n<<63n,0xffffffffffffffffn]){
    const f=txFields(2);f[index]=scalar(n);rejected.push(wire(2,f));
  }
  const rows=rejected.map(tx=>row([positive,tx,positive]));
  h.compare(rows,evaluate,{requireSuccess:true});
  for(const value of rows)assert.equal(evaluate(value),'payload:'+positive+';'+positive+';');
});
