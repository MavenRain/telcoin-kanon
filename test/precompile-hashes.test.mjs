import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { harness } from './harness.mjs';
import { evmOracleSources } from './evm-oracle-sources.mjs';
import { byteAdapter } from '../runtime.mjs';
const h = await harness({ name: 'precompile-hashes', ...evmOracleSources,
  oracle: 'test/precompile-hashes-oracle.ml', fixtures: ['test/precompile-bn254.kan', 'test/precompile-hashes.kan'],
  exports: ['precompileTestHash', 'precompileTestKind', 'precompileTestGas', 'precompileTestOutput', 'sha256', 'ripemd160'] });
const { fromBytes } = byteAdapter(h.e);
const evaluate = ([which, gas, input]) => {
  const result = h.e.precompileTestHash(Number(which), h.raw(input), h.toBytes(gas));
  if (h.e.precompileTestKind(result) === 2) return 'rejected';
  return 's:' + h.e.precompileTestGas(result) + ':' + fromBytes(h.e.precompileTestOutput(result)).toString('hex');
};
for (const [which, name, base, perWord] of [[2, 'sha256', 60, 12], [3, 'ripemd160', 600, 120]]) {
  test(name + ' matches OCaml and independent OpenSSL digests across padding and block boundaries', () => {
    const messages = ['', 'a', 'abc', 'message digest', 'abcdefghijklmnopqrstuvwxyz',
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789']
      .map(value => Buffer.from(value));
    for (const size of [31, 32, 33, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 255, 256, 1024]) {
      messages.push(Buffer.from(Array.from({ length: size }, (_, i) => (i * 73 + size) % 256)));
    }
    for (const bytes of messages) {
      const digest = createHash(name).update(bytes).digest('hex');
      assert.equal(fromBytes(h.e[name](h.toBytes(bytes))).toString('hex'), digest);
      const cost = base + perWord * Math.ceil(bytes.length / 32);
      const expected = 's:' + cost + ':' + (which === 3 ? '00'.repeat(12) : '') + digest;
      h.compare([[String(which), String(cost), bytes.toString('hex')]], row => {
        const actual = evaluate(row); assert.equal(actual, expected); return actual;
      }, { requireSuccess: true });
    }
  });
  test(name + ' preserves exact gas pricing and rejects negative or insufficient gas', () => {
    const rows = [0, 1, 31, 32, 33, 64, 65, 136].flatMap(size => {
      const cost = base + perWord * Math.ceil(size / 32);
      return [-1, 0, cost - 1, cost, cost + 1].map(gas => [String(which), String(gas), 'ff'.repeat(size)]);
    });
    h.compare(rows, evaluate, { requireSuccess: true });
  });
}
