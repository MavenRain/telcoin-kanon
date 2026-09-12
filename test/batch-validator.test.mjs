import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,u32} from './harness.mjs';
import {batchValidatorOracleSources} from './batch-validator-oracle-sources.mjs';
import {mockTx,batchRow} from './batch-validator-vectors.mjs';
const h=await harness({name:'batch-validator',...batchValidatorOracleSources,oracle:'test/batch-validator-oracle.ml',
  fixtures:['test/batch-validator.kan'],exports:['batchTestMock','batchTestSize']});
const evaluate=([mode,raw,worker,epoch,fee])=>{
  if(mode==='size'){
    let values=h.e.seqBytesEmpty();
    for(const n of raw.split(',').reverse())values=h.e.seqBytesCons(h.toBytes(Buffer.alloc(Number(n),97)),values);
    return h.text(h.e.batchTestSize(values));
  }
  return h.text(h.e.batchTestMock(h.raw(raw),Number(worker),h.raw(u32(Number(epoch))),h.raw(fee)));
};
test('Batch validator returns the same first failure across digest, worker, epoch and payload rules',()=>{
  const rows=[];
  for(const badDigest of [false,true])for(const worker of [0,1])for(const epoch of [0,1])
    for(const txs of [[],[''],[mockTx(0n,2)],[mockTx(0n,1)],[mockTx(30000001n)],[mockTx()]])
      for(const fee of [6n,7n,8n])rows.push(batchRow('mock',{badDigest,worker,epoch,txs,fee},{worker:0,epoch:0,fee:7n}));
  h.compare(rows,evaluate);
  assert.match(evaluate(batchRow('mock',{badDigest:true,worker:1,epoch:1},{worker:0,epoch:0})),/^error:fatal:Invalid digest/);
});
test('Batch recovery of every transaction precedes blob rejection and gas accounting',()=>{
  const rows=[
    [mockTx(0n,1),mockTx(0n,2)],[mockTx(0n,2),mockTx(0n,1)],
    [mockTx(0xffffffffffffffffn),mockTx(1n),mockTx(0n,1)],
    [mockTx(0n,1),mockTx(1n,1)],[mockTx(0n),mockTx(0n,1)],
    [mockTx(0n),mockTx(1n),mockTx(2n)],[mockTx(0n),'']
  ].map(txs=>batchRow('mock',{txs}));
  h.compare(rows,evaluate);
  assert.match(evaluate(rows[0]),/^error:severe:/);
  assert.match(evaluate(rows[2]),/^error:medium:/);
});
test('Batch gas uses checked unsigned u64 addition and permits equality at the cap',()=>{
  const inputs=[[0n],[30000000n],[30000001n],[15000000n,15000000n],[30000000n,1n],
    [0xffffffffffffffffn],[0xffffffffffffffffn,0n],[0xffffffffffffffffn,1n],[1n,0xffffffffffffffffn],
    [1n<<63n,1n<<63n],[1n<<62n,0n],[1n<<63n,1n<<62n,1n<<62n]];
  const rows=inputs.flatMap(gases=>[7n,8n].map(fee=>batchRow('mock',{txs:gases.map(g=>mockTx(g)),fee},{fee:7n})));
  h.compare(rows,evaluate);
  assert.match(evaluate(rows[2]),/^ok:/);assert.match(evaluate(rows[14]),/^error:fatal:Overflow calculating/);
});
test('Batch byte cap counts raw payload bytes and accepts exactly one million',()=>{
  h.compare([['size','0'],['size','999999'],['size','1000000'],['size','1000001'],
    ['size','500000,500000'],['size','500000,500001']],evaluate);
});
test('Batch snapshots preserve maximal worker, epoch and unsigned base fee values',()=>{
  const rows=[];
  for(const worker of [0,65535])for(const epoch of [0,4294967295])for(const fee of [0n,1n<<63n,0xffffffffffffffffn])
    rows.push(batchRow('mock',{worker,epoch,fee,txs:[mockTx()]}));
  h.compare(rows,evaluate,{requireSuccess:true});
});
