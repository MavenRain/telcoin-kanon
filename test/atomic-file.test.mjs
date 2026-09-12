import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {harness} from './harness.mjs';
const h=await harness({name:'atomic-file',sources:['lib/durable/io_ops.ml','lib/durable/io.ml','lib/durable/atomic_file.ml'],
  modules:['io_ops.ml','io.ml','atomic_file.ml'],packages:'digestif.c,unix',oracle:'test/atomic-file-oracle.ml',
  fixtures:['test/atomic-file.kan'],exports:['atomicTestEncode','atomicTestDecode']});
const hex=bytes=>Buffer.from(bytes).toString('hex')||'-';
const raw=text=>h.raw(text==='-'?'':text);
const evaluate=([op,...a])=>op==='encode'
  ?h.text(h.e.atomicTestEncode(raw(a[0]),h.toBytes(a[1]),h.toBytes(a[2]),raw(a[3])))
  :h.text(h.e.atomicTestDecode(h.toBytes(a[0]),raw(a[1]),h.toBytes(a[2]),raw(a[3])));
const magic=hex('TNCKPT01');
const container=(payload,generation=0n,format=1)=>{
  const body=Buffer.from(payload),head=Buffer.alloc(32);
  Buffer.from('TNCKPT01').copy(head);head.writeUInt32BE(format,8);
  head.writeBigUInt64BE(generation,12);head.writeUInt32BE(body.length,20);
  createHash('blake2b512').update(body).digest().subarray(0,8).copy(head,24);
  return Buffer.concat([head,body]);
};
const change=(input,offset,value)=>{const copy=Buffer.from(input);copy[offset]=value;return copy;};
test('Atomic containers preserve format, generation, arbitrary magic and payload bytes',()=>{
  const rows=[];
  for(const format of ['0','1','4294967295','4294967296','-1','-4611686018427387904']){
    for(const generation of ['0','1','4611686018427387903','-1','-4611686018427387904']){
      for(const payload of ['-',hex('data'),hex(Buffer.alloc(129,0xa5))])rows.push(['encode',magic,format,generation,payload]);
    }
  }
  for(const value of ['-',hex('short'),hex('TNCKPT01extra')])rows.push(['encode',value,'1','0',hex('data')]);
  h.compare(rows,evaluate,{requireSuccess:true});
});
test('Atomic decode checks exact length, generation and tag with source error precedence',()=>{
  const valid=container('data'),rows=[];
  const add=(buf,path='root/checkpoint',wanted=magic,format='1')=>rows.push(['decode',path,wanted,format,hex(buf)]);
  for(let length=0;length<valid.length;length++)add(valid.subarray(0,length));
  for(let offset=0;offset<valid.length;offset++)add(change(valid,offset,valid[offset]^0x80));
  for(const generation of [0n,1n,4611686018427387903n,4611686018427387904n,9223372036854775807n,18446744073709551615n]){
    for(const payload of ['', 'a', 'checkpoint'])add(container(payload,generation));
  }
  for(const extra of [1,4,32])add(Buffer.concat([valid,Buffer.alloc(extra)]));
  for(const wanted of ['-',hex('short'),hex('TNCKPT02'),hex('TNCKPT01extra')])add(valid,'other/file',wanted);
  for(const format of ['0','4294967295','-1'])add(valid,'root/checkpoint',magic,format);
  const impossible=Buffer.from(valid);impossible.writeUInt32BE(4294967295,20);add(impossible);
  h.compare(rows,evaluate);
  assert.match(evaluate(['decode','root/checkpoint',magic,'1',hex(container('ok',4611686018427387904n))]),/generation is out of range/);
});
