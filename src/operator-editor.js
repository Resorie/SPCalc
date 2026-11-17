import { createImagePicker } from './image-picker.js';
import { CLOSURE_CHAR_ID } from './adapters/stronghold-trial-assumptions.js';
export const escape = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const number = (v,d=0)=>Number(v).toLocaleString('zh-CN',{maximumFractionDigits:d,minimumFractionDigits:d});
export const option=(v,l,current)=>`<option value="${escape(v)}" ${String(v)===String(current)?'selected':''}>${escape(l)}</option>`;
export const select=(label,name,opts,value,attr='')=>`<label class="field"><span>${escape(label)}</span><select name="${name}" aria-label="${escape(label)}" ${attr}>${opts.map(([v,l])=>option(v,l,value)).join('')}</select></label>`;
export const numeric=(label,name,v,min,max,attr='')=>`<label class="field"><span>${escape(label)}</span><input type="number" step="any" name="${name}" aria-label="${escape(label)}" value="${escape(v)}" min="${min}" max="${max}" ${attr}></label>`;
export function diyOperatorOptions(catalog, tier) {
  return [
    ...catalog.picks(tier).map(op => [op.charId, op.name]),
    ...catalog.unavailablePicks.map(op => [op.charId, `${op.name} · 暂无战斗实现`, true]),
  ];
}
export function moduleField(config, rec, catalog, lock) {
  const modules = catalog.modules(config);
  if (!modules.length && !lock) return '';
  const options = [['none', '不携带模组'], ...modules.map(m => [
    m.uniEquipId, `${m.typeName} · ${m.name}${m.isDefault && !config.diy ? '（活动默认）' : ''}`,
  ])];
  const chosen = config.diy
    ? config.diy.uniEquipId ?? lock?.uniEquipId ?? 'none'
    : config.moduleId ?? modules.find(m => m.isDefault)?.uniEquipId ?? 'none';
  const field = select('携带模组', config.diy ? 'uniEquipId' : 'moduleId', options, chosen, lock ? 'disabled' : '');
  return field + (rec.isGolden ? '' : '<p class="field-note">所选模组在精锐状态生效。</p>');
}

export function closureBlockBonusField(config, rec) {
  if (rec.charId !== CLOSURE_CHAR_ID) return '';
  const choices = [['auto', '按实际阻挡'], ['on', '手动开启（全程）'], ['off', '手动关闭']];
  return select('援军阻挡加成', 'closureBlockBonus', choices, config.closureBlockBonus ?? 'auto') +
    '<p class="field-note">手动开启时，可露希尔每次攻击都按战术家特性的 150% 攻击力结算。援军标记、索敌范围和实际阻挡依照战场状态。</p>';
}

