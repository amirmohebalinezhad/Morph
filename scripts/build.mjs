// Build script: bundles the three extension entry points with esbuild and
// assembles a loadable extension directory.
//
//   node scripts/build.mjs            -> dist/       (production manifest)
//   node scripts/build.mjs --watch    -> dist/ with incremental rebuilds
//   node scripts/build.mjs --test     -> dist/ AND dist-test/ (manifest gains
//                                        localhost host_permissions so e2e can
//                                        inject without an activeTab gesture)
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const testBuild = process.argv.includes('--test');

const dist = path.join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  absWorkingDir: root,
  target: ['chrome121'],
  logLevel: 'info',
  sourcemap: watch ? 'inline' : false,
  minify: false,
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  jsx: 'automatic',
  loader: { '.css': 'text' },
};

const configs = [
  {
    ...common,
    entryPoints: ['src/background/index.ts'],
    outfile: 'dist/background.js',
    format: 'esm',
    // The Anthropic SDK dynamically imports node builtins for CLI-profile
    // auth, a path never taken in the extension (we always pass an explicit
    // API key). Leave them unresolved rather than failing the bundle.
    external: ['node:fs', 'node:path', 'node:os'],
  },
  {
    ...common,
    entryPoints: ['src/content/index.ts'],
    outfile: 'dist/content.js',
    format: 'iife',
  },
  {
    ...common,
    entryPoints: ['src/options/options.ts'],
    outfile: 'dist/options.js',
    format: 'iife',
  },
];

function copyStatic() {
  cpSync(path.join(root, 'public'), dist, { recursive: true });
  const optionsCss = path.join(root, 'src/options/options.css');
  if (existsSync(optionsCss)) cpSync(optionsCss, path.join(dist, 'options.css'));
}

function makeTestDist() {
  const testDist = path.join(root, 'dist-test');
  rmSync(testDist, { recursive: true, force: true });
  cpSync(dist, testDist, { recursive: true });
  const manifestPath = path.join(testDist, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = [
    ...(manifest.host_permissions ?? []),
    'http://localhost/*',
    'http://127.0.0.1/*',
  ];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

if (watch) {
  const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
  copyStatic();
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('[build] watching for changes…');
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
  copyStatic();
  if (testBuild) makeTestDist();
  console.log(`[build] done -> dist/${testBuild ? ' and dist-test/' : ''}`);
}
