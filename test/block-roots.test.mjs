import test from 'node:test';
import { harness, u64, uleb, sequence } from './harness.mjs';
import { evmOracleSources } from './evm-oracle-sources.mjs';
const h = await harness({ name: 'block-roots', ...evmOracleSources, oracle: 'test/block-roots-oracle.ml',
  fixtures: ['test/crypto.kan', 'test/protocol.kan', 'test/consensus.kan', 'test/execution.kan', 'test/state.kan', 'test/evm-core.kan', 'test/evm-env.kan', 'test/block-roots.kan'],
  exports: ['evm_test_withdrawal', 'evm_test_bloom', 'evm_test_state_roots'] });
const maxInt = (1n << 62n) - 1n;
const word = n => BigInt(n).toString(16).padStart(64, '0');
const address = n => BigInt(n).toString(16).padStart(40, '0');
const bytes = raw => uleb(raw.length / 2) + raw;
const account = ({ nonce = 0, balance = 0, code = '', storage = [] } = {}) => u64(nonce) + word(balance) + bytes(code) + sequence(storage.map(([k, v]) => word(k) + word(v)));
function evaluate([kind, ...args]) {
  const types = { withdrawal: 'ttbt', bloom: 'bbbt', state_roots: 'b' }[kind];
  return h.text(h.e[`evm_test_${kind}`](...args.map((v, i) => types[i] === 'b' ? h.raw(v) : h.toBytes(v))));
}
test('Withdrawals reject negative scalars and commit ordered fixed-width addresses with minimal RLP scalars', () => {
  h.compare([-1n, 0n, 127n, 128n, maxInt].flatMap(index => [-1n, 0n, 256n].flatMap(validator => [-1n, 0n, maxInt].map(amount =>
    ['withdrawal', String(index), String(validator), address(1), String(amount)]))), evaluate, { requireSuccess: true });
});
test('Log blooms use the three Keccak bit positions, retain duplicates and round trip all 2048 bits', () => {
  h.compare(['', '00'.repeat(255), '00'.repeat(256), 'ff'.repeat(256), Buffer.from(Array.from({ length: 256 }, (_, i) => i)).toString('hex')].flatMap(initial =>
    ['', '00', 'ab'.repeat(137)].flatMap(input => [0n, 1n << 255n].map(topic => ['bloom', initial, input, address(1), word(topic)]))), evaluate, { requireSuccess: true });
});
test('State roots use secure address and slot keys and the nonce, balance, storage-root and code-hash account leaf', () => {
  const states = [[], [address(1) + account()], [address(1) + account({ balance: 1 })], [address(1) + account({ storage: [[0, 1], [1, 2], [3, 0]] })],
    [address(1) + account({ nonce: maxInt, balance: (1n << 256n) - 1n, code: '6000', storage: [[1, 127], [2, 128]] })],
    [address(2) + account({ balance: 3 }), address(1) + account({ balance: 7, code: '00' })],
    [address(1) + account({ balance: 5 }), address(1) + account()], [address(1) + account({ storage: [[1, 7], [1, 0]] })]];
  h.compare(states.map(entries => ['state_roots', sequence(entries)]), evaluate, { requireSuccess: true });
});
