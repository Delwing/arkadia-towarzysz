/**
 * Towarzysz - a pixel-art companion who lives in the Arkadia Web Client's footer.
 *
 * Rolled once per character (random archetype, look, voice and name), reacts
 * to what happens in the session with small animations, and occasionally says
 * something in a speech bubble above the footer. Has a mood that drifts with
 * how the session goes. Has no needs, cannot be neglected, cannot die.
 *
 * `/towarzysz` opens the companion's card; `/towarzysz cisza` toggles the
 * global mute. There is nothing to configure: the card only shows them.
 *
 * Everything user-facing is ASCII-folded Polish, like the rest of the client.
 * Nothing here is allowed to throw into the client's event loop: every
 * handler is wrapped. See README.md and docs/ for the design.
 */

import type { PluginApi, PluginInfo } from '@arkadia/plugin-types';

import type { Category, PersistedState, Primitive } from './companion/types';
import { advance, bucket, bucketLabel, hold, nudge, set as setMood } from './companion/mood';
import { bandOf, isStale, rollTemper, temperLabel } from './companion/temper';
import { load, pickStorage, save, type KeyValueStorage } from './companion/state';
import { VOICES, voiceName } from './voice/catalog';
import { properName } from './text/properName';
import { Speaker } from './voice/speak';
import { Animator } from './render/animator';
import { buildSheet, type LoadedSheet } from './render/sheet';
import { Chip } from './ui/chip';
import { Bubble } from './ui/bubble';
import { AMBIENT_LABELS, buildCompanionCard, type CardHandlers, type CardView } from './ui/card';
import { copyPictureToClipboard, drawCompanionPicture, savePicture, type PictureOutcome } from './ui/picture';
import {
  guardFor,
  POSTURE_ORDER,
  resolve,
  stanceFor,
  type GameEvent,
  type PostureKey,
} from './events/bindings';
import { attachSources, BORED_AFTER_MS, readGmcpGender, type Sources } from './events/sources';
import { applyGender } from './voice/gender';
import { coinsToCopper } from './text/coins';

const PLUGIN_NAME = 'Towarzysz';
const PLUGIN_VERSION = '1.0.1';
const PLUGIN_AUTHOR = 'Dargoth';
const PLUGIN_DESCRIPTION =
  'Pikselowy towarzysz w stopce - losowany raz na postac, reaguje na to, co dzieje sie w grze, czasem cos powie. ' +
  "Sterowanie: /towarzysz. Grafika: wlasne pikselowe sprite'y.";

const FOOTER_ID = 'towarzysz';
const POPUP_ID = 'towarzysz-karta';
/** The card's portrait: the footer's companion, drawn big enough to look at. */
const PORTRAIT_SCALE = 4;
const SAVE_DEBOUNCE_MS = 500;
const CARD_REFRESH_MS = 30_000;
/**
 * How often the mood is charged for its drift. The mood drifts only while the
 * client is connected (see `companion/mood.ts`), which means somebody has to
 * tell it that time is passing; this is that somebody. It is short enough that
 * even a background tab's throttled timer - once a minute, in Chrome - lands
 * inside a single chargeable step.
 */
const MOOD_TICK_MS = 20_000;
/**
 * How long the day's greeting waits after the character loads. A load lands in
 * the middle of the client's own login traffic, and a bubble in the middle of
 * that reads as part of the noise rather than as somebody saying good morning.
 */
