/**
 * Towarzysz - a pixel-art companion who lives in the Arkadia Web Client's footer.
 *
 * Rolled once per character (random archetype, look, voice and name), reacts
 * to what happens in the session with small animations, and occasionally says
 * something in a speech bubble above the footer. Has a mood that drifts with
 * how the session goes. Has no needs, cannot be neglected, cannot die.
 *
 * `/towarzysz` opens the settings; `/towarzysz cisza` toggles the global mute.
 *
 * Everything user-facing is ASCII-folded Polish, like the rest of the client.
 * Nothing here is allowed to throw into the client's event loop: every
 * handler is wrapped. See README.md and docs/ for the design.
 */

import type { PluginApi, PluginInfo } from '@arkadia/plugin-types';

import type { AmbientLevel, Category, PersistedState } from './companion/types';
import { bucket, bucketLabel, nudge, read as readMood } from './companion/mood';
import { load, pickStorage, reroll, save, type KeyValueStorage } from './companion/state';
import { VOICES, voiceName } from './voice/catalog';
import { Speaker } from './voice/speak';
import { Animator } from './render/animator';
import { buildSheet } from './render/sheet';
import { Chip } from './ui/chip';
import { Bubble } from './ui/bubble';
import { AMBIENT_LABELS, buildSettingsPanel, type SettingsHandlers, type SettingsView } from './ui/settings';
import { resolve, type GameEvent } from './events/bindings';
import { attachSources, type Sources } from './events/sources';
import { coinsToCopper } from './text/coins';

const PLUGIN_NAME = 'Towarzysz';
const PLUGIN_VERSION = '1.0.0';
const PLUGIN_AUTHOR = 'Dargoth';
const PLUGIN_DESCRIPTION =
  'Pikselowy towarzysz w stopce - losowany raz na postac, reaguje na to, co dzieje sie w grze, czasem cos powie. ' +
  "Sterowanie: /towarzysz. Grafika: wlasne pikselowe sprite'y.";

const FOOTER_ID = 'towarzysz';
const POPUP_ID = 'towarzysz-ustawienia';
const SAVE_DEBOUNCE_MS = 500;
const MOOD_LABEL_REFRESH_MS = 30_000;

/**
 * The animator runs on the requestAnimationFrame clock (performance.now()),
 * not on Date.now(): the chip's render loop is driven by rAF timestamps and
 * both sides must agree on a time base or every primitive freezes at t = 0.
 */
function animationNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function log(message: string, error?: unknown): void {
  try {
    if (error !== undefined) console.warn(`[Towarzysz] ${message}`, error);
    else console.info(`[Towarzysz] ${message}`);
  } catch {
    // Even logging is not allowed to break anything.
  }
}

/** Minimal shapes of the popup API, used structurally so an older client without it still loads the plugin. */
interface PopupLike {
  open(): Promise<void> | void;
  close(): void;
  setBody(content: string | Node): void;
  readonly isOpen?: boolean;
}

interface UiWithPopups {
  registerPersistentPopup?(config: {
    id: string;
    title: string;
    createContent: () => Node | Promise<Node>;
  }): Promise<PopupLike>;
  createPopup?(title: string, body: Node): Promise<PopupLike>;
}

class Towarzysz {
  private readonly api: PluginApi;
  private readonly storage: KeyValueStorage;
  private readonly speaker: Speaker;
  private readonly animator: Animator;
  private readonly chip: Chip;
  private readonly bubble: Bubble;
  private readonly footer: ReturnType<PluginApi['ui']['registerFooterComponent']>;
  private sources: Sources | null = null;
  private popup: PopupLike | null = null;
  private popupPromise: Promise<PopupLike | null> | null = null;
  private aliasIds: string[] = [];

  private characterName: string | null = null;
  private state: PersistedState | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private labelTimer: ReturnType<typeof setInterval> | null = null;
  private sheetWarned = false;

