/**
 * The showcase: every companion, every animation and the whole reaction path,
 * in a page you can click through. `yarn showcase`.
 *
 * It imports the plugin's own modules - the chip, the animator, the sheet, the
 * bindings, the mood and the speaker - and wires them the way `plugin.ts`
 * does. Nothing here is a mock, so what you see is what the footer does; the
 * only thing missing is the client that would normally send the events.
 *
 * This is a development tool. It is not bundled into the plugin and not
 * published to the registry.
 */

import { roll } from '../../companion/roll';
import { bucket, bucketLabel, nudge, read as readMood, type Mood } from '../../companion/mood';
import {
  AMBIENT_LEVELS,
  ARCHETYPES,
  type AmbientLevel,
  type Archetype,
  type CompanionSpec,
  type Primitive,
} from '../../companion/types';
import { PRIMITIVES } from '../../render/animations';
import { AMBIENT_MAX_GAP_MS, AMBIENT_MIN_GAP_MS, LEVEL_SCALE } from '../../companion/ambient';
import { Animator, PRIMITIVE_DEFS } from '../../render/animator';
import { buildSheet, frameRect, type LoadedSheet } from '../../render/sheet';
import { frameIndex } from '../../render/pose';
import { CANVAS_H, CANVAS_W, Chip, PIXEL_SCALE } from '../../ui/chip';
import { Bubble } from '../../ui/bubble';
import { AMBIENT_LABELS, ARCHETYPE_LABELS, CATEGORY_LABELS } from '../../ui/settings';
import { resolve, type GameEvent } from '../../events/bindings';
import { Speaker } from '../../voice/speak';
import { VOICES, voiceName } from '../../voice/catalog';
import { COPPER_PER } from '../../text/coins';

// ---------------------------------------------------------------------------
// Tiny DOM helpers, in the same spirit as ui/settings.ts
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function panel(title: string, wide = false): HTMLDivElement {
  const box = el('div', `panel${wide ? ' wide' : ''}`);
  box.appendChild(el('h2', undefined, title));
  return box;
}

function row(...children: Node[]): HTMLDivElement {
  const box = el('div', 'row');
  for (const child of children) box.appendChild(child);
  return box;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const btn = el('button', undefined, label);
  btn.type = 'button';
  btn.addEventListener('click', onClick);
  return btn;
}

function number(value: number, min: number, max: number, width = '5em'): HTMLInputElement {
  const input = el('input');
  input.type = 'number';
  input.value = String(value);
  input.min = String(min);
  input.max = String(max);
  input.style.width = width;
  return input;
}

/** The first generated name that rolls this archetype; the preview tool does the same. */
function nameFor(archetype: Archetype): string {
  for (let i = 0; i < 20_000; i++) {
    const name = `T${i}`;
    const spec = roll(name, 0);
    if (spec.archetype === archetype && spec.parts.hasWeapon && spec.parts.hairLong) return name;
  }
  return 'T0';
}

function clock(): number {
  return performance.now();
}

/**
 * Draw the scrubbed frame. Called from the slider as well as from the frame
 * loop: a background tab gets no animation frames at all, and a scrubber that
 * only repaints on the next one would look broken exactly when you are
 * stepping through something.
 */
function drawScrubbed(now: number): void {
  const def = PRIMITIVE_DEFS[scrub.primitive];
  animator.play(scrub.primitive, intensity, now - scrub.t * Math.max(0, def.durationMs - 1));
  for (const chip of chips) chip.render(now);
}

