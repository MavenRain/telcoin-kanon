# telcoin-kanon

A Kanon port of `telcoin-ocaml`, pinned to chunk 44 at
`6b8bafe5ef1bb14376cddea5be6f4222c5720dfe`.

Implemented code includes BCS primitive and composite
codecs, generic nonempty operations, SplitMix64, ChaCha12, Keccak-256, scalar
and digest types, simulation crypto, authorities and committees, batches,
headers, votes, certificates, DAG and voting state, leader scheduling,
sub-DAG commits, proposer and node composition, the deterministic simulator,
consensus-chain execution and replay, U256 and account state. EVM primitives now
include arithmetic, opcodes, stack, memory, access tracking, gas/refunds, code and
data windows, transient storage, logs, transaction environments and effect snapshots.
Fork schedules, delegation resolution, contract addresses, intrinsic gas, block contexts,
withdrawals, blooms, RLP, Merkle-Patricia state roots, receipts and receipt roots
are also implemented. Protocol behavior runs in Kanon compiled to WasmGC.
JavaScript transports bytes and supplies the CLI and test harness.

The interpreter includes instruction dispatch, calls, creation and rollback, with
all nine source-supported precompiles: ECRECOVER, SHA-256, RIPEMD-160, identity,
MODEXP, BN254 addition, multiplication and pairing, and BLAKE2F.
All four signed transaction formats, sender recovery, EIP-7702 authorization and
transaction execution now pass focused OCaml comparisons. Batch validation,
payload attachment/filtering, block planning, registry ABI, shuffle and engine
state transitions also pass differential tests. Block execution, header assembly,
system calls, driver output folds, checkpoint replay and epoch handoff pass focused integration checks.
Real registry execution also matches through epoch closing, replay and a second epoch.
Raw and framed Snappy, CRC-32C, durable frames and log-header validation are ported.
The live driver write protocol and durable record/checkpoint codecs also pass
focused comparisons, including failed execution, replay and malformed storage payloads.
Network scalar and BLS wire types, Base58, protocol identifiers, frame envelopes,
epoch records and node record compatibility pass focused comparisons. Roaring
bitmaps, vote and certificate adapters, epoch certificates and peer exchange also
match the OCaml reference. Synchronization requests, frames, chunking and pure
stream readers pass 927 further comparisons. All 24 pinned network modules now
have differential coverage, including primary and worker messages, gossip rules
and node routing.
Guarded I/O, atomic file replacement and store locking also pass focused comparisons.
Kanon owns continuations, error handling, counters, partial transfers and the canonical
root register. The POSIX host supplies descriptor operations through a persistent
Python 3 helper, using POSIX fsync and process-owned advisory locks. The helper
preserves byte paths and decimal full-width offsets. Each session must retain its
Kanon state across operations to preserve counters and in-process lock ownership.
Explicit fork schedules, transaction skips and the Prague calldata floor now match
through live engine execution and checkpoint replay. Append-log recovery, checkpoint files and the disk store
also pass differential and real-filesystem checks, including interrupted writes, restart,
duplicate retries and checkpoint guards. Typed transaction and receipt root wrappers
also match the source. General Round and Authority map/set APIs pass 320 further
comparisons; [COLLECTIONS.md](COLLECTIONS.md) describes their typed interface.
BLS12-381 consensus crypto now passes native key, signature, aggregate and pairing
comparisons, including the profile-specific genesis anchor and real vote/certificate
wire adapters. Both source crypto
profiles have runtime and CLI entry points. The source has 178 implementation
modules across 25 libraries. [PORTING.md](PORTING.md) records the source map and
interface adaptations. [VALIDATION.md](VALIDATION.md) records tested behavior
and final validation results.

## Run

Requires Node with WasmGC support and the compiler pinned in `source-lock.json`.
Filesystem execution additionally requires Python 3 with POSIX `fcntl` and `ctypes`.
The adapter uses POSIX `fsync`, matching the source. On macOS it does not issue
`F_FULLFSYNC`, so power-loss durability is outside this contract.
`TELCOIN_KANON_ROOT` or `KANON_BIN` can locate the same compiler elsewhere.
A different executable is refused until its pin is reviewed and updated.
The project uses its own root variable because capture tools reserve
`KANON_ROOT` for their runtimes.

```sh
npm run build
npm run build:bls
sh bin/telcoin-kanon simulate --validators 4 --seed 42 --until-s 20
sh bin/telcoin-kanon bcs encode u64 18446744073709551615
# ffffffffffffffff
sh bin/telcoin-kanon bcs normalize set-u8 050302030101
# 03010203
sh bin/telcoin-kanon prng next 0
# {"value":"16294208416658607535","state":"11400714819323198485"}
sh bin/telcoin-kanon simulation hash 616263
sh bin/telcoin-kanon simulation committee 1,2,3,4
sh bin/telcoin-kanon bls hash 616263
sh bin/telcoin-kanon bls key 1
sh bin/telcoin-kanon bls sign 1 616263
sh bin/telcoin-kanon wire batch 000000000014000000000000000000000000000000000000000007000000000000000000
sh bin/telcoin-kanon evm precompile 0000000000000000000000000000000000000002 72 616263
```

