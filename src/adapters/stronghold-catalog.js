import { describeBond } from './stronghold-bond-preview.js';

export function createCatalog(data, runtime, diyExcludedNames = {}) {
  const { diyPool, diyRecord, diySlotIds, diySlot, isDiyModule, lockedSelection, validateDiyPicks, unitForm, KITTED_CHARS, resolveRecordLoadout, loadoutRecord } = runtime;
  function isCombatItem(id) {
    const item = data.items[id];
    if (!item || item.itemType !== 'EQUIP' || item.kind?.startsWith('consume_')) return false;
    if (!item.isGolden) return true;
    const base = data.items[item.baseId];
    return !!(base?.mergeable && base.upgradeChessId === id);
  }
  const equipment = Object.values(data.items).filter(i => isCombatItem(i.id))
    .sort((a,b) => a.tier - b.tier || a.name.localeCompare(b.name, 'zh-CN') || Number(a.isGolden) - Number(b.isGolden));
  function picks(tier) {
    return diyPool(Number(tier), { data, kitted: KITTED_CHARS }).map(id => data.backups.units[id])
      .sort((a,b) => a.name.localeCompare(b.name, 'zh-CN'));
  }
  const unavailablePicks = (data.backups.diy?.excluded || [])
    .filter(id => Object.hasOwn(diyExcludedNames, id))
    .map(id => ({ charId: id, name: diyExcludedNames[id] }));
  function slotId(tier, elite) {
    const id = diySlotIds(data).find(id => data.chess[id].tier === Number(tier));
    return elite ? data.chess[id]?.goldenId : id;
  }
  function defaultDiy(tier, elite, preferred) {
    const charId = picks(tier).some(u => u.charId === preferred) ? preferred : picks(tier)[0]?.charId;
    const id = slotId(tier, elite), slot = diySlot(id, data);
    const lock = lockedSelection(data, Number(tier), charId);
    const form = unitForm(data.backups, charId, slot.normal.status);
    return { chessId: id, diy: { charId, uniEquipId: lock?.uniEquipId ?? null },
      skillIndex: lock?.skillIndex ?? form.skills[0].index };
  }
  function presetModules(slot) {
    const elite = slot?.isGolden ? slot : data.chess[slot?.goldenId];
    return elite?.modules || [];
  }
  function resolve(config) {
    const slot = data.chess[config.chessId];
    if (!slot) throw new Error('干员不存在。');
    if (!slot.isDiy) {
      if (config.diy) throw new Error('预置干员不能使用自选编队参数。');
      const moduleId = config.moduleId;
      if (moduleId != null && moduleId !== 'none' && !presetModules(slot).some(m => m.uniEquipId === moduleId)) {
        throw new Error(`${slot.name} 无法携带所选模组。`);
      }
      const loadout = resolveRecordLoadout(slot, {
        skillIndex: Number(config.skillIndex ?? slot.skill?.index),
        moduleId: slot.isGolden ? moduleId : undefined,
        potential: Number(config.potential),
      });
      return loadoutRecord(slot, loadout);
    }
    if (config.moduleId != null) throw new Error('自选干员请使用其自选模组设置。');
    const unavailable = unavailablePicks.find(op => op.charId === config.diy?.charId);
    if (unavailable) throw new Error(`${unavailable.name} 暂无战斗实现，无法在当前规则包模拟。`);
    const pick = { ...config.diy, skillIndex: Number(config.skillIndex) };
    const check = validateDiyPicks({ [slot.baseId]: pick }, { data, kitted: KITTED_CHARS });
    if (!check.ok) throw new Error(`自选配置无效：${check.detail}`);
    const rec = diyRecord(config.chessId, pick, { data, potential: Number(config.potential) });
    if (!rec) throw new Error('当前版本缺少此自选干员的数据。');
    return rec;
  }
  function modules(config) {
    if (!config.diy) return presetModules(data.chess[config.chessId]);
    const slot = diySlot(config.chessId, data);
    if (!slot) return [];
    return (unitForm(data.backups, config.diy.charId, slot.golden.status)?.modules || []).filter(isDiyModule);
  }
  function lock(config) {
    return config.diy ? lockedSelection(data, data.chess[config.chessId].tier, config.diy.charId) : null;
  }
  return { describeBond: selection => describeBond(data.bonds[selection.id], selection), equipment, isCombatItem, picks, unavailablePicks, defaultDiy, resolve, modules, lock, slotId,
    presets: Object.values(data.chess).filter(c => !c.isGolden && !c.isDiy && c.visible !== false)
      .sort((a,b) => b.tier-a.tier || a.shopSortId-b.shopSortId) };
}
