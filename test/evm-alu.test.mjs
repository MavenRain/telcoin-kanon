import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './harness.mjs';
const h = await harness({ name: 'evm-alu', sources: ['lib/state/u256.ml', 'lib/evm/depth.ml', 'lib/evm/topic_count.ml', 'lib/evm/opcode.ml', 'lib/evm/alu.ml'],
  modules: ['u256.ml', 'tn_state.ml', 'depth.ml', 'topic_count.ml', 'opcode.ml', 'alu.ml'], extraAliases: { 'tn_state.ml': ['U256'] },
  oracle: 'test/evm-alu-oracle.ml', fixtures: ['test/evm-alu.kan'], exports: ['evm_test_alu', 'evm_test_opcode', 'evm_test_enum'] });
const max = (1n << 256n) - 1n;
const sign = 1n << 255n;
const hex = n => BigInt.asUintN(256, n).toString(16).padStart(64, '0');
const row = (op, a, b = 0n, n = 0n) => ['alu', String(op), hex(a), hex(b), hex(n)];
const evaluate = ([kind, op, ...args]) => kind === 'enum' ? h.text(h.e.evm_test_enum(h.toBytes(op))) : kind === 'opcode' ? h.text(h.e.evm_test_opcode(Number(op))) :
  h.text(h.e.evm_test_alu(Number(op), ...args.map(h.toBytes)));
test('Every opcode byte preserves its name, encoding and immediate width', () => {
  h.compare(Array.from({ length: 258 }, (_, n) => ['opcode', String(n)]), evaluate, { requireSuccess: true });
  h.compare([-4611686018427387904n, -1n, 0n, 1n, 4n, 5n, 16n, 17n, 32n, 33n, 255n, 256n, 4611686018427387903n].map(n => ['enum', String(n)]), evaluate, { requireSuccess: true });
});
test('Signed EVM division, remainder and comparisons match OCaml at two-complement boundaries', () => {
  const values = [0n, 1n, 7n, sign - 1n, sign, sign + 1n, max - 6n, max];
  h.compare(values.flatMap(a => values.flatMap(b => [4, 5, 6, 7, 16, 17, 18, 19, 20].map(op => row(op, a, b)))), evaluate, { requireSuccess: true });
  for (const a of values) for (const b of values) {
    const sa = BigInt.asIntN(256, a), sb = BigInt.asIntN(256, b);
    assert.equal(evaluate(row(5, a, b)), hex(sb === 0n ? 0n : sa / sb));
    assert.equal(evaluate(row(7, a, b)), hex(sb === 0n ? 0n : sa % sb));
  }
});
test('EVM shifts, BYTE and SIGNEXTEND preserve operand order and out-of-range behavior', () => {
  const values = [0n, 1n, 0x80n, 0x7fffn, 0x8000n, sign - 1n, sign, max];
  h.compare([0n, 1n, 7n, 8n, 15n, 31n, 32n, 255n, 256n, max].flatMap(a => values.flatMap(b => [11, 26, 27, 28, 29].map(op => row(op, a, b)))), evaluate, { requireSuccess: true });
  for (const value of values) for (const shift of [0n, 1n, 31n, 255n, 256n, max]) {
    assert.equal(evaluate(row(29, shift, value)), hex(shift >= 256n ? (value >= sign ? -1n : 0n) : BigInt.asIntN(256, value) >> shift));
  }
});
test('EVM unsigned arithmetic, logic and modular operations preserve full-width intermediates', () => {
  const values = [0n, 1n, 255n, sign, max];
  h.compare(values.flatMap(a => values.flatMap(b => [1, 2, 3, 8, 9, 10, 21, 22, 23, 24, 25].map(op => row(op, a, b, b)))), evaluate, { requireSuccess: true });
});
