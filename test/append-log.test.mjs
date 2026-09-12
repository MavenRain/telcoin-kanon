import assert from 'node:assert/strict';
import test from 'node:test';
import {harness} from './harness.mjs';
const h=await harness({name:'append-log',
  sources:['lib/durable/io_ops.ml','lib/durable/io.ml','lib/durable/frame.ml','lib/durable/store_lock.ml','lib/durable/append_log.ml'],
  modules:['io_ops.ml','io.ml','frame.ml','store_lock.ml','append_log.ml'],packages:'digestif.c,unix',
  oracle:'test/append-log-oracle.ml',fixtures:['test/atomic-file.kan','test/append-log.kan'],
  exports:['appendTestHeader','appendTestMismatch','appendTestError','ocamlQuotedBytes']});
const hex=value=>Buffer.from(value).toString('hex')||'-';
const raw=value=>h.raw(value==='-'?'':value);
const evaluate=([op,...a])=>{
  if(op==='header')return h.text(h.e.appendTestHeader(raw(a[0]),raw(a[1])));
  if(op==='mismatch')return h.text(h.e.appendTestMismatch(raw(a[0]),raw(a[1])));
  if(op==='quote')return h.text(h.e.ocamlQuotedBytes(raw(a[0])));
  return h.text(h.e.appendTestError(Number(a[0]),h.toBytes(a[1]),h.toBytes(a[2]),h.toBytes(a[3])));
};
const header=()=>{
  const bytes=Buffer.alloc(64);Buffer.from('TNLOG001').copy(bytes);bytes.writeUInt32BE(1,8);bytes.writeUInt32BE(64,12);
  bytes.writeBigUInt64BE(7n,16);bytes.writeBigUInt64BE(19n,24);Buffer.alloc(32,0xa5).copy(bytes,32);return bytes;
};
const flip=(value,offset)=>{const copy=Buffer.from(value);copy[offset]^=0x80;return copy;};
test('Log headers reject truncation and damage in source order and compare opaque identity spans',()=>{
  const valid=header(),rows=[];
  const add=(stored,wanted=valid)=>rows.push(['header',hex(stored),hex(wanted)]);
  for(let length=0;length<=64;length++)add(valid.subarray(0,length));
  for(let offset=0;offset<64;offset++){add(flip(valid,offset));add(valid,flip(valid,offset));}
  for(let length=0;length<=64;length++)add(valid,valid.subarray(0,length));
  for(const length of [1,8,64,256])add(Buffer.concat([valid,Buffer.alloc(length)]));
  for(const word of [0,2,255,4294967295]){
    for(const offset of [8,12]){const bad=Buffer.from(valid);bad.writeUInt32BE(word,offset);add(bad);}
  }
  for(const first of [0,8,12,16,24])for(const last of [24,32,63])add(flip(flip(valid,first),last));
  h.compare(rows,evaluate);
  assert.equal(evaluate(['header',hex(valid),hex(flip(valid,12))]),'ok');
});
test('Identity mismatch selection remains total for short and oversized buffers',()=>{
  const valid=header(),rows=[];
  for(const length of [0,1,8,15,16,17,23,24,25,31,32,33,63,64,65]){
    for(const reverse of [false,true]){
      const value=Buffer.concat([valid,Buffer.from([0])]).subarray(0,length);
      rows.push(['mismatch',hex(reverse?valid:value),hex(reverse?value:valid)]);
    }
  }
  for(const offset of [0,8,12,16,23,24,31,32,63])rows.push(['mismatch',hex(flip(valid,offset)),hex(valid)]);
  h.compare(rows,evaluate);
});
test('Error rendering preserves binary quoting, lock failures and signed offsets',()=>{
  const rows=[['quote','-']];
  for(let byte=0;byte<256;byte++)rows.push(['quote',hex([byte])]);
  rows.push(['quote',hex(Array.from({length:256},(_,i)=>i))]);
  for(let kind=0;kind<5;kind++)for(const first of ['0','1','-1','4611686018427387903','-4611686018427387904']){
    for(const second of ['0','16777216','-4611686018427387904'])rows.push(['error',String(kind),first,second,'root/consensus.log']);
  }
  h.compare(rows,evaluate);
});
