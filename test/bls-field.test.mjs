import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './harness.mjs';
const h=await harness({name:'bls-field',sources:[],modules:[],packages:'zarith',oracle:'test/bls-field-oracle.ml',
  fixtures:['test/bls-field.kan'],exports:['blsFieldTestDecode','blsFieldTestBase','blsFieldTestExtension']});
const prime=BigInt('0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab');
const hex=(value,width=48)=>value.toString(16).padStart(width*2,'0');
const evaluate=([kind,...args])=>h.text(h.e[{decode:'blsFieldTestDecode',base:'blsFieldTestBase',extension:'blsFieldTestExtension'}[kind]](...args.map(value=>h.raw(value==='-'?'':value))));
const compare=rows=>{for(let offset=0;offset<rows.length;offset+=20)h.compare(rows.slice(offset,offset+20),evaluate,{requireSuccess:true});};
test('BLS field admission rejects wrong widths and noncanonical residues',()=>{
  compare(['-',...Array.from({length:50},(_,n)=>'00'.repeat(n)).filter(Boolean),hex(prime-1n),hex(prime),hex(prime+1n),'ff'.repeat(48)]
    .map(value=>['decode',value]));
});
test('Field admission rejects an invalid octet constructed through the raw Kanon carrier',()=>{
  for(const head of [256,383,511,1000])assert.equal(h.text(h.e.blsFieldTestDecode(h.e.consBytes(head,h.raw('00'.repeat(47))))),'none');
});
test('BLS prime-field arithmetic, reduction, inverse and square roots agree with Zarith',()=>{
  const values=[0n,1n,2n,3n,11n,prime/2n,prime-1n,prime,prime+1n,(1n<<512n)-1n];
  compare(values.flatMap(a=>[0n,1n,prime-1n].map(b=>['base',hex(a,a>=1n<<384n?64:48),hex(b)])));
});
test('The quadratic field agrees with independent polynomial arithmetic and Euler square tests',()=>{
  const pairs=[[0n,0n],[1n,0n],[2n,0n],[0n,1n],[1n,1n],[3n,4n],[prime-1n,1n],[prime-1n,prime-1n],[prime/2n,prime/3n]];
  compare(pairs.flatMap(a=>[[0n,0n],[1n,1n],[prime-1n,3n]].map(b=>['extension',a.map(value=>hex(value)).join(''),b.map(value=>hex(value)).join('')])));
});
