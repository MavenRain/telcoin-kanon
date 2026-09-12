# Using the Kanon library

`src/` contains the library implementation. `scripts/build.mjs` supplies the
dependency order and selects the simulation or BLS crypto implementation.
`PORTING.md` maps every pinned OCaml implementation module to its Kanon code.
The compiler and application have separate source pins; builds verify the
compiler executable before invocation.

## Public Wasm module

Build with `npm run build` or `npm run build:bls`. Both artifacts export the
functions in `exports.json`, including BCS/scalar helpers, protocol inspection,
crypto, the seeded simulator and all nine source-supported EVM precompiles.

```js
import {loadProfile} from './runtime.mjs';

const {exports: e, toBytes, fromBytes} = await loadProfile('bls');
const digestHex = fromBytes(e.apiCryptoHash(toBytes('abc'))).toString('utf8');
console.log(digestHex);
```

The byte adapter accepts UTF-8 strings or `Uint8Array` values. Binary wire data
must use bytes, not an implicitly decoded string. Full-width integers use
decimal bytes at the public service boundary. Internal Kanon values remain
opaque WasmGC references and must stay within the instance that created them.
See CRYPTO.md for profile selection and the crypto exports.

## Application entry points

An application can compile its own Kanon entry points against the same library.
Use checked constructors to admit external data and expose only the operations
needed by the host. For example, save this as `app.kan` in the repository root:

```text
def appHeaderDigest : Bytes -> Bytes := apiHeaderInspect
```

Build and load it from JavaScript in the repository root:

```js
import {resolve} from 'node:path';
import {build} from './scripts/build.mjs';
import {loadFoundation} from './runtime.mjs';

const output = resolve('build/app.wasm');
const exports = ['emptyBytes', 'consBytes', 'bytesEmpty', 'bytesHead', 'bytesTail', 'appHeaderDigest'];
build(output, exports, [resolve('app.kan')], {profile: 'bls'});
const app = await loadFoundation(output);
```

Create the output directory before calling `build`. Extra source files follow
the library in the supplied order. The build computes the declaration closure
of the requested exports and saves its source hash and declaration list in
`OUTPUT.sources.json`. This removes unused declarations from an application
artifact; it does not substitute for library validation. The test harness uses
the same mechanism and verifies exact source/compiler/export hashes before
reusing a compiled test artifact.

Complete builds have a 30-minute compiler limit. Scoped builds retain the
10-minute default unless an application supplies an explicit `timeoutMs` (up to
30 minutes). The full BLS source profile took 531 seconds for type-checking and
erasure alone during validation. Scoped BLS test builds keep the usual limit.

Kanon has no OCaml-style private module constructors. An opaque reference alone
does not establish a checked-value invariant. Treat the host byte adapter and
the application's checked Kanon entry points as the external boundary.

## Durable effects

Durable operations return typed Kanon continuations. The host executes each
requested syscall and returns a success or explicit Unix/system error. Kanon
retains transfer loops, cleanup precedence, counters, locks and recovery logic.
The Wasm module itself has no host imports.

An application wrapper should create a task with `durableEffectRun` and expose
the functions in `durableHostExports` from `durable-runtime.mjs`. Run that task
using `runDurableTask(exports, initialTask, host.dispatch)`, where `host` is
created by `createPosixHost()` from `runtime/posix.mjs`. Close the host in a
`finally` block. Each host uses one persistent Python 3 process to own its
descriptors and process-level advisory locks. Preserve the returned Kanon state
between operations; restarting it resets counters and the in-process root
register. `test/durable-posix.test.mjs`, `test/disk-store.test.mjs` and
`test/checkpoint-file.test.mjs` contain complete filesystem and restart examples.

The POSIX adapter preserves byte paths and full-width offsets. It uses `fsync`
and advisory process locks, matching the source. On macOS it does not add
`F_FULLFSYNC`. The source has no socket transport or standalone network-node
executable to port; the supplied executable is the deterministic simulator.
