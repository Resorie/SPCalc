import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadRuleset, rulesKey } from '../src/rulesets.js';
import { createCalculator } from '../src/engine.js';
import { defaultState, restoreState } from '../src/config-state.js';
import { defaultTeamState, restoreTeamState } from '../src/team-state.js';
import { MAX_TARGET_HP, resetTargetPanel } from '../src/trial-targets.js';
import { parseSceneChunks, SCENE_VERSION } from '../src/upstream-render/board3d/load.js';

const readText = url => readFile(url, 'utf8');
const pack = await loadRuleset({ readText });
const { manifest, data } = pack;
const engine = await createCalculator(pack);
const { target, scene, configs: [team] } = defaultTeamState(manifest);
const root = new URL('../', import.meta.url);
const json = async path => JSON.parse(await readText(new URL(path, root)));

test('both modes default to Regulation while the Covenant share-link rules stay pinned', async () => {
  assert.equal(manifest.id, 'act3autochess-v3_1');
  assert.equal((await loadRuleset({ mode: 'team', readText })).manifest.id, manifest.id);
  const old = await loadRuleset({ versionId: 'act2autochess-v2_2', readText });
  assert.equal(old.manifest.engine.id, 'stronghold-f07b896');
  assert.equal((await loadRuleset({ mode: 'team', fromSingle: old.manifest.id, readText })).manifest.id, 'act2autochess-v2_2-team1');
  assert.equal((await loadRuleset({ mode: 'team', fromSingle: manifest.id, readText })).manifest.id, manifest.id);
  assert.equal(engine.catalog.presets.length, 141);
  assert.equal(Object.keys(data.bonds).length, 26);
  const defaults = defaultState(manifest);
  for (const config of defaults.configs) assert.ok(engine.simulate(config, defaults.target).total > 0);
  const restored = restoreTeamState(JSON.parse(JSON.stringify(defaultTeamState(manifest))), manifest);
  assert.equal(restored.rules, rulesKey(manifest));
  assert.deepEqual(restored.configs[0], team);
});

test('Regulation Arcane fires from member damage and stacks resistance reduction without legacy coverage', () => {
  const logos = { ...manifest.defaults.config, chessId: 'chess_char_6_08_b' };
  const arts = count => engine.simulate({ ...logos, bonds: count ? [{ id: 'arcaneShip', count, layers: 100 }] : [] }, target);
  const [base, rider, resistance] = [0, 2, 3].map(arts);
  assert.ok(resistance.total > rider.total && rider.total > base.total);
  assert.deepEqual(resistance.assumptions, []);
  assert.equal(engine.supportsArcaneCoverage, false);
  assert.equal(engine.catalog.describeBond({ id: 'arcaneShip', count: 3, layers: 100 }).values[1].value, -35);
});

test('Regulation formation shares healing in battle and tracks re-deployments', () => {
  const full = engine.simulateTeam(team, target, scene);
  const noHealer = engine.simulateTeam({ ...team, members: team.members.filter(m => m.uid !== 3) }, target, scene);
  assert.ok(full.diagnostics.healing.some(e => e.sourceUid === 3 && e.targetUid === 2));
  assert.ok(full.damageByOperator.find(o => o.uid === 2).damage > noHealer.damageByOperator.find(o => o.uid === 2).damage);
  assert.ok(Math.abs(full.damageByOperator.reduce((sum, o) => sum + o.damage, full.unattributedDamage) - full.total) < 1e-5);
  const raid = engine.simulateTeam({
    ...team, members: [team.members[1]], bonds: [{ id: 'raidShip', count: 2, layers: 150 }], assumptions: { raid: true },
  }, target, scene);
  assert.ok(raid.timeline.some(e => e.kind === 'raidDeploy' && e.t > 0 && e.uid === 2));
});

