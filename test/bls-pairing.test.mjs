import test from 'node:test';
import {harness} from './harness.mjs';
import {blsVectors as vectors} from './bls-vectors.mjs';
const h=await harness({name:'bls-pairing',sources:[],modules:[],packages:'bls12-381,zarith',oracle:'test/bls-pairing-oracle.ml',
  fixtures:['test/bls-field.kan','test/bls-pairing.kan'],exports:['blsTowerTestField','blsTowerTestFinal','blsTowerTestPair']});
const evaluate=([kind,...args])=>h.text(h.e[{field:'blsTowerTestField',final:'blsTowerTestFinal',pair:'blsTowerTestPair'}[kind]](...args.map(value=>h.raw(value))));
const compare=rows=>{for(const row of rows)h.compare([row],evaluate,{requireSuccess:true});};
const prime=BigInt('0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab');
const field=values=>Array.from({length:12},(_,i)=>(values[i]??0n).toString(16).padStart(96,'0')).join('');
const random=seed=>Array.from({length:12},(_,i)=>((BigInt(seed+i+1)**97n)*0x1234987012345678910fedcbabcdefn)%prime);
test('Fp12 tower multiplication, inverse and Frobenius powers agree with blst',()=>{
  compare([[],[1n],[0n,1n],[0n,0n,1n],[0n,0n,0n,0n,0n,0n,1n],Array(12).fill(prime-1n),random(1),random(7)]
    .map((a,i)=>['field',field(a),field(random(i+2))]));
});
test('The factored final exponent agrees with the native pairing implementation',()=>{
  compare([[],[1n],random(3)].map(a=>['final',field(a)]));
});
test('Pairings of pinned nonzero points and identity points agree in every target-field coefficient',()=>{
  compare([[vectors.infinity_sig_hex,vectors.pk0_hex],[vectors.sig0_hex,vectors.infinity_pk_hex],
    [vectors.sig0_hex,vectors.pk0_hex],[vectors.sig1_hex,vectors.pk2_hex]].map(([p,q])=>['pair',p,q]));
});
