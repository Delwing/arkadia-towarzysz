import { describe, expect, it } from 'vitest';
import type { PluginApi } from '@arkadia/plugin-types';
import {
  attachSources,
  BODY_SETTLE_MS,
  HANGOVER_STAGES,
  INTOX_STAGES,
  stageOf,
  STUN_CAP_MS,
  type Sources,
} from '../events/sources';
import type { GameEvent } from '../events/bindings';
import { coinsToCopper } from '../text/coins';

interface RegisteredTrigger {
  pattern: RegExp;
  handler: (line: unknown, matches: RegExpMatchArray) => unknown;
  tag: string;
}

/** Just enough of the client for the source layer: events, triggers, gmcp. */
class FakeClient {
  readonly events = new Map<string, Set<(payload?: unknown) => void>>();
  triggers: RegisteredTrigger[] = [];
  gmcpData: unknown = {};

  readonly api = {
    events: {
      on: (name: string, fn: (payload?: unknown) => void) => {
        if (!this.events.has(name)) this.events.set(name, new Set());
        this.events.get(name)?.add(fn);
      },
      off: (name: string, fn: (payload?: unknown) => void) => {
        this.events.get(name)?.delete(fn);
      },
    },
    triggers: {
      register: (pattern: RegExp, handler: RegisteredTrigger['handler'], tag: string) => {
        this.triggers.push({ pattern, handler, tag });
        return String(this.triggers.length);
      },
      removeByTag: (tag: string) => {
        this.triggers = this.triggers.filter((t) => t.tag !== tag);
      },
    },
    gmcp: { get: () => this.gmcpData },
  } as unknown as PluginApi;

  emit(name: string, payload?: unknown): void {
    for (const fn of [...(this.events.get(name) ?? [])]) fn(payload);
  }

  /** Feed one line of game text through every trigger that matches it. */
  line(text: string): void {
    for (const trigger of [...this.triggers]) {
      const matches = text.match(trigger.pattern);
      if (matches) trigger.handler({ text }, matches);
    }
  }
}

interface Harness {
  client: FakeClient;
  events: GameEvent[];
  /** How many times the client said the character's object number changed. */
  respawns: number;
  sources: Sources;
  advance(ms: number): void;
}

function harness(characterName: string | null = 'Delwing', objectNum: number | null = 101): Harness {
  const client = new FakeClient();
  if (characterName) client.gmcpData = { char: { info: { name: characterName, object_num: objectNum } } };
  const events: GameEvent[] = [];
  const counted = { respawns: 0 };
  let clock = 1_000_000;
  // Fake timers: `advance` moves the clock and fires whatever came due, which
  // is how the body-change verdict and the stun cap are exercised.
  let nextHandle = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const sources = attachSources(
    client.api,
    {
      onEvent: (event) => events.push(event),
      onActivity: () => undefined,
      onRespawn: () => {
        counted.respawns++;
      },
      onCharacter: () => undefined,
      onDisconnect: () => undefined,
    },
    {
      idleMs: () => 0, // no idle timer in these tests
      coinsToCopper,
      now: () => clock,
      setTimer: (fn, ms) => {
        const handle = nextHandle++;
        timers.set(handle, { at: clock + ms, fn });
        return handle;
      },
      clearTimer: (handle) => {
        timers.delete(handle as number);
      },
      onError: (error) => {
        throw error;
      },
    },
  );
  return {
    client,
    events,
    sources,
    get respawns() {
      return counted.respawns;
    },
    advance(ms: number) {
      clock += ms;
      for (const [handle, timer] of [...timers]) {
        if (timer.at > clock) continue;
        timers.delete(handle);
        timer.fn();
      }
    },
  };
}

describe('respawn', () => {
  it('reports every reset, because each one is a new object number', () => {
    // Nobody logged in yet, so the first reset is a login rather than a death.
    const h = harness(null, null);
    expect(h.respawns).toBe(0);
    h.client.emit('reset', undefined);
    expect(h.respawns).toBe(1);
    h.client.emit('gmcp.char.info', { name: 'Delwing' });
    // Including the one that follows a death we already reported: that reset is
    // the respawn, and it is what puts the companion back on their feet.
    h.client.line('Umierasz.');
    h.advance(3000);
    h.client.emit('reset', undefined);
    expect(h.respawns).toBe(2);
    expect(h.events.filter((e) => e.type === 'death')).toHaveLength(1);
  });
});

