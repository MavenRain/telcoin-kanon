import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './harness.mjs';
import { executorOracleSources } from './executor-oracle-sources.mjs';
import { rlp, word, authorizationGolden } from './transaction-vectors.mjs';
const h = await harness({name: 'executor-validation', ...executorOracleSources, oracle: 'test/executor-validation-oracle.ml',
  fixtures: ['test/executor-common.kan', 'test/executor-validation.kan'],
  exports: ['worldStateEmpty', 'executorTestSetAccount', 'executorTestBlock', 'executorTestTx', 'executorTestValidate',
    'executorTestFinalize', 'executorTestSystemHex', 'executorTestPredeploy', 'executorTestWarmedPrecompiles']});
const address = n => BigInt(n).toString(16).padStart(40, '0');
const sender = address(256), target = address(512), coinbase = address(768), basefeeAddress = address(1024);
const maximum = (1n << 256n) - 1n;
const account = (addr = sender, nonce = 0n, balance = 1000000000n, code = '', slot = 0n) => [addr, word(nonce), word(balance), code, word(slot)].join(':');
const world = raw => {
  let state = h.e.worldStateEmpty();
  for (const entry of raw === '-' ? [] : raw.split(',')) state = h.e.executorTestSetAccount(state, ...entry.split(':').map(h.raw));
  return state;
};
const block = (changes = {}) => Object.values({fork: '2', coinbase, basefeeAddress, chain: word(1), gas: word(1000000), baseFee: word(1), ...changes}).join(':');
const tx = (changes = {}) => Object.values({mode: '0', sender, nonce: word(0), gas: '21000', target, value: word(0), data: '', access: rlp([]), chain: word(1), maximum: word(2), priority: word(1), auths: rlp([]), ...changes}).join(':');
const validation = (changes = {}, blockChanges = {}, state = account()) => ['validate', state, block(blockChanges), tx(changes)];
const evaluate = ([op, ...args]) => {
  if (op === 'hex') return h.text(h.e.executorTestSystemHex(h.raw(args[0])));
  if (op === 'predeploy') return h.text(h.e.executorTestPredeploy(world(args[0])));
  if (op === 'warm') return h.text(h.e.executorTestWarmedPrecompiles(Number(args[0])));
  if (op === 'finalize') return h.text(h.e.executorTestFinalize(world(args[0]), Number(args[1]),
    ...args.slice(2, 7).map(h.toBytes), ...args.slice(7).map(h.raw)));
  const blockFields = args[1].split(':'), txFields = args[2].split(':');
  const blockValue = h.e.executorTestBlock(Number(blockFields[0]), ...blockFields.slice(1).map(h.raw));
  const txValue = h.e.executorTestTx(Number(txFields[0]), ...txFields.slice(1).map((value, index) => index === 2 ? h.toBytes(value) : h.raw(value)));
  return h.text(h.e.executorTestValidate(world(args[0]), blockValue, txValue));
};
test('Executor validates chain and fee models in the source error order', () => {
  const cases = [validation(), validation({chain: ''}), validation({chain: word(2), maximum: word(0), gas: '1'}),
    ...['1', '2', '3', '4'].map(mode => validation({mode, chain: ''})),
    ...['0', '1', '2', '3'].map(mode => validation({mode, maximum: word(0), priority: word(0)})),
    validation({mode: '3', maximum: word(0), priority: word(1)}),
    validation({mode: '2', maximum: word(2), priority: word(maximum)}),
    validation({mode: '4', maximum: word(0), priority: word(1)}, {fork: '0'}),
    validation({mode: '4', maximum: word(0), priority: word(1)}, {fork: '1'}),
    validation({mode: '4', maximum: word(0), priority: word(1)}),
    validation({mode: '4', maximum: word(0), priority: word(0)}),
    validation({mode: '4', gas: '1'}),
    validation({mode: '4', gas: '46000', auths: rlp([authorizationGolden.fields])})];
  h.compare(cases, evaluate);
  assert.equal(evaluate(cases[2]), 'error:invalid chain id');
  assert.equal(evaluate(validation({mode: '4', maximum: word(0), priority: word(1)}, {fork: '0'})), 'error:set-code transaction before Prague (EIP-7702)');
  assert.equal(evaluate(validation({mode: '4', gas: '1'})), 'error:empty authorization list (EIP-7702)');
});
test('Executor enforces block, initcode, intrinsic and Prague floor limits in order', () => {
  const cases = [validation({gas: '-1'}), validation({gas: '20999'}), validation({gas: '21000'}),
    validation({gas: '1000001'}), validation({gas: '1000001', target: '', data: '00'.repeat(49153)}),
    validation({gas: '1', target: '', data: '00'.repeat(49153)}),
    validation({gas: '53000', target: ''}), validation({gas: '52999', target: ''}),
    ...['0', '1', '2'].map(fork => validation({gas: '23000', data: 'ab'.repeat(100)}, {fork})),
    validation({gas: '25000', data: 'ab'.repeat(100)}),
    ...['0', '1', '3'].map(mode => validation({mode, gas: '21000', access: rlp([[target, [word(0), word(0)]]])})),
    validation({mode: '4', target: '', gas: '46000', auths: rlp([authorizationGolden.fields])})];
  h.compare(cases, evaluate);
  assert.equal(evaluate(cases[4]), 'error:gas limit above block gas limit');
  assert.equal(evaluate(cases[5]), 'error:init code size limit (EIP-3860)');
  assert.equal(evaluate(validation({gas: '23000', data: 'ab'.repeat(100)})), 'error:gas floor above gas limit');
});
test('Executor checks sender code, nonce, payment overflow and maximum balance before deduction', () => {
  const cases = [validation({}, {}, '-'), validation({nonce: word(1)}, {}, '-'),
    ...['00', 'ef01', 'ef0101' + target].map(code => validation({nonce: word(1)}, {}, account(sender, 0n, 0n, code))),
    ...['0', '1', '2'].map(fork => validation({}, {fork}, account(sender, 0n, 1000000000n, 'ef0100' + target))),
    validation({}, {}, account(sender, 0n, 41999n)), validation({}, {}, account(sender, 0n, 42000n)),
    validation({value: word(1)}, {}, account(sender, 0n, 42000n)),
    validation({mode: '3', maximum: word(1000), priority: word(0)}, {}, account(sender, 0n, 42000n)),
    validation({gas: String((1n << 62n) - 1n), maximum: word(maximum)}, {gas: word(maximum)}, account(sender, 0n, maximum)),
    validation({maximum: word(maximum / 21000n), value: word(maximum)}, {}, account(sender, 0n, maximum)),
    validation({nonce: word((1n << 62n) - 1n)}, {}, account(sender, (1n << 62n) - 1n)),
    validation({chain: word(1n << 255n)}, {chain: word(1n << 255n)})];
  h.compare(cases, evaluate);
  assert.equal(evaluate(cases[0]), 'error:insufficient funds for max fee and value');
  assert.equal(evaluate(cases[2]), 'error:sender has code (EIP-3607)');
  assert.equal(evaluate(cases[12]), 'error:overflow computing max payment');
  assert.equal(evaluate(cases[13]), 'error:overflow computing max payment');
});
const settle = ({state = '-', mode = 0, limit = 100000, remaining = 50000, refund = 0, auth = 0, floor = 0,
  effective = 7n, base = 3n, from = sender, beneficiary = coinbase, fees = basefeeAddress} = {}) =>
  ['finalize', state, String(mode), String(limit), String(remaining), String(refund), String(auth), String(floor), word(effective), word(base), from, beneficiary, fees];
