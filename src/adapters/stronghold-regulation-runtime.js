export { Battle } from '../../vendor/stronghold-regulation/server/sim/Battle.js';
export { setSimData, normalizeStage } from '../../vendor/stronghold-regulation/server/sim/simdata.js';
export { isMember, setGameData } from '../../vendor/stronghold-regulation/server/sim/content/support/index.js';
export { setData } from '../../vendor/stronghold-regulation/server/data.js';
export { KITS, MODULES } from '../../vendor/stronghold-regulation/server/sim/content/index.js';
export { KITTED_CHARS } from '../../vendor/stronghold-regulation/server/sim/content/kits/index.js';
export { diyPool, diyRecord, diySlotIds, diySlot, isDiyModule, lockedSelection, validateDiyPicks } from '../../vendor/stronghold-regulation/shared/diy.js';
export { unitForm } from '../../vendor/stronghold-regulation/shared/standIn.js';
export { Grid } from '../../vendor/stronghold-regulation/server/sim/grid.js';
export { absoluteRangeKeys } from '../../vendor/stronghold-regulation/server/sim/targeting.js';
export { grantedBondsByMorph } from '../../vendor/stronghold-regulation/shared/plugins/rules.js';
export { resolveRecordLoadout, loadoutRecord, attackRangeGrid } from '../../vendor/stronghold-regulation/shared/loadoutRecord.js';
export { IGNITE_RECOVERY_CAP } from '../../vendor/stronghold-regulation/server/sim/content/kits/ops/op-amgoat.js';

import { yatoKit } from './operators/yato.js';
import { orchidKit } from './operators/orchid.js';
export const supplementalDiyKits = Object.freeze({
  char_1029_yato2: yatoKit,
  char_1048_orchd2: orchidKit,
});
