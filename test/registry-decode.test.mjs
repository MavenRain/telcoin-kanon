import assert from 'node:assert/strict';
import test from 'node:test';
import {harness} from './harness.mjs';
import {registryOracleSources} from './registry-oracle-sources.mjs';
import {word} from './transaction-vectors.mjs';
const h=await harness({name:'registry-decode',...registryOracleSources,
  oracle:'test/registry-oracle.ml',fixtures:['test/registry.kan'],exports:['registryTestDecode','registryTestUint16']});
const addr=n=>BigInt(n).toString(16).padStart(40,'0');
const evaluate=([op,input])=>h.text(op==='array'?h.e.registryTestDecode(h.raw(input)):h.e.registryTestUint16(h.raw(input)));
const element=({address=1,activation=0,exit=0,status=3,retired=0,stake=0,region=0}={})=>
  [address,activation,exit,status,retired,stake,region].map(word).join('');
const array=rows=>word(32)+word(rows.length)+rows.join('');
test('Registry decodes all static tuple fields and the full u32 range', () => {
  const rows = [[], [element()], Array.from({length: 7}, (_, status) => element({address: 9, activation: 4294967295, exit: 4294967295, status, retired: status % 2, stake: 255, region: 255}))];
  h.compare(rows.map(xs => ['array', array(xs)]), evaluate, {requireSuccess: true});
  assert.equal(evaluate(['array', array([element()])]), addr(1) + ':0:0:3:0:0:0');
});
test('Registry decoder preserves framing, field padding and failure precedence', () => {
  const good = array([element()]), cases = new Set(['', word(0), word(31), word(33), word(32), word(32) + word(1n << 32n)]);
  for (let bytes = 0; bytes < good.length / 2; bytes++) cases.add(good.slice(0, bytes * 2));
  cases.add(good + '00'); cases.add(array([]) + '00'); cases.add(word(32) + word(4294967295));
  for (const [index, width] of [[0, 20], [1, 4], [2, 4], [3, 1], [4, 1], [5, 1], [6, 1]]) {
    for (const n of [1n << BigInt(width * 8), 1n << 255n]) {
      const fields = Array.from({length: 7}, (_, i) => word(i === 3 ? 3 : 0)); fields[index] = word(n); cases.add(array([fields.join('')]));
    }
  }
  for (const status of [7, 255]) cases.add(array([element({status})]));
  for (const retired of [2, 255]) cases.add(array([element({retired})]));
  const badStatus = element({status: 7}); cases.add(array([badStatus]) + '00');
  cases.add(array([badStatus, element({activation: 1n << 32n})]));
  h.compare([...cases].map(input => ['array', input]), evaluate);
});
test('Registry uint16 decoder orders truncation, trailing bytes and padding errors', () => {
  const rows = [];
  for (const n of [0n, 1n, 65535n, 65536n, 1n << 255n]) {
    const bytes = word(n); rows.push(['uint16', bytes], ['uint16', bytes + '00']);
    for (const size of [0, 1, 30, 31]) rows.push(['uint16', bytes.slice(0, size * 2)]);
  }
  h.compare(rows, evaluate);
});
