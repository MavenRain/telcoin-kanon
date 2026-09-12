import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import test from 'node:test';
import {harness} from './harness.mjs';
import {byteAdapter} from '../runtime.mjs';
const h=await harness({name:'bls-hash',sources:['lib/crypto_blst/blake3.ml','lib/crypto_blst/tn_crypto.ml'],
  modules:['blake3.ml','tn_crypto.ml'],packages:'bls12-381,bls12-381-signature,hex,zarith',oracle:'test/bls-hash-oracle.ml',
  fixtures:['test/bls-hash.kan'],exports:['blsHmacSha256','blsHashTestPoint','blsHashTestKeygen','blsHashTestDerive']});
const {fromBytes}=byteAdapter(h.e);
const bytes=length=>Buffer.from(Array.from({length},(_,i)=>(i*137+41)%256));
const hex=value=>value.toString('hex')||'-';
const evaluate=([kind,...args])=>kind==='derive'
  ?h.text(h.e.blsHashTestDerive(h.raw(BigInt(args[0]).toString(16).padStart(16,'0'))))
  :h.text(h.e[kind==='hash'?'blsHashTestPoint':'blsHashTestKeygen'](...args.map(value=>h.raw(value==='-'?'':value))));
const compare=rows=>{for(let i=0;i<rows.length;i+=5)h.compare(rows.slice(i,i+5),evaluate,{requireSuccess:true});};
test('HMAC-SHA256 key normalization and padding agree with Node crypto',()=>{
  for(const length of [0,1,32,63,64,65,129])for(const size of [0,1,55,56,64,129]){
    const key=bytes(length),message=bytes(size);
    assert.equal(fromBytes(h.e.blsHmacSha256(h.toBytes(key),h.toBytes(message))).toString('hex'),createHmac('sha256',key).update(message).digest('hex'));
  }
});
test('Hash-to-G1 matches the native BLS signature domain across SHA block boundaries',()=>{
  compare([0,1,3,31,55,56,63,64,65,127,128,255,1024].map(length=>['hash',hex(bytes(length))]));
  compare([['hash',Buffer.from('tn_crypto_blst chunk39 golden vector v1').toString('hex')]]);
});
test('KeyGen agrees with blst for IKM width and key-info variations',()=>{
  compare([0,1,31,32,33,48,64].flatMap(length=>[0,3,65].map(info=>['keygen',hex(bytes(length)),hex(bytes(info))])));
});
test('Seed derivation agrees with the pinned production implementation including signed int64 bit patterns',()=>{
  compare([0n,1n,2n,17n,255n,1n<<32n,(1n<<63n)-1n,1n<<63n,(1n<<64n)-1n].map(seed=>['derive',seed.toString()]));
});
