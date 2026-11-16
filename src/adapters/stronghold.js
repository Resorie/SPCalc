import { createTeamAdapter } from './stronghold-team.js';
import { createCatalog } from './stronghold-catalog.js';
import { createDamageLedger } from '../damage-ledger.js';
import { skillWindowStats } from '../skill-stats.js';
import { rulesKey } from '../rulesets.js';
import { arcaneCoverage, igniteRecoveryAssumption, skillfulCoverage, stationaryTargetSkillWarning } from './stronghold-trial-assumptions.js';

export function createAdapter(data, manifest, runtime) {
  const supplementalKits = {};
  if (data.collab) {
    const { units, operators } = data.collab;
    const { diy } = data.backups;
    for (const id of Object.keys(units)) {
      const kit = runtime.supplementalDiyKits?.[id];
      if (!kit || !diy.excluded.includes(id) || !operators[id]) {
        throw new Error(`自选补充数据缺少对应的战斗实现：${id}`);
      }
      supplementalKits[id] = kit;
    }
    const added = Object.keys(supplementalKits);
    data = { ...data, backups: {
      ...data.backups,
      units: { ...data.backups.units, ...units },
      diy: { ...diy, ownedPool: [...diy.ownedPool, ...added],
        excluded: diy.excluded.filter(id => !added.includes(id)), operators: { ...diy.operators, ...operators } },
    } };
  }
  const { Battle, setData, setSimData, setGameData, isMember, KITS, MODULES } = runtime;
  if (manifest.dataSchema !== 'stronghold-data-v1') throw new Error('引擎不支持此数据格式。');
  const required = ['chess','items','bonds','effects','garrisons','tokens','backups','bands','config','choices','bosses','enemies'];
  for (const key of required) if (!data[key]) throw new Error(`规则包缺少 ${key}。`);
  const catalog = createCatalog(data, {
    ...runtime, KITTED_CHARS: [...runtime.KITTED_CHARS, ...Object.keys(supplementalKits)],
  }, manifest.diyExcludedNames);
  if (MODULES.some(([, mod]) => typeof mod.install !== 'function') || Object.keys(KITS).length < 100) {
    throw new Error('战斗模块加载不完整，已停止计算。请刷新页面。');
  }

function bounded(value, name, min, max, integer = false) {
  const n = Number(value);
  if (value === '' || value == null || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new Error(`${name}必须在 ${min}–${max} 之间${integer ? '，且为整数' : ''}。`);
  }
  return n;
}

function validate(config, target) {
  if (!data) throw new Error('数据尚未载入。');
  const rec = catalog.resolve(config);
  const ext = config.external || {};
  for (const key of ['atkPct','atkFlat','atkFinal','aspd']) bounded(ext[key] ?? 0, '外部加成 '+key, 0, 100000);
  bounded(ext.atkMul ?? 1, '攻击独立倍率', 1, 100);

  bounded(target.duration, '测试时长', 1, 300, true);
  bounded(target.def, '防御力', 0, 10000);
  bounded(target.res, '法术抗性', 0, 100);
  bounded(target.weight ?? 6, '重量', 0, 10, true);
  if (!['WALK','FLY'].includes(target.motion ?? 'WALK')) throw new Error('目标类型无效。');
  if (!['NORMAL','BOSS'].includes(target.rank)) throw new Error('敌人分类无效。');
  bounded(target.count, '目标数量', 1, 8, true);
  bounded(target.distance, '目标距离', 1, 5, true);
  bounded(target.seed, '随机种子', 1, 4294967295, true);
  bounded(config.potential, '潜能', 1, 6, true);
  bounded(config.cultivate, '自持有练度', 0, 3, true);
  if (!Array.isArray(config.items) || config.items.length > 2) throw new Error('最多装备两件装备。');
  for (const id of config.items) if (!catalog.isCombatItem(id)) throw new Error(`${data.items[id]?.name || id} 不是当前版本可携带的战斗装备（消耗品或不可获得的进阶记录）。请重新选择。`);
  const seen = new Set();
  for (const b of config.bonds || []) {
    if (!data.bonds[b.id] || seen.has(b.id)) throw new Error('盟约不存在或重复。');
    seen.add(b.id);
    bounded(b.layers, '盟约层数', 0, 999, true);
    if (!data.bonds[b.id].thresholds.includes(Number(b.count))) throw new Error('盟约激活人数无效。');
  }
  if (config.skillIndex != null && !rec.skills?.some(s => s.index === Number(config.skillIndex))) throw new Error('技能无效。');
  return rec;
}

// Single-operator trial. Bond counts determine activation and explicit coverage options
// model selected teammate effects without creating additional units.
function simulate(config, target) {
  const rec = validate(config, target);
  setData(data);
  setSimData(data);
  setGameData(data);
  const dummy = {
    key: 'calculator_target', name: '测试靶', rank: target.rank === 'BOSS' ? 'BOSS' : 'NORMAL', applyWay: 'MELEE',
    stats: { maxHp: 1e9, atk: 0, def: Number(target.def), res: Number(target.res), moveSpeed: 0,
      bat: 2, aspd: 100, rangeRadius: 0, blockCnt: 1, massLevel: Number(target.weight ?? 6), lpr: 0, hpRecoveryPerSec: 0,
      elementRes: 0, elementDmgRes: 0, dmgType: 'phys', motion: target.motion ?? 'WALK', immunities: {}, otherImmunities: [] },
    notCountInTotal: true, tags: [], abilities: [], talents: { bb: {} }, skills: [],
  };
  const bonds = Object.fromEntries((config.bonds || []).map(b => [b.id, {
    count: Number(b.count), layers: Number(b.layers), active: true,
    tier: data.bonds[b.id].thresholds.filter(n => n <= Number(b.count)).length,
  }]));
  let raidTrial = null;
  const raidDeployments = [];
  const arcane = (config.bonds || []).find(x => x.id === 'arcaneShip');
  const useArcaneCoverage = arcaneCoverage(data, arcane) != null;
  const skillful = (config.bonds || []).find(x => x.id === 'skillfulShip');
  let adjacentSkillful = skillfulCoverage(data, skillful);
  const coverArcane = (battle, enemy) => {
    if (!useArcaneCoverage || enemy.side !== 'enemy') return;
    const coverage = arcaneCoverage(data, arcane, battle.getPlayer('p1').bonds.arcaneShip.layers);
    // Same key and strongest-value policy as the real bond: native applications cannot multiply it again.
    battle.applyStrongest(enemy, 'bond:arcaneShip', { duration: Infinity,
      value: coverage.multiplier, mods: value => ({ artsTakenMul: value }) });
  };
  const rows = Array.from({ length: 19 }, () => 'r'.repeat(21));
  const timeline = [], hits = [];
  const damageByTime = new Map();
  const ledger = createDamageLedger([{ playerId: 'p1', uid: 1, chessId: rec.chessId,
    charId: rec.charId, name: rec.name }]);
  const ext = config.external || {};
  const applyExternal = (battle, u) => battle.addBuff(u, { key: 'calculator:external', duration: Infinity, refresh: 'replace',
    mods: { atkPct: Number(ext.atkPct || 0) / 100, atkFlat: Number(ext.atkFlat || 0), atkFinal: Number(ext.atkFinal || 0),
      atkMul: Number(ext.atkMul ?? 1), aspd: Number(ext.aspd || 0) } });
  const b = new Battle({
    kits: supplementalKits,
    data: { ...data, enemies: { ...data.enemies, calculator_target: dummy } },
    stage: { id: 'calculator', name: '固定靶场', rows, devices: [] },
    rect: { r0: 0, r1: 18, c0: 0, c1: 20 },
    seed: Number(target.seed), kind: 'normal', modeId: 'mode_multi_normal', round: 1,
    timeLimit: Number(target.duration) + 1, autoFinish: false, recordEvents: false, devices: false,
    flags: { layerGainsEnabled: true, startOpCooldown: 3, dpInit: 99, dpMax: 99, dpPerSec: 1 },
    players: [{ playerId: 'p1', bonds, units: [{
      uid: 1, chessId: rec.chessId, row: 10, col: 4, dir: 'RIGHT',
      skillIndex: Number(config.skillIndex ?? rec.skill?.index ?? 0),
      moduleId: rec.isGolden ? config.moduleId : undefined,
      ...(config.diy ? { diy: { ...config.diy, skillIndex: Number(config.skillIndex) } } : {}),
      potential: Number(config.potential), cultivate: Number(config.cultivate), items: config.items,
    }] }],
    setup(battle) {
      const u = battle.allyUnits.find(x => x.uid === 1 && x.kind === 'op');
      if (adjacentSkillful && isMember(battle, u, 'skillfulShip')) adjacentSkillful = null;
      if (adjacentSkillful) {
        const applySkillful = () => {
          if (!u.alive || !u.deployed) return;
          const { layers } = battle.getPlayer('p1').bonds.skillfulShip;
          const { aspd } = skillfulCoverage(data, skillful, layers);
          if (u.findBuff('calculator:skillfulCoverage')?.mods?.aspd !== aspd) {
            battle.addBuff(u, { key: 'calculator:skillfulCoverage', mods: { aspd } });
          }
        };
        battle.on('deploy', ({ unit }) => { if (unit === u) applySkillful(); });
        battle.on('layerGain', ({ playerId, bondId }) => {
          if (playerId === 'p1' && bondId === 'skillfulShip') battle.after(0, applySkillful, { owner: u });
        });
      }
      if (bonds.raidShip && isMember(battle, u, 'raidShip') && (target.motion ?? 'WALK') === 'WALK') {
        // Start at the left edge facing away from a ground target. Native Raid selects a reachable landing.
        u.homeR = 10; u.homeC = 2; u.dir = 'LEFT';
        raidTrial = { kind: 'raidApproach', initial: [10,2], target: [10,9], direction: 'LEFT', ignoresDistance: true };
      }
      battle.on('deploy', ({ unit }) => {
        if (unit.uid === 1 && unit.kind === 'op' && unit.removeReason === 'raid') {
          const event = { t: battle.time, kind: 'raidDeploy', name: '突袭再部署', row: unit.tileR, col: unit.tileC };
          raidDeployments.push(event); timeline.push(event);
        }
      });
      if (useArcaneCoverage) battle.on('damageCalculateTarget', ({ target }) => coverArcane(battle, target), { priority: 10000 });
      battle.on('deploy', ({unit}) => { if (unit.uid === 1 && unit.kind === 'op') applyExternal(battle, unit); });
      battle.on('hpChanged', ctx => {
        const hit = ledger.record(ctx, battle.time);
        if (hit) {
          damageByTime.set(hit.t, (damageByTime.get(hit.t) || 0) + hit.amount);
          if (hits.length < 10000) hits.push(hit);
        }
      });
      for (const event of ['skillStart', 'skillEnd']) battle.on(event, ctx => {
        if (ctx.unit.uid === 1) timeline.push({ t: battle.time, kind: event, name: ctx.skill.name || rec.skill?.name });
      });
    },
  });
  // Fixed targets are already present when deployment talents check the field, as in the team trial.
  const targets = [];
  for (let i = 0; i < Number(target.count); i++) {
    const pos = raidTrial?.target || [10, 4 + Number(target.distance)];
    const enemy = b.spawnEnemy('calculator_target', { pos, route: { motion: target.motion ?? 'WALK', start: pos, end: [10, 0], checkpoints: [] } });
    if (!enemy) throw new Error('靶子创建失败。');
    // Stop the target's AI, without granting invulnerability or changing its mitigation.
    enemy.profile.canAttack = false;
    enemy.atkCd = Infinity;
    coverArcane(b, enemy);
    targets.push(enemy);
  }
  b.start();
  const unit = b.allyUnits.find(u => u.uid === 1);
  if (!unit) throw new Error('干员未能进入靶场。');
  applyExternal(b, unit);
  const opening = { atk: unit.s.atk, interval: unit.s.interval, maxHp: unit.s.maxHp };
  const samples = [{ t: 0, damage: ledger.total, operators: ledger.snapshot() }];
  for (let i = 0; i < Number(target.duration) * 30 && !b.finished; i++) {
    b.step();
    if ((i + 1) % 30 === 0) samples.push({ t: (i + 1) / 30, damage: ledger.total, operators: ledger.snapshot() });
  }
  if (b.errors.length) throw new Error(`引擎报告异常，结果未展示：${JSON.stringify(b.errors[0]).slice(0,180)}`);
  const { total } = ledger;
  const assumptions = useArcaneCoverage ? [arcaneCoverage(data, arcane, b.getPlayer('p1').bonds.arcaneShip.layers)] : [];
  if (raidTrial) assumptions.push({ ...raidTrial, deployments: raidDeployments });
  const warnings = [stationaryTargetSkillWarning(rec)].filter(Boolean);
  if (adjacentSkillful) {
    assumptions.push(adjacentSkillful);
    warnings.push(`靶场假设：灵巧队友全程相邻，起始攻击速度 +${adjacentSkillful.aspd}。加成随战斗中灵巧层数变化。`);
  }
  const igniteRecovery = igniteRecoveryAssumption(rec, runtime);
  if (igniteRecovery) {
    assumptions.push(igniteRecovery);
    warnings.push(igniteRecovery.warning);
  }
  if (raidTrial) warnings.push(`靶场假设：突袭成员初始远离地面靶并背向靶子，忽略前方距离设置；由实际盟约触发再部署并选择能攻击靶子的落点。本次突袭再部署 ${raidDeployments.length} 次${raidDeployments[0] ? `，首次在 ${raidDeployments[0].t.toFixed(2)} 秒` : '（测试时长或触发条件未满足）'}。`);
  if (useArcaneCoverage) warnings.push(`靶场假设：奥术全程覆盖所有靶子；${Number(arcane.count) >= data.bonds.arcaneShip.bb.power_bond_char_cnt ? '3 人档按生命低于 50% 的强化增幅结算（不改变靶子实际血量）' : '2 人档按普通增幅结算'}。无需本干员属于奥术，首段法伤即生效；层数变化继续参与计算。`);
  if (unit.kit?.generic || unit.kit?.skillSource === 'generic') warnings.push('所选技能使用上游通用实现，尚未逐项核对原版。');
  if (total === 0) warnings.push('本场没有产生伤害：请检查射程、技能触发条件，以及是否需要其他单位。');
  if (targets.some(e => !e.alive)) warnings.push('靶子被击杀或触发斩杀，后续输出不再代表持续打靶。');
  if (targets.some(e => Math.abs(e.x - (raidTrial?.target[1] ?? (4 + Number(target.distance)))) > 0.1 || Math.abs(e.y - (raidTrial?.target[0] ?? 10)) > 0.1)) warnings.push('技能或装备移动了靶子，射程与接触状态会影响结果。');
  if (target.rank === 'BOSS') warnings.push('领袖选项仅设置敌人分类；未模拟具体首领技能、共享生命池或终局单次伤害上限。');
  if (rec.tokens?.length) warnings.push('当前只包含技能自动生成的召唤物；需要手动布置的召唤物尚未入场。');
  if ((config.bonds || []).length) warnings.push('盟约人数是外部激活条件。队友效果仅按已启用的靶场假设计入。');
  return { version: manifest.id, rules: rulesKey(manifest), config: structuredClone(config), target: structuredClone(target), ...ledger.result(), dps: total / Number(target.duration),
    samples, timeline, hits, opening, warnings, assumptions,
    skillWindow: skillWindowStats(timeline, damageByTime, Math.min(b.time, Number(target.duration))),
    activations: unit.skill?.activations || 0, firstHit: hits[0]?.t ?? null,
    actualDuration: b.time, kitSource: unit.kit?.skillSource || 'kit',
  };
}

  return { simulate, validate, catalog, ...createTeamAdapter(data, manifest, catalog, validate, runtime, supplementalKits) };
}
