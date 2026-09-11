import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(resolve(project, 'source-lock.json'), 'utf8'));
export const compiler = process.env.KANON_BIN ?? resolve(process.env.TELCOIN_KANON_ROOT ?? lock.toolchain.root, '_build/default/bin/kanon.exe');
export const sources = ['core', 'nat64', 'scalars', 'bcs', 'codec', 'fixed', 'scalar_ops', 'crypto_types', 'sequence',
  'collections', 'crypto_collections', 'nonempty', 'prng', 'blake2s', 'crypto_stub', 'committee',
  'protocol_codec', 'batch', 'block_num_hash', 'header', 'vote', 'certificate_types', 'vertex_collections', 'certificate', 'api', 'service'].map(name => resolve(project, `src/${name}.kan`));
export function build(output, exports, extraSources = []) {
  const hash = createHash('sha256').update(readFileSync(compiler)).digest('hex');
  if (hash !== lock.toolchain.compilerSha256) throw new Error('Compiler differs from source-lock.json. Review and repin before building.');
  const built = spawnSync(compiler, ['build', ...sources, ...extraSources, '-o', output,
    ...exports.flatMap(name => ['--export', name])], { encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  if (built.error || built.status !== 0) throw new Error(built.error?.message ?? built.stderr ?? `Compiler exited ${built.status}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(resolve(project, 'build'), { recursive: true });
  const exports = JSON.parse(readFileSync(resolve(project, 'exports.json'), 'utf8'));
  build(resolve(project, 'build/telcoin-foundation.wasm'), exports);
  console.log(`Built telcoin-foundation.wasm with ${exports.length} exports.`);
}
