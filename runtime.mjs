import { readFile } from 'node:fs/promises';

export function byteAdapter(exports) {
  return {
    toBytes(value) {
      if (typeof value !== 'string' && !(value instanceof Uint8Array)) throw new TypeError('Expected UTF-8 text or Uint8Array.');
      const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
      let result = exports.emptyBytes();
      for (let i = bytes.length - 1; i >= 0; i--) result = exports.consBytes(bytes[i], result);
      return result;
    },
    fromBytes(value) {
      const bytes = [];
      while (!exports.bytesEmpty(value)) {
        const byte = exports.bytesHead(value);
        if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new RangeError('Invalid octet returned by Wasm.');
        bytes.push(byte);
        value = exports.bytesTail(value);
      }
      return Buffer.from(bytes);
    },
  };
}
export async function loadFoundation(path = new URL('./build/telcoin-foundation.wasm', import.meta.url)) {
  const { instance } = await WebAssembly.instantiate(await readFile(path), {});
  return { exports: instance.exports, ...byteAdapter(instance.exports) };
}
export const loadTelcoin = loadFoundation;
export async function loadProfile(profile = 'simulation') {
  if (!['simulation', 'bls'].includes(profile)) throw new RangeError(`Unknown crypto profile: ${profile}`);
  return loadFoundation(new URL(profile === 'bls' ? './build/telcoin-bls.wasm' : './build/telcoin-foundation.wasm', import.meta.url));
}
