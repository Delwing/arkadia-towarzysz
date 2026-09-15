/**
 * The `/towarzysz` settings panel: mute toggles, voice override, cooldown,
 * idle time, a "say something" test, and the one-time reroll behind a
 * confirmation.
 *
 * Plain DOM, no framework: the registry compiles plugins with no dependencies.
 */

import { AMBIENT_LEVELS, CATEGORIES, type AmbientLevel, type Archetype, type Category, type PersistedState } from '../companion/types';
import { bucketLabel } from '../companion/mood';
import { MAX_REROLLS } from '../companion/state';
import { VOICE_IDS, voiceName } from '../voice/catalog';
import { CATEGORY_RULES } from '../voice/speak';
import { GEM_PRIORITY_COPPER, PRIORITY_CATEGORIES } from '../events/bindings';
import { COPPER_PER } from '../text/coins';

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

export interface SettingsView {
  characterName: string | null;
  state: PersistedState | null;
  /** Current, decayed mood value. */
  mood: number;
}

export interface SettingsHandlers {
  onToggleGlobalMute(muted: boolean): void;
  onToggleCategoryMute(category: Category, muted: boolean): void;
  onVoiceOverride(voiceId: string | null): void;
  onCooldownSeconds(seconds: number): void;
  onIdleMinutes(minutes: number): void;
  onAmbientLevel(level: AmbientLevel): void;
  onSaySomething(): void;
  /** The preview button: one ambient action now. */
  onAmbient(): void;
  /** Called only after the confirmation. */
  onReroll(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, style?: Partial<CSSStyleDeclaration>): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (style) Object.assign(node.style, style);
  return node;
}

function section(title: string): HTMLDivElement {
  const box = el('div', undefined, { marginBottom: '12px' });
  box.appendChild(el('div', title, { fontWeight: '600', marginBottom: '4px', fontSize: '12px', opacity: '0.85' }));
  return box;
}

