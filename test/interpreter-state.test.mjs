import test from 'node:test';
import { harness, sequence } from './harness.mjs';
import { evmOracleSources } from './evm-oracle-sources.mjs';
const h = await harness({ name: 'interpreter-state', ...evmOracleSources, oracle: 'test/interpreter-state-oracle.ml',
  fixtures: ['test/crypto.kan', 'test/protocol.kan', 'test/consensus.kan', 'test/execution.kan', 'test/evm-core.kan', 'test/evm-env.kan', 'test/evm-effects.kan', 'test/interpreter-machine.kan', 'test/interpreter-state.kan'],
  exports: ['evm_test_interpreter_state', 'stateTestResultText'] });
const huge = 1n << 255n;
const word = n => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0');
const row = (op, words, { count = 0, gas = 100000, fork = 2, mode = 0, warm = 0, phase = 0, returned = 'aabbccdd', memory = '00010203040506070809' } = {}) =>
  [String(op), String(count), sequence(words.map(word)), String(gas), String(fork), String(mode), String(warm), String(phase), returned, memory];
const evaluate = ([op, count, words, gas, fork, mode, warm, phase, returned, memory]) => h.text(h.e.stateTestResultText(128, h.e.evm_test_interpreter_state(
  Number(op), Number(count), h.raw(words), h.toBytes(gas), Number(fork), Number(mode), Number(warm), Number(phase), h.raw(returned), h.raw(memory))));
const compare = rows => h.compare(rows, evaluate, { requireSuccess: true });
test('Account and storage reads preserve cold and warm charges, empty code hashes and self warming', () => {
  compare([0, 1, 2, 3, 4, 8, 12].flatMap(op => [[], [1n], [2n], [3n], [huge]].flatMap(words => [0, 1, 2].flatMap(warm => [0, 99, 100, 2599, 2600].map(gas => row(op, words, { warm, gas }))))));
});
test('Storage and transient writes preserve static guards, stipend sentry, original values and refund deltas', () => {
  compare([9, 10].flatMap(op => [[], [1n], [1n, 0n], [1n, 3n], [1n, 9n], [1n, huge]].flatMap(words => [0, 1, 2].flatMap(phase => [0, 1].flatMap(mode =>
    [0, 100, 2300, 2301, 5000, 22100].map(gas => row(op, words, { phase, mode, gas })))))));
});
test('Keccak and LOG preserve zero-length exemptions, dynamic costs, topic order and static error precedence', () => {
  compare([6, 7].flatMap(op => [0, 1, 2, 3, 4].flatMap(count => [[], [0n], [0n, 0n], [huge, 0n], [huge, 1n], [0n, 3n, 11n, 12n, 13n, 14n]].flatMap(words =>
    [0, 1].flatMap(mode => [0, 100000].map(gas => row(op, words, { count, mode, gas })))))));
});
test('External-code and return-data copies preserve bounds and charging order', () => {
  compare([[], [1n], [0n, 0n, 0n], [0n, 1n, 3n], [huge, 4n, 0n], [0n, 4n, 1n], [huge, huge, 0n], [0n, 0n, huge]].flatMap(words =>
    [0, 3, 100000].map(gas => row(11, words, { gas }))));
  compare([1n, 2n, huge].flatMap(address => [[0n, 0n, 0n], [0n, 0n, 4n], [huge, huge, 0n], [0n, huge, 1n], [huge, 0n, 1n]].flatMap(words =>
    [0, 1].flatMap(warm => [0, 100, 2600, 100000].map(gas => row(5, [address, ...words], { warm, gas }))))));
});
test('SELFDESTRUCT preserves static precedence and Shanghai versus Cancun lifecycle rules', () => {
  compare([[], [1n], [2n], [3n]].flatMap(words => [0, 1, 2].flatMap(fork => [0, 2].flatMap(phase => [0, 1].flatMap(mode =>
    [0, 5000, 7600, 100000].map(gas => row(13, words, { fork, phase, mode, gas })))))));
});
