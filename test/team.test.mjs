import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadRuleset} from '../src/rulesets.js';
import {createCalculator} from '../src/engine.js';
import {defaultTeamState,restoreTeamState,teamFromSingle} from '../src/team-state.js';
import {restoreState,defaultState} from '../src/config-state.js';
const readText=u=>readFile(u,'utf8');
const pack=await loadRuleset({versionId:'act2autochess-v2_2-team1',readText});
const engine=await createCalculator(pack),data=pack.data,defaults=defaultTeamState(pack.manifest);
const scene={...defaults.scene,targetShape:'point',targetRow:4,targetCol:8},target={...defaults.target,seed:114514};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-4,`${a} != ${b}`);
const cfg=(id='chess_char_5_03_b')=>({...structuredClone(pack.manifest.defaults.config),chessId:id,skillIndex:data.chess[id].skill?.index,cultivate:id.startsWith('team_')?0:3});
const member=(uid,id,row,col,dir='RIGHT')=>({uid,config:cfg(id),row,col,dir});
const team=(members,bonds=[],assumptions={arcane:false,raid:false})=>({members,bonds,assumptions});
const simulate=(t,params={})=>engine.simulateTeam(t,{...target,...params},scene);
const source=data.chess.chess_char_1_01_a;
for(const [id,bonds,type]of [['team_phys',[],'phys'],['team_arts',[],'arts'],['team_aura',['skillfulShip'],'phys'],['team_arcane',['arcaneShip'],'arts'],['team_raid',['raidShip'],'phys']])data.chess[id]={
 ...source,chessId:id,baseId:id,charId:id,goldenId:null,isGolden:false,name:id,bonds,garrisonIds:[],profession:'WARRIOR',subProfessionId:'fighter',position:'MELEE',
 stats:{...source.stats,atk:1000,aspd:100,bat:1,blockCnt:1},statsBase:undefined,skill:null,skills:[],talents:[],talentsBase:[],trait:{desc:'',bb:{}},module:null,modules:[],potDown:{},rangeGrid:[[0,0],[0,1]],dmgType:type,tokens:[],projectile:null,attackKind:'melee'};