test('all ten Regulation maps have valid 5×3 targets and complete upstream scenes', async () => {
  assert.equal(engine.teamMaps.length, 10);
  const base = `assets/board/${manifest.boardSet}/`;
  const { groups } = await json(base + 'manifest.json');
  const { files } = await json(base + 'provenance.json');
  for (const { id } of engine.teamMaps) {
    const board = engine.teamBoard(id, { ...scene, stageId: id });
    assert.ok(board.canTarget(scene.targetRow, scene.targetCol), id);
    assert.equal(board.target.keys.length, 15, id);
    const art = groups[`scene/${id}`];
    const path = key => base + art[key].path.replace('/assets/local/', '');
    const doc = await json(path('scene'));
    assert.equal(doc.version, SCENE_VERSION, id);
    const bytes = await readFile(new URL(path('bin'), root));
    assert.ok(parseSceneChunks(doc, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))?.length, id);
    for (let i = 0; i < doc.lightmaps; i++) assert.ok(art['lm' + i], id);
    for (const m of Object.values(doc.materials)) {
      for (const key of ['map','normalMap','glossMap','emissionMap']) {
        if (m[key]) assert.ok(groups['scene/tex'][m[key]], `${id}: ${m[key]}`);
      }
    }
  }
  for (const [name, file] of Object.entries(files)) {
    const bytes = await readFile(new URL(base + name, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, name);
  }
});

