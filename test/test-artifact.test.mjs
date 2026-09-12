import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {reusableTestArtifact} from '../scripts/test-artifact.mjs';

function fixture(t) {
  const directory=mkdtempSync(join(tmpdir(),'telcoin-artifact-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const bytes=Buffer.from([0,97,115,109,1,0,0,0]);
  const digest=createHash('sha256').update(bytes).digest('hex');
  const path=join(directory,`fixture-${digest}.wasm`);
  const options={directory,name:'fixture',compiler:'compiler-pin',sourceSha:'closure-hash',exports:['a','b']};
  const metadata={compiler:options.compiler,sha256:options.sourceSha,exports:options.exports};
  writeFileSync(path,bytes);writeFileSync(`${path}.sources.json`,JSON.stringify(metadata));
  return {bytes,path,options,metadata};
}
test('Artifact reuse requires the current compiler, source closure and exact ordered exports',t=>{
  const {bytes,path,options}=fixture(t);
  assert.deepEqual(reusableTestArtifact(options),{path,bytes,digest:createHash('sha256').update(bytes).digest('hex')});
  for(const changes of [{compiler:'changed'},{sourceSha:'changed'},{exports:['b','a']},{exports:['a']},{exports:['a','b','c']},{name:'another'}])
    assert.equal(reusableTestArtifact({...options,...changes}),null);
});
test('Modified artifacts and missing or malformed provenance are rebuilt',t=>{
  const {bytes,path,options,metadata}=fixture(t);
  writeFileSync(path,Buffer.concat([bytes,Buffer.from([0])]));
  assert.equal(reusableTestArtifact(options),null);
  writeFileSync(path,bytes);
  for(const text of ['{','null','{}',JSON.stringify({...metadata,exports:'a,b'})]) {
    writeFileSync(`${path}.sources.json`,text);assert.equal(reusableTestArtifact(options),null);
  }
  rmSync(`${path}.sources.json`);assert.equal(reusableTestArtifact(options),null);
  assert.equal(reusableTestArtifact({...options,directory:join(options.directory,'missing')}),null);
});
