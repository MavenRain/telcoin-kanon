import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after } from 'node:test';
import { build, project } from '../scripts/build.mjs';
import { byteAdapter } from '../runtime.mjs';

export const protocolSources = ['lib/codec/bcs.ml', 'lib/crypto_stub/tn_crypto.ml', 'lib/types/round.ml', 'lib/types/units.ml',
  'lib/types/authority_id.ml', 'lib/types/authority.ml', 'lib/types/committee.ml', 'lib/types/digests.ml',
  'lib/keccak/tn_keccak.ml', 'lib/hash32/hash32.ml', 'lib/types/block_num_hash.ml', 'lib/types/batch.ml',
  'lib/vertex/intent.ml', 'lib/vertex/header.ml', 'lib/vertex/vote.ml', 'lib/vertex/certificate.ml'];
export const protocolModules = ['bcs.ml', 'tn_codec.ml', 'tn_crypto.ml', 'round.ml', 'units.ml', 'authority_id.ml', 'authority.ml', 'committee.ml',
  'digests.ml', 'tn_keccak.ml', 'hash32.ml', 'tn_hash32.ml', 'block_num_hash.ml', 'batch.ml', 'tn_types.ml', 'intent.ml', 'header.ml', 'vote.ml', 'certificate.ml', 'tn_vertex.ml'];
const aliases = {
  'tn_codec.ml': 'module Bcs = Bcs\n',
  'tn_hash32.ml': 'module Hash32 = Hash32\n',
  'tn_types.ml': ['Round', 'Units', 'Authority_id', 'Authority', 'Committee', 'Digests', 'Block_num_hash', 'Batch'],
  'tn_vertex.ml': ['Intent', 'Header', 'Vote', 'Certificate'],
};
export function compileOracle({ name, sources, modules, oracle, extraAliases = {} }) {
  const directory = mkdtempSync(join(tmpdir(), `telcoin-${name}-`));
  after(() => rmSync(directory, { recursive: true, force: true }));
  const lock = JSON.parse(readFileSync(resolve(project, 'source-lock.json'), 'utf8'));
  const upstream = process.env.TELCOIN_OCAML_ROOT ?? lock.upstream.root;
  for (const path of sources) {
    const bytes = readFileSync(resolve(upstream, path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), lock.upstream.files.find(f => f.path === path)?.sha256, path);
    writeFileSync(join(directory, path.split('/').at(-1)), bytes);
  }
  for (const [file, text] of Object.entries({ ...aliases, ...extraAliases })) {
    writeFileSync(join(directory, file), Array.isArray(text) ? text.map(name => `module ${name} = ${name}\n`).join('') : text);
  }
  copyFileSync(resolve(project, 'test/oracle_bytes.ml'), join(directory, 'oracle_bytes.ml'));
  copyFileSync(resolve(project, oracle), join(directory, 'oracle.ml'));
  const compiled = spawnSync('opam', ['exec', `--switch=${process.env.OCAML_SWITCH ?? 'tn-ocaml'}`, '--', 'ocamlfind', 'ocamlc',
    '-package', 'digestif.c', '-linkpkg', '-custom', '-o', 'oracle.exe', ...modules, 'oracle_bytes.ml', 'oracle.ml'],
  { cwd: directory, encoding: 'utf8', timeout: 30000 });
  assert.equal(compiled.status, 0, compiled.error?.message ?? compiled.stderr);
  return { directory, runOracle: (args = [], input) => spawnSync(join(directory, 'oracle.exe'), args,
    { input, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 }) };
}
export async function harness({ name, sources, modules, oracle, fixtures, exports, extraAliases = {} }) {
  const { directory, runOracle } = compileOracle({ name, sources, modules, oracle, extraAliases });
  const wasm = join(directory, `${name}.wasm`);
  build(wasm, ['emptyBytes', 'consBytes', 'bytesEmpty', 'bytesHead', 'bytesTail', 'seqBytesEmpty', 'seqBytesCons', ...exports], fixtures.map(path => resolve(project, path)));
  const { instance } = await WebAssembly.instantiate(readFileSync(wasm), {});
  const e = instance.exports;
  const { toBytes, fromBytes } = byteAdapter(e);
  let count = 0;
  after(() => console.log(`${name} OCaml differential rows: ${count}`));
  return {
    e, toBytes, text: value => fromBytes(value).toString('utf8'), raw: hex => toBytes(Buffer.from(hex, 'hex')),
    seeds(csv) {
      let value = e.seqBytesEmpty();
      for (const seed of (csv === 'empty' ? [] : csv.split(',')).reverse()) value = e.seqBytesCons(toBytes(seed), value);
      return value;
    },
    compare(rows, evaluate, { requireSuccess = false } = {}) {
      const result = runOracle([], `${rows.map(row => row.join(' ')).join('\n')}\n`);
      assert.equal(result.status, 0, result.error?.message ?? result.stderr);
      const expected = result.stdout.replace(/\r?\n$/, '').split('\n');
      assert.equal(expected.length, rows.length);
      for (const [i, row] of rows.entries()) {
        if (requireSuccess) assert.ok(!expected[i].startsWith('error:'), `OCaml rejected a positive fixture: ${row.join(' ')}`);
        assert.equal(evaluate(row), expected[i], row.join(' '));
      }
      count += rows.length;
    },
  };
}
export const u32 = value => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b.toString('hex'); };
export const u16 = value => { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b.toString('hex'); };
export const u64 = value => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b.toString('hex'); };
export const hash = hex => createHash('blake2s256').update(Buffer.from(hex, 'hex')).digest('hex');
export const authorityId = seed => hash(hash(Buffer.from('tn-stub-secret:').toString('hex') + u64(seed)));
export function uleb(value) {
  const bytes = [];
  do { const byte = value % 128; value = Math.floor(value / 128); bytes.push(byte + (value ? 128 : 0)); } while (value);
  return Buffer.from(bytes).toString('hex');
}
export const sequence = values => uleb(values.length) + values.join('');
export const header = ({ seed = 1, round = 0, epoch = 0, time = 0, payload = [], parents = [] } = {}) =>
  `${authorityId(seed)}${u32(round)}${u32(epoch)}${u64(time)}${sequence(payload)}${sequence(parents.map(d => '20' + d))}${u64(0)}20${'00'.repeat(32)}`;
