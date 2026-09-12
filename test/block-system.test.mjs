import assert from 'node:assert/strict';
import test from 'node:test';
import {setupBlockTests} from './block-execution-common.mjs';
const {h,evaluate,account,block,context,oracle,signTx,registryCode,addr,sender,target,other,system,beacon,history,registry,callOther,word,wire,txFields}=
  await setupBlockTests('block-system',["systemContractsPredeploy","blockTestContext","blockTestPre","blockTestSystem"]);
test('System calls preserve their environment and both account retention rules',()=>{
  const codes=['00','600160005500','600160005560006000fd','fe',
    '456000524860205260406000f3','6001600055'+callOther+'00'];
  const rows=codes.flatMap(code=>['0','1','2'].map(fork=>['system',account(target,code,10n),block({fork,gas:word(0),baseFee:word(99)}),target,'']));
  rows.push(['system',[account(target,'600160005500'),account(system,'00',0n)].join(','),block(),target,'']);
  rows.push(['system',[account(target,'00'),account(system,'',0n,7n)].join(','),block(),target,'']);
  h.compare(rows,evaluate);
  const [receipt,retained,all]=evaluate(['system',account(target,'6001600055'+callOther+'00',10n),block(),target,'']).split('|');
  assert.match(receipt,/success/i); assert.ok(!retained.includes(other+':')); assert.ok(all.includes(other+':'));
});

test('Pre-block calls preserve source gate order and write only deployed targets',()=>{
  const rows=[];
  for(const world of ['-','deploy']) for(const fork of ['0','1','2']) for(const number of [0,1]) for(const position of [0,1]){
    rows.push(['pre',world,block({fork,number:word(number)}),context({root:word(number===0?0:4),position:word(position)})]);
  }
  rows.push(['pre',account(beacon,'60006000fd'),block(),context()]);
  rows.push(['pre',account(system,'00'),block(),context()]);
  h.compare(rows,evaluate);
});
