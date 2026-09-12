import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {harness} from './harness.mjs';
const h=await harness({name:'durable-frame',sources:['lib/durable/frame.ml'],modules:['frame.ml'],
  oracle:'test/durable-frame-oracle.ml',fixtures:['test/durable-frame.kan'],
  exports:['frameTestHash','frameTestEncode','frameTestDecode','frameTestScan','frameTestSize']});
const hex=bytes=>Buffer.from(bytes).toString('hex')||'-';
const raw=text=>h.raw(text==='-'?'':text);
const evaluate=([op,...a])=>{
  if(op==='hash')return h.text(h.e.frameTestHash(raw(a[0])));
  if(op==='size')return h.text(h.e.frameTestSize(h.toBytes(a[0])));
  if(op==='encode')return h.text(h.e.frameTestEncode(Number(a[0]),h.toBytes(a[1]),raw(a[2])));
  if(op==='decode')return h.text(h.e.frameTestDecode(raw(a[0]),h.toBytes(a[1]),h.toBytes(a[2])));
  return h.text(h.e.frameTestScan(raw(a[0]),h.toBytes(a[1])));
};
const tag=bytes=>createHash('blake2b512').update(bytes).digest().subarray(0,8);
const frame=(payload,seq=0n,kind=1)=>{
  const body=Buffer.from(payload),prefix=Buffer.alloc(16),echo=Buffer.alloc(4);
  prefix.writeUInt32BE(body.length);prefix[4]=kind;prefix.writeBigUInt64BE(BigInt.asUintN(63,seq),8);
  echo.writeUInt32BE(body.length);
  return Buffer.concat([prefix,tag(prefix),body,tag(body),echo,Buffer.from('TNCE')]);
};
const change=(input,offset,value)=>{const copy=Buffer.from(input);copy[offset]=value;return copy;};
const retag=input=>Buffer.concat([input.subarray(0,16),tag(input.subarray(0,16)),input.subarray(24)]);
test('BLAKE2b-512 matches OCaml Digestif and OpenSSL across blocks',()=>{
  const rows=[0,1,3,63,64,65,127,128,129,255,256,257,511,512,513,1024].map(length=>
    ['hash',hex(Buffer.from(Array.from({length},(_,i)=>(i*37+19)&255)))]);
  rows.push(['hash',hex('abc')]);
  h.compare(rows,evaluate,{requireSuccess:true});
  for(const row of rows)assert.equal(evaluate(row),createHash('blake2b512').update(Buffer.from(row[1]==='-'?'':row[1],'hex')).digest('hex'));
});
test('Frame encoding preserves kinds, signed sequence bits, and native size arithmetic',()=>{
  const rows=[];
  for(const kind of ['1','2'])for(const seq of ['0','1','255','4294967296','4611686018427387903','-1','-4611686018427387904']){
    for(const payload of ['-',hex('a'),hex('frame payload'),hex(Buffer.alloc(128,0xa5))])rows.push(['encode',kind,seq,payload]);
  }
  for(const size of ['-4611686018427387904','-41','-40','-1','0','1','16777216','4611686018427387903'])rows.push(['size',size]);
  h.compare(rows,evaluate,{requireSuccess:true});
});
test('Frame decode checks truncation, field damage, and sequence in OCaml order',()=>{
  const valid=frame('abc'),rows=[];
  for(let length=0;length<valid.length;length++)rows.push(['decode',hex(valid.subarray(0,length)),'0','0']);
  for(let offset=0;offset<valid.length;offset++)rows.push(['decode',hex(change(valid,offset,valid[offset]^0x80)),'0','0']);
  for(const seq of [0n,1n,-1n,4611686018427387903n,-4611686018427387904n]){
    for(const expected of [0n,seq])rows.push(['decode',hex(frame('a',seq)),'0',String(expected)]);
  }
  for(const at of ['-4611686018427387904','-25','-1','0','1','42','43','44','4611686018427387903'])rows.push(['decode',hex(valid),at,'0']);
  const empty=frame(''),oversize=Buffer.from(valid);oversize.writeUInt32BE(16777217);
  const zero=Buffer.from(valid);zero.writeUInt32BE(0);
  rows.push(['decode',hex(empty),'0','0'],['decode',hex(oversize),'0','0'],['decode',hex(zero),'0','0']);
  const badKind=retag(change(valid,4,3)),badBody=change(valid,24,0),badEcho=change(valid,valid.length-5,9),badMagic=change(valid,valid.length-1,0);
  for(const buf of [badKind,badBody,badEcho,badMagic,retag(change(valid,5,255))])rows.push(['decode',hex(buf),'0','99']);
  rows.push(['decode',hex(Buffer.concat([Buffer.from('padding'),valid,Buffer.from('tail')])),'7','0']);
  h.compare(rows,evaluate);
});
test('Frame scans distinguish torn tails, interior corruption, and spliced sequences',()=>{
  const first=frame('a'),second=frame('bb',1n,2),third=frame('ccc',2n),rows=[];
  const whole=Buffer.concat([first,second,third]);
  for(const from of ['-9','0','1','41',String(whole.length),String(whole.length+1),'4611686018427387903'])rows.push(['scan',hex(whole),from]);
  for(let length=0;length<second.length;length++)rows.push(['scan',hex(Buffer.concat([first,second.subarray(0,length)])),'0']);
  for(const offset of [0,4,16,24,25,second.length-5,second.length-1]){
    const damaged=change(second,offset,second[offset]^0x80);
    rows.push(['scan',hex(Buffer.concat([first,damaged])),'0'],['scan',hex(Buffer.concat([first,damaged,third])),'0']);
  }
  for(const seq of [0n,1n,2n,3n,-1n])rows.push(['scan',hex(Buffer.concat([first,frame('bb',seq)])),'0']);
  rows.push(['scan','-','0'],['scan','-','100'],['scan',hex(Buffer.concat([Buffer.from('prefix'),whole])),'6']);
  rows.push(['scan',hex(Buffer.concat([first,Buffer.from('broken'),frame('old',0n)])),'0']);
  rows.push(['scan',hex(Buffer.concat([first,Buffer.from('broken'),frame('new',2n)])),'0']);
  h.compare(rows,evaluate);
  assert.match(evaluate(['scan',hex(Buffer.concat([first,frame('jump',2n)])),'0']),/\|corrupt:41:41:/);
  assert.match(evaluate(['scan',hex(Buffer.concat([first,Buffer.from('broken'),frame('old',0n)])),'0']),/\|torn:41:/);
});
