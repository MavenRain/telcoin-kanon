# Validation

## General Round and Authority collections

Ordered sets pass 160 OCaml rows, comparing canonical elements, cardinality,
updates, unions/intersections/differences, subset and disjoint checks, comparisons,
optional boundary searches, partition/split, and duplicate-producing transforms.
Ordered maps pass another 160 rows, including repeated-key replacement, update,
merge and union callbacks, polymorphic list-valued transforms, `add_to_list`,
boundaries, optional searches and ordered bindings. Each row compares a full
operation report against the actual Round or Authority Map/Set module.
Captures: `.kanon-exec/run-WpllNd`, exit 0, two groups, 4.3 seconds, and
`.kanon-exec/run-szu6H1`, exit 0, two groups, 34.6 seconds.
The final run through the public Round/Authority constructors passes all 320
rows in `.kanon-exec/run-1XHi9O`, exit 0, four groups, 150.3 seconds. An earlier
single oracle batch timed out in `.kanon-exec/run-bgxoT4`; map comparisons now
use batches of 20 while retaining the 30-second oracle limit and every case.
Generated-source checks pass in `.kanon-exec/run-JS077v`.

The shared typed dictionary retains key ordering and a concrete sequence carrier.
Exception-raising aliases use optional queries. Sequence adapters preserve finite
element order with eager construction; lazy/infinite OCaml sequences and physical
sharing are not modeled. COLLECTIONS.md records these interface adaptations.

## Typed transaction and receipt roots

The typed wrappers pass 182 OCaml rows covering all four signed transaction
formats, ordering and duplicates, receipt type tags, status and logs, native
cumulative-gas wrapping and unequal transaction/receipt lengths. The receipt
wrapper returns None for either direction of length mismatch. Source-closure
and exact artifact-reuse checks also pass in the same run.
Capture: `.kanon-exec/run-OHWBJv`, exit 0, seven groups, 156.2 seconds.

## Unkeyed BLAKE3

The 32-byte BLAKE3 hash passes empty/abc vectors and 54 differential rows against
the pinned pure OCaml implementation. Cases span 64-byte blocks, 1 KiB chunks,
power-of-two and unbalanced trees through 31 chunks, and deterministic random
binary inputs. Kanon shares the existing BLAKE2s quarter-round but implements
BLAKE3 compression, message permutation, flags and logarithmic subtree stack.
Capture: `.kanon-exec/run-DmH0zQ`, exit 0, three groups, 32.6 seconds.
This adds the hash primitive; it does not yet enable a production BLS profile.

## Append logs, disk stores and checkpoint files

Append-log I/O passes 161 OCaml rows in four groups, covering create/adopt,
header and identity refusal, scan and healing errors, append offsets and cleanup.
Native tests verify torn-tail truncation, interior-corruption preservation,
partial-write retry at the previous durable offset and exact on-disk frames.
Capture: `.kanon-exec/run-GCowrn`, exit 0, 44.9 seconds.

The disk store passes 152 OCaml rows in three groups, including replay refusal,
metadata disagreements, epoch transitions, duplicate no-ops, and write failures.
Native restart tests reconstruct the mirror from disk and verify that a failed
flush leaves the caller's mirror unchanged. Per-handle counters measure successful
appends since open. Capture: `.kanon-exec/run-rysT15`, exit 0, 90.3 seconds.

Checkpoint files pass 886 OCaml rows and two native integration groups. The tests
cover absent versus damaged files, every representative payload truncation,
trailing bytes, generation saturation, error precedence and publication faults.
Ahead and unknown-block guards refuse checkpoints before any I/O. A live disk
handle retains its append counters across checkpoint saves, duplicate replay,
refusal, restart and a later accepted record. Canonical checkpoint bytes are
checked against OCaml re-encoding, which restores committee ordering on decode.
Capture: `.kanon-exec/run-VRbpDp`, exit 0, five groups, 212.2 seconds including build.

## Guarded I/O, atomic files and store locks

The durable I/O layer passes 734 OCaml differential rows covering exact arguments,
call order, counters, partial reads/writes, clamped device counts, zero progress,
native integer bounds, cleanup errors, directory creation and tolerated errno values.
Atomic save/load and stale-temp sweeping pass 345 further rows. Store locks pass
30 rows covering canonical registration, OS refusals, cleanup and release.
Capture: `.kanon-exec/run-EFuUzh`, exit 0, 10 groups, 23.7 seconds.

The fault oracle provokes real Unix failures and catches them through the pinned
source boundary. Read traces compare only the initialized buffer prefix because
OCaml `Bytes.create` leaves the unread suffix unspecified. The mock device fills
its requested target range deterministically before reporting adversarial counts.
Final results, transfer ranges, initialized data, errors and counters remain compared.

Native tests exercise private permissions, offset reads/writes, truncation, fsync,
rename, strict existence, byte paths, helper startup errors, cross-process lock
exclusion and release on shutdown. The atomic publication test injects faults at
each stage and verifies that the canonical file retains a complete old or new
container, then loads it and sweeps any leftover temporary file. Symlink aliases
contend within the same Kanon session before another lock file is opened.
The adapter calls libc `realpath` to match the OCaml boundary, including native
trailing-component behavior. It uses POSIX fsync, not macOS F_FULLFSYNC.

The typed effect state carries both counters and the canonical lock register.
Continuation tests and native I/O passed with this state representation in
`.kanon-exec/run-3uJ1cA`, exit 0, 12 tests. Final native realpath checks, including
direct comparison with pinned OCaml on trailing path components, pass together
with atomic publication and store locking in `.kanon-exec/run-CaAJ6B`, exit 0,
10 tests, 12.5 seconds. The append-log, checkpoint-file and disk-store evidence
above completes the durable shell checks. The final complete regression remains outstanding.

## Explicit fork schedules through the engine

All 30 engine integration rows pass through live execution and checkpoint replay.
They cover default versus explicit schedules, inclusive Cancun and Prague timestamp
boundaries, pre-block root/hash behavior, cross-batch duplicate and unfunded
transaction skips, non-executable payload filtering and the Prague calldata floor.
The tests compare full driver state and encoded headers in addition to gas and skips.
EVM core memory, stack, gas and access checks also pass 713 rows.
Capture: `.kanon-exec/run-j3mu6S`, exit 0, 10 tests, 1,795.1 seconds including build.

