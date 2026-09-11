import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { build } from '../scripts/build.mjs';
import { byteAdapter } from '../runtime.mjs';
const directory = mkdtempSync(join(tmpdir(), 'telcoin-blake2s-'));
after(() => rmSync(directory, { recursive: true, force: true }));
const path = join(directory, 'blake2s.wasm');
build(path, ['emptyBytes', 'consBytes', 'bytesEmpty', 'bytesHead', 'bytesTail', 'blake2s256']);
const { instance } = await WebAssembly.instantiate(readFileSync(path), {});
const { toBytes, fromBytes } = byteAdapter(instance.exports);
const hash = bytes => fromBytes(instance.exports.blake2s256(toBytes(bytes))).toString('hex');
test('BLAKE2s-256 matches published empty and abc digests', () => {
  assert.equal(hash(''), '69217a3079908094e11121d042354a7c1f55b6482ca1a51e1b250dfd1ed0eef9');
  assert.equal(hash('abc'), '508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982');
});
test('block boundaries and binary inputs match independent OpenSSL BLAKE2s', () => {
  for (const length of [0, 1, 3, 31, 32, 63, 64, 65, 127, 128, 129, 255, 256, 257, 1024, 4096]) {
    const input = Buffer.from(Array.from({ length }, (_, index) => (index * 37 + 19) & 255));
    assert.equal(hash(input), createHash('blake2s256').update(input).digest('hex'), `length ${length}`);
  }
});
test('deterministic random messages agree with OpenSSL', () => {
  let random = 0x131044;
  const byte = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random >>> 24; };
  for (let index = 0; index < 24; index++) {
    const input = Buffer.from(Array.from({ length: index * 13 }, byte));
    assert.equal(hash(input), createHash('blake2s256').update(input).digest('hex'), `case ${index}`);
  }
});
