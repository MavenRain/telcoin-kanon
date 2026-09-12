import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { build, project } from '../scripts/build.mjs';
import { loadProfile } from '../runtime.mjs';
import { compileOracle } from './harness.mjs';
import { blsVectors as v } from './bls-vectors.mjs';

mkdirSync(resolve(project, 'build'), { recursive: true });
build(resolve(project, 'build/telcoin-bls.wasm'), JSON.parse(readFileSync(resolve(project, 'exports.json'), 'utf8')), [], { profile: 'bls' });
const native = compileOracle({ name: 'crypto-cli', sources: ['lib/crypto_blst/blake3.ml', 'lib/crypto_blst/tn_crypto.ml'],
  modules: ['blake3.ml', 'tn_crypto.ml'], packages: 'bls12-381,bls12-381-signature,hex,zarith', oracle: 'test/crypto-blst-oracle.ml' });
const profile = 'bls12-381:minsig-basic:blake3';
const run = args => spawnSync(process.execPath, [resolve(project, 'cli.mjs'), 'bls', ...args], { encoding: 'utf8', timeout: 180000 });
const success = args => {
  const result = run(args);
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  assert.equal(result.stderr, '');
  const output = JSON.parse(result.stdout);
  assert.equal(output.profile, profile);
  return output;
};
const oracle = row => {
  const result = native.runOracle([], row.join(' ') + '\n');
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  assert.doesNotMatch(result.stdout, /^error:/);
  return result.stdout.trim();
};

test('The complete BLS artifact exposes the selected profile and rejects unknown profiles', async () => {
  const runtime = await loadProfile('bls');
  assert.equal(runtime.fromBytes(runtime.exports.cryptoProfile()).toString('utf8'), profile);
  for (const name of JSON.parse(readFileSync(resolve(project, 'exports.json'), 'utf8'))) assert.equal(typeof runtime.exports[name], 'function', name);
  await assert.rejects(loadProfile('unknown'), /Unknown crypto profile/);
});
test('The BLS CLI derives and signs with the native full-width seed semantics', () => {
  const seed = '18446744073709551615';
  const [publicKey, signature, digest] = oracle(['derive', seed, v.msg_hex]).split('|');
  assert.deepEqual(success(['key', seed]), { profile, publicKey });
  assert.deepEqual(success(['sign', seed, v.msg_hex]), { profile, signature });
  assert.deepEqual(success(['hash', v.msg_hex]), { profile, digest });
});
test('The BLS CLI uses the selected digest and signer for committees and votes', () => {
  const seeds = ['3', '1', '2'];
  const authorities = seeds.map(seed => {
    const publicKey = oracle(['derive', seed, '-']).split('|')[0];
    return oracle(['hash', publicKey]);
  }).sort();
  assert.deepEqual(success(['committee', seeds.join(',')]), { profile, epoch: 0, size: 3, quorum: 3, validity: 1, authorities });
  const header = `${'00'.repeat(50)}000000000000000020${'00'.repeat(32)}`;
  const digest = oracle(['hash', header]);
  const signature = oracle(['sign-message', '1', '02000120' + digest]);
  assert.deepEqual(success(['vote', '1', header]), { profile, signature });
});
test('The BLS CLI verifies native signatures and preserves aggregate multiplicity', () => {
  assert.deepEqual(success(['verify', v.pk0_hex, v.msg_hex, v.sig0_hex]), { profile, valid: true });
  assert.deepEqual(success(['verify', v.pk0_hex, v.wrong_msg_hex, v.sig0_hex]), { profile, valid: false });
  assert.deepEqual(success(['aggregate', `${v.sig0_hex},${v.sig0_hex}`]), { profile, aggregate: v.sig0_doubled_hex });
  assert.deepEqual(success(['aggregate', '']), { profile, aggregate: v.infinity_sig_hex });
  assert.deepEqual(success(['verify-aggregate', `${v.pk0_hex},${v.pk0_hex}`, v.msg_hex, v.sig0_doubled_hex]), { profile, valid: true });
  assert.deepEqual(success(['verify-aggregate', '', v.msg_hex, v.infinity_sig_hex]), { profile, valid: false });
});
test('The BLS CLI validates hex and checked crypto admission before verification', () => {
  for (const [args, message] of [
    [['key', '18446744073709551616'], 'unsigned decimal'],
    [['sign', '1', 'abc'], 'complete byte pairs'],
    [['aggregate', `${v.sig0_hex},z0`], 'complete byte pairs'],
    [['verify', 'zz', v.msg_hex, v.sig0_hex], 'complete byte pairs'],
    [['verify', v.infinity_pk_hex, v.msg_hex, v.sig0_hex], 'Invalid public key'],
    [['verify', v.pk0_hex, v.msg_hex, '00'], 'Invalid signature'],
    [['aggregate', '00'], 'Invalid signature'],
    [['verify-aggregate', '', v.msg_hex, '00'], 'Invalid aggregate'],
  ]) {
    const result = run(args);
    assert.equal(result.status, 1, result.error?.message ?? result.stderr);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.includes(message), result.stderr);
  }
  assert.equal(run(['verify', v.pk0_hex]).status, 64);
});
