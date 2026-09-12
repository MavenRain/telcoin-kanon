import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './harness.mjs';
import { txShapeOracleSources } from './tx-shape-oracle-sources.mjs';
import { transactionGoldens, type4Golden, scalar, word, rlp, wire, txFields, txLayouts } from './transaction-vectors.mjs';
const h = await harness({name:'tx-shape', ...txShapeOracleSources, oracle:'test/tx-shape-oracle.ml',
  fixtures:['test/tx-shape.kan'], exports:['txShapeTestDecode', 'txShapeTestRecover', 'txShapeTestChecked']});
const evaluate=([op,input]) => h.text(h.e[({decode:'txShapeTestDecode',recover:'txShapeTestRecover',checked:'txShapeTestChecked'})[op]](h.raw(input)));
const compare=(inputs,op='decode',positive=false)=>h.compare(inputs.map(input=>[op,input]),evaluate,{requireSuccess:positive});
const fields=type=>type===3?[...txFields(2).slice(0,9),'01',['11'.repeat(32)],'','01','01']:txFields(type);
const layouts=[...txLayouts,{type:3,scalars:[[0,8],[1,8],[2,16],[3,16],[4,8],[6,32],[9,16],[11,1],[12,32],[13,32]],native:[1,4],target:5,data:7,access:8,parity:11}];
test('Batch transaction shapes preserve source signed goldens and checked recovery',()=>{
  const goldens=[...transactionGoldens,type4Golden];
  compare(goldens.map(g=>g.encoded_2718),'decode',true);
  compare(goldens.map(g=>g.encoded_2718),'recover',true);
  compare(goldens.map(g=>g.encoded_2718),'checked',true);
  for(const g of goldens){
    assert.equal(evaluate(['decode',g.encoded_2718]).split('|')[0],g.tx_hash);
    assert.equal(evaluate(['recover',g.encoded_2718]),g.sender);
  }
  const legacy=goldens.filter(g=>parseInt(g.encoded_2718.slice(0,2),16)>127);
  compare(legacy.map(g=>'00'+g.encoded_2718),'checked',true);
  for(const g of legacy) assert.equal(evaluate(['decode','00'+g.encoded_2718]),evaluate(['decode',g.encoded_2718]));
});
test('All five batch grammars accept full u64 and u128 widths without executor narrowing',()=>{
  const inputs=[];
  for(const layout of layouts){
    for(const [index,width] of layout.scalars){
      if(index===layout.parity)continue;
      for(const n of [0n,1n,127n,128n,1n<<62n,1n<<63n,(1n<<BigInt(width*8))-1n]){
        const f=fields(layout.type);f[index]=scalar(n);inputs.push(wire(layout.type,f));
      }
    }
    for(const size of [0,1,55,56,255,256]){
      const f=fields(layout.type);f[layout.data]='ab'.repeat(size);inputs.push(wire(layout.type,f));
    }
  }
  compare(inputs,'decode',true);
  for(const type of [0,1,2,3,4]){
    const f=fields(type),index=type===0?2:type===1?3:4;f[index]='ffffffffffffffff';
    assert.equal(evaluate(['decode',wire(type,f)]).split('|')[2],'ffffffffffffffff');
  }
});
test('Batch shape framing rejects malformed RLP and nested type zero dispatch',()=>{
  const inputs=['','00','01','02','03','04','80','c0','8100','b800','b80101','f800','f80180','f90001c0','f8ff'];
  for(let type=0;type<128;type++)inputs.push(type.toString(16).padStart(2,'0')+'c0');
  for(const type of [0,1,2,3,4]){
    const value=wire(type,fields(type));
    inputs.push(rlp(value),value+'00','0000'+value);
    for(let n=1;n<value.length/2;n++)inputs.push(value.slice(0,n*2));
    if(type!==0)inputs.push('00'+value);
  }
  compare(inputs);
});
test('Batch shape scalar canonicality, field counts and address widths match OCaml',()=>{
  const inputs=[];
  for(const layout of layouts){
    for(const [index,width] of layout.scalars)for(const bad of [[], '00','0001','01'.repeat(width+1),'00'.repeat(width+1)]){
      const f=fields(layout.type);f[index]=bad;inputs.push(wire(layout.type,f));
    }
    for(const to of ['', '00', '00'.repeat(19), '00'.repeat(21), []]){
      const f=fields(layout.type);f[layout.target]=to;inputs.push(wire(layout.type,f));
    }
    for(let count=0;count<=fields(layout.type).length+1;count++){
      const f=fields(layout.type);f.push('');inputs.push(wire(layout.type,f.slice(0,count)));
    }
    for(const parity of ['','01','02','1b','1c','1d','23','24',scalar((1n<<65n)+33n),scalar((1n<<65n)+35n)]){
      const f=fields(layout.type);f[layout.parity]=parity;inputs.push(wire(layout.type,f));
    }
  }
  compare(inputs);
});
test('Blob lists, access tuples and authorizations preserve their distinct validation rules',()=>{
  const inputs=[];
  for(const hashes of [[],['00'.repeat(32)],['11'.repeat(32),'22'.repeat(32)],[''],['00'.repeat(31)],['00'.repeat(33)],'',[[]]]){
    const f=fields(3);f[10]=hashes;inputs.push(wire(3,f));
  }
  for(const layout of layouts.filter(l=>l.access!==null)){
    for(const access of ['', [''], [[]], [['00'.repeat(20),[]]], [['00'.repeat(20),['ff'.repeat(32)]]],
      [['00'.repeat(19),[]]], [['00'.repeat(20),['ff'.repeat(31)]]], [['00'.repeat(20),[], '']]]){
      const f=fields(layout.type);f[layout.access]=access;inputs.push(wire(layout.type,f));
    }
  }
  const auth=[word(1),'11'.repeat(20),'','','01','01'];auth[0]='01';
  for(const value of [[],[auth],[[...auth,'']],[''],[[]],[[word((1n<<256n)-1n),auth[1],'ffffffffffffffff','ff','01','01']]]){
    const f=fields(4);f[9]=value;inputs.push(wire(4,f));
  }
  compare(inputs);
});
test('Batch checked recovery orders decoding before low-s and curve rejection',()=>{
  const inputs=[];
  const order=0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  for(const layout of layouts)for(const [r,s] of [[0n,1n],[1n,0n],[order,1n],[1n,order/2n],[1n,order/2n+1n],[1n,order]]){
    const f=fields(layout.type);f[f.length-2]=scalar(r);f[f.length-1]=scalar(s);inputs.push(wire(layout.type,f));
  }
  compare(inputs,'recover');compare(inputs,'checked');
});
