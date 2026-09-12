import assert from 'node:assert/strict';
import test from 'node:test';
import {harness} from './harness.mjs';
import {durableHostExports,durableTaskAdapter} from '../durable-runtime.mjs';
const h=await harness({name:'durable-io',sources:['lib/durable/io_ops.ml','lib/durable/io.ml'],
  modules:['io_ops.ml','io.ml'],packages:'unix',oracle:'test/durable-io-oracle.ml',
  fixtures:['test/durable-io.kan'],exports:['durableIoTestStart',...durableHostExports]});
const adapter=durableTaskAdapter(h.e),hex=value=>Buffer.from(value).toString('hex')||'-';
const raw=value=>Buffer.from(value==='-'?'':value,'hex');
const codes={absent:'ENOENT',contended:'EAGAIN',notdir:'ENOTDIR',exists:'EEXIST'};
const metadata=h.runOracle([],Object.keys(codes).map(code=>`meta ${code}\n`).join(''));
assert.equal(metadata.status,0,metadata.stderr);
const messages=Object.fromEntries(metadata.stdout.trim().split('\n').map((line,i)=>[Object.keys(codes)[i],Buffer.from(line,'hex')]));
const row=(op,{path='root/file',payload='abcdef',at='0',length='6',counts='-',failures='-',code='absent'}={})=>
  [String(op),hex(path),hex(payload),String(at),String(length),counts,failures,code];
