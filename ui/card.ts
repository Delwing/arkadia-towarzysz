/**
 * The `/towarzysz` window: the companion's card. Who they are, what they look
 * like, how they feel and what you have been through together - two ways to
 * poke them, and a picture of them to take away.
 *
 * Deliberately not a settings panel. The companion is rolled, not configured:
 * there is no reroll, no voice picker, no cooldown box and no mute grid here.
 * What is left of that - the global silence - is a command, `/towarzysz cisza`,
 * so the card can stay a card.
 *
 * Plain DOM, no framework: the registry compiles plugins with no dependencies.
 */

import type { AmbientLevel, Archetype, Category, PersistedState } from '../companion/types';
import { temperLabel } from '../companion/temper';
import { bucketLabel } from '../companion/mood';
import { voiceName } from '../voice/catalog';
import type { PictureOutcome } from './picture';


export const CATEGORY_LABELS: Record<Category, string> = {
  kill: 'Zabicia',
  improve: 'Postepy',
  improveMax: 'Niebotyczne postepy',
  hurt: 'Obrazenia',
  death: 'Smierc',
  loot: 'Lupy (monety)',
  spend: 'Wydatki',
  sell: 'Sprzedaz',
  gemGood: 'Cenne kamienie',
  gemBad: 'Kiepskie kamienie',
  intox: 'Trunki',
  hangover: 'Kac',
  fatigue: 'Zmeczenie',
  knowledge: 'Wiedza',
  clear: 'Oczyszczona lokacja',
  stun: 'Ogluszenie',
  panic: 'Panika',
  apocalypse: 'Zniszczenie swiata',
  pipe: 'Fajka',
  mail: 'Poczta',
  fishBite: 'Branie',
  fishCatch: 'Zlowione ryby',
  travel: 'Podroz',
  transform: 'Przeobrazenie',
  idle: 'Bezczynnosc',
  bored: 'Nuda',
  temper: 'Powitanie',
};

export const AMBIENT_LABELS: Record<AmbientLevel, string> = {
  off: 'wylaczony',
  rare: 'rzadko',
  normal: 'normalnie',
  often: 'czesto',
};

export const ARCHETYPE_LABELS: Record<Archetype, string> = {
  magician: 'mag',
  wizard: 'czarodziej',
  villager: 'wiesniak',
  monster: 'potwor',
  ogre: 'ogr',
  orc: 'ork',
  goblin: 'goblin',
};

/** The palette rows shown as swatches, in the order they read on the figure. */
const PALETTE_ROWS: readonly { key: 'hair' | 'skin' | 'armour' | 'belt' | 'legs' | 'weapon'; label: string }[] = [
  { key: 'hair', label: 'wlosy' },
  { key: 'skin', label: 'skora' },
  { key: 'armour', label: 'stroj' },
  { key: 'belt', label: 'pas' },
  { key: 'legs', label: 'nogi' },
  { key: 'weapon', label: 'bron' },
];

export interface CardView {
  characterName: string | null;
  state: PersistedState | null;
  /** Current, decayed mood value. */
  mood: number;
  /**
   * The live companion, built by the plugin - it owns the animator and the
   * sprite sheet, and it owns the render loop this element is running.
   */
  portrait: HTMLElement | null;
}

export interface CardHandlers {
  onSaySomething(): void;
  /** One ambient action now: a walk, a blink, a warp. */
  onAmbient(): void;
  /**
   * Draw the companion's picture and put it somewhere the player can use it -
   * the clipboard, or a file if the clipboard is out of reach. `doc` is the
   * document the click came from, because the card can be popped out into a
   * window of its own and only the focused one may touch the clipboard.
   *
   * Must reach the clipboard inside the click, so the plugin does the drawing
   * synchronously and only the blob is awaited; the button reports whichever
   * of the two happened.
   */
  onPicture(doc: Document): Promise<PictureOutcome>;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, style?: Partial<CSSStyleDeclaration>): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (style) Object.assign(node.style, style);
  return node;
}

/**
 * A button that reads as one. The client leaves a plugin's bare <button> looking
 * like a line of text on the panel background, so the border, the fill and the
 * hover are drawn here - in neutral greys, which sit on both themes.
 */
