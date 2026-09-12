import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,u16,u32,uleb} from './harness.mjs';
const h=await harness({name:'network-roaring',sources:['lib/codec/bcs.ml','lib/snappy/byte_reader.ml','lib/network/roaring.ml'],
  modules:['bcs.ml','tn_codec.ml','byte_reader.ml','tn_snappy.ml','roaring.ml'],extraAliases:{'tn_snappy.ml':['Byte_reader']},
  oracle:'test/network-roaring-oracle.ml',fixtures:['test/state.kan','test/network-roaring.kan'],
  exports:['roaringTestList','roaringTestRead','roaringTestError']});
const cache=new Map();
const evaluate=row=>{
  const key=row.join(' ');if(cache.has(key))return cache.get(key);
  const [op,...a]=row;
  const value=op==='list'?h.e.roaringTestList(h.seeds(a[0]),h.toBytes(a[1])):
    op==='error'?h.e.roaringTestError(Number(a[0]),h.toBytes(a[1]),h.toBytes(a[2])):
    h.e.roaringTestRead(op==='raw'?0:1,h.raw(a[0]==='-'?'':a[0]),h.toBytes(a[1]));
  const text=h.text(value);cache.set(key,text);return text;
};
const list=(values,member=0)=>['list',values.length?values.join(','):'empty',String(member)];
const raw=(wire,member=0)=>['raw',wire||'-',String(member)];
const codec=(wire,member=0)=>['codec',uleb(wire.length/2)+wire,String(member)];
const noRun=groups=>{
  let offset=8+8*groups.length;
  const desc=groups.map(g=>u16(g.key)+u16(g.card??g.values.length-1)).join('');
  const bodies=groups.map(g=>g.bitmap??g.values.map(u16).join(''));
  const offsets=bodies.map(body=>{const before=offset;offset+=body.length/2;return u32(before);}).join('');
  return u32(12346)+u32(groups.length)+desc+offsets+bodies.join('');
};
const runs=groups=>{
  const flags=Buffer.alloc(Math.ceil(groups.length/8),255).toString('hex');
  return u32(12347+(groups.length-1)*65536)+flags+groups.map(g=>u16(g.key)+u16(g.card??0)).join('')
    +(groups.length>=4?'ffffffff'.repeat(groups.length):'')
    +groups.map(g=>u16(g.runs.length)+g.runs.map(([start,len])=>u16(start)+u16(len)).join('')).join('');
};
test('Roaring sets sort and deduplicate full u32 values, choosing the first invalid sorted value',()=>{
  const rows=[];
  const sets=[[],[0],[1,1,0,65536,65535,4294967295],[3,2,1,0,1],[-1,4294967296],
    [4294967297,4294967296],[-1,-4611686018427387904n,4611686018427387903n]];
  for(const values of sets)for(const member of [-1,0,1,65535,65536,4294967295,4294967296])rows.push(list(values,member));
  h.compare(rows,evaluate);
  assert.equal(evaluate(list([])).split('|')[0],u32(12346)+u32(0));
  assert.match(evaluate(list([-1,4294967296])),/^error:roaring value -1 /);
});
test('Array and bitmap emission agree at the 4096-value switch and across the whole low-half range',()=>{
  const rows=[];
  for(const count of [4095,4096,4097,65536]){
    const values=Array.from({length:count},(_,i)=>65536+i).reverse();
    rows.push(list(values,65536),list(values,0));
  }
  rows.push(list([4294967295,0,65536,131072,196608,0],4294967295));
  h.compare(rows,evaluate,{requireSuccess:true});
  const array=evaluate(rows[2]).split('|')[0],bitmap=evaluate(rows[4]).split('|')[0];
  assert.equal(array.length/2,16+8192);
  assert.equal(bitmap.length/2,16+8192);
  assert.notEqual(array,bitmap);
});
test('Roaring decoding accepts arrays, bitmaps, runs, discarded offsets and duplicate values',()=>{
  const rows=[];
  const valid=[noRun([]),noRun([{key:0,values:[3,1,1,0]}]),noRun([{key:2,values:[7]},{key:1,values:[8]},{key:2,values:[7,9]}]),
    runs([{key:0,runs:[[4,3],[5,2],[0,0]]}]),runs([{key:65535,runs:[[65535,0]]}]),runs([{key:0,runs:[[0,65535]]}]),
    runs(Array.from({length:4},(_,key)=>({key,runs:key===2?[[1,3]]:[]}))),
    noRun([{key:1,values:[],card:4096,bitmap:'00'.repeat(8192)}]),
    noRun([{key:0,values:[],card:4096,bitmap:'ff'.repeat(8192)}])];
  for(const wire of valid){rows.push(raw(wire,1),codec(wire,1));}
  const discarded=noRun([{key:0,values:[1]}]);
  rows.push(raw(discarded.slice(0,24)+'ffffffff'+discarded.slice(32),1));
  h.compare(rows,evaluate,{requireSuccess:true});
  assert.ok(evaluate(raw(valid[3])).split('|')[0].startsWith(u32(12346)));
  assert.equal(evaluate(raw(valid[7])).split('|')[1],'0');
});
test('Roaring rejects damaged headers, truncated fields, overflowing runs and trailing bytes in order',()=>{
  const rows=[];
  for(const wire of [noRun([]),noRun([{key:1,values:[0,7,65535]}]),runs([{key:0,runs:[[1,3]]}]),
    runs(Array.from({length:4},(_,key)=>({key,runs:[[0,0]]})))]){
    for(let n=0;n<wire.length;n+=2){rows.push(raw(wire.slice(0,n)),codec(wire.slice(0,n)));}
    rows.push(raw(wire+'00'),codec(wire+'00'));
  }
  for(const count of [65537,4294967295])rows.push(raw(u32(12346)+u32(count)));
  for(const cookie of [0,1,12345,12348,0xffffffff])rows.push(raw(u32(cookie)));
  for(const start of [1,65520,65535])for(const len of [1,16,65535])rows.push(raw(runs([{key:0,runs:[[start,len]]}])));
  const bitmap=noRun([{key:0,values:[],card:4096,bitmap:'55'.repeat(8192)}]);
  for(const n of [16,17,18,127,1024,8191,8207])rows.push(raw(bitmap.slice(0,n*2)));
  rows.push(['codec','8000','0'],['codec','ffffffff0f','0']);
  h.compare(rows,evaluate);
});
test('Public Roaring errors preserve signed native values and wrapping subtraction',()=>{
  const rows=[];
  for(let kind=0;kind<6;kind++)for(const a of [-4611686018427387904n,-1,0,65536,4611686018427387903n])
    for(const b of [-1,0,65536,4611686018427387903n])rows.push(['error',String(kind),String(a),String(b)]);
  h.compare(rows,evaluate,{requireSuccess:true});
});
