// 기획 19차 보스 레이드 (docs/boss-raid.md 8장): this device's record — the best floor I reached, how often I cleared all
// 20 and how many runs I played (solo and multiplayer alike). Read by the main-menu card and the result screen.
// Every access is wrapped: blocked, cleared or corrupt storage reads as an empty record and the game keeps working.

import type { RunResult } from '../types';
import type { KeyValueStore } from './expeditionStore';

export const BOSS_RAID_KEY = 'swap-tower.bossRaid.v1';
/** 기획 22차 궁극기 테스트: its own record (the same shape), never mixed with the raid's. */
export const ULT_TEST_KEY = 'swap-tower.ultTest.v1';

/** 기획 22차: the record key of a raid-shaped mode. */
export function recordKeyFor(mode: string | null | undefined): string {
  return mode === 'ultTest' ? ULT_TEST_KEY : BOSS_RAID_KEY;
}

export interface BossRaidRecord {
  /** Highest floor reached (0 = never played). */
  bestFloor: number;
  /** Runs won (every boss beaten). */
  clears: number;
  /** Runs played to a result. */
  runs: number;
}

/** What one finished run did to the record (the result screen shows 「신기록」 from it). */
export interface BossRaidUpdate {
  record: BossRaidRecord;
  /** bestFloor before this run. */
  prevBest: number;
  isNewBest: boolean;
  /** False when it could not be saved (storage blocked / full): the record still counts for this screen. */
  saved: boolean;
}

/** Floors are whole numbers in a sane range (debug can skip past 20). */
const MAX_FLOOR = 999;

function storage(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function count(v: unknown, max = Number.MAX_SAFE_INTEGER): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(max, Math.floor(v)) : 0;
}

export function emptyBossRaidRecord(): BossRaidRecord {
  return { bestFloor: 0, clears: 0, runs: 0 };
}

/** Stored text → record (anything unreadable → empty). PURE. */
export function parseBossRaidRecord(raw: string | null): BossRaidRecord {
  if (!raw) return emptyBossRaidRecord();
  try {
    const o = JSON.parse(raw) as Partial<Record<keyof BossRaidRecord, unknown>> | null;
    if (!o || typeof o !== 'object') return emptyBossRaidRecord();
    return { bestFloor: count(o.bestFloor, MAX_FLOOR), clears: count(o.clears), runs: count(o.runs) };
  } catch {
    return emptyBossRaidRecord();
  }
}

/** The record after one more finished run. PURE. */
export function applyBossRaidResult(rec: BossRaidRecord, result: Pick<RunResult, 'outcome' | 'floorReached'>): BossRaidRecord {
  return {
    bestFloor: Math.max(rec.bestFloor, count(result.floorReached, MAX_FLOOR)),
    clears: rec.clears + (result.outcome === 'victory' ? 1 : 0),
    runs: rec.runs + 1,
  };
}

/** This device's record (key: 기획 22차 ULT_TEST_KEY for 궁극기 테스트). Never throws. */
export function loadBossRaidRecord(st: KeyValueStore | null = storage(), key = BOSS_RAID_KEY): BossRaidRecord {
  try {
    return parseBossRaidRecord(st?.getItem(key) ?? null);
  } catch {
    return emptyBossRaidRecord();
  }
}

/** Count one finished run (read → change → save: another tab may have played meanwhile). Never throws. */
export function recordBossRaidResult(result: Pick<RunResult, 'outcome' | 'floorReached'>, st: KeyValueStore | null = storage(), key = BOSS_RAID_KEY): BossRaidUpdate {
  const before = loadBossRaidRecord(st, key);
  const record = applyBossRaidResult(before, result);
  let saved = false;
  try {
    if (st) {
      st.setItem(key, JSON.stringify(record));
      saved = true;
    }
  } catch {
    saved = false;
  }
  return { record, prevBest: before.bestFloor, isNewBest: record.bestFloor > before.bestFloor, saved };
}

/** Main-menu card foot: 「첫 도전」 / 「최고 기록 7층 · 클리어 0회」. PURE. */
export function bossRaidFoot(rec: BossRaidRecord): string {
  return rec.runs > 0 || rec.bestFloor > 0 ? `최고 기록 ${rec.bestFloor}층 · 클리어 ${rec.clears}회` : '첫 도전';
}
