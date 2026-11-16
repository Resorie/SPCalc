import { cp, mkdir, rm } from 'node:fs/promises';
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
for (const path of ['index.html', 'team.html', 'src', 'vendor', 'data', 'assets', 'LICENSE']) {
  await cp(new URL(`../${path}`, import.meta.url), new URL(`../dist/${path}`, import.meta.url), { recursive: true });
}
console.log('Static site built in dist/. No network or backend is required at runtime.');
