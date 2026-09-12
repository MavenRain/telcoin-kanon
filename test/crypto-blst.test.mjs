import assert from 'node:assert/strict';
import test from 'node:test';
import {harness} from './harness.mjs';
import {blsVectors as v} from './bls-vectors.mjs';
const h=await harness({name:'crypto-blst',profile:'bls',sources:['lib/crypto_blst/blake3.ml','lib/crypto_blst/tn_crypto.ml'],
  modules:['blake3.ml','tn_crypto.ml'],packages:'bls12-381,bls12-381-signature,hex,zarith',oracle:'test/crypto-blst-oracle.ml',
  fixtures:['test/bls-field.kan','test/crypto-blst.kan'],exports:['cryptoProfile','cryptoBlstTestDerive','cryptoBlstTestKeygen',
    'cryptoBlstTestAdmit','cryptoBlstTestInvalidOctet','cryptoBlstTestAggregate','cryptoBlstTestVerify','cryptoBlstTestSingle','cryptoBlstTestZero','cryptoBlstTestZeroSign']});
const raw=value=>h.raw(value==='-'?'':value);
const values=csv=>{let result=h.e.seqBytesEmpty();for(const value of (csv==='empty'?[]:csv.split(',')).reverse())result=h.e.seqBytesCons(raw(value),result);return result;};
const evaluate=([kind,...args])=>{
  if(kind==='zero-sign')return h.text(h.e.cryptoBlstTestZeroSign(raw(args[0])));
  if(kind==='derive')return h.text(h.e.cryptoBlstTestDerive(raw(BigInt(args[0]).toString(16).padStart(16,'0')),raw(args[1])));
  if(kind==='keygen')return h.text(h.e.cryptoBlstTestKeygen(...args.map(raw)));
  if(kind==='admit')return h.text(h.e.cryptoBlstTestAdmit({pk:0,sig:1,agg:2}[args[0]],raw(args[1])));
  if(kind==='aggregate')return h.text(h.e.cryptoBlstTestAggregate(values(args[0])));
  if(kind==='verify')return h.text(h.e.cryptoBlstTestVerify(values(args[0]),raw(args[1]),raw(args[2])));
  if(kind==='single'||kind==='zero')return h.text(h.e[kind==='single'?'cryptoBlstTestSingle':'cryptoBlstTestZero'](raw(args[0]+args[2]),raw(args[1])));
  throw new Error(`Unknown command ${kind}`);
};
const compare=rows=>{for(let i=0;i<rows.length;i+=5)h.compare(rows.slice(i,i+5),evaluate,{requireSuccess:true});};
const neg=hex=>{const bytes=Buffer.from(hex,'hex');bytes[0]^=32;return bytes.toString('hex');};
test('The real profile reproduces the pinned Rust key, signature and BLAKE3 vectors',()=>{
  assert.equal(h.text(h.e.cryptoProfile()),'bls12-381:minsig-basic:blake3');
  const rows=[0,1,2].map(i=>['keygen',v[`ikm${i}_hex`],'-',v.msg_hex]);
  const actual=rows.map(evaluate);
  h.compare(rows,row=>actual[rows.indexOf(row)],{requireSuccess:true});
  actual.forEach((value,i)=>assert.equal(value,[v[`pk${i}_hex`],v[`sig${i}_hex`],v.blake3_digest_hex].join('|')));
  assert.equal(evaluate(['aggregate',[v.sig0_hex,v.sig1_hex,v.sig2_hex].join(',')]),v.agg012_hex);
});
test('Seeded keys and signatures match the production source for full int64 bit patterns',()=>{
  compare([0n,1n,17n,1n<<32n,1n<<63n,(1n<<64n)-1n].map((seed,i)=>['derive',seed.toString(),i%2?v.msg_hex:'-']));
});
test('Admission preserves canonical encodings and the distinct public-key infinity rule',()=>{
  compare([['pk',v.pk0_hex],['sig',v.sig0_hex],['agg',v.agg012_hex],['pk',v.infinity_pk_hex],
    ['sig',v.infinity_sig_hex],['agg',v.infinity_sig_hex],['pk',neg(v.pk1_hex)],['sig',neg(v.sig1_hex)],
    ...['pk','sig','agg'].flatMap(kind=>[[''+kind,'-'],[kind,'ff'.repeat(kind==='pk'?96:48)],[kind,'00'.repeat(kind==='pk'?96:48)]])]
    .map(([kind,raw])=>['admit',kind,raw]));
  for(const [kind,point] of [[0,v.pk0_hex],[1,v.sig0_hex],[2,v.agg012_hex]])for(const head of [256,383,511,1000])
    assert.equal(h.text(h.e.cryptoBlstTestInvalidOctet(kind,head,raw(point))),'none');
});
test('Aggregation retains duplicates and accepts an empty list or infinity signatures',()=>{
  compare([[],[v.sig0_hex],[v.sig0_hex,v.sig0_hex],[v.sig0_hex,v.sig1_hex,v.sig2_hex],[v.sig2_hex,v.sig0_hex,v.sig1_hex],
    [v.infinity_sig_hex],[v.infinity_sig_hex,v.sig0_hex],[v.sig0_hex,neg(v.sig0_hex)],['00'.repeat(48)]]
    .map(signatures=>['aggregate',signatures.join(',')||'empty']));
  assert.equal(evaluate(['aggregate',[v.sig0_hex,v.sig0_hex].join(',')]),v.sig0_doubled_hex);
});
test('An internal zero scalar signs to infinity, matching native scalar multiplication',()=>{
  const rows=['-',v.msg_hex,'ff'.repeat(1024)].map(message=>['zero-sign',message]);
  compare(rows);
  for(const row of rows)assert.equal(evaluate(row),v.infinity_sig_hex);
});
test('Single and shared-message aggregate verification match the production guards and pairing equation',()=>{
  compare([['single',v.pk0_hex,v.msg_hex,v.sig0_hex],['single',v.pk1_hex,v.msg_hex,v.sig0_hex],
    ['single',v.pk0_hex,v.wrong_msg_hex,v.sig0_hex],['single',v.pk0_hex,v.msg_hex,v.infinity_sig_hex],
    ['zero',v.pk0_hex,v.msg_hex,v.sig0_hex]]);
  compare([
    [[v.pk0_hex,v.pk1_hex,v.pk2_hex],v.msg_hex,v.agg012_hex],
    [[v.pk2_hex,v.pk0_hex,v.pk1_hex],v.msg_hex,v.agg012_hex],
    [[v.pk0_hex,v.pk0_hex],v.msg_hex,v.sig0_doubled_hex],
    [[v.pk0_hex,v.pk0_hex],v.msg_hex,v.sig0_hex],
    [[v.pk0_hex,v.pk1_hex],v.msg_hex,v.agg012_hex],
    [[v.pk0_hex,v.pk1_hex,v.pk2_hex],v.wrong_msg_hex,v.agg012_hex],
    [[v.pk0_hex,neg(v.pk0_hex)],v.msg_hex,v.infinity_sig_hex],
    [[],v.msg_hex,v.infinity_sig_hex],[[],v.msg_hex,v.sig0_hex],
    [[v.pk0_hex,v.infinity_pk_hex],v.msg_hex,v.sig0_hex]
  ].map(([keys,message,aggregate])=>['verify',keys.join(',')||'empty',message,aggregate]));
});
