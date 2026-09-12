import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,open,readFile,realpath,rm,stat,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {harness} from './harness.mjs';
import {durableHostExports,runDurableTask} from '../durable-runtime.mjs';
import {createPosixHost} from '../runtime/posix.mjs';
const h=await harness({name:'durable-io',sources:['lib/durable/io_ops.ml','lib/durable/io.ml'],
  modules:['io_ops.ml','io.ml'],packages:'unix',oracle:'test/durable-io-oracle.ml',
  fixtures:['test/durable-io.kan'],exports:['durableIoTestStart',...durableHostExports]});
const request=(host,op,args,body=Buffer.alloc(0))=>host.dispatch({op,args:args.map(x=>Buffer.isBuffer(x)?x:Buffer.from(String(x))),body});
const success=reply=>{assert.equal(reply.kind,'ok',reply.message?.toString());return reply;};
async function context(t) {
  const directory=await mkdtemp(join(tmpdir(),'telcoin-posix-')),host=createPosixHost();
  t.after(async()=>{try{await host.close();}finally{await rm(directory,{recursive:true,force:true});}});
  return {directory,host};
}
async function execute(host,op,path,payload='',at='0',length='0') {
  return runDurableTask(h.e,h.e.durableIoTestStart(op,h.toBytes(path),h.toBytes(payload),h.toBytes(at),h.toBytes(length)),host.dispatch);
}
test('Kanon performs private file creation, durable flush, reads, rename and removal on disk',async t=>{
  const {directory,host}=await context(t),parent=join(directory,'nested','data'),path=join(parent,'value');
  assert.equal((await execute(host,11,parent)).value.toString(),'ok');
  assert.equal((await stat(parent)).mode&0o777,0o700);
  const payload=Buffer.from([0,255,128,65,0,10]);
  const written=await execute(host,16,path,payload);
  assert.equal(written.value.toString(),'ok');assert.equal(written.bytesWritten,6n);
  assert.deepEqual(await readFile(path),payload);assert.equal((await stat(path)).mode&0o777,0o600);
  const flushed=await execute(host,17,path);
  assert.equal(flushed.value.toString(),'ok');assert.equal(flushed.fsyncs,1n);assert.equal(flushed.bytesWritten,0n);
  const read=await execute(host,15,path);
  assert.equal(read.value.toString(),payload.toString('hex'));
  const short=await execute(host,18,path,'','4','4');
  assert.match(short.value.toString(),/short read.*wanted 4 bytes, got 2$/);
  const dst=join(parent,'renamed');
  assert.equal((await execute(host,10,path,dst)).value.toString(),'ok');
  const flushedDirectory=await execute(host,9,parent);
  assert.equal(flushedDirectory.value.toString(),'ok');assert.equal(flushedDirectory.fsyncs,1n);
  assert.equal((await execute(host,13,path)).value.toString(),'false');
  assert.equal((await execute(host,13,dst)).value.toString(),'true');
  assert.equal((await execute(host,12,dst)).value.toString(),'ok');
  assert.equal((await execute(host,12,dst)).value.toString(),'ok');
});
test('POSIX descriptor operations preserve offsets, truncation, binary paths and strict stat errors',async t=>{
  const {directory,host}=await context(t),path=Buffer.from(directory+'/données');
  const descriptor=success(await request(host,'open',[path,384,2,3])).scalar;
  assert.equal(success(await request(host,'write',[descriptor,1,3],Buffer.from('xabcx'))).scalar.toString(),'3');
  assert.equal(success(await request(host,'lseek',[descriptor,0,'end'])).scalar.toString(),'3');
  success(await request(host,'ftruncate',[descriptor,2]));
  assert.equal(success(await request(host,'lseek',[descriptor,0,'set'])).scalar.toString(),'0');
  const read=success(await request(host,'read',[descriptor,1,3],Buffer.from('xxxxx')));
  assert.equal(read.scalar.toString(),'2');assert.equal(read.body.toString(),'xabxx');
  assert.equal((await request(host,'read',[descriptor,4,2],Buffer.alloc(5))).kind,'sys');
  success(await request(host,'fsync',[descriptor]));success(await request(host,'close',[descriptor]));
  assert.equal((await request(host,'close',[descriptor])).errno,'EBADF');
  assert.equal((await request(host,'close',['1'])).errno,'EBADF');
  assert.deepEqual(await readFile(path),Buffer.from('ab'));
  const canonical=await realpath(path,{encoding:'buffer'});
  assert.deepEqual(success(await request(host,'realpath',[path])).body,canonical);
  const notDirectory=Buffer.concat([path,Buffer.from('/child')]);
  assert.equal((await execute(host,13,notDirectory)).value.toString(),'false');
  assert.match((await execute(host,14,notDirectory)).value.toString(),/^error:realpath failed/);
  const link=join(directory,'link');await symlink(path,link);
  assert.deepEqual(success(await request(host,'realpath',[link])).body,canonical);
  for(const suffix of ['/', '/.', '/..']) {
    const candidate=Buffer.concat([path,Buffer.from(suffix)]);
    const reference=h.runOracle([],`realpath ${candidate.toString('hex')}\n`);assert.equal(reference.status,0,reference.stderr);
    const result=await execute(host,14,candidate),value=result.value.toString();
    const formatted=value.startsWith('error:')?'error:'+Buffer.from(value.slice(6)).toString('hex'):'ok:'+value;
    assert.equal(formatted,reference.stdout.trim(),suffix);
  }
});
test('Process-owned advisory locks exclude another helper and release at session shutdown',async t=>{
  const {directory,host}=await context(t),other=createPosixHost(),path=join(directory,'lock');
  t.after(()=>other.close());
  const first=success(await request(host,'open',[path,384,2,3])).scalar;
  const second=success(await request(other,'open',[path,384,2,3])).scalar;
  success(await request(host,'lockf',[first,'try-lock',0]));
  const blocked=await request(other,'lockf',[second,'try-lock',0]);
  assert.equal(blocked.kind,'unix');assert.ok(['EAGAIN','EACCES'].includes(blocked.errno));
  success(await request(host,'lockf',[first,'unlock',0]));
  success(await request(other,'lockf',[second,'try-lock',0]));
  await other.close();
  success(await request(host,'lockf',[first,'try-lock',0]));
  await host.close();
  await assert.rejects(request(host,'stat',[path]),/closed/);
});
test('Non-UTF8 path bytes reach the filesystem with its native acceptance or refusal',async t=>{
  const {directory,host}=await context(t),path=Buffer.concat([Buffer.from(directory+'/'),Buffer.from([0xff,0xfe])]);
  const native=await open(path,'a+',0o600).then(handle=>({handle}),error=>({error}));
  const reply=await request(host,'open',[path,384,2,3]);
  if(native.error) {assert.equal(reply.kind,'unix');assert.equal(reply.errno,native.error.code);}
  else {await native.handle.close();success(reply);success(await request(host,'close',[reply.scalar]));}
});
test('Transport startup failure is reported to every pending request',async()=>{
  const host=createPosixHost({python:'/tn-durable-faults-no-such-root/python'});
  await assert.rejects(request(host,'stat',['/']),/ENOENT/);
  await assert.rejects(host.close(),/ENOENT/);
});
