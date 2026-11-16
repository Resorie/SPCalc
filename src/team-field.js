import {targetGeometry} from './adapters/stronghold-target-geometry.js';
import {escape} from './operator-editor.js';
import {fitCamera} from './upstream-render/projection.js';
// Upstream's front-facing camera and bottom-first row coordinates; no invented yaw/shear.
const camera=fitCamera({r0:0,r1:6,c0:0,c1:20},{width:1040,height:430,padding:{top:30,bottom:24,left:18,right:18}},{tilt:30,dist:32,headroom:.6,margin:.2});
export const projectCell=(r,c,z=0)=>camera.project(c,r,z);
const point=p=>`${p.x},${p.y}`;
const quad=(r,c,z=0)=>[[r-.5,c-.5],[r-.5,c+.5],[r+.5,c+.5],[r+.5,c-.5]].map(([r,c])=>projectCell(r,c,z));
const poly=(points,cls)=>`<polygon points="${points.map(point).join(' ')}" class="${cls}"/>`;
const names={tile_road:'地面',tile_floor:'不可部署地板',tile_wall:'高台',tile_fence_bound:'围栏地块',tile_forbidden:'禁部署块',tile_achand:'整备区',tile_end:'蓝门',tile_start:'红门',tile_telin:'传送入口',tile_telout:'传送出口',tile_mire:'沼泽',tile_smog:'排气格栅',tile_deepsea:'深水区',tile_infection:'活性源石',tile_duel_grassland:'隐匿地块',tile_ice:'冰面',tile_volcano:'喷气孔'};
function elevation(t,r){if(t.key==='tile_wall')return .42;if(t.key==='tile_forbidden')return r===6?.55:.3;if(t.key==='tile_achand')return .16;return 0;}
let renderer;
export async function initializeTeamField(host,onStatus,boardSet){const {createMapRenderer}=await import('./team-map-renderer.js');renderer=await createMapRenderer(host,camera,onStatus,boardSet);window.addEventListener('pagehide',event=>{if(!event.persisted)renderer?.destroy();});}
export function updateTeamField(host,args){renderer.setStage(args.board.sourceStage);renderer.overlay(renderTeamField({...args,heightAt:(r,c)=>renderer.field.heightAt(r,c)}));const m=args.pending||args.team.members.find(x=>x.uid===args.selected)||args.team.members[0],rec=args.catalog.resolve(m.config),legal=[];for(let r=2;r<=5;r++)for(let c=0;c<=20;c++)if(args.mode==='target'?args.board.canTarget(r,c):args.board.canPlace(rec,r,c)&&!args.team.members.some(u=>u.uid!==m.uid&&u.row===r&&u.col===c))legal.push(r*21+c);const g=targetGeometry(args.scene);renderer.highlight({legal,range:args.initialRange(rec,m),boss:g.keys,body:g.blocked});}
export function previewTeamRange(keys){renderer?.range(keys);}
export function renderTeamField({board,team,selected,pending,scene,catalog,icons,mode,heightAt}){
  const current=pending||team.members.find(x=>x.uid===selected)||team.members[0],rec=catalog.resolve(current.config),geometry=targetGeometry(scene);
  const grid=board.displayGrid||board.grid,layers=[];
  for(let r=6;r>=0;r--)for(let c=0;c<=20;c++){
    const t=grid.tile(r,c),blocked=geometry.blocks(r,c),flank=geometry.flank(r,c),hit=geometry.contains(r,c),z=elevation(t,r),p=projectCell(r,c,z);
    const occupied=team.members.some(m=>m.uid!==current.uid&&m.row===r&&m.col===c);
    const legal=mode==='target'?r>=2&&r<=5&&board.canTarget(r,c):!occupied&&board.canPlace(rec,r,c);
    const name=names[t.key]||t.key,label=`第 ${r} 行第 ${c} 列 · ${name}${blocked?' · Boss占地不可部署':flank?' · Boss受击侧缘':''}`;
    layers.push({depth:camera.depthOf(c,r+.5,z),html:`<g class="field-tile ${legal?'legal':''}" data-cell="${r},${c}" data-tile-key="${t.key}" role="button" tabindex="-1" aria-label="${escape(label)}"><title>${escape(label)}</title>${poly(quad(r,c,heightAt?heightAt(r,c):z),'tile-hit')}<text x="${p.x}" y="${p.y+10}" class="field-coordinate">${r},${c}</text></g>`});
  }
  if(geometry.boss){const r=scene.targetRow,c=scene.targetCol;
    const rect=(half)=>[projectCell(r-.5,c-half),projectCell(r-.5,c+half),projectCell(r+2.5,c+half),projectCell(r+2.5,c-half)];
    const center=projectCell(r+1,c);
    layers.push({depth:-1,html:`<g class="boss-display" pointer-events="none">${poly(rect(2.5),'boss-outline')}${poly(rect(1.5),'boss-occupancy')}<circle cx="${center.x}" cy="${center.y-7}" r="18" class="boss-reticle"/><path d="M${center.x-26},${center.y-7}h13m26,0h13M${center.x},${center.y-33}v13m0,26v13" class="boss-emblem"/><text x="${center.x}" y="${center.y+27}" class="boss-label">BOSS</text></g>`});
  }else{const p=projectCell(scene.targetRow,scene.targetCol);layers.push({depth:-1,html:`<g pointer-events="none"><ellipse cx="${p.x}" cy="${p.y}" rx="18" ry="12" class="point-target"/></g>`});}
  for(const m of team.members){const record=catalog.resolve(m.config),t=grid.tile(m.row,m.col),z=heightAt?heightAt(m.row,m.col):elevation(t,m.row),p=projectCell(m.row,m.col,z),valid=board.canPlace(record,m.row,m.col),img=icons.operators?.[record.charId],angle={RIGHT:0,DOWN:90,LEFT:180,UP:270}[m.dir];
    layers.push({depth:camera.depthOf(m.col,m.row,z),html:`<g class="field-unit ${m.uid===selected&&!pending?'chosen':''} ${valid?'':'invalid'}" data-unit="${m.uid}" data-cell="${m.row},${m.col}" role="button" tabindex="0" aria-label="${escape(record.name)} #${m.uid} 棋子"><title>${escape(record.name)} #${m.uid} · 拖动移动，点击选朝向</title><ellipse cx="${p.x}" cy="${p.y+2}" rx="20" ry="10" class="unit-shadow"/><ellipse cx="${p.x}" cy="${p.y+2}" rx="19" ry="8" class="unit-base"/><g transform="translate(${p.x},${p.y+2}) rotate(${angle})"><path d="M24,0l-8,-5v10z" class="unit-facing"/></g><rect x="${p.x-16}" y="${p.y-39}" width="32" height="37" class="unit-card"/>${img?`<image href="./assets/icons/${escape(img)}" x="${p.x-14}" y="${p.y-37}" width="28" height="32" preserveAspectRatio="xMidYMid slice" draggable="false"/>`:''}<text x="${p.x}" y="${p.y-5}" class="unit-number">${m.uid}</text></g>`});
  }
  return `<svg viewBox="0 0 1040 430" class="field-svg" role="group" aria-label="战场布阵" xmlns="http://www.w3.org/2000/svg">${layers.sort((a,b)=>b.depth-a.depth).map(l=>l.html).join('')}</svg>`;
}
