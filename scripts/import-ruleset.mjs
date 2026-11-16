// Import normalized game data exported from upstream or an audited PRTS/official-data conversion.
// No scraping, code download, old-pack overwrite, or change to the active release.
import { readFile, writeFile, mkdir, access, rename, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createCalculator } from '../src/engine.js';
import { defaultState } from '../src/config-state.js';
import { validateManifest } from '../src/rulesets.js';
const [sourceArg, manifestArg, flag] = process.argv.slice(2);
if (!sourceArg || !manifestArg || (flag && flag !== '--check')) {
  console.error('Usage: node scripts/import-ruleset.mjs <normalized-data-dir> <manifest.json> [--check]');
  process.exit(1);
}
const source = resolve(sourceArg);
const manifest = JSON.parse(await readFile(resolve(manifestArg), 'utf8'));
validateManifest(manifest);
const raw = {}, bytes = {};
for (const [name, file] of Object.entries(manifest.files)) {
  bytes[name] = await readFile(join(source, file.path));
  raw[name] = JSON.parse(bytes[name].toString('utf8'));
  file.sha256 = createHash('sha256').update(bytes[name]).digest('hex');
}
const calculator = await createCalculator({ data: raw, manifest });
for (const c of defaultState(manifest).configs) calculator.validate(c, manifest.defaults.target);
if (manifest.defaults.diyCharId && !calculator.catalog.picks(6).some(u=>u.charId===manifest.defaults.diyCharId)) {
  throw new Error('默认自选干员不在当前规则包可用列表中。');
}
if (raw.stages) {
  if (!manifest.defaults.team || !manifest.defaults.teamScene) throw new Error('团队规则包必须声明默认队伍和地图。');
  calculator.validateTeam(manifest.defaults.team, manifest.defaults.target, manifest.defaults.teamScene);
}
if (flag === '--check') {
  console.log(`${manifest.id}: structure, engine compatibility and default configurations checked. No files written.`);
  process.exit(0);
}
const root = new URL('../data/', import.meta.url);
const destination = new URL(`${manifest.id}/`, root);
let exists = false;
try { await access(destination); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (exists) throw new Error('版本目录已存在。旧快照不可覆盖，请使用新的版本 ID。');
const catalogUrl = new URL('catalog.json', root);
const catalog = JSON.parse(await readFile(catalogUrl, 'utf8'));
if (catalog.versions.some(v=>v.id===manifest.id)) throw new Error('版本目录清单已有此 ID。');
const staging = new URL(`.import-${randomUUID()}/`, root);
await mkdir(staging);
try {
  for (const [name, buffer] of Object.entries(bytes)) await writeFile(new URL(`${name}.json`, staging), buffer);
  await writeFile(new URL('manifest.json', staging), JSON.stringify(manifest,null,2)+'\n');
  await rename(staging, destination);
} finally { await rm(staging, { recursive:true, force:true }); }
catalog.versions.push({id:manifest.id,manifest:`./${manifest.id}/manifest.json`});
await writeFile(catalogUrl, JSON.stringify(catalog,null,2)+'\n');
console.log(`${manifest.id}: imported. Active default remains ${catalog.default}; review mechanics and tests before changing it.`);
