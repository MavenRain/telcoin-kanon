import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after } from 'node:test';
import { build, project } from '../scripts/build.mjs';
import { byteAdapter } from '../runtime.mjs';

const directory = mkdtempSync(join(tmpdir(), 'telcoin-foundation-'));
after(() => rmSync(directory, { recursive: true, force: true }));
const lock = JSON.parse(readFileSync(resolve(project, 'source-lock.json'), 'utf8'));
const upstream = process.env.TELCOIN_OCAML_ROOT ?? lock.upstream.root;
const oracleSources = ['lib/codec/bcs.ml', 'lib/types/round.ml', 'lib/types/units.ml', 'lib/types/leader_round.ml'];
for (const path of oracleSources) {
  const actual = createHash('sha256').update(readFileSync(resolve(upstream, path))).digest('hex');
  assert.equal(actual, lock.upstream.files.find(file => file.path === path)?.sha256, `Oracle source drift: ${path}`);
  copyFileSync(resolve(upstream, path), join(directory, path.split('/').at(-1)));
}
copyFileSync(resolve(project, 'test/oracle.ml'), join(directory, 'oracle.ml'));
const compiled = spawnSync('opam', ['exec', `--switch=${process.env.OCAML_SWITCH ?? 'tn-ocaml'}`, '--', 'ocamlc',
  '-o', 'oracle.exe', ...oracleSources.map(path => path.split('/').at(-1)), 'oracle.ml'],
{ cwd: directory, encoding: 'utf8', timeout: 30000 });
assert.equal(compiled.status, 0, compiled.error?.message ?? compiled.stderr);

