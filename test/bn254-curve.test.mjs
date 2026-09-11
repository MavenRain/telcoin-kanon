import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './harness.mjs';
const h = await harness({ name: 'bn254-curve',
  sources: ['lib/evm/bn254_field.ml', 'lib/evm/bn254_curve.ml', 'lib/evm/bn254_pairing.ml', 'lib/evm/secp256k1.ml'],
  modules: ['bn254_field.ml', 'bn254_curve.ml', 'bn254_pairing.ml', 'secp256k1.ml'], packages: 'zarith',
  oracle: 'test/bn254-curve-oracle.ml', fixtures: ['test/bn254.kan', 'test/bn254-curve.kan'],
  exports: ['evm_test_bn_curve', 'evm_test_bn_pair', 'bnTestPairText', 'evm_test_bn_check'] });
const p = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const order = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const be = value => value.toString(16).padStart(64, '0');
const generated = h.runOracle(['vectors']); assert.equal(generated.status, 0, generated.stderr);
const vectors = generated.stdout.trim().split('\n').map(line => line.split(' ')); assert.equal(vectors.length, 10);
const point = (group, scalar) => vectors.find(row => row[0] === group && row[1] === String(scalar))[2];
const evaluate = row => {
  if (row[0] === 'check') return h.text(h.e.evm_test_bn_check(h.raw(row[1])));
  if (row[0] === 'pair') return h.text(h.e.bnTestPairText(h.e.evm_test_bn_pair(row[1] === 'miller' ? 0 : 1, h.raw(row[2]), h.raw(row[3]))));
  return h.text(h.e.evm_test_bn_curve(row[0] === 'g1' ? 1 : 2, ['decode', 'neg', 'double', 'add', 'mul'].indexOf(row[1]), h.raw(row[2]), h.raw(row[3])));
};
for (const group of ['g1', 'g2']) test(`BN254 ${group} decoding and group operations match actual OCaml multiples`, () => {
  const rows = [0, 1, 2, 7].flatMap(k => ['decode', 'neg', 'double'].map(op => [group, op, point(group, k), '']));
  rows.push(...[0, 1, 2, 3].map(k => [group, 'add', point(group, 1), point(group, k)]));
  rows.push(...[0n, 1n, 2n, 7n, order, order + 1n, (1n << 256n) - 1n].map(k => [group, 'mul', point(group, 3), be(k)]));
  const size = group === 'g1' ? 64 : 128;
  rows.push(...['', '00'.repeat(size - 1), '00'.repeat(size + 1), be(p) + '00'.repeat(size - 32), '00'.repeat(size - 1) + '01']
    .map(bytes => [group, 'decode', bytes, '']));
  h.compare(rows, evaluate, { requireSuccess: true });
});
test('BN254 Miller loops and final pairing values match OCaml', () => {
  for (const [a, b] of [[0, 1], [1, 0], [1, 1], [2, 3]]) {
    h.compare(['miller', 'final'].map(op => ['pair', op, point('g1', a), point('g2', b)]), evaluate, { requireSuccess: true });
  }
});
test('BN254 pairing products preserve cancellation, nonidentity and invalid point rejection', () => {
  const g1 = point('g1', 1), g2 = point('g2', 1);
  const negG1 = g1.slice(0, 64) + be(p - BigInt('0x' + g1.slice(64)));
  const data = ['', g1 + g2, g1 + g2 + negG1 + g2, point('g1', 0) + g2, g1 + point('g2', 0),
    g1 + g2 + point('g1', 2) + point('g2', 3), '00', point('g1', 0) + be(p) + '00'.repeat(96)];
  for (const bytes of data) h.compare([['check', bytes]], evaluate, { requireSuccess: true });
});
