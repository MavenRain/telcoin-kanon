import assert from 'node:assert/strict';
import {harness} from './harness.mjs';
import {blockOracleSources} from './block-oracle-sources.mjs';
import {word, scalar, wire, txFields} from './transaction-vectors.mjs';
export async function setupBlockTests(name, exports){
const h=await harness({name,...blockOracleSources,oracle:'test/block-execution-oracle.ml',
  fixtures:['test/executor-common.kan','test/block-context.kan','test/block-execution.kan'],
  exports:['worldStateEmpty','executorTestSetAccount','executorTestBlock','blockTestExtend',...exports]});
const addr = n => BigInt(n).toString(16).padStart(40,'0');
const sender='7e5f4552091a69125d5dfcb7b8c2659029395bdf', target=addr(512), other=addr(600);
const system='fffffffffffffffffffffffffffffffffffffffe';
const beacon='000f3df6d732807ef1319fb7b8bb8522d0beac02';
const history='0000f90827f1c53a10cb7a02335b175320002935';
const registry='07e17e17e17e17e17e17e17e17e17e17e17e17e1';
const account=(address,code='',balance=0n,nonce=0n,slot=0n)=>[address,word(nonce),word(balance),code,word(slot)].join(':');
const state=raw=>{
  let world=h.e.worldStateEmpty();
  if(raw==='deploy') return h.e.systemContractsPredeploy(world);
  for(const entry of raw==='-'?[]:raw.split(',')) world=h.e.executorTestSetAccount(world,...entry.split(':').map(h.raw));
  return world;
};
const block=(changes={})=>Object.values({fork:'2',coinbase:addr(768),feeAddress:addr(1024),chain:word(1),gas:word(1000000),baseFee:word(0),
  number:word(1),timestamp:word(1),blob:word(29),...changes}).join(':');
const context=(changes={})=>Object.values({parent:word(3),root:word(4),position:word(0),extra:'',withdrawals:'0',...changes}).join(':');
const blockValue=raw=>{
  const [fork,...fields]=raw.split(':');
  return h.e.blockTestExtend(h.e.executorTestBlock(Number(fork),...fields.slice(0,5).map(h.raw)),...fields.slice(5).map(h.raw));
};
const contextValue=(block,raw)=>{
  const fields=raw.split(':'); return h.e.blockTestContext(block,...fields.slice(0,4).map(h.raw),Number(fields[4]));
};
const envelopes=raw=>(raw==='-'?[]:raw.split(',')).reverse().reduce((tail,tx)=>h.e.blockTestEnvelopeCons(h.raw(tx),tail),h.e.blockTestEnvelopesEmpty());
const rewards=raw=>(raw==='-'?[]:raw.split(',')).reverse().reduce((tail,pair)=>{
  const [a,n]=pair.split(':'); return h.e.blockTestRewardCons(h.raw(a),h.toBytes(n),tail);
},h.e.seqRewardPairEmpty());
const evaluate=([op,...args])=>{
  if(op==='run'){
    const [mode,world,b,c,txs]=args, value=blockValue(b);
    return h.text(h.e.blockTestRun(Number(mode),state(world),contextValue(value,c),envelopes(txs)));
  }
  const [world,b,...rest]=args,value=blockValue(b);
  if(op==='system') return h.text(h.e.blockTestSystem(state(world),value,...rest.map(h.raw)));
  if(op==='pre') return h.text(h.e.blockTestPre(state(world),contextValue(value,rest[0])));
  return h.text(h.e.blockTestClose(state(world),value,rewards(rest[0]),h.raw(rest[1])));
};
const oracle=row=>{
  const result=h.runOracle([],row.join(' ')+'\n'); assert.equal(result.status,0,result.error?.message??result.stderr);
  return result.stdout.trimEnd();
};
const order=0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const gx=0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const signTx=({nonce=0n,gas=120000n,to=target,value=0n,data='',maxFee=2n,priority=1n}={})=>{
  const f=txFields(2);
  [f[0],f[1],f[2],f[3],f[4],f[5],f[6],f[7],f[8],f[9],f[10],f[11]]=
    [scalar(1),scalar(nonce),scalar(priority),scalar(maxFee),scalar(gas),to,scalar(value),data,[],'','01','01'];
  const digest=oracle(['signing-hash',wire(2,f)]);
  assert.match(digest,/^[a-f0-9]{64}$/);
  let s=(BigInt('0x'+digest)+gx)%order,parity=0n;
  if(s>order/2n){s=order-s;parity=1n;}
  f[9]=scalar(parity);f[10]=scalar(gx);f[11]=scalar(s);return wire(2,f);
};
const callOther='6000600060006000600561025862ffffff f150'.replaceAll(' ','');
const assemble=parts=>{
  const labels=new Map();let offset=0;
  for(const part of parts){
    if(part.label){labels.set(part.label,offset);continue;}
    offset+=part.push?3:part.hex.length/2;
  }
  return parts.map(part=>part.label?'':part.push?'61'+labels.get(part.push).toString(16).padStart(4,'0'):part.hex).join('');
};
const selectors=oracle(['selectors']).split(',');
const registryCode=({pool=word(32)+word(0),size=word(0),fail=''}={})=>{
  const parts=[{hex:'60003560e01c'}];
  for(let i=0;i<4;i++) parts.push({hex:'8063'+selectors[i]+'14'},{push:'branch'+i},{hex:'57'});
  parts.push({hex:'60006000fd'});
  const returns=[null,pool,size,null];
  for(let i=0;i<4;i++){
    parts.push({label:'branch'+i},{hex:'5b50'});
    if(fail===String(i)){parts.push({hex:'60006000fd'});continue;}
    if(i===0) parts.push({hex:'604d60005500'});
    else if(i===3) parts.push({hex:'604260025500'});
    else {
      const data=returns[i],length=data.length/2;
      parts.push({hex:'6058600155'},{hex:'61'+length.toString(16).padStart(4,'0')},{push:'data'+i},
        {hex:'60003961'+length.toString(16).padStart(4,'0')+'6000f3'});
    }
  }
  for(const i of [1,2]) parts.push({label:'data'+i},{hex:returns[i]});
  return assemble(parts);
};

return {h,evaluate,account,block,context,oracle,signTx,registryCode,addr,sender,target,other,system,beacon,history,registry,callOther,word,wire,txFields};
}
