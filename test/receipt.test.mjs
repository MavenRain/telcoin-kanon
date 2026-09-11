import test from 'node:test';
import { harness } from './harness.mjs';
import { evmOracleSources } from './evm-oracle-sources.mjs';
const h = await harness({ name: 'receipt', ...evmOracleSources, oracle: 'test/receipt-oracle.ml',
  fixtures: ['test/evm-core.kan', 'test/evm-env.kan', 'test/receipt.kan'], exports: ['evm_test_receipt', 'evm_test_block_meter'] });
const maxInt = (1n << 62n) - 1n;
function evaluate([kind, ...args]) {
  const types = { receipt: 'ntttnb', block_meter: 'ttt' }[kind];
  return h.text(h.e[`evm_test_${kind}`](...args.map((v, i) => types[i] === 'n' ? Number(v) : types[i] === 'b' ? h.raw(v) : h.toBytes(v))));
}
test('Receipt envelopes commit success status, cumulative gas and successful logs with fixed-width topics', () => {
  h.compare([0, 1, 2].flatMap(status => [0, 1, 2, 4].flatMap(type => [0, 1, 2].map(count =>
    ['receipt', String(status), '21000', count ? '21128' : '0', String(type), String(count), count ? '00ff' : '']))), evaluate, { requireSuccess: true });
  h.compare([0, 1].flatMap(status => [-1n, maxInt].map(used => ['receipt', String(status), String(used), String(used), '2', '0', ''])), evaluate, { requireSuccess: true });
});
test('Block gas accounting charges net receipt gas, preserves rejected states and matches machine arithmetic', () => {
  h.compare([0n, 21000n, maxInt].flatMap(limit => [0n, 1n, 21000n, maxInt].flatMap(first => [0n, 1n, 21001n, maxInt].map(second =>
    ['block_meter', String(limit), String(first), String(second)]))), evaluate, { requireSuccess: true });
});
