/**
 * The voice packs, typed. `voices.json` is the file you tinker with; this module
 * is the only place that reads it, so the JSON shape is checked once here.
 */

import voicesJson from './voices.json';
import type { Category, MoodBucket } from '../companion/types';

export type VoiceLines = Partial<Record<Category, Partial<Record<MoodBucket, string[]>>>>;

export interface VoicePack {
  name: string;
  lines: VoiceLines;
}

export const VOICES: Record<string, VoicePack> = voicesJson as Record<string, VoicePack>;

/** Stable order: this is what the roll indexes into, so never reorder it casually. */
export const VOICE_IDS: readonly string[] = ['giermek', 'weteran', 'wieszcz', 'maloomowny'];

export function voiceName(id: string): string {
  return VOICES[id]?.name ?? id;
}