The integration fixture has an explicit thirty-minute compiler allowance after
diagnostic checking of 2,419 declarations took over ten minutes. The default
compiler allowance remains ten minutes, the OCaml allowance remains 30 seconds,
and no correctness assertions were removed. RLP (393 rows) and EVM data (203 rows)
passed in `.kanon-exec/run-IAtGlo`; that capture also records the earlier engine
compiler timeout. The source optimizations preserve scalar RLP bytes, memory word
loads and precompile address construction while avoiding unnecessary expansion.
Source closure and artifact reuse checks pass in `.kanon-exec/run-L5n448`, five tests.

## Durable codecs and live driver writes

All 30 checkpoint codecs and durable record/metadata payloads pass 4,724 OCaml
differential comparisons in four groups. Coverage includes every byte truncation
of representative values, exact trailing counts, native/u32/timestamp bounds,
key widths, ordered map rejection, zero storage/account elimination, committee
reconstruction, capped recent hashes, rewards restoration, both phase and anchor
variants, all 22 stored header fields and executed consensus tips.
Capture: `.kanon-exec/run-6LnQoa`, exit 0, 175.5 seconds.
An earlier fixture incorrectly required malformed inputs to succeed; correcting
that assertion preserves exact comparison of both successful and rejected inputs.

The live mint, record, receive, step and snapshot protocol passes 13 comparisons
in three groups. They cover repeated pure minting, equality of persisted and
executed blocks, received records surviving a failed attachment, replay from
stored bodies and rejection of crossed consensus histories at the checkpoint floor.
Capture: `.kanon-exec/run-7d3HuV`, exit 0, 583.6 seconds.

Test artifact reuse requires matching pinned compiler, current source closure,
ordered exports and Wasm content hashes. OCaml compilation and all comparisons
still run. Two artifact rejection tests and three source-closure tests pass:
`.kanon-exec/run-6d3nd7`, exit 0. A full fixed-revision regression remains pending.
The complete 4,724-row codec suite also passes with verified artifact reuse:
`.kanon-exec/run-Q3EbXs`, exit 0, 86.5 seconds. The preceding retry reached the
unchanged 30-second OCaml compiler timeout; a serial retry completed successfully.

## Complete pinned network module coverage

Primary and worker messages and gossip rules pass 4,357 OCaml differential rows
in five groups. Checks cover every message variant, field equality, unverified
sealed-batch claims, all byte truncations, malformed UTF-8, optional fields,
signed chain IDs, cross-topic primary payload decoding, unsigned u64 message IDs,
fallback sources, first-match topic policies, missing sources and penalty order.
Capture: `.kanon-exec/run-ZBhLs2`, exit 0, 34.1 seconds.

Node routing passes 193 OCaml differential rows in three groups: all request,
response and gossip verdicts; all ten unmapped classes; ordered checked parents;
all five certificate states; retries; committee fan-out; response routing;
certificate publication; and both timer kinds and committed outputs staying local.
Capture: `.kanon-exec/run-GBdwf3`, exit 0, 88.4 seconds.
All 32 generated collection families match their templates:
`.kanon-exec/run-lPKrjt`, exit 0.

These milestones bring all 24 network modules in the pinned OCaml revision under
focused differential coverage, totaling 11,127 comparisons across the recorded
network suites. The source itself defers sockets, gossip mesh operation and peer
management. Production consensus crypto and the complete port's final regression
and public runtime surface remain separate work.

## Roaring, certificates and peer exchange

Synchronization passes 927 OCaml differential rows in six groups: worker and
primary requests, digest-set normalization, opaque skip-round lists, generic
frames and opening verdicts, pack slicing across 256 KiB, cap-crossing certificate
batches, 200-item digest groups, native integer overflow, incomplete streams,
ignored post-End frames, certificate byte caps and ordered batch rejection.
Capture: `.kanon-exec/run-MPAhyB`, exit 0, 49.2 seconds.
An initial compiler error in generated-style frame cases was corrected by
removing immediate applications of untyped lambda expressions. These tests
exercise the pure stream rules in the pinned source, without a socket runtime.

Roaring passes 442 OCaml differential rows in five groups, including unsigned
32-bit sets, first invalid sorted values, exact array and bitmap emission,
the 4096-value switch, full 65,536-value containers, run decoding, ignored offsets,
duplicates, truncation, refinement offsets and signed public errors.
Capture: `.kanon-exec/run-0ogF6S`, exit 0, 141.5 seconds.
The initial bitmap writer exceeded the compiler timeout; parameterizing its
starting position keeps the fixed loop deferred until runtime. The first runtime
run found a stack overflow in the fixture's integer parser. A tail-recursive
parser now exercises the same full-size constructor cases successfully.

Votes, all five certificate signature states, epoch certificates and peer
exchange pass 1,458 OCaml differential rows in five groups. Checks cover exact
encoding and field equality, every byte truncation, invalid variants, bitmap
refinement errors, map ordering, duplicate key rejection and first-occurrence
address deduplication. Adapter checks cover committee position mapping, genesis
validation, unknown signers and the simulation crypto profile's incompatible
65-byte signatures. The BLS wire signature remains 48 bytes.
Capture: `.kanon-exec/run-7R95Zc`, exit 0, 34.0 seconds.
Fixture corrections before that pass included OCaml constructor labels and
Kanon's explicit constructor application and nominal codec unit value.

## Network wire types and records

The network leaf suite passes 1,392 OCaml differential rows in four groups,
covering BLS wire widths, sized versus bare digest encodings, byte constructors,
equality and ordering, protocol names, signed native IDs and Base58.
Base58 also matches an independent JavaScript integer encoder.
Capture: `.kanon-exec/run-oOPzhc`, exit 0, 9.4 seconds.

Wire frames match 546 OCaml rows across four groups. They cover the two u32
compression-bound clamps, exact frame bytes across 64 KiB boundaries, header and
body error order, capped decompression, consumed-byte counts and BCS errors.
Capture `.kanon-exec/run-19C9bE` passed all 545 differential comparisons and
three groups, but an additional assertion incorrectly expected the take cap to
override the earlier compressed-size gate. The corrected fixture includes a
smaller valid capped frame; its 155-row decoding group passes in
`.kanon-exec/run-lAcbog`, exit 0, 2.9 seconds. The other groups were unchanged.