const publicExports = JSON.parse(readFileSync(resolve(project, 'exports.json'), 'utf8'));
const extraExports = [...readFileSync(resolve(project, 'test/fixture.kan'), 'utf8').matchAll(/^def (fx\w+) :/gm)].map(match => match[1]);
const wasm = join(directory, 'foundation.wasm');
build(wasm, [...publicExports, ...extraExports], [resolve(project, 'test/fixture.kan')]);
const { instance } = await WebAssembly.instantiate(readFileSync(wasm), {});
const e = instance.exports;
const { toBytes, fromBytes } = byteAdapter(e);
const text = value => fromBytes(value).toString('utf8');
const finish = value => value.startsWith('error: ') ? value : `ok:${value}`;
function decode(kind, hex) {
  const input = toBytes(Buffer.from(hex, 'hex'));
  if (['prefix32', 'prefixuleb', 'offsetuleb'].includes(kind)) return finish(text(e[`fx${kind}`](input)));
  if (kind === 'option') return finish(text(e.bcsOptionText(e.bcsDecodeOptionU8(input))));
  if (['bytes', 'fixed3', 'sized3'].includes(kind)) {
    const value = kind === 'bytes' ? e.bcsDecodeBytes(input)
      : kind === 'fixed3' ? e.bcsDecodeFixedBytes(3, input) : e.bcsDecodeSizedBytes(3, input);
    return e.bcsBytesIsOk(value) ? `ok:${fromBytes(e.bcsBytesText(value)).toString('hex')}` : text(e.bcsBytesText(value));
  }
  const name = { u8: 'U8', u16: 'U16', u32: 'U32', u64: 'U64', uleb: 'Uleb', bool: 'Bool' }[kind];
  return finish(text(e.bcsNatText(e[`bcsDecode${name}`](input))));
}
function encode(kind, decimal) {
  const name = { u8: 'U8', u16: 'U16', u32: 'U32', u64: 'U64', uleb: 'Uleb' }[kind];
  const result = e[`bcsWrite${name}`](toBytes(decimal));
  assert.equal(e.bcsWriteIsOk(result), 1, `encode ${kind} ${decimal}`);
  return `ok:${fromBytes(e.bcsWriteBytes(result)).toString('hex')}`;
}
function scalar(kind, value) {
  return `ok:${text(e[`fx${kind}`] ? e[`fx${kind}`](toBytes(value)) : e[`${kind}Text`](e[`${kind}Parse`](toBytes(value))))}`;
}
function oracle(rows) {
  const result = spawnSync(join(directory, 'oracle.exe'), [], { input: `${rows.map(row => row.join(' ')).join('\n')}\n`,
    encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  const lines = result.stdout.trimEnd().split('\n');
  assert.equal(lines.length, rows.length, 'Every oracle request must receive an answer.');
  return lines;
}
let differentialRows = 0;
function compare(rows) {
  const expected = oracle(rows);
  for (const [i, [operation, kind, value]] of rows.entries()) {
    const actual = operation === 'decode' ? decode(kind, value) : operation === 'encode' ? encode(kind, value) : scalar(kind, value);
    assert.equal(actual, expected[i], rows[i].join(' '));
  }
  differentialRows += rows.length;
}
after(() => console.log(`OCaml differential rows: ${differentialRows}`));

test('decimal transport preserves the full u64 range and rejects invalid numbers', () => {
  for (const value of ['0', '1073741824', '4294967295', '9223372036854775808', '18446744073709551615'])
    assert.equal(text(e.natOptionText(e.parseU64(toBytes(value)))), value);
  for (const value of ['', '-1', '+1', ' 1', '1 ', '1.0', '1x', '18446744073709551616', '9'.repeat(100)])
    assert.equal(text(e.natOptionText(e.parseU64(toBytes(value)))), 'none');
  assert.equal(text(e.natOptionText(e.parseU64(toBytes('00042')))), '42');
});

test('fixed-width and ULEB encoders match independent golden bytes', () => {
  for (const [kind, input, expected] of [
    ['u8', '1', '01'], ['u16', '258', '0201'], ['u32', '16909060', '04030201'],
    ['u64', '1', '0100000000000000'], ['u64', '18446744073709551615', 'ffffffffffffffff'],
    ['uleb', '0', '00'], ['uleb', '127', '7f'], ['uleb', '128', '8001'],
    ['uleb', '16384', '808001'], ['uleb', '4294967295', 'ffffffff0f'],
  ]) assert.equal(encode(kind, input), `ok:${expected}`);
});

test('encoders retain OCaml low-byte truncation semantics', () => {
  const rows = [];
  for (const kind of ['u8', 'u16', 'u32', 'u64', 'uleb'])
    for (const value of ['0', '1', '127', '128', '255', '256', '65535', '65536', '4294967295', '4294967296', '4611686018427387903'])
      rows.push(['encode', kind, value]);
  rows.push(['encode', 'u64', '18446744073709551615']);
  compare(rows);
});

test('all bool bytes and option tags match the OCaml acceptance matrix', () => {
  const rows = [];
  for (let byte = 0; byte < 256; byte++) for (const kind of ['bool', 'option'])
    rows.push(['decode', kind, byte.toString(16).padStart(2, '0')]);
  rows.push(['decode', 'option', '0105'], ['decode', 'option', '0000']);
  compare(rows);
});

test('ULEB canonicality, overflow precedence, offsets and sequence limits match OCaml', () => {
  const inputs = ['', '00', '7f', '8001', '808001', 'ffffffff0f', '80', '8000', '818000', '8080808000',
    '8080808080', '8080808010', 'ffffffff7f', 'ffffffff8f00', 'ffffffff0f00', '8080808008', 'ffffffff07'];
  const rows = [];
  for (const kind of ['uleb', 'bytes', 'sized3', 'prefixuleb']) for (const input of inputs) rows.push(['decode', kind, input]);
  for (const input of inputs) rows.push(['decode', 'offsetuleb', `07${input}`]);
  compare(rows);
  assert.equal(decode('uleb', '8080808000'), 'error: non-canonical ULEB128 at offset 0');
  assert.equal(decode('bytes', '8080808008'), 'error: length 2147483648 out of range at offset 0');
  assert.equal(decode('offsetuleb', '078000'), 'error: non-canonical ULEB128 at offset 1');
});

test('integer truncation and raw-byte reads retain distinct error offsets', () => {
  const rows = [];
  for (const kind of ['u8', 'u16', 'u32', 'u64', 'bytes', 'fixed3', 'sized3', 'prefix32'])
    for (let length = 0; length <= 10; length++) rows.push(['decode', kind, '01'.repeat(length)]);
  compare(rows);
  assert.equal(decode('u32', '0102'), 'error: unexpected end of input at offset 2 (wanted 1 bytes)');
  assert.equal(decode('u64', '0102'), 'error: unexpected end of input at offset 0 (wanted 8 bytes)');
});

test('bytes framing and payload contents are exact, including every byte value', () => {
  const payload = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  assert.equal(fromBytes(e.bcsEncodeBytes(toBytes(payload))).toString('hex'), `8002${payload.toString('hex')}`);
  compare([['decode', 'bytes', `8002${payload.toString('hex')}`], ['decode', 'fixed3', 'ff0080'],
    ['decode', 'sized3', '03ff0080'], ['decode', 'sized3', '02ffff'], ['decode', 'bytes', '03626373']]);
});

let randomState = 0x131044;
function randomByte() { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState >>> 24; }
test('deterministic malformed-input corpus agrees with the pinned decoder', () => {
  const rows = [];
  for (let index = 0; index < 64; index++) {
    const hex = Buffer.from(Array.from({ length: index % 13 }, randomByte)).toString('hex');
    for (const kind of ['u32', 'u64', 'uleb', 'bytes', 'option', 'offsetuleb']) rows.push(['decode', kind, hex]);
  }
  compare(rows);
});

test('scalar construction and saturation agree across domain boundaries', () => {
  const rows = [];
  for (const kind of ['round', 'epoch', 'workerId', 'stake', 'duration', 'leaderRound', 'roundNext', 'roundPrev', 'epochNext', 'leaderPrev', 'durationHalf'])
    for (const n of ['-1', '0', '1', '2', '3', '4', '65535', '65536', '4294967294', '4294967295', '4294967296'])
      rows.push(['scalar', kind, n]);
  for (const n of ['0', '1', '9223372036854775806', '9223372036854775807']) rows.push(['scalar', 'timestamp', n]);
  for (const n of ['2', '4', '100', '4294967292']) rows.push(['scalar', 'leaderNext', n]);
  compare(rows);
});

test('leader-round exhaustion is an explicit recorded correction to upstream', () => {
  assert.equal(oracle([['scalar', 'leaderNext', '4294967294']])[0], 'ok:4294967295');
  assert.equal(scalar('leaderNext', '4294967294'), 'ok:none');
  assert.equal(scalar('leaderRound', '4294967295'), 'ok:none');
  assert.equal(text(e.fxLeaderIndex()), '2147483646');
});

test('overflow-safe units and signed packed sequence semantics', () => {
  assert.equal(text(e.fxTimestampSaturate()), '9223372036854775807');
  assert.equal(text(e.fxStakeOverflow()), 'none');
  assert.equal(text(e.fxDurationOverflow()), 'none');
  assert.equal(text(e.fxSequenceMax()), '18446744073709551615');
  assert.equal(e.fxSequenceSigned(), 1);
  assert.equal(text(e.fxSequenceEpoch()), '4294967295');
  assert.equal(text(e.fxSequenceRound()), '123');
  assert.equal(text(e.baseFeeText(e.baseFeeParse(toBytes('18446744073709551615')))), '18446744073709551615');
});

test('bounded division matches independent BigInt arithmetic', () => {
  const values = [0n, 1n, 127n, 256n, 4294967295n, 9223372036854775808n, 18446744073709551615n];
  for (let i = 0; i < 16; i++) values.push(BigInt(`0x${Buffer.from(Array.from({ length: 8 }, randomByte)).toString('hex')}`));
  for (const value of values) for (const divisor of [1n, 2n, 3n, 10n, 128n, 256n, 65537n, 18446744073709551615n])
    assert.equal(text(e.fxDivision(toBytes(String(value)), toBytes(String(divisor)))), `${value / divisor}:${value % divisor}`);
});

test('nonempty Nat-list accessors preserve their witnesses', () => {
  assert.equal(e.fxNonemptyHead(), 7);
  assert.equal(e.fxNonemptyLast(), 9);
  assert.equal(e.fxNonemptySingleton(), 7);
});

test('host adapter refuses coercive byte inputs', () => {
  for (const input of [[256], [-1], [1.5], 1, null, {}]) assert.throws(() => toBytes(input), TypeError);
});
