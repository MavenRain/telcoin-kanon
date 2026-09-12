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
  'alu', 'evm_types', 'opcode', 'host_int_ops', 'modular256', 'field_power', 'big_natural', 'secp256k1', 'bn254_field', 'bn254_constants', 'bn254_frobenius', 'bn254_curve', 'bn254_pairing', 'precompile_types', 'precompile_common', 'precompile_bn254', 'precompile_modexp', 'precompile_ecrecover', 'evm_collections', 'evm_enums', 'evm_stack', 'access', 'evm_memory', 'gas', 'evm_data', 'transient',
  'hash32_words', 'sha256', 'ripemd160', 'precompile_hashes',
  'rlp_types', 'rlp_collections', 'rlp', 'nibbles', 'trie_collections', 'trie_node', 'trie', 'evm_log', 'log_collections', 'log_journal',
  'evm_spec', 'env_collections', 'block_hashes', 'lifecycle', 'env', 'effects', 'execution_primitives', 'fork_schedule',
  'withdrawal', 'block_collections', 'state_roots', 'bloom', 'block_context', 'blake2b_rounds', 'blake2b', 'precompile', 'precompile_service', 'interpreter_types', 'interpreter_machine', 'interpreter_state', 'interpreter_frames', 'interpreter_calls', 'interpreter', 'interpreter_default', 'receipt', 'receipt_collections', 'receipt_roots',
  'tx_signature', 'authorization_types', 'authorization_collections', 'authorization', 'transaction', 'tx_payload',
  'tx_envelope', 'tx_decode_types', 'tx_decode_fields', 'tx_decode_lists', 'tx_decode', 'tx_recovery', 'auth_list',
  'system_contracts', 'executor_types', 'executor_validation', 'executor_settlement', 'executor_frames', 'executor',
  'system_call', 'transaction_collections', 'registry_types', 'registry_collections', 'registry_abi', 'registry_decode',
  'committee_shuffle', 'epoch_close_types', 'epoch_close', 'block_transaction_roots', 'block_execution_types',
  'block_execution_collections', 'block_pre_execution', 'block_execution', 'block_finish', 'block_header',
  'tx_shape_types', 'tx_shape', 'batch_validator_types', 'batch_validator',
  'output_collections', 'batch_output_types', 'batch_output', 'batch_payload',
  'block_plan_types', 'block_plan_collections', 'block_plan',
  'execution_engine_types', 'execution_engine_collections', 'rewards_counter',
  'execution_engine_state_types', 'execution_engine_state', 'execution_engine',
  'driver_collections', 'address_book', 'batch_store', 'chain_spec', 'checkpoint',
  'subscriber', 'driver_types', 'driver_outcome_collections', 'driver_outcome', 'driver',
  'blake2b_digest', 'durable_frame_types', 'durable_frame_collections', 'durable_frame',
  'durable_io_types', 'atomic_file_codec', 'bytes_rendering', 'store_lock_types', 'append_log_codec',
  'byte_reader', 'crc32c_table', 'crc32c', 'snappy_raw', 'snappy_frame',
  'network_var_bytes', 'network_bls_public_key', 'network_bls_signature', 'network_wire_scalar', 'network_protocols', 'network_base58', 'network_wire_frame',
  'network_leaf_collections', 'network_epoch_vote', 'network_consensus_result', 'network_epoch_record', 'network_node_record',
  'nat_merge_sort', 'network_roaring_types', 'network_roaring_encode', 'network_roaring_decode',
  'network_epoch_certificate', 'network_vote_wire', 'network_certificate_wire', 'network_peer_types', 'network_peer_collections', 'network_peer_exchange',
  'network_sync_frame', 'network_sync_request_types', 'network_sync_collections', 'network_sync_request',
  'network_sync_chunking', 'network_sync_reader',
  'list_equal', 'network_primary_msg', 'network_worker_msg',
  'network_gossip_types', 'network_gossip_collections', 'network_gossip',
  'network_wire_types', 'network_wire_collections', 'network_wire',
  'api', 'service'].map(name => resolve(project, `src/${name}.kan`));
export function build(output, exports, extraSources = [], { scope = false } = {}) {
  const hash = createHash('sha256').update(readFileSync(compiler)).digest('hex');
  if (hash !== lock.toolchain.compilerSha256) throw new Error('Compiler differs from source-lock.json. Review and repin before building.');
  let inputs = [...sources, ...extraSources];
  const projection = `${output}.kan`;
  const projected = scope || extraSources.length > 0;
  if (projected) {
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
    if (projected) rmSync(projection, { force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(resolve(project, 'build'), { recursive: true });
  const exports = JSON.parse(readFileSync(resolve(project, 'exports.json'), 'utf8'));
  build(resolve(project, 'build/telcoin-foundation.wasm'), exports);
  console.log(`Built telcoin-foundation.wasm with ${exports.length} exports.`);
}
