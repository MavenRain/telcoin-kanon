import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,protocolSources,protocolModules,u16,u32,u64,uleb,sequence} from './harness.mjs';
const names=['var_bytes','bls_public_key','bls_signature','wire_scalar','roaring','vote_wire','certificate_wire','epoch_vote','consensus_result','epoch_record','epoch_certificate','peer_exchange','primary_msg','worker_msg','base58','gossip'];
const h=await harness({name:'network-messages',sources:[...protocolSources,'lib/snappy/byte_reader.ml',...names.map(n=>`lib/network/${n}.ml`)],
  modules:[...protocolModules,'byte_reader.ml','tn_snappy.ml',...names.map(n=>`${n}.ml`)],extraAliases:{'tn_snappy.ml':['Byte_reader']},
  oracle:'test/network-messages-oracle.ml',fixtures:['test/state.kan','test/network-records.kan','test/network-messages.kan'],
  exports:['networkMessageTestRecord','networkGossipTestTopic','networkGossipTestMessageId','networkGossipTestDecode','networkGossipTestAuth']});
const raw=s=>h.raw(s==='-'?'':s);
const evaluate=([op,...a])=>h.text(op==='record'?h.e.networkMessageTestRecord(Number(a[0]),raw(a[1]),raw(a[2])):
  op==='topic'?h.e.networkGossipTestTopic(h.toBytes(a[0]),Number(a[1]),raw(a[2])):
  op==='id'?h.e.networkGossipTestMessageId(raw(a[0])):
  op==='gossip'?h.e.networkGossipTestDecode(h.toBytes(a[0]),raw(a[1]),raw(a[2])):
  h.e.networkGossipTestAuth(h.toBytes(a[0]),raw(a[1]),raw(a[2]),Number(a[3])));
