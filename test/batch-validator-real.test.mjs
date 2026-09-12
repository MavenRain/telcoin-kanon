import test from 'node:test';
import {harness,u32} from './harness.mjs';
import {batchValidatorOracleSources} from './batch-validator-oracle-sources.mjs';
import {batchRow} from './batch-validator-vectors.mjs';
import {transactionGoldens,type4Golden,wire,txFields} from './transaction-vectors.mjs';
const h=await harness({name:'batch-validator-real',...batchValidatorOracleSources,oracle:'test/batch-validator-oracle.ml',
  fixtures:['test/batch-validator.kan'],exports:['batchTestReal']});
const evaluate=([mode,raw,worker,epoch,fee])=>h.text(h.e.batchTestReal(h.raw(raw),Number(worker),h.raw(u32(Number(epoch))),h.raw(fee)));
test('Default batch validator binds the checked transaction-shape decoder',()=>{
  const signed=[...transactionGoldens,type4Golden].map(g=>g.encoded_2718);
  h.compare(signed.map(tx=>batchRow('real',{txs:[tx]})),evaluate,{requireSuccess:true});
  const legacy=signed.find(tx=>parseInt(tx.slice(0,2),16)>127);
  const f=txFields(2);f[10]='';
  h.compare([batchRow('real',{txs:['00'+legacy]}),batchRow('real',{txs:[signed[0],'']}),
    batchRow('real',{txs:[wire(2,f)],fee:9n},{fee:7n})],evaluate);
});
