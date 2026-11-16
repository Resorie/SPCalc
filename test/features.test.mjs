import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadRuleset, rulesKey } from '../src/rulesets.js';
import { createCalculator } from '../src/engine.js';
import { createDamageLedger } from '../src/damage-ledger.js';
import { defaultState, restoreState } from '../src/config-state.js';
const readText = url => readFile(url, 'utf8');
const pack = await loadRuleset({ versionId: 'act2autochess-v2_2', readText });
const { manifest, data } = pack;
const engine = await createCalculator(pack), { catalog, simulate } = engine;
const target = { ...manifest.defaults.target, duration: 60 };
const diy = (tier=6, elite=true, charId='char_1015_aglna2') => ({
  ...structuredClone(manifest.defaults.config), ...catalog.defaultDiy(tier, elite, charId),
});
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-4, `${a} != ${b}`);

test('both owned copies apply their stat buffs in Covenant trials', () => {
  const slot = diy(6, true, 'char_180_amgoat');
  const config = { ...slot, skillIndex: 2, cultivate: 0, items: [], bonds: [] };
  const trial = { ...target, duration: 2 };
  const base = simulate(config, trial);
  const item = 'chess_item_3_07_e_a'; // 阿戈尔重刃 in the Covenant pack
  const equipped = simulate({ ...config, items: [item, item] }, trial);
  near(equipped.opening.atk / base.opening.atk, 1.8);
  assert.throws(() => simulate({ ...config, items: [item, item, item] }, trial), /最多装备两件/);
});

test('Eyjafjalla CCR-Y stage 3 sees an in-range Boss during deployment in solo trials', () => {
  const slot = diy(6, true, 'char_180_amgoat');
  const config = {
    ...slot, skillIndex: 2, potential: 6, items: [], bonds: [],
    diy: { ...slot.diy, uniEquipId: 'uniequip_003_amgoat' },
  };
  const skillStart = r => r.timeline.find(e => e.kind === 'skillStart')?.t;
  const boss = { ...target, rank: 'BOSS', distance: 1 };
  const first = simulate(config, { ...boss, seed: 1 });
  const second = simulate(config, { ...boss, seed: 114514 });
  near(first.opening.interval, 1.6 * 100 / 115);
  near(second.opening.interval, first.opening.interval);
  near(skillStart(second), skillStart(first));

  const normal = simulate(config, { ...boss, rank: 'NORMAL', seed: 1 });
  assert.ok(normal.opening.interval > first.opening.interval);
  assert.ok(skillStart(normal) > skillStart(first));
  const outOfRange = simulate(config, { ...boss, distance: 5, seed: 1 });
  near(outOfRange.opening.interval, normal.opening.interval);
});

