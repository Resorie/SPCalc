import {rulesKey} from './rulesets.js';
import {defaultTrialTarget,restoreTrialTarget} from './trial-targets.js';
export function teamFromSingle(config,uid=1,board,rec){
  const member={uid,row:4,col:7,dir:'RIGHT',config:{...structuredClone(config),bonds:[]}};
  if(!board||board.canPlace(rec,member.row,member.col))return member;
  for(const row of [4,3,5,2])for(let col=10;col>=2;col--){
    if(board.canPlace(rec,row,col))return {...member,row,col};
  }
  return member;
}
export function defaultTeamState(manifest){
  if(!manifest.defaults.team || !manifest.defaults.teamScene)throw new Error('当前规则包未声明默认队伍和地图。');
  return {schema:3,mode:'team',version:manifest.id,rules:rulesKey(manifest),target:{...defaultTrialTarget(manifest),duration:120},scene:structuredClone(manifest.defaults.teamScene),configs:[structuredClone(manifest.defaults.team)]};
}
export function restoreTeamState(parsed,manifest){
  if(parsed?.schema!==3||parsed.mode!=='team'||parsed.rules!==rulesKey(manifest)||parsed.version!==manifest.id)throw new Error('团队配置的规则版本不匹配。');
  if(!Array.isArray(parsed.configs)||parsed.configs.length<1||parsed.configs.length>5||!parsed.target||!parsed.scene||parsed.configs.some(t=>!Array.isArray(t.members)||t.members.length<1||t.members.length>9||!Array.isArray(t.bonds)||t.members.some(m=>!m.config||!Array.isArray(m.config.items))))throw new Error('团队配置格式无效。');
  const restored=structuredClone(parsed);
  restored.target=restoreTrialTarget(restored.target,manifest);
  if(!restored.scene.targetShape){restored.scene={...restored.scene,targetShape:'boss',targetRow:3,targetCol:10};restored.geometryMigrated=true;}
  return restored;
}
