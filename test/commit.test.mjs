import test from 'node:test';
import { harness, protocolSources, protocolModules, authorityId, header, hash, sequence, uleb, u16, u32, u64 } from './harness.mjs';
const h = await harness({ name: 'commit', sources: [...protocolSources, 'lib/std/nonempty.ml', 'lib/types/leader_round.ml',
  'lib/rand/chacha12.ml', 'lib/rand/std_rng.ml', 'lib/consensus/dag.ml', 'lib/consensus/reputation_scores.ml', 'lib/consensus/sub_dag.ml', 'lib/consensus/committed_log.ml', 'lib/consensus/leader_schedule.ml', 'lib/consensus/bullshark.ml', 'lib/consensus/proposer.ml'],
  modules: [...protocolModules, 'nonempty.ml', 'tn_std.ml', 'leader_round.ml', 'chacha12.ml', 'std_rng.ml', 'tn_rand.ml', 'dag.ml', 'reputation_scores.ml', 'sub_dag.ml', 'committed_log.ml', 'leader_schedule.ml', 'bullshark.ml', 'proposer.ml'],
  extraAliases: { 'tn_std.ml': ['Nonempty'], 'tn_rand.ml': ['Std_rng'] }, oracle: 'test/commit-oracle.ml',
  fixtures: ['test/crypto.kan', 'test/protocol.kan', 'test/consensus.kan', 'test/commit.kan', 'test/proposer.kan'],
  exports: ['commit_scores', 'commit_schedule', 'commit_subdag', 'commit_create', 'commit_bullshark', 'commit_proposer'] });
