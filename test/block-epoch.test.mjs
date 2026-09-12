import assert from 'node:assert/strict';
import test from 'node:test';
import {setupBlockTests} from './block-execution-common.mjs';
const {h,evaluate,account,block,context,oracle,signTx,registryCode,addr,sender,target,other,system,beacon,history,registry,callOther,word,wire,txFields}=
  await setupBlockTests('block-epoch',["blockTestClose","blockTestRewardCons","seqRewardPairEmpty"]);
test('Epoch closing commits mandatory writes and discards registry read side effects',()=>{
  const variants=[{},...['0','1','2','3'].map(fail=>({fail})),{pool:''},{pool:word(0)},{size:word(65536)},{size:''}];
  const rows=variants.map(options=>['close',account(registry,registryCode(options)),block(),addr(9)+':3,'+addr(2)+':7',word(11)]);
  h.compare(rows,evaluate);
  const successful=evaluate(rows[0]);assert.ok(!successful.startsWith('error:'));
  assert.ok(successful.includes(word(0)+'='+word(77)));assert.ok(successful.includes(word(2)+'='+word(66)));
  assert.ok(!successful.includes(word(1)+'='+word(88)));
});
