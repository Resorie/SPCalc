import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadRuleset } from '../src/rulesets.js';
import { createCalculator } from '../src/engine.js';
// This mirror snapshot supplies the Covenant index. Regulation assets use the verified official client.
const pack = await loadRuleset({ versionId: 'act2autochess-v2_2', readText: u => readFile(u, 'utf8') });
const { catalog } = await createCalculator(pack);
const sources = {
  characters: { repository: 'yuanyan3060/ArknightsGameResource', commit: 'f925fd75438a885a9e0220fed06d0a9b94701bc3' },
  activity: { repository: 'ArknightsAssets/ArknightsAssets2', commit: '3524c85611e82890367c9e65453b2495e3c39074' },
};
const root = new URL('../assets/icons/', import.meta.url);
let previous = {};
try { previous = JSON.parse(await readFile(new URL('index.json', root), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const index = { schema: 1, sources, operators: {...previous.operators}, items: {...previous.items}, bonds: {...previous.bonds}, files: {...previous.files} };
const chars = [...new Set([...catalog.presets.map(c=>c.charId),...catalog.picks(5).map(c=>c.charId),...catalog.picks(6).map(c=>c.charId)])];
const jobs = [];
const raw = (source, path) => `https://raw.githubusercontent.com/${source.repository}/${source.commit}/${path.split('/').map(encodeURIComponent).join('/')}`;
for (const charId of chars) {
  const path = `operators/${charId}.png`;
  index.operators[charId] = path;
  jobs.push({ path, url: raw(sources.characters, `avatar/${charId}.png`) });
}
for (const item of catalog.equipment) {
  const path = `items/${item.iconId}.png`;
  index.items[item.id] = path;
  if (!jobs.some(j=>j.path===path)) jobs.push({ path, url: raw(sources.activity, `assets/dyn/ui/autochess/[uc]autochesscommon/arts/shopitemicon/${item.iconId}.png`) });
}
for (const bond of Object.values(pack.data.bonds)) {
  const path = `bonds/${bond.iconId.toLowerCase()}.png`;
  index.bonds[bond.bondId] = path;
  jobs.push({ path, url: raw(sources.activity, `assets/dyn/ui/autochess/[uc]autochesscommon/arts/bondicon/${bond.iconId.toLowerCase()}.png`) });
}
for (const dir of ['operators','items','bonds']) await mkdir(new URL(`${dir}/`,root),{recursive:true});
let completed=0;
const errors=[];
async function download(job) {
  let bytes;
  try { bytes = await readFile(new URL(job.path,root)); } catch {}
  if (!bytes) {
    for (let attempt=0;attempt<3;attempt++) {
      try {
        const response=await fetch(job.url,{signal:AbortSignal.timeout(20000)});
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        bytes=Buffer.from(await response.arrayBuffer());
        if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('Not a PNG');
        await writeFile(new URL(job.path,root),bytes);break;
      }catch(error){if(attempt===2){errors.push(`${job.path}: ${error.message}`);return;}}
    }
  }
  index.files[job.path]={source:previous.files?.[job.path]?.source || job.url,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
  completed++;
  if(completed%40===0)console.log(`Icons: ${completed}/${jobs.length}`);
}
let cursor=0;
await Promise.all(Array.from({length:6},async()=>{while(cursor<jobs.length)await download(jobs[cursor++]);}));
if(errors.length)throw new Error(errors.join('\n'));
await writeFile(new URL('index.json',root),JSON.stringify(index,null,2)+'\n');
console.log(`Saved ${completed} icons (${Object.values(index.files).reduce((n,f)=>n+f.bytes,0)} bytes), all PNGs verified.`);
