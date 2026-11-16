import { rulesKey } from './rulesets.js';
export function defaultState(manifest) {
  const { config, configs, comparisonItems, target } = manifest.defaults;
  return { schema: 2, rules: rulesKey(manifest), version: manifest.id, upstream: manifest.engine.upstream,
    target: structuredClone(target),
    configs: (configs ?? [config, { ...config, items: comparisonItems }]).map(plan => structuredClone(plan)) };
}
export function restoreState(parsed, manifest) {
  const legacy = parsed?.schema === 1 && parsed.version === manifest.id && parsed.upstream === manifest.engine.upstream && manifest.revision === 1;
  if (!legacy && !(parsed?.schema === 2 && parsed.rules === rulesKey(manifest))) throw new Error('配置的规则版本不匹配，已恢复默认。');
  if (!Array.isArray(parsed.configs) || (parsed.configs.length < 1 || parsed.configs.length > 5) || !parsed.target ||
      parsed.configs.some(c => !c || !Array.isArray(c.items) || !Array.isArray(c.bonds))) throw new Error('配置格式无效，已恢复默认。');
  return { ...parsed, schema: 2, rules: rulesKey(manifest),
    target: { ...manifest.defaults.target, ...parsed.target } };
}
