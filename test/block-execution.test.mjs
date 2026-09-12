import assert from 'node:assert/strict';
import test from 'node:test';
import {setupBlockTests} from './block-execution-common.mjs';
const {h,evaluate,account,block,context,oracle,signTx,registryCode,addr,sender,target,other,system,beacon,history,registry,callOther,word,wire,txFields}=
  await setupBlockTests('block-execution',["blockTestContext","blockTestEnvelopesEmpty","blockTestEnvelopeCons","blockTestRun"]);
test('Block folds commit admitted transactions, receipt prefixes, blooms and finished headers',()=>{
  const tx0=signTx({value:3n}),tx1=signTx({nonce:1n,data:'010203'}),badFee=signTx({nonce:1n,priority:3n,maxFee:2n});
  const world=[account(sender,'',1000000000n),account(target,'60016000555f5fa000')].join(',');
  const rows=[['run','0',world,block(),context(),'-'],['run','0',world,block(),context(),tx0],
    ['run','0',world,block(),context(),tx0+','+tx1],['run','0',world,block(),context(),tx0+','+badFee+','+tx1],
    ['run','1',world,block(),context(),tx0+','+badFee+','+tx1]];
  h.compare(rows,evaluate);
  assert.match(evaluate(rows[3]),/^error:transaction 1 rejected: priority fee above max fee/);
  assert.match(evaluate(rows[4]),/transaction 1 skipped: priority fee above max fee/);
  h.compare([['run','1',world,block({gas:word(150000)}),context(),tx0+','+tx1],
    ['run','1',world,block(),context(),wire(2,txFields(2))]],evaluate);
});

test('Finished block headers include epoch-close writes and boundary commitments',()=>{
  const world=account(registry,registryCode());
  const rows=[['run','0',world,block(),context({extra:word(13),withdrawals:'2'}),'-'],
    ['run','0',world,block(),context({extra:word(13)}),'-'],
    ['run','0',account(registry,registryCode({fail:'0'})),block(),context({extra:word(13)}),'-']];
  h.compare(rows,evaluate);
});
