import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceClosure } from './source-closure.mjs';

export const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(resolve(project, 'source-lock.json'), 'utf8'));
export const compiler = process.env.KANON_BIN ?? resolve(process.env.TELCOIN_KANON_ROOT ?? lock.toolchain.root, '_build/default/bin/kanon.exe');
const sourceNames = ['core', 'bool_ops', 'nat64', 'scalars', 'bcs', 'codec', 'fixed', 'scalar_ops', 'bls_types', 'crypto_types', 'sequence',
  'collections', 'crypto_collections', 'nonempty', 'prng', 'blake2s', 'blake3', 'chacha12', 'rand_seq',
  'keccak_words', 'keccak_permutation', 'keccak', 'crypto_stub', 'committee',
  'protocol_codec', 'batch', 'block_num_hash', 'header', 'vote', 'certificate_types', 'vertex_collections', 'certificate',
  'ordered', 'ordered_set', 'ordered_map', 'ordered_map_transform', 'dag', 'aggregators', 'voter', 'reputation_scores', 'leader_schedule', 'sub_dag', 'consensus_collections', 'committed_log',
  'bullshark', 'proposer_types', 'machine_collections', 'proposer', 'node_types', 'node_collections', 'node',
  'consensus_block', 'consensus_chain', 'consensus_record', 'execution_collections', 'engine', 'replay', 'consensus_store',
  'sim_collections', 'sim_types', 'sim', 'sim_service', 'u256', 'storage_collections', 'state_types', 'state_collections', 'state',
  'alu', 'evm_types', 'opcode', 'host_int_ops', 'modular256', 'field_power', 'big_natural', 'bls_constants', 'bls_field', 'bls_curve', 'bls_compressed', 'secp256k1', 'bn254_field', 'bn254_constants', 'bn254_frobenius', 'bn254_curve', 'bn254_pairing', 'precompile_types', 'precompile_common', 'precompile_bn254', 'precompile_modexp', 'precompile_ecrecover', 'evm_collections', 'evm_enums', 'evm_stack', 'access', 'evm_memory', 'gas', 'evm_data', 'transient',
  'hash32_words', 'sha256', 'bls_hash', 'bls_tower', 'bls_final_exponent', 'bls_pairing', 'bls_signature', 'ripemd160', 'precompile_hashes',
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
  'evm_leaf_aliases', 'output_collections', 'batch_output_types', 'batch_output', 'batch_payload',
  'block_plan_types', 'block_plan_collections', 'block_plan',
  'execution_engine_types', 'execution_engine_collections', 'rewards_counter',
  'execution_engine_state_types', 'execution_engine_state', 'execution_engine',
  'driver_collections', 'address_book', 'batch_store', 'chain_spec', 'checkpoint',
  'subscriber', 'driver_types', 'driver_outcome_collections', 'driver_outcome', 'driver',
  'blake2b_digest', 'durable_frame_types', 'durable_frame_collections', 'durable_frame',
  'durable_io_types', 'durable_effect', 'durable_path', 'durable_io_ops', 'durable_io', 'durable_io_transfer', 'durable_io_host',
  'durable_host_abi', 'atomic_file_codec', 'atomic_file', 'bytes_rendering', 'store_lock_types', 'store_lock', 'append_log_codec', 'append_log',
  'durable_record_codec', 'consensus_store_disk_types', 'consensus_store_disk_replay', 'consensus_store_disk',
  'checkpoint_scalar_codecs', 'checkpoint_state_codecs', 'checkpoint_header_codec', 'checkpoint_codec', 'checkpoint_file',
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
  'api', 'service'];
export function sourcesForProfile(profile = 'simulation') {
  if (!['simulation', 'bls'].includes(profile)) throw new RangeError(`Unknown crypto profile: ${profile}`);
  const math = ['u256', 'host_int_ops', 'modular256', 'field_power', 'big_natural', 'bls_constants', 'bls_field',
    'bls_curve', 'bls_compressed', 'precompile_types', 'precompile_common', 'hash32_words', 'sha256', 'bls_hash',
    'bls_tower', 'bls_final_exponent', 'bls_pairing', 'bls_signature'];
  const names = profile === 'simulation' ? sourceNames : sourceNames.filter(name => !math.includes(name)).flatMap(name =>
    name === 'crypto_types' ? ['crypto_blst_types'] : name === 'crypto_stub' ? [...math, 'crypto_blst'] : [name]);
  return names.map(name => resolve(project, `src/${name}.kan`));
}
export const sources = sourcesForProfile();
export function pinnedCompilerSha() {
  const hash = createHash('sha256').update(readFileSync(compiler)).digest('hex');
  if (hash !== lock.toolchain.compilerSha256) throw new Error('Compiler differs from source-lock.json. Review and repin before building.');
  return hash;
}
export function build(output, exports, extraSources = [], { scope = false, profile = 'simulation',
  timeoutMs = !scope && extraSources.length === 0 ? 1800000 : 600000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1800000) throw new RangeError('Compiler timeout must be between 1 ms and 30 minutes.');
  const hash = pinnedCompilerSha();
  let inputs = [...sourcesForProfile(profile), ...extraSources];
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
      ...exports.flatMap(name => ['--export', name])], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
    if (built.error || built.status !== 0) throw new Error(built.error?.message ?? built.stderr ?? `Compiler exited ${built.status}`);
  } finally {
    if (projected) rmSync(projection, { force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--profile')) throw new Error('Usage: node scripts/build.mjs [--profile simulation|bls]');
  const profile = args[1] ?? 'simulation';
  sourcesForProfile(profile);
  mkdirSync(resolve(project, 'build'), { recursive: true });
  const exports = JSON.parse(readFileSync(resolve(project, 'exports.json'), 'utf8'));
  const filename = profile === 'bls' ? 'telcoin-bls.wasm' : 'telcoin-foundation.wasm';
  build(resolve(project, `build/${filename}`), exports, [], { profile });
  console.log(`Built ${filename} with ${exports.length} exports.`);
}
