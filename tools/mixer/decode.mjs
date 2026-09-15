/**
 * Packing, and its inverse - the only image work the pipeline still does.
 *
 * Everything that used to live here (GIF decoding, palette building, face
 * anchoring, item diffing) is gone: the Sprite Mixer's own bundle carries the
 * sheets and the tables, so there is nothing left to infer. See
 * tools/mixer/bundle.mjs.
 */

/** A run cannot be longer than one byte can count. */
const MAX_RUN = 255;

/**
 * Run-length encode one frame against a palette, as base64 of (count, index)
 * byte pairs. Pixel art is mostly long runs, and the plugin unpacks it with one
 * pass and `atob`.
 */
export function packFrame(frame, indexOf) {
  const runs = [];
  let run = 0;
  let current = -1;
  for (let i = 0; i + 3 < frame.length; i += 4) {
    const index = indexOf(frame[i], frame[i + 1], frame[i + 2], frame[i + 3]);
    if (index === current && run < MAX_RUN) {
      run++;
      continue;
    }
    if (current >= 0) runs.push(run, current);
    current = index;
    run = 1;
  }
  if (current >= 0) runs.push(run, current);
  return Buffer.from(runs).toString('base64');
}

/** The inverse, for the tool's own checks - the plugin has its own copy in TypeScript. */
export function unpackFrame(packed, width, height) {
  const bytes = Buffer.from(packed, 'base64');
  const out = new Uint8Array(width * height);
  let at = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const count = bytes[i];
    const index = bytes[i + 1];
    for (let n = 0; n < count && at < out.length; n++) out[at++] = index;
  }
  if (at !== width * height) throw new Error(`unpacked ${at} of ${width * height} pixels`);
  return out;
}