test('Angelina has Siracusa membership and no stronghold garrison traits at either tier/form', () => {
  for (const tier of [5,6]) for (const elite of [false,true]) {
    const c=diy(tier,elite), rec=catalog.resolve(c);
    assert.equal(rec.charId,'char_1015_aglna2');
    assert.deepEqual(rec.bonds,['siracusaShip']);
    assert.deepEqual(rec.garrisonIds,[]);
    assert.equal(rec.status.level,elite?60:1);
    assert.equal(rec.status.skillLevel,elite?7:4);
    assert.equal(rec.status.equipLevel,elite?(tier===5?1:3):0);
  }
});
test('all three Angelina skills use dedicated implementations and respond to Siracusa', () => {
  for (let skillIndex=0;skillIndex<3;skillIndex++) {
    const c={...diy(),skillIndex};
    const plain=simulate(c,target);
    const boosted=simulate({...c,bonds:[{id:'siracusaShip',count:6,layers:100}]},target);
    assert.ok(plain.total>0 && boosted.total>plain.total);
    assert.notEqual(plain.kitSource,'generic');
    assert.ok(plain.damageTypes.arts>0);
    assert.equal(boosted.unattributedDamage,0);
    near(boosted.damageByOperator[0].damage,boosted.total);
    near(boosted.samples.at(-1).operators['p1/1'],boosted.total);
  }
});
test('target weight changes Angelina additional arts damage', () => {
  const c=diy();
  const light=simulate(c,{...target,weight:1});
  const heavy=simulate(c,{...target,weight:6});
  assert.ok(light.damageTypes.arts>heavy.damageTypes.arts);
});
test('flying targets are simulated, not a presentation-only switch', () => {
  const c={...diy(),skillIndex:2};
  const r=simulate(c,{...target,motion:'FLY'});
  assert.ok(r.total>0);
  assert.ok(!r.warnings.some(w=>w.includes('引擎')));
});
test('every offered DIY selection composes and runs at both tiers and forms', () => {
  for(const tier of [5,6])for(const u of catalog.picks(tier))for(const elite of [false,true]){
    const c=diy(tier,elite,u.charId);
    const rec=catalog.resolve(c);
    assert.equal(rec.charId,u.charId);
    const r=simulate(c,{...target,duration:8});
    assert.ok(Number.isFinite(r.total),`${u.name} tier ${tier}`);
    near(r.damageByOperator.reduce((s,r)=>s+r.damage,0)+r.unattributedDamage,r.total);
  }
});
test('module selection follows the elite slot level; normal slot has no active module',()=>{
  const u=catalog.picks(6).find(u=>{
    const c=diy(6,true,u.charId);return !catalog.lock(c)&&catalog.modules(c).length;
  });
  assert.ok(u);
  for(const tier of [5,6]){
    const c=diy(tier,true,u.charId);
    c.diy.uniEquipId=catalog.modules(c)[0].uniEquipId;
    assert.equal(catalog.resolve(c).module.level,tier===5?1:3);
    c.chessId=catalog.slotId(tier,false);
    assert.ok(!catalog.resolve(c).module?.active);
    simulate(c,{...target,duration:5});
  }
});
test('DIY unknown characters, wrong skill and cross-mode modules are rejected',()=>{
  assert.throws(()=>simulate({...diy(),diy:{charId:'missing'}},target));
  assert.throws(()=>simulate({...diy(),skillIndex:99},target));
  assert.throws(()=>simulate({...diy(),diy:{...diy().diy,uniEquipId:'missing'}},target));
  for(const tier of [5,6])for(const u of catalog.picks(tier)){
    const c=diy(tier,true,u.charId),rec=data.backups.units[u.charId];
    const mods=Object.values(rec.forms).flatMap(f=>f.modules||[]).filter(m=>/^(ISW|SO|RA)-/.test(m.typeName));
    for(const m of mods)assert.throws(()=>simulate({...c,diy:{...c.diy,uniEquipId:m.uniEquipId}},target));
  }
});
test('combat picker and engine exclude consumables and phantom upgraded variants',()=>{
  assert.ok(catalog.isCombatItem('chess_item_6_09_e_a'));
  assert.ok(!catalog.isCombatItem('chess_item_6_09_e_b'));
  assert.ok(catalog.isCombatItem('chess_item_1_01_e_b'));
  for(const i of Object.values(data.items).filter(i=>i.kind?.startsWith('consume_') || (i.name==='变形同构体'&&i.isGolden))){
    assert.ok(!catalog.equipment.some(x=>x.id===i.id));
    assert.throws(()=>simulate({...diy(),items:[i.id]},target));
  }
});
test('ledger separates duplicate names, nested summons, damage credit and unassigned events',()=>{
  const roster=[{playerId:'p1',uid:1,name:'同名'},{playerId:'p1',uid:2,name:'同名'}];
  const ledger=createDamageLedger(roster);
  const a={ownerId:'p1',uid:1,name:'同名'},b={ownerId:'p1',uid:2,name:'同名'};
  const summon={ownerId:'p1',uid:1,name:'召唤物',ownerUnit:{ownerUnit:a}};
  const hit=(source,delta,extra={})=>ledger.record({source,delta,target:{side:'enemy'},dmg:{type:'phys'},...extra},1);
  hit(a,-100);hit(b,-200);hit(summon,-50);hit(null,-30,{credit:a});hit(null,-20);
  hit(a,100);hit(a,-900,{target:{side:'ally'}});
  const r=ledger.result();assert.equal(r.total,400);assert.equal(r.unattributedDamage,20);
  assert.deepEqual(r.damageByOperator.map(o=>o.damage),[180,200]);
  assert.equal(r.damageByOperator[0].summons,50);
  assert.equal(r.damageByOperator[0].direct,130);
});
test('separate calculators reinstall their data, without cross-version state leakage',async()=>{
  const second=structuredClone(pack);
  second.manifest.id='fixture-next-season';second.manifest.revision=2;
  const id=manifest.defaults.config.chessId;
  second.data.chess[id].stats.atk*=2;
  if(second.data.chess[id].statsBase)second.data.chess[id].statsBase.atk*=2;
  const other=await createCalculator(second);
  const c=manifest.defaults.config;
  const before=simulate(c,target),changed=other.simulate(c,target),after=simulate(c,target);
  assert.notEqual(changed.rules,before.rules);assert.ok(changed.total>before.total);
  assert.deepEqual(after,before);
});
test('unsupported engine and data schema fail instead of silently falling back',async()=>{
  await assert.rejects(createCalculator({...pack,manifest:{...manifest,engine:{id:'future',api:1}}}));
  await assert.rejects(createCalculator({...pack,manifest:{...manifest,dataSchema:'future'}}));
});
test('package loader detects changed bytes before calculation',async()=>{
  await assert.rejects(loadRuleset({readText:async url=>(await readText(url))+(url.pathname.endsWith('/items.json')?' ': '')}),/校验失败/);
});
test('legacy config retains selections; new links reject different rule revisions',()=>{
  const s=defaultState(manifest);assert.equal(s.rules,rulesKey(manifest));
  const legacy={...s,schema:1};delete legacy.rules;delete legacy.target.weight;
  const restored=restoreState(legacy,manifest);
  assert.deepEqual(restored.configs,s.configs);assert.equal(restored.target.weight,manifest.defaults.target.weight);
  assert.throws(()=>restoreState(s,{...manifest,revision:2}),/不匹配/);
  assert.throws(()=>restoreState(legacy,{...manifest,revision:2}),/不匹配/);
  const roundtrip=JSON.parse(JSON.stringify({...s,configs:[diy(),diy(5,false)]}));
  assert.deepEqual(restoreState(roundtrip,manifest).configs,roundtrip.configs);
});

