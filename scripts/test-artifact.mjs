import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';

export function reusableTestArtifact({directory,name,compiler,sourceSha,exports}) {
  let entries;
  try { entries=readdirSync(directory).sort(); } catch(error) {
    if(error.code==='ENOENT') return null;
    throw error;
  }
  for(const entry of entries) {
    if(!entry.startsWith(`${name}-`) || !entry.endsWith('.wasm')) continue;
    const digest=entry.slice(name.length+1,-5);
    if(!/^[a-f0-9]{64}$/.test(digest)) continue;
    const path=join(directory,entry);
    let metadata,bytes;
    try {
      metadata=JSON.parse(readFileSync(`${path}.sources.json`,'utf8'));
      if(metadata?.compiler!==compiler || metadata?.sha256!==sourceSha
          || !Array.isArray(metadata.exports) || metadata.exports.length!==exports.length
          || !metadata.exports.every((value,index)=>value===exports[index])) continue;
      bytes=readFileSync(path);
    } catch { continue; }
    if(createHash('sha256').update(bytes).digest('hex')!==digest) continue;
    return {path,bytes,digest};
  }
  return null;
}
