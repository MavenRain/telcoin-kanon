import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './harness.mjs';
import { evmOracleSources } from './evm-oracle-sources.mjs';
import { transactionGoldens, type4Golden, authorizationGolden, scalar, word, rlp, wire, txFields } from './transaction-vectors.mjs';
const h = await harness({ name: 'transaction-auth', ...evmOracleSources,
  sources: [...evmOracleSources.sources, 'lib/evm/tx_recovery.ml', 'lib/evm/auth_list.ml'],
  modules: [...evmOracleSources.modules, 'tx_recovery.ml', 'auth_list.ml'],
  oracle: 'test/transaction-auth-oracle.ml', fixtures: ['test/transaction-auth.kan'],
  exports: ['authTestDescribe', 'authTestMake', 'authTestScreen', 'authTestWorld', 'authTestApply', 'txRecoveryTest', 'evmPublicKeyToAddress'] });
const evaluate = ([op, ...args]) => {
  if (op === 'describe') return h.text(h.e.authTestDescribe(h.raw(args[0])));
  if (op === 'make') return h.text(h.e.authTestMake(...args.map(h.raw)));
  if (op === 'screen') return h.text(h.e.authTestScreen(...args.map(h.raw)));
  if (op === 'recover') return h.text(h.e.txRecoveryTest(h.raw(args[0])));
  const initial = h.e.authTestWorld(...args.slice(2).map(h.raw));
  return h.text(h.e.authTestApply(initial, h.raw(args[0]), h.raw(args[1])));
};
const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const generatorX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const key1Address = '7e5f4552091a69125d5dfcb7b8c2659029395bdf';
function signAuthorization(chain, target, nonce) {
  const fields = [scalar(chain), target, scalar(nonce), '', scalar(generatorX), '01'];
  const result = h.runOracle([], `describe ${rlp(fields)}\n`);
  assert.equal(result.status, 0, result.stderr);
  const parts = result.stdout.trim().split('|');
  assert.equal(parts.length, 4, result.stdout);
  // ECDSA with private key 1 and nonce 1: R = G and s = hash + G.x (mod n).
  const s = (BigInt('0x' + parts[2]) + generatorX) % order;
  assert.notEqual(s, 0n);
  fields[3] = s > order / 2n ? '01' : '';
  fields[5] = scalar(s > order / 2n ? order - s : s);
  return fields;
}
test('Authorization encodings and signing hashes match OCaml and the independent EIP-7702 golden', () => {
  const fields = authorizationGolden.fields;
  const rows = [['describe', rlp(fields)]];
  for (const chain of [0n, 1n, 1n << 64n, (1n << 256n) - 1n]) for (const nonce of [0n, 127n, 128n, 1n << 62n, (1n << 64n) - 1n]) {
    rows.push(['describe', rlp([scalar(chain), '00'.repeat(20), scalar(nonce), 'ff', '01', scalar(order - 1n)])]);
  }
  h.compare(rows, evaluate, {requireSuccess: true});
  const described = evaluate(rows[0]).split('|');
  assert.equal(described[0], 'd70194' + '11'.repeat(20) + '80');
  assert.equal(described[2], authorizationGolden.hash);
  h.compare([['screen', word(1), rlp(fields)]], evaluate, {requireSuccess: true});
  assert.equal(evaluate(['screen', word(1), rlp(fields)]), authorizationGolden.authority + ':' + word(0) + ':ef0100' + '11'.repeat(20));
});
test('Authorization construction accepts exactly the u64 nonce domain', () => {
  h.compare([0n, 1n, (1n << 62n) - 1n, 1n << 62n, (1n << 64n) - 1n, 1n << 64n, (1n << 256n) - 1n]
    .flatMap(nonce => [0n, 1n << 64n].map(chain => ['make', word(chain), 'ab'.repeat(20), word(nonce)])), evaluate, {requireSuccess: true});
});
test('Authorization screening gates chain, saturation, parity and low-s before recovery', () => {
  const rows = [];
  const base = authorizationGolden.fields;
  for (const chain of [0n, 1n, 2n, 1n << 64n]) rows.push(['screen', word(chain), rlp(base)]);
  for (const [index, values] of [[0, [0n, 2n]], [2, [(1n << 64n) - 1n]], [3, [2n, 255n]], [4, [0n, order]], [5, [0n, order / 2n, order / 2n + 1n, order - 1n]]]) {
    for (const value of values) { const fields = [...base]; fields[index] = scalar(value); rows.push(['screen', word(1), rlp(fields)]); }
  }
  h.compare(rows, evaluate, {requireSuccess: true});
});
test('Transaction sender recovery matches all signed goldens and preserves recovered payload fields', () => {
  const goldens = [...transactionGoldens, type4Golden];
  const rows = goldens.map(g => ['recover', g.encoded_2718]);
  h.compare(rows, evaluate, {requireSuccess: true});
  for (const [i, row] of rows.entries()) assert.equal(evaluate(row).split('|')[0], goldens[i].sender, goldens[i].name);
});
test('Transaction recovery rejects high-s and impossible scalars at the same boundaries', () => {
  const rows = [];
  for (const type of [0, 1, 2, 4]) for (const [r, s] of [[0n, 1n], [generatorX, 0n], [order, 1n], [generatorX, order / 2n], [generatorX, order / 2n + 1n], [generatorX, order - 1n]]) {
    const fields = txFields(type); fields[fields.length - 2] = scalar(r); fields[fields.length - 1] = scalar(s); rows.push(['recover', wire(type, fields)]);
  }
  h.compare(rows, evaluate);
});
test('Authorization application threads nonces, warming, refunds, replacement and revocation', () => {
  const target = '22'.repeat(20);
  const first = signAuthorization(1n, target, 0n);
  const second = signAuthorization(1n, '33'.repeat(20), 1n);
  const revoke = signAuthorization(1n, '00'.repeat(20), 2n);
  const universal = signAuthorization(0n, target, 0n);
  const saturated = signAuthorization(1n, target, (1n << 64n) - 1n);
  const wideNonce = signAuthorization(1n, target, 1n << 62n);
  const badParity = [...first]; badParity[3] = '02';
  const highS = [...first]; highS[5] = scalar(order / 2n + 1n);
  const wrongChain = [...first]; wrongChain[0] = '02';
  const row = (entries, nonce = 0n, balance = 0n, code = '', slot = 0n) =>
    ['apply', word(1), rlp(entries), key1Address, word(nonce), word(balance), code, word(slot)];
  const rows = [row([]), row([first]), row([first], 0n, 1n), row([first], 0n, 0n, '', 9n),
    row([first, second, revoke]), row([first, second, revoke], 0n, 8n), row([first, first]), row([first], 1n),
    row([first], 0n, 0n, '00'), row([first], 0n, 0n, 'ef0101' + target), row([first], 0n, 0n, 'ef01'),
    row([first], 0n, 0n, 'ef0100' + '44'.repeat(20)), row([universal]), row([saturated]), row([wideNonce]),
    row([wrongChain, saturated, badParity, highS, first, first, second, revoke])];
  h.compare(rows, evaluate, {requireSuccess: true});
  assert.ok(evaluate(row([first])).startsWith('0|' + key1Address + ';|applied:fresh;|'));
  assert.ok(evaluate(row([first], 0n, 1n)).startsWith('12500|' + key1Address + ';|applied:refunded;|'));
  assert.ok(evaluate(row([first, first])).includes('|applied:fresh;nonce_mismatch;|'));
  assert.ok(evaluate(row([first], 0n, 0n, '00')).startsWith('0|' + key1Address + ';|has_code;|'));
});
