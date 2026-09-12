import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {harness,header,sequence,u64} from './harness.mjs';
import {durableDiskOracleSources} from './durable-disk-oracle-sources.mjs';
import {mockSyscalls} from './durable-mock.mjs';
import {durableHostExports,durableTaskAdapter,runDurableTask} from '../durable-runtime.mjs';
import {createPosixHost} from '../runtime/posix.mjs';
const helpers={};
for(const [file,separator,name] of [['durable-io-oracle.ml','\nlet run = function\n','io_fixture_helpers.ml'],
  ['execution-oracle.ml','\nlet store_run ','execution_fixture_helpers.ml']]) {
  const parts=readFileSync(new URL(file,import.meta.url),'utf8').split(separator);assert.equal(parts.length,2);helpers[name]=parts[0];
}
const h=await harness({name:'checkpoint-file',...durableDiskOracleSources,
  modules:[...durableDiskOracleSources.modules,...Object.keys(helpers)],extraAliases:{...durableDiskOracleSources.extraAliases,...helpers},
  oracle:'test/checkpoint-file-oracle.ml',fixtures:['test/execution.kan','test/disk-store.kan','test/checkpoint-file.kan'],
  exports:['checkpointFileTestStart','checkpointFileTestDecode','checkpointFileTestLive',...durableHostExports]});
const adapter=durableTaskAdapter(h.e),hex=value=>Buffer.from(value).toString('hex')||'-',raw=value=>Buffer.from(value==='-'?'':value,'hex');
const oracle=command=>{const result=h.runOracle([],command+'\n');assert.equal(result.status,0,result.stderr);assert.ok(!result.stdout.startsWith('fixture:'),result.stdout);return result.stdout.trim();};
const origin=oracle('origin'),fault={kind:'unix',errno:'ENOENT',message:raw(oracle('meta absent'))};
const dag=time=>sequence([header({seed:1,epoch:0,round:time,time})])+'0000'+u64(time)+'20'+'00'.repeat(32);
const records=oracle(`records ${sequence([dag(1),dag(2),dag(3)])}`).split(','),other=oracle(`records ${sequence([dag(4)])}`).split(',')[0];
const word=n=>BigInt(n).toString(16).padStart(64,'0'),addr=n=>BigInt(n).toString(16).padStart(40,'0');
const committee=u64(0n)+sequence(['20'+word(1)+addr(1),'20'+word(2)+addr(2)]);
const persisted='00'+word(0)+word(0)+u64(30000000n)+'00'+word(0)+'00'+'0000'+'00'+u64(1000n)+committee;
const checkpoint=record=>persisted+(record?'01'+record.slice(0,-2):'00');
const fresh=checkpoint(),one=checkpoint(records[0]),two=checkpoint(records[1]),foreign=checkpoint(other);
const canonical=value=>{const result=oracle(`decode ${value} 7`);assert.match(result,/^7:[0-9a-f]+$/);return result.slice(2);};
const canonicalFresh=canonical(fresh),canonicalOne=canonical(one);
const container=(payload,generation=1n)=>{
  const body=raw(payload),header=Buffer.alloc(32);Buffer.from('TNCKPT\0\0').copy(header);header.writeUInt32BE(1,8);
  header.writeBigUInt64BE(generation,12);header.writeUInt32BE(body.length,20);
  createHash('blake2b512').update(body).digest().copy(header,24,0,8);return Buffer.concat([header,body]);
};
const bytesList=values=>values.reduceRight((tail,value)=>h.e.seqBytesCons(h.toBytes(raw(value)),tail),h.e.seqBytesEmpty());
const row=(op,{dir='root',frames=[],value=fresh,generation='2',initial=container(fresh),counts='-',failures='-'}={})=>
  [String(op),hex(dir),origin,frames.join(',')||'-',value,String(generation),hex(initial),counts,failures,'absent'];
const start=([op,dir,identity,frames,value,generation])=>h.e.checkpointFileTestStart(Number(op),h.toBytes(raw(dir)),h.toBytes(raw(identity)),
  bytesList(frames==='-'?[]:frames.split(',')),h.toBytes(raw(value)),h.toBytes(generation));