  constructor(api: PluginApi) {
    this.api = api;
    this.storage = pickStorage();
    this.speaker = new Speaker();
    this.animator = new Animator(Date.now());
    this.chip = new Chip({ animator: this.animator, onClick: () => void this.openSettings() });
    this.bubble = new Bubble();

    // The registry clones a Node it is handed, so the chip is appended into
    // the plugin-owned span after registration instead of being passed in.
    this.footer = api.ui.registerFooterComponent(FOOTER_ID, '', 'end');
    this.footer.element.appendChild(this.chip.element);
    this.chip.setSpec(null);
    this.chip.setMoodLabel('');
    this.chip.start();
  }

  start(): void {
    this.sources = attachSources(
      this.api,
      {
        onEvent: (event) => this.handle(event),
        onActivity: () => this.animator.wake(),
        onRespawn: () => this.animator.revive(),
        onCharacter: (name) => this.loadCharacter(name),
        onDisconnect: () => this.flushSave(),
      },
      {
        idleMs: () => (this.state?.settings.idleMinutes ?? 5) * 60_000,
        coinsToCopper,
        onError: (error) => log('blad w obsludze zdarzenia', error),
      },
    );

    this.labelTimer = setInterval(() => this.refreshMoodLabel(), MOOD_LABEL_REFRESH_MS);

    this.aliasIds.push(
      this.api.aliases.register(/^\/towarzysz(?:\s+([\s\S]+))?$/i, (matches) => {
        try {
          this.handleCommand(matches?.[1]);
        } catch (error) {
          log('blad komendy', error);
        }
        return true;
      }),
    );

    window.addEventListener('beforeunload', this.flushSave);

    // A pinned settings popup from a previous session comes back on its own.
    void this.ensurePopup();
  }

  destroy(): void {
    window.removeEventListener('beforeunload', this.flushSave);
    this.flushSave();
    this.sources?.detach();
    this.sources = null;
    if (this.labelTimer) clearInterval(this.labelTimer);
    this.labelTimer = null;
    for (const id of this.aliasIds) {
      try {
        this.api.aliases.remove(id);
      } catch {
        // Already gone.
      }
    }
    this.aliasIds = [];
    try {
      this.popup?.close();
    } catch {
      // Popup may already be closed.
    }
    this.popup = null;
    this.bubble.destroy();
    this.chip.destroy();
    try {
      this.footer.remove();
    } catch {
      // Host may have removed it already.
    }
  }

  // ---------------------------------------------------------------- character

  private loadCharacter(name: string): void {
    if (this.characterName === name && this.state) return;
    this.flushSave();
    this.characterName = name;
    const state = load(name, this.storage);
    state.stats.sessions += 1;
    this.state = state;
    this.speaker.reset();
    this.speaker.setGlobalCooldown(state.settings.globalCooldownMs);
    this.animator.setAmbientLevel(state.settings.ambientLevel);
    this.animator.wake();
    this.applySpec();
    this.scheduleSave();
    this.sources?.restartIdleTimer();
    this.refreshPopup();
    log(`${state.spec.name} (${state.spec.archetype}, ${voiceName(state.spec.voiceId)}) towarzyszy postaci ${name}.`);
  }

  private applySpec(): void {
    const state = this.state;
    if (!state) {
      this.chip.setSpec(null);
      this.chip.setSheet(null);
      return;
    }
    this.chip.setSpec(state.spec);
    this.refreshMoodLabel();

    // Building the sheet is synchronous and cheap (a few thousand pixels), so
    // there is no load to race and no token to guard: the chip either gets
    // this companion's sheet or keeps drawing the procedural figure.
    try {
      this.chip.setSheet(buildSheet(state.spec));
    } catch (error) {
      this.chip.setSheet(null);
      if (!this.sheetWarned) {
        this.sheetWarned = true;
        log('nie udalo sie zbudowac arkusza sprite - towarzysz zostanie niewidoczny', error);
      }
    }
  }

  // ------------------------------------------------------------------- events

