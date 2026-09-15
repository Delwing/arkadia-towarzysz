#!/usr/bin/env node
/**
 * Writes a scaled-up contact sheet of the sprite art, for eyeballing a change
 * to render/sprites.ts without starting the client.
 *
 * The art is generated per companion now, so a preview needs a companion: each
 * column is one character name rolled through companion/roll.ts, drawn exactly
 * as the plugin would draw it. Pass names to see particular ones.
 *
 *   yarn preview-sprites                       -> sprites-preview.png, one companion per archetype
 *   yarn preview-sprites out.png Delwing Zbyszek
 *
 * The modules are TypeScript, so they are bundled through esbuild (already a
 * devDependency) into a temp file and imported from there.
 */

import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { encodePng } from './png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCALE = 6;
const GAP = 2;
const BACKGROUND = [0x2b, 0x2e, 0x34];

/** Bundle the two TS modules the preview needs and import the result. */
async function loadModules() {
  const dir = mkdtempSync(join(tmpdir(), 'towarzysz-preview-'));
  const outfile = join(dir, 'bundle.mjs');
  await build({
    stdin: {
      contents: `export { drawSheetPixels, SHEET_W, SHEET_H } from './render/sprites';\nexport { roll } from './companion/roll';\n`,
      resolveDir: ROOT,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'warning',
  });
  const module = await import(pathToFileURL(outfile).href);
  return { module, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** One name per archetype, so a bare run shows all seven. */
function defaultNames(roll) {
  const wanted = ['magician', 'wizard', 'villager', 'monster', 'ogre', 'orc', 'goblin'];
  const found = new Map();
  for (let i = 0; i < 20000 && found.size < wanted.length; i++) {
    const name = `T${i}`;
    const spec = roll(name, 0);
    // Prefer a companion who has everything, so the preview shows every part.
    if (!spec.parts.hasWeapon || !spec.parts.hairLong) continue;
    if (!found.has(spec.archetype)) found.set(spec.archetype, name);
  }
  return wanted.map((a) => found.get(a)).filter(Boolean);
}

async function main() {
  const args = process.argv.slice(2);
  const out = args[0] ?? 'sprites-preview.png';
  const { module, cleanup } = await loadModules();
  try {
    const names = args.length > 1 ? args.slice(1) : defaultNames(module.roll);
    const sheets = names.map((name) => {
      const spec = module.roll(name, 0);
      console.log(
        `${name}: ${spec.archetype} ${spec.name}, hairLong=${spec.parts.hairLong}, weapon=${spec.parts.hasWeapon}`,
      );
      return module.drawSheetPixels(spec);
    });
    if (sheets.length === 0) throw new Error('nothing to draw');

    const width = sheets.reduce((sum, s) => sum + s.width + GAP, GAP);
    const height = module.SHEET_H + GAP * 2;
    const data = new Uint8ClampedArray(width * SCALE * height * SCALE * 4);
    for (let i = 0; i + 3 < data.length; i += 4) {
      data[i] = BACKGROUND[0];
      data[i + 1] = BACKGROUND[1];
      data[i + 2] = BACKGROUND[2];
      data[i + 3] = 255;
    }
    let x = GAP;
    for (const sheet of sheets) {
      for (let sy = 0; sy < sheet.height; sy++) {
        for (let sx = 0; sx < sheet.width; sx++) {
          const si = (sy * sheet.width + sx) * 4;
          if (sheet.data[si + 3] === 0) continue;
          for (let py = 0; py < SCALE; py++) {
            for (let pxi = 0; pxi < SCALE; pxi++) {
              const di = (((GAP + sy) * SCALE + py) * width * SCALE + (x + sx) * SCALE + pxi) * 4;
              data[di] = sheet.data[si];
              data[di + 1] = sheet.data[si + 1];
              data[di + 2] = sheet.data[si + 2];
              data[di + 3] = 255;
            }
          }
        }
      }
      x += sheet.width + GAP;
    }
    writeFileSync(out, encodePng(width * SCALE, height * SCALE, data));
    console.log(`${out}: ${sheets.length} companion(s), ${width * SCALE}x${height * SCALE}`);
  } finally {
    cleanup();
  }
}

await main();
