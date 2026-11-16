import { num, skillRec, talentBb, up } from '../../../vendor/stronghold-regulation/server/sim/content/kits/shared/tier1.js';
import { absoluteRangeKeys, canTargetEnemy } from '../../../vendor/stronghold-regulation/server/sim/targeting.js';
import { acquireTargets } from '../../../vendor/stronghold-regulation/server/sim/ai.js';
import { dirVec } from '../../../vendor/stronghold-regulation/server/sim/dir.js';

const S1 = 'skchr_orchd2_1', S2 = 'skchr_orchd2_2', S3 = 'skchr_orchd2_3';
const AIR = { canHitFly: true }, LAND = [[1, 1], [0, 1], [-1, 1]];
const NO_ATTACK = { noAttack: true };
const TAG = 'orchid:arrow';

export function orchidKit(_bb, chess) {
  const power = talentBb(chess, 0), mobility = talentBb(chess, 1);
  const extendedRedeploy = chess.talents?.find(t => t.index === 1)?.bbStr?.ignore_build_type_target_range === 'x-2';
  const s1 = skillRec(chess, S1).bb, s2 = skillRec(chess, S2), s3 = skillRec(chess, S3).bb;
  const normalScale = num(talentBb(chess, 2)['attack@damage_scale'], 0.333);
  function beginSkill(unit) {
    const first = !unit.mem.orchidOpened;
    if (first) {
      unit.mem.orchidOpened = true;
      unit.mem.orchidCoating = power.power_attack_count;
    }
    return first;
  }
  function attackPower(unit) {
    const active = unit.mem.orchidCoating > 0;
    if (active) unit.mem.orchidCoating--;
    return unit.s.atk * (active ? power.power_attack_scale : 1);
  }
  function announceAttack(battle, unit, targets, isSkill) {
    unit.lastAttackAt = battle.time;
    battle.emit('attack', { attacker: unit, targets, isSkill });
  }
  function arrows(battle, unit, targets, count, scale, { skill = true, stun = false, normal = false } = {}) {
    if (!targets.length) return;
    const amount = attackPower(unit) * scale;
    const attackId = ++battle._attackSeq;
    announceAttack(battle, unit, targets, skill);
    for (const target of targets) {
      for (let hit = 0; hit < count; hit++) {
        battle.addProjectile({ from: unit, target, source: unit, speed: 15, visual: 'arrow', onHit({ target: enemy }) {
          if (!canTargetEnemy(unit, enemy, AIR)) return;
          battle.dealDamage({ source: unit, target: enemy, amount, type: 'phys', isSkill: skill, isAttack: true,
            mul: normal ? normalScale : 1, noSp: normal && hit > 0, attackId, tags: [TAG], applyWay: 'RANGED' });
          if (stun && enemy.alive && battle.rng.chance(s1.stun_prob)) {
            battle.applyStatus(enemy, 'stun', { duration: s1.stun, source: unit });
          }
        } });
      }
    }
  }
  function withCast(battle, unit, skill, time, fn) {
    const deploySeq = unit.deploySeq, activation = skill.activations;
    battle.after(time, () => {
      if (up(unit) && unit.deploySeq === deploySeq && skill.active && skill.activations === activation) fn();
    }, { owner: unit });
  }
  function choose(battle, unit) {
    return acquireTargets(battle, unit, { ...unit.profile, noAttack: false }).slice(0, 1);
  }
  function rapid({ battle, unit, skill }) {
    const first = beginSkill(unit);
    const chained = skill.charges > 0;
    if (chained) skill.charges--;
    const begin = (first ? 30 : 3) / 30;
    skill.timeLeft = begin + (chained ? 80 : 45) / 30;
    withCast(battle, unit, skill, begin + 20 / 30, () => {
      const targets = choose(battle, unit);
      if (targets.length) arrows(battle, unit, targets, 4, s1.atk_scale_1);
    });
    if (chained) withCast(battle, unit, skill, begin + 55 / 30, () => {
      const targets = choose(battle, unit);
      if (targets.length) arrows(battle, unit, targets, 5, s1.atk_scale_2, { stun: true });
      else {
        skill.addCharge(1);
        skill.end('no follow-up target');
      }
    });
  }
  function aerial({ battle, unit, skill }) {
    const begin = (beginSkill(unit) ? 45 : 20) / 30;
    skill.timeLeft = begin + 105 / 30;
    const grid = absoluteRangeKeys(s2.rangeGrid, unit.tileR, unit.tileC, unit.dir);
    [3, 4, 5].forEach((count, wave) => withCast(battle, unit, skill, begin + (5 + 25 * wave) / 30, () => {
      arrows(battle, unit, battle.enemiesInKeys(grid, unit, AIR), count, s2.bb['attack@atk_scale_loop']);
    }));
    const land = absoluteRangeKeys(LAND, unit.tileR, unit.tileC, unit.dir);
    withCast(battle, unit, skill, begin + 82 / 30, () => {
      const targets = battle.enemiesInKeys(land, unit, AIR);
      if (!targets.length) return;
      const amount = attackPower(unit) * s2.bb['attack@atk_scale_end'];
      announceAttack(battle, unit, targets, true);
      for (const enemy of targets) battle.dealDamage({ source: unit, target: enemy, amount, type: 'phys',
        isSkill: true, isAttack: true, tags: [TAG], applyWay: 'RANGED' });
    });
  }
  function piercing({ battle, unit, skill }) {
    const windup = (beginSkill(unit) ? 65 : 45) / 30 + s3.wait_duration;
    skill.timeLeft = windup + 37 / 30;
    withCast(battle, unit, skill, windup + 3 / 30, () => {
      const [dr, dc] = dirVec(unit.dir);
      const shot = { x: unit.x, y: unit.y + 0.2323, dr, dc, atk: attackPower(unit), passed: new Map(), life: 0, travelled: 0, pulse: 0 };
      (unit.mem.orchidShots ??= []).push(shot);
      announceAttack(battle, unit, [], true);
    });
  }
  function tickShots(battle, unit) {
    const shots = unit.mem.orchidShots;
    if (!shots?.length) return;
    unit.mem.orchidShots = shots.filter(shot => {
      const movement = 10 * battle.dt;
      shot.x += movement * shot.dc;
      shot.y += movement * shot.dr;
      shot.travelled += movement;
      shot.life += battle.dt;
      if (shot.x < battle.rect.c0 - 0.5 || shot.x > battle.rect.c1 + 0.5 || shot.y < battle.rect.r0 - 0.5 ||
          shot.y > battle.rect.r1 + 0.5 || shot.travelled > s3.max_dist || shot.life > 30) return false;
      if (shot.travelled + 1e-9 < shot.pulse + s3.dist_interval) return true;
      shot.pulse = shot.travelled;
      const attackId = ++battle._attackSeq;
      for (const enemy of battle.foesInColliderRadius(shot.x, shot.y, 0.5)) {
        if (!canTargetEnemy(unit, enemy, AIR)) continue;
        battle.dealDamage({ source: unit, target: enemy, amount: shot.atk * s3.atk_scale,
          type: 'phys', isSkill: true, isAttack: true, attackId, tags: [TAG], applyWay: 'RANGED' });
        if (enemy.alive) battle.dealDamage({ source: unit, target: enemy, amount: shot.atk * s3.atk_scale_magic,
          type: 'arts', isSkill: true, isAttack: true, attackId, tags: [TAG], applyWay: 'RANGED' });
        if (enemy.alive && battle.time >= (shot.passed.get(enemy.id) ?? -Infinity)) {
          battle.push(enemy, s3.force, { dir: { x: shot.dc, y: shot.dr }, fixed: true });
          shot.passed.set(enemy.id, battle.time + s3.knockback_duration);
        }
      }
      return true;
    });
  }
  return {
    skills: {
      [S1]: { kind: 'duration', attack: NO_ATTACK, onStart: rapid },
      [S2]: {
        kind: 'duration',
        // Regulation's Sniper strategy checks both ATTACK_RANGE_ENEMY and SKILL_RANGE_ENEMY.
        trigger: { rule: 'SKILL_RANGE', grid: s2.rangeGrid, includeAttackRange: true },
        attack: NO_ATTACK,
        flags: { liftoff: true, blockFly: true },
        onStart: aerial,
      },
      [S3]: { kind: 'duration', attack: NO_ATTACK, onStart: piercing },
    },
    install(battle, unit) {
      unit.base.respawnTime = Math.max(0, unit.base.respawnTime + num(talentBb(chess, 3).respawn_time));
      battle.on('death', ({ unit: gone }) => {
        if (gone === unit) unit.mem.orchidPrevious = [unit.tileR, unit.tileC];
      }, { owner: unit });
      battle.on('deploy', ({ unit: deployed }) => {
        if (deployed !== unit) return;
        unit.mem.orchidOpened = false;
        unit.mem.orchidCoating = 0;
        const prev = unit.mem.orchidPrevious;
        const distance = prev && [Math.abs(prev[0] - unit.tileR), Math.abs(prev[1] - unit.tileC)];
        if (distance && (extendedRedeploy
          ? Math.max(...distance) <= 2 && Math.min(...distance) <= 1
          : distance[0] + distance[1] <= 2)) {
          battle.addBuff(unit, { key: 'orchid:mobility', duration: mobility.atk_duration, mods: { atkPct: mobility.atk } });
        }
        if (unit.skill.id === S2) unit.skill.activate('deploy', { free: true });
      }, { owner: unit });
      battle.on('tick', () => {
        tickShots(battle, unit);
        const sk = unit.skill;
        if (up(unit) && unit.canAct && !unit.s.flags.silence && sk.id === S1 && !sk.active && sk.charges === sk.maxCharges) {
          sk.activate('full charge');
        }
      }, { owner: unit });
      battle.on('beforeAttack', ctx => {
        if (ctx.attacker !== unit || ctx.isSkill) return;
        const targets = ctx.targets, deploySeq = unit.deploySeq;
        ctx.targets = [];
        // The ordinary Attack_* clip releases its three projectiles on frame 18 of 48; scale with attack speed.
        battle.after(unit.s.interval * 18 / 48, () => {
          if (!up(unit) || unit.deploySeq !== deploySeq || !unit.canAct) return;
          arrows(battle, unit, targets.filter(e => canTargetEnemy(unit, e, AIR)), 3, 1, { skill: false, normal: true });
        }, { owner: unit });
      }, { owner: unit });
    },
  };
}