test('Settlement applies refund caps and floors to success, revert and halt before Telcoin credits', () => {
  const cases = [];
  for (const mode of [0, 1, 2]) for (const refund of [-1, 0, 1, 9999, 10000, 10001, 100000]) for (const auth of [0, 12500]) {
    cases.push(settle({mode, refund, auth}), settle({mode, refund, auth, floor: 48000}));
  }
  cases.push(settle({limit: 100, remaining: 90, auth: 100, floor: 100}),
    settle({refund: (1n << 62n) - 1n, auth: 12500}), settle({refund: -(1n << 62n), auth: -1}));
  h.compare(cases, evaluate, {requireSuccess: true});
});
test('Settlement preserves credit ordering, overflow drops, zero pruning and the system sender exemption', () => {
  const cases = [];
  for (const mode of [0, 1, 2]) for (const [from, beneficiary, fees] of [[sender, sender, sender], [sender, basefeeAddress, basefeeAddress], [sender, coinbase, sender]]) {
    cases.push(settle({mode, from, beneficiary, fees, auth: 12500}),
      settle({mode, from, beneficiary, fees, auth: 12500, state: account(sender, 1n, maximum - 1n)}));
  }
  cases.push(settle({effective: 0n, base: 0n}), settle({effective: 1n, base: 2n}),
    settle({effective: maximum, base: maximum - 1n}), settle({from: 'ff'.repeat(19) + 'fe', auth: 12500}),
    settle({limit: 0, remaining: 0, effective: 0n, base: 0n}),
    settle({limit: (1n << 62n) - 1n, remaining: (1n << 62n) - 100001n}));
  h.compare(cases, evaluate, {requireSuccess: true});
  assert.equal(evaluate(settle({effective: 0n, base: 0n})).split('|')[1], '');
  assert.equal(evaluate(settle({from: 'ff'.repeat(19) + 'fe', auth: 12500})).split('|')[1], '');
});
test('System contract literals, predeployment and fork-dependent warmed precompiles match the source', () => {
  const rows = ['', '00', 'aB01', 'Ff', '0', '0g', ' 0', 'gg', 'é0'].map(text => ['hex', Buffer.from(text).toString('hex')]);
  rows.push(['predeploy', '-'], ['predeploy', account()], ['warm', '0'], ['warm', '1'], ['warm', '2']);
  h.compare(rows, evaluate, {requireSuccess: true});
  assert.equal(evaluate(['warm', '0']).split(';').filter(Boolean).length, 9);
  assert.equal(evaluate(['warm', '2']).split(';').filter(Boolean).length, 10);
});
