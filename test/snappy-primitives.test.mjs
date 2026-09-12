import assert from 'node:assert/strict';
import test from 'node:test';
import {harness} from './harness.mjs';
const h=await harness({name:'snappy-primitives',sources:['lib/snappy/byte_reader.ml','lib/snappy/crc32c.ml'],
  modules:['byte_reader.ml','crc32c.ml'],oracle:'test/snappy-primitives-oracle.ml',fixtures:['test/snappy-primitives.kan'],
  exports:['snappyPrimitiveRead','snappyPrimitiveDigest','snappyPrimitiveUpdate','snappyPrimitiveMask','snappyPrimitiveStep']});
const hex=bytes=>Buffer.from(bytes).toString('hex')||'-';
const raw=text=>h.raw(text==='-'?'':text);
const evaluate=([op,...a])=>{
  if(op==='read')return h.text(h.e.snappyPrimitiveRead(raw(a[0]),h.toBytes(a[1]),h.toBytes(a[2])));
  if(op==='digest')return h.text(h.e.snappyPrimitiveDigest(raw(a[0])));
  if(op==='update')return h.text(h.e.snappyPrimitiveUpdate(h.toBytes(a[0]),raw(a[1]),h.toBytes(a[2]),h.toBytes(a[3])));
  if(op==='mask')return h.text(h.e.snappyPrimitiveMask(h.toBytes(a[0])));
  return h.text(h.e.snappyPrimitiveStep(h.toBytes(a[0]),h.toBytes(a[1])));
};
const limits=['-4611686018427387904','-1','0','1','255','4294967295','4611686018427387903'];
test('Byte windows preserve bounds, optional bytes and native little-endian assembly',()=>{
  const rows=[];
  for(const n of [0,1,4,8,9,16,33]){
    const bytes=hex(Array.from({length:n},(_,i)=>(i*79+129)&255));
    for(const pos of ['-4611686018427387904','-1','0','1',String(n),String(n+1),'4611686018427387903']){
      for(const len of ['-1','0','1','4','8',String(n),'4611686018427387903'])rows.push(['read',bytes,pos,len]);
    }
  }
  for(const n of [8,9,16,17,64])rows.push(['read',hex(Buffer.alloc(n,0xff)),'0',String(n)]);
  h.compare(rows,evaluate);
});
test('CRC-32C and masking match the reference at block boundaries and signed inputs',()=>{
  const rows=[['digest','-'],['digest',hex('123456789')]];
  for(const n of [1,2,7,8,31,32,64,255,256,1024])rows.push(['digest',hex(Array.from({length:n},(_,i)=>(i*67+33)&255))]);
  for(const value of limits)rows.push(['mask',value]);
  for(const register of limits)for(const byte of limits)rows.push(['step',register,byte]);
  h.compare(rows,evaluate,{requireSuccess:true});
  assert.equal(evaluate(['digest',hex('123456789')]).split(':')[0],'3808858755');
});
test('CRC updates validate windows before processing and compose incremental digests',()=>{
  const bytes=Buffer.from('incremental crc32c'),encoded=hex(bytes),rows=[];
  for(const prev of limits)for(const pos of [-1,0,1,bytes.length,bytes.length+1]){
    for(const len of [-1,0,1,bytes.length])rows.push(['update',prev,encoded,String(pos),String(len)]);
  }
  for(const split of [0,1,8,bytes.length]){
    const previous=evaluate(['digest',hex(bytes.subarray(0,split))]).split(':')[0];
    const row=['update',previous,encoded,String(split),String(bytes.length-split)];rows.push(row);
    assert.equal(evaluate(row),evaluate(['digest',encoded]).split(':')[0]);
  }
  h.compare(rows,evaluate);
});
