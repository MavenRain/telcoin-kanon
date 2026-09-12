# Validation

The implementation covers all 178 modules in the pinned OCaml inventory. The
complete simulation and BLS public Wasm builds pass, as do the BLS CLI and network
integration suites. The full sequential regression is running in
`.kanon-exec/run-sh1Hgx`; its final result will be recorded here before completion.

## Reproduce

Use the pinned compiler and OCaml source described in [README.md](README.md).
The validation switch for this checkout is
`/Users/oobi/Documents/gpt13/telcoin-kanon-ocaml`:

```sh
export OCAML_SWITCH=/Users/oobi/Documents/gpt13/telcoin-kanon-ocaml
npm test
npm run collections:check
npm run inventory
```

Tests compile the actual pinned OCaml modules, then compare them with compiled
Kanon Wasm. Cached test artifacts are accepted only when their compiler, selected
source closure, ordered exports and Wasm content hashes match. Native oracle
compilation and all runtime comparisons still execute. Complete public builds use
a 30-minute compiler budget; ordinary scoped builds retain 10 minutes and native
oracle processes retain 30 seconds. The engine integration fixture also has an
explicit 30-minute compiler budget, as documented in the history.

## Complete runtime builds and integration

| Check | Result | Capture |
| --- | --- | --- |
| Complete simulation build and public CLI | 9 groups pass; rerun after final callback changes is in the broad regression | `.kanon-exec/run-atT4y1` |
| Complete BLS build and public CLI | 5 groups pass, 1181.1 seconds including compilation | `.kanon-exec/run-BGTHuz` |
| BLS network votes and certificates | 10 native comparisons, 3 groups pass | `.kanon-exec/run-2mi4Te` |
| Generated-source checks | Pass with the dedicated OCaml switch | `.kanon-exec/run-WzJiM5` |
| Pinned source inventory | Pass | `.kanon-exec/run-2UdxiW` |

The public BLS checks include every declared export, full-width seeded key
derivation, signing, BLAKE3 hashes, committee identifiers, vote signatures,
verification, wrong messages, empty and duplicate aggregation, duplicate-key
verification, malformed encodings and usage errors. Network tests compare actual
outgoing votes and conversion back to verified local votes, genesis and aggregate
certificates, duplicate aggregation, bitmap positions and invalid signers.

The broad regression began before the BLS network suite was added to `npm test`;
its separate passing run above covers that addition. Its BLAKE2s suite hit a
600-second compiler limit because it built the complete library. The test now
selects its hash-export closure and passes all three original groups in
`.kanon-exec/run-oil7Fh`. Both CLI suites still compile the complete library.
No vector, assertion or required public build was removed.

## Compatibility and limits

The source pin is `6b8bafe5ef1bb14376cddea5be6f4222c5720dfe`. The compiler binary
SHA-256 is `d8b522e8b92ce11227fb16c5420d472e33f601013721e1826e9d04fc3231ccc3`.
The BLS oracles use OCaml 5.3, Zarith 1.14, bls12-381 6.1.0,
bls12-381-signature 1.0.0 and hex 1.5.0, alongside pinned Rust vectors.

This validation establishes compatibility for the tested operations and inputs.
It does not establish constant-time secret operations or production throughput.
[CRYPTO.md](CRYPTO.md), [RUNTIME.md](RUNTIME.md) and
[COLLECTIONS.md](COLLECTIONS.md) describe cryptographic, host-boundary and collection
adaptations. The complete checkpoint evidence, including failed attempts and their
fixes, is retained in [VALIDATION-HISTORY.md](VALIDATION-HISTORY.md).

## Focused pre-merge review

The review checked build/test wiring against `origin/main` and the final BLS
milestone against `a3a9e31`. It read the profile selection, byte admission,
public crypto adapters, key derivation, compressed point checks, hash-to-curve
and pairing/aggregate verification paths. This is a focused diff review, not
an independent cryptographic audit of the entire port.

The CI check found 33 original test files and 101 current files, with no removed
suites, skipped tests, removed assertions or changed CI configuration. Capture:
`.kanon-exec/run-zrH3Vi`. The compiler-budget changes and BLAKE2s closure selection
retain runtime assertions and both complete public builds. Artifact reuse checks
the compiler, source, export order and Wasm hashes before accepting a binary.

No concrete correctness finding was established in the reviewed paths. The
native comparisons include malformed encodings, subgroup rejection, infinity,
duplicate signatures and cancelling public keys.

## BLOCKERS

The full regression has not finished. No unresolved CI-weakening or code finding
was identified in the focused review. Merge after the remaining regression
passes and the known BLAKE2s timeout is reconciled with its passing rerun.
