import test from 'node:test';
import { harness, protocolSources, protocolModules } from './harness.mjs';
const state = ['u256', 'nonce', 'bytecode', 'delegation', 'storage', 'account', 'genesis_account', 'world_state', 'address_word'];
const modules = ['depth', 'topic_count', 'opcode', 'access', 'sstore_state', 'refund', 'gas', 'hex', 'log', 'log_journal', 'transient', 'spec', 'mutability', 'lifecycle', 'destruction', 'effects'];
const h = await harness({ name: 'evm-effects', sources: [...protocolSources, ...state.map(name => `lib/state/${name}.ml`), ...modules.map(name => `lib/evm/${name}.ml`)],
  modules: [...protocolModules, ...state.map(name => `${name}.ml`), 'tn_state.ml', ...modules.map(name => `${name}.ml`)],
  extraAliases: { 'tn_state.ml': state.map(name => name[0].toUpperCase() + name.slice(1)) },
  oracle: 'test/evm-effects-oracle.ml', fixtures: ['test/evm-core.kan', 'test/evm-env.kan', 'test/evm-effects.kan'],
  exports: ['evm_test_effects_store', 'evm_test_effects_transfer', 'evm_test_effects_creation', 'evm_test_effects_destruction', 'evm_test_effects_reads'] });
const max = (1n << 256n) - 1n;
const word = n => BigInt(n).toString(16).padStart(64, '0');
function evaluate([kind, ...args]) {
  const types = { store: 'tttn', transfer: 'tttnn', creation: 'ttt', destruction: 'ttnnn', reads: 'nn' }[kind];
  return h.text(h.e[`evm_test_effects_${kind}`](...args.map((v, i) => types[i] === 'n' ? Number(v) : h.toBytes(v))));
}
test('Storage plans retain transaction-original values and commit refunds only after admission', () => {
  h.compare([0n, 1n, max].flatMap(original => [0n, 1n, 2n].flatMap(next => [0n, 1n, next].flatMap(last => [0, 1].map(created =>
    ['store', word(original), word(next), word(last), String(created)])))), evaluate, { requireSuccess: true });
});
test('Effect transfers remain atomic on insufficient funds and recipient overflow, including self transfers', () => {
  h.compare([0n, 2n, max].flatMap(a => [0n, 2n, max].flatMap(b => [0n, 1n, 3n, max].flatMap(value => [0, 1].flatMap(self => [0, 1].map(high =>
    ['transfer', word(a), word(b), word(value), String(self), String(high)]))))), evaluate, { requireSuccess: true });
});
test('Creation clears inherited storage, preserves prefunding, increments nonce and installs code', () => {
  h.compare([0n, 2n, max].flatMap(a => [0n, 2n, max].flatMap(b => [0n, 1n, 3n, max].map(value => ['creation', word(a), word(b), word(value)]))), evaluate, { requireSuccess: true });
});
test('SELFDESTRUCT applies fork and creation rules while deferring removal until transaction completion', () => {
  h.compare([0n, 2n, max].flatMap(a => [0n, 2n, max].flatMap(b => [0, 1, 2].flatMap(fork => [0, 1].flatMap(created => [0, 1].map(self =>
    ['destruction', word(a), word(b), String(fork), String(created), String(self)]))))), evaluate, { requireSuccess: true });
});
test('Effect reads preserve values and account or slot warmth witnesses across immutable snapshots', () => {
  h.compare([0, 1].flatMap(prewarm => [0, 1].map(self => ['reads', String(prewarm), String(self)])), evaluate, { requireSuccess: true });
});
