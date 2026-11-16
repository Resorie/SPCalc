import {TileField} from './upstream-render/tiles.js';
import {BoardScene} from './upstream-render/board3d/scene.js';
import {loadBoardPack,loadScenePack,webgl2Available} from './upstream-render/board3d/load.js';
import {AREAS} from './upstream-render/board3d/layout.js';
const resources=new Map();
async function assets(set){
  if(!resources.has(set))resources.set(set,(async()=>{
    const root=new URL(`../assets/board/${set}/`,import.meta.url),response=await fetch(new URL('manifest.json',root));if(!response.ok)throw new Error('地图资源清单无法载入');
    const manifest=await response.json(),images=new Map();
    return {local:async()=>manifest,localUrl:(group,name)=>{const p=manifest.groups[group]?.[name]?.path;return p?new URL(p.replace(/^\/assets\/local\//,''),root).href:null;},image:url=>{if(!images.has(url))images.set(url,new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>{images.delete(url);reject(new Error('地图图片载入失败'));};img.src=url;}));return images.get(url);}};
  })());return resources.get(set);
}
export async function createMapRenderer(host,camera,onStatus,boardSet){
  const P=globalThis.PIXI;if(!P)throw new Error('地图渲染库无法载入，请刷新页面');
  const app=new P.Application({width:1040,height:430,backgroundAlpha:0,antialias:true,autoStart:false,resolution:Math.min(devicePixelRatio||1,2),preserveDrawingBuffer:true});
  const layers=Object.fromEntries(['ground','anim','props','overlay'].map(k=>[k,new P.Container()]));layers.props.sortableChildren=true;
  app.stage.addChild(layers.ground,layers.anim,layers.props,layers.overlay);
  host.innerHTML='<canvas class="map-scene-canvas" aria-hidden="true"></canvas><div class="map-pixi-layer" aria-hidden="true"></div><div class="map-hit-layer"></div>';
  host.querySelector('.map-pixi-layer').append(app.view);
  const field=new TileField(layers),focus={r0:2,r1:5,c0:2,c1:18};field.setView([0,6],focus,[0,6]);
  const art=await assets('upstream'),pack=await loadBoardPack(art);if(pack)field.setArt(pack);
  let scene=null,stageId=null,serial=0,frame=null,alive=true,visible=true,last=0,elapsed=0;
  try{if(pack&&new URLSearchParams(location.search).get('map')!=='2d'&&webgl2Available(true)){const T=await import('../vendor/three/three.module.js');scene=new BoardScene(T,pack,{canvas:host.querySelector('.map-scene-canvas'),shadows:false,preserveDrawingBuffer:true});scene.setArea(AREAS.boss);scene.setFocus(focus);scene.resize(1040,430,Math.min(devicePixelRatio||1,2));field.setExternal(true);}}catch(error){console.warn('3D 地图不可用，使用复刻版棋盘渲染',error);}
  if(!scene)host.querySelector('.map-scene-canvas').hidden=true;
  const observer=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting??true;});observer.observe(host);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const draw=now=>{if(!alive)return;frame=requestAnimationFrame(draw);if(document.hidden||!visible)return;if(now-last<1000/30)return;const dt=last?Math.min((now-last)/1000,.1):0;last=now;if(!reduced.matches)elapsed+=dt;field.project(camera);field.update(reduced.matches?0:dt);scene?.render(camera,elapsed);app.render();};frame=requestAnimationFrame(draw);
  const tileList=keys=>keys.map(k=>[Math.floor(k/21),k%21]);
  return {field,
    setStage(raw){if(stageId===raw.id)return;stageId=raw.id;const at=++serial;field.setStage(raw);field.project(camera,true);scene?.setScenePack(raw.id,null);scene?.setStage(raw);onStatus(scene?'正在载入复刻版场景…':'复刻版棋盘渲染');
      if(scene)(boardSet?assets(boardSet):Promise.resolve(art)).then(sceneArt=>loadScenePack(sceneArt,raw.id)).then(pack=>{if(!alive||serial!==at)return;if(pack){scene.setScenePack(raw.id,pack);onStatus('复刻版 3D 场景');}else onStatus('复刻版 3D 棋盘（场景未载入）');}).catch(()=>{if(serial===at)onStatus('复刻版 3D 棋盘（场景载入失败）');});
    },
    highlight({legal,range,boss,body}){field.setHighlights(tileList(legal),'legal','legal');field.setHighlights(tileList(boss),{color:0xe57e58,fill:.04,line:.6},'boss');field.setHighlights(tileList(body),{color:0xc34a43,fill:.06,line:.7},'body');field.setHighlights(tileList(range),'range','range',{stripes:true});},
    range(keys){field.setHighlights(tileList(keys),'range','range',{stripes:true});},
    overlay(html){host.querySelector('.map-hit-layer').innerHTML=html;},
    destroy(){alive=false;serial++;cancelAnimationFrame(frame);observer.disconnect();field.destroy();scene?.destroy();app.destroy(true,{children:true,texture:false,baseTexture:false});},
  };
}
