import test from 'node:test';
import { harness, protocolSources, protocolModules } from './harness.mjs';
const modules = ['depth', 'topic_count', 'opcode', 'data', 'code', 'transient'];
const h = await harness({ name: 'evm-data', sources: [...protocolSources, 'lib/state/u256.ml', ...modules.map(name => `lib/evm/${name}.ml`)],
  modules: [...protocolModules, 'u256.ml', 'tn_state.ml', ...modules.map(name => `${name}.ml`)], extraAliases: { 'tn_state.ml': ['U256'] },
  oracle: 'test/evm-data-oracle.ml', fixtures: ['test/evm-core.kan', 'test/evm-data.kan'], exports: ['evm_test_data', 'evm_test_transient'] });
const word = n => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0');
const address = n => BigInt(n).toString(16).padStart(40, '0');
const evaluate = ([kind, a, b, c, d]) => kind === 'data' ? h.text(h.e.evm_test_data(h.raw(a), h.toBytes(b), Number(c), h.toBytes(d))) :
  h.text(h.e.evm_test_transient(h.raw(a), h.raw(b), h.toBytes(c), h.toBytes(d)));
test('Code analysis skips PUSH payloads, accepts only instruction JUMPDESTs and zero-extends truncated data', () => {
  const programs = ['', '5b', '605b5b', '615b005bfe5b', '7f5b', ...Array.from({ length: 32 }, (_, i) => (96 + i).toString(16) + '5b'.repeat(i + 1) + '5b')];
  h.compare(programs.flatMap(raw => [-1n, 0n, 1n, BigInt(raw.length / 2), 1n << 255n].map((offset, i) =>
    ['data', raw, word(offset), String(i * 8), String(i === 0 ? -1 : i === 3 ? raw.length / 2 - 1 : i)])), evaluate, { requireSuccess: true });
});
test('Transient storage isolates contract addresses and removes zero-valued entries canonically', () => {
  h.compare([1, 2].flatMap(b => [0n, 1n, 1n << 255n].flatMap(slot => [0n, 1n, -1n].map(value =>
    ['transient', address(1), address(b), word(slot), word(value)]))), evaluate, { requireSuccess: true });
});
