import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { harness } from './harness.mjs';
import { evmOracleSources } from './evm-oracle-sources.mjs';
import { byteAdapter } from '../runtime.mjs';
const h = await harness({ name: 'precompile-blake2f', ...evmOracleSources,
  oracle: 'test/precompile-blake2f-oracle.ml', fixtures: ['test/precompile-bn254.kan', 'test/precompile-blake2f.kan'],
  exports: ['precompileTestBlake2f', 'precompileTestKind', 'precompileTestGas', 'precompileTestOutput'] });
const { fromBytes } = byteAdapter(h.e);
const evaluate = ([gas, input]) => {
  const result = h.e.precompileTestBlake2f(h.raw(input), h.toBytes(gas));
  return h.e.precompileTestKind(result) === 2 ? 'rejected' : `s:${h.e.precompileTestGas(result)}:${fromBytes(h.e.precompileTestOutput(result)).toString('hex')}`;
};
const input = (rounds, flag, seed = 1) => {
  const bytes = Buffer.alloc(213); bytes.writeUInt32BE(rounds);
  for (let i = 4; i < 212; i++) bytes[i] = (i * 73 + seed) % 256;
  bytes[212] = flag; return bytes.toString('hex');
};
test('BLAKE2F compression matches OCaml across sigma cycles, flags and gas boundaries', () => {
  const rows = [0, 1, 2, 9, 10, 11, 12, 13, 20].flatMap(rounds => [0, 1, 2, 255].flatMap(flag =>
    [rounds - 1, rounds].map(gas => [String(gas), input(rounds, flag, rounds)])));
  rows.push(['64', input(64, 1, 255)], ['4294967294', input(4294967295, 1)], ['4294967295', input(4294967295, 2)]);
  h.compare(rows, evaluate, { requireSuccess: true });
});
test('BLAKE2F requires exactly 213 bytes before interpreting the input', () => {
  h.compare([0, 1, 4, 64, 212, 214, 426].flatMap(length => [-1, 0, 1000].map(gas => [String(gas), '00'.repeat(length)])), evaluate, { requireSuccess: true });
});
test('BLAKE2F produces the independent BLAKE2b-512 digest of abc', () => {
  const bytes = Buffer.alloc(213); bytes.writeUInt32BE(12);
  const iv = ['6a09e667f3bcc908', 'bb67ae8584caa73b', '3c6ef372fe94f82b', 'a54ff53a5f1d36f1',
    '510e527fade682d1', '9b05688c2b3e6c1f', '1f83d9abfb41bd6b', '5be0cd19137e2179'].map(value => BigInt('0x' + value));
  iv[0] ^= 0x01010040n;
  iv.forEach((word, i) => bytes.writeBigUInt64LE(word, 4 + i * 8));
  bytes.write('abc', 68); bytes.writeBigUInt64LE(3n, 196); bytes[212] = 1;
  const expected = 's:12:' + createHash('blake2b512').update('abc').digest('hex');
  h.compare([['12', bytes.toString('hex')]], row => { const actual = evaluate(row); assert.equal(actual, expected); return actual; }, { requireSuccess: true });
});
