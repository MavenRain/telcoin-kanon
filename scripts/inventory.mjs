import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const upstream = process.env.TELCOIN_OCAML_ROOT ?? '/Users/oobi/Documents/telcoin-ocaml';
const kanon = process.env.TELCOIN_KANON_ROOT ?? '/Users/oobi/Documents/kanon';
const compiler = process.env.KANON_BIN ?? resolve(kanon, '_build/default/bin/kanon.exe');
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const hash = contents => createHash('sha256').update(contents).digest('hex');
const paths = git(upstream, 'ls-files', 'lib', 'bin', 'test', 'doc', 'dune-project', 'README.md', 'PORTING.md', 'LICENSE-MIT', 'LICENSE-APACHE').split('\n');
const files = paths.map(path => {
  const content = readFileSync(resolve(upstream, path));
  return { path, sha256: hash(content), lines: content.toString('utf8').split('\n').length - Number(content.at(-1) === 10) };
});
const libraries = [...new Set(paths.filter(p => p.startsWith('lib/')).map(p => p.split('/')[1]))].sort().map(name => {
  const members = files.filter(f => f.path.startsWith(`lib/${name}/`));
  return { name, modules: members.filter(f => f.path.endsWith('.ml')).length,
    implementationLines: members.filter(f => f.path.endsWith('.ml')).reduce((sum, f) => sum + f.lines, 0),
    dune: readFileSync(resolve(upstream, `lib/${name}/dune`), 'utf8') };
});
const snapshot = { version: 1, upstream: { root: upstream, revision: git(upstream, 'rev-parse', 'HEAD'),
  status: git(upstream, 'status', '--porcelain'), files, libraries },
  toolchain: { root: kanon, revision: git(kanon, 'rev-parse', 'HEAD'), status: git(kanon, 'status', '--porcelain'),
    compiler, compilerSha256: hash(readFileSync(compiler)) } };
const destination = resolve(project, 'source-lock.json');
if (process.argv.includes('--write')) {
  if (snapshot.upstream.status || snapshot.toolchain.status) throw new Error('Pinning requires clean upstream and compiler source trees.');
  writeFileSync(destination, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' });
} else {
  const pinned = JSON.parse(readFileSync(destination, 'utf8'));
  if (snapshot.upstream.revision !== pinned.upstream.revision || snapshot.upstream.status ||
      JSON.stringify(snapshot.upstream.files) !== JSON.stringify(pinned.upstream.files) ||
      snapshot.toolchain.compilerSha256 !== pinned.toolchain.compilerSha256) throw new Error('Source or compiler drift from source-lock.json.');
}
console.log(JSON.stringify({ libraries: libraries.length, modules: libraries.reduce((s, l) => s + l.modules, 0),
  implementationLines: libraries.reduce((s, l) => s + l.implementationLines, 0), files: files.length,
  revision: snapshot.upstream.revision, compilerSha256: snapshot.toolchain.compilerSha256 }));