test('team map pack preserves old data and offers eight current maps',async()=>{
 assert.equal(engine.teamMaps.length,8);
 const old=await loadRuleset({versionId:'act2autochess-v2_2',readText});
 for(const [id,file]of Object.entries(old.manifest.files))assert.equal(pack.manifest.files[id].sha256,file.sha256);
 const state=defaultState(old.manifest);assert.deepEqual(restoreState(state,old.manifest).configs,state.configs);
});
test('all eight maps accept a real legal placement and run their environment without engine errors',()=>{
 for(const map of engine.teamMaps){const board=engine.teamBoard(map.id);const rec=engine.catalog.resolve(cfg('team_phys'));let pos;
  for(let r=2;r<=5;r++)for(let c=2;c<10;c++)if(!pos&&board.canPlace(rec,r,c)&&board.canTarget(r,c+1))pos=[r,c];
  assert.ok(pos,map.name);const [row,col]=pos;
  const r=engine.simulateTeam(team([member(1,'team_phys',row,col)]),{...target,duration:20,def:0},{stageId:map.id,targetRow:row,targetCol:col+1});
  assert.ok(Number.isFinite(r.total)&&r.total>0,map.name);
 }
});
test('team validation rejects collisions, illegal terrain, invalid numbers, tenth member and unknown map',()=>{
 const t=team([member(1,'team_phys',4,7)]);assert.doesNotThrow(()=>engine.validateTeam(t,target,scene));
 for(const mutate of [x=>x.members.push({...structuredClone(x.members[0]),uid:2}),x=>x.members[0].col=0,x=>x.members[0].dir='bad',x=>x.bonds.push({id:'yanShip',count:3,layers:''}),x=>x.members[0].config.external={aspd:-1}]){const copy=structuredClone(t);mutate(copy);assert.throws(()=>engine.validateTeam(copy,target,scene));}
 assert.throws(()=>engine.validateTeam({...t,members:Array.from({length:10},(_,i)=>({...t.members[0],uid:i+1}))},target,scene),/1–9/);
 assert.throws(()=>engine.validateTeam(t,target,{...scene,stageId:'bad'}));
});
test('automatic bond counts include morph, harmony, distinct operators and every elite instance',()=>{
 const a=member(1,'chess_char_5_03_b',4,6),b={...structuredClone(a),uid:2,row:3},c=member(3,'chess_char_5_19_b',4,7);
 a.config.items=['chess_item_6_09_e_a','chess_item_4_08_e_a'];
 const harmony=Object.values(data.chess).find(r=>r.bonds?.includes('maniShip')&&!r.isGolden);
 const h=member(4,harmony.chessId,3,7);
 const t=team([a,b,c,h]);let bonds=engine.teamBonds(t);
 assert.equal(bonds.lateranoShip.actualCount,2);assert.equal(bonds.yanShip.actualCount,2);assert.equal(bonds.suntShip.actualCount,3);
 t.bonds=[{id:'lateranoShip',count:6,layers:100}];bonds=engine.teamBonds(t);assert.equal(bonds.lateranoShip.actualCount,2);assert.equal(bonds.lateranoShip.count,6);assert.equal(bonds.lateranoShip.tier,2);
});
function healedBlaze(out=false){const blaze=member(1,'chess_char_5_03_b',4,6),reed=member(2,'chess_char_6_08_b',5,6);
 blaze.config.items=['chess_item_6_09_e_a','chess_item_4_08_e_a'];reed.config.items=['chess_item_4_09_e_b','chess_item_3_10_e_b'];
 if(out){reed.row=2;reed.col=3;reed.dir='LEFT';}
 return team([blaze,reed],[{id:'victoriaShip',count:6,layers:400},{id:'arcaneShip',count:2,layers:200},{id:'suntShip',count:5,layers:20},{id:'lateranoShip',count:3,layers:600}],{arcane:true,raid:false});}
