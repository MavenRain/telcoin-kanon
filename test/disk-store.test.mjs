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
const h=await harness({name:'disk-store',...durableDiskOracleSources,sortModules:true,
  modules:[...durableDiskOracleSources.modules,...Object.keys(helpers)],extraAliases:{...durableDiskOracleSources.extraAliases,...helpers},
  oracle:'test/disk-store-oracle.ml',fixtures:['test/execution.kan','test/disk-store.kan'],
  exports:['diskTestStart','diskTestReplay',...durableHostExports]});
const adapter=durableTaskAdapter(h.e),hex=value=>Buffer.from(value).toString('hex')||'-',raw=value=>Buffer.from(value==='-'?'':value,'hex');
const oracle=command=>{const result=h.runOracle([],command+'\n');assert.equal(result.status,0,result.stderr);assert.ok(!result.stdout.startsWith('fixture:'),result.stdout);return result.stdout.trim();};
const origin=oracle('origin'),parent=origin.slice(32),fault={kind:'unix',errno:'ENOENT',message:raw(oracle('meta absent'))};
const dag=(time,epoch=0)=>sequence([header({seed:1,epoch,round:time,time})])+'0000'+u64(time)+'20'+'00'.repeat(32);
const records=oracle(`records ${sequence([dag(1),dag(2),dag(3)])} 00`).split(',');
const other=oracle(`records ${sequence([dag(4),dag(5)])} 00`).split(',');
const epochRecord=oracle(`records ${sequence([dag(1),dag(2,1)])} 00`).split(',')[1];
const fileHeader=Buffer.concat([Buffer.from('TNCSLOG\0'),Buffer.from('0000000100000040','hex'),Buffer.alloc(16),raw(parent)]);
const tag=bytes=>createHash('blake2b512').update(bytes).digest().subarray(0,8);
const frame=(payload,seq=0n,kind=1)=>{
  const body=raw(payload),prefix=Buffer.alloc(16),echo=Buffer.alloc(4);prefix.writeUInt32BE(body.length);prefix[4]=kind;prefix.writeBigUInt64BE(seq,8);echo.writeUInt32BE(body.length);
  return Buffer.concat([prefix,tag(prefix),body,tag(body),echo,Buffer.from('TNCE')]);
};
const bytesList=values=>values.reduceRight((tail,value)=>h.e.seqBytesCons(h.toBytes(raw(value)),tail),h.e.seqBytesEmpty());
const joined=values=>values.join(',')||'-',split=value=>value==='-'?[]:value.split(',');
const receive=record=>'00'+record,openEpoch=n=>'01'+u64(n),reopenEpoch=n=>'02'+u64(n);
const row=(actions=[],{dir='root',initial=fileHeader,failures='-',counts='-',identity=origin}={})=>
  ['open',hex(dir),identity,joined(actions),hex(initial),counts,failures,'absent'];
