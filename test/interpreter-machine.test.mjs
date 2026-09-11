import test from 'node:test';
import { harness, sequence } from './harness.mjs';
import { evmOracleSources } from './evm-oracle-sources.mjs';
const h = await harness({ name: 'interpreter-machine', ...evmOracleSources, oracle: 'test/interpreter-machine-oracle.ml',
  fixtures: ['test/crypto.kan', 'test/protocol.kan', 'test/consensus.kan', 'test/execution.kan', 'test/evm-core.kan', 'test/evm-env.kan', 'test/interpreter-machine.kan'], exports: ['evm_test_machine', 'machineTestResultText'] });
const huge = 1n << 255n;
const maxInt = (1n << 62n) - 1n;
const word = n => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0');
const row = (op, words, { gas = 100000, code = '615b005b', pc = 0, memory = '000102030405060708090a0b0c0d0e0f', paid = 0, width = 1 } = {}) =>
  [String(op), String(width), sequence(words.map(word)), String(gas), code, String(pc), memory, String(paid)];
const evaluate = ([op, width, stack, gas, code, pc, memory, paid]) => h.text(h.e.machineTestResultText(128, h.e.evm_test_machine(Number(op), Number(width), h.raw(stack), h.toBytes(gas), h.raw(code), h.toBytes(pc), h.raw(memory), Number(paid))));
test('Interpreter arithmetic and stack bodies preserve operand order, underflow, overflow and EXP gas', () => {
  h.compare([0, 1, 2, 3, 14, 15].flatMap(op => [[], [1n], [2n, 3n], [2n, 3n, 7n], [huge, huge, 17n]].flatMap(words => [0, 49, 50, 100000].map(gas => row(op, words, { gas })))), evaluate, { requireSuccess: true });
  h.compare([0, 1, 15].map(op => row(op, Array.from({ length: 1024 }, () => 1n))), evaluate, { requireSuccess: true });
});
test('Interpreter memory and return bodies preserve expansion charging and zero-length offset exemptions', () => {
  h.compare([4, 5, 6, 10, 11].flatMap(op => [0n, 31n, 32n, 4294967295n, huge].flatMap(offset => [0n, 1n, 32n, huge].flatMap(length => [0, 3, 100000].map(gas =>
    row(op, [offset, length], { gas }))))), evaluate, { requireSuccess: true });
});
test('Jump bodies ignore untaken invalid destinations and PUSH reads zero-extend truncated immediates', () => {
  h.compare([7, 8].flatMap(op => [0n, 1n, 3n, 4n, huge].flatMap(dest => [0n, 1n, 2n].map(condition => row(op, [dest, condition])))), evaluate, { requireSuccess: true });
  h.compare([1, 2, 16, 32].flatMap(width => ['', '60', '60ff', '7f' + 'aabb'.repeat(16)].flatMap(code => [0n, 1n, maxInt].map(pc => row(9, [], { width, code, pc })))), evaluate, { requireSuccess: true });
});
test('Copy planning charges length first, expands both MCOPY windows and reads overlapping sources from the prior memory', () => {
  h.compare([12, 13].flatMap(op => [0n, 1n, 64n, huge].flatMap(dest => [0n, 2n, 64n, huge].flatMap(source => [0n, 1n, 31n, huge].flatMap(length => [0, 3, 100000].map(gas =>
    row(op, [dest, source, length], { gas })))))), evaluate, { requireSuccess: true });
});
