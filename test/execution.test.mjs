import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, protocolSources, protocolModules, header, hash, sequence, u16, u32, u64 } from './harness.mjs';
const h = await harness({ name: 'execution', sources: [...protocolSources, 'lib/std/nonempty.ml',
  'lib/consensus/reputation_scores.ml', 'lib/consensus/sub_dag.ml',
  ...['consensus_block', 'consensus_chain', 'nothing', 'engine', 'replay', 'consensus_store'].map(name => `lib/execution/${name}.ml`)],
  modules: [...protocolModules, 'nonempty.ml', 'tn_std.ml', 'reputation_scores.ml', 'sub_dag.ml', 'tn_consensus.ml',
    'consensus_block.ml', 'consensus_chain.ml', 'nothing.ml', 'engine.ml', 'replay.ml', 'consensus_store.ml'],
  extraAliases: { 'tn_std.ml': ['Nonempty'], 'tn_consensus.ml': ['Reputation_scores', 'Sub_dag'] },
  oracle: 'test/execution-oracle.ml', fixtures: ['test/crypto.kan', 'test/protocol.kan', 'test/consensus.kan', 'test/execution.kan'],
  exports: ['execution_genesis', 'execution_block', 'execution_number', 'execution_chain', 'execution_noop', 'execution_record', 'execution_store', 'execution_replay'] });
const zero = '00'.repeat(32);
const batch = (txs = []) => sequence(txs.map(tx => sequence(Array.from(Buffer.from(tx, 'hex'), v => v.toString(16).padStart(2, '0'))))) + u32(0) + '14' + '00'.repeat(20) + u64(7) + u16(0);
const bodies = [batch(), batch(['deadbeef']), batch(['01', '0203'])];
const subdag = ({ round = 2, epoch = 0, payload = [], time = round } = {}) =>
  sequence([header({ round, epoch, time, payload })]) + '0000' + u64(time) + '20' + zero;
const block = (sd, number = 1, parent = zero, extra = zero) => '20' + parent + sd + u64(number) + '20' + extra;
const dags = [subdag(), subdag({ round: 4 }), subdag({ round: 6 }), subdag({ round: 2, epoch: 1 })];
const actions = values => sequence(values.map(([kind, value = 0]) => kind.toString(16).padStart(2, '0') + u32(value)));
function evaluate([kind, ...args]) {
  if (kind === 'genesis') return h.text(h.e.execution_genesis());
  if (kind === 'record') return h.text(h.e.execution_record(h.raw(args[0]), h.raw(args[1])));
  if (kind === 'store') return h.text(h.e.execution_store(...args.map(h.raw)));
  if (kind === 'replay') return h.text(h.e.execution_replay(h.raw(args[0]), Number(args[1]), Number(args[2]), { normal: 0, hole: 1, link: 2 }[args[3]], Number(args[4])));
  return h.text(h.e[`execution_${kind}`](h.raw(args[0])));
}
test('consensus genesis, block wire, preimage and ignored extra field match OCaml', () => {
  h.compare([['genesis'], ...[0, 1, 4294967296n, 4611686018427387903n].map(n => ['block', block(dags[0], n)]),
    ['block', block(dags[1], 5, 'ab'.repeat(32), 'cd'.repeat(32))]], evaluate, { requireSuccess: true });
  const plain = evaluate(['block', block(dags[0])]).split(':');
  const extra = evaluate(['block', block(dags[0], 1, zero, 'ff'.repeat(32))]).split(':');
  assert.equal(plain[1], extra[1]);
  assert.equal(plain[2], extra[2]);
  const valid = block(dags[0]);
  h.compare([valid + '00', valid.slice(0, -2), block(dags[0], 4611686018427387904n), '1f' + valid.slice(4)].map(raw => ['block', raw]), evaluate);
});
test('consensus height bounds and saturating successor match OCaml', () => {
  h.compare([0, 1, 4294967296n, 4611686018427387902n, 4611686018427387903n, 4611686018427387904n, 18446744073709551615n].map(n => ['number', u64(n)]), evaluate);
});
test('chain and no-op engine produce one linked block per committed sub-DAG', () => {
  h.compare([[], dags.slice(0, 1), dags].flatMap(values => ['chain', 'noop'].map(kind => [kind, sequence(values)])), evaluate, { requireSuccess: true });
});
test('record resolution preserves commit order and duplicate references', () => {
  const payload = bodies.map((body, i) => '20' + hash(body) + u16(i)).sort();
  const sd = sequence([header({ round: 1, payload }), header({ round: 2, payload: payload.slice(1) })]) + '0000' + u64(2) + '20' + zero;
  h.compare([bodies, bodies.slice().reverse(), [...bodies, bodies[0]], [...bodies, batch(['ff'])]].map(values => ['record', block(sd), sequence(values)]), evaluate, { requireSuccess: true });
  h.compare([[], bodies.slice(1), bodies.slice(0, 2)].map(values => ['record', block(sd), sequence(values)]), evaluate);
});
test('store checks append order, idempotent retries, forks, lookups and epoch boundaries', () => {
  const transcripts = [[], [[2, 0], [2, 1], [4]], [[0, 1], [6, 0], [0, 0], [0, 0], [6, 0], [0, 1], [0, 2], [4]],
    [[0, 0], [2, 1], [3, 0], [3, 2], [5, 0], [5, 1], [7, 0], [0, 2]],
    [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [4], [0, 2], [0, 3], [4], [5, 1], [1, 1], [1, 2], [4], [2, 4]]];
  h.compare(transcripts.map(values => ['store', sequence(dags), '00', actions(values)]), evaluate, { requireSuccess: true });
});
test('replay validates every parent link and hole and normalizes empty ranges', () => {
  h.compare([[0, 3], [1, 3], [2, 3], [3, 3], [3, 1], [0, 0]].map(([after, upto]) => ['replay', sequence(dags), String(after), String(upto), 'normal', '0']), evaluate, { requireSuccess: true });
  h.compare(['hole', 'link'].flatMap(mode => [0, 1, 2].map(index => ['replay', sequence(dags), '0', '3', mode, String(index)])), evaluate);
  h.compare([['replay', sequence(dags), '0', '5', 'normal', '0']], evaluate);
});
