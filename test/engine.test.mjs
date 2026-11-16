import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCalculator } from '../src/engine.js';
import { loadRuleset } from '../src/rulesets.js';
const pack = await loadRuleset({ versionId: 'act2autochess-v2_2', readText: url => readFile(url, 'utf8') });
const data = pack.data;
const source = data.chess.chess_char_1_01_a;
for (const type of ['phys','arts','true']) data.chess[`test_${type}`] = {
  ...source, chessId:`test_${type}`,baseId:`test_${type}`,goldenId:null,charId:`test_${type}`,name:`test_${type}`,
  profession:'WARRIOR',subProfessionId:'fighter',position:'MELEE',bonds:[],garrisonIds:[],
  stats:{...source.stats,atk:1000,aspd:100,bat:1,blockCnt:1},statsBase:undefined,
  skill:null,skills:[],talents:[],talentsBase:[],trait:{desc:'',bb:{}},module:null,modules:[],
  potDown:{},rangeGrid:[[0,0],[0,1]],dmgType:type,attackKind:'melee',projectile:null,tokens:[],
};
const { simulate } = await createCalculator(pack);
const target = { duration:10,def:0,res:0,count:1,distance:1,seed:1,rank:'NORMAL' };
const config = (type='phys') => ({chessId:`test_${type}`,potential:6,cultivate:0,items:[],bonds:[]});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-4,`${a} != ${b}`);

test('physical DEF subtraction and 5% minimum apply to each hit',()=>{
  for(const [def,expected] of [[0,1000],[400,600],[2000,50]]){
    const r=simulate(config(),{...target,def});assert.ok(r.hits.length>0);
    for(const h of r.hits)near(h.amount,expected);
  }
});
test('arts damage uses RES with 5% minimum; true damage bypasses both',()=>{
  for(const [type,res,expected] of [['arts',25,750],['arts',100,50],['true',100,1000]]){
    const r=simulate(config(type),{...target,def:5000,res});
    assert.ok(r.hits.length>0);for(const h of r.hits)near(h.amount,expected);
  }
});
test('15% and 25% equipment bonuses add to 40%, not per-item multiplication',()=>{
  const r=simulate({...config(),items:['chess_item_1_01_e_a','chess_item_3_10_e_a']},target);
  near(r.opening.atk,1400);for(const h of r.hits)near(h.amount,1400);
});
test('ownership cultivation multiplies the combined equipment-adjusted ATK',()=>{
  const r=simulate({...config(),cultivate:3,items:['chess_item_1_01_e_a','chess_item_3_10_e_a']},target);
  near(r.opening.atk,1540);for(const h of r.hits)near(h.amount,1540);
});
test('a stationary target remains on field for the full trial',()=>{
  const r=simulate(config(),{...target,duration:60});
  assert.ok(r.hits.at(-1).t>58);assert.equal(r.samples.length,61);
  near(r.samples.at(-1).damage,r.total);near(r.dps,r.total/60);
});
test('target outside range produces zero damage and an explicit warning',()=>{
  const r=simulate(config(),{...target,distance:5});assert.equal(r.total,0);assert.ok(r.warnings.some(w=>w.includes('射程')));
});
const mlynar={chessId:'chess_char_5_19_b',skillIndex:2,potential:6,cultivate:3,items:[],bonds:[]};
test('Mlynar includes deployment warmup, 26-second skill and physical/true components',()=>{
  const r=simulate(mlynar,{...target,duration:60,def:800,res:30});
  assert.equal(r.activations,1);near(r.timeline[0].t,24.9666666667);
  near(r.timeline[1].t-r.timeline[0].t,26);
  assert.ok(r.damageTypes.phys>0&&r.damageTypes.true>0);
  assert.ok(r.firstHit>=r.timeline[0].t);
  near(Object.values(r.damageTypes).reduce((x,y)=>x+y,0),r.total);
});
test('same seeded configuration repeats exactly, even after a different trial',()=>{
  const t={...target,duration:60};const a=simulate(mlynar,t);
  simulate({...mlynar,items:['chess_item_1_01_e_b'],bonds:[{id:'yanShip',count:3,layers:20}]},t);
  assert.deepEqual(simulate(mlynar,t),a);
});
test('multi-target skill damage increases with targets, respecting skill targeting',()=>{
  const t={...target,duration:60};const a=simulate(mlynar,t),b=simulate(mlynar,{...t,count:3});
  assert.ok(b.total>a.total*2);assert.ok(b.total<a.total*4);
});
test('invalid numbers, unsupported versions of inputs and duplicate bonds are rejected',()=>{
  for(const patch of [{duration:0},{duration:Infinity},{count:9},{res:-1},{def:''},{seed:0},{duration:2.5}])assert.throws(()=>simulate(config(),{...target,...patch}));
  assert.throws(()=>simulate({...config(),items:['missing']},target));
  assert.throws(()=>simulate({...mlynar,skillIndex:99},target));
  assert.throws(()=>simulate({...mlynar,bonds:[{id:'yanShip',count:3,layers:20},{id:'yanShip',count:3,layers:20}]},target));
});

