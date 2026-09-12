import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,uleb} from './harness.mjs';
const h=await harness({name:'snappy-frame',sources:['lib/snappy/byte_reader.ml','lib/snappy/crc32c.ml','lib/snappy/snappy_raw.ml','lib/snappy/snappy_frame.ml'],
  modules:['byte_reader.ml','crc32c.ml','snappy_raw.ml','snappy_frame.ml'],oracle:'test/snappy-frame-oracle.ml',
  fixtures:['test/snappy-primitives.kan','test/snappy-frame.kan'],exports:['snappyTestCompress','snappyTestDecompress']});
const hex=bytes=>Buffer.from(bytes).toString('hex')||'-';
const raw=text=>h.raw(text==='-'?'':text);
const evaluate=([op,...a])=>op==='compress'?h.text(h.e.snappyTestCompress(raw(a[0])))
  :h.text(h.e.snappyTestDecompress(h.toBytes(a[0]),raw(a[1])));
const crc=bytes=>{
  let register=0xffffffff;
  for(const byte of bytes){register^=byte;for(let i=0;i<8;i++)register=(register>>>1)^((register&1)?0x82f63b78:0);}
  const value=(register^0xffffffff)>>>0;
  return (((value>>>15)|(value<<17))+0xa282ead8)>>>0;
};
const chunk=(type,body,declared=body.length)=>{
  const header=Buffer.alloc(4);header[0]=type;header.writeUIntLE(declared,1,3);return Buffer.concat([header,body]);
};
const stream=chunk(255,Buffer.from('sNaPpY'));
const dataChunk=(data,compressed)=>{
  const checksum=Buffer.alloc(4);checksum.writeUInt32LE(crc(data));
  return chunk(compressed?0:1,Buffer.concat([checksum,compressed??data]));
};
test('Framing emits the exact stream identifier and 64 KiB uncompressed chunks',()=>{
  const rows=[];
  for(const n of [0,1,60,1024,65535,65536,65537,131073]){
    const data=Buffer.from(Array.from({length:n},(_,i)=>(i*31+7)&255));
    rows.push(['compress',hex(data)]);
    const chunks=[stream];for(let offset=0;offset<n;offset+=65536)chunks.push(dataChunk(data.subarray(offset,offset+65536)));
    const expected=Buffer.concat(chunks);
    assert.equal(evaluate(['compress',hex(data)]),expected.toString('hex'));
    assert.equal(evaluate(['decompress',String(n),hex(expected)]),'ok:'+data.toString('hex'));
  }
  h.compare(rows,evaluate,{requireSuccess:true});
});
test('Decompression checks complete chunks and CRCs before truncating the output cap',()=>{
  const a=Buffer.from('aaaaa'),b=Buffer.from('bc'),first=dataChunk(a,Buffer.from('0500610101','hex'));
  const valid=Buffer.concat([stream,first,dataChunk(b)]),rows=[];
  const add=(bytes,max='65536')=>rows.push(['decompress',max,hex(bytes)]);
  for(const maximum of ['-4611686018427387904','-1','0','1','4','5','6','7','8','4611686018427387903'])add(valid,maximum);
  for(let n=0;n<valid.length;n++)add(valid.subarray(0,n));
  for(let i=0;i<valid.length;i++){const bad=Buffer.from(valid);bad[i]^=128;add(bad);}
  for(const suffix of [Buffer.from([2]),chunk(2,Buffer.alloc(0)),chunk(255,Buffer.from('broken')),chunk(128,Buffer.alloc(0),3)]){
    const frame=Buffer.concat([stream,first,suffix]);add(frame,'5');add(frame,'6');
    assert.equal(evaluate(['decompress','5',hex(frame)]),'ok:6161616161');
  }
  const badCrc=Buffer.from(first);badCrc[4]^=1;
  add(Buffer.concat([stream,badCrc]),'1');
  assert.match(evaluate(rows.at(-1)),/^error:snappy frame: checksum/);
  for(const data of [Buffer.from(''),a,b])add(Buffer.concat([stream,dataChunk(data),stream,dataChunk(data)]));
  h.compare(rows,evaluate);
});
test('Chunk dispatch, length ceilings and raw errors preserve reference error precedence',()=>{
  const rows=[],add=(bytes,max='100000')=>rows.push(['decompress',max,hex(bytes)]);
  for(let kind=0;kind<256;kind++){
    const bytes=chunk(kind,Buffer.alloc(0));add(bytes);add(Buffer.concat([stream,bytes]));
  }
  for(const kind of [0,1,2,127,128,254,255])for(const declared of [0,1,3,4,5,6,65536,65540,65541,76490,76491,16777215]){
    for(const body of [Buffer.alloc(0),Buffer.alloc(4),Buffer.from('sNaPpY')]){
      add(chunk(kind,body,declared));add(Buffer.concat([stream,chunk(kind,body,declared)]));
    }
  }
  for(const block of [[],[128],[1],[1,1,0],[5,0,97,1,0],[1,4,97,98],Buffer.from(uleb(65537),'hex')]){
    add(Buffer.concat([stream,chunk(0,Buffer.concat([Buffer.alloc(4),Buffer.from(block)]))]));
  }
  for(const kind of [1,128,254]){
    add(Buffer.concat([stream,chunk(kind,Buffer.alloc(65541))]));
    add(Buffer.concat([stream,chunk(kind,Buffer.alloc(76490))]));
  }
  h.compare(rows,evaluate);
});
