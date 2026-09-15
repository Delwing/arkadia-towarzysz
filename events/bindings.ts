/**
 * Client event -> reaction. Pure: takes a normalised description of what
 * happened and returns { primitive, intensity, category, moodDelta }.
 *
 * Intensity scaling is what lets one small set of animations cover a hundred
 * scripted actions: a small coin and a huge haul are the same `gulp` at
 * different amplitudes. The mood nudges are indicative and meant to be tuned.
 *
 * A few of the client's events are states rather than moments - a stun that
 * lasts, a float on the water - and those leave the companion in a posture
 * afterwards. That is `stanceFor`, at the bottom of this file.
 */

import type { Category, CompanionSpec, Primitive } from '../companion/types';
import { MOOD_MIN } from '../companion/mood';
import { COPPER_PER } from '../text/coins';

export const MAX_IMPROVE = 15;

export type GameEvent =
  | { type: 'kill'; streak: number }
  | { type: 'improve'; from: number; to: number }
  | { type: 'hurt'; levelsLost: number }
  | { type: 'death' }
  | { type: 'loot'; copper: number }
  /** `copper` when the line said how much changed hands, otherwise unknown. */
  | { type: 'spend'; copper?: number }
  /** Goods sold. The payment, if the game prints it, arrives separately as `loot`. */
  | { type: 'sell' }
  | { type: 'gem'; copper: number }
  /**
   * The drink landing. `level` is the stage of `Char.State.intox` just crossed:
   * 1 a first warmth, 2 properly drunk, 3 barely upright. Stages, not the number
   * itself - see `events/sources.ts`, which only reports a crossing upward.
   */
  | { type: 'intox'; level: number }
  /** The head the next morning, in the same three stages, off `Char.State.headache`. */
  | { type: 'hangover'; level: number }
  /**
   * Zmeczenie at the bottom of the bar: `Char.State.fatigue` crossed into
   * `FATIGUE_SPENT`. One event per sprint, not one per frame.
   */
  | { type: 'fatigue' }
  /** The game said a field of knowledge grew. One tick, whichever field it was. */
  | { type: 'knowledge' }
  /**
   * The room ran out of enemies. `count` is how many went down clearing it, so
   * that finishing off one wandering rat is not mistaken for winning a battle.
   */
  | { type: 'clear'; count: number }
  /** Stunned, and later not. A state, not a moment: see `stanceFor`. */
  | { type: 'stun'; on: boolean }
  /**
   * Fear. `level` is the stage of `Char.State.panic` just crossed, 1..3, read
   * the way the drink is: only a crossing upward, never the number moving.
   */
  | { type: 'panic'; level: number }
  /**
   * In a fight, and later not. The client works this out from its own combat
   * detection, and it is a state rather than a moment: nothing but the posture
   * comes of it, because a companion who announced every fight would announce
   * most of the evening.
   */
  | { type: 'combat'; on: boolean }
  /**
   * The Apocalypse: the client is counting the minutes to the world being
   * destroyed, or has stopped counting. A state with an announcement at the
   * front of it.
   */
  | { type: 'apocalypse'; on: boolean }
  /**
   * A pipe lit, and later out. The lighting is a moment and the going out is
   * nothing at all: a lit pipe travels, so the companion marks it with a sit
   * and a couple of drags rather than staying down for it.
   */
  | { type: 'pipe'; on: boolean }
  /** Somebody wrote to you. */
  | { type: 'mail' }
  /**
   * Fishing, as the client's own tracker sees it. `waiting` is the float on the
   * water, `bite` the line going tight, `catch` the fish landed and `done` the
   * rod out of the water with nothing to show for it.
   */
  | { type: 'fishing'; state: 'waiting' | 'bite' | 'catch' | 'done' }
  /** Aboard a ship or a coach. */
  | { type: 'travel' }
  /** The character is wearing a different body: przeobrazenie, or it wearing off. */
  | { type: 'transform' }
  | { type: 'idle' }
  /**
   * Nothing the companion would react to has happened for a while, and the
   * player is still at the keyboard - see `events/sources.ts`. Not the same as
   * `idle`, which is the player gone and the companion asleep.
   */
  | { type: 'bored' }
  /**
   * The day's temper, rolled at the start of a session. Not a client signal and
   * never resolved to a reaction - the plugin speaks it directly. It is in this
   * union so that nothing can quietly forget it exists.
   */
  | { type: 'temper' };

