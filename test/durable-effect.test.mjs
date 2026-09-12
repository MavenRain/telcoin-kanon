import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {build,project} from '../scripts/build.mjs';
import {byteAdapter} from '../runtime.mjs';
const directory=mkdtempSync(join(tmpdir(),'telcoin-durable-effect-'));
after(()=>rmSync(directory,{recursive:true,force:true}));
const wasm=join(directory,'effect.wasm');
build(wasm,['emptyBytes','consBytes','bytesEmpty','bytesHead','bytesTail','durableTaskIsDone',
  'durableEffectTestStart','durableEffectTestRequest','durableEffectTestFinish','durableEffectTestOk','durableEffectTestError'],
  ['test/durable-effect.kan'].map(path=>resolve(project,path)),{scope:true});
const {instance}=await WebAssembly.instantiate(readFileSync(wasm),{}),e=instance.exports;
const {toBytes,fromBytes}=byteAdapter(e),text=value=>fromBytes(value).toString('utf8');
test('Typed continuations preserve captured values and counters across host requests',()=>{
  const first=e.durableEffectTestStart(toBytes('demo'));
  assert.equal(e.durableTaskIsDone(first),0);
  assert.equal(text(e.durableEffectTestRequest(first)),'read:demo;:');
  const second=e.durableEffectTestOk(first,toBytes('42'),toBytes('abc'));
  assert.equal(text(e.durableEffectTestRequest(second)),'fsync:42;:abc');
  const done=e.durableEffectTestOk(second,toBytes(''),toBytes('z'));
  assert.equal(e.durableTaskIsDone(done),1);
  assert.equal(text(e.durableEffectTestFinish(done)),'1:3:abcz');
  assert.equal(text(e.durableEffectTestRequest(first)),'read:demo;:');
});
test('Failed replies stop dependent effects and completed tasks absorb further replies',()=>{
  const first=e.durableEffectTestStart(toBytes('demo'));
  const failed=e.durableEffectTestError(first,toBytes('read failed'));
  assert.equal(e.durableTaskIsDone(failed),1);
  assert.equal(text(e.durableEffectTestFinish(failed)),'0:0:error:read failed');
  const second=e.durableEffectTestOk(first,toBytes('42'),toBytes('abc'));
  const failedFlush=e.durableEffectTestError(second,toBytes('flush failed'));
  assert.equal(text(e.durableEffectTestFinish(failedFlush)),'1:3:error:flush failed');
  assert.equal(text(e.durableEffectTestFinish(e.durableEffectTestOk(failedFlush,toBytes(''),toBytes('ignored')))),
    '1:3:error:flush failed');
});
