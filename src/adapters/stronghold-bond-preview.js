import { arcaneCoverage } from './stronghold-trial-assumptions.js';
// Display metadata supplied by this rule pack; no combat state is modified.
export function describeBond(record, selection) {
  const layers = Number(selection.layers), count = Number(selection.count);
  if (selection.layers === '' || !Number.isFinite(layers) || layers < 0) return null;
  const values = {};
  for (const param of record.effectDescParams || []) {
    const base = record.bb?.[param.base], per = record.bb?.[param.perStack];
    if (!Number.isFinite(base) || !Number.isFinite(per)) continue;
    let value = base + per * layers;
    if (['swiftShip','indomShip','miraShip'].includes(record.bondId) && param.index === 0) value = Math.max(0, Math.min(1,value));
    if (record.bondId === 'arcaneShip' && param.base === 'magic_res_max_base' && Number.isFinite(record.bb.magic_res_max_min)) {
      value = Math.max(record.bb.magic_res_max_min, value);
    }
    values[param.index] = { value, percent: param.format.includes('%'), formula: `${base} + ${per} × ${layers}` };
  }
  const rows = (record.effectDesc || record.desc).split('\n').map(text => {
    const people = text.match(/<在场(\d+)名/);
    const stacks = text.match(/<达到(\d+)层>/);
    const unmet = people && count < Number(people[1]) ? `未达 ${people[1]} 人档` : stacks && layers < Number(stacks[1]) ? `未达 ${stacks[1]} 层` : null;
    return { text, unmet };
  });
  return { values, rows, layers, count, trialCoverage: record.bondId === 'arcaneShip' ? arcaneCoverage({ bonds: { arcaneShip: record } }, selection) : null };
}