test('new item IDs resolve against the Regulation art mapping', async () => {
  const icons = await json(`assets/icons/${manifest.iconSet}.json`);
  for (const item of engine.catalog.equipment) assert.equal(icons.items[item.id]?.split('/').at(-1), item.iconId.toLowerCase() + '.png');
  for (const op of engine.catalog.presets) assert.ok(icons.operators[op.charId], op.name);
  for (const bond of Object.values(data.bonds)) assert.ok(icons.bonds[bond.bondId], bond.name);
  for (const [path, record] of Object.entries(icons.files)) {
    const bytes = await readFile(new URL('assets/icons/' + path, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256, path);
  }
});

test('both equipment slots apply identical stat items and scope copies in solo and team trials', () => {
  const config = { ...manifest.defaults.configs[0], moduleId: 'none', cultivate: 0, bonds: [], items: [] };
  const trial = { ...target, duration: 2, distance: 3 };
  const point = { ...scene, targetShape: 'point', targetRow: 4, targetCol: 8 };
  const runSolo = items => {
    const result = engine.simulate({ ...config, items }, trial);
    return { atk: result.opening.atk, firstDamage: result.hits[0]?.amount };
  };
  const runTeam = items => {
    const result = engine.simulateTeam({ ...team, bonds: [],
      members: [{ uid: 1, row: 4, col: 5, dir: 'RIGHT', config: { ...config, items } }],
    }, trial, point);
    return { atk: result.openings[0].atk, firstDamage: result.hits[0]?.amount };
  };
  for (const run of [runSolo, runTeam]) {
    const base = run([]);
    const normalScope = run(['chess_item_3_02_e_a', 'chess_item_3_02_e_a']);
    const eliteScope = run(['chess_item_3_02_e_b', 'chess_item_3_02_e_b']);
    const heavyBlades = run(['chess_item_3_06_e_a', 'chess_item_3_06_e_a']);
    assert.ok(base.firstDamage > 0);
    assert.ok(Math.abs(normalScope.firstDamage / base.firstDamage - 1.69) < 1e-6);
    assert.ok(Math.abs(eliteScope.firstDamage / base.firstDamage - 2.25) < 1e-6);
    assert.equal(normalScope.atk, base.atk);
    assert.equal(eliteScope.atk, base.atk);
    assert.ok(Math.abs(heavyBlades.atk / base.atk - 1.8) < 1e-9);
  }
});

test('default comparison loads the three shared caster builds independently', () => {
  const { configs, target } = defaultState(manifest);
  assert.deepEqual(configs.map(c => [engine.catalog.resolve(c).name, engine.catalog.resolve(c).skill.name]),
    [['艾雅法拉', '火山'], ['艾雅法拉', '点燃'], ['逻各斯', '延异视阈']]);
  assert.deepEqual(target, { bossId: 'boss_12', hp: 4150000, def: 800, res: 30, duration: 60, count: 1, distance: 1, seed: 1, rank: 'BOSS', weight: 9, motion: 'WALK' });
  for (const c of configs) {
    assert.deepEqual(c.items, []);
    assert.deepEqual(c.bonds.map(b => [b.id, b.count, b.layers]),
      [['lethaniaShip',3,500],['arcaneShip',3,300],['preciShip',3,400],['skillfulShip',2,150],['visiShip',2,150]]);
  }
  configs[0].bonds[0].layers = 0;
  assert.equal(configs[1].bonds[0].layers, 500);
});

test('solo Skillful covers nonmembers even when a saved plan has the obsolete opt-out', () => {
  const { configs, target: targetDefaults } = defaultState(manifest);
  const target = { ...targetDefaults, hp: MAX_TARGET_HP };
  const eyja = configs[1];
  for (const config of configs) {
    const result = engine.simulate(config, target);
    assert.deepEqual(result.assumptions.find(a => a.kind === 'skillfulCoverage'),
      { kind: 'skillfulCoverage', layers: 150, aspd: 160 });
  }
  const legacy = structuredClone(eyja);
  legacy.bonds.find(b => b.id === 'skillfulShip').assumeAdjacent = false;
  const withoutSkillful = eyja.bonds.filter(b => b.id !== 'skillfulShip');
  const baseline = engine.simulate({ ...eyja, bonds: withoutSkillful }, target);
  const withAura = engine.simulate(eyja, target);
  assert.equal(baseline.opening.interval, 1.6);
  assert.ok(Math.abs(withAura.opening.interval - 1.6 / 2.6) < 1e-9);
  assert.ok(withAura.activations > baseline.activations);
  assert.equal(engine.simulate(legacy, target).total, withAura.total);

  const member = { ...eyja, chessId: 'chess_char_6_20_a', skillIndex: 2 };
  const native = engine.simulate(member, target);
  const directBuff = engine.simulate({ ...member, bonds: withoutSkillful, external: { aspd: 160 } }, target);
  assert.equal(native.opening.interval, directBuff.opening.interval);
  assert.ok(!native.assumptions.some(a => a.kind === 'skillfulCoverage'));
});

test('Ignition blocks natural and module SP during recovery and leaves room for normal attacks', () => {
  const config = { ...manifest.defaults.configs[1], moduleId: 'none', bonds: [] };
  const frames = result => result.timeline.map(e => [e.kind, Math.round(e.t * 30)]);
  const base = engine.simulate(config, target);
  assert.deepEqual(frames(base).slice(0, 6), [
    ['skillStart', 0], ['skillEnd', 36], ['skillStart', 48], ['skillEnd', 84], ['skillStart', 288], ['skillEnd', 324],
  ]);
  // Four normal attacks between the second and third cast, one hit each.
  assert.deepEqual(base.hits.filter(h => h.t >= 3.2 && h.t < 9.6).map(h => Math.round(h.t * 30)), [98, 146, 194, 242]);
  assert.ok(base.skillWindow.dps > 0);
  assert.equal(base.assumptions.find(a => a.kind === 'igniteRecovery').capFrames, 36);

  const ccrY = engine.simulate({ ...config, moduleId: 'uniequip_003_amgoat' }, target);
  const starts = result => result.timeline.filter(e => e.kind === 'skillStart').map(e => Math.round(e.t * 30));
  assert.deepEqual(starts(ccrY).slice(0, 3), [0, 48, 192]);
});

test('Swift conversion adds membership, contributes to team count and grants the extra skill-end refund', () => {
  const morph = 'chess_item_6_03_e_a', ration = 'chess_item_3_04_e_b';
  const config = { ...manifest.defaults.configs[0], bonds: [{ id: 'swiftShip', count: 2, layers: 300 }], items: [ration] };
  const rec = engine.catalog.resolve(config);
  const converted = { ...config, items: [morph, ration] };
  assert.ok(!engine.ownBonds(rec, config.items).includes('swiftShip'));
  assert.ok(engine.ownBonds(rec, converted.items).includes('swiftShip'));
  assert.ok(engine.ownBonds(rec, [ration, morph]).includes('swiftShip'));
  const member = { uid: 1, row: 4, col: 5, dir: 'RIGHT', config: converted };
  const native = { uid: 2, row: 4, col: 6, dir: 'RIGHT',
    config: { ...config, chessId: 'chess_char_6_02_a', items: [] } };
  const counted = members => engine.teamBonds({ members, bonds: [] }).swiftShip;
  assert.equal(counted([member]).actualCount, 1);
  assert.equal(counted([member]).active, false);
  assert.equal(counted([member, native]).actualCount, 2);
  assert.equal(counted([member, native]).active, true);

  const starts = c => engine.simulate(c, { ...target, duration: 120 }).timeline
    .filter(e => e.kind === 'skillStart').map(e => e.t);
  const [baseFirst, baseSecond] = starts(config);
  const [convertedFirst, convertedSecond] = starts(converted);
  assert.equal(convertedFirst, baseFirst);
  assert.ok(Math.abs(baseSecond - convertedSecond - 12) < 1e-9);
});

test('fast Ignition ends before the next swing and Swift can fund that swing in both modes', () => {
  const config = { ...manifest.defaults.configs[1], moduleId: 'none', bonds: [], external: { aspd: 100 } };
  const swift = [{ id: 'swiftShip', count: 2, layers: 300 }];
  const short = { ...target, duration: 4 };
  const fast = engine.simulate({ ...config, bonds: swift }, short);
  const frames = result => result.timeline.map(e => [e.kind, Math.round(e.t * 30)]);
  assert.deepEqual(frames(fast).slice(0, 5), [
    ['skillStart', 0], ['skillEnd', 24], ['skillStart', 24], ['skillEnd', 48], ['skillStart', 48],
  ]);
  assert.equal(fast.activations, 5);

  const formed = engine.simulateTeam({
    ...team, members: [{ uid: 1, row: 4, col: 5, dir: 'RIGHT', config }], bonds: swift,
  }, short, scene);
  assert.deepEqual(frames(formed), frames(fast));
  assert.equal(formed.assumptions.find(a => a.kind === 'igniteRecovery').uid, 1);
});

test('default Logos reports Swift skill-end SP separately from rations and misses', () => {
  const { configs: [, , logos], target: dummy } = defaultState(manifest);
  const ration = 'chess_item_3_04_e_b', morph = 'chess_item_6_03_e_a';
  const simulate = (items, layers) => engine.simulate({
    ...logos, items, bonds: layers === null
      ? logos.bonds
      : [...logos.bonds, { id: 'swiftShip', count: 2, layers }],
  }, dummy);
  const refunds = result => result.swiftRefunds?.map(event => event.amount);
  const [off, miss, native, converted] = [
    simulate([ration, morph], null), simulate([ration, morph], 20),
    simulate([ration], 229), simulate([ration, morph], 229),
  ];
  assert.equal(off.swiftRefunds, null);
  assert.deepEqual(refunds(miss), []);
  assert.deepEqual(refunds(native), [15]);
  assert.deepEqual(refunds(converted), [27]);
  assert.equal(converted.swiftRefunds[0].t, converted.timeline.find(event => event.kind === 'skillEnd').t);
  const starts = result => result.timeline.filter(event => event.kind === 'skillStart').map(event => event.t);
  assert.equal(starts(converted)[0], starts(native)[0]);
  assert.ok(starts(converted)[1] < starts(native)[1]);
});

test('Ch’en S3 reads ordinary target HP in solo and team practice and retains its ATK floor', () => {
  const config = { ...manifest.defaults.config,
    ...engine.catalog.defaultDiy(6, true, 'char_1050_chen3'), skillIndex: 2, items: [], bonds: [] };
  const dummy = { ...manifest.defaults.target, def: 0, res: 0 };
  const simulateTeam = config => engine.simulateTeam({
    ...team, members: [{ uid: 1, row: 4, col: 8, dir: 'RIGHT', config }], bonds: [],
  }, dummy, scene);
  const firstWave = result => {
    const start = result.timeline.find(event => event.kind === 'skillStart').t;
    const wave = result.hits.find(hit => hit.t === start);
    const priorDamage = result.hits.filter(hit => hit.t < start).reduce((sum, hit) => sum + hit.amount, 0);
    assert.ok(wave);
    return { damage: wave.amount, priorDamage };
  };
  for (const result of [engine.simulate(config, dummy), simulateTeam(config)]) {
    const { damage, priorDamage } = firstWave(result);
    assert.equal(result.assumptions.find(a => a.kind === 'chenSwordWaveHp').referenceHp, 120000);
    assert.ok(Math.abs(damage - 0.06 * 120000 * (1 - priorDamage / dummy.hp)) < 1e-5);
    assert.equal(result.actualDuration, dummy.duration);
  }
  const strong = engine.simulate({ ...config, external: { atkPct: 1000 } }, dummy);
  assert.ok(firstWave(strong).damage > 7200);
  const helmet = engine.bossPresets.find(preset => preset.id === 'boss_8');
  const underHelmet = engine.simulate(config, { ...dummy, ...helmet.target, def: 0, res: 0 });
  assert.equal(underHelmet.assumptions.find(a => a.kind === 'chenSwordWaveHp').referenceHp, 1200000);
  assert.ok(firstWave(underHelmet).damage > 71000 && firstWave(underHelmet).damage < 72000);
});

test('Regulation 20 boss panels use the PRTS final health totals and their own enemy stats', () => {
  assert.deepEqual(Object.fromEntries(engine.bossPresets.map(({ id, target }) => [id, target.hp])), {
    boss_1: 3940000, boss_2: 2250000, boss_3: 4200000, boss_4: 4370000, boss_6: 3700000,
    boss_7: 4040000, boss_8: 6840000, boss_9: 5980000, boss_10: 7220000, boss_11: 3325000,
    boss_12: 4150000, boss_13: 2100000, boss_14: 5225000, boss_15: 7885000, boss_16: 6175000, boss_17: 1950000,
  });
  for (const { id, target } of engine.bossPresets) {
    const enemy = data.enemies[data.bosses[id].enemyKey];
    assert.deepEqual([target.def, target.res, target.weight, target.motion, target.rank],
      [enemy.stats.def, enemy.stats.res, enemy.stats.massLevel, enemy.stats.motion, enemy.rank]);
  }
});

test('custom target HP persists in solo and team, and old links retain the endurance target', () => {
  const states = [[defaultState(manifest), restoreState], [defaultTeamState(manifest), restoreTeamState]];
  for (const [state, restore] of states) {
    delete state.target.hp;
    delete state.target.bossId;
    const legacy = restore(JSON.parse(JSON.stringify(state)), manifest);
    assert.equal(legacy.target.hp, MAX_TARGET_HP);
    assert.equal(legacy.target.bossId, null);
    Object.assign(state.target, { bossId: 'boss_15', hp: 5000000, duration: 39, seed: 42 });
    assert.deepEqual(restore(JSON.parse(JSON.stringify(state)), manifest).target, state.target);
    resetTargetPanel(state.target, manifest);
    assert.equal(state.target.hp, 4150000);
    assert.equal(state.target.bossId, 'boss_12');
    assert.equal(state.target.duration, 39);
    assert.equal(state.target.seed, 42);
  }
});

test('finite HP caps the damage on every target and reports when the last target falls', () => {
  const { configs: [eyja], target: singleTarget } = defaultState(manifest);
  const dummy = { ...singleTarget, hp: 10000, count: 2 };
  const results = [engine.simulate(eyja, dummy), engine.simulateTeam(team, dummy, scene)];
  for (const result of results) {
    assert.ok(result.targetDefeatedAt >= 0 && result.targetDefeatedAt < dummy.duration);
    assert.ok(Math.abs(result.total - 20000) < 1e-6);
    assert.equal(result.samples.at(-1).t, dummy.duration);
    assert.equal(result.dps, result.total / dummy.duration);
  }
  for (const hp of [0, 2.5, Infinity, MAX_TARGET_HP + 1]) {
    assert.throws(() => engine.validate(eyja, { ...dummy, hp }), /靶子生命值/);
  }
});

test('Closure gets the blocked-target bonus only when the reference target can be blocked', () => {
  const config = { chessId: 'chess_char_5_21_b', skillIndex: 2, potential: 6, cultivate: 3,
    items: ['chess_item_6_03_e_a', 'chess_item_3_03_e_b'],
    bonds: [{ id: 'yanShip', count: 3, layers: 500 }, { id: 'skillfulShip', count: 2, layers: 400 }] };
  const legacy = { ...manifest.defaults.target, hp: MAX_TARGET_HP, bossId: null };
  const near = engine.simulate(config, { ...legacy, distance: 1 });
  const far = engine.simulate(config, { ...legacy, distance: 3 });
  const eel = engine.simulate(config, { ...legacy, bossId: 'boss_13', distance: 1 });
  assert.equal(near.hits[0].amount, far.hits[0].amount);
  assert.equal(near.hits.length, far.hits.length + 1);
  assert.ok(Math.abs(eel.hits[0].amount - ((near.hits[0].amount + legacy.def) * 1.5 - legacy.def)) < 1e-6);

  const formation = { ...team, bonds: [], members: [{ uid: 1, row: 3, col: 3, dir: 'RIGHT', config }] };
  const point = { ...scene, stageId: 'act3autochess_m01', targetShape: 'point', targetRow: 3, targetCol: 4 };
  const trial = { ...target, duration: 1, bossId: 'boss_12' };
  const cocoonHit = engine.simulateTeam(formation, trial, point).hits[0].amount;
  const eelHit = engine.simulateTeam(formation, { ...trial, bossId: 'boss_13' }, point).hits[0].amount;
  assert.ok(eelHit > cocoonHit);
});

test('Closure can force the trait on or off without changing targeting, and team overrides are per member', () => {
  const config = { chessId: 'chess_char_5_21_b', skillIndex: 2, potential: 6, cultivate: 3,
    items: ['chess_item_6_03_e_a', 'chess_item_3_03_e_b'],
    bonds: [{ id: 'yanShip', count: 3, layers: 500 }, { id: 'skillfulShip', count: 2, layers: 400 }] };
  const dummy = { ...manifest.defaults.target, duration: 1, distance: 1 };
  const solo = (mode, target = dummy) => engine.simulate({ ...config, closureBlockBonus: mode }, target);
  const [auto, on, off] = [solo(undefined), solo('on'), solo('off')];
  const expected = amount => (amount + dummy.def) * 1.5 - dummy.def;
  assert.ok(Math.abs(on.hits[0].amount - expected(auto.hits[0].amount)) < 1e-6);
  assert.deepEqual(off.hits, auto.hits);
  assert.equal(on.firstHit, auto.firstHit);
  assert.equal(solo('on', { ...dummy, distance: 5 }).total, 0);

  const blockable = { ...dummy, bossId: 'boss_13' };
  assert.deepEqual(solo('off', blockable).hits, auto.hits);
  assert.deepEqual(solo('on', blockable).hits, solo(undefined, blockable).hits);
  assert.equal(on.assumptions.find(a => a.kind === 'closureBlockBonus').enabled, true);
  assert.throws(() => solo('invalid'), /援军阻挡加成/);

  const members = [
    { uid: 1, row: 3, col: 3, dir: 'RIGHT', config: { ...config, closureBlockBonus: 'on' } },
    { uid: 2, row: 2, col: 3, dir: 'RIGHT', config: { ...config, closureBlockBonus: 'off' } },
  ];
  const point = { ...scene, stageId: 'act3autochess_m01', targetShape: 'point', targetRow: 3, targetCol: 4 };
  const formed = engine.simulateTeam({ ...team, bonds: config.bonds, members }, dummy, point);
  const firstHit = uid => formed.hits.find(hit => hit.operatorId === `p1/${uid}`).amount;
  assert.ok(Math.abs(firstHit(1) - expected(firstHit(2))) < 1e-6);
  assert.deepEqual(formed.assumptions.filter(a => a.kind === 'closureBlockBonus').map(a => [a.uid, a.enabled]), [[1, true], [2, false]]);

  const share = { ...defaultState(manifest), configs: [members[0].config] };
  assert.equal(restoreState(JSON.parse(JSON.stringify(share)), manifest).configs[0].closureBlockBonus, 'on');
});

test('preset loadouts affect single and team simulations and keep their defaults for existing links', () => {
  const eyja = { ...defaultState(manifest).configs[0], bonds: [] };
  const alt = { ...eyja, moduleId: 'uniequip_003_amgoat' };
  const none = { ...eyja, moduleId: 'none' };
  const control = engine.simulate(eyja, target);
  assert.equal(engine.simulate({ ...eyja, moduleId: 'uniequip_002_amgoat' }, target).total, control.total);
  assert.notEqual(engine.simulate(alt, target).total, control.total);
  assert.ok(engine.simulate(none, target).opening.atk < control.opening.atk);
  assert.throws(() => engine.validate({ ...eyja, moduleId: 'uniequip_003_logos' }, target), /无法携带/);
  const initial = { ...alt, chessId: 'chess_char_4_02_a' };
  assert.equal(engine.simulate(initial, target).total, engine.simulate({ ...initial, moduleId: undefined }, target).total);

  const runTeam = config => engine.simulateTeam({
    ...team, members: [{ uid: 1, row: 4, col: 5, dir: 'RIGHT', config }],
  }, target, scene);
  assert.notEqual(runTeam(eyja).total, runTeam(alt).total);
  assert.ok(runTeam(none).openings[0].atk < runTeam(alt).openings[0].atk);
  const share = defaultTeamState(manifest);
  share.configs[0].members[0].config = alt;
  assert.equal(restoreTeamState(JSON.parse(JSON.stringify(share)), manifest).configs[0].members[0].config.moduleId, alt.moduleId);
});

test('preset module range changes reach the team board overlay', () => {
  const dusk = { ...manifest.defaults.config, chessId: 'chess_char_6_17_b', skillIndex: 0 };
  const placement = { row: 4, col: 5, dir: 'RIGHT' };
  const range = config => engine.initialRange(engine.catalog.resolve(config), placement);
  assert.ok(range({ ...dusk, moduleId: 'uniequip_002_dusk' }).includes(4 * 21 + 8));
  assert.ok(!range({ ...dusk, moduleId: 'none' }).includes(4 * 21 + 8));
});

test('omitted collaboration picks are identifiable and cannot produce generic results', () => {
  const added = Object.keys(data.collab.units);
  assert.deepEqual(engine.catalog.unavailablePicks.map(op => op.charId), data.backups.diy.excluded.filter(id => !added.includes(id)));
  const config = { ...manifest.defaults.config, ...engine.catalog.defaultDiy(6, true) };
  config.diy.charId = 'char_456_ash';
  assert.throws(() => engine.validate(config, target), /灰烬 暂无战斗实现/);
  for (const tier of [5, 6]) {
    const { ownedPool, prototypes } = data.backups.diy;
    assert.deepEqual(new Set(engine.catalog.picks(tier).map(op => op.charId)),
      new Set([...ownedPool, ...prototypes[tier], ...added]));
  }
});

test('Regulation Talulah uses authored skills with a stationary Boss, including burn interaction', () => {
  const config = { ...manifest.defaults.config, chessId: 'chess_char_6_16_b' };
  const retaliation = engine.simulate({ ...config, skillIndex: 1 }, target);
  assert.equal(retaliation.kitSource, 'skills');
  assert.equal(retaliation.activations, 0);
  assert.ok(retaliation.warnings.some(w => w.includes('阂断骤雪')));
  const runTeam = skillIndex => engine.simulateTeam({
    ...team, members: [{ uid: 1, row: 4, col: 8, dir: 'RIGHT', config: { ...config, skillIndex } }],
  }, target, scene);
  assert.equal(runTeam(1).damageByOperator[0].activations, 0);
  const volley = runTeam(2);
  assert.ok(volley.damageByOperator[0].activations > 0);
  assert.ok(volley.diagnostics.bursts.some(burst => burst.element === 'burn'));
  assert.ok(volley.hits.some(hit => hit.type === 'elemental'));
});

test('collaboration picks use real training forms and authored skills', () => {
  for (const id of Object.keys(data.collab.units)) {
    for (const tier of [5, 6]) {
      for (const elite of [false, true]) {
        const base = { ...manifest.defaults.config, ...engine.catalog.defaultDiy(tier, elite, id) };
        for (const uniEquipId of [null, ...(elite ? engine.catalog.modules(base).map(m => m.uniEquipId) : [])]) {
          for (const index of [0, 1, 2]) {
            const config = { ...base, skillIndex: index, diy: { ...base.diy, uniEquipId } };
            const rec = engine.catalog.resolve(config);
            assert.deepEqual(rec.garrisonIds, []);
            assert.deepEqual(rec.bonds, ['emptyShip']);
            assert.equal(engine.simulate(config, { ...target, duration: 12 }).kitSource, 'skills');
          }
        }
      }
    }
  }
});

test('Yato S2 applies a distinct physical and arts hit at each client animation event', () => {
  const id = 'char_1029_yato2';
  const config = { ...manifest.defaults.config, ...engine.catalog.defaultDiy(6, true, id), skillIndex: 1 };
  const r = engine.simulate(config, { ...target, def: 0, res: 0, duration: 3 });
  assert.equal(r.activations, 1);
  assert.equal(r.hits.length, 32);
  const physical = r.hits.filter(h => h.type === 'phys');
  assert.deepEqual(physical.map(h => Math.round(h.t * 30)), [12,32,34,42,50,58,60,66,68,79,81,83,84,86,87,89]);
  assert.ok(Math.abs(physical[0].amount - r.opening.atk * 1.3) < 1e-5);
  assert.ok(Math.abs(r.hits[1].amount - r.opening.atk * 0.2 * 2.73) < 1e-5);
  const mod = { ...config, diy: { ...config.diy, uniEquipId: 'uniequip_003_yato2' } };
  const withModule = engine.simulate(mod, { ...target, def: 0, res: 0, duration: 3 });
  const arts = withModule.hits.filter(h => h.type === 'arts');
  assert.ok(Math.abs(arts.at(-1).amount / arts[0].amount - 1.5) < 1e-6);
});

test('Orchid S2 starts at deployment and fires 3, 4 and 5 arrows into its firing range', () => {
  const id = 'char_1048_orchd2';
  const config = { ...manifest.defaults.config, ...engine.catalog.defaultDiy(6, true, id), skillIndex: 1 };
  const r = engine.simulate(config, { ...target, def: 0, res: 0, duration: 5, distance: 3 });
  assert.equal(r.timeline[0].t, 0);
  const byFrame = new Map();
  for (const hit of r.hits) byFrame.set(hit.t, (byFrame.get(hit.t) || 0) + 1);
  assert.deepEqual([...byFrame.values()], [3, 4, 5]);
  assert.ok(Math.abs(r.hits[0].amount - r.opening.atk * 1.2 * 1.5) < 1e-5);
  const near = engine.simulate(config, { ...target, def: 0, res: 0, duration: 5, distance: 1 });
  assert.equal(near.hits.length, 1);
  assert.ok(Math.abs(near.hits[0].amount - near.opening.atk * 1.2 * 2.7) < 1e-5);
});

test('Orchid S2 can recast with a target in either attack range or skill range', () => {
  const config = {
    ...manifest.defaults.config,
    ...engine.catalog.defaultDiy(6, true, 'char_1048_orchd2'),
    skillIndex: 1, bonds: [],
  };
  const short = { ...target, def: 0, res: 0, duration: 18 };
  const near = engine.simulate(config, { ...short, distance: 1 });
  const far = engine.simulate(config, { ...short, distance: 3 });
  const miss = engine.simulate(config, { ...short, distance: 5 });
  assert.equal(near.activations, 2);
  assert.equal(far.activations, 2);
  assert.equal(miss.activations, 1);
  assert.equal(miss.total, 0);
  const hitsInSecondCast = result => {
    const [start, end] = result.skillWindow.intervals[1];
    return result.hits.filter(h => h.t >= start && h.t < end);
  };
  assert.equal(hitsInSecondCast(near).length, 1);
  assert.equal(hitsInSecondCast(far).length, 12);

  const point = { ...scene, targetShape: 'point', targetRow: 4, targetCol: 6 };
  const formed = engine.simulateTeam({
    ...team, members: [{ uid: 1, row: 4, col: 5, dir: 'RIGHT', config }], bonds: [],
  }, short, point);
  assert.equal(formed.damageByOperator[0].activations, 2);
  assert.deepEqual(formed.damageByOperator[0].skillWindow.intervals, near.skillWindow.intervals);
});

test('both supplemental operators enter one team battle and retain damage attribution', () => {
  const members = [
    { uid: 1, row: 4, col: 6, dir: 'RIGHT', config: { ...manifest.defaults.config,
      ...engine.catalog.defaultDiy(6, true, 'char_1029_yato2'), skillIndex: 1 } },
    { uid: 2, row: 4, col: 5, dir: 'RIGHT', config: { ...manifest.defaults.config,
      ...engine.catalog.defaultDiy(6, true, 'char_1048_orchd2'), skillIndex: 2 } },
  ];
  const point = { ...scene, targetShape: 'point', targetRow: 4, targetCol: 7 };
  const r = engine.simulateTeam({ ...team, members }, { ...target, duration: 12 }, point);
  assert.ok(r.damageByOperator.every(o => o.damage > 0 && o.activations > 0));
  for (const uid of [1, 2]) {
    const hits = r.hits.filter(h => h.operatorId === `p1/${uid}`);
    assert.ok(hits.some(h => h.type === 'phys') && hits.some(h => h.type === 'arts'));
  }
  assert.equal(r.unattributedDamage, 0);
});
