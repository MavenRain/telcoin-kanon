import {blockOracleSources} from './block-oracle-sources.mjs';
const extra=['lib/std/nonempty.ml','lib/consensus/reputation_scores.ml','lib/consensus/sub_dag.ml',
  'lib/execution/consensus_block.ml','lib/evm/rewards_counter.ml',
  ...['tx_shape','batch_payload','output','block_plan'].map(n=>`lib/batch/${n}.ml`),
  ...['block_number','anchor','recent_hashes','config','executed_block','engine'].map(n=>`lib/engine/${n}.ml`)];
const moduleName=path=>{const n=path.split('/').at(-1).slice(0,-3);return n[0].toUpperCase()+n.slice(1);};
export const executionEngineOracleSources={
  ...blockOracleSources,
  sources:[...blockOracleSources.sources,...extra],
  modules:[...blockOracleSources.modules,...extra.map(p=>p.split('/').at(-1)),
    'tn_std.ml','tn_consensus.ml','tn_execution.ml','tn_evm.ml','tn_batch.ml'],
  extraAliases:{...blockOracleSources.extraAliases,'tn_std.ml':['Nonempty'],
    'tn_consensus.ml':['Reputation_scores','Sub_dag'],'tn_execution.ml':['Consensus_block'],
    'tn_evm.ml':['Hash32',...[...blockOracleSources.sources,...extra].filter(p=>p.startsWith('lib/evm/')).map(moduleName)],
    'tn_batch.ml':['Tx_shape','Batch_payload','Output','Block_plan']},
};
