// 기획 20차 보스 형태 (docs/bosses.md 3장): the soft-lock probe. A boss that walks, charges and relocates can end up where
// nobody reaches it — or leave the party with nowhere to stand. This runs bots-only fights against every boss (or one)
// and watches them tick by tick (tests/sim/bossRaidHelpers.ts probeFight).
//
//   npx vite-node tests/review/boss-softlock.ts                      every boss, 3 seeds, the mixed bot party
//   npx vite-node tests/review/boss-softlock.ts BOSS=washer_drum      one boss
//   npx vite-node tests/review/boss-softlock.ts BOSS=washer_drum COMP=melee RUNS=8
//   npx vite-node tests/review/boss-softlock.ts COMP=melee MOVE=2 TELE=0.5
//
//   BOSS=<id>      one boss (default: all 20)
//   RUNS=3         fights per boss (seeds SEED0 + k × 7919)
//   SEED0=2000
//   COMP=mixed|melee   the three bot seats: tank + ranged + healer …, or melee characters only
//   SECONDS=240    how long a fight may take
//   MOVE= TELE= AREA= RAID_HP= RAID_ATK=   the 보스 튜닝 sliders (bossMoveMult, bossTelegraphMult, bossAreaMult, …)
//
// Probes per fight (longest stretch in seconds):
//   멈춤       a moving boss neither moved, swung nor cast for 6 s while its target was out of reach     → exit 1
//   무피해     the boss lost no HP for 12 s while a character was on the field                             → exit 1
//   캐릭 멈춤   a character neither moved nor swung for 4 s (not stunned / rooted)                           → exit 1
//   안 끝남    the fight was still open after SECONDS                                                      → exit 1
//   좌표       a NaN / out-of-arena position, the boss outside its box                                     → exit 1
//   잔여물     enemy zones / warnings / pending hits left after the floor clear                            → exit 1
//   무패턴     no boss skill for 25 s                                                                      (report only)
//   장판 위    characters stood in enemy zones more than 25 % of the time                                  (report only)
//   혼잡       more than 40 zones + warnings at once                                                        (report only)

import { BOSSES, RAID_BOSS_IDS } from '../../src/data';
import { bossFormOf } from '../../src/sim/bossForm';
import { MELEE_PARTY, MIXED_PARTY, PROBE_LIMITS, probeFight, type ProbeResult } from '../sim/bossProbe';
import type { Tunables } from '../../src/types';

const proc = (globalThis as { process?: { env: Record<string, string | undefined>; argv: string[]; exitCode?: number } }).process!;
const arg: Record<string, string> = {};
for (const a of proc.argv.slice(2)) {
  const eq = a.indexOf('=');
  if (eq > 0) arg[a.slice(0, eq).toUpperCase()] = a.slice(eq + 1);
}
const get = (k: string): string | undefined => arg[k] ?? proc.env[k];
const num = (k: string): number | undefined => {
  const v = get(k);
  return v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined;
};

const ids = get('BOSS') ? get('BOSS')!.split(',') : [...RAID_BOSS_IDS];
const runs = Math.max(1, Math.floor(num('RUNS') ?? 3));
const seed0 = num('SEED0') ?? 2000;
const seconds = num('SECONDS') ?? 240;
const melee = (get('COMP') ?? 'mixed').toLowerCase() === 'melee';
const tunables: Partial<Tunables> = {};
const knob = (k: string, key: keyof Tunables): void => {
  const v = num(k);
  if (v != null) (tunables as Record<string, number>)[key] = v;
};
knob('MOVE', 'bossMoveMult');
knob('TELE', 'bossTelegraphMult');
knob('AREA', 'bossAreaMult');
knob('RAID_HP', 'bossRaidHpMult');
knob('RAID_ATK', 'bossRaidAtkMult');

const known = new Set(BOSSES.map(b => b.id));
const f1 = (v: number): string => v.toFixed(1);
const pad = (v: string, n: number): string => (v.length >= n ? v : v + ' '.repeat(n - v.length));

console.log(`보스 멈춤 검사 — 파티 ${melee ? '근접만' : '혼합'} · 보스당 ${runs}판 · 최대 ${seconds}초${Object.keys(tunables).length ? ` · 슬라이더 ${JSON.stringify(tunables)}` : ''}`);
console.log(`${pad('보스', 20)} ${pad('형태', 11)} 끝          초     이동  멈춤 무피해 무패턴 캐릭멈춤 장판위 혼잡  실패`);

let failed = 0;
const notes: string[] = [];
for (const id of ids) {
  if (!known.has(id)) {
    console.log(`${pad(id, 20)} (모르는 보스 id)`);
    failed++;
    continue;
  }
  const form = bossFormOf(BOSSES.find(b => b.id === id));
  const rows: ProbeResult[] = [];
  for (let k = 0; k < runs; k++) rows.push(probeFight(id, { seed: seed0 + k * 7919, seconds, players: melee ? MELEE_PARTY : MIXED_PARTY, tunables }));
  const worst = (pick: (r: ProbeResult) => number): number => Math.max(...rows.map(pick));
  const ends = rows.map(r => r.end);
  const endText = ['clear', 'wipe', 'timeout', 'open'].filter(e => ends.includes(e as ProbeResult['end'])).map(e => `${e}×${ends.filter(x => x === e).length}`).join(' ');
  const fails = [...new Set(rows.flatMap(r => r.fails))];
  const warn: string[] = [];
  if (worst(r => r.noSkillMax) >= PROBE_LIMITS.noSkill) warn.push('무패턴');
  if (worst(r => r.zoneShare) > PROBE_LIMITS.zoneShare) warn.push('장판 위');
  if (worst(r => r.clutterMax) > PROBE_LIMITS.clutter) warn.push('혼잡');
  if (fails.length) failed++;
  const mean = (pick: (r: ProbeResult) => number): number => rows.reduce((a, r) => a + pick(r), 0) / rows.length;
  console.log(
    `${pad(id, 20)} ${pad(form, 11)} ${pad(endText, 11)} ${pad(f1(mean(r => r.seconds)), 6)} ${pad(f1(mean(r => r.travelled)), 5)} ` +
      `${pad(f1(worst(r => r.bossStallMax)), 4)} ${pad(f1(worst(r => r.noDamageMax)), 6)} ${pad(f1(worst(r => r.noSkillMax)), 6)} ${pad(f1(worst(r => r.charStallMax)), 8)} ` +
      `${pad(`${Math.round(worst(r => r.zoneShare) * 100)}%`, 6)} ${pad(String(worst(r => r.clutterMax)), 5)} ${fails.length ? fails.join(',') : '—'}${warn.length ? `  (참고: ${warn.join(', ')})` : ''}`,
  );
  for (const r of rows) {
    for (const b of r.badCoords) notes.push(`${id} 시드 ${r.seed}: 좌표 — ${b}`);
    if (r.leftovers.length) notes.push(`${id} 시드 ${r.seed}: 잔여물 — ${r.leftovers.slice(0, 4).join(', ')}`);
  }
}
for (const n of notes) console.log(n);
console.log(failed === 0 ? '\n통과: 멈춤 없음.' : `\n실패: 보스 ${failed}종 — 위 「실패」 칸을 보세요.`);
if (failed > 0) proc.exitCode = 1;

export {};
