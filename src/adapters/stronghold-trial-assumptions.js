// Shooting-range assumptions; the vendored battle rules stay independent.
export function arcaneCoverage(data, selection, layers = Number(selection?.layers)) {
  if (!selection || selection.id !== 'arcaneShip') return null;
  const record = data.bonds.arcaneShip, bb = record?.bb;
  if (!bb || ![bb.base_damage_scale, bb.damage_scale_per_stack, bb.power_bond_char_cnt, bb.power_weak_scale].every(Number.isFinite) ||
      Number(selection.count) < record.activeCount) return null;
  const lowHp = Number(selection.count) >= bb.power_bond_char_cnt;
  const multiplier = (bb.base_damage_scale + bb.damage_scale_per_stack * layers)
    * (lowHp ? bb.power_weak_scale : 1);
  return { kind: 'arcaneCoverage', count: Number(selection.count), layers, lowHp, multiplier };
}

export function skillfulCoverage(data, selection, layers = Number(selection?.layers)) {
  if (selection?.id !== 'skillfulShip') return null;
  const record = data.bonds.skillfulShip;
  const { base_attack_speed: base, attack_speed_per_stack: perLayer } = record?.bb ?? {};
  if (!Number.isFinite(base) || !Number.isFinite(perLayer) || Number(selection.count) < record.activeCount) return null;
  return { kind: 'skillfulCoverage', layers, aspd: base + perLayer * layers };
}

export function stationaryTargetSkillWarning(rec) {
  if (rec.skill?.skillId === 'skchr_oxi_2') {
    return '静止靶不攻击，无法靠它触发塔露拉「阂断骤雪」的反击。';
  }
  return null;
}

export function igniteRecoveryAssumption(rec, runtime) {
  if (rec.skill?.skillId !== 'skchr_amgoat_2' || !runtime.IGNITE_RECOVERY_CAP) return null;
  const capFrames = Math.round(runtime.IGNITE_RECOVERY_CAP * 30);
  return {
    kind: 'igniteRecovery',
    capFrames,
    warning: `艾雅法拉的攻击动画原长为 ${capFrames} 帧。「点燃」阻回暂按实际攻击间隔与动画原长中的较短者计算，待官服验证。`,
  };
}
