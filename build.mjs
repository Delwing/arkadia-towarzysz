import { build, context } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUTDIR = 'dist';
const PORT = 5177;

mkdirSync(OUTDIR, { recursive: true });

const buildOptions = {
  entryPoints: ['plugin.ts'],
  bundle: true,
  format: 'esm',
  outfile: resolve(OUTDIR, 'plugin.js'),
  sourcemap: true,
  target: 'es2022',
  logLevel: 'info',
  // Sprite sheets are embedded as data URIs. The registry's own bundler only
  // understands .ts/.js/.json, so the sheets are pre-embedded into
  // render/sheets.ts by tools/embed-sheets.mjs; this loader is the escape hatch
  // for a direct `import sheet from './x.png'` in local builds only.
  loader: { '.png': 'dataurl' },
};

if (process.argv.includes('--serve')) {
  const ctx = await context(buildOptions);
  await ctx.watch();
  const server = await ctx.serve({ port: PORT, servedir: OUTDIR });
  console.log(`Plugin served at http://${server.host}:${server.port}/plugin.js`);
} else {
  await build(buildOptions);
  console.log(`Built ${OUTDIR}/plugin.js`);
}
