import test from 'node:test';
import { harness, protocolSources, protocolModules, u64, uleb, sequence } from './harness.mjs';
const modules = ['u256', 'nonce', 'bytecode', 'delegation', 'storage', 'account', 'genesis_account', 'world_state', 'transfer', 'address_word'];
const h = await harness({ name: 'state', sources: [...protocolSources, ...modules.map(name => `lib/state/${name}.ml`)],
  modules: [...protocolModules, ...modules.map(name => `${name}.ml`)], oracle: 'test/state-oracle.ml',
  fixtures: ['test/crypto.kan', 'test/protocol.kan', 'test/consensus.kan', 'test/execution.kan', 'test/state.kan'], exports: ['state_code', 'state_account', 'state_world', 'state_address', 'state_nonce'] });
const word = n => BigInt(n).toString(16).padStart(64, '0');
const address = n => BigInt(n).toString(16).padStart(40, '0');
const bytes = raw => uleb(raw.length / 2) + raw;
const slots = values => sequence(values.map(([k, v]) => word(k) + word(v)));
const account = ({ nonce = 0, balance = 0, code = '', storage = [] } = {}) => u64(nonce) + word(balance) + bytes(code) + slots(storage);
const action = (kind, raw = '') => bytes(raw) + kind.toString(16).padStart(2, '0');
const transfer = (sender, recipient, value, nonce = 0) => address(sender) + address(recipient) + word(value) + u64(nonce);
function evaluate([kind, ...args]) {
  return h.text(h.e[`state_${kind}`](...args.map(kind === 'nonce' || kind === 'address' ? h.toBytes : h.raw)));
}
test('delegation classification and deployment validation preserve prefix, length and version precedence', () => {
  const values = ['', '00', 'ef', 'ef00', 'ef01', 'ef0100', 'ef0100' + address(1), 'ef0100' + address(0),
    'ef0101' + address(1), 'ef0101' + '00'.repeat(19), 'ef0100' + '00'.repeat(21)];
  h.compare(values.map(raw => ['code', raw]), evaluate, { requireSuccess: true });
  h.compare(['00'.repeat(24576), '00'.repeat(24577), 'ef' + '00'.repeat(24576)].map(raw => ['code', raw]), evaluate, { requireSuccess: true });
});
test('accounts canonicalize storage, retain code and distinguish empty, absent and occupied states', () => {
  const events = [action(0, word(3) + word(7)), action(0, word(1) + word(2)), action(0, word(3) + word(0)),
    action(0, word(1) + word(0)), action(5, bytes('6000')), action(5, bytes('')), action(3), action(4)];
  h.compare([account(), account({ storage: [[3, 1], [1, 2], [3, 0]] }), account({ code: '6001' }), account({ nonce: 1 }), account({ balance: 1 })]
    .map(raw => ['account', raw, sequence(events)]), evaluate, { requireSuccess: true });
});
test('account credit, debit, nonce saturation and delegation assignment match checked outcomes', () => {
  const max = (1n << 256n) - 1n;
  const events = [action(1, word(1)), action(2, word(2)), action(2, word(max)), action(1, word(max)),
    action(6, address(9)), action(6, address(0)), action(4), action(3), action(7, slots([[1, 4], [2, 8], [1, 0]]))];
  h.compare([account(), account({ balance: max }), account({ nonce: 4611686018427387903n, code: '6000' })].map(raw => ['account', raw, sequence(events)]), evaluate, { requireSuccess: true });
  h.compare([-4611686018427387904n, -1, 0, 1, 4611686018427387902n, 4611686018427387903n].map(n => ['nonce', String(n)]), evaluate);
});
test('genesis allocation rejects storage without code and malformed designators and uses the last duplicate entry', () => {
  const accepted = [[], [address(1) + account()], [address(2) + account({ balance: 5 }), address(1) + account({ code: '6000', storage: [[1, 2]] })],
    [address(1) + account({ balance: 5 }), address(1) + account()], [address(1) + account({ code: 'ef0100' + address(3) })]];
  h.compare(accepted.map(entries => ['world', sequence(entries), '00']), evaluate, { requireSuccess: true });
  h.compare([account({ storage: [[1, 2]] }), account({ code: 'ef01' }), account({ code: 'ef0101' + address(2), storage: [[3, 4]] })]
    .map(raw => ['world', sequence([address(1) + raw]), '00']), evaluate);
});
test('transfers advance nonce, handle self-transfers and leave state intact on recipient overflow', () => {
  const max = (1n << 256n) - 1n;
  const alloc = sequence([address(1) + account({ balance: 100 }), address(2) + account({ balance: max }), address(3) + account({ balance: 7, code: '6000', storage: [[1, 2]] })]);
  const events = [transfer(1, 2, 1), transfer(1, 1, 50), transfer(1, 3, 40, 1), transfer(1, 3, 100, 2), transfer(1, 3, 0, 1), transfer(1, 3, 60, 2), transfer(4, 4, 0), transfer(3, 1, 1)];
  h.compare([['world', alloc, sequence(events)]], evaluate, { requireSuccess: true });
});
test('address-word conversion zero extends or keeps the low 160 bits', () => {
  h.compare([0n, 1n, 1n << 160n, (1n << 160n) - 1n, (1n << 256n) - 1n].map(value => ['address', word(value)]), evaluate, { requireSuccess: true });
});
