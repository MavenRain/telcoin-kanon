import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after } from 'node:test';
import { build, project } from '../scripts/build.mjs';
import { byteAdapter } from '../runtime.mjs';

const directory = mkdtempSync(join(tmpdir(), 'telcoin-protocol-'));
after(() => rmSync(directory, { recursive: true, force: true }));
const lock = JSON.parse(readFileSync(resolve(project, 'source-lock.json'), 'utf8'));
const upstream = process.env.TELCOIN_OCAML_ROOT ?? lock.upstream.root;
function pinned(path) {
  const bytes = readFileSync(resolve(upstream, path));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), lock.upstream.files.find(f => f.path === path)?.sha256, path);
  return bytes.toString('utf8');
}
const files = ['lib/codec/bcs.ml', 'lib/crypto_stub/tn_crypto.ml', 'lib/types/round.ml', 'lib/types/units.ml',
  'lib/types/authority_id.ml', 'lib/types/authority.ml', 'lib/types/committee.ml', 'lib/types/digests.ml',
  'lib/keccak/tn_keccak.ml', 'lib/hash32/hash32.ml', 'lib/types/block_num_hash.ml', 'lib/types/batch.ml',
  'lib/vertex/intent.ml', 'lib/vertex/header.ml', 'lib/vertex/vote.ml', 'lib/vertex/certificate.ml'];
for (const path of files) writeFileSync(join(directory, path.split('/').at(-1)), pinned(path));
const aliases = {
  'tn_codec.ml': 'module Bcs = Bcs\n',
  'tn_hash32.ml': 'module Hash32 = Hash32\n',
  'tn_types.ml': ['Round', 'Units', 'Authority_id', 'Authority', 'Committee', 'Digests', 'Block_num_hash', 'Batch'].map(name => `module ${name} = ${name}\n`).join(''),
};
for (const [path, text] of Object.entries(aliases)) writeFileSync(join(directory, path), text);
copyFileSync(resolve(project, 'test/oracle_bytes.ml'), join(directory, 'oracle_bytes.ml'));
copyFileSync(resolve(project, 'test/protocol-oracle.ml'), join(directory, 'oracle.ml'));
const modules = ['bcs.ml', 'tn_codec.ml', 'tn_crypto.ml', 'round.ml', 'units.ml', 'authority_id.ml', 'authority.ml', 'committee.ml',
  'digests.ml', 'tn_keccak.ml', 'hash32.ml', 'tn_hash32.ml', 'block_num_hash.ml', 'batch.ml', 'tn_types.ml', 'intent.ml', 'header.ml', 'vote.ml', 'certificate.ml', 'oracle_bytes.ml', 'oracle.ml'];
const compiled = spawnSync('opam', ['exec', `--switch=${process.env.OCAML_SWITCH ?? 'tn-ocaml'}`, '--', 'ocamlfind', 'ocamlc',
  '-package', 'digestif.c', '-linkpkg', '-custom', '-o', 'oracle.exe', ...modules], { cwd: directory, encoding: 'utf8', timeout: 30000 });
assert.equal(compiled.status, 0, compiled.error?.message ?? compiled.stderr);
const fixture = resolve(project, 'test/protocol.kan');
const names = [...readFileSync(fixture, 'utf8').matchAll(/^def (protocol_\w+) :/gm)].map(match => match[1]);
const wasm = join(directory, 'protocol.wasm');
build(wasm, ['emptyBytes', 'consBytes', 'bytesEmpty', 'bytesHead', 'bytesTail', 'seqBytesEmpty', 'seqBytesCons', ...names], [resolve(project, 'test/crypto.kan'), fixture]);
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
function evaluate([kind, input, ...args]) {
  if (['batch', 'sealed', 'skip', 'header', 'block'].includes(kind)) return text(e[`protocol_${kind}`](raw(input)));
  if (kind === 'blockCompare') return text(e.protocol_blockCompare(raw(input), raw(args[0])));
  if (kind === 'validate') return text(e.protocol_validate(raw(input), seeds(args[0])));
  if (kind === 'vote') return text(e.protocol_vote(raw(input), toBytes(args[0])));
  if (kind === 'assemble') return text(e.protocol_assemble(raw(input), seeds(args[0]), seeds(args[1]), { good: 0, wrong: 1, bad: 2, metadata: 3 }[args[2]]));
  if (kind === 'claim') return text(e.protocol_claim(raw(input), seeds(args[0]), seeds(args[1]), raw(args[2] === 'none' ? '' : args[2]), Number(args[2] === 'none')));
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
after(() => console.log(`Protocol OCaml differential rows: ${rowsChecked}`));
function constants(path) {
  return Object.fromEntries([...pinned(path).matchAll(/let (\w+) =\s*"([0-9a-f]+)"/g)].map(match => [match[1], match[2]]));
}
const batches = constants('test/batch_vectors.ml');
const headers = constants('test/header_vectors.ml');
const u32 = value => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b.toString('hex'); };
const u64 = value => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b.toString('hex'); };
const hash = bytes => createHash('blake2s256').update(bytes).digest();
const author = seed => hash(hash(Buffer.concat([Buffer.from('tn-stub-secret:'), Buffer.from(u64(seed), 'hex')]))).toString('hex');
const anchor = (number = 0, hex = '00'.repeat(32)) => `${u64(number)}20${hex}`;
const header = ({ seed = 1, round = 0, epoch = 0, time = 0, payload = '00', parents = '00', block = anchor() } = {}) =>
  `${author(seed)}${u32(round)}${u32(epoch)}${u64(time)}${payload}${parents}${block}`;

