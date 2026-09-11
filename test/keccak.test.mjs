import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './harness.mjs';
const h = await harness({ name: 'keccak', sources: ['lib/keccak/tn_keccak.ml'], modules: ['tn_keccak.ml'],
  oracle: 'test/keccak-oracle.ml', fixtures: [], exports: ['keccak256'] });
test('Keccak-256 agrees with published empty and abc vectors', () => {
  const fromHex = hex => h.raw(hex);
  const expected = ['c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470', '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45'];
  // Byte equality stays in the ABI without interpreting binary hash bytes as UTF-8.
  for (const [i, message] of ['', 'abc'].entries()) {
    let actual = h.e.keccak256(h.toBytes(message)), wanted = fromHex(expected[i]);
    while (!h.e.bytesEmpty(wanted)) {
      assert.equal(h.e.bytesHead(actual), h.e.bytesHead(wanted));
      actual = h.e.bytesTail(actual); wanted = h.e.bytesTail(wanted);
    }
    assert.equal(h.e.bytesEmpty(actual), 1);
  }
});
test('Keccak absorption and legacy padding match Digestif around each block boundary', () => {
  const sizes = [0, 1, 7, 8, 31, 32, 64, 134, 135, 136, 137, 270, 271, 272, 273, 1000];
  const rows = sizes.flatMap(size => [Buffer.alloc(size), Buffer.from(Array.from({ length: size }, (_, i) => (i * 73 + size) & 255))].map(buffer => [buffer.toString('hex')]));
  h.compare(rows, ([raw]) => {
    let value = h.e.keccak256(h.raw(raw));
    const bytes = [];
    while (!h.e.bytesEmpty(value)) { bytes.push(h.e.bytesHead(value)); value = h.e.bytesTail(value); }
    return Buffer.from(bytes).toString('hex');
  });
});