const roster = '1,2,3,4,5,6,7';
const scoreWire = (values, final = true) => sequence(values.map((value, i) => authorityId(i + 1) + u64(value)).sort()) + (final ? '01' : '00');
const rounds = sequence([0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 256, 1000, 4294967294].map(u32));
function evaluate([kind, ...args]) {
  if (kind === 'proposer') return h.text(h.e.commit_proposer(h.seeds(roster), Number(args[0]), h.raw(args[1] === 'none' ? '00' : '01' + args[1]), h.raw(args[2])));
  if (kind === 'bullshark') return h.text(h.e.commit_bullshark(h.seeds(roster), h.raw(args[0]), Number(args[1]), Number(args[2]), Number(args[3])));
  if (kind === 'scores') return h.text(h.e.commit_scores(h.raw(args[0]), h.seeds(args[1])));
  if (kind === 'schedule') return h.text(h.e.commit_schedule(h.seeds(roster), h.raw(args[0]), Number(args[1]), h.raw(args[2])));
  if (kind === 'subdag') return h.text(h.e.commit_subdag(h.raw(args[0])));
  return h.text(h.e.commit_create(h.raw(args[0]), h.raw(args[1]), h.toBytes(args[2]), Number(args[3])));
}
test('reputation maps preserve wire order, closed membership and descending score ties', () => {
  const distributions = [[], [0], [0, 0, 0, 0, 0, 0, 0], [3, 1, 2, 1, 0, 3, 2]];
  h.compare(distributions.flatMap(values => [false, true].flatMap(final => ['empty', '1,2,3,1,99,2'].map(bumps => ['scores', scoreWire(values, final), bumps]))), evaluate);
  const valid = scoreWire([2, 3]);
  const malformed = [valid + '00', valid.slice(0, -2), scoreWire([4611686018427387904n]), scoreWire([18446744073709551615n]),
    sequence([authorityId(1) + u64(0), authorityId(1) + u64(1)]) + '00', sequence([authorityId(1) + u64(0), authorityId(2) + u64(1)].sort().reverse()) + '00'];
  h.compare(malformed.map(raw => ['scores', raw, 'empty']), evaluate);
});
test('leader swap tables and elections match thresholds, score ties and seeded picks', () => {
  const distributions = [[], [0, 0, 0, 0, 0, 0, 0], [10, 10, 10, 10, 10, 10, 10], [9, 10, 9, 10, 9, 10, 9],
    [0, 0, 0, 10, 10, 10, 10], [0, 1, 2, 3, 7, 12, 12], [100, 0, 0, 0, 0, 0, 0]];
  let state = 789;
  for (let i = 0; i < 16; i++) distributions.push(Array.from({ length: 7 }, () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % 40; }));
  h.compare(distributions.flatMap(values => [0, 15, 33].map(threshold => ['schedule', scoreWire(values), String(threshold), rounds])), evaluate);
  h.compare([['schedule', scoreWire([0, 0, 0, 10, 10, 10, 10], false), '33', rounds]], evaluate);
});
test('sub-DAG stored wire, preimages, digest and timestamp view agree', () => {
  const first = header({ round: 1, time: 3, payload: ['20' + '11'.repeat(32) + u16(2)] });
  const leader = header({ seed: 2, round: 2, epoch: 2147483648, time: 5, payload: ['20' + '11'.repeat(32) + u16(3)] });
  const wire = stored => sequence([first, leader]) + scoreWire([2, 1, 0]) + u64(stored) + '20' + 'ab'.repeat(32);
  h.compare([0, 1, 5, 9, 9223372036854775807n].map(stored => ['subdag', wire(stored)]), evaluate, { requireSuccess: true });
  const valid = wire(5);
  h.compare([wire(9223372036854775808n), '00' + scoreWire([]) + u64(0) + '20' + '00'.repeat(32), valid + '00', valid.slice(0, -2), valid.slice(0, -66) + '1f' + '00'.repeat(31)].map(raw => ['subdag', raw]), evaluate);
});
test('sub-DAG creation clamps against stored time and hashes default or aggregate signatures', () => {
  h.compare([0, 5, 9].flatMap(time => [0, 3, 12].flatMap(previous => [0, 1].map(signed => ['create', sequence([header({ round: 1, time: 99 }), header({ round: 2, time })]), scoreWire([0, 2, 1]), String(previous), String(signed)]))), evaluate, { requireSuccess: true });
});
test('Bullshark commits, schedule windows and recovery agree through complete DAG layers', () => {
  const headers = [];
  let parents = [];
  for (let round = 1; round <= 7; round++) {
    const layer = Array.from({ length: 7 }, (_, i) => header({ seed: i + 1, round, time: round * 3 + i % 3, parents }));
    headers.push(...layer);
    parents = layer.map(hash).sort();
  }
  h.compare([1, 2, 3].flatMap(window => [0, 2, 10].flatMap(depth => [0, 1].map(recover => ['bullshark', sequence(headers), String(window), String(depth), String(recover)]))), evaluate);
});
test('Bullshark refuses absent ancestry and equivocation and handles reordered and duplicate arrivals', () => {
  const first = Array.from({ length: 7 }, (_, i) => header({ seed: i + 1, round: 1 }));
  const second = Array.from({ length: 7 }, (_, i) => header({ seed: i + 1, round: 2, parents: first.map(hash).sort() }));
  const third = Array.from({ length: 7 }, (_, i) => header({ seed: i + 1, round: 3, parents: second.map(hash).sort() }));
  h.compare([
    [third[0], ...first, ...second.slice().reverse(), third[0], third[0], ...third.slice(1), first[0]],
    [...first, header({ seed: 1, round: 1, time: 99 }), ...second, ...third],
    [...first, ...second.slice(0, 2), header({ round: 3, parents: [hash(second[0])] })],
  ].map(values => ['bullshark', sequence(values), '2', '10', '0']), evaluate);
});
const byteString = raw => uleb(raw.length / 2) + raw;
const event = (kind, payload, now = 0) => byteString(Buffer.from([kind]).toString('hex') + u64(now) + byteString(payload));
const digestEvent = (id, now = 0) => event(0, '20' + Buffer.alloc(32, id).toString('hex') + u32(id % 3), now);
const parentsEvent = (round, seeds = [1, 2, 3, 4, 5, 6, 7], now = 0) => event(1, u32(round) + sequence(seeds.map(seed => header({ seed, round, time: round * 2 }))), now);
const timerEvent = (kind, generation, now = 0) => event(kind, u32(generation), now);
test('proposer startup, leader delays and stale timer generations match event by event', () => {
  h.compare([
    [],
    [timerEvent(3, 0), timerEvent(2, 1), parentsEvent(1), timerEvent(3, 1), parentsEvent(2), timerEvent(3, 2), timerEvent(3, 3)],
    [parentsEvent(4, [1]), timerEvent(3, 1), timerEvent(2, 2), timerEvent(3, 2), parentsEvent(3), parentsEvent(5)],
  ].map(events => ['proposer', '0', 'none', sequence(events)]), evaluate);
});
test('proposer drains batches at the cap and requeues skipped rounds oldest first', () => {
  h.compare([
    [digestEvent(1), digestEvent(2), digestEvent(3), parentsEvent(1), parentsEvent(2), timerEvent(3, 2), event(4, sequence([1, 3].map(u32))), parentsEvent(3), timerEvent(3, 3)],
    [digestEvent(1), digestEvent(1), digestEvent(2), digestEvent(3), parentsEvent(1), timerEvent(3, 2), parentsEvent(2), event(4, sequence([3].map(u32))), timerEvent(3, 3)],
  ].map(events => ['proposer', '0', 'none', sequence(events)]), evaluate);
});
test('proposer recovery repeats the stored header verbatim and preserves queued work', () => {
  const stored = header({ seed: 1, round: 5, time: 88, payload: ['20' + 'bc'.repeat(32) + u16(2)] });
  h.compare([
    ['proposer', '4', stored, sequence([digestEvent(4), parentsEvent(4), timerEvent(3, 0), parentsEvent(5), timerEvent(3, 1)])],
    ['proposer', '2', stored, sequence([parentsEvent(4), timerEvent(3, 1), parentsEvent(5)])],
    ['proposer', '4', 'none', sequence([timerEvent(3, 0), parentsEvent(4, [1, 2], 100), timerEvent(3, 0, 101)])],
  ], evaluate, { requireSuccess: true });
});
test('proposer observes schedule updates before recomputing readiness and delays', () => {
  const changes = [[0, 0, 0, 10, 10, 10, 10], [10, 0, 10, 10, 0, 10, 0]];
  h.compare(changes.map(values => ['proposer', '0', 'none', sequence([parentsEvent(1), event(5, scoreWire(values)), parentsEvent(1), parentsEvent(2, [1, 2]),
    timerEvent(3, 2), parentsEvent(2, [3, 4, 5, 6, 7]), parentsEvent(3), timerEvent(2, 3)])]), evaluate);
});
