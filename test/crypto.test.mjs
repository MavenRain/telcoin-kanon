import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after } from 'node:test';
import { build, project } from '../scripts/build.mjs';
import { byteAdapter } from '../runtime.mjs';
const directory = mkdtempSync(join(tmpdir(), 'telcoin-crypto-'));
after(() => rmSync(directory, { recursive: true, force: true }));
const lock = JSON.parse(readFileSync(resolve(project, 'source-lock.json'), 'utf8'));
const upstream = process.env.TELCOIN_OCAML_ROOT ?? lock.upstream.root;
const files = ['lib/crypto_stub/tn_crypto.ml', 'lib/types/round.ml', 'lib/types/units.ml', 'lib/types/authority_id.ml', 'lib/types/authority.ml', 'lib/types/committee.ml'];
for (const path of files) {
  assert.equal(createHash('sha256').update(readFileSync(resolve(upstream, path))).digest('hex'), lock.upstream.files.find(f => f.path === path)?.sha256);
  copyFileSync(resolve(upstream, path), join(directory, path.split('/').at(-1)));
}
copyFileSync(resolve(project, 'test/oracle_bytes.ml'), join(directory, 'oracle_bytes.ml'));
copyFileSync(resolve(project, 'test/crypto-oracle.ml'), join(directory, 'oracle.ml'));
const compiled = spawnSync('opam', ['exec', `--switch=${process.env.OCAML_SWITCH ?? 'tn-ocaml'}`, '--', 'ocamlfind', 'ocamlc',
  '-package', 'digestif.c', '-linkpkg', '-custom', '-o', 'oracle.exe', ...files.map(path => path.split('/').at(-1)), 'oracle_bytes.ml', 'oracle.ml'],
{ cwd: directory, encoding: 'utf8', timeout: 30000 });
assert.equal(compiled.status, 0, compiled.error?.message ?? compiled.stderr);
const fixture = resolve(project, 'test/crypto.kan');
const names = [...readFileSync(fixture, 'utf8').matchAll(/^def (crypto_\w+) :/gm)].map(match => match[1]);
const wasm = join(directory, 'crypto.wasm');
build(wasm, ['emptyBytes', 'consBytes', 'bytesEmpty', 'bytesHead', 'bytesTail', 'seqBytesEmpty', 'seqBytesCons', ...names], [fixture]);
const { instance } = await WebAssembly.instantiate(readFileSync(wasm), {});
const e = instance.exports;
const { toBytes, fromBytes } = byteAdapter(e);
const text = value => fromBytes(value).toString('utf8');
const raw = hex => toBytes(Buffer.from(hex, 'hex'));
function seeds(csv) {
  let result = e.seqBytesEmpty();
  for (const seed of (csv === 'empty' ? [] : csv.split(',')).reverse()) result = e.seqBytesCons(toBytes(seed), result);
  return result;
}
function evaluate([kind, ...args]) {
  if (kind === 'key') return text(e.crypto_key(toBytes(args[0])));
  if (kind === 'sign') return text(e.crypto_sign(toBytes(args[0]), raw(args[1])));
  if (kind === 'signature') return text(e.crypto_signature(raw(args[0])));
  if (kind === 'verify') return text(e.crypto_verify(toBytes(args[0]), raw(args[1]), raw(args[2])));
  if (kind === 'aggregate') return text(e.crypto_aggregate(seeds(args[0]), raw(args[1])));
  if (kind === 'verifyAggregate') return text(e.crypto_verifyAggregate(seeds(args[0]), raw(args[1]), raw(args[2])));
  if (kind === 'describe') return text(e.crypto_describe(seeds(args[0])));
  if (kind === 'nth') return text(e.crypto_nth(seeds(args[0]), toBytes(args[1])));
  if (kind === 'index') return text(e.crypto_index(seeds(args[0]), toBytes(args[1])));
  if (kind === 'stake') return text(e.crypto_stake(seeds(args[0]), seeds(args[1])));
  throw new Error(`Unknown operation ${kind}`);
}
let rowsChecked = 0;
function compare(rows) {
  const result = spawnSync(join(directory, 'oracle.exe'), [], { input: `${rows.map(row => row.join(' ')).join('\n')}\n`, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  const expected = result.stdout.trimEnd().split('\n');
  assert.equal(expected.length, rows.length);
  for (const [i, row] of rows.entries()) assert.equal(evaluate(row), expected[i], row.join(' '));
  rowsChecked += rows.length;
}
after(() => console.log(`Crypto/committee OCaml differential rows: ${rowsChecked}`));
const seedValues = ['0', '1', '2', '42', '4294967295', '9223372036854775808', '18446744073709551615'];
test('derived keys and signatures agree with the actual OCaml simulation profile', () => {
  compare(seedValues.flatMap(seed => [['key', seed], ...['', '00', '616263', 'ff'.repeat(128)].map(message => ['sign', seed, message])]));
});
test('signature parsing preserves the source separator behavior and verification matrix', () => {
  const signature = evaluate(['sign', '1', '616263']);
  const otherMessage = evaluate(['sign', '1', '00']);
  const alteredSeparator = `${signature.slice(0, 64)}ff${signature.slice(66)}`;
  compare([
    ['signature', ''], ['signature', signature.slice(2)], ['signature', `${signature}00`], ['signature', alteredSeparator],
    ['verify', '1', '616263', signature], ['verify', '2', '616263', signature], ['verify', '1', '00', signature],
    ['verify', '1', '616263', otherMessage], ['verify', '1', '616263', alteredSeparator],
  ]);
  assert.equal(evaluate(['signature', alteredSeparator]), signature);
});
test('aggregates are canonical and preserve the source membership semantics', () => {
  const message = '010203';
  const aggregate = evaluate(['aggregate', '1,2,3', message]);
  const reversed = aggregate.match(/.{130}/g).reverse().join('');
  const duplicate = evaluate(['aggregate', '1,1', message]);
  compare([
    ['aggregate', 'empty', message], ['aggregate', '3,1,2', message], ['aggregate', '1,1', message],
    ['verifyAggregate', '3,1,2', message, aggregate], ['verifyAggregate', '1,2,3', message, reversed],
    ['verifyAggregate', '1,2', message, aggregate], ['verifyAggregate', '1,2,4', message, aggregate],
    ['verifyAggregate', '1,2,3', '00', aggregate], ['verifyAggregate', '1,1', message, duplicate],
    ['verifyAggregate', 'empty', message, ''], ['verifyAggregate', '1', message, '00'],
  ]);
  assert.equal(evaluate(['aggregate', '3,1,2', message]), aggregate);
});
test('committee rejection, canonical roster and threshold table match source', () => {
  const rosters = ['empty', '1', '1,1', '2,1', '4,3,2,1', '1,2,3,4,5,6,7', '1,2,3,4,5,6,7,8,9,10', '1,2,1'];
  compare(rosters.map(roster => ['describe', roster]));
  assert.equal(evaluate(['describe', '4,3,2,1']).split(':').slice(0, 4).join(':'), '4:4:3:2');
  assert.equal(evaluate(['describe', '1,2,3,4,5,6,7']).split(':').slice(0, 4).join(':'), '7:7:5:3');
});
test('committee indices, signed wrapping and set stake match source', () => {
  const roster = '4,3,2,1';
  compare([
    ...['-4611686018427387904', '-9', '-4', '-1', '0', '1', '3', '4', '9', '4611686018427387903'].map(index => ['nth', roster, index]),
    ...['1', '2', '3', '4', '5'].map(seed => ['index', roster, seed]),
    ...['empty', '1', '1,1', '1,2', '1,2,3,4', '1,2,3,4,5', '5'].map(selected => ['stake', roster, selected]),
  ]);
});
test('committee equality notices a changed withdrawal address', () => {
  assert.equal(e.crypto_rosterAddressMismatch(1), 0);
});