  private handle(event: GameEvent): void {
    const state = this.state;
    if (!state) return;
    const reaction = resolve(event);
    if (!reaction) return;
    const now = Date.now();

    if (event.type === 'kill') state.stats.kills += 1;
    if (event.type === 'death') state.stats.deaths += 1;

    const mood = nudge({ value: state.mood, touchedAt: state.moodTouchedAt }, reaction.moodDelta, now);
    state.mood = mood.value;
    state.moodTouchedAt = mood.touchedAt;

    // Animation is never gated by restraint: they always react, they rarely speak.
    this.animator.play(reaction.primitive, reaction.intensity, animationNow());
    this.refreshMoodLabel();

    const line = this.speaker.maybe(this.voice(), reaction.category, bucket(mood.value), state.mutes, now, {
      priority: reaction.priority === true,
    });
    if (line) this.bubble.show(line, this.chip.element);

    this.scheduleSave();
  }

  private voice() {
    const state = this.state;
    if (!state) return undefined;
    return VOICES[state.settings.voiceOverride ?? state.spec.voiceId];
  }

  private currentMood(): number {
    const state = this.state;
    if (!state) return 0;
    return readMood({ value: state.mood, touchedAt: state.moodTouchedAt }, Date.now());
  }

  private refreshMoodLabel(): void {
    this.chip.setMoodLabel(this.state ? bucketLabel(this.currentMood()) : '');
  }