export type GameEventType = GameEvent['type'];

export const GAME_EVENT_TYPES: readonly GameEventType[] = [
  'kill',
  'improve',
  'hurt',
  'death',
  'loot',
  'spend',
  'sell',
  'gem',
  'intox',
  'hangover',
  'fatigue',
  'knowledge',
  'clear',
  'stun',
  'panic',
  'combat',
  'apocalypse',
  'pipe',
  'mail',
  'fishing',
  'travel',
  'transform',
  'idle',
  'bored',
  'temper',
];

/** The events that are the plugin's own, not the client's; `resolve` declines them. */
export const SILENT_EVENT_TYPES: readonly GameEventType[] = ['temper'];

/**
 * Events that are nothing but a posture: `resolve` declines them and
 * `stanceFor` is the whole of what they do. Being in a fight is the one so far,
 * and it is the clearest case there is - the client says it at the start of
 * every fight and at the end of every fight, which is far too often to be
 * remarked on and exactly often enough to be stood differently.
 */
export const POSTURE_ONLY_EVENT_TYPES: readonly GameEventType[] = ['combat'];

export interface Reaction {
  primitive: Primitive;
  intensity: number;
  category: Category;
  moodDelta: number;
  /**
   * The mood this event *puts* the companion in, ignoring where they were and
   * ignoring `moodDelta`. Only a death has one: every other event argues with
   * the mood by degrees, and a death ends the argument.
   */
  moodSet?: number;
  /**
   * This event's own chance of a line, in place of the category's flat one.
   * For a category whose events differ in size rather than in kind: a room
   * cleared of two rats and one cleared of eight are the same `clear`, and one
   * of them is worth mentioning.
   */
  probability?: number;
  /**
   * Big enough to speak through the global cooldown (`voice/speak.ts`). The
   * judgement is per event, not per category: the same `gemGood` is priority
   * at two mithryls and an ordinary remark at one.
   */
  priority?: boolean;
}

/**
 * Every category `resolve` can mark priority. The settings panel lists these
 * so the exemption is not invisible; a test keeps the list honest.
 */
export const PRIORITY_CATEGORIES: readonly Category[] = ['death', 'improveMax', 'gemGood', 'transform', 'apocalypse'];

export const MOOD = {
  kill: 0.04,
  loot: 0.15,
  improve: 0.25,
  improveMax: 0.45,
  gemGood: 0.1,
  gemBad: -0.04,
  hurt: -0.09,
  /** Not a nudge but a destination: see `Reaction.moodSet`. */
  death: MOOD_MIN,
  spend: 0,
  sell: 0.05,
  intox: 0.06,
  hangover: -0.16,
  // Being run into the ground is the companion's complaint, not an injury -
  // but it repeats through a long chase, so it is kept small.
  fatigue: -0.06,
  knowledge: 0.12,
  clear: 0.12,
  stun: -0.12,
  // Fear is the one thing on this list the game meters for us and nobody
  // enjoys: it is scaled by the stage in `resolve`, so a first fright costs
  // less than being out of your wits.
  panic: -0.12,
  // The world ending is not the player's fault and not their loss, but it is
  // not nothing either: the companion spends the last minutes under their hat.
  apocalypse: -0.1,
  pipe: 0.06,
  mail: 0.05,
  fishBite: 0.03,
  fishCatch: 0.12,
  travel: 0.04,
  transform: 0.02,
  idle: 0,
  // Small, but it repeats: a long stretch of nothing settles the mood a little
  // below level rather than leaving it where the last good thing put it.
  bored: -0.03,
  // The day's greeting reports the mood it was rolled with; it does not move it.
  temper: 0,
} as const;

/**
 * How many of a room's enemies have to go down before clearing it is worth a
 * reaction. The client fires `allEnemiesKilled` whenever the last one dies, so
 * every single kill ends with a cleared room; two is where it starts being a
 * fight you won rather than a thing you did.
 */
export const CLEAR_MIN_KILLS = 2;
/**
 * How likely a cleared room is to get a word, from the smallest group worth
 * counting up to a proper fight. A flat chance cannot serve both: tuned for a
 * pair of rats it stays silent about the ambush, and tuned for the ambush it
 * chatters about every pair of rats.
 */
