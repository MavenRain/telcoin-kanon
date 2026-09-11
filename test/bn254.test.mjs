import test from 'node:test';
import { harness } from './harness.mjs';
const h = await harness({ name: 'bn254-field',
  sources: ['lib/evm/bn254_field.ml', 'lib/evm/bn254_curve.ml', 'lib/evm/secp256k1.ml'],
  modules: ['bn254_field.ml', 'bn254_curve.ml', 'secp256k1.ml'], packages: 'zarith',
  oracle: 'test/bn254-oracle.ml', fixtures: ['test/bn254.kan'], exports: ['evm_test_bn_field', 'evm_test_bn_decode'] });
const p = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const be = value => value.toString(16).padStart(64, '0');
const words = values => values.map(be).join('');
const evaluate = row => row[0] === 'decode' ? h.text(h.e.evm_test_bn_decode(h.raw(row[1]))) :
  h.text(h.e.evm_test_bn_field(Number(row[1]), Number(row[2]), h.raw(row[3]), h.raw(row[4]), h.toBytes(row[5])));
for (const degree of [2, 6, 12]) test(`BN254 Fq${degree} arithmetic, inversion and Frobenius match OCaml`, () => {
  const vectors = [Array(degree).fill(0n), Array(degree).fill(p - 1n),
    Array.from({ length: degree }, (_, i) => BigInt(i + 1)),
    Array.from({ length: degree }, (_, i) => (p / BigInt(i + 2) + BigInt(i)) % p)];
  const rows = vectors.flatMap((a, i) => [0, 1, 2, 3, 6, 7].map(op =>
    ['field', String(degree), String(op), words(a), words(vectors[(i + 1) % vectors.length]), '0']));
  rows.push(...[-25n, -13n, -12n, -7n, -2n, -1n, ...Array.from({ length: 14 }, (_, i) => BigInt(i))]
    .map(k => ['field', String(degree), '5', words(vectors[3]), '', String(k)]));
  if (degree !== 6) rows.push(...[-1, 0, 1, 2, 7, 17].map(k => ['field', String(degree), '4', words(vectors[2]), '', String(k)]));
  if (degree === 12) rows.push(...[0, 1, 17].map(k => ['field', '12', '4', words(vectors[0]), '', String(k)]));
  h.compare(rows, evaluate, { requireSuccess: true });
});
test('BN254 Frobenius handles host-integer bounds using its field-degree period', () => {
  // OCaml reduces indices by repeated subtraction. Compare its small equivalent
  // index with Kanon's full host bound without asking OCaml to run 2^62 steps.
  for (const degree of [2, 6, 12]) for (const k of [-4611686018427387904n, 4611686018427387903n]) {
    const reduced = ((k % BigInt(degree)) + BigInt(degree)) % BigInt(degree);
    const row = ['field', String(degree), '5', words(Array.from({ length: degree }, (_, i) => p / BigInt(i + 2))), '', String(reduced)];
    h.compare([row], () => evaluate([...row.slice(0, 5), String(k)]), { requireSuccess: true });
  }
});
test('BN254 field decoder rejects noncanonical and incorrectly sized coordinates', () => {
  h.compare(['', '00'.repeat(31), '00'.repeat(33), ...[0n, 1n, p - 1n, p, p + 1n, (1n << 256n) - 1n].map(be)]
    .map(bytes => ['decode', bytes]), evaluate, { requireSuccess: true });
});
