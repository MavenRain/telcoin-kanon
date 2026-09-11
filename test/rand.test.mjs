import test from 'node:test';
import { harness, sequence, u64 } from './harness.mjs';
const h = await harness({ name: 'rand',
  sources: ['lib/codec/bcs.ml', 'lib/keccak/tn_keccak.ml', 'lib/hash32/hash32.ml', 'lib/rand/chacha12.ml', 'lib/rand/std_rng.ml', 'lib/rand/rand_seq.ml'],
  modules: ['bcs.ml', 'tn_codec.ml', 'tn_keccak.ml', 'hash32.ml', 'tn_hash32.ml', 'chacha12.ml', 'std_rng.ml', 'rand_seq.ml'],
  oracle: 'test/rand-oracle.ml', fixtures: ['test/rand.kan'], exports: ['rand_stream', 'rand_range', 'rand_choose', 'rand_leader'] });
const keys = ['00'.repeat(32), 'ff'.repeat(32), Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('hex'), 'a13c69f0'.repeat(8)];
function evaluate([kind, key, a, b]) {
  if (kind === 'stream') return h.text(h.e.rand_stream(h.raw(key), h.toBytes(Buffer.alloc(Number(a)))));
  if (kind === 'range') return h.text(h.e.rand_range(h.raw(key), h.seeds(a)));
  if (kind === 'choose') return h.text(h.e.rand_choose(h.raw(key), h.raw(sequence(Array.from({ length: Number(a) }, (_, i) => u64(i)))), h.toBytes(b)));
  return h.text(h.e.rand_leader(h.toBytes(key)));
}
test('ChaCha12 matches full blocks and buffer boundaries for four keys', () => {
  h.compare(keys.flatMap(key => [0, 1, 7, 8, 9, 16, 33].map(count => ['stream', key, String(count)])), evaluate);
});
test('inclusive sampling matches u32/u64 dispatch, biased-zone draws and refusal', () => {
  const bounds = ['-1', '0', '1', '2', '33', '2147483647', '2147483648', '4294967294', '4294967295', '4294967296', '1099511627775', '2305843009213693951', '4611686018427387903'];
  h.compare(keys.flatMap(key => [bounds, [...bounds].reverse(), Array(80).fill('3000000000'), Array(80).fill('4611686018427387903')].map(row => ['range', key, row.join(',')])), evaluate);
});
test('reservoir contents and subsequent stream position agree including zero and negative amounts', () => {
  h.compare(keys.flatMap(key => [0, 1, 9, 40].flatMap(size => [-1, 0, 1, 3, size, size + 1].map(count => ['choose', key, String(size), String(count)]))), evaluate);
});
test('leader-round seeds use the final eight bytes in little-endian order', () => {
  h.compare(['0', '2', '4', '256', '4294967294', '4294967296', '18446744073709551615'].map(round => ['leader', round]), evaluate);
});
