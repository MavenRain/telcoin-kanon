import test from 'node:test';
import {harness,u64} from './harness.mjs';
import {executionEngineOracleSources} from './execution-engine-oracle-sources.mjs';
const h=await harness({name:'engine-snapshot',...executionEngineOracleSources,oracle:'test/engine-state-oracle.ml',
  fixtures:['test/crypto.kan','test/execution.kan','test/state.kan','test/evm-core.kan','test/evm-env.kan','test/engine-state.kan'],
  exports:['engineTestState']});
const evaluate=([op,...a])=>h.text(h.e.engineTestState(h.seeds(a[0]),h.seeds(a[1]),h.raw(u64(BigInt(a[2]))),
  h.raw(u64(BigInt(a[3]))),Number(a[4]),Number(a[5]),Number(a[6])));
test('Engine snapshots reseat the anchor hash and epoch transitions require a strict advance',()=>{
  const rows=[];
  for(const boundary of [0n,100n,(1n<<63n)-2n])for(const proposed of [boundary===0n?0n:boundary-1n,boundary,boundary+1n]){
    for(const sealed of [0,1])for(const skew of [0,1])for(const mode of [0,1,2,3]){
      rows.push(['state','1,2,3','3,4',String(boundary),String(proposed),String(sealed),String(skew),String(mode)]);
    }
  }
  h.compare(rows,evaluate);
});
