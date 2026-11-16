// Version packages contain data and provenance; executable rules are selected separately.
export function rulesKey(manifest) {
  return `${manifest.id}@${manifest.revision}:${manifest.engine.id}`;
}
export function validateManifest(m) {
  if (m?.schema !== 1 || !/^[a-z0-9_-]+$/.test(m.id) || !Number.isInteger(m.revision) || m.revision < 1 ||
      [m.iconSet, m.boardSet].some(set => set != null && !/^[a-z0-9_-]+$/.test(set)) || !m.engine?.id || m.engine.api !== 1 || !m.files || !m.defaults?.config || !m.defaults?.target ||
      (m.defaults.configs != null && (!Array.isArray(m.defaults.configs) || m.defaults.configs.length < 1 || m.defaults.configs.length > 5))) {
    throw new Error('版本清单不完整或格式不受支持。');
  }
  for (const [name, f] of Object.entries(m.files)) {
    if (!/^[a-z]+$/.test(name) || f.path !== `${name}.json` || !/^[a-f0-9]{64}$/.test(f.sha256)) {
      throw new Error(`版本文件声明无效：${name}`);
    }
  }
  return m;
}
const fetchText = async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法载入版本文件：${url.pathname}`);
  return response.text();
};
export async function loadRuleset({ versionId, mode = 'single', fromSingle, catalogUrl = new URL('../data/catalog.json', import.meta.url), readText = fetchText } = {}) {
  const catalog = JSON.parse(await readText(catalogUrl));
  const compatibleTeam = fromSingle && catalog.versions.find(v => v.id === fromSingle)?.teamVersion;
  const defaultId = mode === 'team' ? compatibleTeam || catalog.teamDefault : catalog.default;
  const entry = catalog.versions.find(v => v.id === (versionId || defaultId));
  if (!entry) throw new Error('未找到所选规则版本。');
  const manifestUrl = new URL(entry.manifest, catalogUrl);
  const manifest = validateManifest(JSON.parse(await readText(manifestUrl)));
  if (manifest.id !== entry.id) throw new Error('版本目录与清单不一致。');
  const data = Object.fromEntries(await Promise.all(Object.entries(manifest.files).map(async ([name, f]) => {
    const text = await readText(new URL(f.path, manifestUrl));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const actual = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    if (actual !== f.sha256) throw new Error(`${name} 数据校验失败，停止计算以免混用版本。`);
    return [name, JSON.parse(text)];
  })));
  return { manifest, data };
}

export async function loadIcons(manifest) {
  const name = manifest.iconSet ?? 'index';
  return JSON.parse(await fetchText(new URL(`../assets/icons/${name}.json`, import.meta.url)));
}