export const CLEAR_PROBABILITY_MIN = 0.1;
export const CLEAR_PROBABILITY_MAX = 0.9;
/** The group size at which the chance tops out. */
export const CLEAR_PROBABILITY_FULL = 8;

/** 0..1 for a room cleared of `count` enemies. */
export function clearProbability(count: number): number {
  const span = CLEAR_PROBABILITY_FULL - CLEAR_MIN_KILLS;
  const share = Math.min(1, Math.max(0, (count - CLEAR_MIN_KILLS) / span));
  return CLEAR_PROBABILITY_MIN + (CLEAR_PROBABILITY_MAX - CLEAR_PROBABILITY_MIN) * share;
}

/**
 * Copper worth of a gem read-out that counts as "high" / "low"; between the
 * two, no reaction. A stone worth getting excited about starts at a mithryl -
 * gold-priced stones are common enough to be noise.
 */
export const GEM_GOOD_COPPER = COPPER_PER.mithryl;
export const GEM_BAD_COPPER = COPPER_PER.gold;
/**
 * A stone worth speaking through the global cooldown for. One mithryl is a
 * good find and gets the ordinary `gemGood` treatment; two is the one you tell
 * someone about. Unlike a death, these arrive in bags, so the exemption is
 * rationed by `gemGood`'s `priorityWindowMs`.
 */
export const GEM_PRIORITY_COPPER = 2 * COPPER_PER.mithryl;
/** Loot at or above this is a full-size haul (intensity and mood both max out). */
export const LOOT_FULL_COPPER = 2_400;

export const INTENSITY_MIN = 0.4;
export const INTENSITY_MAX = 2.5;

export function clampIntensity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(INTENSITY_MAX, Math.max(INTENSITY_MIN, value));
}

