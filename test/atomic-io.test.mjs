import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {harness} from './harness.mjs';
import {mockSyscalls} from './durable-mock.mjs';
import {durableHostExports,durableTaskAdapter,runDurableTask} from '../durable-runtime.mjs';
import {createPosixHost} from '../runtime/posix.mjs';
const helper=readFileSync(new URL('./durable-io-oracle.ml',import.meta.url),'utf8').split('\nlet run = function\n');
assert.equal(helper.length,2);
const h=await harness({name:'atomic-io',sources:['lib/durable/io_ops.ml','lib/durable/io.ml','lib/durable/atomic_file.ml'],
  modules:['io_ops.ml','io.ml','atomic_file.ml','io_fixture_helpers.ml'],extraAliases:{'io_fixture_helpers.ml':helper[0]},
  packages:'unix,digestif.c',oracle:'test/atomic-io-oracle.ml',fixtures:['test/atomic-io.kan'],exports:['atomicIoTestStart',...durableHostExports]});
const adapter=durableTaskAdapter(h.e),hex=value=>Buffer.from(value).toString('hex')||'-',raw=value=>Buffer.from(value==='-'?'':value,'hex');
const meta=h.runOracle([],'meta absent\n');assert.equal(meta.status,0,meta.stderr);
const fault={kind:'unix',errno:'ENOENT',message:Buffer.from(meta.stdout.trim(),'hex')};
const row=(op,{dir='root',name='checkpoint',magic='TNCKPT01',format='1',generation='7',payload='data',counts='-',failures='-'}={})=>
  [String(op),hex(dir),hex(name),hex(magic),String(format),String(generation),hex(payload),counts,failures,'absent'];
const start=([op,dir,name,magic,format,generation,payload])=>h.e.atomicIoTestStart(Number(op),h.toBytes(raw(dir)),h.toBytes(raw(name)),
  h.toBytes(raw(magic)),h.toBytes(format),h.toBytes(generation),h.toBytes(raw(payload)));
function evaluate(input) {
  const host=mockSyscalls({payload:raw(input[6]),counts:input[7],failures:input[8],fault});
  let task=start(input);
  while(!adapter.done(task)) {assert.ok(host.trace.length<10000);task=adapter.reply(task,host.dispatch(adapter.request(task)));}
  const result=adapter.result(task);
  return `${result.value.toString()}#${result.fsyncs}:${result.bytesWritten}#${host.trace.join('~')}`;
}
const container=(payload,generation=7n)=>{
  const body=Buffer.from(payload),header=Buffer.alloc(32);Buffer.from('TNCKPT01').copy(header);
  header.writeUInt32BE(1,8);header.writeBigUInt64BE(generation,12);header.writeUInt32BE(body.length,20);
  createHash('blake2b512').update(body).digest().copy(header,24,0,8);return Buffer.concat([header,body]);
};
test('Atomic save validates before I/O and preserves write, flush, close, rename and directory flush order',()=>{
  const rows=[];
  for(const payload of ['', 'data',Buffer.alloc(65,255)]) for(const counts of ['-','1,2,3','1,0','-1','999']) {
    rows.push(row(0,{payload,counts}));
    for(const failures of ['unlink:1','open:1','write:1','write:2','fsync:1','close:1','rename:1','open:2','fsync:2','close:2','write:1,close:1','fsync:1,close:1'])
      rows.push(row(0,{payload,counts,failures}));
  }
  for(const magic of ['', 'short','TNCKPT01']) for(const format of ['-1','0','4294967295','4294967296'])
    for(const generation of ['-1','0','4611686018427387903']) rows.push(row(0,{magic,format,generation}));
  for(const dir of ['', '/', 'a/', 'a//b']) for(const name of ['', '/x','a/b']) rows.push(row(0,{dir,name}));
  h.compare(rows,evaluate);
  assert.match(evaluate(row(0)),/^ok#2:36#unlink\|.*~open\|.*~write\|.*~fsync\|.*~close\|.*~rename\|.*~open\|.*~fsync\|.*~close\|/);
  assert.match(evaluate(row(0,{magic:'bad'})),/^error:.*#0:0#$/);
});
test('Load sweeps stale temporary files, distinguishes absence, and decodes only the canonical container',()=>{
  const rows=[];
  for(const op of [1,2]) for(const failures of ['-','stat:1','unlink:1','stat:2','open:1','lseek:1','lseek:2','read:1','close:1','read:1,close:1'])
    for(const payload of [Buffer.alloc(0),container('data'),container('other',0n)]) rows.push(row(op,{payload,failures}));
  const encoded=container('data');
  for(let length=0;length<encoded.length;length++) rows.push(row(1,{payload:encoded.subarray(0,length)}));
  for(const offset of [0,8,12,20,24,32]) {const corrupt=Buffer.from(encoded);corrupt[offset]^=255;rows.push(row(1,{payload:corrupt}));}
  h.compare(rows,evaluate);
  assert.match(evaluate(row(1,{failures:'stat:2'})),/^none#0:0#/);
  assert.match(evaluate(row(1,{payload:container('data')})),/^7:64617461#0:0#/);
});
test('Disk failure at every publication stage leaves a complete old or new canonical file',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'telcoin-atomic-')),host=createPosixHost();
  t.after(async()=>{try{await host.close();}finally{await rm(directory,{recursive:true,force:true});}});
  const path=join(directory,'checkpoint'),temp=path+'.tmp',old=container('old',3n),fresh=container('new',7n);
  for(const failure of ['-','unlink:1','open:1','write:1','fsync:1','close:1','rename:1','open:2','fsync:2','close:2']) {
    await writeFile(path,old);await writeFile(temp,'stale');
    const hits=new Map();let renamed=false;
    const dispatch=async request=>{
      hits.set(request.op,(hits.get(request.op)??0)+1);
      if(`${request.op}:${hits.get(request.op)}`===failure) return fault;
      const reply=await host.dispatch(request);
      if(request.op==='rename'&&reply.kind==='ok') renamed=true;
      return reply;
    };
    const result=await runDurableTask(h.e,start(row(0,{dir:directory,payload:'new'})),dispatch);
    assert.equal(result.value.toString().startsWith('error:'),failure!=='-',failure);
    assert.deepEqual(await readFile(path),renamed?fresh:old,failure);
    const loaded=await runDurableTask(h.e,start(row(1,{dir:directory})),host.dispatch);
    assert.equal(loaded.value.toString(),renamed?'7:6e6577':'3:6f6c64',failure);
    await assert.rejects(readFile(temp),{code:'ENOENT'});
  }
});