  // ------------------------------------------------------------------ storage

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flushSave();
    }, SAVE_DEBOUNCE_MS);
  }

  private flushSave = (): void => {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.characterName && this.state) save(this.characterName, this.state, this.storage);
  };

  // ----------------------------------------------------------------- commands

  private handleCommand(rawArgs: string | undefined): void {
    const args = (rawArgs ?? '').trim().toLowerCase();
    const print = (text: string) => this.api.output.print(`--- Towarzysz: ${text}`);

    if (args === '' || args === 'ustawienia') {
      void this.openSettings();
      return;
    }
    if (args === 'cisza') {
      const state = this.state;
      if (!state) {
        print('jeszcze nie wiem, kim jestes - poczekaj na imie postaci.');
        return;
      }
      state.mutes.global = !state.mutes.global;
      this.scheduleSave();
      this.refreshPopup();
      print(state.mutes.global ? `${state.spec.name} milczy.` : `${state.spec.name} znow moze sie odezwac.`);
      return;
    }
    if (args === 'status') {
      const state = this.state;
      if (!state) {
        print('czekam na imie postaci.');
        return;
      }
      print(
        `${state.spec.name} (${state.spec.archetype}), glos: ${voiceName(state.settings.voiceOverride ?? state.spec.voiceId)}, ` +
          `nastroj: ${bucketLabel(this.currentMood())}, ${state.mutes.global ? 'cisza' : 'mowi'}` +
          `, ruch wlasny: ${AMBIENT_LABELS[state.settings.ambientLevel]}` +
          (state.mutes.categories.length ? `, wyciszone: ${state.mutes.categories.join(', ')}` : '') +
          `. Zabicia ${state.stats.kills}, smierci ${state.stats.deaths}, sesje ${state.stats.sessions}.`,
      );
      return;
    }
    if (args === 'powiedz') {
      this.saySomething();
      return;
    }
    if (args === 'ruch') {
      if (!this.state) {
        print('czekam na imie postaci.');
        return;
      }
      this.animator.playAmbient(animationNow());
      return;
    }
    print('/towarzysz [cisza|status|powiedz|ruch]');
  }

  private saySomething(): void {
    const state = this.state;
    if (!state) return;
    const categories: Category[] = ['idle', 'kill', 'loot', 'improve', 'hurt', 'spend'];
    const category = categories[Math.floor(Math.random() * categories.length)] as Category;
    const line = this.speaker.force(this.voice(), category, bucket(this.currentMood()));
    if (line) this.bubble.show(line, this.chip.element);
    this.animator.play('gulp', 0.8, animationNow());
  }

  // ----------------------------------------------------------------- settings

  private settingsView(): SettingsView {
    return { characterName: this.characterName, state: this.state, mood: this.currentMood() };
  }

  private settingsHandlers(): SettingsHandlers {
    const withState = (fn: (state: PersistedState) => void) => {
      const state = this.state;
      if (!state) return;
      fn(state);
      this.scheduleSave();
    };
    return {
      onToggleGlobalMute: (muted) => withState((s) => void (s.mutes.global = muted)),
      onToggleCategoryMute: (category, muted) =>
        withState((s) => {
          const set = new Set(s.mutes.categories);
          if (muted) set.add(category);
          else set.delete(category);
          s.mutes.categories = Array.from(set);
        }),
      onVoiceOverride: (voiceId) =>
        withState((s) => {
          s.settings.voiceOverride = voiceId;
          this.refreshPopup();
        }),
      onCooldownSeconds: (seconds) =>
        withState((s) => {
          s.settings.globalCooldownMs = Math.round(seconds * 1000);
          this.speaker.setGlobalCooldown(s.settings.globalCooldownMs);
        }),
      onIdleMinutes: (minutes) =>
        withState((s) => {
          s.settings.idleMinutes = minutes;
          this.sources?.restartIdleTimer();
        }),
      onAmbientLevel: (level: AmbientLevel) =>
        withState((s) => {
          s.settings.ambientLevel = level;
          this.animator.setAmbientLevel(level);
        }),
      onSaySomething: () => this.saySomething(),
      onAmbient: () => this.animator.playAmbient(animationNow()),
      onReroll: () => {
        const name = this.characterName;
        const state = this.state;
        if (!name || !state) return;
        const next = reroll(name, state);
        if (!next) return;
        this.state = next;
        this.speaker.reset();
        this.applySpec();
        this.animator.play('cheer', 1.5, animationNow());
        this.flushSave();
        this.refreshPopup();
        this.api.output.print(`--- Towarzysz: od dzis towarzyszy ci ${next.spec.name}.`);
      },
    };
  }

  private buildPanel(): HTMLDivElement {
    return buildSettingsPanel(this.settingsView(), this.settingsHandlers());
  }

  private ensurePopup(): Promise<PopupLike | null> {
    if (this.popup) return Promise.resolve(this.popup);
    if (this.popupPromise) return this.popupPromise;
    const ui = this.api.ui as unknown as UiWithPopups;
    const promise = (async (): Promise<PopupLike | null> => {
      try {
        if (typeof ui.registerPersistentPopup === 'function') {
          const popup = await ui.registerPersistentPopup({
            id: POPUP_ID,
            title: 'Towarzysz',
            createContent: () => this.buildPanel(),
          });
          this.popup = popup;
          return popup;
        }
      } catch (error) {
        log('nie udalo sie zarejestrowac okna ustawien', error);
      }
      return null;
    })();
    this.popupPromise = promise;
    return promise;
  }

  private async openSettings(): Promise<void> {
    try {
      const popup = await this.ensurePopup();
      if (popup) {
        popup.setBody(this.buildPanel());
        await popup.open();
        return;
      }
      const ui = this.api.ui as unknown as UiWithPopups;
      if (typeof ui.createPopup === 'function') {
        this.popup = await ui.createPopup('Towarzysz', this.buildPanel());
        return;
      }
      this.api.output.print('--- Towarzysz: ten klient nie obsluguje okien pluginow; uzyj /towarzysz cisza i /towarzysz status.');
    } catch (error) {
      log('nie udalo sie otworzyc ustawien', error);
    }
  }

  /** Rebuild the panel if it is showing, so toggles made elsewhere are reflected. */
  private refreshPopup(): void {
    const popup = this.popup;
    if (!popup || popup.isOpen === false) return;
    try {
      popup.setBody(this.buildPanel());
    } catch {
      // Not open, or the host tore it down.
    }
  }
}

// ---------------------------------------------------------------------------
// Plugin entry points
// ---------------------------------------------------------------------------

let instance: Towarzysz | null = null;

export async function init(api: PluginApi): Promise<PluginInfo> {
  try {
    instance = new Towarzysz(api);
    instance.start();
  } catch (error) {
    log('inicjalizacja nie powiodla sie', error);
  }
  return {
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    author: PLUGIN_AUTHOR,
    description: PLUGIN_DESCRIPTION,
  };
}

export async function destroy(): Promise<void> {
  try {
    instance?.destroy();
  } catch (error) {
    log('blad przy wylaczaniu', error);
  }
  instance = null;
}
