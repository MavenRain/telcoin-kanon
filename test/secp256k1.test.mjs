import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './harness.mjs';
import { evmOracleSources } from './evm-oracle-sources.mjs';
const h = await harness({ name: 'secp256k1', ...evmOracleSources, oracle: 'test/secp256k1-oracle.ml', fixtures: ['test/secp256k1.kan'],
  exports: ['evm_test_modular256', 'evm_test_secp_recover', 'secpTestOptionalText', 'evm_test_secp_high'] });
const p = BigInt('0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f');
const n = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
const be = (value, length = 32) => value.toString(16).padStart(length * 2, '0');
const evaluate = ([mode, ...args]) => {
  if (mode === 'field') return h.text(h.e.evm_test_modular256(Number(args[0]), ...args.slice(1).map(h.raw)));
  if (mode === 'high') return String(h.e.evm_test_secp_high(h.raw(args[0])));
  return h.text(h.e.secpTestOptionalText(h.e.evm_test_secp_recover(h.raw(args[0]), h.toBytes(args[1]), h.raw(args[2]), h.raw(args[3]))));
};
test('Modular arithmetic preserves wide products, composite-modulus inverse rejection and arbitrary exponent bytes', () => {
  const rows = [96n, 97n, p, n].flatMap(modulus => [0n, 1n, 2n, modulus - 1n].flatMap(a => [0n, 1n, 3n, modulus - 1n].flatMap(b =>
    [0, 1, 2, 3, 4].map(op => ['field', String(op), be(modulus), be(a), be(b)]))));
  rows.push(...[p, n].map(modulus => ['field', '0', be(modulus), be((1n << 512n) - 1n, 64), '']));
  rows.push(...[0n, 1n, 255n, 65537n].map(exponent => ['field', '5', be(p), be(7n), be(exponent)]));
  h.compare(rows, evaluate, { requireSuccess: true });
});
test('Signature recovery matches actual OCaml-generated signatures and rejects invalid scalars', () => {
  const generated = h.runOracle(['vectors']);
  assert.equal(generated.status, 0, generated.stderr);
  const vectors = generated.stdout.trim().split('\n').map(line => line.split(' '));
  assert.equal(vectors.length, 4);
  assert.ok(vectors.every(row => row[0] === 'recover'));
  const malformed = [0n, n, n + 1n, (1n << 256n) - 1n].flatMap(value => [
    ['recover', be(0n), '0', be(value), be(1n)], ['recover', be(0n), '1', be(1n), be(value)],
  ]);
  h.compare([...vectors, ...malformed], evaluate, { requireSuccess: true });
});
test('High-S classification preserves arbitrary-width unsigned parsing', () => {
  h.compare([0n, n / 2n, n / 2n + 1n, n - 1n, n, 1n << 256n].map(value => ['high', be(value, value >> 256n ? 33 : 32)]), evaluate, { requireSuccess: true });
});