/** Resolve a game event. Returns null when it does not deserve a reaction. */
export function resolve(event: GameEvent): Reaction | null {
  switch (event.type) {
    case 'kill': {
      const streak = Math.max(1, Math.floor(event.streak));
      return {
        primitive: 'lunge',
        intensity: clampIntensity(1 + (streak - 1) * 0.15),
        category: 'kill',
        // A streak multiplies the same nudge; it is not a separate event.
        moodDelta: MOOD.kill,
      };
    }
    case 'improve': {
      if (event.to <= event.from) return null;
      if (event.to >= MAX_IMPROVE) {
        return { primitive: 'cheer', intensity: 2.5, category: 'improveMax', moodDelta: MOOD.improveMax, priority: true };
      }
      return { primitive: 'cheer', intensity: 1, category: 'improve', moodDelta: MOOD.improve };
    }
    case 'hurt': {
      const lost = Math.floor(event.levelsLost);
      if (lost <= 0) return null;
      return {
        primitive: 'flinch',
        intensity: clampIntensity(0.8 + lost * 0.5),
        category: 'hurt',
        // Four levels, not three: being beaten from healthy down to barely
        // standing is most of the way to a death and should cost most of what
        // a death costs.
        moodDelta: MOOD.hurt * Math.min(lost, 4),
      };
    }
    case 'death':
      return {
        primitive: 'topple',
        intensity: 1,
        category: 'death',
        // Nothing is added: dying puts the mood on the floor, whatever kind of
        // day it had been until then. Climbing back out is the drift's job and
        // it takes the best part of an hour of playing.
        moodDelta: 0,
        moodSet: MOOD.death,
        priority: true,
      };
    case 'loot': {
      if (!(event.copper > 0)) return null;
      const share = Math.min(1, event.copper / LOOT_FULL_COPPER);
      return {
        primitive: 'gulp',
        // log-ish ramp: a handful of copper is a twitch, a purse of gold a proper gulp
        intensity: clampIntensity(0.5 + Math.log10(1 + event.copper) / 2),
        category: 'loot',
        moodDelta: MOOD.loot * Math.max(0.1, share),
      };
    }
    case 'spend': {
      const copper = event.copper;
      return {
        primitive: 'slump',
        // A known price scales the sag the same way loot scales the gulp; an
        // unknown one ("Kupujesz chleb.") is an ordinary slump.
        intensity: copper && copper > 0 ? clampIntensity(0.5 + Math.log10(1 + copper) / 2) : 1,
        category: 'spend',
        moodDelta: MOOD.spend,
      };
    }
    case 'sell':
      // Quieter than loot: the coins themselves usually land on the next line
      // and get their own, bigger reaction.
      return { primitive: 'gulp', intensity: 0.8, category: 'sell', moodDelta: MOOD.sell };
    case 'gem': {
      if (event.copper >= GEM_GOOD_COPPER) {
        return {
          primitive: 'glitter',
          intensity: 2.2,
          category: 'gemGood',
          moodDelta: MOOD.gemGood,
          priority: event.copper >= GEM_PRIORITY_COPPER,
        };
      }
      if (event.copper < GEM_BAD_COPPER) {
        return { primitive: 'slump', intensity: 1, category: 'gemBad', moodDelta: MOOD.gemBad };
      }
      return null;
    }
    case 'intox': {
      const level = Math.min(3, Math.max(1, Math.floor(event.level) || 1));
      return {
        primitive: 'sway',
        intensity: clampIntensity(0.8 + (level - 1) * 0.7),
        category: 'intox',
        // Good company, up to a point: the third stage is where the companion
        // stops enjoying it, so the nudge drops away rather than piling up.
        moodDelta: level >= 3 ? 0 : MOOD.intox,
      };
    }
    case 'hangover': {
      const level = Math.min(3, Math.max(1, Math.floor(event.level) || 1));
      return {
        primitive: 'wince',
        intensity: clampIntensity(0.7 + (level - 1) * 0.5),
        category: 'hangover',
        // Even the dull one costs more than the drink that bought it was worth.
        moodDelta: MOOD.hangover * (0.8 + (level - 1) * 0.4),
      };
    }
    case 'fatigue':
      // Winded, and saying so. The same sag a bad purchase gets, harder: this
      // is the animation carrying "slow down" while the line says it.
      return { primitive: 'slump', intensity: 1.5, category: 'fatigue', moodDelta: MOOD.fatigue };
    case 'knowledge':
      // One tick is one tick: the game does not say how big it was, so neither
      // does the companion.
      return { primitive: 'glitter', intensity: 1.2, category: 'knowledge', moodDelta: MOOD.knowledge };
    case 'clear': {
      const count = Math.floor(event.count);
      if (count < CLEAR_MIN_KILLS) return null;
      // Everything about this one scales with the size of the group, because
      // that is the only thing that distinguishes two of them: how big the
      // cheer is, how much it was worth, and how likely they are to say so.
      const share = Math.min(1, (count - CLEAR_MIN_KILLS) / (CLEAR_PROBABILITY_FULL - CLEAR_MIN_KILLS));
      return {
        primitive: 'cheer',
        intensity: clampIntensity(0.9 + (count - CLEAR_MIN_KILLS) * 0.25),
        category: 'clear',
        moodDelta: MOOD.clear * (0.5 + 0.5 * share),
        probability: clearProbability(count),
      };
    }
    case 'stun':
      // The end of it is a posture returning to normal, not news.
      if (!event.on) return null;
      return { primitive: 'stun', intensity: 1, category: 'stun', moodDelta: MOOD.stun };
    case 'panic': {
      const level = Math.min(3, Math.max(1, Math.floor(event.level) || 1));
      return {
        primitive: 'cower',
        intensity: clampIntensity(0.9 + (level - 1) * 0.7),
        category: 'panic',
        moodDelta: MOOD.panic * (0.8 + (level - 1) * 0.4),
      };
    }
    // Being in a fight is a posture and nothing else; see
    // `POSTURE_ONLY_EVENT_TYPES`.
    case 'combat':
      return null;
    case 'apocalypse':
      // The countdown ending is the posture being given back - either the world
      // was destroyed, in which case nobody is listening, or the Rider changed
      // his mind, which the game does not announce.
      if (!event.on) return null;
      return {
        primitive: 'hide',
        intensity: 1,
        category: 'apocalypse',
        moodDelta: MOOD.apocalypse,
        // Once a day at most, and the loudest thing the client ever says. If a
        // run of hits were allowed to swallow it, the exemption would have no
        // purpose at all.
        priority: true,
      };
    case 'pipe':
      // Lighting it is the moment. It going out, a quarter of an hour and
      // several rooms later, is nothing anybody noticed.
      if (!event.on) return null;
      return { primitive: 'smoke', intensity: 1, category: 'pipe', moodDelta: MOOD.pipe };
    case 'mail':
      return { primitive: 'point', intensity: 1, category: 'mail', moodDelta: MOOD.mail };
    case 'fishing':
      switch (event.state) {
        case 'bite':
          return { primitive: 'cheer', intensity: 1.6, category: 'fishBite', moodDelta: MOOD.fishBite };
        case 'catch':
          return { primitive: 'glitter', intensity: 1.5, category: 'fishCatch', moodDelta: MOOD.fishCatch };
        // Casting and giving up are postures; `stanceFor` has them.
        default:
          return null;
      }
    case 'travel':
      return { primitive: 'sway', intensity: 0.9, category: 'travel', moodDelta: MOOD.travel };
    case 'transform':
      // Rare enough - twice per spell, and not every evening has one - that
      // silence would read as the companion not looking at you.
      return { primitive: 'shift', intensity: 1, category: 'transform', moodDelta: MOOD.transform, priority: true };
    case 'idle':
      return { primitive: 'doze', intensity: 1, category: 'idle', moodDelta: MOOD.idle };
    case 'bored':
      // A sag, not a doze: they are awake, they are just out of things to do.
      return { primitive: 'slump', intensity: 0.7, category: 'bored', moodDelta: MOOD.bored };
    // The greeting is not a reaction to anything the game did: the plugin says
    // it once a session, off the temper it just rolled. It is a category and a
    // set of lines, and there is no event that resolves to it.
    case 'temper':
      return null;
  }
}

