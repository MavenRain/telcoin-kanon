import { evmOracleSources } from './evm-oracle-sources.mjs';
const modules = ['auth_list', 'tx_recovery', 'system_contracts', 'gas_penalty', 'executor'];
export const executorOracleSources = {
  ...evmOracleSources,
  sources: [...evmOracleSources.sources, ...modules.map(name => `lib/evm/${name}.ml`)],
  modules: [...evmOracleSources.modules, ...modules.map(name => `${name}.ml`)],
};
