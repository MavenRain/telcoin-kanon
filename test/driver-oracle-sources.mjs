import {executionEngineOracleSources} from './execution-engine-oracle-sources.mjs';
const extra=[
  ...['consensus_chain','replay','consensus_store'].map(name=>`lib/execution/${name}.ml`),
  ...['address_book','batch_store','chain_spec','checkpoint','subscriber','outcome','driver'].map(name=>`lib/driver/${name}.ml`),
];
export const driverOracleSources={
  ...executionEngineOracleSources,
  sources:[...executionEngineOracleSources.sources,...extra],
  modules:[...executionEngineOracleSources.modules,...extra.map(path=>path.split('/').at(-1)),'tn_engine.ml'],
  extraAliases:{...executionEngineOracleSources.extraAliases,
    'tn_engine.ml':['Block_number','Anchor','Recent_hashes','Config','Executed_block','Engine'],
    'tn_execution.ml':['Consensus_block','Consensus_chain','Replay','Consensus_store']},
};
