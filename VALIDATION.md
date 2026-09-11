# Validation

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

The 146-group combined run above remains the evidence for the published parent;
the expanded 163-group combined invocation has not yet run.

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