const start=([op,path,payload,at,length])=>h.e.durableIoTestStart(Number(op),h.toBytes(raw(path)),h.toBytes(raw(payload)),h.toBytes(at),h.toBytes(length));
function evaluate(input) {
  const [,,,at,length,counts,failures,code]=input,payload=raw(input[2]);
  const remaining=counts==='-'?[]:counts.split(',').map(BigInt),failed=failures.split(','),hits=new Map(),trace=[];
  let position=0n,task=start(input);
  while(!adapter.done(task)) {
    assert.ok(trace.length<10000,'A partial transfer must make progress.');
    const {op,args,body}=adapter.request(task),a=args.map(value=>value.toString('utf8'));
    trace.push(`${op}|${args.map(value=>value.toString('hex')).join(',')}|${(op==='read'?body.subarray(0,Number(a[1])):body).toString('hex')}`);
    hits.set(op,(hits.get(op)??0)+1);
    let reply={kind:'ok'};
    if(failed.includes(`${op}:${hits.get(op)}`)) reply={kind:'unix',errno:codes[code],message:messages[code]};
    else switch(op) {
      case 'open':reply.scalar='7';break;
      case 'write':reply.scalar=String(remaining.shift()??BigInt(a[2]));break;
      case 'read':{
        const off=Number(a[1]),len=Number(a[2]),available=position>BigInt(payload.length)?0:payload.length-Number(position);
        const reported=remaining.shift()??BigInt(Math.min(len,available));
        const copied=Math.min(available,len,Number(reported<0n?0n:reported));
        const buffer=Buffer.from(body);
        payload.copy(buffer,off,Math.min(Number(position),payload.length),Math.min(Number(position),payload.length)+copied);
        position+=BigInt(copied);reply={kind:'ok',scalar:String(reported),body:buffer};break;
      }
      case 'lseek':position=BigInt.asIntN(63,BigInt(a[1])+(a[2]==='end'?BigInt(payload.length):a[2]==='cur'?position:0n));reply.scalar=String(position);break;
      case 'stat':reply.scalar='true';break;
      case 'realpath':reply.body=Buffer.concat([Buffer.from('/resolved/'),args[0]]);break;
      case 'close':case 'fsync':case 'ftruncate':case 'rename':case 'mkdir':case 'unlink':case 'lockf':break;
      default:assert.fail(`Unexpected syscall ${op}`);
    }
    task=adapter.reply(task,reply);
  }
  const result=adapter.result(task);
  return `${result.value.toString('utf8')}#${result.fsyncs}:${result.bytesWritten}#${trace.join('~')}`;
}
test('Guarded operations preserve arguments, cleanup order, errors and counters',()=>{
  const rows=[];
  for(let op=0;op<19;op++) {
    rows.push(row(op));
    for(const syscall of ['open','close','write','read','fsync','ftruncate','lseek','rename','mkdir','unlink','stat','lockf','realpath'])
      rows.push(row(op,{failures:`${syscall}:1`}));
  }
  for(const op of [9,15,16,17,18]) for(const failure of ['fsync:1','write:1','read:1','lseek:1'])
    rows.push(row(op,{failures:`${failure},close:1`}));
  h.compare(rows,evaluate);
  assert.match(evaluate(row(17,{failures:'fsync:1,close:1'})),/^error:fsync failed.*#0:0#.*~close\|/);
  assert.match(evaluate(row(9,{failures:'close:1'})),/^error:close failed.*#1:0#/);
});
test('Partial transfers clamp reported counts and reject zero progress',()=>{
  const rows=[];
  for(const op of [0,1,2,15,16,18]) for(const counts of ['-','1','1,1,1,1,1,1','2,3,1','0','-1','99','1,0','1,-1','3,99','4611686018427387903'])
    for(const payload of ['', 'a','abcdef']) rows.push(row(op,{counts,payload}));
  for(const op of [0,1,2,16,18]) for(const failures of ['write:2','read:2','write:3,close:1','read:3,close:1'])
    rows.push(row(op,{counts:'1,1,1,1,1,1',failures}));
  h.compare(rows,evaluate);
  assert.match(evaluate(row(0,{counts:'2,0'})),/^error:short write.*wanted 6 bytes, the device took 2#0:2#/);
});
test('Read bounds are checked before seeking or allocation and trusted reads omit the ceiling',()=>{
  const rows=[];
  for(const op of [1,2,18]) for(const at of ['-4611686018427387904','-1','0','1','5','6','7','4611686018427387903'])
    for(const length of ['-4611686018427387904','-1','0','1','6','7']) rows.push(row(op,{at,length}));
  for(const op of [1,2]) for(const length of ['1073741824','1073741825','4611686018427387903'])
    rows.push(row(op,{length,failures:'lseek:1'}));
  h.compare(rows,evaluate);
  assert.match(evaluate(row(1,{length:'1073741825'})),/^error:short read.*#0:0#$/);
  assert.match(evaluate(row(2,{length:'1073741825',failures:'lseek:1'})),/^error:lseek failed/);
});
test('Path traversal and tolerated errno values match the source boundary',()=>{
  const rows=[];
  for(const path of ['', '/', '//', 'a//b/', '/a//b/../c', './x', 'a b/c', Buffer.from([0xff,47,0xfe])])
    for(const failures of ['-','mkdir:1','mkdir:2','mkdir:3']) for(const code of ['absent','exists']) rows.push(row(11,{path,failures,code}));
  for(const [op,syscall] of [[7,'lockf'],[12,'unlink'],[13,'stat'],[14,'realpath']])
    for(const code of Object.keys(codes)) rows.push(row(op,{failures:`${syscall}:1`,code}));
  h.compare(rows,evaluate);
  assert.match(evaluate(row(7,{failures:'lockf:1',code:'contended'})),/^error:lockf on abcdef would block/);
  assert.match(evaluate(row(13,{failures:'stat:1',code:'notdir'})),/^false#/);
});
test('Sys errors are distinct from tolerated Unix errors and malformed host replies are explicit',()=>{
  for(const op of [7,11,12,13]) {
    const task=start(row(op));
    const done=adapter.reply(task,{kind:'sys',message:'ENOENT'});
    assert.equal(adapter.done(done),true);
    assert.match(adapter.result(done).value.toString(),/^error:.*failed.*ENOENT$/);
  }
  const badOpen=adapter.reply(start(row(16)),{kind:'ok',scalar:'not-an-integer'});
  assert.match(adapter.result(badOpen).value.toString(),/^error:open failed.*invalid syscall reply$/);
  const badExists=adapter.reply(start(row(13)),{kind:'ok',scalar:'TRUE'});
  assert.match(adapter.result(badExists).value.toString(),/^error:stat failed.*invalid syscall reply$/);
});
