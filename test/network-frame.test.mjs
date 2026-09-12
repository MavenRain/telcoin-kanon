import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,u32,uleb} from './harness.mjs';
const snappy=['byte_reader','crc32c','snappy_raw','snappy_frame'];
const h=await harness({name:'network-frame',sources:['lib/codec/bcs.ml',...snappy.map(n=>`lib/snappy/${n}.ml`),'lib/network/wire_frame.ml'],
  modules:['bcs.ml','tn_codec.ml',...snappy.map(n=>`${n}.ml`),'tn_snappy.ml','wire_frame.ml'],
  extraAliases:{'tn_snappy.ml':['Byte_reader','Crc32c','Snappy_raw','Snappy_frame']},oracle:'test/network-frame-oracle.ml',
  fixtures:['test/network-frame.kan'],exports:['networkFrameTest']});
const evaluate=([mode,limit,raw])=>h.text(h.e.networkFrameTest(Number(mode),h.toBytes(limit),h.raw(raw==='-'?'':raw)));
const row=(mode,limit,raw='')=>[String(mode),String(limit),raw||'-'];
const pattern=n=>Buffer.from(Array.from({length:n},(_,i)=>(i*31+59)&255)).toString('hex');
const crc=hex=>{
  let c=0xffffffff;
  for(const b of Buffer.from(hex,'hex')){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0x82f63b78:0);}
  c=(c^0xffffffff)>>>0;
  return (((c>>>15)|(c<<17))+0xa282ead8)>>>0;
};
const identifier='ff060000734e61507059';
const frame=payload=>identifier+'01'+u32(payload.length/2+4).slice(0,6)+u32(crc(payload))+payload;
const wire=(payload,declared=payload.length/2)=>{const body=frame(payload);return u32(declared)+u32(body.length/2)+body;};
test('Frame bounds preserve both u32 clamps and header validation order',()=>{
  const rows=[];
  for(const n of [-4611686018427387904n,-1,0,1,5,6,7,1048576,3681400510,3681400511,3681400512,4294967295,4294967296,4611686018427387903n])rows.push(row(0,n));
  for(const maximum of [-1,0,1,128,4294967295,4611686018427387903n]){
    for(const length of [0,1,127,128,3681400511,3681400512,4294967295]){
      for(const compressed of [0,1,32,33,4294967295])rows.push(row(1,maximum,u32(length)+u32(compressed)));
    }
    for(let n=0;n<8;n++)rows.push(row(1,maximum,'ff'.repeat(n)));
  }
  h.compare(rows,evaluate);
  assert.equal(evaluate(row(0,1048576)),'1223370');
  assert.equal(evaluate(row(0,3681400512)),'0');
});
test('Network encoding matches complete Snappy bytes and the message-size gate',()=>{
  const rows=[];
  for(const n of [0,1,7,127,128,1024,65535,65536,65537]){
    const payload=pattern(n);
    for(const mode of [2,4])for(const maximum of [-1,n-1,n,n+8])rows.push(row(mode,maximum,payload));
  }
  h.compare(rows,evaluate);
  assert.equal(evaluate(row(2,1,'ff')),wire('ff'));
});
test('Frame decoding orders corruption errors, honors the take cap and reports consumed bytes',()=>{
  const rows=[],payload=pattern(25),encoded=wire(payload);
  for(let n=0;n<=encoded.length;n+=2)rows.push(row(3,100,encoded.slice(0,n)));
  for(let n=0;n<encoded.length;n+=2){
    const changed=encoded.slice(0,n)+(Number.parseInt(encoded.slice(n,n+2),16)^255).toString(16).padStart(2,'0')+encoded.slice(n+2);
    rows.push(row(3,100,changed));
  }
  for(const declared of [0,1,24,25,26,100])for(const maximum of [-1,0,24,25,100])rows.push(row(3,maximum,wire(payload,declared)));
  for(const suffix of ['ff','00'.repeat(8),encoded])rows.push(row(3,100,encoded+suffix));
  for(const body of ['',identifier,'00','ff000000','02000000',identifier+'02000000'])
    for(const length of [0,1,20])rows.push(row(3,100,u32(length)+u32(body.length/2)+body));
  const short=wire(payload.slice(0,16),1);
  rows.push(row(3,100,short));
  h.compare(rows,evaluate);
  assert.equal(evaluate(row(3,100,short)),payload.slice(0,2)+':'+short.length/2);
  assert.equal(evaluate(row(3,100,encoded+'ff')),payload+':'+encoded.length/2);
});
test('Message decoding separates frame failures from exact BCS payload failures',()=>{
  const rows=[];
  for(const payload of ['', '00','01','01ff','01ff00','80','8000','02ffaa',uleb(128)+pattern(128)]){
    for(const declared of [0,1,payload.length/2,Math.max(0,payload.length/2-1),payload.length/2+1])
      rows.push(row(5,1024,wire(payload,declared)));
  }
  rows.push(row(5,1024,'ff'),row(5,0,wire('01ff')));
  h.compare(rows,evaluate);
  assert.match(evaluate(row(5,1024,wire('01ff',1))),/^error:bcs payload:/);
  assert.match(evaluate(row(5,1024,wire('01ff00'))),/^error:bcs payload:/);
});
