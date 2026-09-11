import test from 'node:test';
import { harness, protocolSources, protocolModules } from './harness.mjs';
const modules = ['depth', 'topic_count', 'stack', 'hex', 'log', 'log_journal', 'return_data'];
const h = await harness({ name: 'evm-logs', sources: [...protocolSources, 'lib/state/u256.ml', ...modules.map(name => `lib/evm/${name}.ml`)],
  modules: [...protocolModules, 'u256.ml', 'tn_state.ml', ...modules.map(name => `${name}.ml`)], extraAliases: { 'tn_state.ml': ['U256'] },
  oracle: 'test/evm-logs-oracle.ml', fixtures: ['test/evm-core.kan', 'test/evm-logs.kan'], exports: ['evm_test_logs', 'evm_test_return'] });
const evaluate = ([kind, a, b, c, d]) => kind === 'logs' ? h.text(h.e.evm_test_logs(Number(a), Number(b), h.raw(c), h.raw(d))) :
  h.text(h.e.evm_test_return(h.raw(a), h.toBytes(b), h.toBytes(c)));
test('Log topics collect atomically and journals preserve emission order and exact rendering', () => {
  h.compare([0, 1, 2, 3, 4, 5].flatMap(available => [0, 1, 2, 3, 4, 5].map(count =>
    ['logs', String(available), String(count), '12'.repeat(20), count % 2 ? '00ff12' : ''])), evaluate, { requireSuccess: true });
});
test('Return-data copies enforce exact bounds, including empty windows beyond the buffer', () => {
  h.compare(['', '00', 'aabbcc'].flatMap(raw => [0n, 1n, 2n, 3n, 4n, (1n << 62n) - 1n].flatMap(offset =>
    [0n, 1n, 3n, (1n << 62n) - 1n].map(length => ['return', raw, String(offset), String(length)]))), evaluate, { requireSuccess: true });
});