describe('death', () => {
  it('fires on "Umierasz.", the line the game actually prints', () => {
    const h = harness();
    h.client.line('Umierasz.');
    expect(h.events).toEqual([{ type: 'death' }]);
  });

  it('does not fire again on the reset that follows the respawn', () => {
    const h = harness();
    h.client.line('Umierasz.');
    h.client.line('Oddalasz sie.');
    // The respawn can be a long time later; the flag is what links them, not a window.
    h.advance(10 * 60_000);
    h.client.emit('reset');
    expect(h.events).toEqual([{ type: 'death' }]);
  });

  it('still falls back to the reset heuristic when no line was seen', () => {
    // The plugin attached into a session already under way, so the character
    // was alive and wearing a body: a reset can only be the end of that life.
    const h = harness();
    h.client.emit('reset');
    expect(h.events).toEqual([{ type: 'death' }]);
  });

  it('does not take a login for a death', () => {
    // Nobody home yet: no name, no body, and the reset that arrives is the
    // client starting a life rather than ending one.
    const h = harness(null, null);
    h.client.emit('reset');
    expect(h.events).toEqual([]);
    expect(h.respawns).toBe(1);
  });

  it('does not take a character switch for a death', () => {
    const h = harness();
    // The client sets the new character before it fires the reset, so by the
    // time we are asked, gmcp already names somebody else.
    h.client.gmcpData = { char: { info: { name: 'Ktosinny', object_num: 303 } } };
    h.client.emit('reset');
    expect(h.events).toEqual([]);
  });

  it('treats a second death as its own', () => {
    const h = harness();
    h.client.line('Umierasz.');
    h.client.emit('reset');
    h.client.line('Umierasz.');
    expect(h.events).toEqual([{ type: 'death' }, { type: 'death' }]);
  });

  it('ignores "Oddalasz sie." on its own', () => {
    const h = harness();
    h.client.line('Oddalasz sie.');
    expect(h.events).toEqual([]);
  });
});

describe('money lines', () => {
  it('reads the price out of the shopkeeper taking payment', () => {
    const h = harness();
    h.client.line('Usmiechniety dojrzaly mezczyzna drapieznym ruchem zgarnia 9 srebrnych i 30 miedzianych monet.');
    expect(h.events).toEqual([{ type: 'spend', copper: 9 * 12 + 30 }]);
  });

  it('reads the price out of the shopkeeper taking it in exchange for goods', () => {
    const h = harness();
    h.client.line(
      'Chudy brodaty mezczyzna odbiera od ciebie dwie srebrne i trzy miedziane monety w zamian za zakupiony towar.',
    );
    expect(h.events).toEqual([{ type: 'spend', copper: 2 * 12 + 3 }]);
  });

  it('ignores a handover that is not a purchase', () => {
    const h = harness();
    h.client.line('Chudy brodaty mezczyzna odbiera od ciebie dwie srebrne monety i kiwa glowa.');
    expect(h.events).toEqual([]);
  });

  it('still reports a spend when the line gives no price', () => {
    const h = harness();
    h.client.line('Kupujesz bochenek chleba.');
    expect(h.events).toEqual([{ type: 'spend' }]);
  });

  it('reports a sale, and not a spend or a loot', () => {
    const h = harness();
    h.client.line('Sprzedajesz dwie surowe czerwonozlote ryby.');
    expect(h.events).toEqual([{ type: 'sell' }]);
  });

  it('lets the payment for a sale arrive as its own loot', () => {
    const h = harness();
    h.client.line('Sprzedajesz dwie surowe czerwonozlote ryby.');
    h.client.line('Dostajesz cztery srebrne monety.');
    expect(h.events).toEqual([{ type: 'sell' }, { type: 'loot', copper: 4 * 12 }]);
  });

  it('ignores a coinless loot line', () => {
    const h = harness();
    h.client.line('Bierzesz zardzewialy miecz z ciala szczura.');
    expect(h.events).toEqual([]);
  });
});

describe('detach', () => {
  it('removes the triggers it registered', () => {
    const h = harness();
    expect(h.client.triggers.length).toBeGreaterThan(0);
    h.sources.detach();
    expect(h.client.triggers).toEqual([]);
    h.client.emit('reset');
    expect(h.events).toEqual([]);
  });
});