Epoch votes, consensus results, epoch records and current/legacy node records
pass 1,800 OCaml rows in three groups, including every byte truncation, full u64
values, field equality, malformed UTF-8 and compatibility fallback.
Capture: `.kanon-exec/run-RV3hyl`, exit 0, 4.1 seconds. A further 12-row group
confirms that legacy encoding drops RPC metadata while preserving the other
fields: `.kanon-exec/run-m0bO8g`, exit 0, 2.2 seconds.

Real registry integration passes three OCaml differential scenarios in two
groups: first-epoch closing, checkpoint replay of that close, and handoff followed
by a second-epoch close. The pinned 28,381-byte registry account and storage drive
the actual interpreter. Compared output includes world state roots, header bytes,
consensus digests, rewards and sealed phases. Capture: `.kanon-exec/run-ieYoAE`,
exit 0, 919.8 seconds. The 208-second next boundary preserves the prior overshoot.

Earlier compilation reached the existing timeout (`.kanon-exec/run-qDfEi6`).
Declaration profiling completed all 2,415 groups (`.kanon-exec/run-PjzvUa`) and
found that the fixture entry point alone took 176.6 seconds. Supplying the same
genesis sentinel as fixture input avoided checking its constant hash and allowed
the build and runtime comparisons to finish. No compiler pin or timeout changed.

## Driver restart, handoff and log headers

Driver restart passes 15 OCaml differential rows in two groups, covering empty
and nonempty replay gaps, a caught-up checkpoint, committee identity checks,
store epoch checks, sealed handoff windows and the maximal epoch.
Capture: `.kanon-exec/run-k68vTk`, exit 0, 476.2 seconds. These fixtures use the
reference consensus store and do not establish filesystem durability.

Snappy's byte reader and CRC-32C primitives pass 560 OCaml differential rows
in three groups, covering signed bounds, wide native little-endian reads,
masking, arbitrary prior registers and incremental updates.
Capture: `.kanon-exec/run-PVEe6O`, exit 0, 53.7 seconds. Subsequent raw and
framed Snappy results are recorded below.

Driver handoff passes 36 OCaml differential rows in two groups, including
running and sealed phases, stale committees, maximal epochs, preserved leader
counts on refusal, overshoot-based boundaries and timestamp saturation.
Capture: `.kanon-exec/run-eFThwP`, exit 0, 195.1 seconds. The fixture transports
epochs as BCS bytes so maximal u32 values do not cross the host's immediate-Nat
interface. An earlier direct-Nat fixture trapped at that interface
(`.kanon-exec/run-lFOsnC`); its timestamp group passed 12 rows.

Append-log header validation, ordered identity comparisons, binary quoting and
I/O, lock and corruption error rendering pass 657 OCaml differential rows in
three groups. Capture: `.kanon-exec/run-i1ljwT`, exit 0, 3.5 seconds.
This does not validate filesystem locking, append, healing or durability.
The separate open-header and payload-length guards are implemented but are not
selected by this suite yet.

Full driver pipeline compilation initially exceeded the unchanged 600-second
limit (`.kanon-exec/run-NVu7BM` and `.kanon-exec/run-F3dHKR`). A check-only
diagnostic also timed out on 2,261 declarations in `.kanon-exec/run-cfTsyS`,
which located the delay before WebAssembly generation. A missing `evmBatchPositionOfWord` conversion found
by an earlier compiler run is now defined as the source's identity wrapper.
Declaration timing with the existing compiler libraries reached BLAKE2b
encoding before the diagnostic timed out (`.kanon-exec/run-4NoeFe`). Its
word writer spent 29.4 seconds checking a 256-bit conversion followed by an
eight-byte slice. It now uses the existing eight-byte little-endian encoder.
The rerun passes all 10 groups in `.kanon-exec/run-cHuoZo`, exit 0, 612.6
seconds total: 22 driver pipeline rows, 268 durable-frame rows and 97 BLAKE2F
rows. Pipeline cases cover successful folds, header bytes, failure atomicity,
admission ordering and the remaining suffix after a synthetic sealed phase.
Real registry-driven sealing and checkpoint replay still need integration.

Raw Snappy passes 1,639 OCaml comparisons in three groups, including literal
length boundaries, nonminimal and overflowing preambles, all tag classes,
overlapping copies and error precedence. Capture: `.kanon-exec/run-e7HqH7`,
exit 0, 6.1 seconds. The CRC byte recurrence now uses a generated total
decision tree, avoiding repeated bit-by-bit work. The unchanged 560-row
primitive suite passes in 2.3 seconds (`.kanon-exec/run-mZMovL`).

Framed Snappy passes 1,125 OCaml comparisons in three groups, including exact
64 KiB chunking through 131,073 input bytes, raw compressed chunks, checksums,
reserved types, declared-length ceilings, truncation and output-cap behavior.
Capture: `.kanon-exec/run-IJLZc8`, exit 0, 98.8 seconds. Independent JavaScript
CRC and chunk assembly also match the encoded output. All four source Snappy
modules now have their public operations ported and covered.

## Batch, registry and engine continuation

The active worktree now passes 1,157 OCaml differential rows for the wider
batch transaction decoder, including all five wire formats, full u64/u128
scalars, canonical legacy re-encoding, hashes and checked signature recovery.
Capture: `.kanon-exec/run-3l4OzI`, six groups, 487.3 seconds.

Registry validation passes 655 rows across five groups: 348 decoder cases in
`.kanon-exec/run-wVVRLa` (the other suites in that captured command failed),
and 307 calldata, status and constructor cases in `.kanon-exec/run-E5vKcb`.
Committee shuffling passes 84 additional rows in `.kanon-exec/run-ZJSjHD`
(its companion registry compile timed out). The five constant selectors were
checked against the pinned OCaml implementation in `.kanon-exec/run-NtdqeW`
and encoded as fixed bytes to avoid repeated closed Keccak computations during
compilation. The final registry suite passed in 36.2 seconds.

