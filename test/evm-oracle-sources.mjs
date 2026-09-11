import { protocolSources, protocolModules } from './harness.mjs';

const state = ['u256', 'nonce', 'bytecode', 'delegation', 'storage', 'account', 'genesis_account', 'world_state', 'address_word'];
const trie = ['nibbles', 'hex_prefix', 'node', 'trie'];
const evm = ['alu', 'depth', 'topic_count', 'opcode', 'stack', 'memory', 'access', 'sstore_state', 'refund', 'gas', 'hex', 'log', 'log_journal', 'return_data', 'transient',
  'spec', 'mutability', 'lifecycle', 'destruction', 'effects', 'data', 'code', 'call_depth', 'call_target', 'contract_address', 'intrinsic', 'fork_schedule', 'eip2718',
  'env', 'block_hashes', 'blake2', 'bn254_field', 'bn254_curve', 'bn254_pairing', 'secp256k1', 'public_key', 'precompile', 'interpreter',
  'tx_signature', 'tx_payload', 'authorization', 'transaction', 'tx_envelope', 'receipt', 'bloom', 'receipt_envelope', 'withdrawal', 'block_roots', 'batch_position', 'epoch_boundary', 'block_context', 'block_gas'];
const moduleName = name => name[0].toUpperCase() + name.slice(1);
// The EVM Hash32 module re-exports the same pinned Hash32 module already in protocolSources.
export const evmOracleSources = {
  sources: [...protocolSources, ...state.map(n => `lib/state/${n}.ml`), 'lib/rlp/rlp.ml', ...trie.map(n => `lib/trie/${n}.ml`), ...evm.map(n => `lib/evm/${n}.ml`)],
  modules: [...protocolModules, ...state.map(n => `${n}.ml`), 'tn_state.ml', 'rlp.ml', 'tn_rlp.ml', ...trie.map(n => `${n}.ml`), 'tn_trie.ml', ...evm.map(n => `${n}.ml`)],
  extraAliases: { 'tn_state.ml': state.map(moduleName), 'tn_rlp.ml': ['Rlp'], 'tn_trie.ml': trie.map(moduleName) },
  packages: 'digestif.c,zarith', sortModules: true,
};
