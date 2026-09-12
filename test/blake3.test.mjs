import assert from 'node:assert/strict';
import test from 'node:test';
import {harness} from './harness.mjs';
import {byteAdapter} from '../runtime.mjs';
const h=await harness({name:'blake3',sources:['lib/crypto_blst/blake3.ml'],modules:['blake3.ml'],packages:'',
  oracle:'test/blake3-oracle.ml',fixtures:[],exports:['blake3Hash']});
const {fromBytes}=byteAdapter(h.e);
const hash=value=>fromBytes(h.e.blake3Hash(h.toBytes(value))).toString('hex');
test('BLAKE3 unkeyed empty and abc vectors',()=>{
  assert.equal(hash(''),'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262');
  assert.equal(hash('abc'),'6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85');
});
test('Block, chunk and unbalanced tree boundaries agree with the pinned OCaml hash',()=>{
  const lengths=[0,1,3,31,32,63,64,65,127,128,129,1023,1024,1025,2047,2048,2049,3071,3072,3073,
    4095,4096,4097,5120,6144,7168,8191,8192,8193,9216,16383,16384,16385,31744];
  const rows=lengths.map(length=>[Buffer.from(Array.from({length},(_,i)=>i%251)).toString('hex')||'-']);
  h.compare(rows,([payload])=>hash(Buffer.from(payload==='-'?'':payload,'hex')),{requireSuccess:true});
});
test('Binary randomized inputs agree across chunk counters',()=>{
  let state=0x4413;
  const byte=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state>>>24;};
  const rows=Array.from({length:20},(_,i)=>[Buffer.from(Array.from({length:i*379+1},byte)).toString('hex')]);
  h.compare(rows,([payload])=>hash(Buffer.from(payload,'hex')),{requireSuccess:true});
});
