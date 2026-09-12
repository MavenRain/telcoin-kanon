import {executorOracleSources} from './executor-oracle-sources.mjs';
const extra = ['system_call', 'registry_abi', 'committee_shuffle', 'epoch_close', 'block_execution', 'block_header'].map(n => `lib/evm/${n}.ml`)
  .concat(['chacha12', 'std_rng', 'rand_seq'].map(n => `lib/rand/${n}.ml`));
export const blockOracleSources = {
  ...executorOracleSources,
  sources: [...executorOracleSources.sources, ...extra],
  modules: [...executorOracleSources.modules, ...extra.map(p => p.split('/').at(-1)), 'tn_rand.ml'],
  extraAliases: {...executorOracleSources.extraAliases, 'tn_rand.ml': ['Std_rng', 'Rand_seq']},
};