function evaluate(input) {
  if(input[0]==='decode') return h.text(h.e.checkpointFileTestDecode(h.toBytes(raw(input[1])),h.toBytes(input[2])));
  const host=mockSyscalls({payload:raw(input[6]),counts:input[7],failures:input[8],fault});let task=start(input);
  while(!adapter.done(task)) {assert.ok(host.trace.length<10000);task=adapter.reply(task,host.dispatch(adapter.request(task)));}
  const result=adapter.result(task);return `${result.value.toString()}#${result.fsyncs}:${result.bytesWritten}#${host.trace.join('~')}`;
}
test('Checkpoint watermarks and record digests are checked before filesystem access',()=>{
  const rows=[];
  for(const op of [0,2,3]) for(const value of [fresh,one,two,foreign])
    for(const frames of [[],['01'+records[0]],records.slice(0,2).map(record=>'01'+record)]) rows.push(row(op,{value,frames}));
  h.compare(rows,evaluate);
  assert.match(evaluate(row(0,{value:one})),/^error:checkpoint: last executed 1 is above.*#0:0#$/);
  assert.match(evaluate(row(0,{value:foreign,frames:['01'+records[0]]})),/^error:checkpoint: the store holds no such block.*#0:0#$/);
});
test('Generation advances strictly, container errors are distinct from absence, and save flushes twice',()=>{
  const rows=[];
  for(const op of [0,1,5]) for(const initial of [Buffer.alloc(0),container(fresh,0n),container(fresh,1n),container(fresh,4611686018427387902n),
    container(fresh,4611686018427387903n),container('ff',1n)])
    for(const failures of ['-','stat:1','stat:2','open:1','read:1','write:1','fsync:1','rename:1','fsync:2']) rows.push(row(op,{initial,failures}));
  for(const generation of ['-1','0','1','4611686018427387903']) rows.push(row(6,{generation}));
  h.compare(rows,evaluate);
  assert.match(evaluate(row(0,{initial:container(fresh,4611686018427387903n)})),/^error:checkpoint: generation 4611686018427387903 does not advance/);
  assert.match(evaluate(row(0,{failures:'stat:2'})),/^1#2:/);
  assert.match(evaluate(row(1,{failures:'stat:2'})),/^none#0:0#/);
});
test('Checkpoint payload decoding rejects truncations and preserves exact trailing counts',()=>{
  const rows=[];
  for(const value of [fresh,one]) {
    rows.push(['decode',value,'7'],['decode',value+'ff','7'],['decode',value+'000102','7']);
    for(let length=0;length<value.length/2;length++) rows.push(['decode',value.slice(0,length*2)||'-','7']);
  }
  rows.push(['decode','ff','0']);h.compare(rows,evaluate);
  assert.match(evaluate(['decode',fresh+'ff','7']),/^error:checkpoint payload: 1 byte/);
});
test('Real checkpoint publication increments generation and refuses an ahead or foreign checkpoint without writes',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'telcoin-checkpoint-')),host=createPosixHost(),path=join(directory,'checkpoint');
  t.after(async()=>{try{await host.close();}finally{await rm(directory,{recursive:true,force:true});}});
  const run=(op,options={})=>runDurableTask(h.e,start(row(op,{dir:directory,...options})),host.dispatch);
  const first=await run(0);assert.equal(first.value.toString(),'1');assert.equal(first.fsyncs,2n);
  assert.deepEqual(await readFile(path),container(canonicalFresh,1n));
  const second=await run(0,{frames:['01'+records[0]],value:one});assert.equal(second.value.toString(),'2');assert.equal(second.fsyncs,2n);
  const before=await readFile(path);
  for(const options of [{value:two,frames:['01'+records[0]]},{value:foreign,frames:['01'+records[0]]}]) {
    const refused=await run(0,options);assert.match(refused.value.toString(),/^error:checkpoint:/);assert.equal(refused.fsyncs,0n);assert.equal(refused.bytesWritten,0n);
    assert.deepEqual(await readFile(path),before);
  }
  await writeFile(path+'.tmp','interrupted checkpoint');
  const loaded=await run(1);assert.equal(loaded.value.toString(),'2:'+canonicalOne);await assert.rejects(readFile(path+'.tmp'),{code:'ENOENT'});
  await writeFile(path,container(fresh,4611686018427387903n));
  const saturated=await run(0);assert.match(saturated.value.toString(),/does not advance/);assert.equal(saturated.fsyncs,0n);assert.equal(saturated.bytesWritten,0n);
});
test('A live disk handle keeps its own append counters across checkpoint publication and reopen',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'telcoin-checkpoint-live-')),host=createPosixHost();
  t.after(async()=>{try{await host.close();}finally{await rm(directory,{recursive:true,force:true});}});
  const run=(actions,value)=>runDurableTask(h.e,h.e.checkpointFileTestLive(h.toBytes(directory),h.toBytes(raw(origin)),
    bytesList(actions),h.toBytes(raw(value))),host.dispatch);
  const first=await run(['00'+records[0]],one);
  const fields=first.value.toString().split('|');assert.equal(fields.length,4,first.value.toString());
  assert.equal(fields[0],fields[2]);assert.match(fields[0],/^1:/);assert.equal(fields[1],'1');assert.equal(fields[3],'ok');
  assert.equal(first.fsyncs,5n);assert.deepEqual(await readFile(join(directory,'checkpoint')),container(canonicalOne,1n));
  const reopened=await run(['00'+records[0]],one);
  assert.equal(reopened.value.toString(),'0:0|2|0:0|ok');assert.equal(reopened.fsyncs,2n);
  const ahead=await run([],two);assert.match(ahead.value.toString(),/^0:0\|error:checkpoint: last executed 2 is above.*\|0:0\|ok$/);
  assert.equal(ahead.fsyncs,0n);assert.equal(ahead.bytesWritten,0n);
  const advanced=await run(['00'+records[1]],two);const later=advanced.value.toString().split('|');
  assert.equal(later[0],later[2]);assert.match(later[0],/^1:/);assert.equal(later[1],'3');assert.equal(later[3],'ok');assert.equal(advanced.fsyncs,3n);
});
