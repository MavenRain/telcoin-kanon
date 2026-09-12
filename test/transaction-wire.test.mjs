import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './harness.mjs';
import { evmOracleSources } from './evm-oracle-sources.mjs';
import { transactionGoldens, type4Golden, scalar, word, rlp, wire, txFields, txLayouts } from './transaction-vectors.mjs';
const h = await harness({ name: 'transaction-wire', ...evmOracleSources, oracle: 'test/transaction-wire-oracle.ml',
  fixtures: ['test/transaction-wire.kan'], exports: ['txWireTestDecode', 'txWireTestParity', 'txWireTestV', 'txWireTestPrice'] });
const decode = bytes => h.text(h.e.txWireTestDecode(h.raw(bytes)));
const evaluate = ([op, ...args]) => {
  if (op === 'decode') return decode(args[0]);
  if (op === 'parity') return h.text(h.e.txWireTestParity(h.raw(args[0])));
  if (op === 'v') return h.text(h.e.txWireTestV(Number(args[0]), Number(args[1]), h.raw(args[2])));
  return h.text(h.e.txWireTestPrice(Number(args[0]), ...args.slice(1).map(h.raw)));
};
const compareWires = (inputs, positive = false) => h.compare(inputs.map(input => ['decode', input]), evaluate, { requireSuccess: positive });
test('Signed transaction goldens preserve consensus bytes, signing preimages and both hashes', () => {
  const goldens = [...transactionGoldens, type4Golden];
  compareWires(goldens.map(g => g.encoded_2718), true);
  for (const g of goldens) assert.equal(decode(g.encoded_2718), [g.encoded_2718, g.signing_payload, g.signing_hash, g.tx_hash].join('|'), g.name);
});
test('All four layouts preserve scalar widths, native bounds, call/create and payload boundaries', () => {
  const inputs = [];
  for (const layout of txLayouts) {
    for (const size of [0, 1, 55, 56, 255, 256, 513]) {
      const fields = txFields(layout.type);
      fields[layout.data] = 'ab'.repeat(size);
      inputs.push(wire(layout.type, fields));
    }
    for (const [index, width] of layout.scalars) {
      if (index === layout.parity) continue;
      for (const n of [0n, 1n, 127n, 128n, 255n, 256n,
        (1n << BigInt(layout.native.includes(index) ? 62 : width * 8)) - 1n]) {
        const fields = txFields(layout.type); fields[index] = scalar(n); inputs.push(wire(layout.type, fields));
      }
    }
    if (layout.type !== 4) { const fields = txFields(layout.type); fields[layout.target] = ''; inputs.push(wire(layout.type, fields)); }
  }
  compareWires(inputs, true);
});
test('Transaction framing and RLP failures match the strict decoder', () => {
  const inputs = ['', '00', '01', '02', '04', '80', 'c0', '8100', 'b800', 'b80101', 'f800', 'f80180', 'f90001c0', 'f8ff', 'bf' + 'ff'.repeat(8)];
  inputs.push(...Array.from({length: 128}, (_, type) => scalar(type).padStart(2, '0') + 'c0'));
  for (const g of transactionGoldens.slice(0, 3)) {
    inputs.push('00' + g.encoded_2718, rlp(g.encoded_2718), g.encoded_2718 + '00');
    for (let bytes = 1; bytes < g.encoded_2718.length / 2; bytes++) inputs.push(g.encoded_2718.slice(0, bytes * 2));
  }
  compareWires(inputs);
});
test('Every scalar reader checks width, leading zero and native overflow in source order', () => {
  const inputs = [];
  for (const layout of txLayouts) {
    for (const [index, width] of layout.scalars) for (const bad of [[], '00', '0001', '01'.repeat(width + 1), '00'.repeat(width + 1)]) {
      const fields = txFields(layout.type); fields[index] = bad; inputs.push(wire(layout.type, fields));
    }
    for (const index of layout.native) for (const n of [1n << 62n, (1n << 63n) - 1n, (1n << 64n) - 1n]) {
      const fields = txFields(layout.type); fields[index] = scalar(n); inputs.push(wire(layout.type, fields));
    }
    for (const width of [1, 19, 21, 32]) {
      const fields = txFields(layout.type); fields[layout.target] = '00'.repeat(width); inputs.push(wire(layout.type, fields));
    }
    for (const index of [layout.target, layout.data]) { const fields = txFields(layout.type); fields[index] = []; inputs.push(wire(layout.type, fields)); }
    for (let count = 0; count <= txFields(layout.type).length + 2; count++) {
      const fields = txFields(layout.type); while (fields.length < count) fields.push(''); inputs.push(wire(layout.type, fields.slice(0, count)));
    }
    const fields = txFields(layout.type); fields[0] = '00'; fields.push(''); inputs.push(wire(layout.type, fields));
  }
  compareWires(inputs);
});
test('Typed parity and legacy v are validated at their distinct decoding stages', () => {
  const inputs = [];
  for (const layout of txLayouts) for (const n of [0n, 1n, 2n, 26n, 27n, 28n, 29n, 34n, 35n, 36n, 255n, 256n, (1n << 65n) + 33n, (1n << 65n) + 35n]) {
    const fields = txFields(layout.type); fields[layout.parity] = scalar(n); inputs.push(wire(layout.type, fields));
  }
  compareWires(inputs);
});
test('Access lists retain order and duplicates while enforcing nested field shapes', () => {
  const inputs = [];
  const good = [['11'.repeat(20), [word(0), word(1), word(1)]], ['11'.repeat(20), []], ['00'.repeat(20), [word((1n << 256n) - 1n)]]];
  for (const layout of txLayouts.filter(l => l.access !== null)) {
    const fields = txFields(layout.type); fields[layout.access] = good;
    compareWires([wire(layout.type, fields)], true);
    for (const bad of ['', [''], [[]], [['00'.repeat(20)]], [['00'.repeat(20), [], '']], [['00'.repeat(19), []]], [['00'.repeat(20), '']], [['00'.repeat(20), ['']]], [['00'.repeat(20), ['00'.repeat(31)]]], [['00'.repeat(20), [[]]]]]) {
      fields[layout.access] = bad; inputs.push(wire(layout.type, fields));
    }
  }
  compareWires(inputs);
});
test('Type 4 authorization fields preserve full chain and nonce widths and scalar parity', () => {
  const fields = txFields(4);
  const auth = ['01', '11'.repeat(20), '', '', '01', '01'];
  const positive = [];
  for (const [index, values] of [[0, [0n, 1n, 1n << 64n, (1n << 256n) - 1n]], [2, [0n, 1n << 62n, (1n << 64n) - 1n]], [3, [0n, 1n, 2n, 255n]]]) {
    for (const value of values) { const entry = [...auth]; entry[index] = scalar(value); fields[9] = [entry, entry]; positive.push(wire(4, fields)); }
  }
  compareWires(positive, true);
  const invalid = [];
  for (const [index, width] of [[0, 32], [2, 8], [3, 1], [4, 32], [5, 32]]) for (const bad of [[], '00', '0001', '01'.repeat(width + 1)]) {
    const entry = [...auth]; entry[index] = bad; fields[9] = [entry]; invalid.push(wire(4, fields));
  }
  for (const bad of ['', [''], [[]], [[...auth, '']], [auth.slice(0, 5)], [[auth[0], '', ...auth.slice(2)]]]) { fields[9] = bad; invalid.push(wire(4, fields)); }
  fields[9] = []; fields[5] = ''; invalid.push(wire(4, fields));
  compareWires(invalid);
});
test('EIP-155 v arithmetic wraps on encoding and limits decoded chain ids to u64', () => {
  const values = [...Array.from({length: 40}, (_, i) => BigInt(i)), (1n << 65n) + 33n, (1n << 65n) + 34n, (1n << 65n) + 35n, (1n << 255n), (1n << 256n) - 1n];
  h.compare(values.map(n => ['parity', word(n)]), evaluate, { requireSuccess: true });
  const chains = [0n, 1n, 2017n, (1n << 64n) - 1n, 1n << 64n, (1n << 255n) - 1n, 1n << 255n, (1n << 256n) - 1n];
  h.compare(chains.flatMap(n => [0, 1].flatMap(parity => [0, 1].map(has => ['v', String(parity), String(has), word(n)]))), evaluate, {requireSuccess: true});
});
test('Fee models saturate before capping and set-code derives its mandatory call target', () => {
  const maximum = (1n << 256n) - 1n;
  const triples = [[0n, 0n, 0n], [10n, 2n, 3n], [4n, 2n, 3n], [maximum, maximum, 1n], [maximum, 1n, maximum], [5n, maximum, maximum]];
  h.compare([0, 1, 2, 3, 4].flatMap(mode => triples.map(values => ['price', String(mode), ...values.map(word)])), evaluate, {requireSuccess: true});
});
