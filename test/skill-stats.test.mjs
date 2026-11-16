import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skillWindowStats } from '../src/skill-stats.js';
const start = t => ({kind:'skillStart',t});
const end = t => ({kind:'skillEnd',t});
test('multiple windows use summed damage and duration, with end excluded',()=>{
  const r=skillWindowStats([start(2),end(4),start(7),end(10)],new Map([[1,999],[2,100],[3,100],[4,999],[7,300],[9,500],[10,999]]),12);
  assert.equal(r.duration,5);assert.equal(r.damage,1000);assert.equal(r.dps,200);
});
test('ongoing skill is clipped at trial end; instant or absent skills have no DPS',()=>{
  assert.deepEqual(skillWindowStats([start(8)],new Map([[8,100],[9,100],[10,999]]),10),{duration:2,damage:200,dps:100,intervals:[[8,10]]});
  for(const events of [[],[start(2),end(2)]])assert.equal(skillWindowStats(events,new Map([[2,100]]),10).dps,null);
});
