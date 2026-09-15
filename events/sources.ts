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
/**
 * How long a new object number waits to see whether a `reset` follows it.
 *
 * The client hands out a fresh object id for two different reasons: a new life
 * (a login, a character switch, a death and respawn), which it announces with
 * `reset` on the tick after the Char.Info that moved the number, and a new body
 * in the same life - przeobrazenie and the appearance scrolls - which it
 * announces with nothing at all. So the absence of a reset is the signal, and
 * this is how long absence takes to establish. Generous, because the mistake it
 * guards against - taking a death for a transformation - is the worse one.
 */
export const BODY_SETTLE_MS = 400;
/**
 * How long a stun is believed without the line that ends it. The gag that
 * reports the end can be missed - it is one line in a fight - and a companion
 * reeling for the rest of the evening because of it would read as a bug.
 */
export const STUN_CAP_MS = 20_000;

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

/**
 * The fish landed. The client's fishing tracker only reports its state going
 * back to `idle`, which is also what a broken rod and an escaped fish look
 * like, so the one line that means the fish is out of the water is read here.
 */
export const FISH_CAUGHT_PATTERN = /^Wyciagasz zlapana rybe na powierzchnie\.$/;

/** The gem valuation read-out, same pattern the client's own `/ocenkamienie` uses. */
export const GEM_PATTERN =
  /^(?:Wydaje ci sie, ze (?:jest|sa) wart[aye]? okolo|(?:Wydaje ci sie, ze )?[Jj]est tu \d+ sztuk wartych|Sa tu \d+ sztuki warte) ([0-9]+) mied/;

/**
 * Events the client fires that `@arkadia/plugin-types` does not declare.
 *
 * The published `ClientEvents` is a hand-kept subset - a literal inside the
 * type generator - of the client's own `src/shared/events/clientEvents.ts`,
 * and it has fallen a long way behind it: ninety-odd names against nearly
 * three hundred. Nothing is gated at run time, though. `api.events.on` hands
 * the name straight to the client's bus (`PluginApi.createEventsApi`), so
 * these work exactly like the declared ones and only the types need widening.
 *
 * Payloads are typed as loosely as the client actually guarantees; every
 * reader below checks what it reads.
 */
interface UndeclaredEvents {
  /**
   * Which object in the room is us, or undefined while that is unknown - after
   * a disconnect, or between a body swap and working the new id out.
   */
  'player.objectNum': number | undefined;
  /** A field of knowledge grew. */
  knowledgeTickEvent: { category?: unknown; dative?: unknown } | undefined;
  /** The last enemy in the room went down. */
  allEnemiesKilled: undefined;
  stunStart: undefined;
  stunEnd: undefined;
  /** 'idle' | 'fishing' | 'biting' | 'pulling', with the cast's timestamp. */
  'fishing.state': { state?: unknown } | undefined;
  /** Stepped onto, or off, a ship or a coach. */
  'transport.onBoard': boolean | undefined;
}

type UndeclaredHandler<K extends keyof UndeclaredEvents> = (payload: UndeclaredEvents[K]) => void;

/** `api.events.on` for an event the typings have not caught up with. */
function listen<K extends keyof UndeclaredEvents>(api: PluginApi, event: K, handler: UndeclaredHandler<K>): void {
  (api.events.on as unknown as (name: string, fn: (payload?: unknown) => void) => void)(
    event,
    handler as (payload?: unknown) => void,
  );
}

