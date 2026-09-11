import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { build, project } from '../scripts/build.mjs';
import { compileOracle, protocolSources, protocolModules } from './harness.mjs';
import { parseOcamlInteger } from '../sim-cli.mjs';

mkdirSync(resolve(project, 'build'), { recursive: true });
build(resolve(project, 'build/telcoin-foundation.wasm'), JSON.parse(readFileSync(resolve(project, 'exports.json'), 'utf8')));
const run = args => spawnSync(process.execPath, [resolve(project, 'cli.mjs'), ...args], { encoding: 'utf8', timeout: 10000 });
const consensusModules = ['dag', 'reputation_scores', 'sub_dag', 'committed_log', 'leader_schedule', 'bullshark', 'proposer', 'voter', 'vote_aggregator', 'parent_aggregator', 'node'];
const executionModules = ['consensus_block', 'consensus_chain', 'nothing', 'engine'];
const sourceLock = JSON.parse(readFileSync(resolve(project, 'source-lock.json'), 'utf8'));
const simOracle = compileOracle({ name: 'cli-sim', sources: [...protocolSources, 'lib/std/nonempty.ml', 'lib/std/prng.ml', 'lib/types/leader_round.ml', 'lib/rand/chacha12.ml', 'lib/rand/std_rng.ml',
  ...consensusModules.map(name => `lib/consensus/${name}.ml`), ...executionModules.map(name => `lib/execution/${name}.ml`), 'lib/sim/sim.ml', 'bin/tn_sim.ml'],
  modules: [...protocolModules, 'nonempty.ml', 'prng.ml', 'tn_std.ml', 'leader_round.ml', 'chacha12.ml', 'std_rng.ml', 'tn_rand.ml',
    ...consensusModules.map(name => `${name}.ml`), 'tn_consensus.ml', ...executionModules.map(name => `${name}.ml`), 'tn_execution.ml', 'sim.ml', 'tn_sim.ml'],
  extraAliases: { 'tn_std.ml': ['Nonempty', 'Prng'], 'tn_rand.ml': ['Std_rng'], 'tn_consensus.ml': consensusModules.map(name => name[0].toUpperCase() + name.slice(1)),
    'tn_execution.ml': ['Consensus_block', 'Nothing', 'Engine'], 'tn_sim.ml': ['Sim'] },
  oracle: resolve(process.env.TELCOIN_OCAML_ROOT ?? sourceLock.upstream.root, 'bin/tn_sim.ml') });
