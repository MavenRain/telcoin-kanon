import test from 'node:test';
import { harness } from './harness.mjs';
import { evmOracleSources } from './evm-oracle-sources.mjs';
const h = await harness({ name: 'block-context', ...evmOracleSources, oracle: 'test/block-context-oracle.ml',
  fixtures: ['test/evm-core.kan', 'test/evm-env.kan', 'test/block-context.kan'], exports: ['evm_test_boundary', 'evm_test_context'] });
const maxInt = (1n << 62n) - 1n;
const word = n => BigInt(n).toString(16).padStart(64, '0');
const evaluate = ([kind, ...args]) => h.text(kind === 'boundary' ? h.e.evm_test_boundary(h.raw(args[0]), Number(args[1])) :
  h.e.evm_test_context(h.toBytes(args[0]), h.toBytes(args[1]), h.toBytes(args[2]), Number(args[3]), h.toBytes(args[4])));
test('Epoch boundaries reject withdrawals without closing metadata and commit exact randomness and order', () => {
  h.compare(['', '00', '00'.repeat(31), '00'.repeat(32), 'ff'.repeat(32), '00'.repeat(33)].flatMap(extra => [0, 1, 3].map(count => ['boundary', extra, String(count)])), evaluate, { requireSuccess: true });
});
test('Block context narrows fields in order before enforcing the genesis consensus root', () => {
  h.compare([0n, 1n, maxInt, maxInt + 1n].flatMap(number => [0n, maxInt, maxInt + 1n].flatMap(time => [0n, maxInt, 1n << 255n].flatMap(gas => [0, 1].flatMap(root =>
    [0n, 65535n, 65536n].map(position => ['context', word(number), word(time), word(gas), String(root), word(position)]))))), evaluate, { requireSuccess: true });
});
