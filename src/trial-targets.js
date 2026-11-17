export const MAX_TARGET_HP = 1_000_000_000;

export function defaultTrialTarget(manifest) {
  return { hp: MAX_TARGET_HP, bossId: null, ...manifest.defaults.target };
}

export function restoreTrialTarget(saved, manifest) {
  return { ...defaultTrialTarget(manifest), hp: MAX_TARGET_HP, bossId: null, ...saved };
}

export function bossTargetPresets(manifest, data) {
  const mode = manifest.defaults.bossMode?.id;
  if (!mode) return [];
  const bosses = Object.values(data.bosses).sort((a, b) => Number(a.hidden) - Number(b.hidden) || a.sortId - b.sortId);
  return bosses.flatMap(boss => {
    const hp = boss.bloodByMode?.[mode];
    const enemy = data.enemies[boss.enemyKey];
    if (!Number.isInteger(hp) || hp < 1 || hp > MAX_TARGET_HP || !enemy?.stats) return [];
    const { def, res, massLevel: weight, motion } = enemy.stats;
    return [{
      id: boss.bossId,
      name: boss.name + (boss.hidden ? ' · 隐秘核心' : ''),
      target: { bossId: boss.bossId, hp, def, res, weight, motion, rank: enemy.rank },
    }];
  });
}

export function resetTargetPanel(target, manifest) {
  const defaults = defaultTrialTarget(manifest);
  const fields = manifest.defaults.targetReference?.fields ?? ['def', 'res', 'weight', 'rank', 'motion'];
  for (const field of fields) target[field] = defaults[field];
  target.hp = defaults.hp;
  target.bossId = defaults.bossId ?? null;
}

export function targetDefeatTime(enemies) {
  if (enemies.every(enemy => enemy.removeReason === 'killed')) {
    return Math.max(...enemies.map(enemy => enemy.deathAt));
  }
  return null;
}