const start=([,dir,identity,actions])=>h.e.diskTestStart(h.toBytes(raw(dir)),h.toBytes(raw(identity)),bytesList(split(actions)));
function evaluate(input) {
  if(input[0]==='replay') return h.text(h.e.diskTestReplay(h.toBytes(raw(input[1])),bytesList(split(input[2]))));
  const host=mockSyscalls({payload:raw(input[4]),counts:input[5],failures:input[6],fault});let task=start(input);
  while(!adapter.done(task)) {assert.ok(host.trace.length<1000);task=adapter.reply(task,host.dispatch(adapter.request(task)));}
  const result=adapter.result(task);return `${result.value.toString()}#${result.fsyncs}:${result.bytesWritten}#${host.trace.join('~')}`;
}
test('Replay reuses chain acceptance and reports record, metadata, sequence and byte-offset faults',()=>{
  const rows=[],add=entries=>rows.push(['replay',origin,joined(entries)]);
  add([]);add(records.map(record=>'01'+record));add(['01'+records[0],'01'+records[0]]);
  for(const record of [records[1],other[1],epochRecord]) add(['01'+record]);
  for(const record of [records[0],records[1]]) for(const length of [0,1,31,63,record.length/2-1]) add(['01'+record.slice(0,length*2)]);
  for(const record of [records[0],other[0]]) add(['01'+record,'01'+records[1]]);
  for(const epoch of [0n,1n,2n,4294967295n]) for(const startAt of [0n,1n,2n]) {
    add(['02'+u64(epoch)+u64(startAt)+parent]);
    add(['01'+records[0],'02'+u64(epoch)+u64(startAt)+parent]);
  }
  for(const bytes of ['', '00', origin+'ff']) add(['02'+bytes]);
  h.compare(rows,evaluate);
});
test('Disk mirrors advance after flush, duplicates are free, and epoch retries preserve canonical metadata',()=>{
  const scenarios=[[],[receive(records[0])],records.map(receive),[receive(records[0]),receive(records[0])],
    [receive(records[1]),receive(records[0])],[receive(records[0]),receive(other[0])],
    [openEpoch(1n),reopenEpoch(1n),openEpoch(1n)],
    [receive(records[0]),openEpoch(1n),reopenEpoch(1n),receive(epochRecord),reopenEpoch(1n)],
    [reopenEpoch(0n),reopenEpoch(1n),reopenEpoch(1n)]];
  const rows=[];
  for(const actions of scenarios) for(const failures of ['-','stat:1','open:1','lockf:1','read:1','lseek:3','write:1','fsync:1','fsync:2','close:1','close:2'])
    rows.push(row(actions,{failures}));
  rows.push(row([],{failures:'stat:1,stat:2'}));
  for(const counts of ['64,1,0','64,0','64,-1']) rows.push(row([receive(records[0]),receive(records[0])],{counts}));
  for(const initial of [Buffer.concat([fileHeader,frame(records[0])]),Buffer.concat([fileHeader,frame(records[0]),Buffer.from('torn')]),
    Buffer.concat([fileHeader,frame(records[1])]),Buffer.concat([fileHeader,frame(origin,0n,2)])]) rows.push(row([],{initial}));
  h.compare(rows,evaluate);
  const result=evaluate(row([receive(records[0]),receive(records[0])]));
  assert.equal((result.match(/write\|/g)??[]).length,1);assert.equal((result.match(/fsync\|/g)??[]).length,1);
});
test('Disk restart reconstructs accepted records and failed writes leave the mirror unchanged until retry',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'telcoin-disk-')),host=createPosixHost(),path=join(directory,'consensus.log');
  t.after(async()=>{try{await host.close();}finally{await rm(directory,{recursive:true,force:true});}});
  const run=(actions,dispatch=host.dispatch)=>runDurableTask(h.e,start(row(actions,{dir:directory})),dispatch);
  const first=await run([receive(records[0]),receive(records[0])]);assert.equal(first.fsyncs,3n);
  assert.deepEqual(await readFile(path),Buffer.concat([fileHeader,frame(records[0])]));
  const replayed=await run([]);assert.equal(replayed.fsyncs,0n);assert.match(replayed.value.toString(),/^clean;1;false;/);
  let flushes=0;
  const retried=await run([receive(records[1]),receive(records[1])],request=>{
    if(request.op==='fsync'&&++flushes===1) return Promise.resolve(fault);
    return host.dispatch(request);
  });
  assert.match(retried.value.toString(),/error:fsync failed/);assert.equal(retried.fsyncs,1n);
  const expected=Buffer.concat([fileHeader,frame(records[0]),frame(records[1],1n)]);assert.deepEqual(await readFile(path),expected);
  await writeFile(path,Buffer.concat([expected,Buffer.from('tail')]));
  const healed=await run([]);assert.equal(healed.fsyncs,2n);assert.match(healed.value.toString(),/^torn:/);
  assert.deepEqual(await readFile(path),expected);
});
