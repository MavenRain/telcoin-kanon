import test from 'node:test';
import {harness,protocolSources,protocolModules,sequence,u32} from './harness.mjs';
const h=await harness({name:'ordered-map',sources:protocolSources,modules:protocolModules,
  oracle:'test/ordered-map-oracle.ml',fixtures:['test/execution.kan','test/ordered-set.kan','test/ordered-map.kan'],
  exports:['orderedMapTestRound','orderedMapTestAuthority']});
const evaluate=([kind,...args])=>h.text(h.e[kind==='round'?'orderedMapTestRound':'orderedMapTestAuthority'](...args.map(h.raw)));
for(const kind of ['round','authority']) test(`${kind} maps match updates, canonical bindings, polymorphic transforms, merges and searches`,()=>{
  const encode=kind==='round'?u32:n=>BigInt(n).toString(16).padStart(64,'0');
  const pairs=entries=>sequence(entries.map(([key,value])=>encode(key)+u32(value)));
  const rows=[];
  for(const left of [[],[[0,0]],[[4,1],[2,2],[1,3],[4,9],[2,0]],[[0,7],[1,4],[2,2],[3,0],[4,4]],[[4294967295,3],[256,4],[255,6],[1,1],[0,0]]])
    for(const right of [[],[[2,2]],[[4,9],[1,1],[2,3],[4,1]],[[4294967295,3],[0,0],[256,7]]])
      for(const key of [0,2,5,4294967295]) rows.push([kind,pairs(left),pairs(right),encode(key)]);
  for(let offset=0;offset<rows.length;offset+=20) h.compare(rows.slice(offset,offset+20),evaluate,{requireSuccess:true});
});