test('Reed actually heals Blaze, preserves a longer skill and loses that support outside range',()=>{
 const healed=simulate(healedBlaze()),out=simulate(healedBlaze(true));
 assert.ok(healed.diagnostics.healing.some(h=>h.sourceUid===2&&h.targetUid===1&&h.amount>0));
 assert.ok(!out.diagnostics.healing.some(h=>h.sourceUid===2&&h.targetUid===1));
 assert.ok(healed.damageByOperator[0].skillWindow.duration>out.damageByOperator[0].skillWindow.duration+10);
 assert.ok(out.timeline.some(e=>e.uid===1&&e.reason==='downed'));assert.ok(!healed.timeline.some(e=>e.uid===1&&e.reason==='downed'));
 assert.equal(healed.diagnostics.skillStarts.find(x=>x.uid===1).ammo,211);
});
test('Reed healing extends Surtr life without disabling her actual self HP loss',()=>{
 const make=out=>{const s=member(1,'chess_char_5_07_b',4,7),r=member(2,'chess_char_6_08_b',5,6);r.config.external={atkPct:2000,aspd:200};if(out){r.row=2;r.col=3;r.dir='LEFT';}return team([s,r]);};
 const healed=simulate(make(false)),out=simulate(make(true));
 assert.ok(healed.diagnostics.healing.some(h=>h.sourceUid===2&&h.targetUid===1));
 assert.ok(healed.damageByOperator[0].skillWindow.duration>out.damageByOperator[0].skillWindow.duration);
});
test('a teammate supplies burn bursts and each burst refills Blaze only once',()=>{
 const a=member(1,'chess_char_5_03_b',4,6),b=member(2,'chess_char_5_03_b',3,6);b.config.skillIndex=1;
 for(const m of [a,b])m.config.external={atkPct:1500};
 const alone=simulate(team([a],[{id:'suntShip',count:5,layers:0}]),{duration:80,res:0});
 const together=simulate(team([a,b],[{id:'suntShip',count:5,layers:0}]),{duration:80,res:0});
 assert.equal(alone.diagnostics.bursts.length,0);assert.ok(together.diagnostics.bursts.length>0);
 const gains=together.diagnostics.ammoGains.filter(x=>x.uid===1);assert.ok(gains.length>0);for(const g of gains)assert.ok(g.gain>0&&g.gain<=2);
 assert.equal(new Set(gains.map(g=>`${g.t}/${g.targetId}`)).size,gains.length);
});
test('Nearl front-tile garrison and adjacent Skillful aura depend on formation',()=>{
 const m=member(1,'chess_char_5_19_b',4,7),n=member(2,'chess_char_6_17_b',4,6);
 const front=simulate(team([m,n],[{id:'kazimierzShip',count:3,layers:150}]));n.dir='LEFT';const away=simulate(team([m,n],[{id:'kazimierzShip',count:3,layers:150}]));
 assert.ok(front.openings.find(o=>o.uid===1).interval<away.openings.find(o=>o.uid===1).interval);
 const a=member(1,'team_phys',4,7),support=member(2,'team_aura',4,6),bonds=[{id:'skillfulShip',count:2,layers:100}];
 const adjacent=simulate(team([a,support],bonds));support.row=2;support.col=3;const far=simulate(team([a,support],bonds));
 assert.ok(adjacent.openings[0].interval<far.openings[0].interval);
});
test('Arcane defaults to real application; optional full coverage is explicit and non-multiplying',()=>{
 const a=member(1,'team_arts',4,7),bonds=[{id:'arcaneShip',count:3,layers:100}];
 const actual=simulate(team([a],bonds),{duration:10,def:0,res:0});near(actual.hits[0].amount,1000);assert.equal(actual.assumptions.length,0);
 const assumed=simulate(team([a],bonds,{arcane:true,raid:false}),{duration:10,def:0,res:0});for(const h of assumed.hits)near(h.amount,3080);
 const caster=member(2,'team_arcane',5,8,'DOWN');const native=simulate(team([a,caster],bonds),{duration:10,def:0,res:0});assert.ok(native.hits.some(h=>h.operatorId==='p1/1'&&h.amount>1000));
});
test('Raid simplification moves only Raid members, retains real delay and does not bypass invalid layouts',()=>{
 const m=member(1,'chess_char_5_19_b',4,7),r=member(2,'team_phys',5,6);m.config.items=['chess_item_6_09_e_a','chess_item_3_11_e_a'];
 const bonds=[{id:'raidShip',count:2,layers:200}];
 const ordinary=simulate(team([m,r],bonds));assert.ok(!ordinary.timeline.some(e=>e.kind==='raidDeploy'));
 const simplified=simulate(team([m,r],bonds,{arcane:false,raid:true}));assert.ok(simplified.timeline.some(e=>e.kind==='raidDeploy'&&e.uid===1&&e.t>=10));
 assert.equal(simplified.openings.find(x=>x.uid===2).row,r.row);assert.equal(simplified.openings.find(x=>x.uid===2).col,r.col);
 assert.ok(!simulate(team([m,r],bonds,{arcane:false,raid:true}),{duration:9}).timeline.some(e=>e.kind==='raidDeploy'));
 assert.throws(()=>simulate(team([m,r],bonds,{arcane:false,raid:true}),{motion:'FLY'}),/突袭/);
});
test('duplicate operators and automatic summons reconcile with total and every sample',()=>{
 const a=member(1,'chess_char_5_03_b',4,6),b=member(2,'chess_char_5_03_b',3,6);
 const r=simulate(team([a,b],[{id:'yanShip',count:6,layers:100}]));
 assert.equal(r.damageByOperator.length,2);assert.notEqual(r.damageByOperator[0].id,r.damageByOperator[1].id);
 near(r.total,r.damageByOperator.reduce((n,x)=>n+x.damage,0)+r.unattributedDamage);
 for(const s of r.samples)assert.ok(s.damage+1e-4>=Object.values(s.operators).reduce((a,b)=>a+b,0));
 assert.ok(r.damageByOperator.some(o=>o.summons>0)||r.unattributedDamage>0);
});
test('one to five team plans serialize without aliasing; single-plan conversion preserves loadout',()=>{
 for(const n of [1,3,5]){const s=defaultTeamState(pack.manifest);s.configs=Array.from({length:n},()=>structuredClone(s.configs[0]));const restored=restoreTeamState(JSON.parse(JSON.stringify(s)),pack.manifest);assert.equal(restored.configs.length,n);if(n>1){restored.configs[1].members[0].config.items.push('x');assert.equal(restored.configs[0].members[0].config.items.length,0);}}
 const c=cfg();c.items=['chess_item_6_09_e_a'];c.bonds=[{id:'yanShip',count:6,layers:100}];const m=teamFromSingle(c);assert.deepEqual(m.config.items,c.items);assert.deepEqual(m.config.bonds,[]);
 const s=defaultTeamState(pack.manifest);assert.throws(()=>restoreTeamState({...s,rules:'wrong'},pack.manifest));
});


