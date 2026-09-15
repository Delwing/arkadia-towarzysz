#!/usr/bin/env node
/**
 * The mixer pipeline: pull only the art we use, and bake it into a module the
 * plugin can compile.
 *
 * The art is KingBell's Pixel Art Sprite Mixer. Its own asset bundle carries
 * the sheets *and* the tables that say how to use them - the cell size, the
 * frame layout, and how far the head layer moves in every frame of every
 * animation - so nothing here measures anything. `tools/mixer/bundle.mjs` reads
 * those; this slices out the handful of animations and heads the manifest names
 * and packs them as text.
 *
 *   yarn mixer list                              what the manifest names
 *   yarn mixer add-anim warp re_warp             one more animation
 *   yarn mixer add-anim topple die_soul die_melt several: the animator picks one
 *   yarn mixer set-head goblin 120               which head an archetype wears
 *   yarn mixer heads out.png                     contact sheet of all 333 heads
 *   yarn mixer bake                              re-bake from the cache
 *   yarn mixer preview out.png                   contact sheet of what is baked
 *
 * The bundle lands in `tools/mixer/cache/` (git-ignored), so a re-bake is
 * offline and no binary enters the source tree. What is committed is the
 * generated `render/mixer-art.ts`, which is plain text.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cell, loadBundle, MIT_NOTICE } from './mixer/bundle.mjs';
import { packFrame, unpackFrame } from './mixer/decode.mjs';
import { encodePng } from './png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'tools', 'mixer', 'manifest.json');
const CACHE = join(ROOT, 'tools', 'mixer', 'cache');
const OUT = join(ROOT, 'render', 'mixer-art.ts');

/** More effect pixels than this in a final frame is an ending, not a leftover. */
const REMNANT = 8;

const readManifest = () => JSON.parse(readFileSync(MANIFEST, 'utf8'));
const writeManifest = (m) => writeFileSync(MANIFEST, `${JSON.stringify(m, null, 2)}\n`.replace(/\n/g, '\r\n'));

/** A name per clip: a list becomes `topple`, `topple#1`, ... */
const clipNames = (name, value) =>
  (Array.isArray(value) ? value : [value]).map((anim, i) => ({ clip: i === 0 ? name : `${name}#${i}`, anim }));

/**
 * The palette every packed pixel indexes. An entry is either the name of a
 * colour the roll fills in - the art is drawn in key colours, which is how the
 * Mixer recolours it too - or a literal `#rrggbb` for a highlight that should
 * stay exactly as drawn.
 */
function palette(conf) {
  const slots = Object.keys(conf.fromColors);
  const entries = ['transparent', ...slots];
  const literals = new Map();
  const key = (r, g, b) => `${r},${g},${b}`;
  const bySlot = new Map(slots.map((name) => [key(...conf.fromColors[name]), entries.indexOf(name)]));
  // Their own tolerance: browsers disagree by one on some of these.
  const near = (r, g, b) => {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dg = -1; dg <= 1; dg++) {
        for (let db = -1; db <= 1; db++) {
          const hit = bySlot.get(key(r + dr, g + dg, b + db));
          if (hit !== undefined) return hit;
        }
      }
    }
    return undefined;
  };
  return {
    entries,
    indexOf(r, g, b, a) {
      if (a < 128) return 0;
      const slot = near(r, g, b);
      if (slot !== undefined) return slot;
      const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      if (!literals.has(hex)) {
        literals.set(hex, entries.length);
        entries.push(hex);
      }
      return literals.get(hex);
    },
  };
}