test('Mlynar skill-window DPS includes warmup exclusion and clipped casts',()=>{
  for(const duration of [10,40,60]){
    const r=simulate(mlynar,{...target,duration,def:800,res:30});
    if(duration===10){assert.equal(r.skillWindow.dps,null);continue;}
    const expected=duration===40?40-r.timeline[0].t:26;
    near(r.skillWindow.duration,expected);
    const damage=r.hits.filter(h=>r.skillWindow.intervals.some(([a,b])=>h.t>=a&&h.t<b)).reduce((s,h)=>s+h.amount,0);
    near(r.skillWindow.damage,damage);near(r.skillWindow.dps,damage/expected);
  }
});

test('manual external bonuses respect attack buckets and attack speed',()=>{
 const r=simulate({...config(),external:{atkPct:50,atkFlat:100,atkFinal:200,atkMul:2,aspd:100}},target);
 near(r.opening.atk,3700);near(r.opening.interval,.5);
 for(const h of r.hits)near(h.amount,3700);
 assert.throws(()=>simulate({...config(),external:{aspd:''}},target));
});


test('trial Arcane covers non-members from the first hit, every target and the full duration',()=>{
  for (const [count,multiplier] of [[2,2.2],[3,3.08]]) {
    const r=simulate({...config('arts'),bonds:[{id:'arcaneShip',count,layers:100}]},{...target,count:3});
    assert.ok(r.hits.length>3);
    for(const hit of r.hits)near(hit.amount,1000*multiplier);
    assert.ok(r.hits.at(-1).t>8);
    near(r.assumptions[0].multiplier,multiplier);
    assert.equal(r.assumptions[0].lowHp,count===3);
  }
  for(const type of ['phys','true']) {
    const plain=simulate(config(type),target);
    const r=simulate({...config(type),bonds:[{id:'arcaneShip',count:3,layers:100}]},target);
    near(r.total,plain.total);
  }
});

test('native Arcane applications do not multiply assumed coverage a second time',()=>{
  data.chess.test_arcane={...data.chess.test_arts,chessId:'test_arcane',baseId:'test_arcane',bonds:['arcaneShip']};
  for(const count of [2,3]) {
    const r=simulate({...config('arts'),chessId:'test_arcane',bonds:[{id:'arcaneShip',count,layers:100}]},target);
    for(const hit of r.hits)near(hit.amount,count===2?2200:3080);
  }
});


test('Raid trial waits for an actual jump, then applies the bond exactly once',()=>{
  data.chess.test_raid={...data.chess.test_phys,chessId:'test_raid',baseId:'test_raid',bonds:['raidShip']};
  const c={...config(),chessId:'test_raid',bonds:[{id:'raidShip',count:2,layers:200}]};
  const short=simulate(c,{...target,duration:9});
  assert.equal(short.total,0);
  assert.equal(short.assumptions[0].deployments.length,0);
  const r=simulate(c,{...target,duration:30});
  assert.equal(r.assumptions[0].deployments.length,1);
  near(r.assumptions[0].deployments[0].t,10);
  assert.ok(r.firstHit>=10 && r.firstHit<11);
  for(const hit of r.hits)near(hit.amount,3250);
  const far=simulate(c,{...target,duration:30,distance:5});
  near(far.total,r.total);
  const nonmember=simulate({...config(),bonds:c.bonds},{...target,duration:30});
  assert.ok(!nonmember.assumptions.some(x=>x.kind==='raidApproach'));
  for(const hit of nonmember.hits)near(hit.amount,1000);
});

test('Mlynar Raid conversion keeps SP and attacks after one real relocation',()=>{
  const c={...mlynar,items:['chess_item_6_09_e_a','chess_item_3_11_e_a'],bonds:[{id:'raidShip',count:2,layers:200}]};
  const r=simulate(c,{...target,duration:60});
  const assumption=r.assumptions.find(x=>x.kind==='raidApproach');
  assert.equal(assumption.deployments.length,1);near(assumption.deployments[0].t,10);
  near(r.timeline.find(x=>x.kind==='skillStart').t,24.9666666667);
  assert.ok(r.total>0);assert.equal(r.activations,1);
  const air=simulate(c,{...target,duration:60,motion:'FLY'});
  assert.ok(!air.assumptions.some(x=>x.kind==='raidApproach'));
  assert.ok(!air.timeline.some(x=>x.kind==='raidDeploy'));
});