test('active originium and mire affect operators, while deepsea refuses deployment',()=>{
 const run=(stageId,row,col,tr,tc)=>engine.simulateTeam(team([member(1,'team_phys',row,col)]),{...target,duration:12,def:0},{stageId,targetRow:tr,targetCol:tc});
 const infection=run('act1autochess_m04',4,6,4,7),plain=run('act1autochess_m04',4,3,4,4);
 assert.ok(infection.total>plain.total);
 const mire=run('act2autochess_m02',5,7,5,8),dry=run('act2autochess_m02',2,4,2,5);
 assert.ok(mire.total<dry.total);
 const sea=engine.teamBoard('act2autochess_m04');assert.ok(!sea.canPlace(engine.catalog.resolve(cfg('team_phys')),4,6));
});
test('nine members run in one battle and the team default is declared by data catalog',async()=>{
 const p=await loadRuleset({mode:'team',fromSingle:'act2autochess-v2_2',readText});assert.equal(p.manifest.id,pack.manifest.id);
 const b=engine.teamBoard(scene.stageId),members=[];
 for(let row=2;row<=5;row++)for(let col=2;col<=10;col++)if(members.length<9&&b.canPlace(engine.catalog.resolve(cfg('team_phys')),row,col)&&!(row===scene.targetRow&&col===scene.targetCol))members.push(member(members.length+1,'team_phys',row,col));
 const r=simulate(team(members),{duration:10});assert.equal(r.damageByOperator.length,9);near(r.total,r.damageByOperator.reduce((n,o)=>n+o.damage,0)+r.unattributedDamage);
});


test('team API does not require single-trial distance and warns when a requested shortcut is inactive',()=>{
 const t=team([member(1,'team_phys',4,7)],[],{arcane:true,raid:true}),params={...target,duration:10};delete params.distance;
 const r=engine.simulateTeam(t,params,scene);assert.equal(r.assumptions.length,0);assert.ok(r.warnings.some(w=>w.includes('奥术简化未生效')));assert.ok(r.warnings.some(w=>w.includes('突袭简化未生效')));
});

