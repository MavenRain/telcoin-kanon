import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './harness.mjs';
import { evmOracleSources } from './evm-oracle-sources.mjs';
import { byteAdapter } from '../runtime.mjs';
const h = await harness({ name: 'precompile-modexp', ...evmOracleSources,
  oracle: 'test/precompile-modexp-oracle.ml', fixtures: ['test/precompile-bn254.kan', 'test/precompile-modexp.kan'],
  exports: ['precompileTestModexp', 'precompileTestKind', 'precompileTestGas', 'precompileTestOutput'] });
const { fromBytes } = byteAdapter(h.e);
const evaluate = ([gas, input]) => {
  const result = h.e.precompileTestModexp(h.raw(input), h.toBytes(gas));
  return h.e.precompileTestKind(result) === 2 ? 'rejected' : `s:${h.e.precompileTestGas(result)}:${fromBytes(h.e.precompileTestOutput(result)).toString('hex')}`;
};
const be = (value, width = 32) => width === 0 ? '' : BigInt(value).toString(16).padStart(width * 2, '0');
const header = (bl, el, ml) => be(bl) + be(el) + be(ml);
const request = (base, exponent, modulus) => header(base.length / 2, exponent.length / 2, modulus.length / 2) + base + exponent + modulus;
const powmod = (base, exponent, modulus) => {
  if (modulus === 0n) return 0n;
  let acc = 1n % modulus; base %= modulus;
  while (exponent) { if (exponent & 1n) acc = acc * base % modulus; base = base * base % modulus; exponent >>= 1n; }
  return acc;
};
test('MODEXP matches OCaml and independent BigInt results beyond 256-bit operands', () => {
  for (const width of [1, 2, 8, 32, 33, 64, 129]) for (const exponent of [0n, 1n, 2n, 17n]) {
    const base = (1n << BigInt(width * 8)) - 1n;
    const modulus = width === 1 ? 97n : (1n << BigInt(width * 8 - 1)) - 19n;
    const input = request(be(base, width), be(exponent, 1), be(modulus, width));
    const expected = be(powmod(base, exponent, modulus), width);
    h.compare([['1000000', input]], row => { const actual = evaluate(row); assert.equal(actual.split(':')[2], expected); return actual; }, { requireSuccess: true });
  }
});
test('MODEXP zero modulus, empty values, truncation and exponent high-word pricing match OCaml', () => {
  const inputs = ['', ...[0, 1, 31, 32, 33, 95, 96].map(length => '00'.repeat(length)),
    request('', '', ''), request('ff', '00', '00'), request('02', '00', '01'), request('02', '', '0d'),
    request('02', '00'.repeat(32) + '02', '0d'), header(2, 3, 4) + '123456',
    request('ff'.repeat(64), '80' + '00'.repeat(32), '01'.repeat(64))];
  const rows = inputs.flatMap(input => [-1, 199, 200, 201, 1000].map(gas => [String(gas), input]));
  h.compare(rows, evaluate, { requireSuccess: true });
});
test('MODEXP astronomical headers reject by gas while the zero-width exception stays allocation-free', () => {
  const huge = (1n << 256n) - 1n;
  const inputs = [header(huge, 1, 1), header(1, huge, 1), header(1, 1, huge), header(0, huge, 0),
    header(0, huge, 0) + 'ff'.repeat(32), header(huge, huge, huge)];
  h.compare(inputs.flatMap(input => ['199', '200', '4611686018427387903'].map(gas => [gas, input])), evaluate, { requireSuccess: true });
});