const bytes=s=>uleb(s.length/2)+s;
const hex=s=>Buffer.from(s).toString('hex');
const text=s=>bytes(hex(s));
const digest=(n=0)=>bytes(n.toString(16).padStart(64,'0'));
const key=(n=0)=>bytes(n.toString(16).padStart(192,'0'));
const sig=(n=0)=>bytes(n.toString(16).padStart(96,'0'));
const authority=(n=0)=>n.toString(16).padStart(64,'0');
const header=(n=0)=>authority(n)+u32(n)+u32(n)+u64(n)+'0000'+u64(n)+digest(n);
const bitmap=bytes(u32(12346)+u32(0));
const cert=(n=0)=>header(n)+'04'+bitmap;
const epochCert=(n=0)=>digest(n)+sig(n)+bitmap;
const epochRecord=(n=0)=>u32(n)+'0000'+digest(n)+u64(n)+digest(n)+u64(n)+digest(n);
const vote=(n=0)=>digest(n)+u32(n)+u32(n)+authority(n)+authority(n+1)+sig(n);
const epochVote=(n=0)=>u32(n)+digest(n)+key(n)+sig(n);
const consensus=(n=0)=>u32(n)+u32(n)+u64(n)+digest(n)+key(n)+sig(n);
const peer=(n=0)=>sequence([key(n)+bytes('ff')+sequence([bytes('ff'),bytes('00')])]);
const batch=(n=0)=>sequence([bytes('01')])+u32(n)+bytes('00'.repeat(20))+u64(n)+u16(0);
const requests=n=>['00'+header(n)+sequence([cert(n),cert(n)]),'01'+peer(n),'020000','0201'+u32(n)+'01'+digest(n),'020001'+digest(n),'0201'+u32(n)+'00'];
const responses=n=>['00'+vote(n),'01'+sequence([digest(n),digest(n)]),'02'+epochRecord(n)+epochCert(n),'03'+peer(n),'04'+text('message π'),'05'+text('try again')];
const gossip=n=>['00'+cert(n),'01'+consensus(n),'02'+epochVote(n)];
const workerReq=n=>['00'+batch(n)+digest(n),'01'+peer(n)];
const workerRes=n=>['00','01'+peer(n),'02'+text('error π'),'03'+text('retry')];
const workerGossip=n=>'00'+u32(n)+digest(n);
const row=(kind,left,right=left)=>['record',String(kind),left||'-',right||'-'];
test('All primary and worker request, response and gossip variants preserve fields and equality',()=>{
  const rows=[];
  for(const n of [0,1,4294967295]){
    for(const [kind,values] of [[0,requests(n)],[1,responses(n)],[2,gossip(n)],[3,workerReq(n)],[4,workerRes(n)],[5,[workerGossip(n)]]])
      for(const a of values)for(const b of values)rows.push(row(kind,a,b));
    for(const cap of [0n,9223372036854775808n,18446744073709551615n])rows.push(row(6,u32(n)+sequence([authority(n)+bytes('ff00'),authority(n)+bytes('ff')])+u64(cap)));
  }
  rows.push(row(0,'00'+header()+sequence([]),'00'+header()+sequence([cert()])));
  rows.push(row(3,'00'+batch(0)+digest(1),'00'+batch(1)+digest(1)),row(3,'00'+batch(0)+digest(0),'00'+batch(0)+digest(1)));
  h.compare(rows,evaluate,{requireSuccess:true});
  assert.ok(evaluate(rows.at(-1)).endsWith(':false'));
});
test('Message codecs preserve BCS truncation, malformed UTF-8, optional fields and variant errors',()=>{
  const rows=[];
  for(const [kind,values] of [[0,requests(1)],[1,responses(1)],[2,gossip(1)],[3,workerReq(1)],[4,workerRes(1)],[5,[workerGossip(1)]]]){
    for(const wire of values){for(let at=0;at<wire.length;at+=2)rows.push(row(kind,wire.slice(0,at)));rows.push(row(kind,wire+'00'));}
    for(const wire of ['ff','8000','06','ffffffff0f'])rows.push(row(kind,wire));
  }
  for(const wire of ['0401ff','0502c080','0503eda080'])rows.push(row(1,wire));
  for(const wire of ['0201ff','0302c080','0304f4908080'])rows.push(row(4,wire));
  for(const wire of ['0202','020002','02010203000002'])rows.push(row(0,wire));
  h.compare(rows,evaluate);
});
test('Gossip topics preserve signed chain IDs and all three primary topics share their source codec',()=>{
  const rows=[];
  for(const chain of [-4611686018427387904n,-1,0,2017,4611686018427387903n])for(let k=0;k<4;k++)
    for(const topic of [`tn-primary-${chain}`,`tn-consensus-output-${chain}`,`tn-epoch-vote-${chain}`,`tn-worker-${chain}`,'tn-primary-02017','unknown'])
      rows.push(['topic',String(chain),String(k),hex(topic)]);
  for(const topic of ['tn-primary-2017','tn-consensus-output-2017','tn-epoch-vote-2017','tn-worker-2017'])for(const wire of [...gossip(0),workerGossip(0),'ff',''])
    rows.push(['gossip','2017',hex(topic),wire||'-']);
  for(let byte=0;byte<256;byte++)rows.push(['gossip','2017',byte.toString(16).padStart(2,'0'),'ff']);
  h.compare(rows,evaluate);
  assert.equal(evaluate(['gossip','2017',hex('tn-epoch-vote-2017'),gossip(0)[0]]),'primary:'+gossip(0)[0]);
});
test('Gossip message IDs use fallback source bytes and unsigned full-width sequence numbers',()=>{
  const rows=[];
  for(const source of [null,'','00','000100','ff',Buffer.from(Array.from({length:256},(_,i)=>i)).toString('hex')])
    for(const number of [null,0n,1n,9223372036854775808n,18446744073709551615n])
      rows.push(['id',(source===null?'00':'01'+bytes(source))+(number===null?'00':'01'+u64(number))]);
  h.compare(rows,evaluate,{requireSuccess:true});
  assert.equal(evaluate(['id','010001'+u64(18446744073709551615n)]),'18446744073709551615');
  assert.equal(evaluate(['id','0000']),'15R0');
});
test('Gossip admission and penalties preserve source presence, first topic entry and size-first attribution',()=>{
  const rows=[];
  const topic=hex('topic');
  const policy=(name,keys)=>bytes(hex(name))+(keys===null?'00':'01'+sequence(keys.map(key)));
  const policies=[[],[policy('topic',null)],[policy('topic',[])],[policy('topic',[0,1,0])],[policy('other',null)],
    [policy('topic',null),policy('topic',[])],[policy('topic',[]),policy('topic',null)]];
  for(const entries of policies)for(const source of [null,'','ff'])for(const author of [null,0,1,2])
    for(const size of [-4611686018427387904n,-1,12000,12001,4611686018427387903n])for(let resolved=0;resolved<4;resolved++){
      const wire=(source===null?'00':'01'+bytes(source))+(author===null?'00':'01'+key(author))+sequence(entries);
      rows.push(['auth',String(size),topic,wire,String(resolved)]);
    }
  h.compare(rows,evaluate,{requireSuccess:true});
  assert.equal(evaluate(['auth','12001',topic,'000000','3']),'false|large:relayer');
  assert.equal(evaluate(['auth','12000',topic,'000000','3']),'false|unauthorized:author');
  assert.equal(evaluate(['auth','0',topic,'0000'+sequence([policy('topic',null)]),'3']),'false|unauthorized:author');
});
