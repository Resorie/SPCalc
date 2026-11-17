import { createCalculationRunner } from './calculation-runner.js';
import { loadRuleset, loadIcons } from './rulesets.js';
import { defaultState as makeState, restoreState } from './config-state.js';
import { createCalculator } from './engine.js';
import { createImagePicker } from './image-picker.js';
import { closureBlockBonusField, diyOperatorOptions, moduleField } from './operator-editor.js';
import { MAX_TARGET_HP, resetTargetPanel } from './trial-targets.js';
const planName = i => 'ABCDE'[i];
const planColor = i => ['var(--blue)','var(--b)','#218273','#9460b5','#be425c'][i];
const runner = createCalculationRunner();
let storageKey;
let bootState, bootWarning = '';
try {
  const hash = new URLSearchParams(location.hash.slice(1)).get('config');
  if (hash) bootState = JSON.parse(decodeURIComponent(escapeBase64(hash)));
} catch { bootWarning = '保存的配置无法读取，已恢复默认。'; }
let pack, calculator;
try {
  pack = await loadRuleset({ versionId: bootState?.version });
  calculator = await createCalculator(pack);
} catch (error) {
  document.querySelector('#notice').textContent = error.message;
  document.querySelector('#notice').classList.add('error');
  const reset = document.createElement('button');
  reset.textContent = '清除配置并载入当前版本';
  reset.className = 'button secondary';
  reset.onclick = () => { try { localStorage.removeItem(storageKey); } catch {} location.hash = ''; location.reload(); };
  document.querySelector('#notice').append(' ', reset);
  throw error;
}
const VERSION = pack.manifest, catalog = calculator.catalog;
storageKey = 'stronghold-calculator-v1:' + VERSION.id;
if (!bootState && !bootWarning) {
  try { const saved = localStorage.getItem(storageKey); if (saved) bootState = JSON.parse(saved); }
  catch { bootWarning = '保存的配置无法读取，已恢复默认。'; }
}
let icons = {};
try {
  icons = await loadIcons(VERSION);
} catch { bootWarning += ' 部分图标未载入，仍可通过名称选择。'; }

