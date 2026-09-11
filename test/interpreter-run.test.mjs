import test from 'node:test';
import { harness } from './harness.mjs';
import { evmOracleSources } from './evm-oracle-sources.mjs';
import { precompileVectors } from './precompile-vectors.mjs';
const h = await harness({ name: 'interpreter-run', ...evmOracleSources, oracle: 'test/interpreter-run-oracle.ml',
  fixtures: ['test/crypto.kan', 'test/protocol.kan', 'test/consensus.kan', 'test/execution.kan', 'test/evm-core.kan', 'test/evm-env.kan', 'test/evm-effects.kan',
    'test/interpreter-machine.kan', 'test/interpreter-state.kan', 'test/interpreter-run.kan'], exports: ['evm_test_interpreter_run', 'runTestResultText'] });
const push = n => {
  n = BigInt(n);
  if (n === 0n) return '5f';
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return (0x5f + hex.length / 2).toString(16) + hex;
};
const wordReturn = '5f5260205ff3';
const row = (code, { gas = 100000, fork = 2, mode = 0, child = '', delegated = 0 } = {}) => [code, String(gas), String(fork), String(mode), child, String(delegated)];
const evaluate = ([code, gas, fork, mode, child, delegated]) => h.text(h.e.runTestResultText(128, h.e.evm_test_interpreter_run(h.raw(code), h.toBytes(gas), Number(fork), Number(mode), h.raw(child), Number(delegated))));
const compare = rows => h.compare(rows, evaluate, { requireSuccess: true });
test('Frame runner preserves arithmetic, environmental values, control flow and exact exceptional halts', () => {
  const binaries = ['01', '02', '03', '04', '05', '06', '07', '0a', '0b', '10', '11', '12', '13', '14', '16', '17', '18', '1a', '1b', '1c', '1d'];
  compare(binaries.flatMap(op => [[3n, 7n], [1n << 255n, 256n]].map(([a, b]) => row(push(b) + push(a) + op + wordReturn))));
  compare(['30', '32', '33', '34', '36', '38', '3a', '3d', '41', '42', '43', '44', '45', '46', '47', '48', '4a', '58', '59', '5a'].map(op => row(op + wordReturn)));
  compare(['', '00', '5f5ff3', '5f5ffd', 'fe', 'ef', '56', '605b56', '60005b00', '7f01', '5b5f56'].flatMap(code => [0, 1, 10, 55].map(gas => row(code, { gas }))));
  compare([row('5f'.repeat(1025), { gas: 10000 }), row(push((1n << 255n) + 0xabn) + '5f5360015ff3')]);
});
test('Fork activation precedes gas and stack validation', () => {
  compare(['49', '4a', '5c', '5d', '5e'].flatMap(code => [0, 1, 2].flatMap(fork => [0, 1000].map(gas => row(code, { fork, gas })))));
});
const call = (opcode, value = 0, requested = 10000, outLen = 32, target = 16) =>
  push(outLen) + push(64) + push(0) + push(0) + (['f1', 'f2'].includes(opcode) ? push(value) : '') + push(target) + push(requested) + opcode +
  '5f523d60205260605ff3';
test('CALL, CALLCODE, DELEGATECALL and STATICCALL merge return data, gas and storage with rollback', () => {
  const children = ['00', '602a' + wordReturn, '602a5f5260205ffd', 'fe', '606360015500', '606360015d00', '6063600155602a5f5260205ffd'];
  compare(['f1', 'f2', 'f4', 'fa'].flatMap(op => children.flatMap(child => [0, 1].map(delegated => row(call(op), { child, delegated })))));
  compare(['f1', 'f2'].flatMap(op => [0, 1, 9].flatMap(value => [0, 1].map(mode => row(call(op, value), { mode, child: '00' })))));
  compare([0, 1, 100, 1000000].flatMap(requested => [0, 1, 32].map(outLen => row(call('f1', 0, requested, outLen), { gas: 20000, child: '602a' + wordReturn }))));
  compare([0, 1, 9].map(value => row(call('f1', value, 10000, 0, 18))));
});
const create = (initCode, salted = false, value = 0) => {
  let code = '';
  const bytes = Buffer.from(initCode, 'hex');
  for (const [i, byte] of bytes.entries()) code += push(byte) + push(i) + '53';
  return code + (salted ? push(7) : '') + push(bytes.length) + push(0) + push(value) + (salted ? 'f5' : 'f0') + wordReturn;
};
test('CREATE and CREATE2 preserve creator nonce, value transfer, code deposit and failed initcode rollback', () => {
  const initCodes = ['', '00', 'fe', '5f5ffd', '60605f53600160015360025ff3', '60ef5f5360015ff3', '60636001555f5ffd'];
  compare(initCodes.flatMap(init => [false, true].flatMap(salted => [0, 1, 9].map(value => row(create(init, salted, value), { gas: 150000 })))));
  compare([false, true].flatMap(salted => [0, 31999, 32000, 100000].map(gas => row(create('', salted), { gas }))));
  compare([row(create('00'), { mode: 1 }), row(push(0) + push(49153) + push(0) + push(0) + 'f5')]);
});
test('The full 1024 nested-call limit uses heap frames without exhausting the host stack', () => {
  const recursive = '5f5f5f5f5f60107f' + 'ff'.repeat(32) + 'f100';
  compare([row(recursive, { gas: '1000000000000000000', child: recursive })]);
});
const precompileCall = (opcode, vector, requested, value = 0) => {
  const bytes = Buffer.from(vector.input, 'hex');
  const setup = Array.from(bytes, (byte, i) => push(byte) + push(i) + '53').join('');
  return setup + push(128) + push(64) + push(bytes.length) + push(0) +
    (['f1', 'f2'].includes(opcode) ? push(value) : '') + push(vector.address) + push(requested) + opcode +
    '5f523d60205260c05ff3';
};
test('All four call instructions execute every real precompile and merge output and gas', () => {
  compare(['f1', 'f2', 'f4', 'fa'].flatMap(opcode => precompileVectors
    .map(vector => row(precompileCall(opcode, vector, vector.gas), { gas: 2000000 }))));
});
test('Precompile rejection, value stipends and static restrictions preserve frame rollback', () => {
  compare(precompileVectors.filter(vector => vector.gas > 0)
    .map(vector => row(precompileCall('fa', vector, vector.gas - 1), { gas: 2000000 })));
  const hash = precompileVectors.find(vector => vector.address === 2);
  compare(['f1', 'f2'].flatMap(opcode => [0, 1, 9].flatMap(value => [0, 1].map(mode =>
    row(precompileCall(opcode, hash, 0, value), { gas: 2000000, mode })))));
  compare([row(precompileCall('f1', { address: 8, input: 'ff' }, 1000000), { gas: 2000000 }),
    row(precompileCall('fa', { address: 9, input: '00' }, 1000), { gas: 2000000 })]);
});