async function bake() {
  const manifest = readManifest();
  const bundle = await loadBundle(manifest, CACHE);
  const { width, height, conf } = bundle;
  const pal = palette(conf);
  const pack = (rgba) => packFrame(rgba, (r, g, b, a) => pal.indexOf(r, g, b, a));

  const clips = [];
  for (const [name, value] of Object.entries(manifest.animations)) {
    for (const { clip, anim } of clipNames(name, value)) {
      const x0 = bundle.index[anim];
      if (x0 === undefined) throw new Error(`${anim}: not in the tool's animation index`);
      const offsets = bundle.offsets('head', anim);
      if (offsets.length === 0) throw new Error(`${anim}: no head offsets in conf.json`);
      const frames = offsets.map((_, f) => {
        const packed = pack(cell(bundle.base, x0 + f, width, height));
        unpackFrame(packed, width, height); // a truncated run would be a corrupt sheet
        return packed;
      });
      // Whether the frame this would freeze on ends on a few stray effect
      // pixels - the last two of a soul, on its way out of shot - rather than on
      // something meant to stay. A skull is fifty-odd pixels and is the whole
      // point of that ending; a remnant is a handful and wants sweeping up.
      const last = unpackFrame(frames[frames.length - 1], width, height);
      const effects = new Set(['more', 'more2'].map((slot) => pal.entries.indexOf(slot)).filter((i) => i > 0));
      let remaining = 0;
      for (const index of last) if (effects.has(index)) remaining++;
      const endsWithRemnant = remaining > 0 && remaining <= REMNANT;
      clips.push({ clip, anim, frames, offsets, endsWithRemnant });
    }
  }

  const heads = Object.entries(manifest.archetypes).map(([name, spec]) => ({
    name,
    index: spec.head,
    packed: pack(cell(bundle.heads, spec.head, width, height)),
  }));

  const q = (s) => JSON.stringify(s);
  const lines = [];
  lines.push('/**');
  lines.push(' * GENERATED by tools/mixer.mjs - do not edit by hand.');
  lines.push(' *');
  lines.push(` * ${MIT_NOTICE}`);
  lines.push(' *');
  lines.push(' * Frames are run-length encoded: base64 of (count, palette index) byte pairs.');
  lines.push(" * A palette entry is either a slot the companion's roll fills in or a literal");
  lines.push(' * colour. render/mixer.ts unpacks and composes them.');
  lines.push(' */');
  lines.push('');
  lines.push(`export const MIXER_FRAME_W = ${width};`);
  lines.push(`export const MIXER_FRAME_H = ${height};`);
  lines.push(`export const MIXER_FRAME_MS = ${manifest.frameMs};`);
  lines.push('');
  lines.push('/** Index 0 is transparent; `#rrggbb` entries stay as drawn, the rest are slots. */');
  lines.push(`export const MIXER_PALETTE: readonly string[] = ${JSON.stringify(pal.entries)};`);
  lines.push('');
  lines.push('export interface MixerClip {');
  lines.push('  frames: readonly string[];');
  lines.push("  /** The tool's own per-frame offset for the head layer. */");
  lines.push('  headOffsets: readonly number[];');
  lines.push('  /** Its last frame keeps a few stray effect pixels, so it is a poor frame to stop on. */');
  lines.push('  endsWithRemnant: boolean;');
  lines.push('  /** Their name for it, so the manifest and this can be read together. */');
  lines.push('  source: string;');
  lines.push('}');
  lines.push('');
  lines.push('export const MIXER_CLIPS: Record<string, MixerClip> = {');
  for (const clip of clips) {
    lines.push(`  ${q(clip.clip)}: {`);
    lines.push(`    frames: [${clip.frames.map((f) => `'${f}'`).join(', ')}],`);
    lines.push(`    headOffsets: [${clip.offsets.join(', ')}],`);
    lines.push(`    endsWithRemnant: ${clip.endsWithRemnant},`);
    lines.push(`    source: ${q(clip.anim)},`);
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');
  lines.push('/** Animations drawn more than one way; the animator picks a row each time. */');
  lines.push('export const MIXER_VARIANTS: Record<string, readonly string[]> = {');
  for (const [name, value] of Object.entries(manifest.animations)) {
    if (!Array.isArray(value) || value.length < 2) continue;
    lines.push(`  ${q(name)}: [${clipNames(name, value).map((c) => `'${c.clip}'`).join(', ')}],`);
  }
  lines.push('};');
  lines.push('');
  lines.push("/** What each archetype wears, drawn over every frame at that frame's offset. */");
  lines.push('export const MIXER_HEADS: Record<string, { packed: string; index: number }> = {');
  for (const head of heads) lines.push(`  ${q(head.name)}: { packed: '${head.packed}', index: ${head.index} },`);
  lines.push('};');
  lines.push('');

  writeFileSync(OUT, lines.join('\n').replace(/\n/g, '\r\n'));
  const frames = clips.reduce((sum, c) => sum + c.frames.length, 0);
  console.log(
    `Baked ${clips.length} clips (${frames} frames of ${width}x${height}), ${heads.length} heads, ` +
      `${pal.entries.length - 1} palette entries -> render/mixer-art.ts, ${(readFileSync(OUT).length / 1024).toFixed(1)} kB`,
  );
}

/** Lay cells out on a grid, scaled, on the usual background. */
function contactSheet(out, cells, perRow, width, height, scale = 4, gap = 2) {
  const rows = Math.ceil(cells.length / perRow);
  const w = perRow * (width + gap) + gap;
  const h = rows * (height + gap) + gap;
  const data = new Uint8ClampedArray(w * scale * h * scale * 4);
  for (let i = 0; i + 3 < data.length; i += 4) {
    data[i] = 0x2b;
    data[i + 1] = 0x2e;
    data[i + 2] = 0x34;
    data[i + 3] = 255;
  }
  cells.forEach((frame, n) => {
    const r = Math.floor(n / perRow);
    const c = n % perRow;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const s = (y * width + x) * 4;
        if (frame[s + 3] < 128) continue;
        for (let py = 0; py < scale; py++) {
          for (let px = 0; px < scale; px++) {
            const d =
              (((gap + r * (height + gap) + y) * scale + py) * w * scale + (gap + c * (width + gap) + x) * scale + px) * 4;
            data[d] = frame[s];
            data[d + 1] = frame[s + 1];
            data[d + 2] = frame[s + 2];
            data[d + 3] = 255;
          }
        }
      }
    }
  });
  writeFileSync(out, encodePng(w * scale, h * scale, data));
  return { w: w * scale, h: h * scale };
}