const $ = s => document.querySelector(s);
const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = (v, digits = 0) => Number(v).toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const shortNumber = v => Math.abs(v) >= 10000 ? `${number(v / 10000, 1)}万` : number(v);
const defaultState = () => makeState(VERSION);
let state = defaultState(), active = 0, data = pack.data, results, busy = false;
let loadWarning = bootWarning;
try { if (bootState) state = restoreState(bootState, VERSION); }
catch (error) { loadWarning = error.message; state = defaultState(); }
function escapeBase64(s) { return atob(s.replace(/-/g, '+').replace(/_/g, '/')); }
const encodedState = () => btoa(encodeURIComponent(JSON.stringify(state))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const persist = () => { try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch {} };
function markChanged() {
  persist();
  if (results) { $('#result-state').textContent = '配置已修改，请重新计算'; $('#results').classList.add('stale'); }
}
function option(value, label, current) { return `<option value="${escape(value)}" ${String(value) === String(current) ? 'selected' : ''}>${escape(label)}</option>`; }
function select(label, name, options, value, attr = '') {
  return `<label class="field"><span>${escape(label)}</span><select name="${name}" aria-label="${escape(label)}" ${attr}>${options.map(([v,l])=>option(v,l,value)).join('')}</select></label>`;
}
function numeric(label, name, value, min, max, attr = '') {
  return `<label class="field"><span>${escape(label)}</span><input name="${name}" aria-label="${escape(label)}" type="number" value="${escape(value)}" min="${min}" max="${max}" step="any" ${attr}></label>`;
}
function iconMarkup(kind,id,name='',badge='') {
  const path=icons[kind]?.[id];
  const src=path?new URL(`../assets/icons/${path}`,import.meta.url).href:null;
  return `<span class="icon-frame icon-${kind}${src?'':' missing'}"><span class="icon-fallback" aria-hidden="true">${escape(name?.[0]||'—')}</span>${src?`<img data-icon src="${escape(src)}" alt="" loading="lazy" decoding="async" width="48" height="48">`:''}${badge?`<span class="icon-level">${escape(badge)}</span>`:''}</span>`;
}
function fieldIcon(name,value,label) {
  if(name==='operator')return iconMarkup('operators',data.chess[value]?.charId,label);
  if(name==='diyOperator')return iconMarkup('operators',value,label);
  if(name==='bondId')return iconMarkup('bonds',value,label);
  return iconMarkup('items',value,value?label:'—',data.items[value]?.isGolden?'进阶':'');
}
document.addEventListener('error',event=>{
  if(event.target.matches?.('img[data-icon]')) {event.target.hidden=true;event.target.parentElement.classList.add('missing');}
},true);
const imagePicker=createImagePicker(fieldIcon);
const imageSelect=(...args)=>imagePicker.field(...args);
function renderTarget() {
  const t = state.target;
  const ref = VERSION.defaults.bossPresetSource ?? VERSION.defaults.targetReference;
  $('#target-reference').innerHTML = ref ? `<a href="${escape(ref.source)}" target="_blank" rel="noreferrer">${escape(ref.label)} ↗</a>` : '';
  $('#target-preset').innerHTML = calculator.bossPresets.length
    ? select('Boss 预设','bossId',[['','自定义面板'],...calculator.bossPresets.map(p=>[p.id,p.name])],t.bossId??'') : '';
  $('#target-fields').innerHTML = numeric('生命值 / 每个靶','hp',t.hp,1,MAX_TARGET_HP,'inputmode="numeric"')+numeric('防御力','def',t.def,0,10000)+numeric('法术抗性','res',t.res,0,100)+numeric('测试时长 / 秒','duration',t.duration,1,300)+numeric('目标数量','count',t.count,1,8)+select('前方距离 / 格','distance',[1,2,3,4,5].map(n=>[n,n]),t.distance)+select('敌人等级','rank',[['NORMAL','普通敌人'],['BOSS','领袖']],t.rank)+numeric('重量','weight',t.weight,0,10)+select('目标类型','motion',[['WALK','地面'],['FLY','空中']],t.motion)+numeric('随机种子','seed',t.seed,1,4294967295);
}
function operatorOptions() {
  return catalog.presets.map(c=>[c.chessId,`${['','Ⅰ','Ⅱ','Ⅲ','Ⅳ','Ⅴ','Ⅵ'][c.tier]}阶 · ${c.name}`]);
}
function renderConfig() {
  imagePicker.clear();
  const c = state.configs[active], rec = catalog.resolve(c);
  if (!rec) throw new Error('配置中的干员不存在。');
  const base = rec.baseId;
  const equipment = [['','不装备'], ...catalog.equipment.map(i=>[i.id,`${i.name}${i.isGolden?' · 进阶':''}`]),
    ...c.items.filter(id=>!catalog.isCombatItem(id)).map(id=>[id,`${data.items[id]?.name || id}（不可携带，请更换）`])];
  const lock = catalog.lock(c);
  const skills = (rec.skills?.length ? rec.skills : [rec.skill].filter(Boolean)).filter(s=>!lock || s.index === lock.skillIndex);
  const selectedSkill = skills.find(s=>s.index===Number(c.skillIndex)) || rec.skill;
  const ownBonds = calculator.ownBonds(rec,c.items);
  const tag = ownBonds.map(id=>`<span class="badge">${iconMarkup('bonds',id,data.bonds[id]?.name)}${escape(data.bonds[id]?.name || id)}${rec.bonds.includes(id)?'':' · 转职'}</span>`).join('');
  const inactiveConversions = ownBonds.filter(id=>!rec.bonds.includes(id)&&!c.bonds.some(b=>b.id===id));
  $('#config-panel').innerHTML = `
    <div class="field-row">${select('干员来源','mode',[['preset','预置干员'],['diy','自选干员']],c.diy?'diy':'preset')}${c.diy?select('自选等阶','diyTier',[[5,'Ⅴ 阶'],[6,'Ⅵ 阶']],rec.tier):'<div class="field-hint">保留活动专属特质</div>'}</div>
    ${c.diy?imageSelect('自选干员','diyOperator',diyOperatorOptions(catalog,rec.tier),c.diy.charId):imageSelect('干员','operator',operatorOptions(),base)}
    <div class="operator-row">${iconMarkup('operators',rec.charId,rec.name)}<div><h3>${escape(rec.name)} <span class="subtle">${rec.isGolden?'精锐':'初始'}</span></h3><div class="operator-meta">${escape(rec.subProfessionName)} · 精英 ${rec.status.phase} / Lv.${rec.status.level} · 技能等级 ${rec.status.skillLevel}</div></div></div>
    <div>${tag}${c.diy?'<span class="badge neutral">无卫戍专属特质</span>':''}</div>
    <div class="field-row" style="margin-top:15px">${select('棋子状态','elite',[[0,'初始'],[1,'精锐']],rec.isGolden?1:0)}${select('潜能','potential',[1,2,3,4,5,6].map(n=>[n,`${n} 潜`]),c.potential,rec.diyProto?'disabled':'')}</div>
    ${select('自持有干员练度加成','cultivate',[[0,'未精英化 · 无加成'],[1,'精英 1 · 攻防 +5%'],[2,'精英 2 · 攻 +10%，防血 +5%'],[3,'精英 2 Lv.60 · 攻防血 +10%']],c.cultivate,rec.diyProto?'disabled':'')}
    ${rec.diyProto?'<p class="field-note">原型干员不享受持有潜能与练度加成；技能、模组按该等阶固定。</p>':''}
    <div style="margin-top:14px">${select('携带技能','skillIndex',skills.map(s=>[s.index,`技能 ${s.index+1} · ${s.name}`]),c.skillIndex)}</div>
    ${moduleField(c,rec,catalog,lock)}
    <p class="skill-copy">${escape(selectedSkill?.desc || '此干员无可用技能说明。')}\n${rec.module?.active ? `模组：${escape(rec.module.name)} · 等级 ${rec.module.level}` : '当前棋子无模组加成'}</p>
    <div class="config-subheading"><h3>外部加成</h3><span class="subtle">全程生效，仅作用于该干员</span></div>
    <div class="field-row">${numeric('攻击力加成 / %','ext_atkPct',c.external?.atkPct??0,0,100000)}${numeric('攻击速度 / 点','ext_aspd',c.external?.aspd??0,0,100000)}</div>
    <details><summary>攻击力其他乘区</summary><div class="field-row">${numeric('基础固定加攻','ext_atkFlat',c.external?.atkFlat??0,0,100000)}${numeric('后加固定攻击','ext_atkFinal',c.external?.atkFinal??0,0,100000)}</div>${numeric('独立倍率 / 倍','ext_atkMul',c.external?.atkMul??1,1,100)}</details>
    <p class="field-note">百分比加攻与同类增益相加；攻速填点数。基础固定值先参与百分比加成，后加固定值随后加入，最后乘独立倍率及培养系数。只手动指定加成，不模拟队友、站位与触发条件。</p>
    ${closureBlockBonusField(c,rec)}
    <div class="config-subheading"><h3>携带装备</h3><span class="subtle">最多 2 件战斗装备</span></div>
    ${imageSelect('装备一','item0',equipment,c.items[0]||'')}<p class="item-desc">${escape(data.items[c.items[0]]?.desc || '选择装备，查看效果。')}</p>
    ${imageSelect('装备二','item1',equipment,c.items[1]||'')}<p class="item-desc">${escape(data.items[c.items[1]]?.desc || '可与另一方案只更换这一栏，比较边际收益。')}</p>
    <p class="field-note">使用后销毁的道具不占战斗装备栏。盟约层数、晋升等结果请直接填写；此处不模拟休整期。</p>
    <div class="config-subheading"><h3>已激活盟约</h3><span class="subtle">手动指定战斗条件</span></div>
    ${inactiveConversions.length?`<p class="field-note">「${inactiveConversions.map(id=>escape(data.bonds[id]?.name||id)).join('、')}」已转职，尚未激活。请添加盟约并填写人数和起始层数。</p>`:''}
    <div id="bond-list">${c.bonds.map((b,i)=>bondEditor(b,i)).join('')}</div>
    <button id="add-bond" class="bond-add" type="button">＋ 添加盟约</button>
    <p class="field-note">未添加的盟约视为未激活。人数用于选择档位，不生成队友。单人灵巧按相邻队友覆盖。奥术和突袭的简化见对应说明。战斗中特质产生的层数变化会继续生效。</p>`;
  renderTabs();
  $('#config-panel').setAttribute('aria-labelledby', `tab-${active}`);

}
function bondDescription(b) {
  const preview = catalog.describeBond(b);
  if (!preview) return '请填写有效的起始层数。';
  const lines = preview.rows.map(row => {
    const text = row.text.split(/(\{\d+:[^}]+\})/g).map(part => {
      const match = part.match(/^\{(\d+):[^}]+\}$/);
      if (!match) return escape(part);
      const value = preview.values[match[1]];
      if (!value) return '<span>（数值待核对）</span>';
      const formatted = number(value.value * (value.percent ? 100 : 1),2).replace(/\.?0+$/,'');
      return `<strong class="bond-value" title="${escape(value.formula)}${value.percent?'，换算为百分比':''}">${formatted}${value.percent?'%':''}</strong>`;
    }).join('');
    return `<div class="bond-effect ${row.unmet?'bond-unmet':''}">${row.unmet?`<span class="bond-condition">${escape(row.unmet)}</span> `:''}${text}</div>`;
  }).join('');
  const raidNote = b.id === 'raidShip' ? '<div class="bond-preview-note">本靶场：突袭成员初始接触不到地面靶，按盟约实际条件跳跃后接敌并获得加成；覆盖前方距离设置，保留跳跃等待、技力及再部署效果。未转职的非突袭干员不套用此假设；空中靶仍无法作为突袭目标。</div>' : '';
  const coverage = preview.trialCoverage;
  const assumption = coverage ? `<div class="bond-preview-note">本靶场假设队友全程施加奥术，${coverage.lowHp?'按低于 50% 生命的强化效果':'按普通效果'}：受到的法术伤害 <strong class="bond-value">+${number((coverage.multiplier-1)*100,2)}%</strong>。所有干员及召唤物均可受益，首段法伤即生效；不改变靶子实际血量。</div>` : '';
  return `<div class="bond-preview-label">按起始 ${preview.layers} 层 / ${preview.count} 人档展开</div>${lines}${assumption}${raidNote}<div class="bond-preview-note">${coverage?'奥术采用上述靶场假设；此处按起始层数预览，计算会跟随战斗中层数变化。':'显示效果参数，不代表触发条件已满足；部署次数、队友属性等仍按实际场景结算。战斗中层数变化未在此预演。'}</div>`;
}
function bondEditor(b, i) {
  const rec = data.bonds[b.id];
  return `<div class="bond-editor" data-index="${i}"><div class="bond-top">${imageSelect('盟约','bondId',Object.values(data.bonds).map(x=>[x.bondId,x.name]),b.id,`data-index="${i}"`)}<button class="remove-bond" data-remove="${i}" aria-label="移除${escape(rec.name)}盟约">×</button></div><div class="bond-grid">${select('激活人数','bondCount',rec.thresholds.map(n=>[n,`${n} 人档`]),b.count,`data-index="${i}"`)}${numeric('起始层数','bondLayers',b.layers,0,999,`data-index="${i}"`)}</div><div class="bond-desc" data-bond-description="${i}">${bondDescription(b)}</div></div>`;
}

