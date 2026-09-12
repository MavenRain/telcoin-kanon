import test from 'node:test';
import {harness,protocolSources,protocolModules,sequence,u32} from './harness.mjs';
const h=await harness({name:'ordered-set',sources:protocolSources,modules:protocolModules,
  oracle:'test/ordered-set-oracle.ml',fixtures:['test/execution.kan','test/ordered-set.kan'],
  exports:['orderedSetTestRound','orderedSetTestAuthority']});
const evaluate=([kind,...args])=>h.text(h.e[kind==='round'?'orderedSetTestRound':'orderedSetTestAuthority'](...args.map(h.raw)));
for(const kind of ['round','authority']) test(`${kind} sets preserve order, deduplicate maps, split boundaries and match total search results`,()=>{
  const encode=kind==='round'?u32:n=>BigInt(n).toString(16).padStart(64,'0');
  const rows=[];
  for(const left of [[],[0],[4,2,1,4,2],[0,1,2,3,4],[4294967295,256,255,1,0]])
    for(const right of [[],[2],[4,1,2,4],[4294967295,0,256]])
      for(const key of [0,2,5,4294967295]) rows.push([kind,sequence(left.map(encode)),sequence(right.map(encode)),encode(key)]);
  h.compare(rows,evaluate,{requireSuccess:true});
});
