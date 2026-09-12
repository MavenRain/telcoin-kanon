import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {harness,header,sequence,u16,u64,hash} from './harness.mjs';
import {driverOracleSources} from './driver-oracle-sources.mjs';
import {batchWire} from './batch-validator-vectors.mjs';
import {word,scalar,wire,txFields} from './transaction-vectors.mjs';
const parts=readFileSync(new URL('./driver-pipeline-oracle.ml',import.meta.url),'utf8').split('\nlet run = function\n');
assert.equal(parts.length,2);
// The measured declaration check alone exceeded ten minutes on the development host.
const h=await harness({name:'engine-integration',...driverOracleSources,compilerTimeoutMs:1800000,
  modules:[...driverOracleSources.modules,'driver_fixture_helpers.ml'],
  extraAliases:{...driverOracleSources.extraAliases,'driver_fixture_helpers.ml':parts[0]},
  oracle:'test/engine-integration-oracle.ml',fixtures:['test/crypto.kan','test/execution.kan','test/state.kan',
    'test/evm-core.kan','test/evm-env.kan','test/engine-state.kan','test/driver-pipeline.kan','test/driver-resume.kan','test/engine-integration.kan'],
  exports:['engineTestIntegration','engineIntegrationEmptyAlloc','engineIntegrationFund','engineIntegrationMakeSpec']});
const evaluate=([op,members,dags,bodies,funds,mode,cancun,prague,prefix,code])=>{
  const alloc=(funds==='-'?[]:funds.split(',')).reverse().reduce((tail,entry)=>
    h.e.engineIntegrationFund(...entry.split(':').map(h.raw),tail),h.e.engineIntegrationEmptyAlloc());
  const spec=h.e.engineIntegrationMakeSpec(alloc,Number(mode),Number(cancun),Number(prague),h.raw(code==='-'?'':code));
  return h.text(h.e.engineTestIntegration(h.seeds(members),h.raw(dags),h.raw(bodies),Number(prefix),spec));
};
const batch=options=>batchWire(options).slice(0,-66);
const dag=(time,bodies=[])=>sequence([header({seed:1,epoch:0,round:time,time,
  payload:bodies.map((body,i)=>'20'+hash(body)+u16(i)).sort()})])+'0000'+u64(time)+'20'+'00'.repeat(32);
const row=(dags,bodies,options={})=>['integration','1,2',sequence(dags),sequence(bodies),options.funds??'-',
  String(options.mode??0),String(options.cancun??0),String(options.prague??0),String(options.prefix??0),'-'];
const descriptions=raw=>raw.split('~').slice(1).map(part=>part.split('#')[1]).join('');
test('Explicit fork schedules reach live execution and checkpoint replay at each block timestamp',()=>{
  const body=batch({}),dags=[10,11,12].map(time=>dag(time,[body]));
  const settings=[{mode:0},{mode:1},{mode:2,cancun:10},{mode:2,cancun:11},
    {mode:3,cancun:10,prague:11},{mode:3,cancun:11,prague:12},{mode:3,cancun:0,prague:0}];
  const rows=settings.flatMap(options=>[0,1,3].map(prefix=>row(dags,[body],{...options,prefix})));
  h.compare(rows,evaluate,{requireSuccess:true});
  for(const prefix of [0,1,3]){
    assert.equal(descriptions(evaluate(row(dags,[body],{mode:1,prefix}))),
      '[10:shanghai:pre-prague:0:][11:shanghai:pre-prague:0:][12:shanghai:pre-prague:0:]');
    assert.equal(descriptions(evaluate(row(dags,[body],{mode:3,cancun:11,prague:12,prefix}))),
      '[10:shanghai:pre-prague:0:][11:written:pre-prague:0:][12:written:written:0:]');
    assert.equal(evaluate(row(dags,[body],{mode:0,prefix})),evaluate(row(dags,[body],{mode:3,cancun:0,prague:0,prefix})));
  }
});
const oracle=row=>{
  const result=h.runOracle([],row.join(' ')+'\n');assert.equal(result.status,0,result.error?.message??result.stderr);
  return result.stdout.trimEnd();
};
const sender='7e5f4552091a69125d5dfcb7b8c2659029395bdf',target='00'.repeat(18)+'0200';
const funds=`${sender}:${word(1000000000000n)}:`;
const signTx=({data='',nonce=0n}={})=>{
  const fields=txFields(2),order=0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const gx=0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
  [fields[0],fields[1],fields[2],fields[3],fields[4],fields[5],fields[6],fields[7],fields[8],fields[9],fields[10],fields[11]]=
    [scalar(42),scalar(nonce),scalar(1),scalar(100),scalar(100000),target,scalar(0),data,[],'','01','01'];
  const digest=oracle(['signing-hash',wire(2,fields)]);assert.match(digest,/^[a-f0-9]{64}$/);
  let s=(BigInt('0x'+digest)+gx)%order,parity=0n;
  if(s>order/2n){s=order-s;parity=1n;}
  fields[9]=scalar(parity);fields[10]=scalar(gx);fields[11]=scalar(s);return wire(2,fields);
};
test('Engine skips cross-batch duplicate and unfunded transactions and drops non-executable payloads',()=>{
  const tx=signTx(),bodies=[batch({txs:[tx]}),batch({txs:[tx],worker:1,fee:8n})];
  const duplicate=[0,1,2].map(mode=>row([dag(10,bodies)],bodies,{funds,mode,prefix:1}));
  const rejected=row([dag(10,[bodies[0]])],[bodies[0]],{prefix:1});
  const raw=batch({txs:['ff','01']});
  const dropped=row([dag(10,[raw])],[raw],{prefix:1});
  h.compare([...duplicate,rejected,dropped],evaluate,{requireSuccess:true});
  for(const request of duplicate){
    const details=descriptions(evaluate(request));
    assert.match(details,/transaction 0 skipped:.*nonce/i);
    assert.equal((details.match(/21000:/g)??[]).length,1);
  }
  assert.match(descriptions(evaluate(rejected)),/transaction 0 skipped:/);
  assert.equal(descriptions(evaluate(dropped)),'[10:written:written:0:]');
});
test('The Prague calldata floor changes gas charged through the full engine and replay path',()=>{
  const tx=signTx({data:'ff'.repeat(32)}),body=batch({txs:[tx]});
  const rows=[0,1].flatMap(prefix=>[0,2].map(mode=>row([dag(10,[body])],[body],{funds,mode,prefix})));
  h.compare(rows,evaluate,{requireSuccess:true});
  for(const request of rows) assert.match(descriptions(evaluate(request)),new RegExp(request[5]==='0'?':22280:':':21512:'));
});