$('#default-target').addEventListener('click', () => {
  resetTargetPanel(state.target,VERSION);
  renderTarget(); markChanged();
});
$('#target-preset').addEventListener('change', event => {
  const preset = calculator.bossPresets.find(p=>p.id===event.target.value);
  Object.assign(state.target,preset?.target ?? {bossId:null});
  renderTarget(); markChanged();
});
$('#target-fields').addEventListener('input', event => {
  const el=event.target;if(!el.name)return;
  state.target[el.name] = el.type==='number' ? (el.value===''?'':Number(el.value)) : el.name==='distance'?Number(el.value):el.value;
  markChanged();
});
$('#config-panel').addEventListener('input', event => {
  const el = event.target;
  if (el.name.startsWith('ext_')) {
    const c = state.configs[active];
    (c.external ??= {})[el.name.slice(4)] = el.value === '' ? '' : Number(el.value);
    markChanged();
  }
  if (el.name === 'bondLayers') {
    const index = Number(el.dataset.index);
    const bond = state.configs[active].bonds[index];
    bond.layers = el.value === '' ? '' : Number(el.value);
    document.querySelector(`[data-bond-description="${index}"]`).innerHTML = bondDescription(bond);
    markChanged();
  }
});
$('#config-panel').addEventListener('change', event => {
  const el=event.target,c=state.configs[active];
  const name=el.name;if(!name || name==='bondLayers' || name.startsWith('ext_'))return;
  if(name==='mode') {
    delete c.moduleId;
    if(el.value==='diy') Object.assign(c,catalog.defaultDiy(6,true,VERSION.defaults.diyCharId));
    else {c.chessId=VERSION.defaults.config.chessId;c.skillIndex=VERSION.defaults.config.skillIndex;delete c.diy;}
  } else if(name==='diyOperator'||name==='diyTier') {
    const previous=catalog.resolve(c);
    Object.assign(c,catalog.defaultDiy(name==='diyTier'?Number(el.value):previous.tier,previous.isGolden,name==='diyOperator'?el.value:c.diy.charId));
  } else if(name==='uniEquipId') {
    c.diy.uniEquipId=el.value==='none'?null:el.value;
  } else if(name==='moduleId') {
    c.moduleId=el.value;
  } else if(name==='closureBlockBonus') {
    c.closureBlockBonus=el.value;
  } else if(name==='operator'||name==='elite') {
    const previous=catalog.resolve(c);
    const base=data.chess[name==='operator'?el.value:previous.baseId];
    c.chessId=(name==='elite'?Number(el.value):previous.isGolden) ? base.goldenId : base.chessId;
    if(name==='operator') {
      delete c.moduleId;
      c.skillIndex=data.chess[c.chessId].skill?.index??0;
    }
  } else if(name==='item0'||name==='item1') {
    const values = [$('#config-panel select[name=item0]').value,$('#config-panel select[name=item1]').value];
    c.items=values.filter(Boolean);
  } else if(name.startsWith('bond')) {
    const b=c.bonds[Number(el.dataset.index)];
    if(name==='bondId') {b.id=el.value;b.count=data.bonds[b.id].thresholds[0];}
    if(name==='bondCount')b.count=Number(el.value);
  } else c[name]=Number(el.value);
  markChanged();renderConfig();
});
$('#config-panel').addEventListener('click', event => {
  const c=state.configs[active],remove=event.target.closest('[data-remove]');
  if(remove) {c.bonds.splice(Number(remove.dataset.remove),1);markChanged();renderConfig();}
  if(event.target.closest('#add-bond')) {
    const rec=catalog.resolve(c);
    const converted=calculator.ownBonds(rec,c.items).filter(id=>!rec.bonds.includes(id));
    const id=[...converted,...rec.bonds,...Object.keys(data.bonds)].find(id=>!c.bonds.some(b=>b.id===id));
    if(id) {c.bonds.push({id,count:data.bonds[id].thresholds[0],layers:20});markChanged();renderConfig();}
  }
});
function renderTabs() {
  $('.config-tabs').innerHTML = state.configs.map((c,i)=>`<button id="tab-${i}" role="tab" aria-selected="${active===i}" aria-controls="config-panel" data-plan="${i}">${planName(i)} <i class="small-dot" style="background:${planColor(i)}"></i></button>`).join('')+
    `<button type="button" id="add-plan" class="copy-button" aria-label="新增方案（复制当前方案）" ${state.configs.length>=5?'disabled':''}>＋</button><button type="button" id="remove-plan" class="copy-button" aria-label="删除当前方案" ${state.configs.length<=1?'disabled':''}>删除</button>`;
}
$('.config-tabs').addEventListener('click',e=>{
  const tab=e.target.closest('[data-plan]');
  if(tab){active=Number(tab.dataset.plan);renderConfig();return;}
  if(e.target.closest('#add-plan')&&state.configs.length<5){state.configs.push(structuredClone(state.configs[active]));active=state.configs.length-1;markChanged();renderConfig();}
  if(e.target.closest('#remove-plan')&&state.configs.length>1){state.configs.splice(active,1);active=Math.min(active,state.configs.length-1);markChanged();renderConfig();}
});
$('.config-tabs').addEventListener('keydown',e=>{
  if(e.target.matches('[data-plan]')&&['ArrowLeft','ArrowRight'].includes(e.key)){
    e.preventDefault();active=(active+(e.key==='ArrowRight'?1:-1)+state.configs.length)%state.configs.length;
    renderConfig();$(`#tab-${active}`).focus();
  }
});
function showNotice(text, error=false) { $('#notice').textContent=text;$('#notice').classList.toggle('error',error); }
function configLabel(c) { const r=catalog.resolve(c);return `${r.name} · ${r.isGolden?'精锐':'初始'}${c.diy?' · 自选':''}`; }
function configDetails(c) { const r=catalog.resolve(c);return [r.skill?.name,r.module?.active?r.module.name:'不携带模组',...c.items.map(id=>(data.items[id]?.name||id)+(data.items[id]?.isGolden?'（进阶）':'')),...c.bonds.map(b=>`${data.bonds[b.id].name} ${b.count}人/${b.layers}层`),...Object.entries(c.external||{}).filter(([k,v])=>Number(v)!==(k==='atkMul'?1:0)).map(([k,v])=>`${({atkPct:'外部加攻%',aspd:'外部攻速',atkFlat:'基础固定加攻',atkFinal:'后加攻击',atkMul:'独立倍率'})[k]} ${v}`)].filter(Boolean).join('，'); }
function chartHtml(rs) {
  const width=700,height=255,left=57,right=16,top=18,bottom=30,w=width-left-right,h=height-top-bottom;
  const max=Math.max(1,...rs.map(r=>r.total))*1.06,duration=rs[0].target.duration;
  let parts='';
  for(let i=0;i<=4;i++){const y=top+h-i*h/4;parts+=`<line class="grid-line" x1="${left}" y1="${y}" x2="${width-right}" y2="${y}"/><text x="${left-10}" y="${y+4}" text-anchor="end">${shortNumber(max*i/4)}</text>`;}
  for(let i=0;i<=6;i++)parts+=`<text x="${left+i*w/6}" y="${height-7}" text-anchor="middle">${number(duration*i/6)}s</text>`;
  rs.forEach((r,i)=>{const d=r.samples.map((p,n)=>`${n?'L':'M'}${(left+p.t/duration*w).toFixed(2)},${(top+h-p.damage/max*h).toFixed(2)}`).join(' ');parts+=`<path d="${d}" stroke="${planColor(i)}" stroke-width="2.5" fill="none" stroke-dasharray="${['none','6 3','2 3','10 3 2 3','8 3'][i]}"/>`;});
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="各方案随时间变化的累计伤害曲线；详细数值可下载 CSV">${parts}</svg>`;
}
function skillTimeline(r,i) {
  let start=null,spans=[];
  for(const e of r.timeline) {if(e.kind==='skillStart')start=e.t;else if(e.kind==='skillEnd'&&start!==null){spans.push([start,e.t]);start=null;}}
  if(start!==null)spans.push([start,r.target.duration]);
  return `<div class="timeline-row"><span>${planName(i)}</span><div class="timeline-track" aria-label="方案${planName(i)}技能时间线">${spans.map(([a,b])=>`<span class="skill-span" style="background:${planColor(i)};left:${a/r.target.duration*100}%;width:${Math.max(.2,(b-a)/r.target.duration*100)}%" title="${number(a,2)}–${number(b,2)} 秒"></span>`).join('')}</div></div>`;
}
const typeNames={phys:'物理伤害',arts:'法术伤害',true:'真实伤害',elemental:'元素伤害',element:'元素伤害',hpLoss:'生命流失',other:'其他伤害'};
function renderResults(rs) {
  const a=rs[0];
  const summary = rs.map((r,i)=>`<article class="summary-card" style="border-top-color:${planColor(i)}"><div class="summary-label"><strong>方案 ${planName(i)}</strong><span>${iconMarkup('operators',catalog.resolve(r.config).charId,configLabel(r.config))}${escape(configLabel(r.config))}</span></div><div class="metric-label">累计伤害</div><div class="metric">${number(r.total)}</div><div class="summary-secondary"><span>平均 DPS <strong>${number(r.dps,1)}</strong></span><span>技能 ${r.activations} 次</span></div><div class="summary-secondary skill-metric"><span>技能期间 DPS <strong>${r.skillWindow.dps===null?'—':number(r.skillWindow.dps,1)}</strong></span><span>生效 ${number(r.skillWindow.duration,2)} 秒</span></div>${r.targetDefeatedAt!==null?`<p class="current-config">击倒全部靶子 · ${number(r.targetDefeatedAt,2)} 秒</p>`:''}<p class="current-config">${escape(configDetails(r.config))}</p></article>`).join('');
  const types=[...new Set(rs.flatMap(r=>Object.keys(r.damageTypes)))];
  const row=(label,...values)=>`<tr><td>${escape(label)}</td>${values.map(v=>`<td>${v}</td>`).join('')}</tr>`;
  const swiftRow=rs.some(r=>r.swiftRefunds)?row('迅捷返还技力',...rs.map(r=>r.swiftRefunds
    ? `${r.swiftRefunds.reduce((sum,event)=>sum+event.amount,0).toLocaleString('zh-CN',{maximumFractionDigits:2})} 点 · ${r.swiftRefunds.length} 次`
    : '未激活')):'';
  const warnings=[...new Set(rs.flatMap((r,i)=>r.warnings.map(w=>`方案 ${planName(i)}：${w}`)))];
  $('#results').innerHTML=`<div class="summary-pair">${summary}</div><p class="comparison-note">${rs.length===1?'当前只有一个方案，可点击＋复制并比较。':rs.slice(1).map((r,i)=>a.total?`方案 ${planName(i+1)} 相对 A：${r.total>=a.total?'+':''}${number((r.total/a.total-1)*100,1)}%`:`方案 ${planName(i+1)}：A 伤害为零，不计算提升比例`).join('；')}</p>
    <div class="chart-panel"><div class="chart-head"><h3>累计伤害</h3><div class="legend">${rs.map((r,i)=>`<span><i class="small-dot" style="background:${planColor(i)}"></i>方案 ${planName(i)}</span>`).join('')}</div></div>${chartHtml(rs)}<div style="margin-top:16px"><h3 style="font-size:12px">技能持续时间</h3>${rs.map((r,i)=>skillTimeline(r,i)).join('')}</div><p class="chart-caption">横轴为部署后的游戏内时间。色带表示技能生效区间，瞬发技能只标记启动点。多目标伤害合并统计。技能期间 DPS = 生效区间内实际扣血 ÷ 生效总时长；多次释放合并，末次截到测试结束。包含同期普攻、装备和召唤物伤害，不计结束后才命中的伤害。瞬发或未开启技能显示“—”。</p></div>
    <div class="detail-panel"><h3>伤害拆分</h3><table class="stats-table"><thead><tr><th>指标</th>${rs.map((r,i)=>`<th>方案 ${planName(i)}</th>`).join('')}</tr></thead><tbody>${row('首次造成伤害',...rs.map(r=>r.firstHit===null?'—':`${number(r.firstHit,2)} 秒`))}${types.map(t=>row(typeNames[t]||t,...rs.map(r=>number(r.damageTypes[t]||0)))).join('')}${row('技能期间伤害',...rs.map(r=>r.skillWindow.dps===null?'—':number(r.skillWindow.damage)))}${swiftRow}${row('技能生效总时长',...rs.map(r=>`${number(r.skillWindow.duration,2)} 秒`))}${row('部署时攻击力',...rs.map(r=>number(r.opening.atk,1)))}${row('部署时攻击间隔',...rs.map(r=>`${number(r.opening.interval,3)} 秒`))}</tbody></table><p class="chart-caption">部署时面板用于核对初始状态，可能随后被技能、特质或盟约改变。按受击者实际扣血统计，包含自动召唤物。</p></div>
    <div class="detail-panel"><h3>输出归属</h3><table class="stats-table"><thead><tr><th>方案 / 干员</th><th>本体及归属伤害</th><th>召唤物</th><th>合计</th></tr></thead><tbody>${rs.flatMap((r,i)=>r.damageByOperator.map(o=>`<tr><td>${planName(i)} / ${escape(o.name)}</td><td>${number(o.direct)}</td><td>${number(o.summons)}</td><td>${number(o.damage)}</td></tr>`)).join('')}${rs.some(r=>r.unattributedDamage)?`<tr><td>未归属伤害（按方案顺序）</td><td colspan="3">${rs.map(r=>number(r.unattributedDamage)).join(' / ')}</td></tr>`:''}</tbody></table><p class="chart-caption">按干员实例归属，召唤物沿所属关系合并；队友增益不重复折算为辅助者伤害。无法确定来源的伤害单列。</p></div>
    ${warnings.length?`<div class="detail-panel"><h3>本次计算的限制</h3><ul class="warning-list">${warnings.map(w=>`<li>${escape(w)}</li>`).join('')}</ul></div>`:''}
    <div class="detail-panel"><details><summary>查看前 60 条伤害记录</summary><div class="logs-scroll"><table class="stats-table"><thead><tr><th>时间</th><th>方案</th><th>来源</th><th>类型</th><th>伤害</th></tr></thead><tbody>${rs.flatMap((r,i)=>r.hits.slice(0,60).map(h=>({...h,plan:planName(i)}))).sort((x,y)=>x.t-y.t).slice(0,60).map(h=>`<tr><td>${number(h.t,2)}s</td><td>${h.plan}</td><td>${escape(h.source)}</td><td>${escape(typeNames[h.type]||h.type)}</td><td>${number(h.amount,1)}</td></tr>`).join('')}</tbody></table></div></details><div class="export-row"><button id="export-csv" class="text-button">下载逐秒 CSV</button><button id="export-json" class="text-button">下载配置与结果 JSON</button></div></div>`;
  $('#results').classList.remove('stale');
  $('#export-csv').onclick=()=>download('卫戍协议-逐秒伤害.csv','\uFEFF'+['时间（秒）',...rs.map((r,i)=>`方案 ${planName(i)} 累计伤害`)].join(',')+'\n'+a.samples.map((p,i)=>[p.t,...rs.map(r=>r.samples[i]?.damage??'')].join(',')).join('\n'),'text/csv');
  $('#export-json').onclick=()=>download('卫戍协议-计算结果.json',JSON.stringify({version:VERSION,results:rs},null,2),'application/json');
}
function download(name,content,type) { const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
async function run() {
  if(busy)return;
  const invalid=[...document.querySelectorAll('input[type=number]')].find(el=>!el.checkValidity()||el.value==='');
  if(invalid){invalid.reportValidity();showNotice('请填写有效的测试条件。',true);return;}
  busy=true;$('#run').disabled=true;$('#run').textContent='正在计算…';$('#result-state').textContent='逐帧模拟中';
  $('#results').classList.add('stale');
  const snapshot=JSON.stringify(state),input=structuredClone(state);
  try {
    $('#result-state').textContent='逐帧模拟中…';
    const computed=await runner.run({mode:'single',versionId:VERSION.id,configs:input.configs,target:input.target});
    if(JSON.stringify(state)!==snapshot){busy=false;$('#run').disabled=false;$('#run').textContent='计算全部方案';$('#result-state').textContent='配置已修改，请重新计算';return;}
    results=computed;renderResults(results);
    busy=false;$('#run').disabled=false;$('#run').textContent='计算全部方案';
    const stale=JSON.stringify(state)!==snapshot;
    $('#results').classList.toggle('stale',stale);
    $('#result-state').textContent=stale?'配置已修改，请重新计算':`${results[0].target.duration} 秒 · 同种子可复算`;
    showNotice('结果来自固定版本复刻引擎。原版为核对目标；当前结果不等于官方实测。');
  } catch(error){finishError(error.message||'计算失败，请刷新页面重试。');}
}
function finishError(message) {busy=false;$('#run').disabled=false;$('#run').textContent='重新计算';$('#result-state').textContent='本次计算失败';showNotice(message,true);}
$('#run').addEventListener('click',run);
$('#reset-plans').addEventListener('click',()=>{
  state=defaultState();
  active=0;
  const url=new URL(location.href);
  if(new URLSearchParams(url.hash.slice(1)).has('config')) {
    url.hash=`config=${encodedState()}`;
    history.replaceState(null,'',url);
  }
  markChanged();renderTarget();renderConfig();
  showNotice('已载入默认方案与测试条件。');
  if(!busy)run();
});
$('#team-link').addEventListener('click',event=>{event.preventDefault();location.href=`./team.html#from=${encodedState()}`;});
$('#share').addEventListener('click',async()=>{
  const url=new URL(location.href);url.hash=`config=${encodedState()}`;
  try {await navigator.clipboard.writeText(url.href);showNotice('配置链接已复制，包含规则版本、各方案与测试条件。');}
  catch {location.hash=url.hash;showNotice('浏览器未允许自动复制。配置已写入地址栏，请复制当前网址。');}
});
$('#theme').addEventListener('click',()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem('stronghold-theme',document.documentElement.dataset.theme);}catch{}});
try{document.documentElement.dataset.theme=localStorage.getItem('stronghold-theme')||'light';}catch{}
$('#version').textContent=VERSION.label;
$('#source-version').textContent=`数据快照 ${VERSION.captured} · 引擎 ${VERSION.engine.upstream.slice(0,7)}`;
if (calculator.supportsArcaneCoverage) {
  $('#arcane-method').textContent = '奥术按全程覆盖结算，3 人档采用半血以下的强化增幅。';
  $('#prts-source').href = 'https://prts.wiki/w/卫戍协议：盟约_下半/PRTS盟约记录';
}
$('#engine-source').href=`https://github.com/sganggs/Stronghold-Protocol/tree/${VERSION.engine.upstream}/server/sim`;
try {
  try { for(const c of state.configs) {catalog.resolve(c);if(c.bonds.some(b=>!data.bonds[b.id]))throw new Error('盟约不存在');} }
  catch {state=defaultState();loadWarning='保存的干员配置无效，已恢复默认。';}
  if(state.configs.some(c=>c.items.some(id=>!catalog.isCombatItem(id))))loadWarning='旧配置含消耗品或不可获得的进阶装备，请在装备栏更换后重新计算。';
  renderTarget();renderConfig();$('#run').disabled=false;
  showNotice(loadWarning||'固定版本打靶模拟。可编辑各方案，再点击计算；完整规则边界见页面下方。',!!loadWarning);
  if(!loadWarning)run();
} catch(error){showNotice(error.message,true);}