test('simulator CLI matches the original executable reports and exit statuses', () => {
  for (const args of [[], ['--until-s', '2', '--seed', '-1'], ['--until-s', '1', '--validators', '7'],
    ['--until-s', '0', '--validators', '-3'], ['--until-s', '1', '--seed', '0xffffffffffffffff'], ['--until-s', '1', '--seed', 'bad', '--seed', '7']]) {
    const expected = simOracle.runOracle(args);
    assert.ok(expected.status === 0 || expected.status === 1, expected.stderr);
    const actual = spawnSync(process.execPath, [resolve(project, 'cli.mjs'), 'simulate', ...args], { encoding: 'utf8', timeout: 180000 });
    assert.equal(actual.status, expected.status, actual.error?.message ?? actual.stderr);
    assert.equal(actual.stderr, '');
    assert.match(actual.stdout, /^telcoin-kanon simulator: /);
    assert.equal(actual.stdout.split('\n').slice(1).join('\n'), expected.stdout.split('\n').slice(1).join('\n'), args.join(' '));
  }
});
test('simulator numeric flags support source integer widths, signs, prefixes and fallback', () => {
  for (const [text, bits, expected] of [['+42', 63, 42n], ['1_000', 63, 1000n], ['0b101', 63, 5n], ['0o77', 63, 63n],
    ['0xffffffffffffffff', 64, -1n], ['-9223372036854775808', 64, -9223372036854775808n], ['4611686018427387904', 63, undefined],
    ['9223372036854775808', 64, undefined], ['0x', 64, undefined], ['bad', 64, undefined]]) assert.equal(parseOcamlInteger(text, bits), expected);
});
test('CLI encodes and decodes full-width protocol data', () => {
  for (const [args, output] of [
    [['bcs', 'encode', 'u64', '18446744073709551615'], 'ffffffffffffffff\n'],
    [['bcs', 'decode', 'u32', '04030201'], '16909060\n'],
    [['bcs', 'decode', 'u64', 'ffffffffffffffff'], '18446744073709551615\n'],
    [['bcs', 'decode', 'bytes', '03ff0080'], 'ff0080\n'],
    [['bcs', 'decode', 'option-u8', '00'], 'none\n'],
    [['scalar', 'leaderRound', '4'], '4\n'],
  ]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, output);
    assert.equal(result.stderr, '');
  }
});
test('CLI reports domain failures distinctly from usage errors', () => {
  for (const [args, status, message] of [
    [[], 64, 'Usage:'],
    [['bcs', 'decode', 'constructor', '00'], 64, 'Usage:'],
    [['bcs', 'decode', 'u32', 'abc'], 1, 'complete byte pairs'],
    [['bcs', 'decode', 'u32', 'zz'], 1, 'complete byte pairs'],
    [['bcs', 'decode', 'uleb', '8000'], 1, 'non-canonical ULEB128 at offset 0'],
    [['bcs', 'encode', 'u64', '18446744073709551616'], 1, 'unsigned decimal'],
    [['scalar', 'leaderRound', '3'], 1, 'none'],
    [['simulation', 'sign', '1', 'abc'], 1, 'complete byte pairs'],
    [['simulation', 'key', '18446744073709551616'], 1, 'unsigned decimal'],
    [['simulation', 'committee', '1,1'], 1, 'duplicate'],
    [['simulation', 'committee', '1,no'], 1, 'unsigned decimal'],
    [['prng', 'next', '-1'], 1, 'unsigned decimal'],
    [['wire', 'header', '00'], 1, 'unexpected end'],
    [['bcs', 'normalize', 'map-u8-u16', '02020000010000'], 1, 'out of range'],
  ]) {
    const result = run(args);
    assert.equal(result.status, status, result.stderr);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.includes(message), result.stderr);
  }
});
test('public CLI exposes simulation hashing, signing, committee and deterministic random draws', () => {
  const hash = createHash('blake2s256').update('abc').digest('hex');
  const hashed = run(['simulation', 'hash', '616263']);
  assert.equal(hashed.status, 0, hashed.stderr);
  assert.deepEqual(JSON.parse(hashed.stdout), { profile: 'simulation-stub:blake2s256', digest: hash });
  const key = run(['simulation', 'key', '1']);
  assert.equal(key.status, 0, key.stderr);
  const signed = run(['simulation', 'sign', '1', '616263']);
  assert.equal(signed.status, 0, signed.stderr);
  assert.equal(JSON.parse(signed.stdout).signature, `${JSON.parse(key.stdout).publicKey}00${hash}`);
  const committee = run(['simulation', 'committee', '4,3,2,1']);
  assert.equal(committee.status, 0, committee.stderr);
  const roster = JSON.parse(committee.stdout);
  assert.equal(roster.size, 4);
  assert.equal(roster.quorum, 3);
  assert.equal(roster.validity, 2);
  assert.deepEqual(roster.authorities, [...roster.authorities].sort());
  const next = run(['prng', 'next', '0']);
  assert.equal(next.status, 0, next.stderr);
  assert.deepEqual(JSON.parse(next.stdout), { value: '16294208416658607535', state: '11400714819323198485' });
  assert.equal(run(['prng', 'split', '18446744073709551615']).status, 0);
});
test('public CLI normalizes collections and inspects protocol bytes without changing sealed claims', () => {
  const normalized = run(['bcs', 'normalize', 'set-u8', '050302030101']);
  assert.equal(normalized.status, 0, normalized.stderr);
  assert.equal(normalized.stdout, '03010203\n');
  const bytes = '000000000014000000000000000000000000000000000000000007000000000000000000';
  const batch = run(['wire', 'batch', bytes]);
  assert.equal(batch.status, 0, batch.stderr);
  const inspected = JSON.parse(batch.stdout);
  assert.equal(inspected.bytes, bytes);
  assert.equal(inspected.digest, createHash('blake2s256').update(Buffer.from(bytes, 'hex')).digest('hex'));
  const sealed = run(['wire', 'sealed-batch', `${bytes}20${'ff'.repeat(32)}`]);
  assert.equal(sealed.status, 0, sealed.stderr);
  assert.equal(JSON.parse(sealed.stdout).claimedDigest, 'ff'.repeat(32));
  assert.equal(JSON.parse(sealed.stdout).computedDigest, inspected.digest);
  const header = `${'00'.repeat(50)}000000000000000020${'00'.repeat(32)}`;
  assert.equal(run(['wire', 'header', header]).status, 0);
  assert.equal(run(['simulation', 'vote', '1', header]).status, 0);
});
test('CLI help and shell launcher are usable', () => {
  assert.equal(run(['--help']).status, 0);
  const result = spawnSync('sh', [resolve(project, 'bin/telcoin-kanon'), 'scalar', 'epoch', '4294967295'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '4294967295\n');
});

test('build rejects an unpinned compiler before invocation', () => {
  const temporary = mkdtempSync(resolve(tmpdir(), 'telcoin-compiler-pin-'));
  try {
    const fakeCompiler = resolve(temporary, 'compiler');
    writeFileSync(fakeCompiler, 'This is not the pinned compiler.');
    const result = spawnSync(process.execPath, [resolve(project, 'scripts/build.mjs')], {
      env: { ...process.env, KANON_BIN: fakeCompiler }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('Compiler differs from source-lock.json'), result.stderr);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