/** And its `off`. */
function unlisten<K extends keyof UndeclaredEvents>(api: PluginApi, event: K, handler: UndeclaredHandler<K>): void {
  (api.events.off as unknown as (name: string, fn: (payload?: unknown) => void) => void)(
    event,
    handler as (payload?: unknown) => void,
  );
}

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
  /** The object we last knew ourselves to be; null while that is unknown. */
  let bodyNum: number | null = null;
  /** Whether we have worn a body at all since the last disconnect. */
  let hadBody = false;
  let lastResetAt = -Infinity;
  let bodyTimer: unknown = null;
  /** Kills since the room was last cleared, which is the size of the group. */
  let killsSinceClear = 0;
  let stunned = false;
  let stunTimer: unknown = null;
  /** The client's own fishing state, so only the changes are read. */
  let fishingState: string | null = null;
  let aboard = false;
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
    killsSinceClear = 0;
  };

  const clearBodyTimer = (): void => {
    if (bodyTimer !== null) clearTimer(bodyTimer);
    bodyTimer = null;
  };

  const clearStunTimer = (): void => {
    if (stunTimer !== null) clearTimer(stunTimer);
    stunTimer = null;
  };

  /** Ends a stun, whether the game said so or the cap ran out. */
  const endStun = (): void => {
    clearStunTimer();
    if (!stunned) return;
    stunned = false;
    handlers.onEvent({ type: 'stun', on: false });
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
    killsSinceClear++;
    handlers.onEvent({ type: 'kill', streak: killTimes.length });
  }, onError);

  const onAllEnemiesKilled = guard(() => {
    const count = killsSinceClear;
    killsSinceClear = 0;
    handlers.onEvent({ type: 'clear', count });
  }, onError);

  const onKnowledgeTick = guard(() => {
    handlers.onEvent({ type: 'knowledge' });
  }, onError);

  const onStunStart = guard(() => {
    clearStunTimer();
    stunTimer = setTimer(guard(endStun, onError), STUN_CAP_MS);
    if (stunned) return;
    stunned = true;
    handlers.onEvent({ type: 'stun', on: true });
  }, onError);

  const onStunEnd = guard(endStun, onError);

  const onFishing = guard((payload: { state?: unknown } | undefined) => {
    const state = payload?.state;
    if (typeof state !== 'string' || state === fishingState) return;
    const previous = fishingState;
    fishingState = state;
    if (state === 'fishing') handlers.onEvent({ type: 'fishing', state: 'waiting' });
    // The fight with the fish is between the bite and the landing; the bite
    // already said everything there is to say about it.
    else if (state === 'biting') handlers.onEvent({ type: 'fishing', state: 'bite' });
    // Back to idle from anywhere is the rod coming out of the water. Whether
    // there was a fish on the end of it is the catch line's business, and it
    // arrives on the same frame; this one only ends the sitting.
    else if (state === 'idle' && previous !== null) handlers.onEvent({ type: 'fishing', state: 'done' });
  }, onError);

  const onBoard = guard((payload: boolean | undefined) => {
    const next = payload === true;
    if (next === aboard) return;
    aboard = next;
    // Only the getting on. Stepping off is not a moment, and the departure the
    // client also reports follows the boarding by seconds - one stagger per
    // journey is a companion on a deck, two is a companion with a problem.
    if (next) handlers.onEvent({ type: 'travel' });
  }, onError);

  /**
   * The object we are is a different one. Either a new life - a login, a
   * character switch, a death and respawn - which the client follows with
   * `reset`, or the same life in a new body, which it follows with nothing.
   * So the verdict waits for the reset that does not come.
   */
  const onObjectNum = guard((payload: number | undefined) => {
    // undefined is the gap between two bodies, not a body: the number that
    // comes after it is the one that says what happened.
    if (typeof payload !== 'number') return;
    if (payload === bodyNum) return;
    const previous = bodyNum;
    bodyNum = payload;
    hadBody = true;
    // Whatever moved it, the character is standing in the room again: a
    // companion left lying by a death gets up now.
    handlers.onRespawn();
    clearBodyTimer();
    // The first body of a session is not a change of body.
    if (previous === null) return;
    bodyTimer = setTimer(
      guard(() => {
        bodyTimer = null;
        // A reset either side of this is the client calling it a new life.
        if (now() - lastResetAt < BODY_SETTLE_MS) return;
        handlers.onEvent({ type: 'transform' });
      }, onError),
      BODY_SETTLE_MS,
    );
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
    const name = typeof info?.name === 'string' ? info.name.trim() : '';
    if (!name) return;
    if (name !== characterName) {
      characterName = name;
      deathReported = false;
      resetBaselines();
      resetDrink();
      // Somebody else's evening: their rod, their ship, their aching head.
      endStun();
      fishingState = null;
      aboard = false;
      handlers.onCharacter(name);
    }
  }, onError);

  /**
   * The client fires `reset` from its PlayerIdentity when a life ends: on
   * login, on a character switch, and on a death and respawn. Which of those it
   * is comes from whether we were already wearing a body - a login follows a
   * disconnect, so we were not - and from the name, because a switch to another
   * character has already changed it by the time this runs.
   */
  const onReset = guard(() => {
    lastResetAt = now();
    // This reset is the verdict the pending body change was waiting for.
    clearBodyTimer();
    // Whatever else it means, the object number is new: a companion left lying
    // by a death gets up now.
    handlers.onRespawn();
    endStun();
    const currentName = readGmcpName(api);
    const sameCharacter = characterName !== null && (currentName === null || currentName === characterName);
    const wasAlive = hadBody;
    resetBaselines();
    // The text trigger is the authoritative one; this reset is its respawn.
    if (deathReported) {
      deathReported = false;
      return;
    }
    if (wasAlive && sameCharacter) handlers.onEvent({ type: 'death' });
  }, onError);

  const onDisconnect = guard(() => {
    bodyNum = null;
    hadBody = false;
    lastResetAt = -Infinity;
    clearBodyTimer();
    clearStunTimer();
    stunned = false;
    fishingState = null;
    aboard = false;
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
  listen(api, 'player.objectNum', onObjectNum);
  listen(api, 'allEnemiesKilled', onAllEnemiesKilled);
  listen(api, 'knowledgeTickEvent', onKnowledgeTick);
  listen(api, 'stunStart', onStunStart);
  listen(api, 'stunEnd', onStunEnd);
  listen(api, 'fishing.state', onFishing);
  listen(api, 'transport.onBoard', onBoard);

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
    FISH_CAUGHT_PATTERN,
    (line, matches) => {
      passThrough(() => handlers.onEvent({ type: 'fishing', state: 'catch' }))(
        line as unknown as { text?: string },
        matches,
      );
      return line;
    },
    TRIGGER_TAG,
  );
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

  // Seed the character from what the client already knows, then start the idle
  // clock. A name here means the plugin was loaded into a session already under
  // way, so the character is alive and wearing a body: the next `reset` is a
  // death and not a login.
  const initialName = readGmcpName(api);
  if (initialName) {
    characterName = initialName;
    hadBody = true;
    bodyNum = readGmcpObjectNum(api);
    guard(() => handlers.onCharacter(initialName), onError)();
  }
  armIdle();

  return {
    detach() {
      clearIdle();
      clearBodyTimer();
      clearStunTimer();
      api.events.off('kill', onKill);
      api.events.off('gmcp.char.state', onState);
      api.events.off('gmcp.char.info', onCharInfo);
      api.events.off('reset', onReset);
      api.events.off('client.disconnect', onDisconnect);
      api.events.off('command', onCommand);
      unlisten(api, 'player.objectNum', onObjectNum);
      unlisten(api, 'allEnemiesKilled', onAllEnemiesKilled);
      unlisten(api, 'knowledgeTickEvent', onKnowledgeTick);
      unlisten(api, 'stunStart', onStunStart);
      unlisten(api, 'stunEnd', onStunEnd);
      unlisten(api, 'fishing.state', onFishing);
      unlisten(api, 'transport.onBoard', onBoard);
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

/** The object we are, as the client's last Char.Info left it. */
export function readGmcpObjectNum(api: PluginApi): number | null {
  try {
    const num = (api.gmcp.get() as { char?: { info?: { object_num?: unknown } } } | undefined)?.char?.info?.object_num;
    return typeof num === 'number' ? num : null;
  } catch {
    return null;
  }
}