/** Play a primitive on purpose, from a button. */
function playNow(primitive: Primitive, amount = intensity): void {
  requested = primitive;
  animator.play(primitive, amount, clock());
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const animator = new Animator(1234);
const bubble = new Bubble();
const speaker = new Speaker();
let mood: Mood = { value: 0, touchedAt: Date.now() };
let spec: CompanionSpec = roll('Delwing', 0);
let sheet: LoadedSheet | null = null;
let restrained = true;
let ambientLevel: AmbientLevel = 'normal';
let intensity = 1;
/**
 * Scrubbing: the chips' own rAF loops are stopped and this page draws them
 * instead, at a time it picks - `Chip.render` is public for exactly this. The
 * primitive is replayed every frame with its start pushed back by t, so the
 * clock stays the real one and nothing downstream notices the difference.
 */
const scrub = { on: false, primitive: 'walk' as Primitive, t: 0 };
/** Set whenever this page starts a primitive, so the log can tell the two apart. */
let requested: Primitive | null = null;

const chips: Chip[] = [];
const app = document.getElementById('app') as HTMLDivElement;

function log(html: string): void {
  const line = el('div');
  line.innerHTML = `<b>${new Date().toLocaleTimeString()}</b> ${html}`;
  logBox.insertBefore(line, logBox.firstChild);
  while (logBox.childElementCount > 200) logBox.removeChild(logBox.lastChild as Node);
}

function applySpec(next: CompanionSpec): void {
  spec = next;
  mood = { value: 0, touchedAt: Date.now() };
  speaker.reset();
  try {
    sheet = buildSheet(spec);
  } catch {
    sheet = null;
  }
  for (const chip of chips) {
    chip.setSpec(spec);
    chip.setSheet(sheet);
  }
  refreshSpecPanel();
  log(
    `nowy towarzysz: <i>${spec.name}</i> - ${ARCHETYPE_LABELS[spec.archetype]}, glos ${voiceName(spec.voiceId)}` +
      `${spec.parts.hasWeapon ? ', z bronia' : ''}${spec.parts.hairLong ? ', dlugie wlosy' : ''}`,
  );
}

/** The plugin's own path: resolve, nudge the mood, animate, maybe speak. */
function fire(event: GameEvent): void {
  const reaction = resolve(event);
  if (!reaction) {
    log(`${event.type}: <i>bez reakcji</i>`);
    return;
  }
  const now = Date.now();
  const before = readMood(mood, now);
  mood = nudge(mood, reaction.moodDelta, now);
  requested = reaction.primitive;
  animator.play(reaction.primitive, reaction.intensity, clock());
  const voice = VOICES[spec.voiceId];
  const line = restrained
    ? speaker.maybe(voice, reaction.category, bucket(mood.value), { global: false, categories: [] }, now, {
        priority: reaction.priority === true,
      })
    : speaker.force(voice, reaction.category, bucket(mood.value));
  if (line) bubble.show(line, chips[0]?.element as HTMLElement);
  log(
    `<i>${event.type}</i> -> ${reaction.primitive} x${reaction.intensity.toFixed(2)}, ` +
      `${CATEGORY_LABELS[reaction.category].toLowerCase()}${reaction.priority ? ' (priorytet)' : ''}, ` +
      `nastroj ${before.toFixed(2)} -> ${mood.value.toFixed(2)}` +
      (line ? `, mowi: "${line}"` : ', milczy'),
  );
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

const specBox = el('div');

function refreshSpecPanel(): void {
  specBox.textContent = '';
  const line = el('div');
  line.innerHTML =
    `<b>${spec.name}</b> - ${ARCHETYPE_LABELS[spec.archetype]}, glos: ${voiceName(spec.voiceId)}, ` +
    `${spec.parts.hasWeapon ? 'z bronia' : 'bez broni'}, ${spec.parts.hairLong ? 'dlugie wlosy' : 'krotkie wlosy'}` +
    (sheet ? '' : ' <i>(arkusz sie nie zbudowal - rysowana jest postac zastepcza)</i>');
  specBox.appendChild(line);
  const swatches = row();
  for (const [key, colour] of Object.entries(spec.palette)) {
    if (!colour) continue;
    const chip = el('span');
    chip.innerHTML = `<span class="swatch" style="background:${colour}"></span> ${key}`;
    swatches.appendChild(chip);
  }
  specBox.appendChild(swatches);
}

function companionPanel(): HTMLDivElement {
  const box = panel('Towarzysz');
  const name = el('input');
  name.value = 'Delwing';
  name.style.width = '9em';
  const rerolls = number(0, 0, 1, '3.5em');
  const apply = () => applySpec(roll(name.value || 'Delwing', Math.max(0, Math.min(1, parseInt(rerolls.value, 10) || 0))));
  name.addEventListener('change', apply);
  rerolls.addEventListener('change', apply);
  box.appendChild(row(el('span', undefined, 'imie postaci'), name, el('span', undefined, 'losowan'), rerolls, button('Losuj', apply)));

  const byArchetype = row();
  for (const archetype of ARCHETYPES) {
    byArchetype.appendChild(button(ARCHETYPE_LABELS[archetype], () => applySpec(roll(nameFor(archetype), 0))));
  }
  box.appendChild(byArchetype);
  box.appendChild(
    row(
      button('Losowy', () => applySpec(roll(`X${Math.floor(Math.random() * 100000)}`, 0))),
      button('Bez broni', () => applySpec({ ...spec, parts: { ...spec.parts, hasWeapon: false } })),
      button('Krotkie wlosy', () => applySpec({ ...spec, parts: { ...spec.parts, hairLong: false } })),
    ),
  );
  specBox.style.marginTop = '8px';
  box.appendChild(specBox);
  return box;
}

const ZOOMS = [1, 2, 4, 6];

function stagePanel(): HTMLDivElement {
  const box = panel('Scena', true);
  const stage = el('div', 'stage');
  // The same chip at four sizes, all on one animator - so the 6x view is
  // literally the footer's chip, only bigger.
  for (const zoom of ZOOMS) {
    const holder = el('div', 'zoom');
    holder.style.transform = `scale(${zoom})`;
    const chip = new Chip({ animator });
    chip.setSpec(spec);
    chip.start();
    chips.push(chip);
    // Only the footer-sized chip keeps its name and mood label; blowing type
    // up six times would say nothing and take the whole row.
    if (zoom > 1) (chip.element.children[1] as HTMLElement).style.display = 'none';
    holder.appendChild(chip.element);
    const width = CANVAS_W * PIXEL_SCALE;
    const height = CANVAS_H * PIXEL_SCALE;
    holder.style.width = `${width}px`;
    holder.style.height = `${height}px`;
    const cell = el('div', 'cell');
    cell.style.width = `${width * zoom + (zoom === 1 ? 70 : 8)}px`;
    cell.style.height = `${height * zoom}px`;
    cell.appendChild(holder);
    cell.appendChild(el('div', 'caption', `${zoom}x`));
    stage.appendChild(cell);
  }
  box.appendChild(stage);
  box.appendChild(
    el(
      'div',
      'caption',
      `Kazdy chip to ${CANVAS_W}x${CANVAS_H} pikseli sprite po ${PIXEL_SCALE} px CSS. Tlo jest w kolorze stopki klienta.`,
    ),
  );
  return box;
}

function scrubPanel(): HTMLDivElement {
  const box = panel('Przewijanie');
  const toggle = el('input');
  toggle.type = 'checkbox';
  const which = el('select');
  for (const primitive of PRIMITIVES) {
    if (primitive === 'idle') continue; // nothing to scrub: it is one frame of nothing
    const option = el('option', undefined, primitive);
    option.value = primitive;
    which.appendChild(option);
  }
  which.value = scrub.primitive;
  which.addEventListener('change', () => {
    scrub.primitive = which.value as Primitive;
  });
  const slider = el('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1000';
  slider.value = '0';
  slider.style.width = '100%';
  const readout = el('div', 'caption');
  const refresh = () => {
    const def = PRIMITIVE_DEFS[scrub.primitive];
    readout.textContent = scrub.on
      ? `t = ${(scrub.t * 100).toFixed(1)} % (${Math.round(scrub.t * def.durationMs)} z ${def.durationMs} ms)`
      : 'Wylaczone - chipy chodza wlasnym zegarem.';
  };
  slider.addEventListener('input', () => {
    scrub.t = parseInt(slider.value, 10) / 1000;
    refresh();
    if (scrub.on) {
      const now = clock();
      drawScrubbed(now);
      drawState(now);
    }
  });
  toggle.addEventListener('change', () => {
    scrub.on = toggle.checked;
    // Handing the drawing over and taking it back is the whole mechanism.
    for (const chip of chips) {
      if (scrub.on) chip.stop();
      else chip.start();
    }
    refresh();
  });
  const step = (delta: number) => {
    // A frame of whatever the loaded sheet carries for this animation.
    const frame = 1 / Math.max(1, sheet?.animations[scrub.primitive]?.frames ?? 4);
    scrub.t = Math.min(1, Math.max(0, scrub.t + delta * frame));
    slider.value = String(Math.round(scrub.t * 1000));
    slider.dispatchEvent(new Event('input'));
  };
  const label = el('label');
  label.appendChild(toggle);
  label.appendChild(el('span', undefined, 'pauza'));
  box.appendChild(row(label, which, button('<', () => step(-1)), button('>', () => step(1))));
  box.appendChild(row(slider));
  box.appendChild(readout);
  refresh();
  return box;
}

function animationPanel(): HTMLDivElement {
  const box = panel('Animacje');
  const slider = el('input');
  slider.type = 'range';
  slider.min = '0.4';
  slider.max = '2.5';
  slider.step = '0.1';
  slider.value = '1';
  const readout = el('span', undefined, 'x1.0');
  slider.addEventListener('input', () => {
    intensity = parseFloat(slider.value);
    readout.textContent = `x${intensity.toFixed(1)}`;
  });
  box.appendChild(row(el('span', undefined, 'sila'), slider, readout));

  const buttons = row();
  for (const primitive of PRIMITIVES) {
    if (primitive === 'idle') continue;
    const def = PRIMITIVE_DEFS[primitive];
    const btn = button(primitive, () => {
      playNow(primitive);
      log(`animacja <i>${primitive}</i> x${intensity.toFixed(1)}`);
    });
    btn.title = `${def.durationMs} ms, priorytet ${def.priority}${def.sustained ? ', do obudzenia' : ''}`;
    buttons.appendChild(btn);
  }
  box.appendChild(buttons);
  box.appendChild(
    row(
      button('Obudz (wake)', () => {
        animator.wake();
        log('obudzony');
      }),
      button('W lewo', () => playNow('walk', -intensity)),
      button('W prawo', () => playNow('walk', intensity)),
    ),
  );
  box.appendChild(
    el(
      'div',
      'caption',
      'Priorytet decyduje, co czego nie przerwie: doze i reakcje bija ruch wlasny (0), topple bije wszystko. ' +
        'Znak sily to kierunek dla walk i warp.',
    ),
  );
  return box;
}

function eventPanel(): HTMLDivElement {
  const box = panel('Zdarzenia z gry');

  const streak = number(1, 1, 30, '4em');
  box.appendChild(
    row(button('kill', () => fire({ type: 'kill', streak: parseInt(streak.value, 10) || 1 })), el('span', undefined, 'seria'), streak),
  );

  const improveFrom = number(3, 0, 15, '4em');
  const improveTo = number(4, 0, 15, '4em');
  box.appendChild(
    row(
      button('improve', () => fire({ type: 'improve', from: parseInt(improveFrom.value, 10), to: parseInt(improveTo.value, 10) })),
      improveFrom,
      el('span', undefined, '->'),
      improveTo,
      button('niebotyczne (15)', () => fire({ type: 'improve', from: 14, to: 15 })),
    ),
  );

  const levels = number(1, 1, 6, '4em');
  box.appendChild(
    row(
      button('hurt', () => fire({ type: 'hurt', levelsLost: parseInt(levels.value, 10) || 1 })),
      el('span', undefined, 'poziomy kondycji'),
      levels,
      button('death', () => fire({ type: 'death' })),
    ),
  );

  const copper = number(120, 0, 1_000_000, '7em');
  box.appendChild(
    row(
      button('loot', () => fire({ type: 'loot', copper: parseInt(copper.value, 10) || 0 })),
      button('spend', () => fire({ type: 'spend', copper: parseInt(copper.value, 10) || 0 })),
      el('span', undefined, 'miedziaki'),
      copper,
      button('sell', () => fire({ type: 'sell' })),
    ),
  );

  box.appendChild(
    row(
      button('gem: mithryl', () => fire({ type: 'gem', copper: COPPER_PER.mithryl })),
      button('gem: 2 mithryle (priorytet)', () => fire({ type: 'gem', copper: 2 * COPPER_PER.mithryl })),
      button('gem: grosze', () => fire({ type: 'gem', copper: 12 })),
      button('idle -> drzemka', () => fire({ type: 'idle' })),
    ),
  );

  const restraint = el('input');
  restraint.type = 'checkbox';
  restraint.checked = true;
  restraint.addEventListener('change', () => {
    restrained = restraint.checked;
  });
  const label = el('label');
  label.appendChild(restraint);
  label.appendChild(el('span', undefined, 'powsciagliwosc (przerwy i losowanie kwestii)'));
  box.appendChild(
    row(
      label,
      button('Wyzeruj przerwy', () => {
        speaker.reset();
        log('przerwy wyzerowane');
      }),
    ),
  );
  box.appendChild(
    el('div', 'caption', 'Bez powsciagliwosci kazde zdarzenie mowi - tak sie oglada kwestie, nie tak dziala plugin.'),
  );
  return box;
}

function ambientPanel(): HTMLDivElement {
  const box = panel('Ruch wlasny');
  const select = el('select');
  for (const level of AMBIENT_LEVELS) {
    const option = el('option', undefined, AMBIENT_LABELS[level]);
    option.value = level;
    select.appendChild(option);
  }
  select.value = ambientLevel;
  const gaps = el('div', 'caption');
  const describeGaps = () => {
    const scale = LEVEL_SCALE[ambientLevel];
    gaps.textContent =
      scale === 0
        ? 'Wylaczony: towarzysz stoi, oddycha i mruga, i nic wiecej.'
        : `Co ${Math.round((AMBIENT_MIN_GAP_MS * scale) / 1000)}-${Math.round((AMBIENT_MAX_GAP_MS * scale) / 1000)} s, ` +
          'o ile nic innego sie nie dzieje. Spacer 8x, migotanie 4x, teleport 2x na dziesiec losowan.';
  };
  select.addEventListener('change', () => {
    ambientLevel = select.value as AmbientLevel;
    animator.setAmbientLevel(ambientLevel);
    describeGaps();
    log(`ruch wlasny: <i>${AMBIENT_LABELS[ambientLevel]}</i>`);
  });
  animator.setAmbientLevel(ambientLevel);
  describeGaps();
  box.appendChild(
    row(
      el('span', undefined, 'czestotliwosc'),
      select,
      button('Teraz', () => {
        requested = 'idle'; // whatever it picks, this one was asked for
        animator.playAmbient(clock());
      }),
    ),
  );
  box.appendChild(gaps);
  return box;
}

const stateTable = el('table');

function statePanel(): HTMLDivElement {
  const box = panel('Stan');
  box.appendChild(stateTable);
  return box;
}

const sheetCanvas = el('canvas');
sheetCanvas.id = 'sheet';

function sheetPanel(): HTMLDivElement {
  const box = panel('Arkusz', true);
  box.appendChild(sheetCanvas);
  box.appendChild(
    el(
      'div',
      'caption',
      `Wiersze w kolejnosci z tools/mixer/manifest.json, ${sheet?.frameWidth ?? '?'}x${sheet?.frameHeight ?? '?'} px na klatke. ` +
        'Zaznaczona jest klatka rysowana w tej chwili.',
    ),
  );
  return box;
}

const logBox = el('div');
logBox.id = 'log';

function logPanel(): HTMLDivElement {
  const box = panel('Log', true);
  box.appendChild(logBox);
  return box;
}

// ---------------------------------------------------------------------------
// The live readouts
// ---------------------------------------------------------------------------

const SHEET_SCALE = 3;
const LABEL_W = 62;

/** The sheet as it actually is - frame size and frame counts come from it, not from our own art. */
function drawSheet(current: { animation: string; phase: number }): void {
  const ctx = sheetCanvas.getContext('2d');
  if (!ctx || !sheet) return;
  const entries = Object.entries(sheet.animations);
  const fw = sheet.frameWidth * SHEET_SCALE;
  const fh = sheet.frameHeight * SHEET_SCALE;
  const columns = Math.max(1, ...entries.map(([, a]) => a.frames));
  const width = LABEL_W + columns * fw;
  const height = entries.length * fh;
  if (sheetCanvas.width !== width || sheetCanvas.height !== height) {
    sheetCanvas.width = width;
    sheetCanvas.height = height;
    sheetCanvas.style.width = `${width}px`;
  }
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;
  ctx.font = '10px ui-monospace, Consolas, monospace';
  ctx.textBaseline = 'middle';
  for (const [name, animation] of entries) {
    const y = animation.row * fh;
    const active = name === current.animation;
    ctx.fillStyle = active ? '#c9a227' : '#9aa0a8';
    ctx.fillText(name, 2, y + fh / 2);
    const here = frameIndex(current.phase, animation.frames);
    for (let column = 0; column < animation.frames; column++) {
      const rect = frameRect(sheet, name, (column + 0.5) / animation.frames);
      const x = LABEL_W + column * fw;
      ctx.drawImage(sheet.image, rect.x, rect.y, rect.width, rect.height, x, y, fw, fh);
      if (active && column === here) {
        ctx.strokeStyle = '#c9a227';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, fw - 1, fh - 1);
      }
    }
  }
}

function drawState(now: number): void {
  const pose = animator.pose(now);
  const primitive = animator.current(now) as Primitive;
  const value = readMood(mood, Date.now());
  const rows: [string, string][] = [
    ['animacja', `${primitive}${primitive === 'idle' ? '' : ` (${PRIMITIVE_DEFS[primitive].durationMs} ms)`}`],
    ['klatka', `${pose.frame.animation} @ ${(pose.frame.phase * 100).toFixed(0)}% -> ${sheet ? frameIndex(pose.frame.phase, sheet.animations[pose.frame.animation]?.frames ?? 1) : '-'}`],
    ['polozenie', `dx ${pose.dx.toFixed(2)}  dy ${pose.dy.toFixed(2)}`],
    ['skala', `sx ${pose.sx.toFixed(2)}  sy ${pose.sy.toFixed(2)}  obrot ${pose.rot.toFixed(2)}`],
    ['efekty', `blysk ${pose.flash.toFixed(2)}  swiatlo ${pose.beam.toFixed(2)}  krycie ${pose.alpha.toFixed(2)}  iskry ${pose.sparkle.toFixed(2)}  zzz ${pose.zz.toFixed(2)}`],
    ['nastroj', `${value.toFixed(3)} - ${bucketLabel(value)} (${bucket(value)})`],
  ];
  stateTable.textContent = '';
  for (const [key, text] of rows) {
    const tr = el('tr');
    tr.appendChild(el('td', 'k', key));
    tr.appendChild(el('td', undefined, text));
    stateTable.appendChild(tr);
  }
  drawSheet(pose.frame);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

app.appendChild(stagePanel());
app.appendChild(companionPanel());
app.appendChild(animationPanel());
app.appendChild(eventPanel());
app.appendChild(ambientPanel());
app.appendChild(scrubPanel());
app.appendChild(statePanel());
app.appendChild(sheetPanel());
app.appendChild(logPanel());

applySpec(spec);

let lastPrimitive: Primitive = 'idle';
function tick(now: number): void {
  if (scrub.on) drawScrubbed(now);
  drawState(now);
  // The animator starts ambient actions on its own; say so, so the log shows
  // what happened while you were not looking.
  const primitive = animator.current(now);
  if (primitive !== lastPrimitive) {
    const own = primitive === 'walk' || primitive === 'warp' || primitive === 'flicker';
    if (own && requested === null) log(`sam z siebie: <i>${primitive}</i>`);
    requested = null;
    lastPrimitive = primitive;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
