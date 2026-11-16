// Statistical attribution only. This never alters combat or credits support buffs as damage.
export function createDamageLedger(roster) {
  const entries = new Map(roster.map(r => [`${r.playerId}/${r.uid}`, {
    ...r, damage: 0, direct: 0, summons: 0, damageTypes: {},
  }]));
  let total = 0, unattributed = 0;
  const damageTypes = {}, damageSources = {};
  function identity(unit) { return unit && `${unit.ownerId}/${unit.uid}`; }
  function ownerOf(unit) {
    const seen = new Set();
    while (unit && !seen.has(unit)) {
      seen.add(unit);
      // Follow ownership before matching: summons may use their summoner's uid.
      if (unit.ownerUnit) { unit = unit.ownerUnit; continue; }
      return entries.get(identity(unit)) || null;
    }
    return null;
  }
  function record(ctx, t) {
    if (ctx.target?.side !== 'enemy' || !(ctx.delta < 0)) return null;
    const amount = -ctx.delta;
    const type = ctx.kind === 'hpLoss' ? 'hpLoss' : (ctx.dmg?.type || 'other');
    const source = ctx.credit || ctx.source;
    const owner = ownerOf(source);
    const name = source?.name || '无来源伤害';
    total += amount;
    damageTypes[type] = (damageTypes[type] || 0) + amount;
    damageSources[name] = (damageSources[name] || 0) + amount;
    if (owner) {
      owner.damage += amount;
      owner[source?.ownerUnit ? 'summons' : 'direct'] += amount;
      owner.damageTypes[type] = (owner.damageTypes[type] || 0) + amount;
    } else unattributed += amount;
    return { t, amount, type, source: name, sourceId: source?.id ?? null,
      operatorId: owner ? `${owner.playerId}/${owner.uid}` : null };
  }
  return {
    record,
    get total() { return total; },
    snapshot() { return Object.fromEntries([...entries].map(([id, r]) => [id, r.damage])); },
    result() { return { total, damageTypes: { ...damageTypes }, damageSources: { ...damageSources },
      damageByOperator: [...entries].map(([id, r]) => ({ id, ...r, damageTypes: { ...r.damageTypes } })),
      unattributedDamage: unattributed }; },
  };
}
