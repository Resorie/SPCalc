import { validateManifest } from './rulesets.js';
// Only checked-in adapters may execute. A data package cannot load arbitrary code.
const runtimes = {
  'stronghold-f07b896': () => import('./adapters/stronghold-runtime.js'),
  'stronghold-55f528e': () => import('./adapters/stronghold-regulation-runtime.js'),
};
export async function createCalculator({ manifest, data }) {
  validateManifest(manifest);
  const load = runtimes[manifest.engine.id];
  if (!load) throw new Error(`此规则包需要尚未接入的引擎：${manifest.engine.id}`);
  const [{ createAdapter }, runtime] = await Promise.all([import('./adapters/stronghold.js'), load()]);
  return createAdapter(data, manifest, runtime);
}