/**
 * Every posture `stanceFor` can put the companion in. The showcase lists these
 * so a stance can be looked at for as long as it takes to judge one; a test
 * keeps the list honest against `stanceFor` and `guardFor`.
 */
export const STANCES: readonly Primitive[] = ['watch', 'stun', 'guard', 'guardStaff', 'hide'];

/**
 * What a posture stands for. One key per state the client reports, because
 * they overlap: a fight can start while the float is on the water, and be
 * interrupted in turn by the end of the world. Whoever holds these keeps one
 * per key and stands the companion in the most urgent of them
 * (`POSTURE_ORDER`), so that a fight ending by the water sits them back down
 * rather than standing them up.
 */
export type PostureKey = 'stun' | 'apocalypse' | 'combat' | 'fishing';

/**
 * Most urgent first. A stun is brief and physical and outranks everything: a
 * companion who cannot stand up is not holding a sword. Below it, the world
 * ending beats a fight, and a fight beats waiting on a float - which is the
 * order in which a player would stop doing one to do the other.
 */
export const POSTURE_ORDER: readonly PostureKey[] = ['stun', 'apocalypse', 'combat', 'fishing'];

export interface Posture {
  key: PostureKey;
  /** The animation to hold, or `null`: whatever this key stood for is over. */
  primitive: Primitive | null;
}

/**
 * The posture an event leaves the companion in: a key and what to hold for it,
 * `null` to drop every posture at once, `undefined` to leave them all alone.
 *
 * Separate from `resolve` because a posture is not a reaction. Sitting down by
 * the water is not news and says nothing; the stun that is over is only the end
 * of one. What they do about an event and what they are left doing afterwards
 * are two questions, and a stance outlives the animation that announced it.
 */
export function stanceFor(event: GameEvent): Posture | null | undefined {
  switch (event.type) {
    case 'stun':
      return { key: 'stun', primitive: event.on ? 'stun' : null };
    case 'fishing':
      // The bite happens sitting down, so it leaves the sitting alone.
      if (event.state === 'bite') return undefined;
      return { key: 'fishing', primitive: event.state === 'waiting' ? 'watch' : null };
    case 'combat':
      // `guard` is the generic answer; which weapon - or none at all - is
      // `guardFor`, because that is the roll's business and not the event's.
      return { key: 'combat', primitive: event.on ? 'guard' : null };
    case 'apocalypse':
      return { key: 'apocalypse', primitive: event.on ? 'hide' : null };
    // Whatever they were in the middle of, they are not in the middle of it now.
    case 'death':
      return null;
    default:
      return undefined;
  }
}

/**
 * Which guard a companion stands in. Everybody has something to draw - a
 * companion who stood through a fight with empty hands read as a companion who
 * had not noticed it - so the only question is what: the two robed archetypes
 * lean on a staff, everybody else brings out the sword the `lunge` already
 * swings.
 */
export function guardFor(spec: CompanionSpec): Primitive {
  return spec.archetype === 'wizard' || spec.archetype === 'magician' ? 'guardStaff' : 'guard';
}
