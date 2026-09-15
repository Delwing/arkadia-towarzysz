/**
 * The `/towarzysz` window: the companion's card. Who they are, what they look
 * like, how they feel and what you have been through together - and two ways
 * to poke them.
 *
 * Deliberately not a settings panel. The companion is rolled, not configured:
 * there is no reroll, no voice picker, no cooldown box and no mute grid here.
 * What is left of that - the global silence - is a command, `/towarzysz cisza`,
 * so the card can stay a card.
 *
 * Plain DOM, no framework: the registry compiles plugins with no dependencies.
 */

import type { AmbientLevel, Archetype, Category, PersistedState } from '../companion/types';
import { bucketLabel } from '../companion/mood';
import { voiceName } from '../voice/catalog';

/** The plugin's own page; the sprite art is this repository's, so there is nobody else to credit. */
export const ATTRIBUTION_URL = 'https://github.com/Delwing/arkadia-towarzysz';
/**
 * The art is ours, but the list of animations worth having - a walk, a flash,
 * a warp, a sit, a soul leaving the body - and the art itself both come from
 * KingBell's tool (CC-BY 4.0). The link-back is the credit it asks for.
 */
export const MIXER_URL = 'https://kingbell.itch.io/pixel-sprite-mixer';

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
  idle: 'Bezczynnosc',
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
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, style?: Partial<CSSStyleDeclaration>): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (style) Object.assign(node.style, style);
  return node;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const btn = el('button', label, { fontSize: '12px', padding: '2px 8px', cursor: 'pointer' });
  btn.type = 'button';
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
function moodBar(mood: number): HTMLDivElement {
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

/** Long hair, a weapon: the two rolled details the art actually shows. */
function traits(state: PersistedState): string {
  const parts: string[] = [state.spec.parts.hairLong ? 'dlugie wlosy' : 'krotkie wlosy'];
  parts.push(state.spec.parts.hasWeapon ? 'z bronia' : 'bez broni');
  return parts.join(', ');
}

function metLine(state: PersistedState): string {
  const since = new Date(state.metAt);
  const date = Number.isFinite(since.getTime()) ? since.toLocaleDateString('pl-PL') : '?';
  return `Razem od ${date}.`;
}

/** Builds the card's DOM. Cheap, so the popup rebuilds it every time it opens. */
export function buildCompanionCard(view: CardView, handlers: CardHandlers): HTMLDivElement {
  const root = el('div', undefined, { padding: '10px 12px', minWidth: '240px', maxWidth: '320px', fontSize: '12px' });
  const { state } = view;

  if (!state || !view.characterName) {
    root.appendChild(el('div', 'Towarzysz czeka, az klient poda imie postaci.'));
    root.appendChild(attribution());
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
  who.appendChild(el('div', traits(state), { opacity: '0.7', fontSize: '11px' }));
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
  mood.appendChild(moodBar(view.mood));
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
  root.appendChild(actions);

  root.appendChild(attribution());
  return root;
}

function attribution(): HTMLDivElement {
  const box = el('div', undefined, { marginTop: '10px', paddingTop: '6px', borderTop: '1px solid rgba(128,128,128,.35)', fontSize: '10px', opacity: '0.75' });
  box.appendChild(document.createTextNode("Grafika: wlasne pikselowe sprite'y - "));
  const link = el('a', 'arkadia-towarzysz');
  link.href = ATTRIBUTION_URL;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  box.appendChild(link);
  box.appendChild(document.createTextNode('. Zestaw animacji wzorowany na '));
  const mixer = el('a', "KingBell's Pixel Art Sprite Mixer");
  mixer.href = MIXER_URL;
  mixer.target = '_blank';
  mixer.rel = 'noopener noreferrer';
  box.appendChild(mixer);
  box.appendChild(document.createTextNode('. Komendy: /towarzysz, /towarzysz cisza.'));
  return box;
}
