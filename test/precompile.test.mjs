import test from 'node:test';
import { harness } from './harness.mjs';
import { evmOracleSources } from './evm-oracle-sources.mjs';
import { byteAdapter } from '../runtime.mjs';
import { precompileVectors } from './precompile-vectors.mjs';
const h = await harness({ name: 'precompile', ...evmOracleSources, oracle: 'test/precompile-oracle.ml',
  fixtures: ['test/precompile-bn254.kan', 'test/precompile.kan'],
  exports: ['precompileTestInvoke', 'precompileTestKind', 'precompileTestGas', 'precompileTestOutput'] });
const { fromBytes } = byteAdapter(h.e);
const address = n => BigInt(n).toString(16).padStart(40, '0');
const evaluate = ([target, gas, input]) => {
  const result = h.e.precompileTestInvoke(h.raw(target), h.raw(input), h.toBytes(gas));
  const kind = h.e.precompileTestKind(result);
  return kind === 0 ? 'not-precompile' : kind === 2 ? 'rejected' :
    's:' + h.e.precompileTestGas(result) + ':' + fromBytes(h.e.precompileTestOutput(result)).toString('hex');
};
test('Precompile dispatch selects all nine implementations and preserves each gas boundary', () => {
  const rows = precompileVectors.flatMap(vector => [-1, vector.gas - 1, vector.gas, vector.gas + 1]
    .map(gas => [address(vector.address), String(gas), vector.input]));
  h.compare(rows, evaluate, { requireSuccess: true });
});
test('Precompile dispatch rejects address aliases across the full 160-bit domain', () => {
  const rows = [0n, 10n, 255n, 256n, 257n, 65537n, (1n << 62n) + 1n, (1n << 159n) + 1n, (1n << 160n) - 1n]
    .flatMap(target => [-1, 0, 1000000].map(gas => [address(target), String(gas), '616263']));
  h.compare(rows, evaluate, { requireSuccess: true });
});
