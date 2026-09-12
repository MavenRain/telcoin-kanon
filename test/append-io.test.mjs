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
const helper=readFileSync(new URL('./durable-io-oracle.ml',import.meta.url),'utf8').split('\nlet run = function\n');assert.equal(helper.length,2);
const h=await harness({name:'append-io',sources:['lib/durable/io_ops.ml','lib/durable/io.ml','lib/durable/frame.ml','lib/durable/store_lock.ml','lib/durable/append_log.ml'],
  modules:['io_ops.ml','io.ml','frame.ml','store_lock.ml','append_log.ml','io_fixture_helpers.ml'],extraAliases:{'io_fixture_helpers.ml':helper[0]},
  packages:'unix,digestif.c',oracle:'test/append-io-oracle.ml',fixtures:['test/append-io.kan'],exports:['appendIoTestStart',...durableHostExports]});
const adapter=durableTaskAdapter(h.e),hex=value=>Buffer.from(value).toString('hex')||'-',raw=value=>Buffer.from(value==='-'?'':value,'hex');
const meta=h.runOracle([],'meta absent\nmeta contended\n');assert.equal(meta.status,0,meta.stderr);
const messages=meta.stdout.trim().split('\n').map(value=>Buffer.from(value,'hex'));
const header=Buffer.alloc(64);Buffer.from('TNCSLOG\0').copy(header);header.writeUInt32BE(1,8);header.writeUInt32BE(64,12);
const tag=bytes=>createHash('blake2b512').update(bytes).digest().subarray(0,8);
const frame=(payload,sequence=0n,kind=1)=>{
  const body=Buffer.from(payload),prefix=Buffer.alloc(16),echo=Buffer.alloc(4);
  prefix.writeUInt32BE(body.length);prefix[4]=kind;prefix.writeBigUInt64BE(sequence,8);echo.writeUInt32BE(body.length);
  return Buffer.concat([prefix,tag(prefix),body,tag(body),echo,Buffer.from('TNCE')]);
};
const row=(op,{dir='root',wanted=header,kind=1,payload='data',retry='retry',initial=header,counts='-',failures='-',code='absent'}={})=>
  [String(op),hex(dir),hex(wanted),String(kind),hex(payload),hex(retry),hex(initial),counts,failures,code];