The generic batch validator passes five groups and 193 rows in
`.kanon-exec/run-tiLZVd` (the companion output oracle had a fixture error).
This covers rule ordering, checked gas totals, peer penalties, the exact
one-million-byte limit and maximal worker/epoch/base-fee snapshots.
Payload attachment and block planning pass four groups and 54 rows in
`.kanon-exec/run-0Bq4Pr`, exit 0, 71.1 seconds. Payload filtering and the
default validator pass three groups and 26 rows in `.kanon-exec/run-qCw6h0`,
exit 0, 1,340.4 seconds: 15 payload rows and 11 default-validator rows.

The rewards counter and execution-engine state operations are implemented and
tested, including hash-window limits and snapshot normalization. Complete
engine output execution remains under integration validation.
The OCaml engine and batch oracle dependency closure compiles successfully
in `.kanon-exec/run-f4AiVa`; that result does not validate the Kanon engine.

Block integration initially found constructor
callbacks requiring explicit lambdas, then timed out before runtime checks.
Those callbacks are fixed. The rerun with constant registry selectors also
timed out (`.kanon-exec/run-tC1PDn`). The new RLP list helper is covered by
the transaction shape comparisons above.

The block-roots timeout was narrowed by checking dependency prefixes:
209 declarations passed in 3.7 seconds, 314 in 22.4 seconds, 366 in 30.5
seconds, 392 in 25.1 seconds, and all 405 production/helper declarations
through `executionWith` in 51.1 seconds (`.kanon-exec/run-AEbeTA`). The
complete fixture still exceeded 600 seconds (`.kanon-exec/run-DSlge2`).
Its formatters are now split into smaller functions, preserving the original
arguments, result fields and assertions. The full fixture passes three groups
and 83 OCaml differential rows in `.kanon-exec/run-ijqcwW`, exit 0, 552.4 seconds.
Production block-root code and compiler/oracle limits were unchanged.

Engine rewards, overflow, recent hashes and native block numbers pass four
groups and 199 rows in `.kanon-exec/run-IAqrMX`. Its snapshot group failed
on a fixture boolean format mismatch (`false` versus `0`). After that fix,
the separate snapshot suite passes one group and 144 rows in
`.kanon-exec/run-rlg67E`, exit 0, 432.3 seconds. This totals 343 passing
engine-state comparisons; complete engine output execution remains pending.

The address book, batch store, chain specification and checkpoint declarations
typecheck and build in `.kanon-exec/run-hERTaN`. Subscriber admission, driver
execution, outcome variants, handoff and crash recovery are implemented but
still need runtime comparisons.
The driver admission/handoff scope passed type checking, but a direct
Wasm export of `subscriberReceive` failed because host callback arguments
are unsupported (`.kanon-exec/run-TCm8AQ`). Runtime fixtures bind address
lookup inside Kanon instead. Full block execution still timed out after
splitting its formatter (`.kanon-exec/run-cnLkmF`); production-only checking
is the next diagnostic step.
The separated epoch-close and system-call suites also reached the compiler
limit (`.kanon-exec/run-EeZ0QF`); no runtime assertions ran in those suites.
The pinned OCaml driver dependency set compiles in `.kanon-exec/run-WWU6P2`;
that is oracle preparation, not validation of Kanon driver execution.
The system-call production dependency projection typechecks in 278.5 seconds
(`.kanon-exec/run-4YH78u`). Including `blockTestSystem` also typechecks,
in 121.3 seconds (`.kanon-exec/run-X4qefD`). These results do not cover the
additional exports used by the combined system/pre-block harness or Wasm
emission. The epoch and execution harnesses no longer request the unused
system-predeployment export; the pre-block harness retains it.

After removing that unused export, epoch closing and driver primitives pass
four groups and 96 rows in `.kanon-exec/run-GTZbey`, exit 0, 135.4 seconds.
The nine epoch-close cases compare mandatory writes and discarded read effects.
The 87 driver cases compare address-book precedence, body-store deduplication,
subscriber mint/receive agreement and attachment failure behavior. This does
not validate the complete driver execution, fold or resume paths.

Block transaction folds and finished headers now pass two groups and ten
rows in `.kanon-exec/run-bZ04FG`. Its companion system-call suite reached
the 600-second compiler limit, so the captured command exited 1. Both block
execution groups passed; system-call runtime assertions did not run.

Durable frames, BLAKE2b-512 and atomic-file encoding/decoding pass six groups
and 462 OCaml comparisons in `.kanon-exec/run-oarSNP`, exit 0, 235.1 seconds.
The 268 frame/digest cases cover block boundaries, signed sequence bits,
native size overflow, every truncation and byte mutation of a sample frame,
check precedence and torn-tail versus interior-corruption classification.
The 194 atomic-file cases cover generation bounds, exact file length, magic,
format and body tags. Digest cases additionally match OpenSSL.
Durable I/O error types are defined; filesystem operations, locking and
durable store integration remain unfinished. The save-argument preflight
function still needs direct coverage.

The complete driver-fold fixtures and their OCaml oracle are written.
The oracle compiles and runs an empty-fold control in `.kanon-exec/run-ZbElwP`;
Kanon pipeline execution is under validation. Fixed beacon/history bytecode
is now represented directly as bytes, avoiding closed hex-parser evaluation.
The system-call and pre-block suites now pass two groups and 46 OCaml rows
with those equivalent constants in `.kanon-exec/run-fcARtq`. Its companion
driver-pipeline build found a missing `evmBatchPositionOfWord` definition in
the closing-block path, so the captured command exited 1. The missing public
conversion is now defined; driver runtime comparisons are being rerun.

Source/compiler pins pass in `.kanon-exec/run-4zc2Gr`; all 198 registered
source files have unique declarations (`.kanon-exec/run-hFpNpF`). Collection,
Keccak and opcode generation checks pass in `.kanon-exec/run-NknZhn`.
That command's BN254 check selected the removed default OCaml switch and
failed before comparing constants. Its scoped rerun with the dedicated
switch passes all 24 coefficients in `.kanon-exec/run-t7drgC`.

For the exact `45e17c9` checkpoint, the four timeout suites were rerun in
`.kanon-exec/run-MVTZVZ`: 28 groups passed, while block roots still reached
the unchanged 600-second compiler timeout. This is not a full regression pass.

## Transaction and executor work in progress

The four signed envelope types (legacy, EIP-2930, EIP-1559 and EIP-7702),
sender recovery and authorization processing pass 15 groups and 1,298 OCaml
differential rows: 1,199 wire rows and 99 authorization/recovery rows.
The run exited 0 in 1,115.7 seconds (`.kanon-exec/run-6e71LN`). It includes
the pinned upstream golden transactions, exact errors, signing payloads,
consensus hashes, nonce threading, warming, revocation and refunds.

