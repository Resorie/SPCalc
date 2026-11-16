import { arcaneMods, MAGIC_ARCANE, num, skillRec, talentBb, toggleBuff, up } from '../../../vendor/stronghold-regulation/server/sim/content/kits/shared/tier1.js';
import { noOperatorBeside } from '../../../vendor/stronghold-regulation/server/sim/content/kits/ops/op-phatom.js';
import { absoluteRangeKeys, canTargetEnemy } from '../../../vendor/stronghold-regulation/server/sim/targeting.js';
import { dirVec } from '../../../vendor/stronghold-regulation/server/sim/dir.js';

const S1 = 'skchr_yato2_1', S2 = 'skchr_yato2_2', S3 = 'skchr_yato2_3';
const ON_DEPLOY = { kind: 'duration', activateOnDeploy: true, spCost: 0, spType: 'none', trigger: 'NEVER' };
const GROUND = { canHitFly: false, groundOnly: true }, AIR = { canHitFly: true };
const BUFF = 'yato:demondrug', TAG = 'yato:slash';
// Official default-skin Skill_2 OnAttack events, Windows resource 26-11-06-12-42-25-70182449.
const BLADE_FRAMES = [12, 32, 34, 42, 50, 58, 60, 66, 68, 79, 81, 83, 84, 86, 87, 89];

