import test from 'node:test';
import { harness, protocolSources, protocolModules } from './harness.mjs';
const modules = ['spec', 'mutability', 'block_hashes', 'batch_position', 'gas_penalty', 'data', 'env'];
const h = await harness({ name: 'evm-env', sources: [...protocolSources, 'lib/state/u256.ml', 'lib/state/address_word.ml', ...modules.map(name => `lib/evm/${name}.ml`)],
  modules: [...protocolModules, 'u256.ml', 'address_word.ml', 'tn_state.ml', ...modules.map(name => `${name}.ml`)], extraAliases: { 'tn_state.ml': ['U256', 'Address_word'] },
  packages: 'digestif.c,zarith', oracle: 'test/evm-env-oracle.ml', fixtures: ['test/evm-core.kan', 'test/evm-env.kan'],
  exports: ['evm_test_penalty', 'evm_test_spec', 'evm_test_position', 'evm_test_position_word', 'evm_test_hashes', 'evm_test_env'] });
const maxInt = (1n << 62n) - 1n;
const word = n => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0');
function evaluate([kind, ...args]) {
  const types = { penalty: 'tt', spec: 'nnn', position: 'tn', position_word: 't', hashes: 'ntt', env: 'nnn' }[kind];
  return h.text(h.e[`evm_test_${kind}`](...args.map((v, i) => types[i] === 'n' ? Number(v) : h.toBytes(v))));
}
test('Gas penalty preserves fixed-point rounding at the limit and ten percent boundaries', () => {
  h.compare([-1n, 0n, 210000n, 210001n, 1000000n, maxInt].flatMap(limit =>
    [-1n, 0n, 1n, limit / 10n - 1n, limit / 10n, limit / 10n + 1n, limit, maxInt].map(spent => ['penalty', String(limit), String(spent)])), evaluate, { requireSuccess: true });
});
test('Fork ordering and static mutability produce explicit permissions', () => {
  h.compare([0, 1, 2].flatMap(a => [0, 1, 2].flatMap(b => [0, 1].map(m => ['spec', String(a), String(b), String(m)]))), evaluate, { requireSuccess: true });
});
test('Batch positions retain packed worker bits and reject machine integer overflow', () => {
  h.compare([-1n, 0n, 1n, 70368744177663n, 70368744177664n, maxInt].flatMap(index => [0, 1, 65535].map(worker => ['position', String(index), String(worker)])), evaluate, { requireSuccess: true });
  h.compare([0n, 65535n, 65536n, maxInt, maxInt + 1n, 1n << 255n].map(value => ['position_word', word(value)]), evaluate, { requireSuccess: true });
});
test('BLOCKHASH limits history to 256 ancestors without narrowing U256 block numbers', () => {
  h.compare([0, 1, 255, 256, 257].flatMap(count => [0n, 300n, 1n << 255n].flatMap(current =>
    [-1n, 0n, 1n, 2n, 255n, 256n, 257n].map(delta => ['hashes', String(count), word(current), word(current - delta)]))), evaluate, { requireSuccess: true });
});
test('Environments preserve ordered duplicate access entries and isolate child-call replacement', () => {
  h.compare([0, 1, 2].flatMap(spec => [0, 1].flatMap(mode => [0, 1].map(changed => ['env', String(spec), String(mode), String(changed)]))), evaluate, { requireSuccess: true });
});