function button(label: string, onClick: () => void): HTMLButtonElement {
  const btn = el('button', label, {
    font: 'inherit',
    fontSize: '12px',
    lineHeight: '1.4',
    color: 'inherit',
    padding: '4px 10px',
    cursor: 'pointer',
    borderRadius: '4px',
    border: '1px solid rgba(128,128,128,.45)',
    background: 'rgba(128,128,128,.14)',
    transition: 'background .12s, border-color .12s',
  });
  btn.type = 'button';
  btn.addEventListener('mouseenter', () => {
    btn.style.background = 'rgba(128,128,128,.28)';
    btn.style.borderColor = 'rgba(128,128,128,.7)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = 'rgba(128,128,128,.14)';
    btn.style.borderColor = 'rgba(128,128,128,.45)';
  });
  btn.addEventListener('click', onClick);
  return btn;
}

/** A labelled number, three to a row: the stats strip. */
function stat(label: string, value: string): HTMLDivElement {
  const box = el('div', undefined, { textAlign: 'center' });
  box.appendChild(el('div', value, { fontSize: '15px', fontWeight: '700', lineHeight: '1.1' }));
  box.appendChild(el('div', label, { fontSize: '10px', opacity: '0.7', textTransform: 'uppercase', letterSpacing: '.06em' }));
  return box;
}

function rule(): HTMLDivElement {
  return el('div', undefined, { height: '1px', background: 'rgba(128,128,128,.35)', margin: '10px 0' });
}

/**
 * The mood, drawn from the middle out: left of centre is grim, right of centre
 * is cheerful, and the length is how far it has gone. A bar filled from the
 * left would read as a gauge of something the companion can run out of, and
 * the mood is not that.
 */
function moodBar(mood: number, resting: number): HTMLDivElement {
  const value = Math.max(-1, Math.min(1, mood));
  const track = el('div', undefined, {
    position: 'relative',
    height: '6px',
    borderRadius: '3px',
    background: 'rgba(128,128,128,.25)',
    marginTop: '4px',
    overflow: 'hidden',
  });
  const fill = el('div', undefined, {
    position: 'absolute',
    top: '0',
    bottom: '0',
    width: `${(Math.abs(value) / 2) * 100}%`,
    background: 'currentColor',
    opacity: '0.55',
  });
  if (value >= 0) fill.style.left = '50%';
  else fill.style.right = '50%';
  const centre = el('div', undefined, {
    position: 'absolute',
    left: '50%',
    top: '0',
    bottom: '0',
    width: '1px',
    marginLeft: '-0.5px',
    background: 'currentColor',
    opacity: '0.5',
  });
  track.appendChild(fill);
  track.appendChild(centre);
  // Where the day is pulling. Without it a companion sitting at -0.45 all
  // evening looks like one who is sulking about something in particular.
  const settled = Math.max(-1, Math.min(1, resting));
  if (Math.abs(settled) > 0.02) {
    const mark = el('div', undefined, {
      position: 'absolute',
      top: '0',
      bottom: '0',
      width: '2px',
      marginLeft: '-1px',
      left: `${((settled + 1) / 2) * 100}%`,
      background: 'currentColor',
      opacity: '0.9',
    });
    track.appendChild(mark);
  }
  return track;
}

