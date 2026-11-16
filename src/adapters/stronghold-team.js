import { targetGeometry } from './stronghold-target-geometry.js';
import { TEAM_RECT, teamBoard, teamBonds, deploymentErrors, initialRange, ownBonds } from './stronghold-team-board.js';
import { arcaneCoverage, igniteRecoveryAssumption, stationaryTargetSkillWarning } from './stronghold-trial-assumptions.js';
import { createDamageLedger } from '../damage-ledger.js';
import { skillWindowStats } from '../skill-stats.js';
import { rulesKey } from '../rulesets.js';

export function createTeamAdapter(data,manifest,catalog,validateOperator,runtime,supplementalKits) {
  const { Battle, setData, setSimData, setGameData, isMember, absoluteRangeKeys } = runtime;
  const supportsArcaneCoverage = arcaneCoverage(data, { id: 'arcaneShip', count: 2, layers: 0 }) != null;
  const teamMaps=Object.values(data.stages||{}).filter(s=>s.active).map(s=>({id:s.id,name:s.name}));
  function validateTeam(team,target,scene) {
    if(!data.stages)throw new Error('此规则包没有团队地图，请选择团队规则包。');
    if(!team || !Array.isArray(team.members)||team.members.length<1||team.members.length>9)throw new Error('每队需要 1–9 名干员。');
    if(!Array.isArray(team.bonds))throw new Error('团队盟约格式无效。');
    const ids=new Set();
    for(const m of team.members) {
      if(!Number.isInteger(m.uid)||m.uid<1||ids.has(m.uid))throw new Error('队员实例编号无效或重复。');ids.add(m.uid);
      validateOperator({...m.config,bonds:[]},{...target,distance:target.distance??1});
    }
    const seen=new Set();
    for(const b of team.bonds) {
      if(!data.bonds[b.id]||seen.has(b.id))throw new Error('团队盟约不存在或重复。');seen.add(b.id);
      if(b.layers===''||!Number.isInteger(Number(b.layers))||b.layers<0||b.layers>999)throw new Error('盟约层数必须为 0–999 整数。');
      if(b.count!=null&&(!Number.isInteger(Number(b.count))||b.count<0||b.count>20))throw new Error('盟约覆盖人数必须为 0–20 整数。');
    }
    for(const key of ['arcane','raid'])if(team.assumptions?.[key]!=null&&typeof team.assumptions[key]!=='boolean')throw new Error('简化选项格式无效。');
    if(team.assumptions?.raid&&(target.motion??'WALK')!=='WALK')throw new Error('突袭预设接敌需要地面靶。');
    const errors=deploymentErrors(data,catalog,team,scene,target,runtime);if(errors.length)throw new Error(errors.join('；'));
    return teamBonds(data,catalog,team,runtime);
  }
  function simulateTeam(team,target,scene) {
    const bonds=validateTeam(team,target,scene);
    setData(data);setSimData(data);setGameData(data);
    const {stage,canPlace,board}=teamBoard(data,scene.stageId,scene,runtime);
    const geometry=targetGeometry(scene);
    const touches=keys=>geometry.keys.some(k=>keys.includes(k));
    const records=new Map(team.members.map(m=>[m.uid,catalog.resolve(m.config)]));
    const ledger=createDamageLedger(team.members.map(m=>({playerId:'p1',uid:m.uid,chessId:m.config.chessId,charId:records.get(m.uid).charId,name:records.get(m.uid).name})));
    const timeline=[],hits=[],samples=[],assumptions=[],damageTimes=new Map(team.members.map(m=>[`p1/${m.uid}`,new Map()]));
    const diagnostics={healing:[],bursts:[],skillStarts:[],exits:[],ammoGains:[],eventLimit:2000};
    const dummy={key:'calculator_target',name:'团队测试靶',rank:target.rank,applyWay:'MELEE',
      stats:{maxHp:1e9,atk:0,def:Number(target.def),res:Number(target.res),moveSpeed:0,bat:2,aspd:100,rangeRadius:0,blockCnt:1,massLevel:Number(target.weight??6),lpr:0,hpRecoveryPerSec:0,elementRes:0,elementDmgRes:0,dmgType:'phys',motion:target.motion??'WALK',immunities:{},otherImmunities:[]},
      hitArea:geometry.hitArea,notCountInTotal:true,tags:[],abilities:[],talents:{bb:{}},skills:[]};
    const arcane=supportsArcaneCoverage&&team.assumptions?.arcane&&bonds.arcaneShip?.active?{id:'arcaneShip',count:bonds.arcaneShip.count,layers:bonds.arcaneShip.layers}:null;
    if(arcane)assumptions.push(arcaneCoverage(data,arcane));
    const cover=(battle,e)=>{if(arcane&&e.side==='enemy'){const a=arcaneCoverage(data,arcane,battle.getPlayer('p1').bonds.arcaneShip.layers);battle.applyStrongest(e,'bond:arcaneShip',{duration:Infinity,value:a.multiplier,mods:v=>({artsTakenMul:v})});}};
    const configByUid=new Map(team.members.map(m=>[m.uid,m.config]));
    const applyExternal=(battle,u)=>{
      const c=configByUid.get(u.uid);if(!c||u.kind!=='op')return;
      const e=c.external||{};
      battle.addBuff(u,{key:'calculator:external',duration:Infinity,refresh:'replace',mods:{atkPct:Number(e.atkPct||0)/100,atkFlat:Number(e.atkFlat||0),atkFinal:Number(e.atkFinal||0),atkMul:Number(e.atkMul??1),aspd:Number(e.aspd||0)}});
    };
    const b=new Battle({kits:supplementalKits,data:{...data,enemies:{...data.enemies,calculator_target:dummy}},stage,rect:TEAM_RECT,
      seed:Number(target.seed),kind:'boss',modeId:manifest.defaults.bossMode?.id ?? 'mode_single_abyss',round:manifest.defaults.bossMode?.round ?? 14,timeLimit:Number(target.duration)+1,autoFinish:false,recordEvents:false,
      flags:{layerGainsEnabled:true,startOpCooldown:3,dpInit:99,dpMax:99,dpPerSec:1},
      players:[{playerId:'p1',bonds,coords:'field',units:team.members.map(m=>({uid:m.uid,chessId:m.config.chessId,row:m.row,col:m.col,dir:m.dir,skillIndex:m.config.skillIndex,moduleId:records.get(m.uid).isGolden?m.config.moduleId:undefined,potential:m.config.potential,cultivate:m.config.cultivate,items:m.config.items,...(m.config.diy?{diy:{...m.config.diy,skillIndex:m.config.skillIndex}}:{})}))}],
      setup(battle){
        battle.getPlayer('p1')._boardKeys=new Set();
        for(let r=2;r<=5;r++)for(let c=2;c<=18;c++)if(board(r,c)&&!geometry.blocks(r,c))battle.getPlayer('p1')._boardKeys.add(r*21+c);
        if(team.assumptions?.raid&&bonds.raidShip.active) {
          if((target.motion??'WALK')!=='WALK')throw new Error('突袭预设接敌需要地面靶。');
          const raidUnits=battle.allyUnits.filter(u=>u.kind==='op'&&isMember(battle,u,'raidShip'));
          const raidIds=new Set(raidUnits.map(u=>u.uid));
          const reserved=new Set(team.members.filter(m=>!raidIds.has(m.uid)).map(m=>`${m.row},${m.col}`));
          for(const k of geometry.blocked)reserved.add(`${Math.floor(k/21)},${k%21}`);
          if(!geometry.boss)reserved.add(`${scene.targetRow},${scene.targetCol}`);
          const candidates=new Map();
          for(const u of raidUnits) {
            const list=[],cells=new Set();
            for(let r=2;r<=5;r++)for(let c=2;c<=18;c++)for(const dir of ['RIGHT','UP','LEFT','DOWN']){
              if(!canPlace(records.get(u.uid),r,c)||reserved.has(`${r},${c}`))continue;
              if(touches(absoluteRangeKeys(u.rangeGrid,r,c,dir,u.s.rangeExtend)))continue;
              const key=`${r},${c}`;if(!cells.has(key)){list.push({r,c,dir});cells.add(key);}
            }
            candidates.set(u.uid,list);
          }
          const order=raidUnits.slice().sort((a,b)=>candidates.get(a.uid).length-candidates.get(b.uid).length);
          const chosen=new Map(),occupant=new Map();
          function assign(uid,seen){for(const p of candidates.get(uid)){const key=`${p.r},${p.c}`;if(seen.has(key))continue;seen.add(key);const previous=occupant.get(key);if(previous==null||assign(previous,seen)){occupant.set(key,uid);chosen.set(uid,p);return true;}}return false;}
          if(!order.every(u=>assign(u.uid,new Set())))throw new Error('地图没有足够的合法远离靶子的位置；请调整阵型或关闭突袭简化。');
          const occupied=new Set([...reserved,...chosen.values()].map(p=>typeof p==='string'?p:`${p.r},${p.c}`));
          occupied.delete(`${scene.targetRow},${scene.targetCol}`); // Raid may land on the enemy's body tile.
          for(const u of raidUnits){
            const p=chosen.get(u.uid);let canLand=false;
            for(let r=2;r<=5;r++)for(let c=2;c<=18;c++)if(canPlace(records.get(u.uid),r,c)&&!occupied.has(`${r},${c}`)&&geometry.keys.some(k=>Math.max(Math.abs(r-Math.floor(k/21)),Math.abs(c-k%21))<=2)&&touches(absoluteRangeKeys(u.rangeGrid,r,c,p.dir,u.s.rangeExtend)))canLand=true;
            if(!canLand)throw new Error(`${u.name} 找不到能接触靶子的突袭落点，请调整阵型或关闭简化。`);
            u.homeR=p.r;u.homeC=p.c;u.dir=p.dir;assumptions.push({kind:'raidApproach',uid:u.uid,initial:[p.r,p.c],direction:p.dir});
          }
        }
        battle.on('deploy',({unit})=>{
          applyExternal(battle,unit);
          if(unit.kind==='op'&&unit.removeReason==='raid')timeline.push({t:battle.time,kind:'raidDeploy',uid:unit.uid,name:'突袭再部署',row:unit.tileR,col:unit.tileC});
        });
        if(arcane)battle.on('damageCalculateTarget',({target})=>cover(battle,target),{priority:10000});
        battle.on('hpChanged',ctx=>{
          if(ctx.delta>0&&ctx.target?.side==='ally'&&diagnostics.healing.length<2000)diagnostics.healing.push({t:battle.time,sourceUid:ctx.source?.uid,targetUid:ctx.target?.uid,amount:ctx.delta});
          const hit=ledger.record(ctx,battle.time);
          if(hit){if(hits.length<10000)hits.push(hit);const map=damageTimes.get(hit.operatorId);if(map)map.set(hit.t,(map.get(hit.t)||0)+hit.amount);}
        });
        for(const kind of ['skillStart','skillEnd'])battle.on(kind,ctx=>{
          if(ctx.unit.kind!=='op'||!configByUid.has(ctx.unit.uid))return;
          timeline.push({t:battle.time,kind,uid:ctx.unit.uid,name:ctx.skill.name,reason:ctx.reason});
          if(kind==='skillStart'&&diagnostics.skillStarts.length<2000)diagnostics.skillStarts.push({t:battle.time,uid:ctx.unit.uid,ammo:ctx.skill.ammoLeft});
        },{priority:-10000});
        const burstAmmo=new WeakMap();
        battle.on('elementBurst',ctx=>{burstAmmo.set(ctx,new Map(battle.allyUnits.filter(u=>u.kind==='op').map(u=>[u.uid,u.skill?.ammoLeft??0])));},{priority:10000});
        battle.on('elementBurst',ctx=>{const before=burstAmmo.get(ctx);for(const u of battle.allyUnits){const gain=(u.skill?.ammoLeft??0)-(before?.get(u.uid)??0);if(u.kind==='op'&&gain>0&&diagnostics.ammoGains.length<2000)diagnostics.ammoGains.push({t:battle.time,uid:u.uid,gain,element:ctx.element,targetId:ctx.target?.id});}},{priority:-9999});
        battle.on('elementBurst',ctx=>{if(diagnostics.bursts.length<2000)diagnostics.bursts.push({t:battle.time,element:ctx.element,targetId:ctx.target?.id});},{priority:-10000});
        battle.on('death',ctx=>{if(ctx.unit.kind==='op')diagnostics.exits.push({t:battle.time,uid:ctx.unit.uid,reason:ctx.reason});});
      }
    });
    if(b.errors.length)throw new Error(`团队布阵初始化失败：${JSON.stringify(b.errors[0]).slice(0,250)}`);
    // Targets exist before initial deployment, so deploy-time effects can hit them.
    const enemies=[];
    for(let i=0;i<Number(target.count);i++){
      const pos=[scene.targetRow,scene.targetCol];
      const e=b.spawnEnemy('calculator_target',{pos,route:{motion:target.motion??'WALK',start:pos,end:[2,2],checkpoints:[]}});
      e.profile.canAttack=false;e.atkCd=Infinity;cover(b,e);enemies.push(e);
    }
    b.start();
    const openings=b.allyUnits.filter(u=>u.kind==='op').map(u=>({uid:u.uid,atk:u.s.atk,interval:u.s.interval,maxHp:u.s.maxHp,row:u.tileR,col:u.tileC}));
    samples.push({t:0,damage:ledger.total,operators:ledger.snapshot()});
    for(let i=0;i<Number(target.duration)*30&&!b.finished;i++){
      b.step();if((i+1)%30===0)samples.push({t:(i+1)/30,damage:ledger.total,operators:ledger.snapshot()});
    }
    if(b.errors.length)throw new Error(`团队引擎异常：${JSON.stringify(b.errors[0]).slice(0,200)}`);
    const duration=Math.min(b.time,Number(target.duration)),out=ledger.result();
    out.damageByOperator=out.damageByOperator.map(o=>({...o,dps:o.damage/Number(target.duration),skillWindow:skillWindowStats(timeline.filter(e=>e.uid===o.uid),damageTimes.get(o.id),duration),activations:timeline.filter(e=>e.uid===o.uid&&e.kind==='skillStart').length}));
    const warnings=['地图环境沿用复刻实现，尚未逐项完成原版实测校准。靶子无控制免疫、无 Boss 技能与共享生命池。'];
    for (const [uid, rec] of records) {
      const warning = stationaryTargetSkillWarning(rec);
      if (warning && !warnings.includes(warning)) warnings.push(warning);
      const igniteRecovery = igniteRecoveryAssumption(rec, runtime);
      if (igniteRecovery) {
        assumptions.push({ ...igniteRecovery, uid });
        if (!warnings.includes(igniteRecovery.warning)) warnings.push(igniteRecovery.warning);
      }
    }
    if(team.assumptions?.arcane&&!arcane)warnings.push(supportsArcaneCoverage?'奥术简化未生效：奥术盟约人数不足或未激活。':'当前版本按新版奥术的实际触发结算，旧版奥术简化未生效。');
    if(team.assumptions?.raid&&!assumptions.some(a=>a.kind==='raidApproach'))warnings.push('突袭简化未生效：突袭未激活或场上没有突袭成员。');
    for(const u of b.allyUnits)if(u.kind==='op'&&u.kit?.generic)warnings.push(`${u.name} 使用通用技能实现，尚未核对原版。`);
    if(enemies.some(e=>!e.alive))warnings.push('靶子被击杀或斩杀，后续不再代表持续输出。');
    if(enemies.some(e=>Math.abs(e.x-scene.targetCol)>.1||Math.abs(e.y-scene.targetRow)>.1))warnings.push('靶子被技能移动，实际接触范围已变化。');
    if(ledger.total===0)warnings.push('没有造成伤害，请检查靶子位置、队员朝向与技能条件。');
    if(assumptions.some(a=>a.kind==='raidApproach'||a.kind==='arcaneCoverage'))warnings.push('本方案开启了靶场简化，详见配置与导出结果中的 assumptions。');
    return {mode:'team',version:manifest.id,rules:rulesKey(manifest),config:structuredClone(team),target:structuredClone(target),scene:structuredClone(scene),...out,dps:ledger.total/Number(target.duration),samples,timeline,hits,openings,warnings,assumptions,bonds,diagnostics,actualDuration:b.time,firstHit:hits[0]?.t??null};
  }
  return {teamMaps, supportsArcaneCoverage,
    teamBoard: (stageId, scene) => teamBoard(data, stageId, scene, runtime),
    deploymentErrors: (team, scene, target) => deploymentErrors(data, catalog, team, scene, target, runtime),
    initialRange: (rec, member) => initialRange(rec, member, runtime),
    ownBonds: (rec, items) => ownBonds(data, rec, items, runtime),validateTeam,simulateTeam,teamBonds:team=>teamBonds(data,catalog,team,runtime)};
}
