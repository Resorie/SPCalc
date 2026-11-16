import { targetGeometry } from './stronghold-target-geometry.js';
export const TEAM_RECT = { r0: 0, r1: 5, c0: 0, c1: 20 };
export const DIRS = ['RIGHT','UP','LEFT','DOWN'];
export function teamBoard(data, stageId, scene = {}, runtime) {
  const { Grid, normalizeStage } = runtime;
  const raw = data.stages?.[stageId];
  if (!raw?.active) throw new Error('地图不存在或不属于当前启用地图。');
  const stage = normalizeStage(stageId,raw), grid = new Grid(stage,TEAM_RECT);
  const displayGrid=new Grid(stage,{r0:0,r1:6,c0:0,c1:20});
  const displayDevices=stage.devices.filter(d=>(typeof d.raw?.active==='boolean'?d.raw.active:!d.hidden&&d.active!==false)&&d.row>=0&&d.row<=6);
  const target=targetGeometry(scene);
  // Preserve every source tile, including flank cliffs, terrain and passability.
  // Only the Boss body's deploy mask changes; the hit rectangle never repaints terrain.
  if(target.boss){
    stage.rows=stage.rows.slice();stage.legend={...stage.legend};
    for(const k of target.blocked){const r=Math.floor(k/21),c=k%21;if(!stage.rows[r]||c<0||c>=21)continue;
      const glyph=String.fromCharCode(0xe000+k),original=stage.rows[r][c];
      stage.legend[glyph]={...stage.legend[original],buildable:'NONE'};
      stage.rows[r]=stage.rows[r].slice(0,c)+glyph+stage.rows[r].slice(c+1);
    }
    const effective=new Grid(stage,TEAM_RECT);grid.tiles=effective.tiles;grid.unblockable=effective.unblockable;grid.deepWater=effective.deepWater;
  }
  const devices = stage.devices.filter(d => (typeof d.raw?.active==='boolean'?d.raw.active:!d.hidden&&d.active!==false) && grid.inRect(d.row,d.col));
  for (const d of devices) if (['platform','mound','crate'].includes(d.role)) grid.setObstacle(d.row,d.col,true,d.role==='crate'?'crate':'block');
  const board = (r,c) => Number.isInteger(r)&&Number.isInteger(c)&&r>=2&&r<=5&&((c>=2&&c<=10)||target.flank(r,c));
  const canPlace = (rec,r,c) => board(r,c) && !target.blocks(r,c) && grid.canStand(r,c,{ranged:rec.position==='RANGED'}) && !devices.some(d=>d.row===r&&d.col===c&&d.role==='crate');
  const canTarget = (r,c,motion='WALK') => Number.isInteger(r)&&Number.isInteger(c)&&r>=2&&r<=5&&c>=2&&c<=18 && (motion==='FLY'?grid.flyPassable(r,c):grid.groundPassable(r,c));
  return {sourceStage:raw,stage,grid,displayGrid,devices,displayDevices,board,canPlace,canTarget,target};
}
export function ownBonds(data,rec,items,runtime) {
  return [...new Set([...(rec.bonds||[]),...runtime.grantedBondsByMorph(items,id=>data.items[id],{bondOk:id=>!!data.bonds[id]})])];
}
export function teamBonds(data,catalog,team,runtime) {
  const sets = Object.fromEntries(Object.keys(data.bonds).map(id=>[id,new Set()]));
  const supportVariants = new Set();
  const regulation = data.config.version?.family === 'regulation';
  let elite=0;
  for(const member of team.members) {
    const rec=catalog.resolve(member.config), identity=rec.charId||rec.baseId;
    if(rec.isGolden)elite++;
    for(const id of ownBonds(data,rec,member.config.items,runtime)) {
      sets[id]?.add(identity);
      if (id === 'deputShip') supportVariants.add(`${identity}|${Boolean(rec.isGolden)}`);
    }
  }
  const harmony=sets.maniShip?.size?1:0;
  return Object.fromEntries(Object.entries(data.bonds).map(([id,rec])=>{
    const actualCount = id==='suntShip'?elite:sets[id].size+(rec.isCore&&(!regulation||sets[id].size)?harmony:0);
    const chosen=team.bonds?.find(x=>x.id===id);
    const count=chosen?.count==null?actualCount:Number(chosen.count);
    let tier=rec.thresholdTemplate==='count_threshold_downward' || (rec.noStack && id==='soloShip')
      ? (count>=1&&count<=(rec.maxCount??rec.thresholds[0])?1:0)
      : rec.thresholds.filter(n=>n<=count).length;
    if (regulation && id==='deputShip' && tier>0 && chosen?.count==null) {
      tier=1+rec.thresholds.slice(1).filter(n=>n<=supportVariants.size).length;
    }
    return [id,{id,actualCount,count,overridden:chosen?.count!=null,layers:Number(chosen?.layers??0),tier,active:tier>0}];
  }));
}
export function deploymentErrors(data,catalog,team,scene,target,runtime) {
  const b=teamBoard(data,scene.stageId,scene,runtime), errors=[], seen=new Set();
  for(const m of team.members) {
    const rec=catalog.resolve(m.config),key=`${m.row},${m.col}`;
    if(!b.canPlace(rec,m.row,m.col))errors.push(`${rec.name} #${m.uid} 的位置不合法`);
    if(seen.has(key))errors.push(`位置 ${key} 重复部署`);seen.add(key);
    if(!DIRS.includes(m.dir))errors.push(`${rec.name} 的朝向无效`);
  }
  if(!['point','boss'].includes(scene.targetShape??'point'))errors.push('靶子形状无效');
  if(b.target.boss&&(!Number.isInteger(scene.targetRow)||!Number.isInteger(scene.targetCol)||scene.targetRow<2||scene.targetRow+2>5||scene.targetCol-2<2||scene.targetCol+2>18))errors.push('Boss 的 5×3 受击框必须完整位于战斗区域');
  if(!b.canTarget(scene.targetRow,scene.targetCol,target.motion))errors.push('靶子必须位于地图内可通行的合法格子');
  if(!b.target.boss&&seen.has(`${scene.targetRow},${scene.targetCol}`))errors.push('初始靶子不能与队员占据同一格');
  return errors;
}
export function initialRange(rec,member,runtime) {
  return runtime.absoluteRangeKeys(runtime.attackRangeGrid(rec)||[],member.row,member.col,member.dir);
}
