import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, uleb, sequence } from './harness.mjs';
const h = await harness({ name: 'trie', sources: ['lib/codec/bcs.ml', 'lib/state/u256.ml', 'lib/keccak/tn_keccak.ml', 'lib/rlp/rlp.ml', ...['nibbles', 'hex_prefix', 'node', 'trie'].map(n => `lib/trie/${n}.ml`)],
  modules: ['bcs.ml', 'u256.ml', 'tn_state.ml', 'tn_keccak.ml', 'rlp.ml', 'tn_rlp.ml', 'nibbles.ml', 'hex_prefix.ml', 'node.ml', 'trie.ml'],
  extraAliases: { 'tn_state.ml': ['U256'], 'tn_rlp.ml': ['Rlp'] }, oracle: 'test/trie-oracle.ml', fixtures: ['test/evm-core.kan', 'test/trie.kan'],
  exports: ['trie_test_nibbles', 'trie_test_mask', 'trie_test_prefix', 'trie_test_node', 'trie_test_child_options', 'trie_test_root', 'trie_test_ordered', 'trie_test_account'] });
const blob = raw => uleb(raw.length / 2) + raw;
const blobs = values => sequence(values.map(blob));
const entries = values => sequence(values.map(([key, value]) => blob(key) + blob(value)));
const word = n => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0');
function evaluate([kind, ...args]) {
  const types = { nibbles: 'bbtt', mask: 'b', prefix: 'b', node: 'bb', child_options: 'n', root: 'bn', ordered: 'b', account: 'ttbb' }[kind];
  return h.text(h.e[`trie_test_${kind}`](...args.map((value, i) => types[i] === 'n' ? Number(value) : types[i] === 't' ? h.toBytes(value) : h.raw(value))));
}
test('Nibble access, clamping, lexicographic ordering, masks and odd packing match OCaml', () => {
  h.compare(['', '12', '1234', '123456', 'ff00'].flatMap(a => ['', '12', '1235'].flatMap(b => [-1, 0, 1, 3, 9].map(start =>
    ['nibbles', a, b, String(start), String(start + 2)]))), evaluate, { requireSuccess: true });
  h.compare([[], [0], [15], [-1, 16, 17], [-4611686018427387904n, 4611686018427387903n], [1, 2, 3, 4, 5]].map(values =>
    ['mask', blobs(values.map(value => Buffer.from(String(value)).toString('hex')))]), evaluate, { requireSuccess: true });
  h.compare(['', ...Array.from({ length: 256 }, (_, n) => n.toString(16).padStart(2, '0') + '12ab')].map(raw => ['prefix', raw]), evaluate, { requireSuccess: true });
  // Avoid the source's unchecked pos + len overflow while retaining clamping.
  assert.equal(evaluate(['nibbles', '123456', '123456', '1', '4611686018427387903']), '123456:123456:2:23456:23456:5:0');
});
test('Trie leaf, extension and branch encodings apply the exact 32-byte child-collapse threshold', () => {
  h.compare([0, 1, 2].map(mode => ['child_options', String(mode)]), evaluate, { requireSuccess: true });
  h.compare(['', '12', '001234'].flatMap(path => [0, 1, 27, 28, 29, 31, 32, 55, 56].map(length =>
    ['node', path, 'ab'.repeat(length)])), evaluate, { requireSuccess: true });
});
test('Trie roots preserve prefixes, branch values, sorted insertion order and duplicate rejection', () => {
  const sets = [[], [['', '']], [['01', 'ff']], [['', 'aa'], ['00', 'bb'], ['0001', 'cc']], [['12', '00'], ['1234', '0102'], ['1235', 'ff'], ['ff', '']],
    [['aa'.repeat(32), 'bb'.repeat(60)], ['aa'.repeat(31) + 'ab', '01']], [['01', 'aabb'], ['01', 'cc']], [['02', 'aa'], ['01', 'bb'], ['02', 'cc'], ['01', 'dd']]];
  h.compare(sets.flatMap(values => [values, values.slice().reverse()].flatMap(order => [0, 1].map(secure => ['root', entries(order), String(secure)]))), evaluate, { requireSuccess: true });
  assert.equal(evaluate(['root', entries([]), '0']), '56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421');
  const random = Array.from({ length: 24 }, (_, i) => [i.toString(16).padStart(2, '0') + 'abcdef', (i + 1).toString(16).padStart(2, '0').repeat(i % 4 + 1)]);
  h.compare([['root', entries(random), '0'], ['root', entries(random), '1']], evaluate, { requireSuccess: true });
});
test('Ordered trie roots retain index/value pairs across the RLP index permutation boundary', () => {
  h.compare([0, 1, 2, 3, 16, 127, 128, 129, 130].map(length => ['ordered', blobs(Array.from({ length }, (_, i) => word(i).slice(-8)))]), evaluate, { requireSuccess: true });
});
test('Account RLP preserves nonce, scalar balance and byte-string root fields', () => {
  h.compare([0n, 127n, 128n, 4611686018427387903n].flatMap(nonce => [0n, 1n, 1n << 255n].map(balance =>
    ['account', String(nonce), word(balance), 'ab'.repeat(32), 'cd'.repeat(32)])), evaluate, { requireSuccess: true });
});