/** Draw a head layer over a base cell, the way the tool does. */
function compose(bundle, baseColumn, headColumn, headOffset) {
  const { width, height } = bundle;
  const out = cell(bundle.base, baseColumn, width, height);
  if (headColumn === null) return out;
  const head = cell(bundle.heads, headColumn, width, height);
  for (let y = 0; y < height; y++) {
    const ty = y + headOffset;
    if (ty < 0 || ty >= height) continue;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      if (head[s + 3] < 128) continue;
      const d = (ty * width + x) * 4;
      out[d] = head[s];
      out[d + 1] = head[s + 1];
      out[d + 2] = head[s + 2];
      out[d + 3] = 255;
    }
  }
  return out;
}

async function heads(out = 'mixer-heads.png') {
  const manifest = readManifest();
  const bundle = await loadBundle(manifest, CACHE);
  const count = bundle.heads.width / bundle.width;
  const stand = bundle.index.base_stand ?? 0;
  const cells = [];
  for (let n = 0; n < count; n++) cells.push(compose(bundle, stand, n, 0));
  const size = contactSheet(out, cells, 24, bundle.width, bundle.height);
  console.log(`${out}: ${count} heads, 24 per row (index = row * 24 + column), ${size.w}x${size.h}`);
}

async function preview(out = 'mixer-preview.png') {
  const manifest = readManifest();
  const bundle = await loadBundle(manifest, CACHE);
  const archetypes = Object.entries(manifest.archetypes);
  const all = [];
  for (const [, value] of Object.entries(manifest.animations)) {
    for (const { anim } of clipNames('x', value)) all.push(anim);
  }
  const columns = Math.max(...all.map((anim) => bundle.offsets('head', anim).length));
  const cells = [];
  for (const [, spec] of archetypes) {
    for (const anim of all) {
      const x0 = bundle.index[anim];
      const offsets = bundle.offsets('head', anim);
      for (let f = 0; f < columns; f++) {
        cells.push(
          f < offsets.length
            ? compose(bundle, x0 + f, spec.head, offsets[f])
            : new Uint8ClampedArray(bundle.width * bundle.height * 4),
        );
      }
    }
  }
  const size = contactSheet(out, cells, columns, bundle.width, bundle.height, 3);
  console.log(`${out}: ${archetypes.length} archetypes x ${all.length} clips, ${size.w}x${size.h}`);
}

function list() {
  const manifest = readManifest();
  const cached = existsSync(CACHE) ? readdirSync(CACHE).length : 0;
  console.log(`source: ${manifest.source}/${manifest.bundle}`);
  console.log(`credit: ${manifest.credit}\n`);
  console.log(`animations (${Object.keys(manifest.animations).length}):`);
  for (const [name, value] of Object.entries(manifest.animations)) {
    console.log(`  ${name.padEnd(10)} ${(Array.isArray(value) ? value : [value]).join(', ')}`);
  }
  console.log(`\narchetypes (${Object.keys(manifest.archetypes).length}):`);
  for (const [name, spec] of Object.entries(manifest.archetypes)) console.log(`  ${name.padEnd(10)} head ${spec.head}`);
  console.log(`\n${cached} file(s) cached in tools/mixer/cache/`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const manifest = readManifest();
  switch (command) {
    case 'list':
    case undefined:
      return list();
    case 'add-anim': {
      const [name, ...anims] = args;
      if (!name || anims.length === 0) {
        throw new Error("usage: add-anim <name> <their anim> [more] - several means 'pick one at random'");
      }
      manifest.animations[name] = anims.length === 1 ? anims[0] : anims;
      writeManifest(manifest);
      console.log(`+ animation ${name} -> ${anims.join(', ')}`);
      return bake();
    }
    case 'remove-anim': {
      const [name] = args;
      if (!name || !(name in manifest.animations)) throw new Error(`not in the manifest: ${name}`);
      delete manifest.animations[name];
      writeManifest(manifest);
      console.log(`- ${name}`);
      return bake();
    }
    case 'set-head': {
      const [name, index] = args;
      if (!name || index === undefined) {
        throw new Error('usage: set-head <archetype> <head index> (see: yarn mixer heads out.png)');
      }
      manifest.archetypes[name] = { head: Number(index) };
      writeManifest(manifest);
      console.log(`+ ${name} wears head ${index}`);
      return bake();
    }
    case 'bake':
      return bake();
    case 'heads':
      return heads(args[0]);
    case 'preview':
      return preview(args[0]);
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

await main();
