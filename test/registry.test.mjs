import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './harness.mjs';
import { registryOracleSources } from './registry-oracle-sources.mjs';
import { word } from './transaction-vectors.mjs';
const h = await harness({name: 'registry', ...registryOracleSources,
  oracle: 'test/registry-oracle.ml', fixtures: ['test/registry.kan'],
  exports: ['registryTestStatus', 'registryTestMake', 'registryTestSelectors',
    'registryTestGet', 'registryTestConclude', 'registryTestRewards',
    'seqAddressEmpty', 'seqRewardPairEmpty', 'registryTestAddressCons', 'registryTestRewardCons']});
const addr = n => BigInt(n).toString(16).padStart(40, '0');
const signed = n => h.raw(word(BigInt.asUintN(63, BigInt(n))));
const addressList = raw => (raw === '-' ? [] : raw.split(',')).reverse().reduce((tail, a) => h.e.registryTestAddressCons(h.raw(a), tail), h.e.seqAddressEmpty());
const rewardList = raw => (raw === '-' ? [] : raw.split(',')).reverse().reduce((tail, text) => {
  const [a, n] = text.split(':'); return h.e.registryTestRewardCons(h.raw(a), signed(n), tail);
}, h.e.seqRewardPairEmpty());
const evaluate = ([op, ...args]) => {
  switch (op) {
    case 'array': return h.text(h.e.registryTestDecode(h.raw(args[0])));
    case 'uint16': return h.text(h.e.registryTestUint16(h.raw(args[0])));
    case 'status': return h.text(h.e.registryTestStatus(Number(args[0])));
    case 'make': return h.text(h.e.registryTestMake(h.raw(args[0]), signed(args[1]), signed(args[2]), Number(args[3]), Number(args[4]), signed(args[5]), signed(args[6])));
    case 'selectors': return h.text(h.e.registryTestSelectors());
    case 'get': return h.text(h.e.registryTestGet(Number(args[0])));
    case 'conclude': return h.text(h.e.registryTestConclude(addressList(args[0])));
    case 'rewards': return h.text(h.e.registryTestRewards(rewardList(args[0])));
    default: throw new Error(op);
  }
};
const element = ({address = 1, activation = 0, exit = 0, status = 3, retired = 0, stake = 0, region = 0} = {}) =>
  [address, activation, exit, status, retired, stake, region].map(word).join('');
const array = rows => word(32) + word(rows.length) + rows.join('');
test('Registry calldata preserves selectors, status, ordering, duplicates and signed rewards', () => {
  const lists = [[], [addr(9)], [addr(9), addr(1), addr(9)], [addr(0), 'ff'.repeat(20)]];
  const rows = [['selectors'], ...[0, 1, 2].map(s => ['get', String(s)]), ...lists.map(xs => ['conclude', xs.join(',') || '-'])];
  for (const n of ['0', '1', '-1', '4294967295', '-4611686018427387904', '4611686018427387903']) rows.push(['rewards', [addr(9) + ':' + n, addr(1) + ':7', addr(9) + ':0'].join(',')]);
  rows.push(['rewards', '-']); h.compare(rows, evaluate, {requireSuccess: true});
  assert.equal(evaluate(['conclude', '-']).slice(8), word(32) + word(0));
});
test('Registry statuses and info constructors enforce all source widths', () => {
  h.compare(Array.from({length: 256}, (_, n) => ['status', String(n)]), evaluate, {requireSuccess: true});
  const base = ['make', addr(13), '1', '2', '3', '1', '4', '5'], rows = [];
  for (const [index, bound] of [[2, 4294967296n], [3, 4294967296n], [6, 256n], [7, 256n]]) {
    for (const n of [-4611686018427387904n, -1n, 0n, 1n, bound - 1n, bound, 4611686018427387903n]) {
      const row = [...base]; row[index] = String(n); rows.push(row);
    }
  }
  for (let s = 0; s < 8; s++) { const row = [...base]; row[4] = String(s); rows.push(row); }
  h.compare(rows, evaluate, {requireSuccess: true});
});
