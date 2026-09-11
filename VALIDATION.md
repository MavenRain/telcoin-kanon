# Validation

Date: 2026-09-10.

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
