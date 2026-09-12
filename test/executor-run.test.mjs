import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { harness } from './harness.mjs';
import { executorOracleSources } from './executor-oracle-sources.mjs';
import { rlp, scalar, word, authorizationGolden } from './transaction-vectors.mjs';
import { precompileVectors } from './precompile-vectors.mjs';
const h = await harness({name: 'executor-run', ...executorOracleSources, oracle: 'test/executor-validation-oracle.ml',
  fixtures: ['test/executor-common.kan', 'test/executor-run.kan'],
  exports: ['worldStateEmpty', 'executorTestSetAccount', 'executorTestBlock', 'executorTestTx', 'executorTestRun', 'executorTestCreatedAddress']});
const address = n => BigInt(n).toString(16).padStart(40, '0');
const sender = address(256), target = address(512), coinbase = address(768), basefeeAddress = address(1024);
const maximum = (1n << 256n) - 1n;
const account = (addr = sender, nonce = 0n, balance = 1000000000n, code = '', slot = 0n) => [addr, word(nonce), word(balance), code, word(slot)].join(':');
const block = (changes = {}) => Object.values({fork: '2', coinbase, basefeeAddress, chain: word(1), gas: word(3000000), baseFee: word(1), ...changes}).join(':');
const tx = (changes = {}) => Object.values({mode: '0', sender, nonce: word(0), gas: '100000', target, value: word(0), data: '', access: rlp([]), chain: word(1), maximum: word(2), priority: word(1), auths: rlp([]), ...changes}).join(':');
const row = (changes = {}, blockChanges = {}, state = account()) => ['execute', state, block(blockChanges), tx(changes)];
const evaluate = ([op, stateRaw, blockRaw, txRaw]) => {
  assert.equal(op, 'execute');
  let state = h.e.worldStateEmpty();
  for (const entry of stateRaw === '-' ? [] : stateRaw.split(',')) state = h.e.executorTestSetAccount(state, ...entry.split(':').map(h.raw));
  const bs = blockRaw.split(':'), ts = txRaw.split(':');
  const env = h.e.executorTestBlock(Number(bs[0]), ...bs.slice(1).map(h.raw));
  const transaction = h.e.executorTestTx(Number(ts[0]), ...ts.slice(1).map((value, index) => index === 2 ? h.toBytes(value) : h.raw(value)));
  return h.text(h.e.executorTestRun(state, env, transaction));
};
const compare = (rows, positive = true) => h.compare(rows, evaluate, {requireSuccess: positive});
const stateWithCode = (code, balance = 0n, slot = 0n) => account() + ',' + account(target, 0n, balance, code, slot);
test('Top-level calls preserve output, logs, state, fees and frame rollback', () => {
  const codes = ['', '00', '602a60005260206000f3', '602a60005260206000fd', 'fe', '50', '600056',
    '6001600055', '6000600055', '600160005560006000fd', '6001600055fe',
    '602a600052600160206000a1', '602a600052600160206000a160006000fd'];
  const rows = codes.flatMap(code => [0n, 5n].map(value => row({value: word(value)}, {}, stateWithCode(code, 7n, 23n))));
  rows.push(row({sender: target, target, value: word(5)}, {}, account(target, 0n, 1000000000n)),
    row({value: word(1)}, {}, stateWithCode('', maximum)),
    row({maximum: word(0)}, {baseFee: word(0)}, account(sender, 0n, 0n)),
    row({nonce: word((1n << 62n) - 1n)}, {}, account(sender, (1n << 62n) - 1n)));
  compare(rows);
  assert.equal(evaluate(row({}, {}, stateWithCode('602a60005260206000f3'))).split('|')[2], word(42));
  assert.equal(evaluate(row({}, {}, stateWithCode('602a60005260206000fd'))).split('|')[2], word(42));
  assert.ok(evaluate(row({value: word(1)}, {}, stateWithCode('', maximum))).startsWith('Halted{value overflow;'));
});
test('Top-level precompiles execute all nine implementations with exact gas and failure boundaries', () => {
  const rows = [];
  for (const vector of precompileVectors) {
    const initial = 21000 + [...Buffer.from(vector.input, 'hex')].reduce((n, byte) => n + (byte === 0 ? 4 : 16), 0);
    for (const extra of [-1, 0, 1]) rows.push(row({target: address(vector.address), data: vector.input, gas: String(initial + vector.gas + extra)}, {fork: '0'}));
    rows.push(row({target: address(vector.address), data: vector.input, gas: '2000000', value: word(7)}));
  }
  compare(rows, false);
  for (const vector of precompileVectors) {
    const output = evaluate(row({target: address(vector.address), data: vector.input, gas: '2000000'}));
    assert.ok(output.startsWith('Success{'), output);
    const returned = output.split('|')[2];
    if (vector.address === 2) assert.equal(returned, createHash('sha256').update(Buffer.from(vector.input, 'hex')).digest('hex'));
    if (vector.address === 3) assert.equal(returned, '00'.repeat(12) + createHash('ripemd160').update(Buffer.from(vector.input, 'hex')).digest('hex'));
    if (vector.address === 4) assert.equal(returned, vector.input);
  }
});
test('Contract creation deposits code and preserves the correct checkpoint on each failure', () => {
  const created = h.text(h.e.executorTestCreatedAddress(h.raw(sender), h.raw(word(0))));
  const deploy = '600160005360016000f3';
  const intrinsic = 53000 + [...Buffer.from(deploy, 'hex')].reduce((n, byte) => n + (byte === 0 ? 4 : 16), 0) + 2;
  const rows = ['', '00', deploy, '60ef60005360016000f3', '6160016000f3', '600160005560006000fd', 'fe']
    .map(data => row({target: '', data, gas: '1000000', value: word(5)}));
  rows.push(row({target: '', data: deploy, gas: String(intrinsic + 50)}),
    row({target: '', data: deploy}, {}, account() + ',' + account(created, 1n, 0n)),
    row({target: '', data: deploy}, {}, account() + ',' + account(created, 0n, 0n, '00')),
    row({target: '', nonce: word((1n << 62n) - 1n)}, {}, account(sender, (1n << 62n) - 1n)));
  compare(rows);
  const success = evaluate(row({target: '', data: deploy})).split('|');
  assert.equal(success[2], '01'); assert.equal(success[3], created);
  assert.ok(evaluate(rows[7]).startsWith('Halted{create deposit out of gas;'));
  assert.ok(evaluate(rows[8]).startsWith('Halted{create collision;'));
  assert.ok(evaluate(rows[10]).startsWith('Halted{create nonce exhausted;'));
});
test('Forks, fee models and access lists affect charging while preserving transaction semantics', () => {
  const rows = [];
  for (const fork of ['0', '1', '2']) for (const mode of ['0', '1', '2', '3']) {
    rows.push(row({mode, data: 'ab'.repeat(100), access: rlp([[target, [word(0), word(0)]]]), maximum: word(9), priority: word(2)}, {fork}, stateWithCode('60005460005260206000f3', 0n, 23n)));
  }
  for (const beneficiary of [sender, target, basefeeAddress]) rows.push(row({}, {coinbase: beneficiary, basefeeAddress: beneficiary}, stateWithCode('6000600055', 0n, 23n)));
  compare(rows);
});
test('Delegated calls resolve one hop and keep storage and ADDRESS on the delegator', () => {
  const delegate = address(600), next = address(601);
  const code = '3060005260206000f3';
  const state = account() + ',' + account(target, 0n, 0n, 'ef0100' + delegate) + ',' + account(delegate, 0n, 0n, code);
  const rows = [row({}, {}, state), row({value: word(5)}, {}, state),
    row({}, {}, account() + ',' + account(target, 0n, 0n, 'ef0100' + delegate) + ',' + account(delegate, 0n, 0n, '6001600055', 23n)),
    row({}, {}, account() + ',' + account(target, 0n, 0n, 'ef0100' + delegate) + ',' + account(delegate, 0n, 0n, 'ef0100' + next) + ',' + account(next, 0n, 0n, code)),
    row({}, {}, account() + ',' + account(target, 0n, 0n, 'ef0100' + address(4)))];
  compare(rows);
  assert.equal(evaluate(rows[0]).split('|')[2], word(BigInt('0x' + target)));
});
const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const key1 = '7e5f4552091a69125d5dfcb7b8c2659029395bdf';
function signAuthorization(chain, target, nonce) {
  const result = h.runOracle([], `auth-hash ${word(chain)} ${target} ${word(nonce)}\n`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^[0-9a-f]{64}$/);
  const s = (BigInt('0x' + result.stdout.trim()) + gx) % order;
  return [scalar(chain), target, scalar(nonce), s > order / 2n ? '01' : '', scalar(gx), scalar(s > order / 2n ? order - s : s)];
}
test('Type 4 authorization changes and refunds survive reverted and halted top-level calls', () => {
  const authority = authorizationGolden.authority, delegate = authorizationGolden.fields[1];
  const rows = [];
  for (const code of ['602a60005260206000f3', '600160005560006000fd', 'fe']) for (const funded of [false, true]) {
    const state = account() + ',' + account(delegate, 0n, 0n, code) + (funded ? ',' + account(authority, 0n, 1n) : '');
    rows.push(row({mode: '4', target: authority, auths: rlp([authorizationGolden.fields]), gas: '100000'}, {}, state));
  }
  compare(rows);
  for (const input of rows) assert.ok(evaluate(input).split('|')[1].includes(authority + ':1:'), 'The authorization nonce survives the frame outcome');
  const selfAuth = signAuthorization(1n, target, 1n), nextAuth = signAuthorization(1n, address(513), 2n);
  const state = account(key1) + ',' + account(target, 0n, 0n, '602a60005260206000f3') + ',' + account(address(513), 0n, 0n, 'fe');
  const selfRows = [row({mode: '4', sender: key1, target: key1, auths: rlp([selfAuth])}, {}, state),
    row({mode: '4', sender: key1, target: key1, gas: '150000', auths: rlp([selfAuth, nextAuth])}, {}, state),
    row({mode: '4', sender: key1, target: key1, auths: rlp([signAuthorization(1n, target, 0n)])}, {}, state)];
  compare(selfRows);
  assert.equal(evaluate(selfRows[0]).split('|')[2], word(42));
  assert.ok(evaluate(selfRows[1]).split('|')[1].includes(key1 + ':3:'));
});