Executor validation and settlement pass six groups and 176 differential rows
(`.kanon-exec/run-aDU6sf`, exit 0, 139.6 seconds). Complete transaction execution
passes six groups and 106 rows (`.kanon-exec/run-FXSHTG`, exit 0, 527.8 seconds).
Cases cover calls, all nine precompiles, creation, output and logs, rollback,
forks, fees, delegation, and authorization changes that survive failed frames.
An earlier large-initcode case exposed stack growth in `intrinsicTokens`;
an accumulator traversal fixes it, and the boundary now passes against OCaml.
No compiler or oracle timeout was increased to obtain these passes.

These are focused results from the active worktree, not a complete-port or full
regression claim. System calls, registry ABI, committee selection, epoch closing,
block execution and header assembly are being integrated and separately checked.
The exact `45e17c9` precompile checkpoint regression reported 192 passes and four
timeout failures in 7,720.3 seconds: compilation of block roots, commit and
foundation suites, and the BN254 G2 oracle. The capture is
`/private/tmp/telcoin-kanon-validation-45e17c9/.kanon-exec/run-6xMy0B`.
Their exact-commit rerun results are recorded above.
The test commands use the isolated OCaml switch through
`OCAML_SWITCH=/Users/oobi/Documents/gpt13/telcoin-kanon-ocaml`.

## Published consensus and state checkpoint

Commit `b5ccc4228a10032b041e0fc0c904540b7263ff7f` passed all 101 test groups
in a detached checkout, including the full production build and the simulator CLI
comparisons. The sequential run took 1,760.6 seconds and exited 0. Generated-source
checks also passed. GitHub `main` and `~/Documents/telcoin-kanon` were advanced to
this commit after validation.

The 65-export Wasm artifact has SHA-256
`cd7add0c412a45473e1e244cf1d8ad3006fea7290abb02013ba0448623afcb98`.
The captured suite is
`/private/tmp/telcoin-kanon-validation-b5ccc42/.kanon-exec/run-DvMt1I`;
generator checks are `run-vbQJca` in the same capture directory.
This checkpoint covers consensus, simulation, the consensus execution store and
account state. It does not claim a completed EVM, network or durable node port.

New EVM arithmetic and opcode tests pass 1,522 OCaml comparisons in four groups,
including signed constructor bounds and complete operand enumerations
(`.kanon-exec/run-4nnptM`). Stack, memory, access tracking and gas tests pass 713
comparisons in seven groups (`.kanon-exec/run-UmZCW2`). RLP passes 393 comparisons
in three groups (`.kanon-exec/run-GA0Ivc`). These modules were published in
checkpoint `3f743ac` after the consensus and state checkpoint.

Code analysis and transient storage pass 203 comparisons in two groups
(`.kanon-exec/run-eUgC8t`). Trie and nibble operations pass 423 comparisons in five
groups, plus the explicit slice-overflow boundary assertion. The latest run also
passed the three source-closure groups (`.kanon-exec/run-XlfWw9`). Logs and return data pass 108 comparisons in two
groups (`.kanon-exec/run-yHNa9E`).

RLP items retain canonical encoded bytes behind a nominal type. The validating
decoder checks every nested item, and `rlpView` exposes string or child-item
views. An explicit stack avoids host recursion limits during validation and
preserves the source's error order when children cross their parent boundary.

Nibble slices clamp the requested count before slicing. This intentionally
avoids the source's unchecked `pos + len` overflow for a positive position and
`len = max_int`, preserving its documented total-clamping behavior.

The full production build exposed a generator type-grouping error for nested
option elements. The collection generator now parenthesizes every applied element
type in its optional-head signature. A regression case distinguishes an empty
list, a stored absent child and a present child. Existing generated carriers are
byte-identical to their pre-change versions.

After that fix, the full production build passed with 65 public exports
(`.kanon-exec/run-Sg0Bxg`). All 23 new EVM/RLP/trie groups passed across their
scoped runs, totaling 3,362 OCaml comparisons. The original 101-group combined
run remains the evidence for the preceding checkpoint; the expanded 124-group
command has not yet been run as one invocation. Source inventory, generated
collections/opcodes and staged whitespace checks passed as well.

Checkpoint `3f743ac` has 85 production source files and 9,174 nonempty source lines.
Its Wasm artifact is 341,957 bytes with 65 exports and zero imports, SHA-256
`56856d6b9ce2264b3a8fed55a9e36ab5e5ba033420f871aa3d81010d4786f3ed`.
The public 20-second simulator smoke completed 1,959 events and 23 commits per
validator, with all four validators agreeing on block 23
`28a0c54d4128b75c2b192eff1a7cef28bb63bded1b669f4d6dc8eb1dcf081862`
(`.kanon-exec/run-GODT7e`).

## Environment, effects and block commitments

The following scoped suites pass against actual, hash-checked OCaml modules:

| Suite | Groups | Differential rows | Capture |
| --- | ---: | ---: | --- |
| Environment, forks, gas penalty, batch position and block hashes | 5 | 207 | `.kanon-exec/run-tuLhwE` |
| Effect snapshots, storage planning, transfers, creation and destruction | 5 | 346 | `.kanon-exec/run-qK1fik` |
| Fork schedules, intrinsic gas, contract addresses and delegation | 5 | 517 | `.kanon-exec/run-RvQwtZ` |
| Withdrawals, blooms and account/state roots | 3 | 83 | `.kanon-exec/run-vGWrGG` |
| Epoch boundaries and block-context admission | 2 | 234 | `.kanon-exec/run-Q6pgkT` |
| Receipt encoding/roots and block gas accounting | 2 | 88 | `.kanon-exec/run-j2Wem1` |

The effect cases check cold-to-warm witnesses, transaction-original storage through
multiple writes, zero original storage after creation, refund commits, immutable
failure snapshots, self-transfers, nonce exhaustion, prefunding, code deployment,
recipient overflow and pre/post-Cancun destruction. Account removal remains deferred
to the transaction layer, which is not implemented yet.