test('large Boss has 15 hit tiles but only 9 blocked deployment tiles',async()=>{
 const {targetGeometry}=await import('../src/adapters/stronghold-target-geometry.js');
 const scene={stageId:'act1autochess_m02',targetShape:'boss',targetRow:2,targetCol:10};const g=targetGeometry(scene),b=engine.teamBoard(scene.stageId,scene),rec=engine.catalog.resolve(cfg('team_phys'));
 assert.equal(g.keys.length,15);assert.equal(g.blocked.length,9);assert.equal(g.flanks.length,6);
 for(let r=2;r<=4;r++){for(const c of [8,12])assert.equal(b.canPlace(rec,r,c),b.displayGrid.canStand(r,c,{ranged:false}));for(let c=9;c<=11;c++)assert.ok(!b.canPlace(rec,r,c));}
 assert.ok(!b.canPlace(rec,3,8),'Boss hit rectangle must not turn the source cliff into road');
 assert.ok(data.stages[scene.stageId].rows[3][8]==='#','source map remains untouched');
});
test('Boss edges are targetable from both sides and one enemy is not counted 15 times',()=>{
 const scene={stageId:'act1autochess_m02',targetShape:'boss',targetRow:2,targetCol:10};
 const left=member(1,'team_phys',4,7,'RIGHT'),right=member(2,'team_phys',4,12,'LEFT');
 const r=engine.simulateTeam(team([left,right]),{...target,duration:10,def:0},scene);
 assert.ok(r.damageByOperator.every(o=>o.damage>0));
 for(const h of r.hits)near(h.amount,1000);
 assert.ok(r.hits.length<=22);near(r.total,r.hits.length*1000);
 assert.throws(()=>engine.validateTeam(team([member(1,'team_phys',3,10)]),target,scene),/位置不合法/);
 assert.throws(()=>engine.validateTeam(team([left]),target,{...scene,targetRow:4}),/受击框/);
});
test('large Boss side column also participates in native Raid landing',()=>{
 const scene={stageId:'act1autochess_m02',targetShape:'boss',targetRow:2,targetCol:10};
 const m=member(1,'team_raid',3,3,'LEFT');const r=engine.simulateTeam(team([m],[{id:'raidShip',count:2,layers:100}]),{...target,duration:30,def:0},scene);
 assert.ok(r.timeline.some(e=>e.kind==='raidDeploy'));assert.ok(r.total>0);
 assert.ok(r.openings.every(o=>o.col<9||o.col>11||o.row>4));
});
test('legacy single-tile team scenes migrate to Boss geometry while preserving every member position',()=>{
 const s=defaultTeamState(pack.manifest);delete s.scene.targetShape;s.scene.targetRow=4;s.scene.targetCol=8;
 const restored=restoreTeamState(s,pack.manifest);assert.equal(restored.scene.targetShape,'boss');assert.equal(restored.scene.targetRow,3);assert.equal(restored.scene.targetCol,10);assert.deepEqual(restored.configs,s.configs);assert.ok(restored.geometryMigrated);
});


test('Boss overlay preserves all source terrain keys, heights, passability and special terrain on every map',()=>{
 for(const stage of Object.values(data.stages)){
  const scene={stageId:stage.id,targetShape:'boss',targetRow:3,targetCol:10};const b=engine.teamBoard(stage.id,scene),source=engine.teamBoard(stage.id);
  for(let r=0;r<=5;r++)for(let c=0;c<=20;c++){
   const actual=b.grid.tile(r,c),original=source.grid.tile(r,c);
   for(const key of ['key','height','pass','terrain','special'])assert.equal(actual[key],original[key],`${stage.id} ${r},${c} ${key}`);
   assert.equal(actual.build,b.target.blocks(r,c)?'NONE':original.build);
   assert.equal(b.displayGrid.tile(r,c).key,original.key);
  }
 }
});
test('field camera uses upstream bottom-first rows and keeps horizontal lines level',async()=>{
 const {projectCell}=await import('../src/team-field.js');
 assert.ok(projectCell(5,10).y<projectCell(2,10).y);
 assert.equal(projectCell(4,3).y,projectCell(4,17).y);
 assert.ok(projectCell(4,3).x<projectCell(4,17).x);
});
