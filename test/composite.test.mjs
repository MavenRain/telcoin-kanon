import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after } from 'node:test';
import { build, project } from '../scripts/build.mjs';
import { byteAdapter } from '../runtime.mjs';

const directory = mkdtempSync(join(tmpdir(), 'telcoin-composite-'));
after(() => rmSync(directory, { recursive: true, force: true }));
const lock = JSON.parse(readFileSync(resolve(project, 'source-lock.json'), 'utf8'));
const upstream = process.env.TELCOIN_OCAML_ROOT ?? lock.upstream.root;
const files = ['lib/codec/bcs.ml', 'lib/types/round.ml', 'lib/types/units.ml', 'lib/types/leader_round.ml'];
for (const path of files) {
  const content = readFileSync(resolve(upstream, path));
  assert.equal(createHash('sha256').update(content).digest('hex'), lock.upstream.files.find(f => f.path === path)?.sha256);
  copyFileSync(resolve(upstream, path), join(directory, path.split('/').at(-1)));
}
copyFileSync(resolve(project, 'test/oracle.ml'), join(directory, 'oracle.ml'));
const compile = spawnSync('opam', ['exec', `--switch=${process.env.OCAML_SWITCH ?? 'tn-ocaml'}`, '--', 'ocamlc', '-o', 'oracle.exe',
  ...files.map(path => path.split('/').at(-1)), 'oracle.ml'], { cwd: directory, encoding: 'utf8', timeout: 30000 });
assert.equal(compile.status, 0, compile.error?.message ?? compile.stderr);
const fixture = resolve(project, 'test/composite.kan');
const names = [...readFileSync(fixture, 'utf8').matchAll(/^def (composite_\w+) :/gm)].map(match => match[1]);
const wasm = join(directory, 'composite.wasm');
build(wasm, ['emptyBytes', 'consBytes', 'bytesEmpty', 'bytesHead', 'bytesTail', ...names], [fixture]);
const { instance } = await WebAssembly.instantiate(readFileSync(wasm), {});
const e = instance.exports;
const { toBytes, fromBytes } = byteAdapter(e);
function decode(kind, hex) {
  try {
    const bytes = fromBytes(e[`composite_${kind}`](toBytes(Buffer.from(hex, 'hex'))));
    return bytes[0] === 0 ? `ok:${bytes.subarray(1).toString('hex')}` : bytes.toString('utf8');
  } catch (error) {
    throw new Error(`${kind} ${hex}: ${error.message}`, { cause: error });
  }
}
let rowsChecked = 0;
function compare(rows) {
  const result = spawnSync(join(directory, 'oracle.exe'), [], { input: `${rows.map(([kind, hex]) => `decode ${kind} ${hex}`).join('\n')}\n`,
    encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  const expected = result.stdout.trimEnd().split('\n');
  assert.equal(expected.length, rows.length);
  for (const [i, [kind, hex]] of rows.entries()) assert.equal(decode(kind, hex), expected[i], `${kind} ${hex}`);
  rowsChecked += rows.length;
}
after(() => console.log(`Composite OCaml differential rows: ${rowsChecked}`));

test('primitive combinations preserve layout, values and exact errors', () => {
  const rows = [];
  const inputs = ['', '00', '01', '02', '03', '03010203', '0201000200', '020161026263',
    '0700000002000000026964', '0102ff80', '0100', '020201020103', '8000', 'ffffffff0f', '8080808008'];
  for (const kind of ['list8', 'list16', 'list64', 'listbytes', 'nested', 'optionbytes', 'triple', 'refine', 'refineoffset', 'string'])
    for (const hex of inputs) rows.push([kind, hex]);
  compare(rows);
});
test('sets accept unsorted values and duplicates, while maps reject them', () => {
  compare([
    ['set8', '020201'], ['set8', '020101'], ['set8', '0402020103'],
    ['map8', '02010a020b'], ['map8', '02020b010a'], ['map8', '02010a010b'],
    ['map8', '03020b010a'], ['map8', '02020b01'],
  ]);
  assert.equal(decode('set8', '0402020103'), 'ok:03010203');
  assert.equal(decode('map8', '03020b010a'), 'error: length 2 out of range at offset 3');
  assert.equal(decode('map8', '02020b01'), 'error: unexpected end of input at offset 4 (wanted 1 bytes)');
  assert.equal(fromBytes(e.composite_mapencode()).toString('hex'), '0302bb05cc09aa');
  assert.equal(fromBytes(e.composite_setencode()).toString('hex'), '020102');
});
test('map comparators distinguish numeric, lexical and encoded-byte ordering', () => {
  compare([
    ['map16', '0200010a01000b'], ['map16', '0201000b00010a'],
    ['mapbytes', '0201620a0261610b'], ['mapbytes', '020261610b01620a'],
  ]);
  assert.equal(decode('map16', '0200010a01000b'), 'ok:0200010a01000b');
  assert.equal(decode('mapbytes', '0201620a0261610b'), 'ok:0201620a0261610b');
});
test('unit lists consume no element bytes and preserve their declared count', () => {
  compare([['units', '00'], ['units', '01'], ['units', '05'], ['units', '8001'], ['units', '8000'], ['units', '0100'], ['units', '8080808008']]);
  assert.equal(decode('units', '8001'), 'ok:8001');
});
test('maximum legal sequence length fails on missing input without allocating that length', () => {
  const started = performance.now();
  compare([['list8', 'ffffffff07'], ['list64', 'ffffffff07'], ['listbytes', 'ffffffff07'], ['map8', 'ffffffff07']]);
  assert.ok(performance.now() - started < 5000, 'A truncated sequence should fail before allocating its declared size.');
});
test('malformed composite corpus matches the source decoder', () => {
  let random = 0x131044;
  const byte = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random >>> 24; };
  const rows = [];
  for (let index = 0; index < 80; index++) {
    const hex = Buffer.from(Array.from({ length: index % 17 }, byte)).toString('hex');
    for (const kind of ['list8', 'list16', 'listbytes', 'map8', 'map16', 'mapbytes', 'set8', 'nested', 'optionbytes', 'refineoffset']) rows.push([kind, hex]);
  }
  compare(rows);
});
test('generated collections match the shared source template', () => {
  const result = spawnSync(process.execPath, [resolve(project, 'scripts/collections.mjs'), '--check'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
});

test('sum codecs preserve discriminants, payloads and unknown-variant offsets', () => {
  const inputs = ['', '00', '02', '0202ff00', '800104030201', '800100000000', '01', '8000', 'ff', 'ffffffff0f'];
  compare(inputs.flatMap(hex => [['sum', hex], ['sumoffset', `07${hex}`]]));
  assert.equal(decode('sum', '800104030201'), 'ok:800104030201');
  assert.equal(decode('sumoffset', '0701'), 'error: unknown enum variant 1 at offset 1');
  assert.equal(fromBytes(e.composite_sumemptywrite()).length, 0);
});
