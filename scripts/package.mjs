// Zips dist/ into morph-<version>.zip for distribution (load-unpacked users
// can just use dist/ directly).
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
if (!existsSync(path.join(dist, 'manifest.json'))) {
  console.error('dist/ missing — run npm run build first');
  process.exit(1);
}
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const out = path.join(root, `morph-${version}.zip`);
rmSync(out, { force: true });
try {
  execFileSync('zip', ['-r', out, '.'], { cwd: dist, stdio: 'inherit' });
} catch (err) {
  console.error('zip failed — is the `zip` CLI installed?', err.message);
  process.exit(1);
}
console.log(`packaged -> ${out}`);
