import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,protocolSources,protocolModules,u16,u32} from './harness.mjs';
const names=['var_bytes','bls_public_key','bls_signature','wire_scalar','roaring','vote_wire','certificate_wire','epoch_certificate','peer_exchange'];
const h=await harness({name:'network-bls',profile:'bls',
  sources:[...protocolSources.filter(path=>path!=='lib/crypto_stub/tn_crypto.ml'),'lib/crypto_blst/blake3.ml','lib/crypto_blst/tn_crypto.ml',
    'lib/snappy/byte_reader.ml',...names.map(name=>`lib/network/${name}.ml`)],
  modules:['blake3.ml',...protocolModules,'byte_reader.ml','tn_snappy.ml',...names.map(name=>`${name}.ml`)],
  packages:'digestif.c,bls12-381,bls12-381-signature,hex,zarith',extraAliases:{'tn_snappy.ml':['Byte_reader']},
  oracle:'test/network-certificates-oracle.ml',fixtures:['test/state.kan','test/crypto.kan','test/network-records.kan','test/network-certificates.kan'],
  exports:['networkWireBridgeTest']});
const empty=u32(12346)+u32(0);
const bitmap=indices=>indices.length?u32(12346)+u32(1)+u16(0)+u16(indices.length-1)+u32(16)+indices.map(u16).join(''):empty;
const row=(mode,roster='1,2',signers='empty',indices=[])=>['bridge',String(mode),'1',roster,signers,bitmap(indices)];
const evaluate=([,mode,seed,roster,signers,wire])=>h.text(h.e.networkWireBridgeTest(Number(mode),h.toBytes(seed),h.seeds(roster),h.seeds(signers),h.raw(wire)));
const compare=(rows,positive)=>{
  for(const input of rows){
    const actual=evaluate(input);
    h.compare([input],()=>actual);
    assert.match(actual,positive?/^ok:/:/^error:/);
  }
};
test('BLS votes cross the wire boundary and verify after conversion to a local vote',()=>{
  compare([row(5),row(8)],true);
});
test('BLS certificate adapters preserve signatures, duplicate aggregation and committee positions',()=>{
  compare([row(6,'2,1','1'),row(7,'1,2','1'),row(7,'2,1','1,1,2')],true);
});
test('The BLS wire adapters still reject malformed signatures and absent committee signers',()=>{
  compare([row(0,'1,2','empty',[2]),row(1),row(3),row(4),row(7,'1,2','99')],false);
});
