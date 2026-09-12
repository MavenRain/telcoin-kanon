import test from 'node:test';
import {harness} from './harness.mjs';
import {registryOracleSources} from './registry-oracle-sources.mjs';
import {word} from './transaction-vectors.mjs';
const h = await harness({name:'committee-shuffle', ...registryOracleSources, oracle:'test/registry-oracle.ml',
  fixtures:['test/registry.kan'], exports:['registryTestShuffle']});
const evaluate = ([op, pool, size, seed]) => h.text(h.e.registryTestShuffle(h.raw(pool), h.raw(word(BigInt.asUintN(63, BigInt(size)))), h.raw(seed)));
const element = ({address = 1, activation = 0, exit = 0, status = 3, retired = 0, stake = 0, region = 0} = {}) =>
  [address, activation, exit, status, retired, stake, region].map(word).join('');
const array = rows => word(32) + word(rows.length) + rows.join('');
test('Committee shuffle matches partition, top-up, draw order and truncation', () => {
  const seeds = ['00'.repeat(32), 'ff'.repeat(32), 'a13c69f0'.repeat(8)];
  const pools = [[], [element()], Array.from({length: 12}, (_, i) => element({address: i % 7 + 1, status: [3, 4, 2][i % 3]})),
    Array.from({length: 9}, (_, i) => element({address: i + 1, status: 4}))];
  h.compare(pools.flatMap(pool => seeds.flatMap(seed => [-1, 0, 1, 4, 8, 12, 20].map(size => ['shuffle', array(pool), String(size), seed]))), evaluate, {requireSuccess: true});
});
