import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(resolve(root, 'source-lock.json'), 'utf8'));
const coverage = {
  'lib/std/nonempty.ml': 'Ported: generic operations with typed collection dictionaries, src/nonempty.kan; OCaml differential tests',
  'lib/std/prng.ml': 'Ported: full-width SplitMix64, split and signed inclusive ranges, src/prng.kan; OCaml differential tests',
  'lib/codec/bcs.ml': 'Ported: primitive and composite codecs, refinement, enums, list/map/set canonicality, src/bcs.kan, src/codec.kan, src/sequence.kan; OCaml differential tests',
  'lib/crypto_stub/tn_crypto.ml': 'Ported simulation profile: BLAKE2s, keys, signatures and aggregates, src/crypto_stub.kan; OCaml differential tests',
  'lib/hash32/hash32.ml': 'Ported: checked bytes, zero, equality, ordering, hex and nominal Keccak conversion, src/fixed.kan and src/keccak.kan',
  'lib/keccak/tn_keccak.ml': 'Ported: legacy Keccak-256, checked stored bytes, equality and hex, src/keccak.kan; Digestif differential tests',
  'lib/rand/chacha12.ml': 'Ported: ChaCha12 blocks, counter and buffered stream, src/chacha12.kan; OCaml differential tests',
  'lib/rand/std_rng.ml': 'Ported: leader seeds and inclusive u32/u64 sampling with exact draw advancement, src/chacha12.kan; OCaml differential tests',
  'lib/rand/rand_seq.ml': 'Ported: reservoir sampling with typed collections, src/rand_seq.kan; OCaml differential tests',
  'lib/types/round.ml': 'Partial: scalar operations; Map/Set pending, src/scalars.kan',
  'lib/types/leader_round.ml': 'Ported with explicit exhaustion correction, src/scalars.kan and src/scalar_ops.kan',
  'lib/types/units.ml': 'Ported value operations with explicit overflow corrections, unsigned decimal transport and checked Address, src/scalars.kan, src/scalar_ops.kan, src/fixed.kan',
  'lib/types/authority_id.ml': 'Partial: checked identifiers, hash derivation, equality/order and internal signer sets; general Map/Set API pending',
  'lib/types/authority.ml': 'Ported: identity, keys, addresses and unit voting power, src/crypto_stub.kan',
  'lib/types/committee.ml': 'Ported: canonical roster, thresholds, indexing, stake and equality, src/committee.kan; OCaml differential tests',
  'lib/types/digests.ml': 'Ported: distinct nominal digest kinds and zero values, src/fixed.kan',
  'lib/types/batch.ml': 'Ported: batch/sealed values, codec, simulation digest, receipt metadata and limits, src/batch.kan; golden and OCaml differential tests',
  'lib/types/block_num_hash.ml': 'Ported: anchor values, codec and signed comparison, src/block_num_hash.kan; OCaml differential tests',
  'lib/vertex/intent.ml': 'Ported: consensus intent prefix, src/vote.kan',
  'lib/vertex/header.ml': 'Ported: canonical fields, codec, digest and validation, src/header.kan; golden and OCaml differential tests',
  'lib/vertex/vote.ml': 'Ported: signing, claims and verification, src/vote.kan; OCaml differential tests',
  'lib/vertex/certificate.ml': 'Ported: assembly, claims, genesis membership and aggregate verification, src/certificate.kan; OCaml differential tests',
  'lib/consensus/dag.ml': 'Ported: insertion, ancestry, equivocation, watermarks, GC and recovery, src/dag.kan; OCaml differential traces',
  'lib/consensus/vote_aggregator.ml': 'Ported: vote collection, rejection order and certificate formation, src/aggregators.kan; OCaml differential tests',
  'lib/consensus/parent_aggregator.ml': 'Ported: quorum release, duplicate origins and drained deltas, src/aggregators.kan; OCaml differential tests',
  'lib/consensus/voter.ml': 'Ported: vote-once records, recasts, parent validation, clock drift and recovery, src/voter.kan; OCaml differential traces',
  'lib/consensus/reputation_scores.ml': 'Ported: closed score maps, ordering, persisted codec and final markers, src/reputation_scores.kan; OCaml differential tests',
  'lib/consensus/leader_schedule.ml': 'Ported for reachable score ranges: replacement tables, elections and recovery, src/leader_schedule.kan and src/committed_log.kan; OCaml differential tests',
  'lib/consensus/sub_dag.ml': 'Ported: commit ordering, timestamps, signature randomness, preimages and persisted codec, src/sub_dag.kan; OCaml differential tests',
  'lib/consensus/committed_log.ml': 'Ported: append, watermarks, latest final scores and schedule recovery, src/committed_log.kan; recovery traces against OCaml',
  'lib/consensus/bullshark.ml': 'Ported: linked leaders, ordering, scoring, commits, schedule retries and recovery, src/bullshark.kan; OCaml differential traces',
  'lib/consensus/proposer.ml': 'Ported for nonnegative configurations: timers, readiness, batch queues, requeue and restart, src/proposer.kan; OCaml differential traces',
  'lib/consensus/node.ml': 'Ported: composition and frontier recovery, src/node.kan; five composed-node differential groups against OCaml',
  'lib/execution/consensus_block.ml': 'Ported: height, block codec, preimages and genesis anchor, src/consensus_block.kan; OCaml differential tests',
  'lib/execution/consensus_chain.ml': 'Ported: genesis, resume and append, src/consensus_chain.kan; OCaml differential tests',
  'lib/execution/consensus_store.ml': 'Ported reference store: body resolution, append validation, epochs, retries, forks and replay gaps, src/consensus_record.kan and src/consensus_store.kan; OCaml differential tests',
  'lib/execution/replay.ml': 'Ported with maximum-height termination correction: gap collection and projections, src/replay.kan; ordinary-range OCaml differential tests',
  'lib/execution/engine.ml': 'Ported: typed engine dictionary and no-op execution, src/engine.kan; OCaml differential tests',
  'lib/execution/nothing.ml': 'Ported: uninhabited error and eliminator, src/engine.kan',
  'lib/sim/sim.ml': 'Ported for nonnegative limits: event ordering, loss, crashes, batch injection, agreement and execution, src/sim.kan; 19 seeded OCaml transcripts',
  'lib/state/u256.ml': 'Ported: full 256-bit arithmetic, wide modular operations, bitwise logic, shifts and constructors, src/u256.kan; 454 OCaml rows and BigInt checks',
  ...Object.fromEntries(['nonce', 'bytecode', 'delegation', 'storage', 'account', 'genesis_account', 'world_state', 'transfer', 'address_word']
    .map(name => [`lib/state/${name}.ml`, 'Ported: canonical account state and transitions, src/state_types.kan and src/state.kan; 42 OCaml differential rows'])),
  'lib/evm/alu.ml': 'Ported: unsigned and signed arithmetic, wide modular operations, shifts, BYTE and SIGNEXTEND, src/alu.kan; OCaml and BigInt comparisons',
  'lib/evm/opcode.ml': 'Ported: every assigned byte and operand family, names, immediate widths and static costs, src/opcode.kan; generated table and all-byte OCaml comparisons',
  'lib/evm/depth.ml': 'Ported: bounded stack depths, signed admission and enumeration, src/evm_types.kan and src/evm_enums.kan',
  'lib/evm/topic_count.ml': 'Ported: five topic-count constructors, signed admission and enumeration, src/evm_types.kan and src/evm_enums.kan',
  'lib/evm/stack.ml': 'Ported: bounded immutable stack, atomic pops, DUP and SWAP, src/evm_stack.kan; boundary comparisons against OCaml',
  'lib/evm/access.ml': 'Ported: canonical account and address/slot warmth, src/access.kan; OCaml transition comparisons',
  'lib/evm/sstore_state.ml': 'Ported: original, present and updated storage classification, src/evm_types.kan; all transition classes compared with OCaml',
  'lib/evm/refund.ml': 'Ported: signed 63-bit refund accumulation with exact wraparound, src/host_int_ops.kan; OCaml boundary comparisons',
  'lib/evm/gas.ml': 'Ported: static and dynamic costs, checked memory/log pricing, SSTORE refunds, CALL/CREATE caps and stipend, src/gas.kan; OCaml boundary comparisons',
  'lib/evm/memory.ml': 'Ported for checked extents: sparse byte memory, signed index wrapping, word IO and zero erasure, src/evm_memory.kan; OCaml comparisons',
  'lib/evm/data.ml': 'Ported: zero-extended data windows and saturated U256 offsets, src/evm_data.kan; OCaml comparisons',
  'lib/evm/code.ml': 'Ported: instruction analysis, PUSH skipping and jump destinations, src/evm_data.kan; OCaml comparisons',
  'lib/evm/transient.ml': 'Ported: canonical transaction-scoped storage keyed by address and slot, src/transient.kan; OCaml comparisons',
  'lib/evm/return_data.ml': 'Ported: strict copy bounds including zero-length windows, src/evm_log.kan; OCaml comparisons',
  'lib/evm/log.ml': 'Ported: typed topic arities, generic atomic collection, log values and rendering, src/evm_log.kan; OCaml comparisons',
  'lib/evm/log_journal.ml': 'Ported: immutable journal with emission-order projection, src/log_journal.kan; OCaml comparisons',
  'lib/evm/spec.ml': 'Ported: fork ordering and activation checks, src/evm_spec.kan; OCaml comparisons',
  'lib/evm/mutability.ml': 'Ported: explicit static/mutable permissions, src/evm_spec.kan; OCaml comparisons',
  'lib/evm/gas_penalty.ml': 'Ported: fixed-point penalty with wide intermediates, src/evm_spec.kan; boundary comparisons against OCaml/Zarith',
  'lib/evm/batch_position.ml': 'Ported: packed worker/index fields, checked host-int admission and first-batch classification, src/evm_spec.kan; OCaml comparisons',
  'lib/evm/block_hashes.ml': 'Ported: 256-ancestor window and full U256 lookup, src/block_hashes.kan; OCaml comparisons',
  'lib/evm/env.ml': 'Ported: block, transaction and call environments with ordered access entries, src/env.kan; OCaml comparisons',
  'lib/evm/lifecycle.ml': 'Ported: created and destroyed address sets, src/lifecycle.kan; effect trace comparisons',
  'lib/evm/destruction.ml': 'Ported: deferred destruction plans and value/existence flags, src/lifecycle.kan; effect trace comparisons',
  'lib/evm/effects.ml': 'Ported: immutable snapshots, warmth, original storage, refunds, logs, transfers, creation and fork-dependent destruction, src/effects.kan; OCaml comparisons',
  'lib/evm/fork_schedule.ml': 'Ported: monotone admission and inclusive activation timestamps, src/fork_schedule.kan; OCaml comparisons',
  'lib/evm/call_depth.ml': 'Ported for reachable frame depths: explicit depth and inclusive 1024 limit, src/execution_primitives.kan; boundary comparisons',
  'lib/evm/call_target.ml': 'Ported: one-hop delegation, independent warming and surcharge, src/execution_primitives.kan; OCaml comparisons',
  'lib/evm/contract_address.ml': 'Ported: CREATE nonce RLP and CREATE2 salt/initcode derivation, src/execution_primitives.kan; OCaml comparisons',
  'lib/evm/intrinsic.ml': 'Ported: token costs, wire-list charges and floor gas, src/execution_primitives.kan; authorization count passed explicitly and compared with OCaml',
  'lib/evm/eip2718.ml': 'Ported: raw type-byte framing and legacy identity, src/execution_primitives.kan; OCaml comparisons',
  'lib/evm/withdrawal.ml': 'Ported: checked scalars, value operations and RLP, src/withdrawal.kan; OCaml comparisons',
  'lib/evm/bloom.ml': 'Ported: 2048-bit bloom, Keccak accrual, log collection and byte round trips, src/bloom.kan; OCaml comparisons',
  'lib/evm/block_roots.ml': 'Partial: account/storage/state, raw transaction, withdrawal and receipt roots, src/state_roots.kan and src/receipt_roots.kan; OCaml comparisons. Typed transaction wrappers remain.',
  'lib/evm/epoch_boundary.ml': 'Ported: open/closing admission, randomness and withdrawal commitments, src/block_context.kan; OCaml comparisons',
  'lib/evm/block_context.ml': 'Ported: ordered narrowing, genesis root validation and context values, src/block_context.kan; OCaml comparisons',
  'lib/evm/interpreter.ml': 'Partial: error and outcome types, src/interpreter_types.kan. Execution remains pending.',
  'lib/evm/receipt.ml': 'Ported: typed success/revert/halt receipts, src/receipt.kan; OCaml comparisons',
  'lib/evm/receipt_envelope.ml': 'Ported: log RLP and EIP-2718 receipt encoding, src/receipt.kan; OCaml byte comparisons',
  'lib/evm/block_gas.ml': 'Ported: source-compatible receipt gas accounting, src/receipt_roots.kan; OCaml boundary comparisons',
  'lib/rlp/rlp.ml': 'Ported: canonical encoding, recursive-item views and iterative validating decode with exact errors, src/rlp.kan; 393 OCaml comparisons',
  'lib/trie/nibbles.ml': 'Ported with slice-overflow correction: nibble operations, clamping and packing, src/nibbles.kan; OCaml comparisons and explicit boundary check',
  'lib/trie/hex_prefix.ml': 'Ported: compact nibble paths and source-permissive flag decoding, src/nibbles.kan; all flag bytes compared with OCaml',
  'lib/trie/node.ml': 'Ported: node RLP and exact inline/hash child rule, src/trie_node.kan; OCaml comparisons at the 32-byte boundary',
  'lib/trie/trie.ml': 'Ported: sorted construction, duplicate rejection, raw/secure/ordered roots and account RLP, src/trie.kan; OCaml roots and index-boundary comparisons',
};
const text = `# Port roadmap and source map

Baseline: telcoin-ocaml ${lock.upstream.revision}, chunk 44.
source-lock.json records every selected source file and each library's dune
declaration, including its dependencies. This table is generated by
\`node scripts/roadmap.mjs\`; its statuses describe implemented coverage,
not a claim of complete module parity.

## Milestones

| Milestone | Scope and acceptance evidence | Status |
| --- | --- | --- |
| 0 | Pin the chunk-44 source and compiler, compile reusable Wasm, port scalar/primitive-codec core, compare exact outputs and failures with OCaml, provide a working CLI. | Implemented; see VALIDATION.md. |
| 1 | Complete tn_std, tn_codec and tn_types. Add general codecs, scalars, SplitMix64, digests, authorities, committees, batches and anchors. Match vectors and constructor rejections. | Value and codec behavior tested. General Round/Authority Map/Set APIs remain. |
| 2 | Port tn_vertex and tn_consensus pure state machines, plus deterministic tn_sim and the CLI. Compare complete seeded output transcripts. | Consensus, node composition, seeded simulator and public simulator CLI tested within the configuration bounds recorded below. |
| 3 | Timing, consensus recovery and tn_execution. Compare durable-before-action transitions, restart transcripts and consensus-chain hashes. | Pure execution, replay, reference store and consensus recovery tested. Durable shells remain. |
| 4 | tn_state and EVM ALU/interpreter, then environment, access/refund, storage, calls, creation and transaction execution. Preserve full U256 arithmetic, gas, rollback and fork-specific outcomes. | Account state, EVM primitives, environments, effect snapshots, creation/destruction effects, fork schedules and execution helpers tested. Interpreter and transaction execution remain. |
| 5 | RLP, Keccak, trie/state roots, transaction envelopes, signatures and source-supported precompiles. Reuse existing golden fixtures; compare acceptance, output, gas and errors separately. | RLP, Keccak, tries, account/state roots, withdrawals, blooms and receipt encoding/roots tested. Signed envelopes and precompiles remain. |
| 6 | Batch validation, executed blocks, engine, driver, registry and epoch transitions. Compare complete committed/executed output and checkpoint consistency. | Planned |
| 7 | Durable file framing, logs, locks and checkpoints. Audit the host's fsync, atomic replacement, locking and recovery guarantees before porting the IO shell. Test interrupted writes and restart behavior. | Planned |
| 8 | tn_network and Snappy pure codecs through chunk 44, then integrate source-supported crypto implementations and shells. Compare wire vectors, canonicality, corruption and size-limit cases. | Planned |

Milestones 4 and 5 overlap at hash/state/transaction dependencies and should be
split into dependency-ordered increments before implementation. The goal is
parity with the current OCaml source. Implementing transport or node behavior
missing from that source is a separate extension.

## Implementation decisions

- Use the standard Kanon compiler and WasmGC ABI. Do not add application
  primitives to the compiler to conceal port gaps.
- Keep protocol transitions in Kanon and IO in an explicit host shell.
  The current Wasm module has no host imports.
- Keep both source checkouts unchanged. No source is fetched during tests.
- Record exact source hashes and the compiler executable hash. Do not infer
  executable provenance from a nearby compiler source revision.
- Preserve ordinary OCaml behavior and record corrections independently.
  Round exhaustion and host-int addition overflow are documented in README.md.
- Port a library seam with meaningful positive and negative comparisons
  before marking that seam complete. A successful build alone is insufficient.

## Outstanding design work

Kanon's primitives have add/subtract/multiply/compare but no division or bitwise
operations. Bounded division, wrapping words, SplitMix64 and BLAKE2s are ordinary
Kanon code. U256 arithmetic is implemented and tested. Production BLAKE3/BLS still
need implementation and performance work. Simulation signatures are forgeable and cannot
authenticate a real node.

Kanon does not currently provide OCaml .mli-style constructor hiding. Review
how checked values are admitted at every external boundary. Nominal types and
opaque Wasm references do not by themselves prove the smart-constructor
invariants or establish a cross-module security boundary.

General Nonempty and BCS combinators use erased type parameters and typed
collection dictionaries. The compiler cannot construct parameterized recursive
families. scripts/collections.mjs generates concrete carriers from one
template. Zero-byte codec units use a nominal nullary type to avoid a backend
trap with polymorphic empty-product payloads. Generated insertion sort is
quadratic; production-size collection performance remains unvalidated.

The next acceptance target is the EVM and execution driver. Simulator comparisons
establish parity on tested seeded transcripts; they are not a proof of consensus
safety or liveness for every possible schedule.

## Library inventory

| Source library | Implementation modules | Implementation lines |
| --- | ---: | ---: |
${lock.upstream.libraries.map(l => `| ${l.name} | ${l.modules} | ${l.implementationLines} |`).join('\n')}

## Implementation module status

| OCaml source | Kanon status |
| --- | --- |
${lock.upstream.files.filter(f => f.path.startsWith('lib/') && f.path.endsWith('.ml')).map(f => `| ${f.path} | ${coverage[f.path] ?? 'Pending'} |`).join('\n')}
`;
writeFileSync(resolve(root, 'PORTING.md'), text);
console.log('Wrote PORTING.md from the pinned source inventory.');
