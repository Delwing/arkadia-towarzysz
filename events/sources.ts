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
/** Spending. The exact wording the game uses is an assumption; see docs/implementation-notes.md. */
export const SPEND_PATTERNS: RegExp[] = [/^Kupujesz /, /^Placisz /];
/** The gem valuation read-out, same pattern the client's own `/ocenkamienie` uses. */
export const GEM_PATTERN =
  /^(?:Wydaje ci sie, ze (?:jest|sa) wart[aye]? okolo|(?:Wydaje ci sie, ze )?[Jj]est tu \d+ sztuk wartych|Sa tu \d+ sztuki warte) ([0-9]+) mied/;

export interface SourceHandlers {
  onEvent(event: GameEvent): void;
  /** Any command typed: wakes a dozing companion and restarts the idle clock. */
  onActivity(): void;
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

  const onKill = guard((payload: { killer: 'ME' | 'TEAM' | 'OTHER' }) => {
    if (payload?.killer !== 'ME') return;
    const t = now();
    killTimes = killTimes.filter((k) => t - k <= KILL_STREAK_WINDOW_MS);
    killTimes.push(t);
    handlers.onEvent({ type: 'kill', streak: killTimes.length });
  }, onError);

  const onState = guard((raw: unknown) => {
    const state = raw as { improve?: unknown; hp?: unknown } | null;
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
  }, onError);

  const onCharInfo = guard((raw: unknown) => {
    const info = raw as { name?: unknown } | null;
    charInfoFrames++;
    lastCharInfoAt = now();
    const name = typeof info?.name === 'string' ? info.name.trim() : '';
    if (!name) return;
    if (name !== characterName) {
      characterName = name;
      resetBaselines();
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
    const currentName = readGmcpName(api);
    const knownCharacter = charInfoFrames > 0 && characterName !== null && (currentName === null || currentName === characterName);
    const settled = t - lastCharInfoAt >= CHAR_INFO_SETTLE_MS || charInfoFrames > 1;
    resetBaselines();
    if (knownCharacter && settled) handlers.onEvent({ type: 'death' });
  }, onError);

  const onDisconnect = guard(() => {
    charInfoFrames = 0;
    lastCharInfoAt = -Infinity;
    resetBaselines();
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
        passThrough(() => handlers.onEvent({ type: 'spend' }))(line as unknown as { text?: string }, matches);
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
