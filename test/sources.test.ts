import { describe, expect, it } from 'vitest';
import type { PluginApi } from '@arkadia/plugin-types';
import { attachSources, CHAR_INFO_SETTLE_MS, type Sources } from '../events/sources';
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

function harness(characterName: string | null = 'Delwing'): Harness {
  const client = new FakeClient();
  if (characterName) client.gmcpData = { char: { info: { name: characterName } } };
  const events: GameEvent[] = [];
  const counted = { respawns: 0 };
  let clock = 1_000_000;
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
      setTimer: () => null,
      clearTimer: () => undefined,
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
    },
  };
}

describe('respawn', () => {
  it('reports every reset, because each one is a new object number', () => {
    const h = harness();
    expect(h.respawns).toBe(0);
    h.client.emit('reset', undefined);
    expect(h.respawns).toBe(1);
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
    const h = harness();
    h.advance(CHAR_INFO_SETTLE_MS + 1);
    h.client.emit('reset');
    expect(h.events).toEqual([{ type: 'death' }]);
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
