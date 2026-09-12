import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {harness} from './harness.mjs';
import {evmOracleSources} from './evm-oracle-sources.mjs';
import {transactionGoldens,type4Golden} from './transaction-vectors.mjs';
const parts=readFileSync(new URL('receipt-oracle.ml',import.meta.url),'utf8').split('\nlet dispatch line =');assert.equal(parts.length,2);
const h=await harness({name:'block-typed-roots',...evmOracleSources,
  modules:[...evmOracleSources.modules,'receipt_fixture_helpers.ml'],
  extraAliases:{...evmOracleSources.extraAliases,'receipt_fixture_helpers.ml':parts[0]},
  oracle:'test/block-typed-roots-oracle.ml',fixtures:['test/receipt.kan','test/block-typed-roots.kan'],
  exports:['blockTypedTestReceiptRoot','blockTypedTestTransactionRoot']});
const bytes=value=>h.raw(value==='-'?'':value);
const evaluate=([op,...args])=>op==='receipts'?
  h.text(h.e.blockTypedTestReceiptRoot(bytes(args[0]),bytes(args[1]),h.toBytes(args[2]))):
  h.text(h.e.blockTypedTestTransactionRoot((args[0]==='-'?[]:args[0].split(',')).reduceRight((tail,wire)=>h.e.seqBytesCons(bytes(wire),tail),h.e.seqBytesEmpty())));
test('Typed receipt roots enforce matching lengths and preserve transaction tags, status, logs and cumulative gas',()=>{
  const rows=[];
  for(const kinds of ['-','00','01','02','04','00010204','04020100','020200'])
    for(const statuses of ['-','00','01','02','00010200','02010002','000000'])
      for(const gas of ['0','21000','4611686018427387903']) rows.push(['receipts',kinds,statuses,gas]);
  h.compare(rows,evaluate,{requireSuccess:true});
  assert.equal(evaluate(['receipts','-','00','0']),'none');assert.equal(evaluate(['receipts','00','-','0']),'none');
  assert.notEqual(evaluate(['receipts','00','00','21000']),evaluate(['receipts','02','00','21000']));
});
test('Typed transaction roots use signed EIP-2718 bytes in original order, including duplicates',()=>{
  const wires=[...transactionGoldens,type4Golden].map(golden=>golden.encoded_2718);
  const lists=[[],...wires.map(wire=>[wire]),wires,[...wires].reverse(),[wires[0],wires[0]],
    [wires.at(-1),wires[0],wires.at(-1)],Array.from({length:18},(_,i)=>wires[i%wires.length])];
  h.compare(lists.map(values=>['transactions',values.join(',')||'-']),evaluate,{requireSuccess:true});
  assert.notEqual(evaluate(['transactions',wires.join(',')]),evaluate(['transactions',[...wires].reverse().join(',')]));
});