describe('drink', () => {
  const [tipsy, drunk, gone] = INTOX_STAGES;
  const [dull, bad, awful] = HANGOVER_STAGES;

  /** A Char.State frame carrying only the fields a test cares about. */
  const state = (fields: Record<string, unknown>) => fields;

  it('cuts each of the client\'s own scales into three', () => {
    // intox is 0..9 in the client's bar, headache 0..6; both default to 0.
    expect(stageOf(0, INTOX_STAGES)).toBe(0);
    expect(stageOf(tipsy, INTOX_STAGES)).toBe(1);
    expect(stageOf(drunk, INTOX_STAGES)).toBe(2);
    expect(stageOf(gone, INTOX_STAGES)).toBe(3);
    expect(stageOf(9, INTOX_STAGES)).toBe(3);
    expect(stageOf(0, HANGOVER_STAGES)).toBe(0);
    expect(stageOf(dull, HANGOVER_STAGES)).toBe(1);
    expect(stageOf(bad, HANGOVER_STAGES)).toBe(2);
    expect(stageOf(6, HANGOVER_STAGES)).toBe(3);
    expect(awful).toBeLessThanOrEqual(6);
  });

  it('takes the first reading as a baseline, so logging in drunk is not a drink', () => {
    const h = harness();
    h.client.emit('gmcp.char.state', state({ intox: 9, headache: 6 }));
    expect(h.events).toEqual([]);
  });

  it('reacts when a stage is crossed, not when a sip is taken', () => {
    const h = harness();
    h.client.emit('gmcp.char.state', state({ intox: 0 }));
    h.client.emit('gmcp.char.state', state({ intox: tipsy }));
    h.client.emit('gmcp.char.state', state({ intox: tipsy + 1 }));
    h.client.emit('gmcp.char.state', state({ intox: drunk - 1 }));
    expect(h.events).toEqual([{ type: 'intox', level: 1 }]);

    h.client.emit('gmcp.char.state', state({ intox: drunk }));
    h.client.emit('gmcp.char.state', state({ intox: gone }));
    expect(h.events).toEqual([
      { type: 'intox', level: 1 },
      { type: 'intox', level: 2 },
      { type: 'intox', level: 3 },
    ]);
  });

  it('says nothing about sobering up, and reacts again on the next bout', () => {
    const h = harness();
    h.client.emit('gmcp.char.state', state({ intox: 0 }));
    h.client.emit('gmcp.char.state', state({ intox: drunk }));
    h.client.emit('gmcp.char.state', state({ intox: 0 }));
    expect(h.events).toEqual([{ type: 'intox', level: 2 }]);

    h.client.emit('gmcp.char.state', state({ intox: tipsy }));
    expect(h.events).toEqual([
      { type: 'intox', level: 2 },
      { type: 'intox', level: 1 },
    ]);
  });

  it('reacts to the head arriving and to it getting worse, not to it wearing off', () => {
    const h = harness();
    h.client.emit('gmcp.char.state', state({ headache: 0 }));
    h.client.emit('gmcp.char.state', state({ headache: dull }));
    h.client.emit('gmcp.char.state', state({ headache: bad }));
    // All morning, ticking down: silent the whole way.
    h.client.emit('gmcp.char.state', state({ headache: bad - 1 }));
    h.client.emit('gmcp.char.state', state({ headache: dull }));
    h.client.emit('gmcp.char.state', state({ headache: 0 }));
    expect(h.events).toEqual([
      { type: 'hangover', level: 1 },
      { type: 'hangover', level: 2 },
    ]);

    // A second morning is a second headache.
    h.client.emit('gmcp.char.state', state({ headache: dull }));
    expect(h.events).toHaveLength(3);
  });

  it('reads both fields off one frame', () => {
    const h = harness();
    h.client.emit('gmcp.char.state', state({ intox: 0, headache: 0 }));
    h.client.emit('gmcp.char.state', state({ intox: gone, headache: awful }));
    expect(h.events).toEqual([
      { type: 'intox', level: 3 },
      { type: 'hangover', level: 3 },
    ]);
  });

  it('ignores a frame that carries neither field, and a value that is not a number', () => {
    const h = harness();
    h.client.emit('gmcp.char.state', state({ intox: 0, headache: 0 }));
    h.client.emit('gmcp.char.state', state({ hp: 6 }));
    h.client.emit('gmcp.char.state', state({ intox: 'sporo' }));
    expect(h.events).toEqual([]);
  });

  it('starts a new character sober', () => {
    const h = harness();
    h.client.emit('gmcp.char.state', state({ intox: 0 }));
    h.client.emit('gmcp.char.state', state({ intox: gone }));
    h.client.emit('gmcp.char.info', { name: 'Ktosinny' });
    // The first frame after the switch is that character's baseline.
    h.client.emit('gmcp.char.state', state({ intox: gone }));
    expect(h.events).toEqual([{ type: 'intox', level: 3 }]);
  });
});

