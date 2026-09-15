/**
 * The Sprite Mixer's own asset bundle, and the two tables inside its code that
 * say how to use it.
 *
 * The tool ships `data/Import_config_Hero.zip`: `conf.json`, `base.png`,
 * `heads.png`, `faces.png`. Everything the first version of this pipeline tried
 * to infer from pixels is written down in there -
 *
 *   conf.w / conf.h          the cell, 16x24
 *   conf.parts.head[a][f]    how far to move the head layer, per frame
 *   conf.fromColors          the key colours the art is drawn in
 *
 * - and the frame layout of `base.png` is a lookup in `app.js`:
 * `getAnimX0(anim, frame)` gives the column. Both are read here rather than
 * guessed at.
 *
 * Art and code are KingBell's: assets CC-BY 4.0, code MIT (the licence itch.io
 * declares for the project). `MIT_NOTICE` travels into the generated module.
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { PNG } from 'pngjs';

export const MIT_NOTICE =
  'Sprite Mixer by KingBell (BellBlitzKing@gmail.com, https://kingbell.itch.io/pixel-sprite-mixer). ' +
  'Art CC-BY 4.0; the frame layout and per-frame head offsets are read from the tool, whose code is MIT.';

/** Fetch once, keep it, so a re-bake needs no network. */
async function cached(cache, name, url) {
  const file = join(cache, name);
  if (existsSync(file)) return readFileSync(file);
  process.stdout.write(`  fetching ${name} ... `);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  mkdirSync(cache, { recursive: true });
  writeFileSync(file, bytes);
  console.log(`${(bytes.length / 1024).toFixed(1)} kB`);
  return bytes;
}

/**
 * Which column of `base.png` an animation's frame lives in. Their `getAnimX0`
 * is a chain of `if (animName == "x") return N + frame;`, which is a table
 * written as code; this reads it back out as a table.
 */
export function animationIndex(appSource) {
  const index = {};
  for (const m of appSource.matchAll(/if\s*\(\s*animName\s*==\s*"([^"]+)"\s*\)\s*return\s+(\d+)\s*\+\s*frame/g)) {
    index[m[1]] = Number(m[2]);
  }
  if (Object.keys(index).length === 0) throw new Error('no animation index found in app.js');
  return index;
}

/** Everything the bake needs, decoded and ready. */
export async function loadBundle(manifest, cache) {
  const zipBytes = await cached(cache, 'bundle.zip', `${manifest.source}/${manifest.bundle}`);
  const appSource = (await cached(cache, 'app.js', `${manifest.source}/app.js`)).toString('utf8');

  const zip = await JSZip.loadAsync(zipBytes);
  const conf = JSON.parse(await zip.file('conf.json').async('string'));
  const sheet = async (name) => PNG.sync.read(Buffer.from(await zip.file(name).async('uint8array')));

  return {
    conf,
    width: conf.w,
    height: conf.h,
    base: await sheet('base.png'),
    heads: await sheet('heads.png'),
    index: animationIndex(appSource),
    /** Their own per-frame offset for a layer, or 0. */
    offsets(key, anim) {
      return conf.parts?.[key]?.[anim] ?? [];
    },
  };
}

/** One 16x24 cell out of a strip, as RGBA. */
export function cell(strip, column, width, height) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * strip.width + (column * width + x)) * 4;
      const to = (y * width + x) * 4;
      out[to] = strip.data[from];
      out[to + 1] = strip.data[from + 1];
      out[to + 2] = strip.data[from + 2];
      out[to + 3] = strip.data[from + 3];
    }
  }
  return out;
}
