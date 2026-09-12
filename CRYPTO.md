# Crypto profiles

The build selects one implementation of the common crypto API. The default
`simulation` profile reproduces the source's forgeable BLAKE2s simulation stub.
The `bls` profile reproduces `lib/crypto_blst/tn_crypto.ml` at the revision in
`source-lock.json`. All arithmetic and hashing run in Kanon, with no Wasm imports.

| Property | simulation | bls |
| --- | --- | --- |
| Profile string | `simulation-stub:blake2s256` | `bls12-381:minsig-basic:blake3` |
| Digest | BLAKE2s-256 | Unkeyed BLAKE3-256 |
| Public key | 32 bytes | 96-byte compressed G2 |
| Signature | 65 bytes | 48-byte compressed G1 |
| Aggregate | Source simulation list encoding | 48-byte compressed G1 |
| Genesis parent | `9dfca174bddc9a0f0db2662d85be94f900dc5415c186678d2ab3c78280a8a905` | `036e5c0a72077a23c817ab35907e7a5eedf5014e42095c4033f30f9c5cb94ed6` |

BLS uses the Basic MinSig ciphersuite with DST
`BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_`. Key derivation encodes the
unsigned 64-bit seed in little-endian order, hashes the source domain and seed
with BLAKE3, then applies the source HKDF key generation. Seeds are deterministic
source-compatible inputs, not a key-generation entropy service.

Hash-to-G1 uses SHA-256 XMD, the SSWU map, the 11-isogeny and effective cofactor
from [RFC 9380](https://www.rfc-editor.org/rfc/rfc9380.html). Generated constants
and their provenance live in `scripts/generate-bls.mjs` and
`scripts/bls-isogeny.json`. Pairing and final-exponent outputs are compared
coefficient by coefficient with the native blst-backed OCaml implementation.

Compressed admission checks octets, widths, flags, canonical field coordinates,
curve membership and subgroup membership. Public-key admission rejects infinity;
signature and aggregate admission accept it, matching the source. Aggregation
preserves duplicate signatures. Aggregate verification rejects an empty key list
and each infinity key, but preserves the source's behavior when valid opposite
keys sum to infinity. It verifies one shared message and does not add a
proof-of-possession or key-registration policy to the source API.

## Public entry points

Build with `npm run build` and `npm run build:bls`, then select the artifact with
`loadProfile` from `runtime.mjs`. Convert strings or `Uint8Array` values with
`toBytes`, and returned bytes with `fromBytes`.

| Wasm export | Inputs | UTF-8 output |
| --- | --- | --- |
| `cryptoProfile` | None | Profile identifier |
| `apiCryptoHash` | Raw message bytes | Digest hex |
| `apiCryptoKey` | Unsigned decimal u64 seed bytes | Public-key hex |
| `apiCryptoSign` | Seed bytes, raw message bytes | Signature hex |
| `apiCryptoVerify` | Raw public key, message, signature | `true` or `false` |
| `apiCryptoAggregate` | ByteStrings of raw signatures | Aggregate hex |
| `apiCryptoVerifyAggregate` | ByteStrings of raw public keys, message, aggregate | `true` or `false` |

Build a ByteStrings value with `seqBytesEmpty()` and `seqBytesCons(bytes, tail)`.
Invalid seeds or malformed keys/signatures return an `error: ` message. A
well-formed signature that fails verification returns `false`. Existing
`apiSimulationKey` and `apiSimulationSign` names remain compatibility aliases
for the selected profile. `apiVoteSign` and `apiCommitteeInspect` also use that
profile. The separate `blake2s256` export always computes BLAKE2s.

The CLI exposes these operations as `simulation` or `bls` subcommands. Lists use
comma-separated hex; an empty string means an empty list. Successful verification
returns JSON with `valid: true` or `valid: false` and exit status 0. Malformed
input returns status 1. Profile identifiers accompany every crypto JSON result.

## Runtime limits

The field and scalar implementation uses variable-time arbitrary-precision
arithmetic and garbage-collected values. It does not offer constant-time secret
operations or secret-memory erasure. Native wire and behavior comparisons do not
establish side-channel resistance or production throughput.

Kanon represents native retry loops with explicit finite fuel. Key generation
has up to 2^64 rounds and returns an optional result on exhaustion. The checked
`secretKeyDeriveChecked` exposes that failure; the compatibility total wrapper
uses an inert zero key on exhaustion. The source loops until a nonzero scalar.
No tested seed reaches exhaustion. Hash-to-curve also has an optional internal
result; the total signing wrapper retains the source bridge's infinity fallback.
These adaptations and performance limits remain part of the port's contract.
