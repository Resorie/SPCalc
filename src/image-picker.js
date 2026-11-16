const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Native dialog provides focus trapping and Escape. Choices remain named buttons, usable without images.
export function createImagePicker(renderIcon) {
  const entries = new Map();
  let current, returnKey;
  const dialog = document.createElement('dialog');
  dialog.className = 'image-picker';
  dialog.setAttribute('aria-labelledby','picker-title');
  dialog.innerHTML = `<div class="picker-shell"><header><h2 id="picker-title"></h2><button type="button" class="picker-close" aria-label="关闭选择器">×</button></header><div class="picker-toolbar"><input type="search" id="picker-search" aria-label="搜索名称" placeholder="输入名称筛选，也可以直接识图选择" autocomplete="off"><span id="picker-count" aria-live="polite"></span></div><div class="picker-grid"></div></div>`;
  document.body.append(dialog);
  const search = dialog.querySelector('input');
  const grid = dialog.querySelector('.picker-grid');
  const normalize = s => String(s).normalize('NFKC').toLowerCase();
  function draw() {
    const query = normalize(search.value.trim());
    const filtered = current.options.map((o,index)=>({o,index})).filter(({o})=>normalize(o[1]).includes(query));
    dialog.querySelector('#picker-count').textContent = `${filtered.length} 项`;
    grid.innerHTML = filtered.length ? filtered.map(({o,index})=>`<button type="button" class="picker-choice" data-choice="${index}" ${o[2] ? 'disabled' : ''} aria-pressed="${String(o[0])===String(current.value)}">${renderIcon(current.name,o[0],o[1])}<span>${escape(o[1])}</span></button>`).join('') : '<p class="picker-empty">没有匹配的条目，请换个关键词。</p>';
    grid.scrollTop = 0;
  }
  document.addEventListener('click',event=>{
    const trigger=event.target.closest('[data-picker]');
    if(!trigger)return;
    returnKey=trigger.dataset.picker;
    current=entries.get(returnKey);
    if(!current)return;
    dialog.querySelector('h2').textContent=`选择${current.label}`;
    search.value='';draw();dialog.showModal();search.focus();
  });
  search.addEventListener('input',draw);
  dialog.querySelector('.picker-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  dialog.addEventListener('close',()=>document.querySelector(`[data-picker="${returnKey}"]`)?.focus());
  grid.addEventListener('click',event=>{
    const button=event.target.closest('[data-choice]');
    if(!button || button.disabled)return;
    const choice=current.options[Number(button.dataset.choice)];
    const control=document.querySelector(`[data-picker-control="${returnKey}"]`);
    dialog.close();
    if(control){control.value=choice[0];control.dispatchEvent(new Event('change',{bubbles:true}));}
  });
  return {
    clear() { entries.clear(); },
    field(label,name,options,value,attr='') {
      const index=attr.match(/data-index="(\d+)"/)?.[1]||'';
      const key=`${name}:${index}`;
      const selected=options.find(o=>String(o[0])===String(value));
      const text=selected?.[1]||'请选择';
      entries.set(key,{label,name,options,value});
      return `<div class="field"><span>${escape(label)}</span><button type="button" class="picker-trigger" data-picker="${key}" aria-label="选择${escape(label)}，当前${escape(text)}" aria-haspopup="dialog">${renderIcon(name,value,text)}<span class="picker-selected">${escape(text)}</span><span class="picker-chevron" aria-hidden="true">⌄</span></button><select hidden aria-hidden="true" tabindex="-1" name="${name}" data-picker-control="${key}" ${attr}>${options.map(([v,l,disabled])=>`<option value="${escape(v)}" ${disabled ? 'disabled' : ''} ${String(v)===String(value)?'selected':''}>${escape(l)}</option>`).join('')}</select></div>`;
    },
  };
}
