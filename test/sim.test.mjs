import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, protocolSources, protocolModules, u64 } from './harness.mjs';
const consensus = ['dag', 'reputation_scores', 'sub_dag', 'committed_log', 'leader_schedule', 'bullshark', 'proposer', 'voter', 'vote_aggregator', 'parent_aggregator', 'node'];
const execution = ['consensus_block', 'consensus_chain', 'nothing', 'engine'];
const h = await harness({ name: 'sim', sources: [...protocolSources, 'lib/std/nonempty.ml', 'lib/std/prng.ml', 'lib/types/leader_round.ml', 'lib/rand/chacha12.ml', 'lib/rand/std_rng.ml',
  ...consensus.map(name => `lib/consensus/${name}.ml`), ...execution.map(name => `lib/execution/${name}.ml`), 'lib/sim/sim.ml'],
  modules: [...protocolModules, 'nonempty.ml', 'prng.ml', 'tn_std.ml', 'leader_round.ml', 'chacha12.ml', 'std_rng.ml', 'tn_rand.ml',
    ...consensus.map(name => `${name}.ml`), 'tn_consensus.ml', ...execution.map(name => `${name}.ml`), 'tn_execution.ml', 'sim.ml'],
  extraAliases: { 'tn_std.ml': ['Nonempty', 'Prng'], 'tn_rand.ml': ['Std_rng'],
    'tn_consensus.ml': consensus.map(name => name[0].toUpperCase() + name.slice(1)), 'tn_execution.ml': ['Nothing', 'Engine'] },
  oracle: 'test/sim-oracle.ml', fixtures: ['test/crypto.kan', 'test/protocol.kan', 'test/consensus.kan', 'test/node.kan', 'test/sim.kan'], exports: ['sim_test'] });
const row = ({ n = 4, seed = 42, horizon = 3000, steps = 1000, lo = 10, hi = 50, drops = 0, crashed = 'empty', count = 0, period = 100, window = 2, depth = 10 } = {}) =>
  [n, seed, horizon, steps, lo, hi, drops, crashed, count, period, window, depth].map(String);
function evaluate([n, seed, horizon, steps, lo, hi, drops, crashed, count, period, window, depth]) {
  return h.text(h.e.sim_test(h.seeds(Array.from({ length: Number(n) }, (_, i) => i).join(',')), h.raw(u64(seed)),
    ...[horizon, steps, lo, hi, drops].map(Number), h.seeds(crashed), ...[count, period, window, depth].map(Number)));
}
test('seeded simulator reproduces event counts, complete committed wire and execution chains', () => {
  const values = [row(), row({ n: 7, horizon: 2000 }), row({ seed: 7, window: 1, depth: 2 })];
  h.compare(values, evaluate, { requireSuccess: true });
  const result = evaluate(values[0]).split('/');
  assert.equal(result[2], 'none');
  assert.match(result[3], /^agree:[1-9]/);
  assert.equal(evaluate(values[0]), evaluate(values[0]));
});
test('simulator preserves equal-time ordering, horizon limits and maximum delivery steps', () => {
  h.compare([row({ steps: 0 }), row({ steps: 1 }), row({ horizon: 0 }), row({ lo: 0, hi: 0, steps: 200 }),
    row({ lo: 50, hi: 10 }), row({ horizon: 499 }), row({ horizon: 500 })], evaluate, { requireSuccess: true });
});
test('crashed nodes, separate loss randomness and undropped local batches match OCaml', () => {
  h.compare([row({ crashed: '0' }), row({ crashed: '0,1' }), row({ crashed: '0,1,2,3' }), row({ drops: 200 }),
    row({ drops: 1000, count: 4 }), row({ drops: 1500 }), row({ count: 1 }), row({ count: 4 }),
    row({ count: 4, crashed: '2', drops: 200, period: 0 })], evaluate, { requireSuccess: true });
});
