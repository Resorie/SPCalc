import { targetGeometry } from './adapters/stronghold-target-geometry.js';
import { initializeTeamField,updateTeamField,previewTeamRange } from './team-field.js';
import {loadRuleset,loadIcons} from './rulesets.js';
import {createCalculator} from './engine.js';
import {defaultTeamState,restoreTeamState,teamFromSingle} from './team-state.js';
import {restoreState} from './config-state.js';
import {createOperatorEditor,escape,number,numeric,select} from './operator-editor.js';
import {createCalculationRunner} from './calculation-runner.js';
const $=s=>document.querySelector(s),letters='ABCDE',colors=['#2873a8','#cb7134','#218273','#9460b5','#be425c'];
const runner=createCalculationRunner();
let storageKey;
const notice=(text,error=false)=>{$('#notice').textContent=text;$('#notice').classList.toggle('error',error);};
function decode(hash){return JSON.parse(decodeURIComponent(atob(hash.replace(/-/g,'+').replace(/_/g,'/'))));}
function encode(value){return btoa(encodeURIComponent(JSON.stringify(value))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
let pack,engine,state,editor,active=0,selected=1,mode='unit',results=null,resultInput=null,resultPlan=0,busy=false,revision=0,pending=null,iconIndex={},undoStack=[];
const team=()=>state.configs[active],member=()=>pending||team().members.find(m=>m.uid===selected)||team().members[0];
try{
  const params=new URLSearchParams(location.hash.slice(1));let parsed=null,single=null,warning='';
  try{if(params.has('config'))parsed=decode(params.get('config'));
    else if(params.has('from'))single=decode(params.get('from'));}catch{warning='分享的团队配置无法读取，已载入默认队伍。';}
  pack=await loadRuleset({versionId:parsed?.version,mode:'team',fromSingle:single?.version});
  engine=await createCalculator(pack);
  storageKey='stronghold-calculator-team-v1:'+pack.manifest.id;
  if(!parsed&&!single&&!warning){try{const saved=localStorage.getItem(storageKey);if(saved)parsed=JSON.parse(saved);}catch{warning='保存的团队配置无法读取，已载入默认队伍。';}}
  if(!engine.teamMaps.length)throw new Error('该版本没有团队地图，请返回单人靶场或清除团队配置。');
  state=parsed?restoreTeamState(parsed,pack.manifest):defaultTeamState(pack.manifest);
  if(state.geometryMigrated){warning='旧单格靶已升级为 5×3 Boss 靶，队员站位保留；请检查中央 3×3 禁部署区。';delete state.geometryMigrated;}
  if(state.scene.targetShape==='boss'&&state.scene.targetRow===2&&state.scene.targetCol===10&&!warning)warning='旧版 Boss 默认位置偏低一行，可点「Boss 归位」修正；队员位置会保留。';
  if(single){
    const source=await loadRuleset({versionId:single.version});restoreState(single,source.manifest);
    if(source.manifest.engine.id!==pack.manifest.engine.id||Object.entries(source.manifest.files).some(([id,file])=>pack.manifest.files[id]?.sha256!==file.sha256))throw new Error('单人配置与团队规则的数据不一致，不能自动复制。');
    state.target={...state.target,...single.target};const board=engine.teamBoard(state.scene.stageId,state.scene);
    state.configs=single.configs.map(c=>({name:'单人方案转入',members:[teamFromSingle(c,1,board,engine.catalog.resolve(c))],bonds:structuredClone(c.bonds),assumptions:{arcane:false,raid:false}}));warning='已将每个单人方案复制为一支单人队伍；盟约人数保留为手动覆盖，请补充队友并调整布阵。';
  }
  try{iconIndex=await loadIcons(pack.manifest);}catch{warning+=' 图标未载入，仍可通过名称选择。';}
  editor=createOperatorEditor({root:$('#operator-editor'),data:pack.data,catalog:engine.catalog,icons:iconIndex,ownBonds:engine.ownBonds,defaultConfig:pack.manifest.defaults.config,onChange:()=>{if(!pending)changed();renderRoster();renderBoard();renderBonds();}});
  $('#version').textContent=pack.manifest.label;
  const ref=pack.manifest.defaults.targetReference;
  if(ref)$('#target-reference').innerHTML=`默认参考：<a href="${escape(ref.source)}" target="_blank" rel="noreferrer">${escape(ref.label)} ↗</a>`;
  $('#assume-arcane').closest('label').hidden=!engine.supportsArcaneCoverage;
  await initializeTeamField($('#battlefield'),text=>$('#map-render-state').textContent=text,pack.manifest.boardSet);
  setup();renderAll();$('#run').disabled=false;$('#field-run').disabled=false;notice(warning||'同场计算治疗与队友联动，默认按实际布阵触发盟约。');
}catch(error){notice(error.message,true);const reset=document.createElement('button');reset.textContent='载入当前团队版本';reset.className='button secondary';reset.onclick=()=>{localStorage.removeItem(storageKey);location.hash='';location.reload();};$('#notice').append(' ',reset);}
function changed(){revision++;try{localStorage.setItem(storageKey,JSON.stringify(state));}catch{}if(results){$('#results').classList.add('stale');$('#result-state').textContent='配置已修改，请重新计算';}}
function renderAll(){selected=member().uid;renderTarget();renderTabs();renderRoster();renderPlacement();editor.render(member().config);renderBonds();renderBoard();$('#assume-arcane').checked=!!team().assumptions?.arcane;$('#assume-raid').checked=!!team().assumptions?.raid;}
function renderTarget(){const t=state.target;$('#target-fields').innerHTML=numeric('防御力','def',t.def,0,10000)+numeric('法术抗性','res',t.res,0,100)+numeric('时长 / 秒','duration',t.duration,1,300)+numeric('目标数量','count',t.count,1,8)+numeric('重量','weight',t.weight,0,10)+select('敌人分类','rank',[['BOSS','领袖'],['NORMAL','普通敌人']],t.rank)+select('目标类型','motion',[['WALK','地面'],['FLY','空中']],t.motion)+numeric('随机种子','seed',t.seed,1,4294967295)+select('靶子形状','targetShape',[['boss','Boss · 5×3 受击框'],['point','单格实验靶']],state.scene.targetShape??'boss');}
function renderTabs(){const html=state.configs.map((t,i)=>`<button role="tab" aria-selected="${active===i}" data-team="${i}">方案 ${letters[i]}</button>`).join('')+`<button data-team-action="add" class="copy-button" aria-label="复制为新队伍方案" ${state.configs.length>=5?'disabled':''}>＋</button><button data-team-action="remove" class="copy-button" ${state.configs.length<=1?'disabled':''}>删除</button>`;document.querySelectorAll('[data-team-tabs]').forEach(el=>el.innerHTML=html);}
function renderRoster(){
  $('#roster-count').textContent=`${team().members.length} / 9`;
  $('#add-member').disabled=team().members.length>=9;$('#remove-member').disabled=!pending&&team().members.length<=1;
  $('#selection-name').textContent=pending?'待部署 · '+engine.catalog.resolve(pending.config).name:engine.catalog.resolve(member().config).name+' #'+member().uid;
  $('#undo-layout').disabled=!undoStack.length;
  $('#roster').innerHTML=team().members.map(m=>{const rec=engine.catalog.resolve(m.config);return `<button class="roster-member" data-member="${m.uid}" data-drag-unit="${m.uid}" aria-pressed="${member().uid===m.uid}">${editor.iconMarkup('operators',rec.charId,rec.name)}<span>${escape(rec.name)}<small>#${m.uid} · ${m.row},${m.col}</small></span></button>`;}).join('');
}
function renderPlacement(){const m=member();$('#placement').innerHTML=numeric('所在行','row',m.row,2,5)+numeric('所在列','col',m.col,2,18)+select('朝向','dir',[['RIGHT','→ 右'],['UP','↑ 上'],['LEFT','← 左'],['DOWN','↓ 下']],m.dir);}
function renderBoard(){
  const board=engine.teamBoard(state.scene.stageId,state.scene);
  $('#map-select').innerHTML=select('原版地图','stageId',engine.teamMaps.map(s=>[s.id,s.name]),state.scene.stageId);
  $('#target-position').textContent=state.scene.targetShape==='boss'?'Boss 受击 5×3 / 占地 3×3 · 底行 '+state.scene.targetRow:`单格靶 ${state.scene.targetRow},${state.scene.targetCol}`;
  $('#place-unit').setAttribute('aria-pressed',mode==='unit');$('#place-target').setAttribute('aria-pressed',mode==='target');
  $('#placement-error').textContent=engine.deploymentErrors(team(),state.scene,state.target).join('；');
  updateTeamField($('#battlefield'),{board,team:team(),selected,pending,scene:state.scene,catalog:engine.catalog,icons:iconIndex,initialRange:engine.initialRange,mode});
  $('#addmember-picker').innerHTML=editor.imageSelect('添加干员','addOperator',[['','选择干员…'],...engine.catalog.presets.map(c=>[c.chessId,c.name])],'');
}
function remember(){undoStack.push(structuredClone(state));if(undoStack.length>30)undoStack.shift();}
function undoLayout(){if(!undoStack.length)return;state=undoStack.pop();pending=null;active=Math.min(active,state.configs.length-1);selected=team().members[0].uid;changed();renderAll();hideDirection();notice('已撤销上一次布阵操作。');}
function hideDirection(){$('#direction-menu').hidden=true;}
function chooseDirection(dir){if(pending){pending.dir=dir;renderBoard();return;}if(member().dir!==dir){remember();member().dir=dir;changed();}renderRoster();renderPlacement();renderBoard();hideDirection();}
function showDirection(x,y){const box=$('#direction-menu');box.hidden=false;box.style.left=Math.max(8,Math.min(innerWidth-160,x-75))+'px';box.style.top=Math.max(8,Math.min(innerHeight-180,y-80))+'px';$('#direction-name').textContent=engine.catalog.resolve(member().config).name;}
function placeAt(row,col,x,y){
  const board=engine.teamBoard(state.scene.stageId,state.scene),m=member();
  if(team().members.some(u=>u.uid!==m.uid&&u.row===row&&u.col===col)||!board.canPlace(engine.catalog.resolve(m.config),row,col)||(!board.target.boss&&board.target.contains(row,col))){notice('这里无法部署；请选择绿色空格，Boss 中央占地不能放人。',true);return false;}
  remember();if(pending){pending.row=row;pending.col=col;team().members.push(pending);selected=pending.uid;pending=null;}else{m.row=row;m.col=col;}
  changed();renderAll();showDirection(x,y);notice('部署位置已更新，请选择朝向；R 可直接旋转。');return true;
}
function moveTarget(row,col){
  const proposed={...state.scene,targetRow:state.scene.targetShape==='boss'?row-1:row,targetCol:col};const shape=targetGeometry(proposed);
  if(shape.boss&&(proposed.targetRow<2||proposed.targetRow+2>5||col-2<2||col+2>18)){notice('Boss 的 5×3 受击框需要完整放在战场内。',true);return;}
  if(team().members.some(m=>shape.boss?shape.blocks(m.row,m.col):shape.contains(m.row,m.col))){notice('新的 Boss 占地与队员重叠，请先挪开队员。',true);return;}
  const b=engine.teamBoard(proposed.stageId,proposed);if(!b.canTarget(proposed.targetRow,col,state.target.motion)){notice('这里不能放置靶子。',true);return;}
  remember();state.scene=proposed;changed();renderBoard();
}

function bondInfo(b){const info=engine.catalog.describeBond({id:b.id,count:b.count,layers:b.layers});if(!info)return '层数无效';return info.rows.map(row=>row.text.replace(/\{(\d+):[^}]+\}/g,(_,id)=>{const v=info.values[id];return v?`${number(v.value*(v.percent?100:1),2)}${v.percent?'%':''}`:'?';})).join('\n');}
function renderBonds(){
  const all=engine.teamBonds(team()),visible=Object.values(all).filter(b=>b.actualCount||team().bonds.some(x=>x.id===b.id));
  $('#team-bonds').innerHTML=visible.map(b=>`<details class="team-bond" ${b.active?'open':''}><summary>${editor.iconMarkup('bonds',b.id,pack.data.bonds[b.id].name)}<b>${escape(pack.data.bonds[b.id].name)}</b><span>实际 ${b.actualCount} · ${b.overridden?'覆盖':'自动'} ${b.count} 人 · ${b.active?'已激活':'未激活'}</span></summary><div class="field-row">${numeric('起始层数',`layers-${b.id}`,b.layers,0,999,`data-bond="${b.id}" data-key="layers"`)}<label class="field"><span>覆盖人数（留空自动）</span><input type="number" name="count-${b.id}" min="0" max="20" step="1" aria-label="${escape(pack.data.bonds[b.id].name)}覆盖人数" value="${b.overridden?b.count:''}" data-bond="${b.id}" data-key="count" placeholder="自动 ${b.actualCount}"></label></div><p class="team-bond-copy" id="bond-copy-${b.id}">${escape(bondInfo(b))}</p></details>`).join('');
  const options=Object.values(pack.data.bonds).filter(b=>!visible.some(v=>v.id===b.bondId)).map(b=>[b.bondId,b.name]);
  $('#add-bond-field').innerHTML=options.length?editor.imageSelect('补充外部盟约','addBond',[['','选择盟约…'],...options],''):'';
}
function setup(){
  $('#target-fields').addEventListener('input',e=>{const el=e.target;if(!el.name)return;if(el.name==='targetShape'){remember();state.scene.targetShape=el.value;if(el.value==='boss'){state.scene.targetRow=3;state.scene.targetCol=10;}changed();renderBoard();return;}state.target[el.name]=el.type==='number'?(el.value===''?'':Number(el.value)):el.value;changed();if(el.name==='motion')renderBoard();});
  $('#default-target').onclick=()=>{for(const key of ['def','res','weight','rank','motion'])state.target[key]=pack.manifest.defaults.target[key];changed();renderTarget();renderBoard();};
  document.querySelectorAll('[data-team-tabs]').forEach(el=>el.onclick=e=>{const tab=e.target.closest('[data-team]'),action=e.target.closest('[data-team-action]')?.dataset.teamAction;if(!tab&&!action)return;pending=null;hideDirection();if(tab){active=Number(tab.dataset.team);selected=team().members[0].uid;renderAll();return;}if(action==='add'&&state.configs.length<5){remember();state.configs.push(structuredClone(team()));active=state.configs.length-1;}else if(action==='remove'&&state.configs.length>1){remember();state.configs.splice(active,1);active=Math.min(active,state.configs.length-1);}else return;selected=team().members[0].uid;changed();renderAll();});
  $('#roster').onclick=e=>{const b=e.target.closest('[data-member]');if(b){pending=null;hideDirection();selected=Number(b.dataset.member);renderRoster();renderPlacement();editor.render(member().config);renderBoard();$('.team-config').classList.add('editing');}};
  $('#add-member').onclick=()=>{if(team().members.length>=9)return;$('#addmember-picker [data-picker]').click();};
  $('#addmember-picker').onchange=e=>{const id=e.target.value;if(!id)return;const rec=pack.data.chess[id],config={...structuredClone(pack.manifest.defaults.config),chessId:rec.goldenId||id,skillIndex:pack.data.chess[rec.goldenId||id].skill?.index??0,items:[],bonds:[]};pending={uid:Math.max(...team().members.map(m=>m.uid))+1,config,row:4,col:3,dir:'RIGHT'};mode='unit';renderAll();notice('已选择 '+rec.name+'，点击绿色地块完成部署；Esc 取消。');};
  $('#remove-member').onclick=()=>{if(pending){pending=null;renderAll();notice('已取消待部署干员。');return;}if(team().members.length<=1)return;remember();team().members=team().members.filter(m=>m.uid!==member().uid);selected=team().members[0].uid;changed();renderAll();hideDirection();};
  $('#placement').oninput=e=>{const el=e.target;if(!el.name)return;if(!pending)remember();member()[el.name]=el.type==='number'?(el.value===''?'':Number(el.value)):el.value;if(!pending)changed();renderRoster();renderBoard();};
  $('#map-select').onchange=e=>{state.scene.stageId=e.target.value;changed();renderBoard();};
  $('#reset-boss').onclick=()=>{remember();state.scene.targetRow=3;state.scene.targetCol=10;changed();renderBoard();notice('Boss 已回到中央地板区；队员位置保留，请检查布阵。');};
  $('#place-unit').onclick=()=>{mode='unit';renderBoard();};$('#place-target').onclick=()=>{mode='target';renderBoard();};
  let drag=null,ignoreClick=0;
  $('#battlefield').onclick=e=>{if(performance.now()<ignoreClick)return;const tile=e.target.closest('[data-cell]');if(!tile)return;const [r,c]=tile.dataset.cell.split(',').map(Number);if(mode==='target'){moveTarget(r,c);return;}const unit=e.target.closest('[data-unit]');if(unit&&!pending){selected=Number(unit.dataset.unit);renderAll();showDirection(e.clientX,e.clientY);return;}placeAt(r,c,e.clientX,e.clientY);};
  $('#battlefield').addEventListener('pointermove',e=>{
    if(!pending||drag)return;const cell=e.target.closest('[data-cell]');if(!cell)return;const [row,col]=cell.dataset.cell.split(',').map(Number);pending.row=row;pending.col=col;
    const keys=new Set(engine.initialRange(engine.catalog.resolve(pending.config),pending));previewTeamRange([...keys]);
    $('#battlefield').querySelectorAll('.field-tile').forEach(t=>{const [r,c]=t.dataset.cell.split(',').map(Number);t.classList.toggle('range',keys.has(r*21+c));});
  });
  document.addEventListener('pointerdown' ,e=>{const source=e.target.closest('[data-unit],[data-drag-unit]');if(!source||e.button!==0)return;drag={uid:Number(source.dataset.unit||source.dataset.dragUnit),x:e.clientX,y:e.clientY,moved:false};});
  document.addEventListener('pointermove',e=>{if(!drag)return;if(!drag.moved&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<6)return;drag.moved=true;e.preventDefault();const m=team().members.find(m=>m.uid===drag.uid);if(!m)return;const rec=engine.catalog.resolve(m.config),ghost=$('#drag-ghost');ghost.hidden=false;ghost.innerHTML=editor.iconMarkup('operators',rec.charId,rec.name);ghost.style.left=e.clientX+'px';ghost.style.top=e.clientY+'px';document.querySelectorAll('.drop-hover').forEach(n=>n.classList.remove('drop-hover'));document.elementFromPoint(e.clientX,e.clientY)?.closest('#battlefield [data-cell]')?.classList.add('drop-hover');},{passive:false});
  document.addEventListener('pointerup',e=>{if(!drag)return;const old=drag;drag=null;$('#drag-ghost').hidden=true;document.querySelectorAll('.drop-hover').forEach(n=>n.classList.remove('drop-hover'));if(!old.moved)return;ignoreClick=performance.now()+300;const el=document.elementFromPoint(e.clientX,e.clientY)?.closest('#battlefield [data-cell]');if(el){pending=null;selected=old.uid;const [r,c]=el.dataset.cell.split(',').map(Number);placeAt(r,c,e.clientX,e.clientY);}});
  document.addEventListener('pointercancel',()=>{drag=null;$('#drag-ghost').hidden=true;});
  $('#direction-menu').onclick=e=>{const b=e.target.closest('[data-dir]');if(b)chooseDirection(b.dataset.dir);if(e.target.closest('[data-close-direction]'))hideDirection();};
  $('#undo-layout').onclick=undoLayout;
  document.addEventListener('keydown',e=>{if(e.target.matches('input,select,textarea')||document.querySelector('dialog[open]'))return;if(e.key==='Escape'){pending=null;drag=null;$('#drag-ghost').hidden=true;hideDirection();renderAll();notice('已取消待部署与朝向选择。');}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undoLayout();}if(e.key.toLowerCase()==='r'){e.preventDefault();const dirs=['RIGHT','DOWN','LEFT','UP'];chooseDirection(dirs[(dirs.indexOf(member().dir)+1)%4]);}if(!$('#direction-menu').hidden&&e.key.startsWith('Arrow')){e.preventDefault();chooseDirection({ArrowUp:'UP',ArrowDown:'DOWN',ArrowLeft:'LEFT',ArrowRight:'RIGHT'}[e.key]);}});
  $('#team-bonds').oninput=e=>{const el=e.target;if(!el.dataset.bond)return;let b=team().bonds.find(x=>x.id===el.dataset.bond);if(!b){b={id:el.dataset.bond,layers:0,count:null};team().bonds.push(b);}b[el.dataset.key]=el.value===''?(el.dataset.key==='count'?null:''):Number(el.value);changed();const info=engine.teamBonds(team())[b.id];$(`#bond-copy-${b.id}`).textContent=bondInfo(info);};
  $('#team-bonds').onchange=()=>renderBonds();
  $('#add-bond-field').onchange=e=>{if(e.target.value){team().bonds.push({id:e.target.value,layers:0,count:null});changed();renderBonds();}};
  for(const id of ['arcane','raid'])$(`#assume-${id}`).onchange=e=>{(team().assumptions??={})[id]=e.target.checked;changed();};
  $('#run').onclick=run;$('#field-run').onclick=run;$('#cancel').onclick=()=>runner.cancel();$('#field-cancel').onclick=()=>runner.cancel();$('#close-editor').onclick=()=>$('.team-config').classList.remove('editing');
  $('#share').onclick=async()=>{const url=new URL(location.href);url.search='';url.hash='config='+encode(state);try{await navigator.clipboard.writeText(url.href);notice('团队配置链接已复制。');}catch{location.hash=url.hash;notice('请复制地址栏中的团队配置链接。');}};
  $('#theme').onclick=()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme;localStorage.setItem('stronghold-theme',theme);};
  document.documentElement.dataset.theme=localStorage.getItem('stronghold-theme')||'light';
}
function chart(series,duration){const w=700,h=230,left=55,top=15,cw=630,ch=180,max=Math.max(1,...series.map(x=>x.total))*1.05;return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="各队伍累计伤害曲线">${[0,1,2,3,4].map(i=>`<line class="grid-line" x1="${left}" y1="${top+ch-i*ch/4}" x2="685" y2="${top+ch-i*ch/4}"/><text x="48" y="${top+ch-i*ch/4+4}" text-anchor="end">${number(max*i/40000,1)}万</text>`).join('')}${series.map((x,i)=>`<path fill="none" stroke="${colors[i]}" stroke-width="2.5" d="${x.samples.map((p,j)=>`${j?'L':'M'}${left+p.t/duration*cw},${top+ch-p.damage/max*ch}`).join(' ')}"/>`).join('')}${[0,1,2,3,4].map(i=>`<text x="${left+i*cw/4}" y="220" text-anchor="middle">${number(duration*i/4)}s</text>`).join('')}</svg>`;}
function timelineHtml(r,o){return `<div class="timeline-row"><span>#${o.uid} ${escape(o.name)}</span><div class="timeline-track" aria-label="${escape(o.name)} #${o.uid} 技能时间线">${o.skillWindow.intervals.map(([a,b])=>`<span class="skill-span" style="background:${colors[resultPlan]};left:${a/r.target.duration*100}%;width:${(b-a)/r.target.duration*100}%" title="${number(a,2)}–${number(b,2)} 秒"></span>`).join('')}</div></div>`;}
function renderResults(){const rs=results,r=rs[Math.min(resultPlan,rs.length-1)],warnings=rs.flatMap((r,i)=>r.warnings.map(w=>`方案 ${letters[i]}：${w}`));$('#results').innerHTML=`<div class="summary-pair">${rs.map((r,i)=>`<article class="summary-card" style="border-top-color:${colors[i]}"><div class="summary-label"><strong>方案 ${letters[i]}</strong><span>${r.damageByOperator.length} 人</span></div><div class="metric-label">全队累计伤害</div><div class="metric">${number(r.total)}</div><div class="summary-secondary">平均 DPS <strong>${number(r.dps,1)}</strong></div>${i&&rs[0].total?`<p class="current-config">相对 A ${r.total>=rs[0].total?'+':''}${number((r.total/rs[0].total-1)*100,1)}%</p>`:''}</article>`).join('')}</div><div class="chart-panel"><div class="chart-head"><h3>全队累计伤害</h3><div class="legend">${rs.map((r,i)=>`<span><i class="small-dot" style="background:${colors[i]}"></i>方案 ${letters[i]}</span>`).join('')}</div></div>${chart(rs,r.target.duration)}</div><div class="detail-panel"><div class="team-section-head"><h3>逐人输出</h3>${select('查看方案','resultPlan',rs.map((_,i)=>[i,letters[i]]),resultPlan)}</div><div class="team-table-scroll"><table class="stats-table"><thead><tr><th>干员实例</th><th>总伤害</th><th>平均 DPS</th><th>技能期间 DPS</th><th>召唤物伤害</th></tr></thead><tbody>${r.damageByOperator.map(o=>`<tr><td>${editor.iconMarkup('operators',o.charId,o.name)} #${o.uid} ${escape(o.name)}</td><td>${number(o.damage)}</td><td>${number(o.dps,1)}</td><td>${o.skillWindow.dps==null?'—':number(o.skillWindow.dps,1)}</td><td>${number(o.summons)}</td></tr>`).join('')}<tr><td>未归属伤害</td><td>${number(r.unattributedDamage)}</td><td colspan="3">地图／环境等来源不明伤害单列</td></tr></tbody></table></div><p class="chart-caption">召唤物已包含在总伤害中；队友治疗和增益不重复折算为辅助者伤害。</p><h3>个人技能时间线</h3>${r.damageByOperator.map(o=>timelineHtml(r,o)).join('')}<p class="chart-caption">技能期间 DPS = 个人技能生效区间内本体及归属伤害 ÷ 生效时长。瞬发或未开技能显示 —。</p></div><div class="detail-panel"><h3>本次计算的限制与假设</h3><ul class="warning-list">${warnings.map(w=>`<li>${escape(w)}</li>`).join('')}</ul><div class="export-row"><button id="export-csv" class="text-button">下载逐秒全队与个人 CSV</button><button id="export-json" class="text-button">下载配置与结果 JSON</button></div></div>`;
  $('#results [name=resultPlan]').onchange=e=>{resultPlan=Number(e.target.value);renderResults();};
  $('#export-json').onclick=()=>download('卫戍协议-团队结果.json',JSON.stringify({manifest:pack.manifest,configuration:resultInput,results:rs},null,2),'application/json');
  $('#export-csv').onclick=()=>{const columns=rs.flatMap((r,i)=>[{label:`${letters[i]} 全队`,get:s=>s.damage},...r.damageByOperator.map(o=>({label:`${letters[i]} #${o.uid} ${o.name}`,get:s=>s.operators[o.id]||0})),{label:`${letters[i]} 未归属`,get:s=>s.damage-Object.values(s.operators).reduce((a,b)=>a+b,0)}].map(c=>({...c,result:r})));const quote=s=>'"'+String(s).replace(/"/g,'""')+'"';const csv=['时间（秒）',...columns.map(c=>c.label)].map(quote).join(',')+'\n'+rs[0].samples.map((s,i)=>[s.t,...columns.map(c=>c.get(c.result.samples[i]))].join(',')).join('\n');download('卫戍协议-团队逐秒.csv','\uFEFF'+csv,'text/csv');};
}
function download(name,text,type){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function run(){
  if(busy)return;if(pending){notice('请先放置待部署干员，或按 Esc 取消。',true);return;}const invalid=[...document.querySelectorAll('input[type=number]')].find(el=>el.value===''&&!el.dataset.bond||el.value!==''&&!el.checkValidity());if(invalid){invalid.reportValidity();notice('请填写有效的数字。',true);return;}
  try{for(let i=0;i<state.configs.length;i++)try{engine.validateTeam(state.configs[i],state.target,state.scene);}catch(e){throw new Error(`方案 ${letters[i]}：${e.message}`);}}catch(e){notice(e.message,true);return;}
  const snapshot=structuredClone(state),at=revision;busy=true;$('#run').disabled=true;$('#field-run').disabled=true;$('#cancel').hidden=false;$('#field-cancel').hidden=false;$('#result-state').textContent='正在计算全部队伍…';
  try{const computed=await runner.run({mode:'team',versionId:state.version,configs:snapshot.configs,target:snapshot.target,scene:snapshot.scene});if(revision!==at){notice('计算期间配置已修改，旧结果已丢弃。');$('#result-state').textContent='配置已修改，请重新计算';return;}results=computed;resultInput=snapshot;resultPlan=Math.min(resultPlan,results.length-1);renderResults();$('#results').classList.remove('stale');$('#result-state').textContent=`${state.target.duration} 秒 · ${results.length} 个队伍方案`;notice('计算完成。治疗与队友联动来自同一场战斗，结果仍需与原版核对。');}catch(e){notice(e.message,true);$('#result-state').textContent='计算未完成';}finally{busy=false;$('#run').disabled=false;$('#field-run').disabled=false;$('#cancel').hidden=true;$('#field-cancel').hidden=true;}
}