The oracle harness can sort pinned source modules with `ocamldep` and checks that
sorting preserves the complete module list. Block tests compile the source EVM
interpreter and its secp256k1/BN254 dependencies, with no replacement algorithms in
the test adapters. Zarith is an oracle dependency; the Kanon implementation has no
host crypto imports. The local interpreter and transaction execution remain pending.

These suites add 22 passing groups and 1,475 OCaml comparisons. Receipt tests
cover all success/revert/halt forms, legacy and typed envelopes, fixed-width topics,
successful-log inclusion and cumulative net gas. Block gas preserves source machine
arithmetic, including its unchecked addition wraparound for unrealistic near-maximum
receipt sums; transaction admission must enforce the available gas before execution.
A full production build through block-context admission passed
(`.kanon-exec/run-0uJC7S`).

The subsequent full build, including every receipt declaration and generated carrier,
passed (`.kanon-exec/run-QW9HwB`). The artifact has 102 production source files,
9,936 nonempty source lines, 386,765 Wasm bytes, 65 exports and zero imports, SHA-256
`e01234f057725de96f0dc7bbd3e6cf41d6afbdb5ae806df4f185e9c6430c86d5`
(`.kanon-exec/run-umsQcC`). Source inventory and generated-source checks passed
(`.kanon-exec/run-uZYIuU` and `.kanon-exec/run-iLhTvI`). The expanded combined
invocation passed all 146 groups at commit `1b739137b13c1ae2993d7a154a48d368ee055182`
in a detached checkout. It exited 0 after 2,619.6 seconds, including the full
production build and public CLI tests. Its capture is
`/private/tmp/telcoin-kanon-validation-1b73913/.kanon-exec/run-9ZBu9o`.

## Interpreter and secp256k1 continuation

The new suites pass 17 groups with 3,036 comparisons against the pinned OCaml
implementation. They are included in the expanded 163-group `npm test` command.

| Scope | Evidence |
| --- | --- |
| Instruction bodies | 885 rows covering stack limits, arithmetic operand order, EXP charging, jumps, truncated PUSH, memory, return/revert and overlapping copies. |
| Stateful instructions | 1,533 rows covering warmth and account access, storage sentry/refunds, transient storage, logs, static guards, return-data bounds and fork-specific SELFDESTRUCT. |
| Complete frames | 274 rows covering bytecode programs, activation and gas precedence, calls, delegated code, creation, code deposit, complete account/storage snapshots and the 1,024 nested-call limit. |
| secp256k1 and modular arithmetic | 344 rows covering wide products, inverse rejection, exponent bytes, actual OCaml-generated signatures, malformed scalars and high-S classification. |

The instruction/state suites passed together after the frame-runner change
(`.kanon-exec/run-WEKFyn`). Complete-frame comparisons passed in
`.kanon-exec/run-o6uxUB`; secp256k1 passed in `.kanon-exec/run-Ms73JK`.
After isolating concurrent fixture builds and retaining artifacts by content hash,
the secp256k1 suite passed again in `.kanon-exec/run-YUghez` (344 rows).

The complete production build passed in `.kanon-exec/run-JWk0aQ`, checking
109 source files with 10,573 nonempty lines. The resulting Wasm is 420,522 bytes,
with 65 exports and no imports. Its SHA-256 is
`573239e7af24ebfb855be84e03a408516ee10cd15e4cd1279d0347e81e647877`.
Metrics were recorded in `.kanon-exec/run-JnQ7kM`. The public exports remain
the existing foundation and simulator API; the new interpreter is exercised
through scoped test reactors until the default precompile binding is complete.
The frame fixtures target ordinary accounts. They refuse reserved precompile
addresses; complete precompile implementations and the default binding remain
outstanding. The OCaml oracle retains the actual source precompile module.

Two failures were caught and fixed before publication. MSTORE8 initially used
a 64-bit remainder operation on a 256-bit word; it now reduces the full word.
The initial recursive frame runner exhausted the host stack before the EVM depth
limit. The runner now stores parent contexts and return state in a continuation
list, and the permanent depth test reaches the source limit with default Node
stack settings. No compiler primitive or larger host stack was added.

The large fixture formatters initially hit the compiler's 600-second timeout.
Execution and formatting now cross the Wasm boundary as opaque values, and the
128-byte diagnostic memory window is passed at runtime. The same bytes and
assertions are checked without unrolling that window during compilation. The
compiler timeout is unchanged. Fixture Wasm files and source manifests are kept
in `build/test-artifacts`; the harness also includes the failing input when Wasm
throws. Tests still compile fresh, hash-checked OCaml source.

Modular division builds only the quotient powers needed for its numerator.
This preserves full-width reduction and makes the Euclidean inverse practical
without changing signature semantics. Source inventory and generated-source
checks passed (`.kanon-exec/run-W4Eh7K` and `.kanon-exec/run-3pW7qG`).

The 146-group combined run above remains the evidence for the published parent.
The expanded run at `973a190` failed after 8,054.4 seconds with 69 passing groups
and 17 failed test files. The capture records compiler and OCaml build timeouts,
then reports that the shared `tn-ocaml` switch was no longer installed. This run
does not establish a passing full regression for that revision:
`/private/tmp/telcoin-kanon-validation-973a190/.kanon-exec/run-Y3ygVp`.

## EVM precompiles and default interpreter binding

All nine precompile implementations run in ordinary Kanon. The compiler pin and
the upstream source checkout are unchanged. Scoped evidence includes:

| Scope | Groups | OCaml comparisons | Capture |
| --- | ---: | ---: | --- |
| BN254 extension fields | 5 | 162 | `.kanon-exec/run-pA1VBs` |
| BN254 curves and exact pairing values | 4 | 72 | `.kanon-exec/run-pA1VBs` |
| BN254 precompiles and identity | 31 | 178 | `.kanon-exec/run-eENjcM` |
| BLAKE2F | 3 | 97 | `.kanon-exec/run-Vdt2n5` |
| MODEXP | 3 | 121 | `.kanon-exec/run-l4RRK6` |
| SHA-256 and RIPEMD-160 | 4 | 128 | `.kanon-exec/run-3tFLSN` |
| ECRECOVER | 2 | 46 | `.kanon-exec/run-eENjcM` |
| Complete address dispatch | 2 | 63 | `.kanon-exec/run-eENjcM` |
| Default interpreter frames and real precompile calls | 7 | 332 | `.kanon-exec/run-eENjcM` |