const start=([op,dir,wanted,kind,payload,retry])=>h.e.appendIoTestStart(Number(op),h.toBytes(raw(dir)),h.toBytes(raw(wanted)),Number(kind),h.toBytes(raw(payload)),h.toBytes(raw(retry)));
function evaluate(input) {
  const code=input[9],host=mockSyscalls({payload:raw(input[6]),counts:input[7],failures:input[8],
    fault:{kind:'unix',errno:code==='absent'?'ENOENT':'EAGAIN',message:messages[code==='absent'?0:1]}});
  let task=start(input);
  while(!adapter.done(task)) {assert.ok(host.trace.length<10000);task=adapter.reply(task,host.dispatch(adapter.request(task)));}
  const result=adapter.result(task);return `${result.value.toString()}#${result.fsyncs}:${result.bytesWritten}#${host.trace.join('~')}`;
}
test('Create and clean adoption preserve flush counts, lock cleanup and open-time error order',()=>{
  const rows=[];
  for(const creating of [false,true]) {
    const base=creating?'stat:1':'-';
    rows.push(row(0,{failures:base}));
    for(const failure of ['mkdir:1','realpath:1','open:1','lockf:1','stat:1','unlink:1','open:2','write:1','fsync:1',
      'close:1','rename:1','open:3','fsync:2','close:2','open:4','lseek:1','lseek:2','read:1','close:3','read:1,close:1'])
      rows.push(row(0,{failures:creating?base+','+failure:failure}));
  }
  for(const length of [0,1,63,65]) rows.push(row(0,{wanted:Buffer.alloc(length)}));
  for(const initial of [Buffer.alloc(0),header.subarray(0,63)]) rows.push(row(0,{initial}));
  for(const offset of [0,8,12,16,24,32]) {const initial=Buffer.from(header);initial[offset]^=128;rows.push(row(0,{initial}));}
  rows.push(row(0,{failures:'lockf:1',code:'contended'}));
  h.compare(rows,evaluate);
  assert.match(evaluate(row(0,{failures:'stat:1'})),/^64:0;clean;0;;ok;0#2:64#/);
  assert.match(evaluate(row(0)),/^64:0;clean;0;;ok;0#0:0#/);
});
test('Torn tails heal at the last complete frame and interior damage never truncates',()=>{
  const first=frame('a'),second=frame('bb',1n,2),third=frame('ccc',2n),rows=[];
  for(let length=0;length<second.length;length++) rows.push(row(0,{initial:Buffer.concat([header,first,second.subarray(0,length)])}));
  for(const offset of [0,4,16,24,second.length-5,second.length-1]) {
    const damaged=Buffer.from(second);damaged[offset]^=128;
    rows.push(row(0,{initial:Buffer.concat([header,first,damaged])}),row(0,{initial:Buffer.concat([header,first,damaged,third])}));
  }
  for(const failures of ['ftruncate:1','fsync:1','open:3','fsync:2','close:1','close:2','ftruncate:1,close:1'])
    rows.push(row(0,{initial:Buffer.concat([header,first,Buffer.from('torn')]),failures}));
  rows.push(row(0,{initial:Buffer.concat([header,first,second,third])}));
  h.compare(rows,evaluate);
  const corrupt=Buffer.concat([header,first,Buffer.from('junk'),third]);
  const result=evaluate(row(0,{initial:corrupt}));assert.match(result,/committed frames continue/);assert.ok(!result.includes('ftruncate|'));
});
test('Appends advance only after flush and retries overwrite the prior durable offset',()=>{
  const rows=[];
  for(const kind of [1,2]) for(const payload of ['', 'a', 'payload']) for(const failures of ['-','lseek:3','write:1','fsync:1','close:1','close:2'])
    rows.push(row(2,{kind,payload,failures}));
  for(const counts of ['64,1,0','64,1,1,0','64,0','64,-1','64,999','64,1,999']) rows.push(row(2,{counts}));
  for(const initial of [Buffer.concat([header,frame('old')]),Buffer.concat([header,frame('old'),Buffer.from('tail')])])
    rows.push(row(2,{initial}));
  h.compare(rows,evaluate);
  const result=evaluate(row(2,{failures:'fsync:1'}));
  assert.match(result,/error:fsync failed.*;109:1;ok;0#1:89#/);
  const seeks=result.match(/lseek\|37,3634,736574/g);assert.equal(seeks?.length,2);
});
test('Actual disk healing, safe retry and corruption refusal retain the expected bytes',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'telcoin-log-')),host=createPosixHost(),path=join(directory,'consensus.log');
  t.after(async()=>{try{await host.close();}finally{await rm(directory,{recursive:true,force:true});}});
  const run=(input,dispatch=host.dispatch)=>runDurableTask(h.e,start(input),dispatch);
  const created=await run(row(0,{dir:directory}));assert.equal(created.fsyncs,2n);assert.deepEqual(await readFile(path),header);
  const appended=await run(row(1,{dir:directory,payload:'a'}));assert.equal(appended.fsyncs,1n);
  const clean=Buffer.concat([header,frame('a')]);assert.deepEqual(await readFile(path),clean);
  const partial=frame('bb',1n,2).subarray(0,13);await writeFile(path,Buffer.concat([clean,partial]));
  const healed=await run(row(0,{dir:directory}));assert.equal(healed.fsyncs,2n);assert.match(healed.value.toString(),/torn:105:13/);
  assert.deepEqual(await readFile(path),clean);
  let writes=0;
  const retry=await run(row(2,{dir:directory,payload:'first',retry:'retry'}),async request=>{
    if(request.op==='write'&&++writes===1) {
      const args=[...request.args];args[2]=Buffer.from('3');return host.dispatch({...request,args});
    }
    if(request.op==='write'&&writes===2) return {kind:'ok',scalar:'0'};
    return host.dispatch(request);
  });
  assert.match(retry.value.toString(),/short write/);assert.equal(retry.fsyncs,1n);
  assert.deepEqual(await readFile(path),Buffer.concat([clean,frame('retry',1n)]));
  const damaged=Buffer.concat([clean,Buffer.from('broken'),frame('later',2n)]);await writeFile(path,damaged);
  const refused=await run(row(0,{dir:directory}));assert.match(refused.value.toString(),/committed frames continue/);assert.equal(refused.fsyncs,0n);
  assert.deepEqual(await readFile(path),damaged);
  await writeFile(path,clean);assert.match((await run(row(0,{dir:directory}))).value.toString(),/^105:1;clean/);
});
