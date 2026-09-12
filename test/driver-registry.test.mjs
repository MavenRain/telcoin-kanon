import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import {harness,header,sequence,uleb,u16,u32,u64,hash} from './harness.mjs';
import {driverOracleSources} from './driver-oracle-sources.mjs';
const helper=file=>{
  const parts=readFileSync(new URL(file,import.meta.url),'utf8').split('\nlet run = function\n');
  assert.equal(parts.length,2);
  return parts[0];
};
const lock=JSON.parse(readFileSync(new URL('../source-lock.json',import.meta.url),'utf8'));
const path='test/registry_genesis.ml';
const source=readFileSync(resolve(process.env.TELCOIN_OCAML_ROOT??lock.upstream.root,path),'utf8');
assert.equal(createHash('sha256').update(source).digest('hex'),lock.upstream.files.find(f=>f.path===path)?.sha256);
const balance=source.match(/let balance_hex = "([0-9a-f]+)"/)[1].padStart(64,'0');
const code=[...source.split('let code_hex =')[1].split('let storage_hex =')[0].matchAll(/"([0-9a-f]*)"/g)].map(m=>m[1]).join('');
const slots=[...source.split('let storage_hex =')[1].matchAll(/\(\s*"([0-9a-f]{64})",\s*"([0-9a-f]{64})"\s*\)/g)].map(m=>m[1]+m[2]);
assert.equal(code.length/2,28381);
assert.ok(slots.length>50);
const registry=u64(0)+balance+uleb(code.length/2)+code+sequence(slots);
const addresses=['0033a370616805b1fd275b7ffab83fc41d665ccb','89dab9f6fdc569c1bcdbd6493f25b7040b55dc79',
  '3518b301b86ceb53b5a3dff62e55cd43ef59d024','efaacf04b92298a88200aa50aa6bb7bfce587b17','7489025dfbaad94f2366d88a62989147d9c8b5d3'];
const h=await harness({name:'driver-registry',...driverOracleSources,
  sources:[...driverOracleSources.sources,path],
  modules:[...driverOracleSources.modules,'registry_genesis.ml','driver_fixture_helpers.ml','driver_resume_helpers.ml'],
  extraAliases:{...driverOracleSources.extraAliases,'driver_fixture_helpers.ml':helper('./driver-pipeline-oracle.ml'),
    'driver_resume_helpers.ml':helper('./driver-resume-oracle.ml')},
  oracle:'test/driver-registry-oracle.ml',fixtures:['test/crypto.kan','test/execution.kan','test/state.kan','test/evm-core.kan',
    'test/evm-env.kan','test/engine-state.kan','test/driver-pipeline.kan','test/driver-resume.kan','test/driver-registry.kan'],
  exports:['driverTestRegistry']});
const cached=new Map();
const evaluate=row=>{
  const key=row.join(' ');
  if(!cached.has(key)){
    const [op,mode,members,next,dags,tail,bodies]=row;
    cached.set(key,h.text(h.e.driverTestRegistry(h.seeds(members),h.seeds(next),h.raw(addresses.join('')),h.raw('be'.repeat(20)),
      h.toBytes('chunk-37 epoch handoff genesis sentinel'),h.raw(registry),h.raw(dags),h.raw(tail),h.raw(bodies),Number(mode))));
  }
  return cached.get(key);
};
const body=sequence(['0106'])+u32(0)+'14'+'b5'.repeat(20)+u64(7)+u16(0);
const dag=(seed,round,time,epoch=0,payload=[])=>sequence([header({seed,round,time,epoch,payload})])+'0000'+u64(time)+'20'+'00'.repeat(32);
const dags=sequence([dag(500,1,55),dag(501,3,60),dag(500,5,108)]);
const tail=sequence([dag(600,7,207,1,['20'+hash(body)+u16(0)]),dag(600,9,208,1)]);
const row=mode=>['registry',String(mode),'500,501,502,503,504','600,601,602,603,604',dags,tail,sequence([body])];
test('The real registry closes an epoch and replay produces the same closing block',()=>{
  const rows=[row(0),row(1)];
  h.compare(rows,evaluate,{requireSuccess:true});
  assert.match(evaluate(rows[0]),/^sealed\|/);
  assert.match(evaluate(rows[1]),/^2:2:.*~sealed\|/);
  assert.ok(!evaluate(rows[0]).includes('halted|'));
});
test('The real registry survives handoff, preserves the overshoot and closes the next epoch',()=>{
  const request=row(2);
  h.compare([request],evaluate,{requireSuccess:true});
  const parts=evaluate(request).split('~');
  assert.equal(parts.length,3);
  assert.match(parts[0],/^sealed\|/);
  assert.match(parts[2],/^sealed\|/);
  assert.ok(parts[1].includes('|208|false|'));
});
