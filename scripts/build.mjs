import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceClosure } from './source-closure.mjs';

export const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(resolve(project, 'source-lock.json'), 'utf8'));
export const compiler = process.env.KANON_BIN ?? resolve(process.env.TELCOIN_KANON_ROOT ?? lock.toolchain.root, '_build/default/bin/kanon.exe');
export const sources = ['core', 'nat64', 'scalars', 'bcs', 'codec', 'fixed', 'scalar_ops', 'crypto_types', 'sequence',
  'collections', 'crypto_collections', 'nonempty', 'prng', 'blake2s', 'chacha12', 'rand_seq',
  'keccak_words', 'keccak_permutation', 'keccak', 'crypto_stub', 'committee',
  'protocol_codec', 'batch', 'block_num_hash', 'header', 'vote', 'certificate_types', 'vertex_collections', 'certificate',
  'ordered', 'dag', 'aggregators', 'voter', 'reputation_scores', 'leader_schedule', 'sub_dag', 'consensus_collections', 'committed_log',
  'bullshark', 'proposer_types', 'machine_collections', 'proposer', 'node_types', 'node_collections', 'node',
  'consensus_block', 'consensus_chain', 'consensus_record', 'execution_collections', 'engine', 'replay', 'consensus_store',
  'sim_collections', 'sim_types', 'sim', 'sim_service', 'u256', 'storage_collections', 'state_types', 'state_collections', 'state',
  'alu', 'evm_types', 'opcode', 'host_int_ops', 'modular256', 'secp256k1', 'evm_collections', 'evm_enums', 'evm_stack', 'access', 'evm_memory', 'gas', 'evm_data', 'transient',
  'rlp_types', 'rlp_collections', 'rlp', 'nibbles', 'trie_collections', 'trie_node', 'trie', 'evm_log', 'log_collections', 'log_journal',
  'evm_spec', 'env_collections', 'block_hashes', 'lifecycle', 'env', 'effects', 'execution_primitives', 'fork_schedule',
  'withdrawal', 'block_collections', 'state_roots', 'bloom', 'block_context', 'interpreter_types', 'interpreter_machine', 'interpreter_state', 'interpreter_frames', 'interpreter_calls', 'interpreter', 'receipt', 'receipt_collections', 'receipt_roots', 'api', 'service'].map(name => resolve(project, `src/${name}.kan`));
export function build(output, exports, extraSources = []) {
  const hash = createHash('sha256').update(readFileSync(compiler)).digest('hex');
  if (hash !== lock.toolchain.compilerSha256) throw new Error('Compiler differs from source-lock.json. Review and repin before building.');
  let inputs = [...sources, ...extraSources];
  const projection = `${output}.kan`;
  if (extraSources.length) {
    const closure = sourceClosure(inputs.map(path => ({ path, text: readFileSync(path, 'utf8') })), exports);
    writeFileSync(projection, closure.text);
    inputs = [projection];
    writeFileSync(`${output}.sources.json`, JSON.stringify({ compiler: hash, exports, declarations: closure.declarations,
      sha256: createHash('sha256').update(closure.text).digest('hex') }, null, 2) + '\n');
  }
  try {
    const built = spawnSync(compiler, ['build', ...inputs, '-o', output,
      ...exports.flatMap(name => ['--export', name])], { encoding: 'utf8', timeout: 600000, maxBuffer: 4 * 1024 * 1024 });
    if (built.error || built.status !== 0) throw new Error(built.error?.message ?? built.stderr ?? `Compiler exited ${built.status}`);
  } finally {
    if (extraSources.length) rmSync(projection, { force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(resolve(project, 'build'), { recursive: true });
  const exports = JSON.parse(readFileSync(resolve(project, 'exports.json'), 'utf8'));
  build(resolve(project, 'build/telcoin-foundation.wasm'), exports);
  console.log(`Built telcoin-foundation.wasm with ${exports.length} exports.`);
}
