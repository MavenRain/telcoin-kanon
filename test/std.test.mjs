import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after } from 'node:test';
import { build, project } from '../scripts/build.mjs';
import { byteAdapter } from '../runtime.mjs';

const directory = mkdtempSync(join(tmpdir(), 'telcoin-std-'));
after(() => rmSync(directory, { recursive: true, force: true }));
const lock = JSON.parse(readFileSync(resolve(project, 'source-lock.json'), 'utf8'));
const upstream = process.env.TELCOIN_OCAML_ROOT ?? lock.upstream.root;
const files = ['lib/codec/bcs.ml', 'lib/std/nonempty.ml', 'lib/std/prng.ml'];
for (const path of files) {
  assert.equal(createHash('sha256').update(readFileSync(resolve(upstream, path))).digest('hex'), lock.upstream.files.find(f => f.path === path)?.sha256);
  copyFileSync(resolve(upstream, path), join(directory, path.split('/').at(-1)));
}
copyFileSync(resolve(project, 'test/std-oracle.ml'), join(directory, 'oracle.ml'));
const compiled = spawnSync('opam', ['exec', `--switch=${process.env.OCAML_SWITCH ?? 'tn-ocaml'}`, '--', 'ocamlc', '-o', 'oracle.exe',
  ...files.map(path => path.split('/').at(-1)), 'oracle.ml'], { cwd: directory, encoding: 'utf8', timeout: 30000 });
assert.equal(compiled.status, 0, compiled.error?.message ?? compiled.stderr);
const fixture = resolve(project, 'test/std.kan');
const names = ['std_prngNext', 'std_prngSplit', 'std_prngRange', 'std_wordXor', 'std_wordMul', 'std_wordAdd',
  'std_head', 'std_last', 'std_length', 'std_fold', 'std_map', 'std_append', 'std_compare', 'std_equal', 'std_singleton'];
const wasm = join(directory, 'std.wasm');
build(wasm, ['emptyBytes', 'consBytes', 'bytesEmpty', 'bytesHead', 'bytesTail', ...names], [fixture]);
const { instance } = await WebAssembly.instantiate(readFileSync(wasm), {});
const e = instance.exports;
const { toBytes, fromBytes } = byteAdapter(e);
const text = value => fromBytes(value).toString('utf8');
let rowsChecked = 0;
function oracle(rows) {
  const result = spawnSync(join(directory, 'oracle.exe'), [], { input: `${rows.map(row => row.join(' ')).join('\n')}\n`,
    encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  const lines = result.stdout.trimEnd().split('\n');
  assert.equal(lines.length, rows.length);
  return lines;
}
function compare(rows, evaluate) {
  const expected = oracle(rows);
  for (const [i, row] of rows.entries()) assert.equal(evaluate(row), expected[i], row.join(' '));
  rowsChecked += rows.length;
}
after(() => console.log(`Std OCaml differential rows: ${rowsChecked}`));
const max = (1n << 64n) - 1n;
let random = 0x131044;
function byte() { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random >>> 24; }
const seeds = [0n, 1n, 2n, 42n, 1n << 63n, max, max - 1n,
  ...Array.from({ length: 24 }, () => BigInt(`0x${Buffer.from(Array.from({ length: 8 }, byte)).toString('hex')}`))].map(String);

test('SplitMix64 draws and split streams match pinned OCaml for full-width seeds', () => {
  compare(seeds.flatMap(seed => [['next', seed], ['split', seed]]), ([kind, seed]) => text(e[kind === 'next' ? 'std_prngNext' : 'std_prngSplit'](toBytes(seed))));
  assert.equal(text(e.std_prngNext(toBytes('0'))).split(':')[0], '16294208416658607535');
});
test('state progression stays exact over repeated draws', () => {
  let state = '0';
  const rows = [];
  const actual = [];
  for (let index = 0; index < 128; index++) {
    rows.push(['next', state]);
    const draw = text(e.std_prngNext(toBytes(state)));
    actual.push(draw);
    state = draw.split(':')[1];
  }
  const expected = oracle(rows);
  assert.deepEqual(actual, expected);
  rowsChecked += rows.length;
});
test('range reduction preserves signed boundaries and advances even for empty ranges', () => {
  const ranges = [['0', '0'], ['9', '3'], ['0', '100'], ['-100', '-1'], ['-10', '10'],
    ['-4611686018427387904', '4611686018427387903'], ['4611686018427387900', '4611686018427387903'],
    ['-4611686018427387904', '-4611686018427387900']];
  compare(seeds.slice(0, 12).flatMap(seed => ranges.map(([lo, hi]) => ['range', seed, lo, hi])),
    ([kind, seed, lo, hi]) => text(e.std_prngRange(toBytes(seed), toBytes(lo), toBytes(hi))));
  for (const bad of ['4611686018427387904', '-4611686018427387905', '-', 'NaN'])
    assert.equal(text(e.std_prngRange(toBytes('0'), toBytes(bad), toBytes('5'))), 'none');
});
test('wrapping arithmetic and xor match independent BigInt operations', () => {
  const values = seeds.map(BigInt);
  for (const [index, a] of values.entries()) {
    const b = values[(index * 7 + 3) % values.length];
    const left = toBytes(String(a)), right = toBytes(String(b));
    assert.equal(text(e.std_wordXor(left, right)), String(a ^ b));
    assert.equal(text(e.std_wordMul(left, right)), String((a * b) & max));
    assert.equal(text(e.std_wordAdd(left, right)), String((a + b) & max));
  }
});
test('generic nonempty operations match the original module', () => {
  const lists = [[], [0], [255], [2, 3], [4, 5], [2], [2, 3, 4], [3, 2], [1, 2, 3],
    ...Array.from({ length: 20 }, (_, index) => Array.from({ length: index + 1 }, byte))];
  const kinds = ['head', 'last', 'length', 'fold', 'map', 'append', 'compare', 'equal'];
  const rows = lists.flatMap(list => kinds.map(kind => [kind, list.length ? list.join(',') : 'empty']));
  compare(rows, ([kind, csv]) => {
    const list = csv === 'empty' ? [] : csv.split(',').map(Number);
    const output = fromBytes(e[`std_${kind}`](toBytes(Buffer.from([list.length, ...list]))));
    if (['map', 'append'].includes(kind) && csv !== 'empty') return output.toString('hex');
    return output.toString('utf8');
  });
  assert.equal(text(e.std_singleton()), '42');
});
