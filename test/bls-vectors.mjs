import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const lock=JSON.parse(readFileSync(new URL('../source-lock.json',import.meta.url),'utf8'));
const path='test/fixtures/tn_crypto_blst_vectors.txt';
const raw=readFileSync(resolve(process.env.TELCOIN_OCAML_ROOT??lock.upstream.root,path));
assert.equal(createHash('sha256').update(raw).digest('hex'),lock.upstream.files.find(file=>file.path===path)?.sha256,path);
export const blsVectors=Object.fromEntries(raw.toString('utf8').split('\n').filter(line=>line.includes('=')).map(line=>line.split('=').map(part=>part.trim())));
