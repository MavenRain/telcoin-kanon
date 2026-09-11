import test from 'node:test';
import { harness, protocolSources, protocolModules } from './harness.mjs';
const state = ['u256', 'nonce', 'bytecode', 'delegation', 'storage', 'account', 'genesis_account', 'world_state', 'address_word'];
const modules = ['depth', 'topic_count', 'opcode', 'access', 'sstore_state', 'refund', 'gas', 'hex', 'log', 'log_journal', 'transient', 'spec', 'mutability', 'lifecycle', 'destruction', 'effects',
  'data', 'code', 'call_depth', 'call_target', 'contract_address', 'intrinsic', 'fork_schedule', 'eip2718'];
const h = await harness({ name: 'execution-primitives', sources: [...protocolSources, ...state.map(name => `lib/state/${name}.ml`), ...modules.map(name => `lib/evm/${name}.ml`)],
  modules: [...protocolModules, ...state.map(name => `${name}.ml`), 'tn_state.ml', ...modules.map(name => `${name}.ml`)],
  extraAliases: { 'tn_state.ml': state.map(name => name[0].toUpperCase() + name.slice(1)) },
  oracle: 'test/execution-primitives-oracle.ml', fixtures: ['test/evm-core.kan', 'test/evm-env.kan', 'test/evm-effects.kan', 'test/execution-primitives.kan'],
  exports: ['evm_test_schedule', 'evm_test_contract_address', 'evm_test_intrinsic', 'evm_test_call_target', 'evm_test_depth', 'evm_test_frame'] });
const maxInt = (1n << 62n) - 1n;
const word = n => BigInt(n).toString(16).padStart(64, '0');
const address = n => BigInt(n).toString(16).padStart(40, '0');
function evaluate([kind, ...args]) {
  const types = { schedule: 'nnnn', contract_address: 'bttbn', intrinsic: 'nbnnnt', call_target: 'bbn', depth: 'n', frame: 'tb' }[kind];
  return h.text(h.e[`evm_test_${kind}`](...args.map((v, i) => types[i] === 'n' ? Number(v) : types[i] === 'b' ? h.raw(v) : h.toBytes(v))));
}
test('Fork schedules reject nonmonotone activations and select the new fork at the exact timestamp', () => {
  h.compare([0, 10].flatMap(s => [0, 1, 11, 21].flatMap(c => [0, 1, 11, 21].flatMap(p => [0, 9, 10, 19, 20, 21].map(time =>
    ['schedule', String(s), String(c), String(p), String(time)])))), evaluate, { requireSuccess: true });
});
test('CREATE and CREATE2 derive addresses with minimal nonce RLP and the full salt and initcode hash', () => {
  h.compare([0, 1, 12345].flatMap(creator => [0n, 1n, 127n, 128n, 255n, 256n, maxInt].flatMap(nonce => [0, 1].map(kind =>
    ['contract_address', address(creator), String(nonce), word(nonce), kind ? '60006000' : '', String(kind)]))), evaluate, { requireSuccess: true });
});
test('Intrinsic gas charges listed access and authorization entries and preserves machine integer word rounding', () => {
  h.compare([0, 1].flatMap(kind => ['', '00', 'ff', '00ff'.repeat(17)].flatMap(data => [0, 1, 2].flatMap(addresses => [0, 1, 2].flatMap(slots => [0, 1, 3].map(auths =>
    ['intrinsic', String(kind), data, String(addresses), String(slots), String(auths), String(data.length / 2)]))))), evaluate, { requireSuccess: true });
  h.compare([-1n, 0n, 31n, 32n, 33n, maxInt - 31n, maxInt - 30n, maxInt].map(length => ['intrinsic', '0', '', '0', '0', '0', String(length)]), evaluate, { requireSuccess: true });
});
test('Delegation follows exactly one hop, prices delegate warmth and preserves ordinary code effects', () => {
  h.compare(['', '6000', 'ef01', 'ef0100' + address(2), 'ef0101' + address(2)].flatMap(code => ['', '605b', 'ef0100' + address(3)].flatMap(delegate => [0, 1].map(warm =>
    ['call_target', code, delegate, String(warm)]))), evaluate, { requireSuccess: true });
});
test('Call depth accepts depth 1024 and EIP-2718 prefixes only nonzero types', () => {
  h.compare([0, 1, 1023, 1024, 1025].map(n => ['depth', String(n)]), evaluate, { requireSuccess: true });
  h.compare([-1n, 0n, 1n, 2n, 4n, 255n, 256n, maxInt].flatMap(n => ['', 'c0', '01ff'].map(body => ['frame', String(n), body])), evaluate, { requireSuccess: true });
});