test('actual automatic summons count once toward their owning operator',()=>{
  const c={...diy(6,true,'char_1035_wisdel'),skillIndex:2};
  const r=simulate(c,target),owner=r.damageByOperator[0];
  assert.ok(owner.direct>0 && owner.summons>0);
  near(owner.direct+owner.summons,r.total);
  assert.equal(r.unattributedDamage,0);
});
test('every offered operator, equipment and bond has an existing verified PNG',async()=>{
  const {createHash}=await import('node:crypto');
  const root=new URL('../assets/icons/',import.meta.url);
  const icons=JSON.parse(await readFile(new URL('index.json',root),'utf8'));
  const charIds=[...catalog.presets.map(c=>c.charId),...catalog.picks(5).map(c=>c.charId),...catalog.picks(6).map(c=>c.charId)];
  for(const id of charIds)assert.ok(icons.operators[id],id);
  for(const item of catalog.equipment)assert.ok(icons.items[item.id],item.name);
  for(const bond of Object.values(data.bonds))assert.ok(icons.bonds[bond.bondId],bond.name);
  for(const path of new Set([...Object.values(icons.operators),...Object.values(icons.items),...Object.values(icons.bonds)])){
    const bytes=await readFile(new URL(path,root));
    assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a',path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),icons.files[path].sha256,path);
  }
});

test('configuration roundtrip supports one through five plans with independent bonuses',()=>{
 for(const count of [1,3,5]){
  const s=defaultState(manifest);s.configs=Array.from({length:count},(_,i)=>({...diy(),external:{aspd:i*10}}));
  assert.deepEqual(restoreState(JSON.parse(JSON.stringify(s)),manifest).configs,s.configs);
 }
 for(const count of [0,6]){const s=defaultState(manifest);s.configs=Array.from({length:count},()=>diy());assert.throws(()=>restoreState(s,manifest));}
});