BN254 comparisons include all 28 upstream precompile goldens, wrong-subgroup G2
points, infinity partners, canonical coordinates, scalar boundaries and pairing
cancellation. MODEXP covers operands through 129 bytes, empty and zero modulus,
truncated payloads, gas boundaries and astronomical length headers without payload
allocation. Node BigInt independently checks modular exponentiation. Node/OpenSSL
also checks the SHA-256, RIPEMD-160 and BLAKE2b digests. ECRECOVER includes actual
OCaml-generated signatures and the independently known private-key-1 address.

The 47-group scoped run in `run-eENjcM` passed in 312.1 seconds. It includes
Keccak's 32 existing comparisons and the three source-closure groups. Interpreter
coverage now executes every precompile through CALL, CALLCODE, DELEGATECALL and
STATICCALL, including exact gas, insufficient gas, value stipends, static guards,
return data and rollback. The 1,024 nested-call test remains enabled.

Zero-value paths in extension-field multiplication and Keccak rounds prevent
large symbolic expansion during compilation. Keccak's existing zero-filled
full-block vectors exercise its zero-state shortcut. The generator reproduces
the updated code exactly (`.kanon-exec/run-0bvXY7`). BN254 Frobenius constants are
derived from the pinned OCaml implementation and pass regeneration checks
(`.kanon-exec/run-MRVbqY`). No timeout or assertion was relaxed.

Every oracle harness build now selects its export dependency closure and writes
a source manifest, including tests with no extra fixture file. The production
build still checks every registered source file. A full build with the default
precompile binding passed in `.kanon-exec/run-WYiQyl` before adding the public
precompile API export.

After the shared oracle switch disappeared, OCaml 5.3.0 and the oracle dependencies
were installed in `/Users/oobi/Documents/gpt13/telcoin-kanon-ocaml`. Validation uses
that dedicated switch through `OCAML_SWITCH`; the normal default switch selection
was not changed. Setup captures are `.kanon-exec/run-WyneHI` and
`.kanon-exec/run-WTfjpJ`.

The public CLI suite passed all nine groups in 457.2 seconds, including a complete
production build and all nine precompiles through `apiPrecompile`. It also checks
address widths, gas admission, malformed CLI hex, rejection status and the existing
simulator reports (`.kanon-exec/run-nUBQWC`). The 130 production files contain
11,353 nonempty lines. The resulting Wasm is 470,737 bytes with 66 exports and zero
imports, SHA-256
`7b93e6e034bcd8b6681e5cc48eb4d769d5e1f5c9b217dc169ec65df1e3d17791`
(`.kanon-exec/run-5Du4y3`). Source inventory and every generator check passed in
`.kanon-exec/run-SXZ5Ps`; source/test registration and text hygiene passed in
`.kanon-exec/run-U4KxMa`. The dedicated oracle switch uses Digestif 1.3.1, Zarith
1.14 and ocamlfind 1.9.8 (`.kanon-exec/run-pP58L8`).

The expanded combined suite is the next validation step. The scoped results above
are not a claim that the full suite has passed at this checkpoint.

## Initial foundation audit

Foundation audit: 2026-09-10. The audit and artifact hash below describe the
initial foundation revision. Subsequent work is recorded at the end of this file.

Source: telcoin-ocaml `6b8bafe5ef1bb14376cddea5be6f4222c5720dfe`.
All 494 selected files and the compiler executable remain hash-matched to
`source-lock.json`. The upstream and compiler source checkouts remain clean.
No compiler changes were made.

| Check | Result |
| --- | --- |
| Source inventory | 178 implementation modules, 25 libraries, 22,573 implementation lines, 494 pinned files. |
| Public module | 26 Kanon source files, 3,152 lines, 62 exports, zero imports, 109,310 Wasm bytes. Export names exactly match exports.json. |
| Foundation suite | 14 groups passed; 1,261 comparisons against actual OCaml scalar/primitive-codec modules, plus independent full-width arithmetic and invariant-boundary checks. |
| Composite suite | Eight groups passed: polymorphic codecs, lists including zero-byte units, nested lists, maps, sets, enums, malformed inputs and generated-source consistency. |
| Standard-library suite | Five groups passed: SplitMix64 next/split/ranges, state progression, wrapping arithmetic and generic Nonempty operations. |
| BLAKE2s suite | Three groups passed: published empty/abc vectors, 16 input lengths across block boundaries through 4,096 bytes, and 24 deterministic random inputs against Node/OpenSSL. |
| Crypto and committee suite | Six groups passed: seed derivation, signature parsing/verification, canonical aggregates, committee creation, thresholds, lookup/wrapping, unique-member stake and address-sensitive roster equality. |
| Protocol suite | Seven groups passed: batch/header golden bytes and digests, receipt skip, unverified sealed claims, exact malformed/truncated errors, signed anchors, intent votes, certificate assembly/claims and genesis membership. |
| Public CLI suite | Six groups passed: primitive and composite commands, simulation crypto, PRNG, committee and protocol inspection, rejection paths, help/launcher and compiler pin enforcement. |
| Final combined suite | All 49 groups passed in the sequential seven-file run, exit 0. |
| Generated collections | All 15 concrete carriers match the shared generator across three generated files. |
| Source hygiene | No axiom declarations, forbidden dash characters or trailing whitespace in authored Kanon, tests, scripts, CLI/runtime and current documentation. |

The oracles compile copied, hash-checked OCaml implementations. Adapters parse
requests and render responses; they do not reproduce the protocol algorithms.
The protocol oracle includes the actual BCS, simulation crypto, scalar,
authority, committee, batch, anchor, header, vote and certificate modules.
Its hash32 dependency also links the source Keccak module, although Keccak
itself is not ported or tested as a Kanon algorithm here.

Behavioral checks include:

- All primitive bool/option tags, malformed ULEB32 and lengths, exact offsets,
  missing-span precedence, trailing bytes and full-width decimal transport.
- Sorted-map order and duplicate rejection, BTree-set normalization, nested
  collections, zero-byte list elements and unknown sum variants.
- PRNG seed/state boundaries and signed OCaml host-int ranges, including the
  source split operation's skipped state and advancement on degenerate ranges.
