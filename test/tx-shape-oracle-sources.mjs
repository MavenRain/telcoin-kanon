import { evmOracleSources } from './evm-oracle-sources.mjs';
export const txShapeOracleSources = {
  ...evmOracleSources,
  sources: [...evmOracleSources.sources, 'lib/batch/tx_shape.ml'],
  modules: [...evmOracleSources.modules, 'tn_evm.ml', 'tx_shape.ml'],
  extraAliases: {...evmOracleSources.extraAliases, 'tn_evm.ml': ['Secp256k1', 'Public_key']},
};