export function createOperatorEditor({root,data,catalog,icons,ownBonds,defaultConfig,onChange}) {
  let current;
  const iconMarkup=(kind,id,name='',badge='')=>{
    const path=icons[kind]?.[id];return `<span class="icon-frame icon-${kind}${path?'':' missing'}">${path?`<img src="./assets/icons/${escape(path)}" alt="" width="42" height="42" loading="lazy">`:`<span class="icon-fallback">${escape(name[0]||'—')}</span>`}${badge?`<span class="icon-level">${escape(badge)}</span>`:''}</span>`;
  };
  const picker=createImagePicker((name,value,label)=>(name==='operator'||name==='addOperator')?iconMarkup('operators',data.chess[value]?.charId,label):name==='diyOperator'?iconMarkup('operators',value,label):name==='addBond'?iconMarkup('bonds',value,label):iconMarkup('items',value,label));
  const imageSelect=(...args)=>picker.field(...args);
  const operatorOptions=()=>catalog.presets.map(c=>[c.chessId,`${['','Ⅰ','Ⅱ','Ⅲ','Ⅳ','Ⅴ','Ⅵ'][c.tier]}阶 · ${c.name}`]);
  function render(c) {
    current=c;picker.clear();const rec=catalog.resolve(c);
  const base = rec.baseId;
  const equipment = [['','不装备'], ...catalog.equipment.map(i=>[i.id,`${i.name}${i.isGolden?' · 进阶':''}`]),
    ...c.items.filter(id=>!catalog.isCombatItem(id)).map(id=>[id,`${data.items[id]?.name || id}（不可携带，请更换）`])];
  const lock = catalog.lock(c);
  const skills = (rec.skills?.length ? rec.skills : [rec.skill].filter(Boolean)).filter(s=>!lock || s.index === lock.skillIndex);
  const selectedSkill = skills.find(s=>s.index===Number(c.skillIndex)) || rec.skill;
  const tag = ownBonds(rec,c.items).map(id=>`<span class="badge">${iconMarkup('bonds',id,data.bonds[id]?.name)}${escape(data.bonds[id]?.name || id)}${rec.bonds.includes(id)?'':' · 转职'}</span>`).join('');
  root.innerHTML = `
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
    <p class="field-note">百分比加攻与同类增益相加；攻速填点数。基础固定值先参与百分比加成，后加固定值随后加入，最后乘独立倍率及培养系数。这栏直接指定全程属性；队友的实际治疗与站位联动由团队布阵另行结算。</p>
    ${closureBlockBonusField(c,rec)}
    <div class="config-subheading"><h3>携带装备</h3><span class="subtle">最多 2 件战斗装备</span></div>
    ${imageSelect('装备一','item0',equipment,c.items[0]||'')}<p class="item-desc">${escape(data.items[c.items[0]]?.desc || '选择装备，查看效果。')}</p>
    ${imageSelect('装备二','item1',equipment,c.items[1]||'')}<p class="item-desc">${escape(data.items[c.items[1]]?.desc || '选择装备，比较团队联动与输出。')}</p>
    <p class="field-note">使用后销毁的道具不占战斗装备栏。盟约层数、晋升等结果请直接填写；此处不模拟休整期。</p>
`;
  }
  root.addEventListener('input',event=>{
    const el=event.target;if(el.name?.startsWith('ext_')){(current.external??={})[el.name.slice(4)]=el.value===''?'':Number(el.value);onChange(false);}
  });
  root.addEventListener('change',event=>{
    const el=event.target,c=current,name=el.name;if(!name||name.startsWith('ext_'))return;
    if(name==='mode'){
      delete c.moduleId;
      if(el.value==='diy')Object.assign(c,catalog.defaultDiy(6,true));
      else {c.chessId=defaultConfig.chessId;c.skillIndex=defaultConfig.skillIndex;delete c.diy;}
    }else if(name==='diyOperator'||name==='diyTier'){
      const old=catalog.resolve(c);Object.assign(c,catalog.defaultDiy(name==='diyTier'?Number(el.value):old.tier,old.isGolden,name==='diyOperator'?el.value:c.diy.charId));
    }else if(name==='uniEquipId')c.diy.uniEquipId=el.value==='none'?null:el.value;
    else if(name==='moduleId')c.moduleId=el.value;
    else if(name==='closureBlockBonus')c.closureBlockBonus=el.value;
    else if(name==='operator'||name==='elite'){
      const old=catalog.resolve(c),base=data.chess[name==='operator'?el.value:old.baseId];
      c.chessId=(name==='elite'?Number(el.value):old.isGolden)?base.goldenId:base.chessId;
      if(name==='operator') {
        delete c.moduleId;
        c.skillIndex=data.chess[c.chessId].skill?.index??0;
      }
    }else if(name==='item0'||name==='item1')c.items=[root.querySelector('[name=item0]').value,root.querySelector('[name=item1]').value].filter(Boolean);
    else c[name]=Number(el.value);
    render(c);onChange(true);
  });
  return {render,iconMarkup,imageSelect};
}
