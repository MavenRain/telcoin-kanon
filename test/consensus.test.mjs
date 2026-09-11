import test from 'node:test';
import { harness, protocolSources, protocolModules, header, hash, sequence, u32, u64 } from './harness.mjs';
const h = await harness({ name: 'consensus', sources: [...protocolSources, 'lib/std/nonempty.ml', 'lib/consensus/dag.ml', 'lib/consensus/vote_aggregator.ml', 'lib/consensus/parent_aggregator.ml', 'lib/consensus/voter.ml'],
  modules: [...protocolModules, 'nonempty.ml', 'tn_std.ml', 'dag.ml', 'vote_aggregator.ml', 'parent_aggregator.ml', 'voter.ml'],
  extraAliases: { 'tn_std.ml': ['Nonempty'] }, oracle: 'test/consensus-oracle.ml',
  fixtures: ['test/crypto.kan', 'test/protocol.kan', 'test/consensus.kan'], exports: ['consensus_dag', 'consensus_recover', 'consensus_votes', 'consensus_parents', 'consensus_voter'] });
function evaluate([kind, ...args]) {
  if (kind === 'dag') return h.text(h.e.consensus_dag(Number(args[0]), h.raw(args[1]), h.raw(args[2])));
  if (kind === 'recover') return h.text(h.e.consensus_recover(Number(args[0]), Number(args[1]), h.raw(args[2])));
  if (kind === 'votes') return h.text(h.e.consensus_votes(h.seeds(args[0]), h.raw(args[1]), h.raw(args[2])));
  if (kind === 'parents') return h.text(h.e.consensus_parents(h.seeds(args[0]), h.raw(args[1])));
  if (kind === 'voter') return h.text(h.e.consensus_voter(h.seeds(args[0]), h.raw(args[1]), h.raw(args[2]), h.toBytes(args[3]), Number(args[4])));
  throw new Error(kind);
}
const compare = rows => h.compare(rows, evaluate);
const actions = pairs => sequence(pairs.map(([kind, index]) => kind.toString(16).padStart(2, '0') + u32(index)));
const votes = pairs => sequence(pairs.map(([seed, mode]) => u64(seed) + mode.toString(16).padStart(2, '0')));
const one = header({ round: 1 });
const two = header({ round: 2, parents: [hash(one)] });
const three = header({ round: 3, parents: [hash(two)] });
const four = header({ round: 4, parents: [hash(three)] });
const equivocation = header({ round: 1, time: 1 });
test('DAG layering, equivocation, idempotence and round/digest lookups match source', () => {
  const values = [header(), one, two, three, four, equivocation, header({ round: 2, parents: [hash(header())] })];
  compare([
    ['dag', '2', sequence(values), actions([[0, 0], [0, 2], [0, 1], [0, 1], [0, 5], [0, 6], [0, 2], [0, 3], [0, 4], [3, 1], [4, 5]])],
    ['dag', '2', sequence([one, header({ round: 2 })]), actions([[0, 1], [0, 0], [0, 1]])],
  ]);
});
test('DAG commit watermarks, GC horizons and recovery retain source behavior', () => {
  const values = [one, two, three, four, header({ seed: 2, round: 1 }), equivocation];
  compare([0, 1, 2, 10].map(depth => ['dag', String(depth), sequence(values), actions([[0, 0], [0, 1], [0, 2], [0, 3], [2, 2], [0, 0], [0, 2], [0, 4], [4, 0], [4, 2]])]));
  compare([0, 1, 2, 10].flatMap(depth => [0, 2, 4].map(committed => ['recover', String(depth), String(committed), sequence([four, one, three, two])])));
  compare([['recover', '10', '0', sequence([one, equivocation])], ['recover', '0', '1', sequence([one, equivocation])]]);
});
test('DAG deterministic operation transcripts agree across insertion and commit orderings', () => {
  const headers = Array.from({ length: 12 }, (_, i) => header({ seed: i % 4 + 1, round: Math.floor(i / 4) + 1, time: i }));
  let seed = 123456;
  const rows = Array.from({ length: 24 }, (_, i) => {
    const commands = Array.from({ length: 30 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return [seed % 5, (seed >>> 4) % headers.length]; });
    return ['dag', String(i % 5), sequence(headers), actions(commands)];
  });
  compare(rows);
});
test('vote aggregator consumes an author slot before validation and counts only valid voters', () => {
  compare([
    [[1, 0], [2, 0], [3, 0], [4, 0], [1, 0]],
    [[1, 1], [1, 0], [2, 0], [3, 0], [4, 0]],
    [[1, 2], [1, 0], [2, 0], [3, 0], [4, 0]],
    [[99, 0], [99, 0], [1, 0], [2, 0], [3, 0]],
    [[99, 1], [99, 0]],
  ].map(commands => ['votes', '1,2,3,4', one, votes(commands)]));
});
test('parent aggregator drains releases while retaining quorum weight and duplicate history', () => {
  compare([
    [1, 2, 3, 4], [1, 1, 2, 3, 2, 4], [99, 1, 2, 3, 4, 99], [4, 3, 2, 1], [],
  ].map(seeds => ['parents', '1,2,3,4', sequence(seeds.map(seed => header({ seed, round: 1 })))]));
});
const genesisDigests = [1, 2, 3, 4].map(seed => hash(header({ seed }))).sort();
const r1 = [1, 2, 3, 4].map(seed => header({ seed, round: 1, time: 1, parents: genesisDigests }));
const r2 = header({ round: 2, time: 2, parents: r1.map(hash).sort() });
const voterRow = (stored, requests, now = '10', recover = '0') => ['voter', '1,2,3,4', sequence(stored), sequence(requests), now, recover];
test('voter recast, restart recovery and latest-round dedup match the source', () => {
  const changed = header({ round: 1, time: 2, parents: genesisDigests });
  compare([
    voterRow([], [r1[0], r1[0], changed, r1[1], r1[0]]),
    voterRow([], [r1[0], r1[0], changed, r1[1], r1[0]], '10', '1'),
    voterRow([r1[0]], [r1[0], changed]),
    voterRow(r1, [r1[0], r2, r1[0], r2], '10', '1'),
  ]);
});
test('voter rejection order, missing parents, layering and distinct-origin quorum match source', () => {
  compare([
    voterRow([], [header(), header({ epoch: 1 }), header({ seed: 99 }), header({ round: 1 })]),
    voterRow([], [header({ round: 1, parents: ['ff'.repeat(32), ...genesisDigests.slice(0, 2)].sort() })]),
    voterRow([], [header({ round: 2, parents: genesisDigests })]),
    voterRow([], [header({ round: 1, parents: genesisDigests.slice(0, 2) })]),
    voterRow(r1, [header({ round: 2, parents: r1.map(hash).sort(), time: 0 })]),
    voterRow(r1, [header({ round: 2, parents: [...r1.map(hash), 'ff'.repeat(32)].sort(), time: 0 })]),
  ]);
});
test('voter clock drift tolerance admits one second and saturates at signed timestamp maximum', () => {
  compare([
    voterRow([], [r1[0]], '0'),
    voterRow([], [header({ round: 1, time: 2, parents: genesisDigests })], '0'),
    voterRow([], [header({ round: 1, time: '9223372036854775807', parents: genesisDigests })], '9223372036854775806'),
    voterRow([], [header({ round: 1, time: '9223372036854775807', parents: genesisDigests })], '9223372036854775807'),
  ]);
});
