/**
 * Where the game events come from. Subscribes to the client (events and text
 * triggers), normalises what it sees into `GameEvent`s and hands them to the
 * plugin. Knows nothing about the DOM, mood or speech; testable with a fake api.
 *
 * Every callback is wrapped: nothing in this plugin may throw into the
 * client's event loop.
 */

import type { PluginApi } from '@arkadia/plugin-types';
import type { GameEvent } from './bindings';

export const TRIGGER_TAG = 'towarzysz';
/** Kills closer together than this count as one streak. */
export const KILL_STREAK_WINDOW_MS = 90_000;
/** Time the death heuristic waits after a Char.Info frame before trusting a `reset` as a death. */
export const CHAR_INFO_SETTLE_MS = 50;

/** Coin-bearing lines. Anything without "monet" in it parses to 0 copper and is ignored. */
export const LOOT_PATTERNS: RegExp[] = [/^Bierzesz (.+)\.$/, /^Dostajesz (.+)\.$/, /wyplaca ci (.+) monet/];
/**
 * Spending. The last two are the shopkeeper's side of a purchase - "Usmiechniety
 * dojrzaly mezczyzna drapieznym ruchem zgarnia 9 srebrnych i 30 miedzianych
 * monet.", "Chudy brodaty mezczyzna odbiera od ciebie dwie srebrne i trzy
 * miedziane monety w zamian za zakupiony towar." - and they are the only ones
 * that say how much, so the line is parsed for coins the same way loot is. The
 * `odbiera` one keeps its "za zakupiony towar" tail: without it the phrase is
 * any handover at all, a quest hand-in included.
 */
export const SPEND_PATTERNS: RegExp[] = [
  /^Kupujesz /,
  /^Placisz /,
  /zgarnia .* monet/,
  /odbiera od ciebie .* monet.* w zamian za zakupion/,
];
/** Selling goods. The payment, when the game prints one, arrives as its own loot line. */
export const SELL_PATTERNS: RegExp[] = [/^Sprzedajesz /];
/**
 * Dying. The game prints "Umierasz." and then "Oddalasz sie."; the first is the
 * moment, the second is the soul leaving, so only the first is the event.
 */
export const DEATH_PATTERNS: RegExp[] = [/^Umierasz\.$/];
/**
 * Drink, and the head after it. Both are `Char.State` numbers and are read the
 * way `improve` and `hp` are, not off the text. The client's own bars are the
 * scale: `intox` ("UPI") runs 0..9 and `headache` ("KAC") 0..6, both 0 by
 * default.
 *
 * Neither is cut into thirds because three is a nice number - it is because the
 * companion has three things to say. Drunkenness: a first warmth, properly
 * drunk, barely upright. The head: a dull one, a bad one, and the kind you
 * swear off drink over.
 *
 * The reaction is to a stage being *crossed upward*, never to the number
 * moving. `intox` ticks up with every sip and down with every minute, and a
 * stagger per tick is an evening of staggering; sobering up is silent and
 * re-arms the stage it fell out of, so the next bout reacts from wherever it
 * starts.
 */
export const INTOX_FIELD = 'intox';
export const HANGOVER_FIELD = 'headache';
/** Thresholds on `intox`, 0..9. */
export const INTOX_STAGES: readonly [number, number, number] = [1, 4, 7];
/** Thresholds on `headache`, 0..6. */
export const HANGOVER_STAGES: readonly [number, number, number] = [1, 3, 5];

/** Which stage a reading falls in: 0 for none, 1..3 otherwise. */
export function stageOf(value: number, stages: readonly [number, number, number]): number {
  if (value >= stages[2]) return 3;
  if (value >= stages[1]) return 2;
  if (value >= stages[0]) return 1;
  return 0;
}

/** The gem valuation read-out, same pattern the client's own `/ocenkamienie` uses. */
export const GEM_PATTERN =
  /^(?:Wydaje ci sie, ze (?:jest|sa) wart[aye]? okolo|(?:Wydaje ci sie, ze )?[Jj]est tu \d+ sztuk wartych|Sa tu \d+ sztuki warte) ([0-9]+) mied/;

export interface SourceHandlers {
  onEvent(event: GameEvent): void;
  /** Any command typed: wakes a dozing companion and restarts the idle clock. */
  onActivity(): void;
  /**
   * The character's object number changed - a respawn, a login, a character
   * switch. A companion who died is lying there until this arrives.
   */
  onRespawn(): void;
  onCharacter(name: string): void;
  onDisconnect(): void;
}

