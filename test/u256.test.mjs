import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, u64 } from './harness.mjs';
const h = await harness({ name: 'u256', sources: ['lib/state/u256.ml'], modules: ['u256.ml'], oracle: 'test/u256-oracle.ml',
  fixtures: ['test/u256.kan'], exports: ['u256_test_op', 'u256_test_int', 'u256_test_word', 'u256_test_bytes', 'u256_test_bits'] });
const modulus = 1n << 256n;
const max = modulus - 1n;
const hex = n => n.toString(16).padStart(64, '0');
function evaluate([kind, ...args]) {
  if (kind === 'op') return h.text(h.e.u256_test_op(Number(args[0]), ...args.slice(1).map(h.toBytes)));
  if (kind === 'bytes') return h.text(h.e.u256_test_bytes(h.raw(args[0])));
  if (kind === 'bits') return h.text(h.e.u256_test_bits(h.raw(u64(BigInt.asUintN(64, BigInt(args[0]))))));
  return h.text(h.e[`u256_test_${kind}`](h.toBytes(args[0])));
}
const op = (kind, a, b, n = 0n) => ['op', String(kind), hex(a), hex(b), hex(n)];
test('U256 arithmetic matches OCaml and independent BigInt across full-width carries and borrows', () => {
  let state = 823451n;
  const values = [0n, 1n, 255n, 256n, (1n << 64n) - 1n, 1n << 128n, 1n << 255n, max];
  for (let i = 0; i < 12; i++) { state = (state * 6364136223846793005n + 1442695040888963407n) & max; values.push(state); }
  const pairs = values.map((a, i) => [a, values[(i * 7 + 3) % values.length]]);
  h.compare(pairs.flatMap(([a, b]) => Array.from({ length: 9 }, (_, kind) => op(kind, a, b, values[(Number(a & 255n) + 5) % values.length]))), evaluate, { requireSuccess: true });
  for (const [a, b] of pairs) {
    assert.equal(evaluate(op(0, a, b)), hex((a + b) & max));
    assert.equal(evaluate(op(1, a, b)), hex((a - b) & max));
    assert.equal(evaluate(op(4, a, b)), hex((a * b) & max));
    assert.equal(evaluate(op(5, a, b)), b ? hex(a / b) : 'none');
  }
});
test('U256 shifts, bitwise logic and exponentiation keep all 256 bits', () => {
  h.compare([0n, 1n, 255n, 256n, 1n << 255n, max].flatMap(a => [0n, 1n, 8n, 255n, 256n, max].flatMap(b =>
    [10, 11, 12, 13, 14, 15].map(kind => op(kind, a, b)))), evaluate, { requireSuccess: true });
  h.compare([0n, 1n, 2n, 7n, max].flatMap(a => [0n, 1n, 2n, 257n, max].map(b => op(9, a, b))), evaluate, { requireSuccess: true });
});
test('U256 byte and hex constructors, host integer bounds and raw u64 bits match OCaml', () => {
  h.compare([-4611686018427387904n, -257n, -256n, -1n, 0n, 1n, 255n, 256n, 4611686018427387903n].map(n => ['int', String(n)]), evaluate, { requireSuccess: true });
  h.compare([0n, 1n, 4611686018427387903n, 4611686018427387904n, max].flatMap(n => [['word', hex(n)], ['word', hex(n).toUpperCase()]]), evaluate);
  h.compare(['00', '00'.repeat(31), '00'.repeat(33), '0x' + hex(1n), hex(0n).slice(0, -1) + 'z'].map(raw => ['word', raw]), evaluate);
  h.compare([0, 1, 31, 32, 33].map(n => ['bytes', 'ab'.repeat(n)]), evaluate);
  h.compare([-9223372036854775808n, -1n, 0n, 9223372036854775807n].map(n => ['bits', String(n)]), evaluate);
});
