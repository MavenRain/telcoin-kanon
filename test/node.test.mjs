import test from 'node:test';
import { harness, protocolSources, protocolModules, header, hash, sequence, uleb, u32, u64 } from './harness.mjs';
const h = await harness({ name: 'node', sources: [...protocolSources, 'lib/std/nonempty.ml', 'lib/types/leader_round.ml', 'lib/rand/chacha12.ml', 'lib/rand/std_rng.ml',
  ...['dag', 'reputation_scores', 'sub_dag', 'committed_log', 'leader_schedule', 'bullshark', 'proposer', 'voter', 'vote_aggregator', 'parent_aggregator', 'node'].map(name => `lib/consensus/${name}.ml`)],
  modules: [...protocolModules, 'nonempty.ml', 'tn_std.ml', 'leader_round.ml', 'chacha12.ml', 'std_rng.ml', 'tn_rand.ml', 'dag.ml', 'reputation_scores.ml', 'sub_dag.ml', 'committed_log.ml',
    'leader_schedule.ml', 'bullshark.ml', 'proposer.ml', 'voter.ml', 'vote_aggregator.ml', 'parent_aggregator.ml', 'node.ml'],
  extraAliases: { 'tn_std.ml': ['Nonempty'], 'tn_rand.ml': ['Std_rng'] }, oracle: 'test/node-oracle.ml',
  fixtures: ['test/crypto.kan', 'test/protocol.kan', 'test/consensus.kan', 'test/proposer.kan', 'test/node.kan'], exports: ['node_test'] });
const byteString = raw => uleb(raw.length / 2) + raw;
const event = (kind, payload, now = 100) => byteString(Buffer.from([kind]).toString('hex') + u64(now) + byteString(payload));
const vote = (seed, mode = 0) => event(2, u64(seed) + Buffer.from([mode]).toString('hex'));
const gossip = (h, now = 100) => event(3, h, now);
const request = (sender, h, parents = [], now = 100) => event(1, u64(sender) + h + sequence(parents), now);
const timer = (kind, generation, now = 100) => event(4, Buffer.from([kind]).toString('hex') + u32(generation), now);
const recover = (now = 100) => event(5, '', now);
function compare(events, window = 2, depth = 3) {
  h.compare([[String(window), String(depth), sequence(events)]], ([window, depth, raw]) =>
    h.text(h.e.node_test(h.seeds('1,2,3,4,5,6,7'), Number(window), Number(depth), h.raw(raw))), { requireSuccess: true });
}
test('node startup, implicit self-vote, quorum broadcast and invalid-vote ordering agree', () => {
  compare([]);
  compare([vote(2), vote(3), vote(4), vote(5), vote(6), vote(7), vote(2)]);
  compare([vote(2, 1), vote(2), vote(3, 2), vote(3), vote(99), vote(4), vote(5), vote(6), vote(7)]);
});
test('node vote requests resolve genesis, offered ancestry and missing parents in source order', () => {
  const genesis = Array.from({ length: 7 }, (_, i) => header({ seed: i + 1, round: 0 }));
  const parents = genesis.map(hash).sort();
  const one = header({ seed: 2, round: 1, parents });
  compare([request(2, one), request(3, one), recover(), request(2, one), request(1, header({ seed: 1, round: 1, parents }))]);
  const layer = Array.from({ length: 7 }, (_, i) => header({ seed: i + 1, round: 1, parents }));
  const two = header({ seed: 2, round: 2, parents: layer.map(hash).sort() });
  compare([request(2, two), request(2, two, layer.slice(0, 3)), request(2, two, layer.slice(3)), request(2, two), recover(), request(2, two)]);
  compare([request(2, header({ seed: 2, epoch: 1, round: 1, parents })), request(2, header({ seed: 2, round: 1, time: 103, parents }), [], 100)]);
});
test('node gossip tolerates missing ancestry and rejects equivocation without leaking transitions', () => {
  const one = header({ seed: 2, round: 1 });
  const two = header({ seed: 2, round: 2, parents: [hash(one)] });
  compare([gossip(two), gossip(one), gossip(two), gossip(one), gossip(header({ seed: 2, round: 1, time: 1 })), gossip(header({ seed: 4, round: 2, epoch: 1 }))]);
});
test('node recovery rebuilds parent quorums and preserves committed output across schedule windows', () => {
  const events = [];
  let parents = [];
  for (let round = 1; round <= 5; round++) {
    const layer = Array.from({ length: 7 }, (_, i) => header({ seed: i + 1, round, time: round, parents }));
    events.push(...layer.map(value => gossip(value)), recover(), timer(1, 0));
    parents = layer.map(hash).sort();
  }
  for (const window of [1, 3]) for (const depth of [0, 3]) compare(events, window, depth);
});
test('node recovers an empty frontier without inventing parents or reviving volatile votes', () => {
  compare([vote(2), vote(3), recover(), vote(4), vote(5), vote(6), timer(1, 0), recover(), timer(0, 0)]);
});