export interface SourceOptions {
  idleMs(): number;
  coinsToCopper(text: string): number;
  now?: () => number;
  /** Test hook: replace timers. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onError?: (error: unknown) => void;
}

export interface Sources {
  detach(): void;
  /** Restarts the idle timer, e.g. after the idle setting changed. */
  restartIdleTimer(): void;
}

function guard<T extends unknown[]>(fn: (...args: T) => void, onError?: (error: unknown) => void): (...args: T) => void {
  return (...args: T) => {
    try {
      fn(...args);
    } catch (error) {
      onError?.(error);
    }
  };
}

export function attachSources(api: PluginApi, handlers: SourceHandlers, options: SourceOptions): Sources {
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const onError = options.onError;

  let killTimes: number[] = [];
  let lastImprove: number | null = null;
  let lastHp: number | null = null;
  let charInfoFrames = 0;
  let lastCharInfoAt = -Infinity;
  /**
   * A death we already reacted to because the game said "Umierasz.". The
   * `reset` that follows it on respawn is the same death - which may be many
   * seconds later, so this is a flag and not a time window.
   */
  let deathReported = false;
  /**
   * The last stage of drunkenness and of headache seen. `null` in
   * either means nothing has been read yet, so the next reading is a baseline
   * rather than an event.
   */
  let lastIntoxStage: number | null = null;
  let lastHangoverStage: number | null = null;
  let characterName: string | null = null;
  let idleHandle: unknown = null;

  const clearIdle = (): void => {
    if (idleHandle !== null) clearTimer(idleHandle);
    idleHandle = null;
  };
  const armIdle = (): void => {
    clearIdle();
    const ms = options.idleMs();
    if (!(ms > 0)) return;
    idleHandle = setTimer(
      guard(() => {
        idleHandle = null;
        handlers.onEvent({ type: 'idle' });
      }, onError),
      ms,
    );
  };

  const resetBaselines = (): void => {
    killTimes = [];
    lastImprove = null;
    lastHp = null;
  };

  /** A new character's first state frame is a baseline, not a night out. */
  const resetDrink = (): void => {
    lastIntoxStage = null;
    lastHangoverStage = null;
  };

  const onKill = guard((payload: { killer: 'ME' | 'TEAM' | 'OTHER' }) => {
    if (payload?.killer !== 'ME') return;
    const t = now();
    killTimes = killTimes.filter((k) => t - k <= KILL_STREAK_WINDOW_MS);
    killTimes.push(t);
    handlers.onEvent({ type: 'kill', streak: killTimes.length });
  }, onError);

  const onState = guard((raw: unknown) => {
    const state = raw as Record<string, unknown> | null;
    const improve = state?.improve;
    if (typeof improve === 'number') {
      const previous = lastImprove;
      lastImprove = improve;
      // The first reading after login is a baseline; anything that is not a
      // climb is the counter resetting after absorption.
      if (previous !== null && improve > previous) handlers.onEvent({ type: 'improve', from: previous, to: improve });
    }
    const hp = state?.hp;
    if (typeof hp === 'number') {
      const previous = lastHp;
      lastHp = hp;
      // Char.State.hp is a condition index, 0 = "ledwo zywy" .. 6 = "w swietnej kondycji".
      if (previous !== null && hp < previous) handlers.onEvent({ type: 'hurt', levelsLost: previous - hp });
    }
    const intox = state?.[INTOX_FIELD];
    if (typeof intox === 'number') {
      const stage = stageOf(intox, INTOX_STAGES);
      const previous = lastIntoxStage;
      lastIntoxStage = stage;
      // The first reading is a baseline: logging in drunk is not a drink. After
      // that only a deeper stage is news - the same stage again is another sip,
      // and a shallower one is sobering up, which nobody comments on.
      if (previous !== null && stage > previous) handlers.onEvent({ type: 'intox', level: stage });
    }
    const headache = state?.[HANGOVER_FIELD];
    if (typeof headache === 'number') {
      const stage = stageOf(headache, HANGOVER_STAGES);
      const previous = lastHangoverStage;
      lastHangoverStage = stage;
      // Same rule as the drink: the head arriving is an event, and the head
      // getting worse is another, but it ticking down all morning is not.
      if (previous !== null && stage > previous) handlers.onEvent({ type: 'hangover', level: stage });
    }
  }, onError);

  const onCharInfo = guard((raw: unknown) => {
    const info = raw as { name?: unknown } | null;
    charInfoFrames++;
    lastCharInfoAt = now();
    const name = typeof info?.name === 'string' ? info.name.trim() : '';
    if (!name) return;
    if (name !== characterName) {
      characterName = name;
      deathReported = false;
      resetBaselines();
      resetDrink();
      handlers.onCharacter(name);
    }
  }, onError);

  /**
   * The client fires `reset` from its PlayerIdentity when the character's object
   * number changes: on login (before our own Char.Info listener runs, as the
   * client's listener is older), on a character switch, and on a death and
   * respawn. It arrives on the same tick as the very first Char.Info of a
   * connection, or on a later tick after a respawn - and only the latter is a
   * death for a character we already know.
   */
  const onReset = guard(() => {
    const t = now();
    // Whatever else this reset means, the object number is new: a companion
    // left lying by a death gets up now.
    handlers.onRespawn();
    const currentName = readGmcpName(api);
    const knownCharacter = charInfoFrames > 0 && characterName !== null && (currentName === null || currentName === characterName);
    const settled = t - lastCharInfoAt >= CHAR_INFO_SETTLE_MS || charInfoFrames > 1;
    resetBaselines();
    // The text trigger is the authoritative one; this reset is its respawn.
    if (deathReported) {
      deathReported = false;
      return;
    }
    if (knownCharacter && settled) handlers.onEvent({ type: 'death' });
  }, onError);

  const onDisconnect = guard(() => {
    charInfoFrames = 0;
    lastCharInfoAt = -Infinity;
    deathReported = false;
    resetBaselines();
    resetDrink();
    clearIdle();
    handlers.onDisconnect();
  }, onError);

  const onCommand = guard(() => {
    handlers.onActivity();
    armIdle();
  }, onError);

  api.events.on('kill', onKill);
  api.events.on('gmcp.char.state', onState);
  api.events.on('gmcp.char.info', onCharInfo);
  api.events.on('reset', onReset);
  api.events.on('client.disconnect', onDisconnect);
  api.events.on('command', onCommand);

  const passThrough = (fn: (text: string) => void) =>
    guard((line: { text?: string }, matches: RegExpMatchArray) => {
      fn(typeof line?.text === 'string' ? line.text : (matches?.[0] ?? ''));
    }, onError);

  for (const pattern of LOOT_PATTERNS) {
    api.triggers.register(
      pattern,
      (line, matches) => {
        passThrough((text) => {
          const copper = options.coinsToCopper(text);
          if (copper > 0) handlers.onEvent({ type: 'loot', copper });
        })(line as unknown as { text?: string }, matches);
        return line;
      },
      TRIGGER_TAG,
    );
  }
  for (const pattern of SPEND_PATTERNS) {
    api.triggers.register(
      pattern,
      (line, matches) => {
        passThrough((text) => {
          const copper = options.coinsToCopper(text);
          handlers.onEvent(copper > 0 ? { type: 'spend', copper } : { type: 'spend' });
        })(line as unknown as { text?: string }, matches);
        return line;
      },
      TRIGGER_TAG,
    );
  }
  for (const pattern of SELL_PATTERNS) {
    api.triggers.register(
      pattern,
      (line, matches) => {
        passThrough(() => handlers.onEvent({ type: 'sell' }))(line as unknown as { text?: string }, matches);
        return line;
      },
      TRIGGER_TAG,
    );
  }
  for (const pattern of DEATH_PATTERNS) {
    api.triggers.register(
      pattern,
      (line, matches) => {
        passThrough(() => {
          deathReported = true;
          handlers.onEvent({ type: 'death' });
        })(line as unknown as { text?: string }, matches);
        return line;
      },
      TRIGGER_TAG,
    );
  }
  api.triggers.register(
    GEM_PATTERN,
    (line, matches) => {
      guard(() => {
        const copper = parseInt(matches?.[1] ?? '', 10);
        if (Number.isFinite(copper)) handlers.onEvent({ type: 'gem', copper });
      }, onError)();
      return line;
    },
    TRIGGER_TAG,
  );

  // Seed the character from what the client already knows, then start the idle clock.
  const initialName = readGmcpName(api);
  if (initialName) {
    characterName = initialName;
    charInfoFrames = 1;
    lastCharInfoAt = now();
    guard(() => handlers.onCharacter(initialName), onError)();
  }
  armIdle();

  return {
    detach() {
      clearIdle();
      api.events.off('kill', onKill);
      api.events.off('gmcp.char.state', onState);
      api.events.off('gmcp.char.info', onCharInfo);
      api.events.off('reset', onReset);
      api.events.off('client.disconnect', onDisconnect);
      api.events.off('command', onCommand);
      try {
        api.triggers.removeByTag(TRIGGER_TAG);
      } catch (error) {
        onError?.(error);
      }
    },
    restartIdleTimer: armIdle,
  };
}

export function readGmcpName(api: PluginApi): string | null {
  try {
    const name = (api.gmcp.get() as { char?: { info?: { name?: unknown } } } | undefined)?.char?.info?.name;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}
