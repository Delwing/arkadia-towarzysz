#!/usr/bin/env node
/**
 * Serves `tools/showcase/` - the click-through preview of the companion, every
 * animation and the whole reaction path - at http://localhost:5178.
 *
 *   yarn showcase          watch and serve
 *   yarn showcase --build  write dist/showcase/ and exit
 *
 * The page imports the plugin's own modules, so it is bundled the same way the
 * plugin is; nothing here ends up in `dist/plugin.js` or in the publish zip.
 */

import { build, context } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'tools', 'showcase');
const OUTDIR = join(ROOT, 'dist', 'showcase');
const PORT = 5178;

mkdirSync(OUTDIR, { recursive: true });

const options = {
  // The page is an entry point of its own rather than a one-off copy, so that
  // `ctx.watch()` picks up an edit to the markup as well as to the script.
  entryPoints: [
    { in: join(SOURCE, 'main.ts'), out: 'showcase' },
    { in: join(SOURCE, 'index.html'), out: 'index' },
  ],
  loader: { '.html': 'copy' },
  bundle: true,
  format: 'esm',
  outdir: OUTDIR,
  sourcemap: true,
  target: 'es2022',
  logLevel: 'info',
};

if (process.argv.includes('--build')) {
  await build(options);
  console.log(`Built ${OUTDIR}`);
} else {
  const ctx = await context(options);
  await ctx.watch();
  const server = await ctx.serve({ port: PORT, servedir: OUTDIR });
  console.log(`Showcase at http://${server.host === '0.0.0.0' ? 'localhost' : server.host}:${server.port}/`);
}
