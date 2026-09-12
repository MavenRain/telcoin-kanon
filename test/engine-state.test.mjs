import test from 'node:test';
import {harness} from './harness.mjs';
import {executionEngineOracleSources} from './execution-engine-oracle-sources.mjs';
const h=await harness({name:'engine-state',...executionEngineOracleSources,oracle:'test/engine-state-oracle.ml',
  fixtures:['test/crypto.kan','test/execution.kan','test/state.kan','test/evm-core.kan','test/evm-env.kan','test/engine-state.kan'],
  exports:['engineTestRewards','engineTestRecent','engineTestNumber']});
const word=n=>BigInt(n).toString(16).padStart(64,'0');
const rawList=raw=>(raw==='-'?[]:raw.split(',')).reverse().reduce((tail,value)=>h.e.seqBytesCons(h.raw(value),tail),h.e.seqBytesEmpty());
const seeds=raw=>h.seeds(raw==='-'?'empty':raw);
const evaluate=([op,...a])=>{
  if(op==='number')return h.text(h.e.engineTestNumber(h.toBytes(a[0])));
  if(op==='rewards')return h.text(h.e.engineTestRewards(seeds(a[0]),seeds(a[1]),Number(a[2]),h.toBytes(a[3]),Number(a[4]),Number(a[5])));
  if(op==='recent')return h.text(h.e.engineTestRecent(h.raw(a[0]),rawList(a[1]),rawList(a[2]),h.raw(a[3]),h.raw(a[4])));
  throw new Error(`Unknown fixture operation: ${op}`);
};
test('Reward counters merge shared addresses, skip unknown leaders and preserve committee on clear',()=>{
  const rows=[];
  for(const members of ['1,2','2,1,3,4'])for(const shared of [0,1])for(const install of [0,1])for(const clear of [0,1]){
    for(const leaders of ['-','1','1,1,2,3,99'])rows.push(['rewards',members,leaders,String(shared),'7',String(clear),String(install)]);
  }
  h.compare(rows,evaluate,{requireSuccess:true});
});
test('Reward overflow remains a typed withdrawal failure with source integer semantics',()=>{
  const rows=[];
  for(const initial of [-1n,-(1n<<62n),(1n<<62n)-1n])for(const shared of [0,1])for(const leaders of ['-','1','1,1,2']){
    rows.push(['rewards','1,2',leaders,String(shared),String(initial),'0','1']);
  }
  h.compare(rows,evaluate);
});
test('Recent hashes cap ancestors at 255 and answer only the previous 256 block heights',()=>{
  const rows=[];
  for(const count of [0,1,254,255,256,300])for(const pushed of [0,1,3]){
    const ancestors=Array.from({length:count},(_,i)=>word(i+10)).join(',')||'-';
    const pushes=Array.from({length:pushed},(_,i)=>word(i+500)).join(',')||'-';
    for(const distance of [-1,0,1,2,255,256,257])rows.push(['recent',word(1),ancestors,pushes,word(1000),word(1000-distance)]);
  }
  h.compare(rows,evaluate,{requireSuccess:true});
});
test('Block numbers preserve native signed width and zero-extended int64 environment words',()=>{
  h.compare([-(1n<<62n),-1n,0n,1n,(1n<<31n)-1n,1n<<31n,(1n<<62n)-1n].map(n=>['number',String(n)]),evaluate,{requireSuccess:true});
});
