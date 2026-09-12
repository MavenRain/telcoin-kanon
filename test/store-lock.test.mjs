import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {harness} from './harness.mjs';
import {mockSyscalls} from './durable-mock.mjs';
import {durableHostExports,durableTaskAdapter,runDurableTask} from '../durable-runtime.mjs';
import {createPosixHost} from '../runtime/posix.mjs';
const helper=readFileSync(new URL('./durable-io-oracle.ml',import.meta.url),'utf8').split('\nlet run = function\n');assert.equal(helper.length,2);
const h=await harness({name:'store-lock',sources:['lib/durable/io_ops.ml','lib/durable/io.ml','lib/durable/store_lock.ml'],
  modules:['io_ops.ml','io.ml','store_lock.ml','io_fixture_helpers.ml'],extraAliases:{'io_fixture_helpers.ml':helper[0]},
  packages:'unix',oracle:'test/store-lock-oracle.ml',fixtures:['test/store-lock.kan'],exports:['storeLockTestStart',...durableHostExports]});
const adapter=durableTaskAdapter(h.e),hex=value=>Buffer.from(value).toString('hex')||'-';
const codes={absent:'ENOENT',contended:'EAGAIN'},meta=h.runOracle([],'meta absent\nmeta contended\n');assert.equal(meta.status,0,meta.stderr);
const messages=meta.stdout.trim().split('\n').map(value=>Buffer.from(value,'hex'));
function evaluate([dir,alias,failures,code]) {
  const host=mockSyscalls({payload:Buffer.alloc(0),failures,fault:{kind:'unix',errno:codes[code],message:messages[code==='absent'?0:1]}});
  let task=h.e.storeLockTestStart(h.raw(dir),h.raw(alias));
  while(!adapter.done(task)) {
    assert.ok(host.trace.length<100);const request=adapter.request(task),reply=host.dispatch(request);
    if(request.op==='realpath'&&reply.kind==='ok') reply.body=Buffer.from('/canonical');
    task=adapter.reply(task,reply);
  }
  const result=adapter.result(task);assert.equal(result.fsyncs,0n);assert.equal(result.bytesWritten,0n);
  return result.value.toString()+'#'+host.trace.join('~');
}
test('Canonical root registration, lock refusals, descriptor cleanup and release match OCaml',()=>{
  const rows=[];
  for(const code of Object.keys(codes)) for(const failures of ['-','realpath:1','realpath:2','realpath:3','open:1','open:2','open:3',
    'lockf:1','lockf:2','lockf:3','close:1','close:2','close:3','lockf:1,close:1','lockf:2,close:2'])
    rows.push([hex('root'),hex('alias'),failures,code]);
  h.compare(rows,evaluate);
  assert.match(evaluate([hex('root'),hex('alias'),'-','absent']),/^ok;error:.*another handle already holds this root;ok;none;ok;ok;0#/);
});
test('Symlink aliases contend within one Kanon session and released roots can be reacquired',async t=>{
  const root=await mkdtemp(join(tmpdir(),'telcoin-lock-')),alias=root+'-alias',host=createPosixHost();await symlink(root,alias);
  t.after(async()=>{try{await host.close();}finally{await rm(alias);await rm(root,{recursive:true,force:true});}});
  const calls=[];
  const result=await runDurableTask(h.e,h.e.storeLockTestStart(h.toBytes(root),h.toBytes(alias)),request=>{
    calls.push(request.op);return host.dispatch(request);
  });
  assert.match(result.value.toString(),/^ok;error:.*another handle already holds this root;ok;none;ok;ok;0$/);
  assert.deepEqual(calls,['realpath','open','lockf','realpath','close','realpath','open','lockf','close']);
});