`--help` lists all commands. The CLI exits 0 on success, 1 for invalid data or
runtime failure, and 64 for invalid command syntax. Codec errors preserve the
source's text and offsets. Binary data uses hex; full-width words use decimal
strings. `runtime.mjs` exports `loadTelcoin` (also named `loadFoundation` for
compatibility), `loadProfile('simulation' | 'bls')`, and byte adapters. The
artifacts are `build/telcoin-foundation.wasm` and `build/telcoin-bls.wasm`.
See [CRYPTO.md](CRYPTO.md) for the crypto API and [RUNTIME.md](RUNTIME.md)
for importing the library, compiling application entry points and running
durable effects.

The precompile command reports `succeeded` with decimal `gasUsed` and hex `output`,
`rejected`, or `not-precompile`. The public `apiPrecompile` Wasm export takes
address bytes, decimal gas bytes and input bytes. Address and gas admission,
cryptography, gas charging and dispatch run in Kanon.

## Crypto profiles

The explicit profile is `simulation-stub:blake2s256`. It reproduces the source's
deterministic, forgeable stub: public keys derive from seeds, and signatures
contain a public key and message digest. It provides no signature security.
The `bls12-381:minsig-basic:blake3` profile ports the source's BLS implementation:
96-byte public keys, 48-byte signatures, SHA-256 hash-to-curve, seed derivation,
aggregation and pairing verification, with BLAKE3 digests. Profile selection also
selects consensus digests and the genesis anchor. The BLS implementation uses
variable-time arbitrary-precision arithmetic; it is not hardened for secret-key
operations in an adversarial timing environment. See [CRYPTO.md](CRYPTO.md).

BLAKE2s-256 is implemented in ordinary Kanon using the algorithm in
[RFC 7693](https://www.rfc-editor.org/rfc/rfc7693.html), with published vectors,
block-boundary cases and comparisons against Node/OpenSSL. No crypto host
imports or compiler primitives were introduced.

SHA-256 follows [RFC 6234](https://datatracker.ietf.org/doc/html/rfc6234).
RIPEMD-160 follows [the original algorithm specification, Appendix A](https://ftp.esat.kuleuven.be/pub/COSIC/bosselae/ripemd/ripemd160.pdf).
MODEXP supports operands wider than 256 bits. BN254 decoding enforces canonical
coordinates and the G2 subgroup check before pairing, including infinity pairs.

## Validate

```sh
npm test
npm run inventory
npm run collections:check
```

Tests require the pinned OCaml checkout and a `tn-ocaml` opam switch with
`ocamlfind`, `digestif.c`, `zarith`, `bls12-381`, `bls12-381-signature` and `hex`.
The validated BLS packages are versions 6.1.0, 1.0.0 and 1.5.0 respectively,
with Zarith 1.14 and OCaml 5.3. Use `TELCOIN_OCAML_ROOT` and `OCAML_SWITCH` to
relocate them. Tests hash-check and copy actual OCaml source modules into
temporary directories, compile oracle executables, and compare their results
with Kanon. They do not build or modify the source checkout or fetch packages.
The crypto oracles link C stubs into their executables to avoid depending on
runtime shared-library search paths.

With the installed compact tools:

```sh
kanon-wait run -- kanon-exec run --budget 4000 -- npm test
```

The ordinary `npm test` runs all listed suites sequentially.
The local validation switch is
`/Users/oobi/Documents/gpt13/telcoin-kanon-ocaml`; select it with `OCAML_SWITCH`
for both tests and generated-source checks. The default switch name is `tn-ocaml`.

## Semantics and limitations

- Round and epoch saturate at u32 maximum. Timestamp saturates at signed
  int64 maximum. Worker IDs are u16. Stake and duration use the nonnegative
  OCaml host-int range. Base fee preserves unsigned u64 bit patterns.
- `leaderRoundNext` fails at 4294967294, where OCaml produces the invalid odd
  round 4294967295. Stake and duration addition fail on overflow instead of
  wrapping into invalid negative values. Tests assert these corrections.
- Fixed-width BCS writers retain low-byte truncation. ULEB writers can emit
  values larger than u32, which readers reject. Generic list lengths stop at
  2147483647. The source header's custom list reader admits a full u32 count;
  this distinction and its error offsets are preserved.
- Sorted maps reject unordered or duplicate decoded keys. BTree sets accept
  and normalize unsorted, repeated elements. Header payloads keep a key's
  first position and last value, while parents are sorted and deduplicated.
- Batch receipt times are excluded from serialization and digests. Sealed
  batch claims are retained without verification, as in the source; CLI
  inspection reports both claimed and computed digests. Header timestamps
  above signed int64 maximum are refused. Vote messages use `02 00 01 20`
  followed by the header digest.
- Kanon has no private module constructors. Nominal wrappers distinguish
  types, but only checked entry points enforce their value invariants. Raw
  Wasm Nat inputs support 0 through 1073741823; wider values cross as decimal
  bytes and opaque references. Raw callers must supply valid octets and widths.
- General codecs and nonempty operations share typed collection dictionaries.
  The pinned compiler cannot construct parameterized recursive families, so
  one generator supplies concrete carriers. A nominal nullary unit avoids a
  backend trap with polymorphic empty products. These workarounds stay in
  application code and do not change the compiler.
- Generated collection sorting is quadratic. No production-size performance,
  consensus agreement, node compatibility or formal equivalence is claimed.
  Internal bounded arithmetic helpers have explicit word-size preconditions.

Licensed under MIT OR Apache-2.0. The source and compiler executable hashes
are pinned separately. A nearby compiler source revision does not establish
that the executable was reproducibly built from that revision.
