import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './harness.mjs';
const h = await harness({ name: 'rlp', sources: ['lib/rlp/rlp.ml'], modules: ['rlp.ml'], oracle: 'test/rlp-oracle.ml', fixtures: ['test/rlp.kan'],
  exports: ['rlp_test_encode', 'rlp_test_nat', 'rlp_test_decode'] });
const evaluate = ([kind, raw, exact]) => h.text(kind === 'nat' ? h.e.rlp_test_nat(h.toBytes(raw)) : kind === 'encode' ? h.e.rlp_test_encode(h.raw(raw)) : h.e.rlp_test_decode(h.raw(raw), Number(exact)));
const header = (length, short, long) => length < 56 ? Buffer.from([short + length]) : (() => {
  const text = length.toString(16).padStart(Math.ceil(length.toString(16).length / 2) * 2, '0'); const bytes = Buffer.from(text, 'hex');
  return Buffer.concat([Buffer.from([long + bytes.length]), bytes]);
})();
const encode = value => Array.isArray(value) ? (() => { const payload = Buffer.concat(value.map(encode)); return Buffer.concat([header(payload.length, 192, 247), payload]); })() :
  value.length === 1 && value[0] < 128 ? value : Buffer.concat([header(value.length, 128, 183), value]);
test('RLP strings, scalar stripping and nested lists match across short and long headers', () => {
  const values = ['', '00', '01', '7f', '80', 'ff', '000001', '0000', ...[54, 55, 56, 57, 255, 256, 512].map(n => 'ab'.repeat(n))];
  h.compare(values.map(raw => ['encode', raw]), evaluate, { requireSuccess: true });
  for (const raw of values) assert.equal(evaluate(['encode', raw]).split(':')[0], encode(Buffer.from(raw, 'hex')).toString('hex'));
  h.compare([-1n, 0n, 1n, 55n, 56n, 127n, 128n, 255n, 256n, (1n << 62n) - 1n].map(n => ['nat', String(n)]), evaluate, { requireSuccess: true });
});
test('RLP decoding preserves typed trees and unconsumed suffixes', () => {
  const values = [Buffer.alloc(0), Buffer.from([0]), [], [Buffer.from('cat'), Buffer.from('dog')], [[], [[], [Buffer.from('abc')]]], Array.from({ length: 60 }, (_, i) => Buffer.from([i]))];
  const raws = values.map(value => encode(value).toString('hex'));
  let deep = encode([]); for (let i = 0; i < 300; i++) deep = Buffer.concat([header(deep.length, 192, 247), deep]); raws.push(deep.toString('hex'));
  h.compare(raws.flatMap(raw => [0, 1].flatMap(exact => [['decode', raw, String(exact)], ['decode', raw + '80c0', String(exact)]])), evaluate, { requireSuccess: true });
});
test('Malformed RLP reports canonicality, length overflow and nested boundary errors in source order', () => {
  const invalid = ['', '8100', '817f', 'b800', 'b80100', 'b837' + '00'.repeat(55), 'b838', 'bf3fffffffffffffff', 'bf4000000000000000', 'bfffffffffffffffff',
    'c18100', 'c1c28100', 'c1c28180', 'c2c2b800', 'c18080', 'f800', 'f80180', 'f838', 'ff3fffffffffffffff', 'ff4000000000000000'];
  h.compare(invalid.flatMap(raw => [0, 1].map(exact => ['decode', raw, String(exact)])), evaluate, { requireSuccess: true });
  let state = 6512;
  const random = Array.from({ length: 300 }, (_, index) => {
    const bytes = Buffer.alloc(index % 65); for (let i = 0; i < bytes.length; i++) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; bytes[i] = state >>> 24; }
    return ['decode', bytes.toString('hex'), String(index % 2)];
  });
  h.compare(random, evaluate, { requireSuccess: true });
});