describe('bodies', () => {
  it('reads a new object number with no reset behind it as a przeobrazenie', () => {
    const h = harness();
    // The client drops the id while it works out which object in the room we
    // have become, then hands the new one over.
    h.client.emit('player.objectNum', undefined);
    h.client.emit('player.objectNum', 202);
    expect(h.events).toEqual([]);
    h.advance(BODY_SETTLE_MS);
    expect(h.events).toEqual([{ type: 'transform' }]);
    // And again when the spell lapses and the old body comes back.
    h.client.emit('player.objectNum', 101);
    h.advance(BODY_SETTLE_MS);
    expect(h.events).toEqual([{ type: 'transform' }, { type: 'transform' }]);
  });

  it('reads one with a reset behind it as a new life, not a new body', () => {
    const h = harness();
    // A death moves the number first and explains itself a tick later.
    h.client.emit('player.objectNum', 202);
    h.client.emit('reset');
    h.advance(BODY_SETTLE_MS * 4);
    expect(h.events).toEqual([{ type: 'death' }]);
  });

  it('reads a login the same way round, reset first', () => {
    const h = harness(null, null);
    h.client.emit('reset');
    h.client.emit('player.objectNum', 101);
    h.advance(BODY_SETTLE_MS * 4);
    expect(h.events).toEqual([]);
  });

  it('does not call the first body of a session a change of body', () => {
    const h = harness(null, null);
    h.client.emit('player.objectNum', 101);
    h.advance(BODY_SETTLE_MS * 4);
    expect(h.events).toEqual([]);
    expect(h.respawns).toBe(1);
  });

  it('gets the companion up whenever the object number moves', () => {
    const h = harness();
    h.client.line('Umierasz.');
    expect(h.respawns).toBe(0);
    h.client.emit('player.objectNum', 202);
    expect(h.respawns).toBe(1);
  });

  it('ignores the client re-identifying the same body', () => {
    const h = harness();
    h.client.emit('player.objectNum', 101);
    h.client.emit('player.objectNum', undefined);
    h.client.emit('player.objectNum', 101);
    h.advance(BODY_SETTLE_MS * 4);
    expect(h.events).toEqual([]);
    expect(h.respawns).toBe(0);
  });

  it('forgets the body on a disconnect, so the next login is not a death', () => {
    const h = harness();
    h.client.emit('client.disconnect');
    h.client.emit('reset');
    expect(h.events).toEqual([]);
  });
});

describe('clearing a room', () => {
  it('counts the group, and leaves a room cleared of one to the kill itself', () => {
    const h = harness();
    h.client.emit('kill', { killer: 'ME' });
    h.client.emit('allEnemiesKilled');
    expect(h.events).toEqual([
      { type: 'kill', streak: 1 },
      { type: 'clear', count: 1 },
    ]);
  });

  it('counts the kills since the room was last cleared', () => {
    const h = harness();
    for (let i = 0; i < 3; i++) h.client.emit('kill', { killer: 'ME' });
    h.client.emit('allEnemiesKilled');
    expect(h.events.at(-1)).toEqual({ type: 'clear', count: 3 });
    // The next group starts from nothing.
    h.client.emit('kill', { killer: 'ME' });
    h.client.emit('allEnemiesKilled');
    expect(h.events.at(-1)).toEqual({ type: 'clear', count: 1 });
  });

  it('reports nothing to react to when the client says it twice', () => {
    // The client re-checks the room on every `parsedNums`, so one cleared room
    // can announce itself more than once; the second has no kills behind it.
    const h = harness();
    h.client.emit('kill', { killer: 'ME' });
    h.client.emit('kill', { killer: 'ME' });
    h.client.emit('allEnemiesKilled');
    h.client.emit('allEnemiesKilled');
    expect(h.events.at(-2)).toEqual({ type: 'clear', count: 2 });
    expect(h.events.at(-1)).toEqual({ type: 'clear', count: 0 });
  });

  it('counts only the kills that were ours', () => {
    const h = harness();
    h.client.emit('kill', { killer: 'ME' });
    h.client.emit('kill', { killer: 'OTHER' });
    h.client.emit('allEnemiesKilled');
    expect(h.events.at(-1)).toEqual({ type: 'clear', count: 1 });
  });
});

