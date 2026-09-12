import {evmOracleSources} from './evm-oracle-sources.mjs';
const extra = ['lib/evm/registry_abi.ml', 'lib/evm/committee_shuffle.ml', ...['chacha12', 'std_rng', 'rand_seq'].map(n => `lib/rand/${n}.ml`)];
export const registryOracleSources = {
  ...evmOracleSources,
  sources: [...evmOracleSources.sources, ...extra],
  modules: [...evmOracleSources.modules, ...extra.map(p => p.split('/').at(-1)), 'tn_rand.ml'],
  extraAliases: {...evmOracleSources.extraAliases, 'tn_rand.ml': ['Std_rng', 'Rand_seq']},
};