export function yatoKit(_bb, chess) {
  const first = talentBb(chess, 0), second = talentBb(chess, 1);
  const artScale = num(first['attack@atk_scale_1']);
  const s1 = skillRec(chess, S1), s2 = skillRec(chess, S2).bb, s3 = skillRec(chess, S3).bb;
  const setDemon = (battle, unit, active) => battle.addBuff(unit, {
    key: BUFF, duration: active ? Infinity : num(second.duration), refresh: 'replace',
    mods: { atkPct: num(second.atk) + (active ? num(second['yato2_e_002[atk].atk']) : 0) },
  });
  function extraArts(battle, unit, target, amount, isSkill) {
    if (target.alive && amount > 0) battle.dealDamage({
      source: unit, target, type: 'arts', amount, isSkill, attackType: 'ADDITION', noSp: true,
      tags: ['addition', TAG],
    });
  }
  function slash(battle, unit, target, physical = 1, arts = physical) {
    if (!target.alive) return;
    const atk = unit.s.atk;
    battle.dealDamage({ source: unit, target, amount: atk * physical, type: 'phys', isSkill: true, isAttack: true,
      tags: [TAG], applyWay: 'MELEE' });
    extraArts(battle, unit, target, atk * artScale * arts, true);
  }
  function scheduleSlash(battle, unit, time, fn) {
    const deployment = unit.deploySeq;
    battle.after(time, () => {
      if (up(unit) && unit.deploySeq === deployment) fn();
    }, { owner: unit });
  }
  function s2Start({ battle, unit }) {
    setDemon(battle, unit, true);
    const keys = absoluteRangeKeys([[0, 1]], unit.tileR, unit.tileC, unit.dir);
    for (const frame of BLADE_FRAMES) scheduleSlash(battle, unit, frame / 30, () => {
      for (const enemy of battle.enemiesInKeys(keys, unit, GROUND)) slash(battle, unit, enemy, s2.atk_scale, s2.talent_scale);
    });
  }
  function s3Start({ battle, unit }) {
    setDemon(battle, unit, true);
    const [dr, dc] = dirVec(unit.dir);
    const boundary = 0.5 + (dc > 0 ? battle.rect.c1 - unit.x : dc < 0 ? unit.x - battle.rect.c0
      : dr > 0 ? battle.rect.r1 - unit.y : unit.y - battle.rect.r0);
    unit.mem.yatoDash = { dr, dc, x: unit.x, y: unit.y, distant: 0, end: Math.min(boundary, s3.min_dist),
      limit: Math.min(boundary, s3.max_dist), stop: null };
  }
  function s3Tick({ battle, unit, skill, dt }) {
    const dash = unit.mem.yatoDash;
    if (dash.stop != null) {
      if (battle.time + 1e-9 >= dash.stop) skill.end('landing');
      return;
    }
    dash.distant = Math.min(dash.end, dash.distant + 8 * dt);
    const x = dash.x + dash.dc * dash.distant, y = dash.y + dash.dr * dash.distant;
    for (const enemy of battle.foesInColliderRadius(x, y, 0.51)) {
      if (!canTargetEnemy(unit, enemy, AIR)) continue;
      slash(battle, unit, enemy, s3.atk_scale);
      dash.end = Math.min(dash.limit, dash.end + s3.dist_unit);
    }
    if (dash.distant >= dash.end - 1e-9) dash.stop = battle.time + 20 / 30;
  }
  const end = ({ battle, unit, reason }) => { if (reason !== 'death') setDemon(battle, unit, false); };
  return {
    skills: {
      [S1]: { ...ON_DEPLOY, duration: s1.duration, mods: { aspd: s1.bb.attack_speed },
        onStart({ battle, unit }) { unit.mem.yatoCombos = new Map(); setDemon(battle, unit, true); }, onEnd: end },
      [S2]: { ...ON_DEPLOY, duration: 103 / 30, attack: { noAttack: true },
        mods: { taunt: s2.taunt_level }, onStart: s2Start, onEnd: end },
      [S3]: { ...ON_DEPLOY, duration: s3.max_dist / 8 + 1, attack: { noAttack: true },
        mods: { blockCnt: -1 }, flags: { untargetable: true, invulnerable: true, noBlock: true }, onStart: s3Start, onTick: s3Tick, onEnd: end },
    },
    trait: { onEachHit(battle, unit, target) { extraArts(battle, unit, target, unit.s.atk * artScale, false); } },
    install(battle, unit) {
      battle.on('beforeAttack', ctx => {
        if (ctx.attacker !== unit || unit.skill.id !== S1 || !unit.skill.active) return;
        const targets = ctx.targets;
        ctx.targets = [];
        const interval = unit.s.interval;
        let doubleCycle = false;
        for (const enemy of targets) {
          const count = (unit.mem.yatoCombos.get(enemy.id) || 0) + 1;
          unit.mem.yatoCombos.set(enemy.id, count);
          const triple = count % 3 === 0;
          doubleCycle ||= triple;
          // Skill_Attack3 (two pairs) and Skill_Attack4 (one pair) follow two attack intervals.
          const hitTimes = triple ? [11 / 31, 19 / 31, 1 + 9 / 32] : [12 / 30];
          for (const time of hitTimes) scheduleSlash(battle, unit, interval * time, () => {
            if (!canTargetEnemy(unit, enemy, GROUND)) return;
            slash(battle, unit, enemy);
            slash(battle, unit, enemy);
          });
        }
        unit.atkCd = interval * (doubleCycle ? 2 : 1);
        unit.lastAttackAt = battle.time;
        battle.emit('attack', { attacker: unit, targets, isSkill: true });
      }, { owner: unit });
      battle.on('beforeStatus', ctx => {
        if (ctx.target === unit && unit.skill?.active && (unit.skill.id === S2 || unit.skill.id === S3) &&
            ['stun', 'frozen', 'sleep'].includes(ctx.status)) ctx.cancel = true;
      }, { owner: unit });
      if (chess.module?.id !== 'uniequip_003_yato2' || !chess.module.active) return;
      const moduleTalent = (chess.talents || []).find(t => t.fromModule && t.bb?.max_stack_cnt)?.bb;
      const aloneAtk = num(chess.trait?.bb?.atk);
      toggleBuff(battle, unit, 'yato:isolated', () => noOperatorBeside(battle, unit), { atkPct: aloneAtk });
      battle.on('deploy', ({ unit: deployed }) => {
        if (deployed === unit) unit.mem.yatoArtsHits = 0;
      }, { owner: unit });
      if (!moduleTalent) return;
      battle.on('damaged', ({ source, target, type }) => {
        if (source !== unit || target.side !== 'enemy' || type !== 'arts' || !up(unit)) return;
        const count = Math.min(moduleTalent.max_stack_cnt, (unit.mem.yatoArtsHits || 0) + 1);
        unit.mem.yatoArtsHits = count;
        battle.applyStrongest(unit, MAGIC_ARCANE, { duration: Infinity, value: count * moduleTalent.damage_up, mods: arcaneMods });
      }, { owner: unit });
      battle.on('death', ({ unit: removed, reason }) => {
        if (removed === unit && reason === 'retreat' && !unit.mem.yatoFreeWithdrawal) {
          unit.mem.yatoFreeWithdrawal = true;
          unit.respawnAt = battle.time + num(moduleTalent.respawn_time);
        }
      }, { owner: unit });
    },
  };
}
