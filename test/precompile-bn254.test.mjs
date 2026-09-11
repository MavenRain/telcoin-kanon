import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './harness.mjs';
import { evmOracleSources } from './evm-oracle-sources.mjs';
import { byteAdapter } from '../runtime.mjs';
const h = await harness({ name: 'precompile-bn254', ...evmOracleSources,
  sources: [...evmOracleSources.sources, 'test/bn254_vectors.ml'], modules: [...evmOracleSources.modules, 'bn254_vectors.ml'],
  oracle: 'test/precompile-bn254-oracle.ml', fixtures: ['test/precompile-bn254.kan'],
  exports: ['precompileTestBn', 'precompileTestKind', 'precompileTestGas', 'precompileTestOutput'] });
const { fromBytes } = byteAdapter(h.e);
const evaluate = ([address, gas, input]) => {
  const result = h.e.precompileTestBn(Number(address), h.raw(input), h.toBytes(gas));
  const kind = h.e.precompileTestKind(result);
  return kind === 0 ? 'not-precompile' : kind === 2 ? 'rejected' : `s:${h.e.precompileTestGas(result)}:${fromBytes(h.e.precompileTestOutput(result)).toString('hex')}`;
};
const generated = h.runOracle(['goldens']); assert.equal(generated.status, 0, generated.stderr);
const goldens = generated.stdout.trim().split('\n').map(line => line.split(' ')); assert.equal(goldens.length, 28);
test('Pairing validates the G2 subgroup even when its G1 partner is infinity', () => {
  const golden = goldens.find(([name]) => name.includes('subgroup'));
  assert.ok(golden, 'The pinned corpus must contain the wrong-subgroup vector');
  const input = golden[3]; assert.equal(input.length, 384);
  const rows = [78999, 79000, 1000000].map(gas => ['8', String(gas), '00'.repeat(64) + input.slice(128)]);
  h.compare(rows, row => { const actual = evaluate(row); assert.equal(actual, 'rejected'); return actual; }, { requireSuccess: true });
});
for (const [name, address, gas, input, expected] of goldens) test(`BN254 upstream precompile golden: ${name}`, () => {
  const row = [address, gas, input];
  h.compare([row], row => { const actual = evaluate(row); assert.equal(actual, expected, name); return actual; }, { requireSuccess: true });
});
test('BN254 precompile gas boundaries precede padding and point validation', () => {
  const rows = [6, 7, 8].flatMap(address => [-1, 0, 149, 150, 5999, 6000, 44999, 45000, 78999, 79000].flatMap(gas =>
    ['', 'ff', '00'.repeat(192), 'ff'.repeat(193)].map(input => [String(address), String(gas), input])));
  h.compare(rows, evaluate, { requireSuccess: true });
});
test('Identity precompile preserves bytes and word-rounded gas charges', () => {
  const rows = [0, 1, 31, 32, 33, 63, 64, 65, 1024].flatMap(length => {
    const input = Buffer.from(Array.from({ length }, (_, i) => (i * 73 + 1) % 256)).toString('hex');
    const cost = 15 + 3 * Math.ceil(length / 32);
    return [cost - 1, cost, cost + 1].map(gas => ['4', String(gas), input]);
  });
  h.compare(rows, evaluate, { requireSuccess: true });
});