const GREETING_DELAY_MS = 4_000;

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
  /**
   * The card's portrait. Built once, on the first card, and re-parented into
   * every rebuild: it is the same animator and the same sheet as the footer's,
   * so re-creating it per rebuild would only throw away a warm canvas.
   */
  private portrait: Chip | null = null;
  private sheet: LoadedSheet | null = null;
  private readonly bubble: Bubble;
  private readonly footer: ReturnType<PluginApi['ui']['registerFooterComponent']>;
  private sources: Sources | null = null;
  private popup: PopupLike | null = null;
  private popupPromise: Promise<PopupLike | null> | null = null;
  private aliasIds: string[] = [];

  private characterName: string | null = null;
  private state: PersistedState | null = null;
  /**
   * Every state the client currently says the character is in, one entry per
   * key. The animator holds one posture at a time, so these are kept here and
   * the most urgent of them (`POSTURE_ORDER`) is what the companion stands in:
   * a fight that ends while the pipe is still lit gives the pipe back rather
   * than the footer.
   */
  private readonly postures = new Map<PostureKey, Primitive>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private greetTimer: ReturnType<typeof setTimeout> | null = null;
  private cardTimer: ReturnType<typeof setInterval> | null = null;
  private moodTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Whether the client is in the game. The mood drifts only while it is, so a
   * companion left at a dropped connection keeps the mood the session ended
   * on rather than cooling off in an empty room.
   */
  private connected = false;
  private sheetWarned = false;

  constructor(api: PluginApi) {
    this.api = api;
    this.storage = pickStorage();
    this.speaker = new Speaker();
    this.animator = new Animator(Date.now());
    this.chip = new Chip({ animator: this.animator, onClick: () => void this.openCard() });
    this.bubble = new Bubble();

    // The registry clones a Node it is handed, so the chip is appended into
    // the plugin-owned span after registration instead of being passed in.
    this.footer = api.ui.registerFooterComponent(FOOTER_ID, '', 'end');
    // The companion is drawn taller than the footer row and overflows upwards;
    // the handle's own span must not be the thing that cuts them off.
    this.footer.element.style.overflow = 'visible';
    this.footer.element.appendChild(this.chip.element);
    this.chip.setSpec(null);
    this.chip.start();
  }

  start(): void {
    this.sources = attachSources(
      this.api,
      {
        onEvent: (event) => this.handle(event),
        onActivity: () => this.animator.wake(),
        onRespawn: () => {
          this.connected = true;
          this.animator.revive();
        },
        onCharacter: (name) => {
          this.connected = true;
          this.loadCharacter(name);
        },
        onDisconnect: () => {
          this.connected = false;
          // Whatever they were in the middle of, it is not happening now.
          this.postures.clear();
          this.animator.setStance(null);
          this.flushSave();
        },
      },
      {
        idleMs: () => (this.state?.settings.idleMinutes ?? 5) * 60_000,
        boredMs: () => BORED_AFTER_MS,
        coinsToCopper,
        onError: (error) => log('blad w obsludze zdarzenia', error),
      },
    );

    // The card shows the mood and the tally, and it can sit pinned for an
    // evening; while it is open it is refreshed here, and while it is not the
    // portrait has nothing to draw for.
    this.cardTimer = setInterval(() => {
      if (this.popup && this.popup.isOpen === false) this.portrait?.stop();
      else this.refreshPopup();
    }, CARD_REFRESH_MS);

    this.moodTimer = setInterval(() => {
      try {
        this.tickMood();
      } catch (error) {
        log('blad przy przeliczaniu nastroju', error);
      }
    }, MOOD_TICK_MS);

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

    // A pinned card from a previous session comes back on its own.
    void this.ensurePopup();
  }

  destroy(): void {
    window.removeEventListener('beforeunload', this.flushSave);
    this.flushSave();
    if (this.greetTimer) clearTimeout(this.greetTimer);
    this.greetTimer = null;
    this.sources?.detach();
    this.sources = null;
    if (this.cardTimer) clearInterval(this.cardTimer);
    this.cardTimer = null;
    if (this.moodTimer) clearInterval(this.moodTimer);
    this.moodTimer = null;
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
    this.portrait?.destroy();
    this.portrait = null;
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
    const now = Date.now();
    const state = load(name, this.storage);
    state.stats.sessions += 1;
    this.state = state;
    this.speaker.reset();
    // What kind of day the companion is having. A relog inside the same evening
    // finds the temper it left and says nothing; a new one is rolled, the mood
    // starts where that temper rests, and they say good morning about it.
    // Starting the mood at the resting point is the point: a companion who
    // announces a grim day and then shows yesterday's cheerful bar is a
    // companion nobody believes.
    const freshDay = isStale(state.temper, now);
    if (freshDay) {
      state.temper = rollTemper(Math.random, state.settings.voiceOverride ?? state.spec.voiceId, now);
      state.mood = state.temper.resting;
      state.moodTouchedAt = now;
    }
    this.speaker.setGlobalCooldown(state.settings.globalCooldownMs);
    this.animator.setAmbientLevel(state.settings.ambientLevel);
    this.postures.clear();
    this.animator.setStance(null);
    this.animator.wake();
    this.applySpec();
    this.scheduleSave();
    this.sources?.restartTimers();
    this.refreshPopup();
    if (freshDay) this.scheduleGreeting();
    log(`${state.spec.name} (${state.spec.archetype}, ${voiceName(state.spec.voiceId)}) towarzyszy postaci ${properName(name)}.`);
  }

  private applySpec(): void {
    const state = this.state;
    if (!state) {
      this.sheet = null;
      this.showSpec();
      return;
    }

    // Building the sheet is synchronous and cheap (a few thousand pixels), so
    // there is no load to race and no token to guard: the chip either gets
    // this companion's sheet or keeps drawing the procedural figure.
    try {
      this.sheet = buildSheet(state.spec);
    } catch (error) {
      this.sheet = null;
      if (!this.sheetWarned) {
        this.sheetWarned = true;
        log('nie udalo sie zbudowac arkusza sprite - towarzysz zostanie niewidoczny', error);
      }
    }
    this.showSpec();
  }

  /** Push the current companion at everything that draws them. */
  private showSpec(): void {
    const spec = this.state?.spec ?? null;
    for (const chip of [this.chip, this.portrait]) {
      if (!chip) continue;
      chip.setSpec(spec);
      chip.setSheet(this.sheet);
    }
  }

  // ------------------------------------------------------------------- events

  private handle(event: GameEvent): void {
    const state = this.state;
    if (!state) return;
    // The posture first: some events change only that, and a reaction of their
    // own would be a second thing happening where there was one.
    this.posture(stanceFor(event));
    const reaction = resolve(event);
    if (!reaction) return;
    const now = Date.now();

    if (event.type === 'kill') state.stats.kills += 1;
    if (event.type === 'death') state.stats.deaths += 1;

    const before = { value: state.mood, touchedAt: state.moodTouchedAt, resting: state.temper.resting };
    // A death does not argue with the mood, it replaces it; everything else
    // nudges. See `Reaction.moodSet`.
    const mood =
      reaction.moodSet === undefined
        ? nudge(before, reaction.moodDelta, now)
        : setMood(before, reaction.moodSet, now);
    state.mood = mood.value;
    state.moodTouchedAt = mood.touchedAt;

    // Animation is never gated by restraint: they always react, they rarely speak.
    this.animator.play(reaction.primitive, reaction.intensity, animationNow());

    const line = this.speaker.maybe(this.voice(), reaction.category, bucket(mood.value), state.mutes, now, {
      priority: reaction.priority === true,
      ...(reaction.probability === undefined ? {} : { probability: reaction.probability }),
    });
    this.say(line);

    this.scheduleSave();
  }

  /**
   * Take what `stanceFor` said about an event and stand the companion in
   * whatever is now the most urgent of the states they are in. `undefined`
   * leaves them alone, `null` drops the lot - a death ends everything.
   */
  private posture(posture: ReturnType<typeof stanceFor>): void {
    if (posture === undefined) return;
    if (posture === null) this.postures.clear();
    else if (posture.primitive === null) this.postures.delete(posture.key);
    else this.postures.set(posture.key, this.weapon(posture.primitive));
    this.applyPosture();
  }

  /** Which of the postures held is the one they stand in. */
  private applyPosture(): void {
    for (const key of POSTURE_ORDER) {
      const primitive = this.postures.get(key);
      if (primitive) {
        this.animator.setStance(primitive);
        return;
      }
    }
    this.animator.setStance(null);
  }

  /**
   * The guard `stanceFor` asks for is the generic one; which weapon actually
   * comes out is the companion's own business, and only this class knows who
   * the companion is.
   */
  private weapon(primitive: Primitive): Primitive {
    const spec = this.state?.spec;
    return primitive === 'guard' && spec ? guardFor(spec) : primitive;
  }

  /**
   * The day's first line, once the login has settled. Guarded on the character
   * still being the one the day was rolled for: a switch during the wait is a
   * different companion having a different day.
   */
  private scheduleGreeting(): void {
    if (this.greetTimer) clearTimeout(this.greetTimer);
    const name = this.characterName;
    this.greetTimer = setTimeout(() => {
      this.greetTimer = null;
      try {
        if (this.characterName === name) this.greet();
      } catch (error) {
        log('blad przy powitaniu dnia', error);
      }
    }, GREETING_DELAY_MS);
  }

  private greet(): void {
    const state = this.state;
    if (!state) return;
    const mood = this.currentMood();
    // Priority, because this is the one line of the session that would be a bug
    // if it went missing - but still `maybe`, so a muted companion stays muted.
    const line = this.speaker.maybe(this.voice(), 'temper', bucket(mood), state.mutes, Date.now(), { priority: true });
    if (!this.say(line)) return;
    // The shrug or the bounce that goes with it. Tied to the line rather than
    // to the roll: a companion who is not allowed to speak does not mime it.
    const band = bandOf(state.temper.resting);
    if (band === 'bright') this.animator.play('cheer', 1.4, animationNow());
    else if (band === 'grim') this.animator.play('slump', 1.2, animationNow());
  }

  /**
   * Put a line in the bubble, in the form that addresses this player. The one
   * place a line reaches the screen, so the one place that has to know about
   * "Zajechales" and "Zajechalas". Returns whether anything was said.
   */
  private say(line: string | null): boolean {
    if (!line) return false;
    this.bubble.show(applyGender(line, readGmcpGender(this.api)), this.chip.anchor);
    return true;
  }

  private voice() {
    const state = this.state;
    if (!state) return undefined;
    return VOICES[state.settings.voiceOverride ?? state.spec.voiceId];
  }

  /**
   * Charge the drift for the time since the last tick - or, if the client is
   * not in the game, move the clock on and leave the value where it was. A
   * save is only worth a write when the bucket turns over: the number moves
   * every twenty seconds, but what anyone sees of it does not.
   */
  private tickMood(): void {
    const state = this.state;
    if (!state) return;
    const now = Date.now();
    const before = { value: state.mood, touchedAt: state.moodTouchedAt, resting: state.temper.resting };
    const after = this.connected ? advance(before, now) : hold(before, now);
    state.mood = after.value;
    state.moodTouchedAt = after.touchedAt;
    if (bucket(after.value) === bucket(before.value)) return;
    this.scheduleSave();
    this.refreshPopup();
  }

  /** The mood right now, on the same terms the tick uses. */
  private currentMood(): number {
    const state = this.state;
    if (!state) return 0;
    const mood = { value: state.mood, touchedAt: state.moodTouchedAt, resting: state.temper.resting };
    const now = Date.now();
    return (this.connected ? advance(mood, now) : hold(mood, now)).value;
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

    if (args === '' || args === 'karta' || args === 'ustawienia') {
      void this.openCard();
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
          `nastroj: ${bucketLabel(this.currentMood())} (dzis ${temperLabel(state.temper.resting)}), ` +
          `${state.mutes.global ? 'cisza' : 'mowi'}` +
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
    print('/towarzysz [karta|cisza|status|powiedz|ruch]');
  }

  private saySomething(): void {
    const state = this.state;
    if (!state) return;
    const categories: Category[] = ['idle', 'bored', 'kill', 'loot', 'improve', 'hurt', 'spend'];
    const category = categories[Math.floor(Math.random() * categories.length)] as Category;
    this.say(this.speaker.force(this.voice(), category, bucket(this.currentMood())));
    this.animator.play('gulp', 0.8, animationNow());
  }

  // --------------------------------------------------------------------- card

  private cardView(): CardView {
    return {
      characterName: this.characterName,
      state: this.state,
      mood: this.currentMood(),
      portrait: this.state ? this.ensurePortrait().element : null,
    };
  }

  private cardHandlers(): CardHandlers {
    return {
      onSaySomething: () => this.saySomething(),
      onAmbient: () => this.animator.playAmbient(animationNow()),
      onPicture: (doc) => this.picture(doc),
    };
  }

  /**
   * The companion's picture, to the clipboard - or, where the clipboard cannot
   * be reached (an http page, an old browser), to a file instead.
   *
   * Drawn synchronously so that `copyPictureToClipboard` still runs inside the
   * click that asked for it, which is what the clipboard requires.
   */
  private picture(doc: Document): Promise<PictureOutcome> {
    const state = this.state;
    const characterName = this.characterName;
    if (!state || !characterName) return Promise.reject(new Error('nie ma jeszcze towarzysza'));
    let canvas: HTMLCanvasElement;
    try {
      canvas = drawCompanionPicture({ characterName, state, mood: this.currentMood() }, this.sheet, doc);
    } catch (error) {
      log('nie udalo sie narysowac obrazka', error);
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return copyPictureToClipboard(canvas).then(
      () => 'copied' as const,
      (error) => {
        log('schowek niedostepny - obrazek idzie na dysk', error);
        savePicture(canvas, `towarzysz-${state.spec.name.toLowerCase()}.png`);
        return 'saved' as const;
      },
    );
  }

  /** The portrait chip, built on first use and kept for the plugin's lifetime. */
  private ensurePortrait(): Chip {
    if (this.portrait) return this.portrait;
    const portrait = new Chip({
      animator: this.animator,
      scale: PORTRAIT_SCALE,
      label: false,
      float: false,
    });
    this.portrait = portrait;
    this.showSpec();
    portrait.start();
    return portrait;
  }

  private buildPanel(): HTMLDivElement {
    // A rebuild moves the portrait into the new card rather than replacing it;
    // it keeps drawing throughout, so there is nothing to restart here.
    return buildCompanionCard(this.cardView(), this.cardHandlers());
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
        log('nie udalo sie zarejestrowac okna z karta', error);
      }
      return null;
    })();
    this.popupPromise = promise;
    return promise;
  }

  private async openCard(): Promise<void> {
    try {
      // The card is only worth drawing while somebody is looking at it.
      this.portrait?.start();
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
      this.api.output.print('--- Towarzysz: ten klient nie obsluguje okien pluginow; uzyj /towarzysz status i /towarzysz cisza.');
    } catch (error) {
      log('nie udalo sie otworzyc karty', error);
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
