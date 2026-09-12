import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,protocolSources,protocolModules} from './harness.mjs';
const h=await harness({name:'crypto-blst-protocol',profile:'bls',
  sources:[...protocolSources.flatMap(path=>path==='lib/crypto_stub/tn_crypto.ml'?['lib/crypto_blst/blake3.ml','lib/crypto_blst/tn_crypto.ml']:[path]),
    'lib/std/nonempty.ml','lib/consensus/reputation_scores.ml','lib/consensus/sub_dag.ml',
    ...['consensus_block','consensus_chain','nothing','engine','replay','consensus_store'].map(name=>`lib/execution/${name}.ml`)],
  modules:[...protocolModules.flatMap(name=>name==='tn_crypto.ml'?['blake3.ml',name]:[name]),'nonempty.ml','tn_std.ml','reputation_scores.ml','sub_dag.ml','tn_consensus.ml',
    'consensus_block.ml','consensus_chain.ml','nothing.ml','engine.ml','replay.ml','consensus_store.ml'],
  extraAliases:{'tn_std.ml':['Nonempty'],'tn_consensus.ml':['Reputation_scores','Sub_dag']},
  packages:'bls12-381,bls12-381-signature,hex,zarith,digestif.c',oracle:'test/execution-oracle.ml',
  fixtures:['test/crypto.kan','test/protocol.kan','test/consensus.kan','test/execution.kan'],exports:['execution_genesis','execution_block']});
test('The BLS chain anchor, default header, sub-DAG and block digest match the source-computed genesis',()=>{
  h.compare([['genesis']],()=>h.text(h.e.execution_genesis()),{requireSuccess:true});
  const result=h.runOracle([],'genesis\n');assert.equal(result.status,0,result.stderr);
  const [anchor,block]=result.stdout.trim().split(':');
  assert.equal(anchor,'036e5c0a72077a23c817ab35907e7a5eedf5014e42095c4033f30f9c5cb94ed6');
  h.compare([['block',block]],([,raw])=>h.text(h.e.execution_block(h.raw(raw))),{requireSuccess:true});
});
