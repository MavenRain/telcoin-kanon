import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,uleb} from './harness.mjs';
const h=await harness({name:'snappy-raw',sources:['lib/snappy/byte_reader.ml','lib/snappy/snappy_raw.ml'],
  modules:['byte_reader.ml','snappy_raw.ml'],oracle:'test/snappy-raw-oracle.ml',
  fixtures:['test/snappy-primitives.kan','test/snappy-raw.kan'],
  exports:['snappyTestEncode','snappyTestDecode','snappyTestPreamble','snappyTestLiteralTag']});
const hex=bytes=>Buffer.from(bytes).toString('hex')||'-';
const raw=text=>h.raw(text==='-'?'':text);
const evaluate=([op,...a])=>{
  if(op==='encode')return h.text(h.e.snappyTestEncode(raw(a[0])));
  if(op==='decode')return h.text(h.e.snappyTestDecode(h.toBytes(a[0]),raw(a[1])));
  if(op==='preamble')return h.text(h.e.snappyTestPreamble(raw(a[0])));
  return h.text(h.e.snappyTestLiteralTag(h.toBytes(a[0])));
};
const tag=n=>{
  if(n<=60)return Buffer.from([(n-1)*4]);
  const width=n<=256?1:n<=65536?2:n<=16777216?3:4;
  const tail=Buffer.alloc(4);tail.writeUInt32LE(n-1);return Buffer.concat([Buffer.from([(59+width)*4]),tail.subarray(0,width)]);
};
const block=bytes=>Buffer.concat([Buffer.from(uleb(bytes.length),'hex'),...(bytes.length?[tag(bytes.length),bytes]:[])]);
test('Literal encoding preserves empty blocks and all length-tag transitions',()=>{
  const rows=[];
  for(const n of [0,1,59,60,61,255,256,257,65535,65536,65537]){
    const bytes=Buffer.from(Array.from({length:n},(_,i)=>(i*53+17)&255));
    rows.push(['encode',hex(bytes)]);
    assert.equal(evaluate(['decode',String(n),hex(block(bytes))]),'ok:'+bytes.toString('hex'));
  }
  for(const n of [1,2,59,60,61,255,256,257,65535,65536,65537,16777215,16777216,16777217,4294967295,4294967296])rows.push(['tag',String(n)]);
  h.compare(rows,evaluate,{requireSuccess:true});
});
test('Preambles preserve nonminimal forms, tenth-byte truncation and overflow precedence',()=>{
  const rows=[];
  for(let n=0;n<=12;n++){
    for(const last of [null,0,1,2,127,128,129,254,255]){
      const bytes=Buffer.from([...Array(n).fill(128),...(last===null?[]:[last])]);
      rows.push(['preamble',hex(bytes)]);
      for(const max of ['-1','0','1','4294967295'])rows.push(['decode',max,hex(bytes)]);
    }
  }
  for(const n of [1,127,128,65536,4294967295,4294967296,34359738367]){
    const bytes=Buffer.from(uleb(n),'hex');rows.push(['preamble',hex(bytes)]);
  }
  rows.push(['decode','3',hex([131,...Array(8).fill(128),2,8,97,98,99])]);
  h.compare(rows,evaluate);
  assert.equal(evaluate(rows.at(-1)),'ok:616263');
});
test('All tag classes enforce bounds and copy overlap with exact source errors',()=>{
  const rows=[],add=(bytes,max='10000')=>rows.push(['decode',max,hex(bytes)]);
  const valid=[Buffer.from('0500610101','hex'),Buffer.from('0a0461621e0200','hex'),
    Buffer.from([65,0,97,255,1,0,0,0])];
  for(const bytes of valid){
    add(bytes);for(let n=0;n<bytes.length;n++)add(bytes.subarray(0,n));
    for(let i=0;i<bytes.length;i++){const changed=Buffer.from(bytes);changed[i]^=128;add(changed);}
  }
  for(let value=0;value<256;value++){
    add([8,value]);add([8,value,0,0,0,0]);add([8,0,97,value,1,0,0,0]);
  }
  for(const n of [0,1,3,60,61,255,256,257]){
    const bytes=block(Buffer.alloc(n,97));add(bytes,String(n));add(bytes,String(n-1));
    for(const tail of [[0],[1,1],[240,255],[254,255,255]])add(Buffer.concat([bytes,Buffer.from(tail)]));
  }
  let state=0x12345678;
  for(let i=0;i<160;i++){
    const bytes=Buffer.alloc(i%27);for(let j=0;j<bytes.length;j++){state=(Math.imul(state,1664525)+1013904223)>>>0;bytes[j]=state>>>24;}add(bytes);
  }
  h.compare(rows,evaluate);
  assert.equal(evaluate(['decode','5',hex(valid[0])]),'ok:6161616161');
  assert.equal(evaluate(['decode','10',hex(valid[1])]),'ok:'+Buffer.from('ababababab').toString('hex'));
});
