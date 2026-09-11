import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './harness.mjs';
import { evmOracleSources } from './evm-oracle-sources.mjs';
import { byteAdapter } from '../runtime.mjs';
const h = await harness({ name: 'precompile-ecrecover', ...evmOracleSources,
  oracle: 'test/precompile-ecrecover-oracle.ml', fixtures: ['test/precompile-bn254.kan', 'test/precompile-ecrecover.kan'],
  exports: ['precompileTestEcrecover', 'precompileTestKind', 'precompileTestGas', 'precompileTestOutput'] });
const { fromBytes } = byteAdapter(h.e);
const evaluate = ([gas, input]) => {
  const result = h.e.precompileTestEcrecover(h.raw(input), h.toBytes(gas));
  return h.e.precompileTestKind(result) === 2 ? 'rejected' : `s:${h.e.precompileTestGas(result)}:${fromBytes(h.e.precompileTestOutput(result)).toString('hex')}`;
};
const generated = h.runOracle(['vectors']); assert.equal(generated.status, 0, generated.stderr);
const vectors = generated.stdout.trim().split('\n'); assert.equal(vectors.length, 4); assert.ok(vectors.every(bytes => /^[0-9a-f]{256}$/.test(bytes)));
const be = n => n.toString(16).padStart(64, '0');
test('ECRECOVER matches OCaml-generated signatures, address derivation and trailing-byte truncation', () => {
  h.compare(vectors.flatMap(input => [['3000', input], ['3001', input + 'ff'.repeat(64)]]), evaluate, { requireSuccess: true });
  assert.equal(evaluate(['3000', vectors[0]]), 's:3000:' + '00'.repeat(12) + '7e5f4552091a69125d5dfcb7b8c2659029395bdf');
});
test('ECRECOVER malformed recovery words and scalars succeed with empty output after the gas gate', () => {
  const n = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
  const invalidV = [0n, 1n, 26n, 29n, 255n, (1n << 248n) + 27n].map(v => vectors[0].slice(0, 64) + be(v) + vectors[0].slice(128));
  const invalidScalars = [0n, n, n + 1n].flatMap(value => [vectors[0].slice(0, 128) + be(value) + vectors[0].slice(192), vectors[0].slice(0, 192) + be(value)]);
  h.compare([...invalidV, ...invalidScalars, ...[0, 31, 32, 63, 64, 96, 127].map(length => vectors[0].slice(0, length * 2))]
    .flatMap(input => [['2999', input], ['3000', input]]), evaluate, { requireSuccess: true });
});
