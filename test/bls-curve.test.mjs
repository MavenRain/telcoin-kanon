import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import {harness} from './harness.mjs';
const lock=JSON.parse(readFileSync(new URL('../source-lock.json',import.meta.url),'utf8'));
const path='test/fixtures/tn_crypto_blst_vectors.txt';
const raw=readFileSync(resolve(process.env.TELCOIN_OCAML_ROOT??lock.upstream.root,path));
assert.equal(createHash('sha256').update(raw).digest('hex'),lock.upstream.files.find(file=>file.path===path)?.sha256,path);
const vectors=Object.fromEntries(raw.toString('utf8').split('\n').filter(line=>line.includes('=')).map(line=>line.split('=').map(part=>part.trim())));
const h=await harness({name:'bls-curve',sources:[],modules:[],packages:'bls12-381,zarith',oracle:'test/bls-curve-oracle.ml',
  fixtures:['test/bls-field.kan','test/bls-curve.kan'],exports:['blsCurveTestG1Decode','blsCurveTestG2Decode','blsCurveTestG1Ops','blsCurveTestG2Ops']});
const evaluate=([group,operation,...args])=>h.text(h.e[`blsCurveTest${group==='g1'?'G1':'G2'}${operation==='decode'?'Decode':'Ops'}`](...args.map(value=>h.raw(value==='-'?'':value))));
const compare=rows=>{for(let i=0;i<rows.length;i+=10)h.compare(rows.slice(i,i+10),evaluate,{requireSuccess:true});};
const order=BigInt('0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001');
const scalar=value=>value.toString(16).padStart(64,'0');
const neg=raw=>{const value=Buffer.from(raw,'hex');value[0]^=32;return value.toString('hex');};
for(const [group,width,points] of [['g1',48,[vectors.sig0_hex,vectors.sig1_hex,vectors.sig2_hex,vectors.agg012_hex]],
  ['g2',96,[vectors.pk0_hex,vectors.pk1_hex,vectors.pk2_hex]]]) {
  const infinity='c0'+'00'.repeat(width-1);
  test(`${group} pinned compressed vectors, flags, widths, canonical fields and subgroup rejection`,()=>{
    assert.ok(points.every(value=>typeof value==='string'&&value.length===width*2));
    const rows=[...points,...points.map(neg),infinity,'-','00'.repeat(width-1),'00'.repeat(width+1),'ff'.repeat(width)];
    for(const flags of [0,32,64,96,128,160,192,224]) {
      rows.push(flags.toString(16).padStart(2,'0')+'00'.repeat(width-1));
      const raw=Buffer.from(points[0],'hex');raw[0]=(raw[0]&31)|flags;rows.push(raw.toString('hex'));
    }
    const prime='1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab';
    rows.push('9a'+prime.slice(2)+'00'.repeat(width-48));
    if(width===96)rows.push('80'+'00'.repeat(47)+prime);
    compare(rows.map(raw=>[group,'decode',raw]));
  });
  test(`${group} addition, inverse, doubling and unreduced scalar multiplication agree with blst`,()=>{
    const pairs=[[points[0],points[1]],[points[0],points[0]],[points[0],neg(points[0])],
      [infinity,points[0]],[points[0],infinity],[infinity,infinity]];
    compare(pairs.map(([a,b],i)=>[group,'ops',a,b,scalar([0n,1n,2n,3n,order-1n,order][i])]));
    compare([order-1n,order,order+1n,(1n<<256n)-1n].map(n=>[group,'ops',points[1],points[2],scalar(n)]));
  });
}
