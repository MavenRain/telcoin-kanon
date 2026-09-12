import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,protocolSources,protocolModules,header,u16,u32,u64,uleb,sequence} from './harness.mjs';
const consensus=['dag','reputation_scores','sub_dag','committed_log','leader_schedule','bullshark','proposer','voter','vote_aggregator','parent_aggregator','node'];
const network=['var_bytes','bls_public_key','bls_signature','wire_scalar','roaring','vote_wire','certificate_wire','epoch_vote','consensus_result','epoch_record','epoch_certificate','peer_exchange','primary_msg','worker_msg','base58','gossip','wire'];
const h=await harness({name:'network-routing',sources:[...protocolSources,'lib/std/nonempty.ml','lib/types/leader_round.ml','lib/rand/chacha12.ml','lib/rand/std_rng.ml',
  ...consensus.map(n=>`lib/consensus/${n}.ml`),'lib/snappy/byte_reader.ml',...network.map(n=>`lib/network/${n}.ml`)],
  modules:[...protocolModules,'nonempty.ml','tn_std.ml','leader_round.ml','chacha12.ml','std_rng.ml','tn_rand.ml',...consensus.map(n=>`${n}.ml`),
    'tn_consensus.ml','byte_reader.ml','tn_snappy.ml',...network.map(n=>`${n}.ml`)],
  extraAliases:{'tn_std.ml':['Nonempty'],'tn_rand.ml':['Std_rng'],'tn_consensus.ml':['Node'],'tn_snappy.ml':['Byte_reader']},
  oracle:'test/network-routing-oracle.ml',fixtures:['test/crypto.kan','test/network-routing.kan'],exports:['networkRoutingIngress','networkRoutingOutbound','networkRoutingRetry']});
const raw=s=>h.raw(s==='-'?'':s);
const evaluate=([op,...a])=>h.text(op==='in'?h.e.networkRoutingIngress(Number(a[0]),h.seeds(a[1]),h.toBytes(a[2]),h.toBytes(a[3]),raw(a[4]),raw(a[5])):
  op==='out'?h.e.networkRoutingOutbound(Number(a[0]),h.seeds(a[1]),h.toBytes(a[2]),h.toBytes(a[3]),raw(a[4]),raw(a[5]),h.seeds(a[6])):
  h.e.networkRoutingRetry(raw(a[0]),raw(a[1])));
const bytes=s=>uleb(s.length/2)+s;
const hex=s=>Buffer.from(s).toString('hex');
const digest=(n=0)=>bytes(n.toString(16).padStart(64,'0'));
const key=(n=0)=>bytes(n.toString(16).padStart(192,'0'));
const sig=(n=0)=>bytes(n.toString(16).padStart(96,'0'));
const authority=(n=0)=>n.toString(16).padStart(64,'0');
const bitmap=values=>bytes(values.length?u32(12346)+u32(1)+u16(0)+u16(values.length-1)+u32(16)+values.map(u16).join(''):u32(12346)+u32(0));
const certificate=(seed=1,round=0,indices=[],state=4)=>header({seed,round})+uleb(state)+(state===4?'':sig())+bitmap(indices);
const vote=digest()+u32(0)+u32(0)+authority()+authority()+sig();
const epochRecord=u32(0)+'0000'+digest()+u64(0)+digest()+u64(0)+digest();
const epochCert=digest()+sig()+bitmap([]);
const gossipConsensus='01'+u32(0)+u32(0)+u64(0)+digest()+key()+sig();
const gossipEpoch='02'+u32(0)+digest()+key()+sig();
const gossipWorker='00'+u32(0)+digest();
const ingress=(mode,wire,{roster='1,2,3,4',chain='2017',sender='99',topic='tn-primary-2017'}={})=>['in',String(mode),roster,String(chain),String(sender),hex(topic)||'-',wire||'-'];
test('Node ingress maps all wire families and reports precise unmapped variants',()=>{
  const rows=[];
  for(const roster of ['1,2,3,4','4,3,2,1']){
    for(const request of ['00'+header({seed:99,round:9})+'00','0100','020000','0201'+u32(0)+'01'+digest()])rows.push(ingress(0,request,{roster}));
    for(const response of ['00'+vote,'01'+sequence([digest(1),digest(0),digest(1)]),'02'+epochRecord+epochCert,'0300','0400','0500'])rows.push(ingress(1,response,{roster}));
    for(const payload of ['00'+certificate(),gossipConsensus,gossipEpoch])rows.push(ingress(3,payload,{roster}));
    rows.push(ingress(4,gossipWorker,{roster}));
  }
  for(const topic of ['tn-primary-2017','tn-consensus-output-2017','tn-epoch-vote-2017','tn-worker-2017','unknown',''])
    for(const payload of ['00'+certificate(),gossipConsensus,gossipEpoch,gossipWorker,'ff'])rows.push(ingress(2,payload,{topic}));
  h.compare(rows,evaluate);
  assert.match(evaluate(ingress(0,'00'+header({seed:99,round:9})+'00')),/^request:/);
  assert.equal(evaluate(ingress(1,'0100')),'unmapped:missing-response');
  assert.match(evaluate(ingress(2,'00'+certificate())),/^certificate:/);
});
test('Checked parent traversal preserves order and returns the first certificate refusal',()=>{
  const rows=[];
  const good=certificate(),other=certificate(2),unknown=certificate(1,0,[9]),nonGenesis=certificate(1,1),signed=certificate(1,0,[],0);
  for(const parents of [[],[good],[other,good],[good,good],[unknown,nonGenesis],[nonGenesis,unknown],[good,signed,unknown],[good,unknown,signed]]){
    rows.push(ingress(0,'00'+header({seed:1,round:1})+sequence(parents)));
    rows.push(['retry',header({seed:1,round:1}),sequence(parents)]);
  }
  for(let state=0;state<5;state++)for(const indices of [[],[0,2],[9]])rows.push(ingress(3,'00'+certificate(1,0,indices,state)));
  h.compare(rows,evaluate);
  assert.match(evaluate(ingress(0,'00'+header({seed:1,round:1})+sequence([unknown,nonGenesis]))),/committee position 9$/);
  assert.match(evaluate(ingress(0,'00'+header({seed:1,round:1})+sequence([nonGenesis,unknown]))),/not genesis$/);
});
test('All node command variants fan out, respond, publish or remain local in source order',()=>{
  const rows=[];
  for(const roster of ['1,2,3,4','4,3,2,1','1,2,3,4,5'])for(const chain of [-4611686018427387904n,-1,2017,4611686018427387903n])
    for(let mode=0;mode<8;mode++)rows.push(['out',String(mode),roster,String(chain),'1',header({seed:1,round:0}),sequence([digest(2),digest(1),digest(2)]),'1,3']);
  for(const signers of ['empty','1,1,2','99','1,99'])for(const mode of [3,6])
    rows.push(['out',String(mode),'1,2,3,4','2017','1',header({seed:1,round:0}),'00',signers]);
  h.compare(rows,evaluate);
  const broadcast=rows[0];assert.equal(evaluate(broadcast).split(';').filter(Boolean).length,4);
  for(const mode of [4,5,7])assert.equal(evaluate(['out',String(mode),'1,2,3,4','2017','1',header({seed:1,round:0}),'00','empty']),'local;');
  assert.match(evaluate(['out','3','1,2,3,4','2017','1',header({seed:1,round:0}),'00','empty']),/^publish:/);
});
