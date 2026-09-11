import test from 'node:test';
import { harness, protocolSources, protocolModules } from './harness.mjs';
const modules = ['depth', 'topic_count', 'opcode', 'stack', 'memory', 'access', 'sstore_state', 'refund', 'gas'];
const h = await harness({ name: 'evm-core', sources: [...protocolSources, 'lib/state/u256.ml', ...modules.map(name => `lib/evm/${name}.ml`)],
  modules: [...protocolModules, 'u256.ml', 'tn_state.ml', ...modules.map(name => `${name}.ml`)], extraAliases: { 'tn_state.ml': ['U256'] },
  oracle: 'test/evm-core-oracle.ml', fixtures: ['test/evm-core.kan'], exports: ['evm_test_stack', 'evm_test_extent', 'evm_test_memory', 'evm_test_costs', 'evm_test_static', 'evm_test_sstore', 'evm_test_call', 'evm_test_access'] });
const word = n => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0');
const address = n => BigInt(n).toString(16).padStart(40, '0');
const maxInt = (1n << 62n) - 1n;
function evaluate([kind, ...args]) {
  const types = { stack: 'nnn', extent: 'tt', memory: 'tttb', costs: 'ttn', static: 'n', sstore: 'tttn', call: 'tttnnn', access: 'bbtn' }[kind];
  return h.text(h.e[`evm_test_${kind}`](...args.map((value, i) => types[i] === 'n' ? Number(value) : types[i] === 'b' ? h.raw(value) : h.toBytes(value))));
}
test('Stack push, atomic pops, DUP and SWAP match at empty and 1024-word limits', () => {
  h.compare([0, 1, 2, 3, 15, 16, 17, 1023, 1024, 1025].flatMap(count => [0, 1, 2, 3, 4].map(op => ['stack', String(count), String(op), '1'])), evaluate, { requireSuccess: true });
  h.compare([0, 1, 15, 16, 17, 1024].flatMap(count => [0, 1, 2, 15, 16, 17].flatMap(depth => [5, 6].map(op => ['stack', String(count), String(op), String(depth)]))), evaluate, { requireSuccess: true });
});
test('Sparse memory preserves zero erasure, paid extent, big-endian words and signed index wrapping', () => {
  h.compare([-33n, -1n, 0n, 31n, 32n, 4294967295n, maxInt - 15n].flatMap(offset => [0n, -1n, 0x123456n].map(value =>
    ['memory', String(offset), word(value), String(value), 'ff00000100aabb'])), evaluate, { requireSuccess: true });
});
test('Memory extent checks zero lengths before offset validity and enforce the four GiB boundary', () => {
  h.compare([-1n, 0n, 1n, 31n, 32n, 4294967295n, 4294967296n, maxInt].flatMap(offset =>
    [-1n, 0n, 1n, 31n, 32n, 33n, 4294967296n, maxInt].map(length => ['extent', String(offset), String(length)])), evaluate, { requireSuccess: true });
});
test('Gas costs and refund accumulation preserve overflow checks and machine integer wraparound', () => {
  const values = [-maxInt - 1n, -1n, 0n, 1n, 31n, 32n, 33n, 511n, 512n, 513n, 134217728n, 40000000000n, 50000000000n, maxInt / 8n, maxInt / 8n + 1n, maxInt];
  h.compare(values.flatMap((n, i) => [0n, 1n, n, maxInt].map(m => ['costs', String(n), String(m), String(i % 5)])), evaluate, { requireSuccess: true });
  h.compare([['costs', '0', '0', '5']], evaluate, { requireSuccess: true });
  h.compare(Array.from({ length: 257 }, (_, byte) => ['static', String(byte)]), evaluate, { requireSuccess: true });
});
test('Storage gas distinguishes unchanged, dirty, fresh, cleared and restored slots', () => {
  h.compare([0n, 1n, 2n, 1n << 255n].flatMap(a => [0n, 1n, 2n].flatMap(b => [0n, 1n, 2n, a].flatMap(c => [0, 1].map(cold =>
    ['sstore', word(a), word(b), word(c), String(cold)])))), evaluate, { requireSuccess: true });
});
test('Call gas applies the 63/64 cap, uncharged stipend and SSTORE reentrancy sentry', () => {
  h.compare([-1n, 0n, 63n, 64n, 2300n, 2301n, 64000n, maxInt].flatMap(remaining => [0n, 1n, 64000n, 1n << 255n].flatMap((requested, i) => [0n, 1n].map(value =>
    ['call', String(remaining), word(requested), word(value), String(i % 2), String(i % 2), String(i > 1 ? 1 : 0)]))), evaluate, { requireSuccess: true });
});
test('Account and storage warmth remain independent and storage keys include the contract address', () => {
  h.compare([0, 1, 2, 3].flatMap(prewarm => [1, 2].flatMap(other => [0n, 1n, 1n << 255n].map(slot =>
    ['access', address(1), address(other), word(slot), String(prewarm)]))), evaluate, { requireSuccess: true });
});
