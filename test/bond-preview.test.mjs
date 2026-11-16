import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {describeBond} from '../src/adapters/stronghold-bond-preview.js';
const bonds=JSON.parse(await readFile(new URL('../data/act2autochess-v2_2/bonds.json',import.meta.url),'utf8'));
const calc=(id,layers,count=3)=>describeBond(bonds[id],{layers,count});
test('Siracusa displays real attack speed, duration and proc damage',()=>{
 const r=calc('siracusaShip',100,6);assert.deepEqual(Object.values(r.values).map(v=>v.value),[105,72,10000]);assert.ok(r.rows.every(r=>!r.unmet));
 assert.ok(calc('siracusaShip',100,3).rows[1].unmet);
});
test('Kazimierz value describes a cap, not a fully stacked bonus',()=>{
 const r=calc('kazimierzShip',700,6);assert.equal(r.values[0].value,7.5);assert.match(r.rows[0].text,/至多/);
});
test('probabilities cap at 100%, milestones reflect current layers',()=>{
 for(const id of ['swiftShip','indomShip','miraShip'])assert.equal(calc(id,999).values[0].value,1);
 assert.ok(calc('raidShip',49).rows[1].unmet);assert.equal(calc('raidShip',50).rows[1].unmet,null);
});
test('all declared placeholders resolve from version data, including fractional values',()=>{
 for(const rec of Object.values(bonds)){
  const r=calc(rec.bondId,1);
  for(const match of (rec.effectDesc||'').matchAll(/\{(\d+):[^}]+\}/g))assert.ok(r.values[match[1]],rec.name);
 }
 assert.equal(calc('siracusaShip',1).values[0].value,25.8);
 assert.equal(calc('yanShip',''),null);
});
