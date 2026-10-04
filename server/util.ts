// Small server helpers: ids, room codes, nickname sanitising.

import { randomBytes, randomInt } from 'node:crypto';
import { ROOM_CODE_ALPHABET } from '../src/net/protocol';

export const NAME_MAX = 12;
export const ROOM_NAME_MAX = 20;

export function randomId(bytes = 12): string {
  return randomBytes(bytes).toString('hex');
}

/** Unsigned 32-bit run seed. */
export function randomSeed(): number {
  return randomBytes(4).readUInt32LE(0);
}

/** 4 chars from ROOM_CODE_ALPHABET, not yet taken. */
export function randomRoomCode(taken: (code: string) => boolean): string {
  for (let attempt = 0; ; attempt++) {
    const len = attempt < 2000 ? 4 : 5; // practically never: 32^4 ≈ 1M codes
    let c = '';
    for (let i = 0; i < len; i++) c += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    if (!taken(c)) return c;
  }
}

/** Normalise a typed room code: upper-case, alphabet only. */
export function normalizeRoomCode(raw: string): string {
  const up = raw.toUpperCase();
  let out = '';
  for (const ch of up) if (ROOM_CODE_ALPHABET.includes(ch)) out += ch;
  return out.slice(0, 8);
}

/**
 * Display name: control/format chars removed, whitespace collapsed, trimmed, at most `max` code points.
 * Returns '' when nothing usable is left (caller picks a default).
 */
export function sanitizeName(raw: unknown, max = NAME_MAX): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/gu, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return Array.from(cleaned).slice(0, max).join('').trim();
}