function swatches(state: PersistedState): HTMLDivElement {
  const box = el('div', undefined, { display: 'flex', flexWrap: 'wrap', gap: '4px 8px' });
  for (const { key, label } of PALETTE_ROWS) {
    const colour = state.spec.palette[key];
    if (!colour) continue; // no weapon, no weapon colour
    const item = el('div', undefined, { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', opacity: '0.8' });
    item.appendChild(
      el('span', undefined, {
        width: '10px',
        height: '10px',
        borderRadius: '2px',
        background: colour,
        border: '1px solid rgba(0,0,0,.4)',
        display: 'inline-block',
      }),
    );
    item.appendChild(el('span', label));
    box.appendChild(item);
  }
  return box;
}

/**
 * Since when. Flatly: "razem od" reads like an anniversary, which is not what
 * a companion is - the picture says it the same way.
 */
function metLine(state: PersistedState): string {
  const since = new Date(state.metAt);
  const date = Number.isFinite(since.getTime()) ? since.toLocaleDateString('pl-PL') : '?';
  return `Towarzyszy od ${date}.`;
}

/** How long the picture button says what it did before going back to itself. */
const PICTURE_SAID_MS = 2200;

/**
 * "Kopiuj jako obraz", the same offer the client makes in Postepy and on the
 * map. It reports back in its own label rather than in the game window: the
 * companion does not print there, and a toast for something the player just
 * asked for would be noise.
 */
function pictureButton(handlers: CardHandlers): HTMLButtonElement {
  const label = 'Kopiuj jako obraz';
  let busy = false;
  const btn = button(label, () => {
    if (busy) return;
    busy = true;
    const said = (text: string) => {
      btn.textContent = text;
      setTimeout(() => {
        btn.textContent = label;
        busy = false;
      }, PICTURE_SAID_MS);
    };
    // Synchronous on purpose: the clipboard write has to happen inside this
    // click, so nothing is awaited before `onPicture` is called.
    handlers
      .onPicture(btn.ownerDocument)
      .then((outcome) => said(outcome === 'copied' ? 'Skopiowane!' : 'Zapisane jako plik'))
      .catch(() => said('Nie udalo sie'));
  });
  btn.title = 'Obrazek z towarzyszem - do schowka, a jak sie nie da, to na dysk';
  return btn;
}

/** Builds the card's DOM. Cheap, so the popup rebuilds it every time it opens. */
export function buildCompanionCard(view: CardView, handlers: CardHandlers): HTMLDivElement {
  // The client opens a plugin popup at half the viewport and we cannot ask it
  // for less, so the card takes the whole width it is handed instead of sitting
  // in a 320px column with empty window around it.
  const root = el('div', undefined, { padding: '8px 10px', minWidth: '220px', width: '100%', boxSizing: 'border-box', fontSize: '12px' });
  const { state } = view;

  if (!state || !view.characterName) {
    root.appendChild(el('div', 'Towarzysz czeka, az klient poda imie postaci.'));
    return root;
  }

  const head = el('div', undefined, { display: 'flex', alignItems: 'flex-end', gap: '10px' });
  if (view.portrait) {
    const frame = el('div', undefined, {
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
      padding: '4px',
      borderRadius: '4px',
      background: 'rgba(128,128,128,.12)',
      border: '1px solid rgba(128,128,128,.3)',
      flex: '0 0 auto',
    });
    frame.appendChild(view.portrait);
    head.appendChild(frame);
  }

  const who = el('div', undefined, { flex: '1 1 auto', minWidth: '0' });
  who.appendChild(el('div', state.spec.name, { fontWeight: '700', fontSize: '15px', lineHeight: '1.2' }));
  who.appendChild(el('div', ARCHETYPE_LABELS[state.spec.archetype], { opacity: '0.85' }));
  who.appendChild(
    el('div', `mowi jak ${voiceName(state.settings.voiceOverride ?? state.spec.voiceId).toLowerCase()}`, {
      opacity: '0.7',
      fontSize: '11px',
    }),
  );
  head.appendChild(who);
  root.appendChild(head);

  const mood = el('div', undefined, { marginTop: '10px' });
  mood.appendChild(
    el('div', `Nastroj: ${bucketLabel(view.mood)}${state.mutes.global ? ' - i milczy' : ''}`, { fontSize: '11px', opacity: '0.85' }),
  );
  mood.appendChild(moodBar(view.mood, state.temper.resting));
  mood.appendChild(
    el('div', `Dzis: ${temperLabel(state.temper.resting)}`, { fontSize: '10px', opacity: '0.7', marginTop: '3px' }),
  );
  root.appendChild(mood);

  root.appendChild(rule());

  const stats = el('div', undefined, { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' });
  stats.appendChild(stat('zabicia', String(state.stats.kills)));
  stats.appendChild(stat('smierci', String(state.stats.deaths)));
  stats.appendChild(stat('sesje', String(state.stats.sessions)));
  root.appendChild(stats);
  root.appendChild(el('div', metLine(state), { fontSize: '10px', opacity: '0.7', textAlign: 'center', marginTop: '4px' }));

  root.appendChild(rule());

  root.appendChild(el('div', 'Barwy', { fontSize: '10px', opacity: '0.7', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.06em' }));
  root.appendChild(swatches(state));

  const actions = el('div', undefined, { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' });
  actions.appendChild(button('Zagadnij', handlers.onSaySomething));
  actions.appendChild(button('Przejdz sie', handlers.onAmbient));
  actions.appendChild(pictureButton(handlers));
  root.appendChild(actions);
  return root;
}