function checkbox(label: string, checked: boolean, onChange: (value: boolean) => void): HTMLLabelElement {
  const wrap = el('label', undefined, { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' });
  const input = el('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  wrap.appendChild(input);
  wrap.appendChild(el('span', label));
  return wrap;
}

function numberField(label: string, value: number, min: number, max: number, onChange: (value: number) => void): HTMLLabelElement {
  const wrap = el('label', undefined, { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' });
  wrap.appendChild(el('span', label));
  const input = el('input', undefined, { width: '64px' });
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  input.addEventListener('change', () => {
    const parsed = parseFloat(input.value);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.min(max, Math.max(min, parsed));
    input.value = String(clamped);
    onChange(clamped);
  });
  wrap.appendChild(input);
  return wrap;
}

function button(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const btn = el('button', label, { fontSize: '12px', padding: '2px 8px', cursor: disabled ? 'default' : 'pointer' });
  btn.type = 'button';
  btn.disabled = disabled;
  btn.addEventListener('click', onClick);
  return btn;
}

/** Builds the panel's DOM. Cheap, so the popup rebuilds it every time it opens. */
export function buildSettingsPanel(view: SettingsView, handlers: SettingsHandlers): HTMLDivElement {
  const root = el('div', undefined, { padding: '8px 10px', minWidth: '240px', maxWidth: '360px', fontSize: '12px' });
  const { state } = view;

  const header = el('div', undefined, { marginBottom: '10px' });
  if (!state || !view.characterName) {
    header.appendChild(el('div', 'Towarzysz czeka, az klient poda imie postaci.'));
    root.appendChild(header);
    root.appendChild(attribution());
    return root;
  }

  header.appendChild(el('div', state.spec.name, { fontWeight: '700', fontSize: '14px' }));
  header.appendChild(
    el(
      'div',
      `${ARCHETYPE_LABELS[state.spec.archetype]} - glos: ${voiceName(state.settings.voiceOverride ?? state.spec.voiceId)}` +
        (state.settings.voiceOverride ? ` (wylosowany: ${voiceName(state.spec.voiceId)})` : ''),
      { opacity: '0.8' },
    ),
  );
  header.appendChild(
    el(
      'div',
      `nastroj: ${bucketLabel(view.mood)} (${view.mood.toFixed(2)}) - zabicia ${state.stats.kills}, smierci ${state.stats.deaths}, sesje ${state.stats.sessions}`,
      { opacity: '0.7', fontSize: '11px' },
    ),
  );
  root.appendChild(header);

  const mutes = section('Cisza');
  mutes.appendChild(checkbox('Calkowita cisza (nic nie mowi)', state.mutes.global, handlers.onToggleGlobalMute));
  const grid = el('div', undefined, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 10px', marginTop: '4px' });
  for (const category of CATEGORIES) {
    grid.appendChild(
      checkbox(CATEGORY_LABELS[category], state.mutes.categories.includes(category), (muted) =>
        handlers.onToggleCategoryMute(category, muted),
      ),
    );
  }
  mutes.appendChild(grid);
  root.appendChild(mutes);

  const voice = section('Glos');
  const select = el('select', undefined, { fontSize: '12px' });
  const rolled = el('option', `Wylosowany (${voiceName(state.spec.voiceId)})`);
  rolled.value = '';
  select.appendChild(rolled);
  for (const id of VOICE_IDS) {
    const option = el('option', voiceName(id));
    option.value = id;
    select.appendChild(option);
  }
  select.value = state.settings.voiceOverride ?? '';
  select.addEventListener('change', () => handlers.onVoiceOverride(select.value === '' ? null : select.value));
  voice.appendChild(select);
  root.appendChild(voice);

  const timing = section('Powsciagliwosc');
  timing.appendChild(
    numberField('Minimalna przerwa miedzy kwestiami (s)', Math.round(state.settings.globalCooldownMs / 1000), 5, 600, handlers.onCooldownSeconds),
  );
  timing.appendChild(numberField('Drzemka po bezczynnosci (min)', state.settings.idleMinutes, 1, 120, handlers.onIdleMinutes));
  // The priority tier is invisible otherwise: someone who sets the pause to
  // ten minutes and then hears a line about their death would call it a bug.
  timing.appendChild(
    el(
      'div',
      `Przerwa nie dotyczy rzadkich zdarzen: ${PRIORITY_CATEGORIES.map((category) => CATEGORY_LABELS[category].toLowerCase()).join(', ')}. ` +
        'Te mozna uciszyc tylko cisza.',
      { opacity: '0.7', fontSize: '11px', marginTop: '4px' },
    ),
  );
  timing.appendChild(
    el(
      'div',
      `Kamien musi byc przy tym wart co najmniej ${GEM_PRIORITY_COPPER / COPPER_PER.mithryl} mithryle ` +
        `i przebija przerwe najwyzej raz na ${Math.round((CATEGORY_RULES.gemGood.priorityWindowMs ?? 0) / 60_000)} min.`,
      { opacity: '0.7', fontSize: '11px' },
    ),
  );
  root.appendChild(timing);

  const life = section('Ruch wlasny');
  const ambient = el('select', undefined, { fontSize: '12px' });
  for (const level of AMBIENT_LEVELS) {
    const option = el('option', AMBIENT_LABELS[level]);
    option.value = level;
    ambient.appendChild(option);
  }
  ambient.value = state.settings.ambientLevel;
  ambient.addEventListener('change', () => handlers.onAmbientLevel(ambient.value as AmbientLevel));
  life.appendChild(ambient);
  life.appendChild(
    el(
      'div',
      'Co jakis czas, gdy nic sie nie dzieje, towarzysz przejdzie sie po stopce, zamigocze albo zniknie i wroci. ' +
        'Nigdy nie przerywa reakcji i nigdy przy tym nic nie mowi.',
      { opacity: '0.7', fontSize: '11px', marginTop: '4px' },
    ),
  );
  root.appendChild(life);

  const actions = section('Akcje');
  const row = el('div', undefined, { display: 'flex', gap: '6px', flexWrap: 'wrap' });
  row.appendChild(button('Powiedz cos', handlers.onSaySomething));
  row.appendChild(button('Przejdz sie', handlers.onAmbient));
  const rerollsLeft = MAX_REROLLS - state.rerollsUsed;
  const rerollBtn = button(
    rerollsLeft > 0 ? 'Losuj od nowa (jedyny raz)' : 'Losowanie od nowa juz wykorzystane',
    () => {
      const ok = window.confirm(
        `Losowanie od nowa jest nieodwracalne i mozliwe tylko raz. ${state.spec.name} odejdzie na dobre. Na pewno?`,
      );
      if (ok) handlers.onReroll();
    },
    rerollsLeft <= 0,
  );
  row.appendChild(rerollBtn);
  actions.appendChild(row);
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