test('batch golden bytes, simulation digests, receipt-time skip and unverified sealed claims match source', () => {
  const values = Object.entries(batches).filter(([name]) => /^v\d+_preimage$/.test(name)).map(([, value]) => value);
  compare(values.flatMap(value => [['batch', value], ['skip', value], ['sealed', `${value}20${'ff'.repeat(32)}`]]));
  for (const value of values) {
    assert.equal(evaluate(['batch', value]), `ok:${value}:${hash(Buffer.from(value, 'hex')).toString('hex')}`);
    assert.equal(evaluate(['skip', value]), '0:1:1');
  }
});
test('header golden bytes, duplicate payload normalization and timestamp refusal match source', () => {
  const values = Object.entries(headers).filter(([name]) => name.endsWith('_bcs')).map(([, value]) => value);
  compare(values.map(value => ['header', value]));
  assert.equal(evaluate(['header', headers.h_dup_wire_bcs]), evaluate(['header', headers.h_dup_bcs]));
  assert.match(evaluate(['header', headers.h_ts_bcs]), /^error:/);
  const a = `20${'aa'.repeat(32)}`, b = `20${'bb'.repeat(32)}`;
  const duplicate = header({ payload: `03${a}0100${b}0200${a}0300`, parents: `03${b}${a}${b}` });
  const canonical = header({ payload: `02${a}0300${b}0200`, parents: `02${a}${b}` });
  compare([['header', duplicate], ['header', canonical]]);
  assert.equal(evaluate(['header', duplicate]), evaluate(['header', canonical]));
});
test('every truncation and malformed width, count and trailing byte preserves the OCaml codec error', () => {
  const rows = [];
  for (const [kind, value] of [['batch', batches.v5_preimage], ['sealed', `${batches.v1_preimage}20${'11'.repeat(32)}`], ['header', headers.h4_bcs], ['block', anchor()]]) {
    for (let end = 0; end < value.length; end += 2) rows.push([kind, value.slice(0, end)]);
    rows.push([kind, `${value}00`]);
  }
  rows.push(['batch', `000000000013${'00'.repeat(19)}${'00'.repeat(10)}`], ['batch', 'ffffffff07'],
    ['header', `${header().slice(0, 96)}ffffffff0f`], ['header', `${header().slice(0, 96)}8000`],
    ['header', header({ time: '9223372036854775807' })], ['header', header({ time: '9223372036854775808' })],
    ['block', `${u64(0)}1f${'00'.repeat(31)}`]);
  compare(rows);
});
test('execution anchors retain full u64 bits and signed comparison', () => {
  const numbers = [0n, 1n, (1n << 63n) - 1n, 1n << 63n, (1n << 64n) - 1n];
  compare(numbers.flatMap(a => [['block', anchor(a)], ...numbers.map(b => ['blockCompare', anchor(a), anchor(b)])]));
  compare([['blockCompare', anchor(1, '01'.repeat(32)), anchor(1, '02'.repeat(32))]]);
});
test('header validation order and vote intent bytes match source', () => {
  compare([
    ...[header(), header({ round: 1 }), header({ round: 1, parents: `0120${'01'.repeat(32)}` }), header({ seed: 99 }), header({ seed: 99, epoch: 1 })].map(value => ['validate', value, '1,2,3,4']),
    ...['0', '1', '2', '18446744073709551615'].flatMap(seed => [['vote', header(), seed], ['vote', headers.h4_bcs, seed]]),
  ]);
  assert.equal(evaluate(['vote', header(), '1']).split(':')[1].slice(0, 8), '02000120');
});
test('certificate quorum, invalid-vote precedence and aggregate verification match source', () => {
  const h = header({ round: 1, parents: `0120${'01'.repeat(32)}` });
  compare([
    ...['empty', '1', '1,2', '1,2,3', '4,3,2,1', '1,1', '1,2,99'].map(voters => ['assemble', h, '1,2,3,4', voters, 'good']),
    ...['wrong', 'bad', 'metadata'].map(mode => ['assemble', h, '1,2,3,4', '1,2,3', mode]),
  ]);
  const aggregate = evaluate(['assemble', h, '1,2,3,4', '1,2,3', 'good']).split(':')[2];
  compare([
    ['claim', h, '1,2,3,4', '1,2,3', aggregate], ['claim', h, '1,2,3,4', '1,1,2,3', aggregate],
    ['claim', h, '1,2,3,4', '1,2', aggregate], ['claim', h, '1,2,3,4', '1,2,99', aggregate],
    ['claim', h, '1,2,3,4', '1,2,3', '00'], ['claim', h, '1,2,3,4', '1,2,3', ''],
    ['claim', header({ round: 2 }), '1,2,3,4', '1,2,3', aggregate],
  ]);
});
test('genesis claims require an exact canonical committee genesis header', () => {
  compare([
    ...[1, 2, 3, 4, 99].map(seed => ['claim', header({ seed }), '1,2,3,4', 'empty', 'none']),
    ...[header({ time: 1 }), header({ epoch: 1 }), header({ round: 1 }), header({ block: anchor(1) })].map(h => ['claim', h, '1,2,3,4', 'empty', 'none']),
    ['claim', header(), '1,2,3,4', '99', 'none'],
  ]);
});