describe('stun', () => {
  it('starts and ends with the gags the client fires', () => {
    const h = harness();
    h.client.emit('stunStart');
    h.client.emit('stunEnd');
    expect(h.events).toEqual([
      { type: 'stun', on: true },
      { type: 'stun', on: false },
    ]);
  });

  it('reports one stun however many times the line fires', () => {
    const h = harness();
    h.client.emit('stunStart');
    h.client.emit('stunStart');
    expect(h.events).toEqual([{ type: 'stun', on: true }]);
  });

  it('ends on its own when the line that would end it is missed', () => {
    const h = harness();
    h.client.emit('stunStart');
    h.advance(STUN_CAP_MS);
    expect(h.events).toEqual([
      { type: 'stun', on: true },
      { type: 'stun', on: false },
    ]);
    // And the end that finally arrives does not report a second one.
    h.client.emit('stunEnd');
    expect(h.events).toHaveLength(2);
  });

  it('keeps the cap fresh while the stun is being renewed', () => {
    const h = harness();
    h.client.emit('stunStart');
    h.advance(STUN_CAP_MS - 1);
    h.client.emit('stunStart');
    h.advance(STUN_CAP_MS - 1);
    expect(h.events).toEqual([{ type: 'stun', on: true }]);
  });

  it('ignores an end with no stun behind it', () => {
    const h = harness();
    h.client.emit('stunEnd');
    expect(h.events).toEqual([]);
  });

  it('does not leave the companion reeling through a respawn', () => {
    const h = harness();
    h.client.emit('stunStart');
    h.client.emit('reset');
    expect(h.events).toContainEqual({ type: 'stun', on: false });
  });
});

describe('fishing', () => {
  it('follows the client state through a catch', () => {
    const h = harness();
    h.client.emit('fishing.state', { state: 'idle' });
    h.client.emit('fishing.state', { state: 'fishing' });
    h.client.emit('fishing.state', { state: 'biting' });
    h.client.emit('fishing.state', { state: 'pulling' });
    h.client.emit('fishing.state', { state: 'idle' });
    h.client.line('Wyciagasz zlapana rybe na powierzchnie.');
    expect(h.events).toEqual([
      { type: 'fishing', state: 'waiting' },
      { type: 'fishing', state: 'bite' },
      { type: 'fishing', state: 'done' },
      { type: 'fishing', state: 'catch' },
    ]);
  });

  it('ends the sitting when the rod comes out with nothing on it', () => {
    const h = harness();
    h.client.emit('fishing.state', { state: 'fishing' });
    h.client.emit('fishing.state', { state: 'idle' });
    expect(h.events).toEqual([
      { type: 'fishing', state: 'waiting' },
      { type: 'fishing', state: 'done' },
    ]);
  });

  it('ignores a state that has not changed, and one that is not a state', () => {
    const h = harness();
    h.client.emit('fishing.state', { state: 'fishing' });
    h.client.emit('fishing.state', { state: 'fishing' });
    h.client.emit('fishing.state', {});
    h.client.emit('fishing.state', undefined);
    expect(h.events).toEqual([{ type: 'fishing', state: 'waiting' }]);
  });
});

describe('transport', () => {
  it('reacts to getting on board, and not to getting off', () => {
    const h = harness();
    h.client.emit('transport.onBoard', true);
    h.client.emit('transport.onBoard', false);
    expect(h.events).toEqual([{ type: 'travel' }]);
  });

  it('does not react twice to the same deck', () => {
    const h = harness();
    h.client.emit('transport.onBoard', true);
    h.client.emit('transport.onBoard', true);
    expect(h.events).toEqual([{ type: 'travel' }]);
  });
});

describe('knowledge', () => {
  it('reports a tick, whatever it was about', () => {
    const h = harness();
    h.client.emit('knowledgeTickEvent', { category: 'walka', dative: 'walce' });
    expect(h.events).toEqual([{ type: 'knowledge' }]);
  });
});