- Signature separator normalization and duplicate aggregate membership rules,
  preserved specifically for parity with the forgeable simulation profile.
- Source golden batch/header preimages, every truncation of representative
  values, duplicate payload first-position/last-value semantics, sorted unique
  parents, timestamp range refusal and a full-u32 header sequence count.
- Empty/insufficient/duplicate/unknown/invalid certificate voters, changed
  header metadata, signer-set normalization, bad aggregate claims and rejection
  of Genesis state on headers outside the exact committee genesis set.

The source's leader-round exhaustion bug and stake/duration overflow behavior
are explicit corrections, with both source and Kanon outcomes asserted.
Other representation changes and limitations are documented in README.md.

These checks cover the implemented subset. They do not establish consensus
agreement/liveness, EVM execution, durability, networking, production signature
security, production-size performance, formal proofs or full-project parity.

Reproduce the combined run:

```sh
kanon-wait run -- kanon-exec run --budget 4000 -- kanoncho test --test-concurrency=1 test/foundation.test.mjs test/composite.test.mjs test/std.test.mjs test/blake2s.test.mjs test/crypto.test.mjs test/protocol.test.mjs test/cli.test.mjs
kanon-wait run -- kanon-exec run --budget 4000 -- node scripts/inventory.mjs
kanon-wait run -- kanon-exec run --budget 4000 -- node scripts/collections.mjs --check
```

Local evidence captures:

- Final combined suite: `.kanon-exec/run-ZvYD2P`.
- Crypto and committee: `.kanon-exec/run-3ummSn`.
- Protocol: `.kanon-exec/run-XEpGF8`.
- Public CLI and its production-module build: `.kanon-exec/run-EVzzni`.
- Source inventory: `.kanon-exec/run-utYsUm`.
- Generated collections: `.kanon-exec/run-mMPvKe`.
- Wasm metadata and export/import check: `.kanon-exec/run-fvcUYX`.

The public artifact `build/telcoin-foundation.wasm` has SHA-256
`c2ae9a6afde11786563cfde92f8a06f9e2fb78fbfca4b20a76594e9d81704a68`.
Build output and captures are ignored by Git and remain available locally.

Publication preparation, 2026-09-11: moved the repository to
`~/Documents/telcoin-kanon`, preserving its build and local evidence.
The source/compiler inventory and collection generator checks still pass.
Rebuilt and reran the six public CLI test groups from the new location;
all passed, captured in `.kanon-exec/run-B1xPz5`. The previous 49-group
combined run remains the full-suite evidence. Publication does not mark
the port complete; PORTING.md records the remaining work.

Continuation, 2026-09-11, in the `port/complete` worktree:

- Consensus foundations: eight groups passed against the actual OCaml DAG,
  vote and parent aggregators and voter, including recovery and error order.
  Capture: `.kanon-exec/run-7IfC2c`.
- Randomness: four groups passed against OCaml ChaCha12, Std_rng and Rand_seq,
  checking block boundaries, range widths, biased-zone draws, reservoirs and
  subsequent stream position. Capture: `.kanon-exec/run-9avGd9`.
- Keccak: two groups passed, including known vectors and Digestif comparisons
  at 16 message lengths around padding/block boundaries through 1,000 bytes.
  Capture: `.kanon-exec/run-rLZ5P2`.
- Commit and proposer behavior: ten groups passed against OCaml, covering
  reputation scores, leader swaps, sub-DAG wire/preimage/hash behavior,
  Bullshark insertion and recovery, schedule windows, proposer timers,
  queued batches and restart behavior. Capture: `.kanon-exec/run-JNgv0O`.
- Node composition: five groups passed, with 12 transcripts covering voting,
  offered ancestry, gossip, commit windows and recovery. Capture:
  `.kanon-exec/run-cvmK1b`.
- Execution: six groups passed for block/genesis hashes, height bounds, chain,
  no-op execution, ordered body resolution, reference store and replay. Together
  with a repeated ten-group commit/proposer run: `.kanon-exec/run-KfEjYd`.
- Simulator: three groups and 19 seeded transcripts passed, comparing complete
  committed wire and execution digests, event limits, crashes, loss and batches.
  Capture `.kanon-exec/run-l3WWwC` also contains two execution fixture failures,
  subsequently fixed and passed in the execution capture above.
- U256: three groups, 454 OCaml rows and independent BigInt arithmetic checks
  passed. Capture: `.kanon-exec/run-fVUaDC`.
- Account state: six groups and 42 OCaml rows passed, including deployment and
  delegation precedence, nonce bounds, storage canonicality, genesis allocation,
  self-transfers, overflow rollback and address narrowing. Capture:
  `.kanon-exec/run-fsmqK0`.
- Full source build through account state and the public simulator API passed
  with 65 exports in `.kanon-exec/run-rasD9L`.
- Eight public CLI groups and the ten commit/proposer groups passed together in
  `.kanon-exec/run-GKEnG7`. CLI tests compare six invocations of the actual pinned
  `bin/tn_sim.ml`, including its default run, reports and exit status. Only the
  first line changes its project name and separator. The recovery fixture now
  makes an unexpected recovery error visible instead of falling back silently.
- The combined suite on a fixed revision is the next publication check.

The larger typed consensus fixtures exceeded the original 120-second compiler
timeout. The build timeout is now 600 seconds; the validation assertions are
unchanged. Ordered maps currently use canonical lists, so lookup costs differ
from OCaml's balanced trees. Proposer configuration uses nonnegative thresholds
and capacities. Leader-score arithmetic is checked against reachable small
scores, not arbitrary OCaml host-integer overflow cases.

Test fixture builds use a conservative lexical dependency closure. Three selector
tests check constructor families, recursion, source order, strings, comments,
shadowing and rejected ambiguous inputs (`.kanon-exec/run-hhOw9a`). The normal
build and CLI suite still check every production declaration. No assertions are
removed by selecting test inputs. Compiler identity and each selected declaration
are recorded beside fixture artifacts.

The genesis anchor and default aggregate randomness are stored constants checked
against OCaml. Computing those closed hashes repeatedly during erasure caused
compiler timeouts; protocol hashing for runtime values remains Kanon code.
Replay collection stops after the requested maximum-height record. OCaml's
saturating successor revisits that final height and normally reports a broken
link. This termination correction is separate from ordinary-range replay parity.
