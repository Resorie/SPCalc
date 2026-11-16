import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseSceneChunks} from '../src/upstream-render/board3d/load.js';
const root=new URL('../',import.meta.url);
const json=async p=>JSON.parse(await readFile(new URL(p,root),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('vendored renderer modules and libraries retain their pinned bytes',async()=>{
 const renderer=await json('src/upstream-render/provenance.json');
 for(const [name,digest] of Object.entries(renderer.files))assert.equal(hash(await readFile(new URL('src/upstream-render/'+name,root))),digest,name);
 const libs=await json('vendor/render-libraries.json');for(const file of libs.files)assert.equal(hash(await readFile(new URL(file.path,root))),file.sha256,file.path);
});
test('all eight enabled maps have complete parseable upstream scene packs with verified local assets',async()=>{
 const base='assets/board/upstream/',manifest=await json(base+'manifest.json'),provenance=await json(base+'provenance.json'),maps=await json('data/act2autochess-v2_2-team1/stages.json');
 for(const [name,file] of Object.entries(provenance.files)){const bytes=await readFile(new URL(base+name,root));assert.equal(hash(bytes),file.sha256,name);assert.equal(bytes.length,file.bytes,name);}
 for(const id of Object.keys(maps)){
  const g=manifest.groups['scene/'+id];assert.ok(g?.scene&&g?.bin,id);
  const path=key=>base+g[key].path.replace('/assets/local/','');const doc=await json(path('scene')),bytes=await readFile(new URL(path('bin'),root));
  const chunks=parseSceneChunks(doc,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));assert.ok(chunks?.length,id);
  for(let i=0;i<doc.lightmaps;i++)assert.ok(g['lm'+i],id+' lightmap '+i);
  for(const m of Object.values(doc.materials))for(const key of ['map','normalMap','glossMap','emissionMap'])if(m[key])assert.ok(manifest.groups['scene/tex'][m[key]],id+' '+m[key]);
 }
});
