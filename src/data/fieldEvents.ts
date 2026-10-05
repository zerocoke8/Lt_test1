// 기획 12차: 돌발 괴담 — small timed objectives during combat (docs/combat-events.md). Every number the sim reads lives
// here (one file to tune); the banner / pill / toast texts are generated from these numbers.

import type { FieldEventDef, FieldEventId, FieldEventReward, FloorTheme, MonsterDef } from '../types';
import { GOEDAM_TRACES } from './goedam';

/** Drag-skill and pet damage on an event 'target' (toad, printer): ×2, shown as '약점'. */
export const WEAK_MULT = 2;
/** A character dropped within max(LOCK_MIN, its range + LOCK_EXTRA) of a target locks onto it (rule 2). */
export const LOCK_MIN = 2.5;
export const LOCK_EXTRA = 1;
/** A held target farther than this is released (rule 3). */
export const LOCK_RELEASE = 8;
/** Salt of the event rng streams (mixSeed(seed, salt, stream, floor)) — never the run rng. */
export const FIELD_EVENT_SALT = 0xfe12c4;
/** Earliest floor second an event may start (warning included). */
export const FIELD_EVENT_EARLIEST = 8;
/** An event must be over this many seconds before the floor's last wave (so a floor never clears under it). */
export const FIELD_EVENT_MARGIN = 2;
/** Floors with events: 2..FIELD_EVENT_LAST_FLOOR, normal floors only. Floor 2 is always the toad. */
export const FIELD_EVENT_LAST_FLOOR = 19;
export const FIELD_EVENT_FIRST_FLOOR = 2;
/** The same event at most this many times per run. */
export const FIELD_EVENT_MAX_PER_RUN = 2;
/** Spawn spots are picked within anchor.x ± this (the party's screen). */
export const FIELD_EVENT_SPREAD = 9;

/** Lock radius of a unit with this basic-attack range. */
export function lockRadius(range: number): number {
  return Math.max(LOCK_MIN, range + LOCK_EXTRA);
}

/** 비상등: fixed x bands (left / middle / right), y anywhere in LAMP_Y. */
export const LAMP_BANDS: readonly [number, number][] = [
  [2.5, 6.5],
  [15, 21],
  [29.5, 33.5],
];
export const LAMP_Y: readonly [number, number] = [2, 10];

/** 멈추지 않는 프린터: the zone's weak monster it prints. */
export const PRINTER_MINION: Record<FloorTheme, string> = {
  lobby: 'slime',
  office: 'overtime_ghost',
  ward: 'iv_zombie',
  rooftop: 'goblin',
};

const w = (lobby: number, office: number, ward: number, rooftop: number): Record<FloorTheme, number> => ({ lobby, office, ward, rooftop });

export const FIELD_EVENTS: FieldEventDef[] = [
  {
    id: 'lucky_toad',
    name: '도망치는 금두꺼비',
    icon: '🐸',
    premise: '계산대 위 금두꺼비 장식이 눈을 깜빡였다',
    task: '잡으',
    how: '카드를 옆에 떨어뜨리면 그 캐릭터가 잡으러 가요 · 드래그·펫 피해 ×2',
    from: 2,
    // 12차 벤치: 19층에 나오면 20층 보스를 궁극기 / 받는 피해 −8%를 들고 시작 (20층 사망률 −3%p) → 보스 직전 층에는 안 나옴
    notBeforeBoss: true,
    weights: w(3, 1, 1, 1),
    warn: 1.5,
    duration: 18,
    goal: 1,
    reward: { kind: 'ultAdd', value: 0.4 },
    // hp × floor statMult; flees allies within fleeRadius; hops hopDist away every hopEvery s after a crouch telegraph
    params: { hp: 1300, fleeRadius: 6, hopEvery: 4, crouch: 0.4, hopDist: 3, idleSpeed: 1, spawnMin: 6 },
  },
  {
    id: 'possessed_printer',
    name: '멈추지 않는 프린터',
    icon: '🖨️',
    premise: '아무도 누르지 않았는데 프린터가 야근자 명단을 뽑아낸다',
    task: '부수',
    how: '카드를 옆에 떨어뜨리면 그 캐릭터가 부숴요 · 드래그·펫 피해 ×2',
    from: 3,
    weights: w(1, 3, 1, 1),
    warn: 1.5,
    duration: 20,
    goal: 1,
    reward: { kind: 'petReset' },
    params: { hp: 1700, printEvery: 6, printCount: 2, printMax: 6, outlet: 1.2 },
  },
  {
    id: 'sleeping_patient',
    name: '깨어나지 않는 환자',
    icon: '🛏️',
    premise: '빈 병상에 누가 누워 있다. 링거가 다 떨어지기 전에',
    task: '회복으로 깨우',
    how: '회복 스킬로 채우기 · 곁에 서 있거나 근처에서 적을 잡아도 차요',
    from: 6,
    weights: w(0, 1, 3, 1),
    warn: 1.5,
    duration: 22,
    goal: 100,
    reward: { kind: 'healParty', pct: 0.2, reviveCut: 10 },
    // HP % = progress; +nearPerSec %/s with an ally character within nearRadius; +killBonus % per enemy death within killRadius
    params: { maxHp: 500, startPct: 20, nearRadius: 3, nearPerSec: 1, killRadius: 4, killBonus: 4, minDist: 3, maxDist: 6 },
  },
  {
    id: 'open_shaft',
    name: '열린 엘리베이터 통로',
    icon: '🛗',
    premise: '엘리베이터 문이 열렸는데 칸이 없다',
    task: '{n}마리 떨어뜨리',
    how: '끌어당기기·밀치기로 적을 구멍 쪽으로 몰아 넣기',
    from: 3,
    weights: w(3, 3, 1, 1),
    warn: 1.5,
    duration: 20,
    goal: 4,
    reward: { kind: 'benchSwapReset' },
    // a normal monster whose center comes within fallRadius falls; a mid boss is hit once (midDmg × max HP + stun) = +midProgress.
    // 12차 bench: monsters within suckRadius slide in at suck u/s (else almost nothing ever fell: 13 % success)
    params: { radius: 1.5, fallRadius: 1.1, suck: 2, suckRadius: 3.5, midDmg: 0.15, midStun: 1.5, midProgress: 2, minDist: 4 },
  },
  {
    id: 'midnight_surge',
    name: '23:59 정각',
    icon: '🕛',
    premise: '형광등이 일제히 꺼졌다. 퇴근 못 한 그림자들이 몰려온다',
    task: '그림자 {n}마리 잡으',
    how: '곧 사방에서 몰려와요 · 범위 공격으로 쓸어 담기',
    from: 3,
    weights: w(1, 3, 1, 1),
    warn: 1.5,
    duration: 10,
    goal: 10,
    reward: { kind: 'trace', traceId: 'morning_light' },
    // count shadows come out over spawnIn s (the clock waits); not chosen while more than crowdMax enemies are up
    params: { count: 12, spawnIn: 2, crowdMax: 20, recheck: 3, hp: 160, atkFrac: 0.3 },
  },
  {
    id: 'dark_lamps',
    name: '꺼지는 비상등',
    icon: '💡',
    premise: '복도 비상등 세 개가 꺼졌다. 어둠 속에서 무언가 숨죽인다',
    task: '비상등 {n}개 켜',
    how: '카드를 등 옆에 떨어뜨리거나 등 옆에 잠깐 서 있기',
    from: 3,
    weights: w(1, 1, 3, 1),
    warn: 1.5,
    duration: 20,
    goal: 3,
    reward: { kind: 'exposeAll', vulnerable: 0.25, duration: 10, stun: 1 },
    // lit by a drop within dropRadius, a (non-self) footprint touching it, or an ally character within standRadius for standTime s
    params: { dropRadius: 1.6, partRadius: 0.6, standRadius: 1.2, standTime: 1.5, flashRadius: 3, flashStun: 1 },
  },
  {
    id: 'sleepwalker',
    name: '깨우면 안 되는 아이',
    icon: '🧒',
    premise: '눈을 감은 아이가 걷고 있다. 깨우면 안 된다',
    task: '아이를 출구까지 데려가',
    how: '아이 곁에 있어야 걸어요 · 적을 노린 스킬이 닿으면 깨요',
    from: 3,
    // 12차 벤치: 19층에 나오면 20층 보스를 궁극기 / 받는 피해 −8%를 들고 시작 (20층 사망률 −3%p) → 보스 직전 층에는 안 나옴
    notBeforeBoss: true,
    weights: w(3, 0, 1, 3),
    warn: 1.5,
    duration: 25,
    goal: 14,
    reward: { kind: 'trace', traceId: 'small_hand' },
    // walks speed u/s along a goal-long row only while an ally character is within escort; an enemy footprint on it → back, cry
    params: { speed: 1.1, escort: 3.5, startleBack: 3, cry: 2, yMin: 3, yMax: 9 },
  },
];

const BY_ID = new Map(FIELD_EVENTS.map(d => [d.id, d]));

export function getFieldEvent(id: FieldEventId): FieldEventDef {
  const d = BY_ID.get(id);
  if (!d) throw new Error(`unknown field event: ${id}`);
  return d;
}

export function isFieldEventId(v: unknown): v is FieldEventId {
  return typeof v === 'string' && BY_ID.has(v as FieldEventId);
}

// ─────────────────────────── Units (never in MONSTERS: wave pools / roster tests iterate that) ───────────────────────────

const stats = (maxHp: number, atk: number, def: number, moveSpeed: number, atkSpeed = 1, range = 0.4) => ({
  maxHp,
  atk,
  def,
  atkSpeed,
  range,
  moveSpeed,
  critChance: 0,
  critMult: 1.5,
});

/** Shadow attack = this fraction of 그림자 아이 (goblin) attack. */
const GOBLIN_ATK = 17.5;
/** Unit numbers come from the event params (one place to tune). */
const P = (id: FieldEventId) => getFieldEvent(id).params;

export const FIELD_EVENT_UNITS: MonsterDef[] = [
  // 'target' units (enemy side, never attack: the sim moves them)
  { id: 'fe_toad', name: '금두꺼비', tier: 'normal', color: '#ffd166', radius: 0.45, look: 'lucky_toad', stats: stats(P('lucky_toad').hp, 0, 0, 2.6), basic: { kind: 'melee' } },
  {
    id: 'fe_printer', name: '멈추지 않는 프린터', tier: 'normal', color: '#ffd166', radius: 0.8, look: 'event_printer', stationary: true,
    stats: stats(P('possessed_printer').hp, 0, 0.2, 0), basic: { kind: 'melee' },
  },
  // 'minion': ordinary auto-targeted enemies that do not count for the floor
  {
    id: 'fe_shadow', name: '퇴근 못 한 그림자', tier: 'normal', color: '#2b2d42', radius: 0.33, look: 'night_shadow',
    stats: stats(P('midnight_surge').hp, GOBLIN_ATK * P('midnight_surge').atkFrac, 0, 3.4, 1.2), basic: { kind: 'melee' },
  },
  // 'ward' units (ally side, untouchable, ignored by monsters)
  { id: 'fe_patient', name: '잠든 환자', tier: 'summon', color: '#95d5b2', radius: 0.5, look: 'event_patient', stationary: true, stats: stats(P('sleeping_patient').maxHp, 0, 0, 0), basic: { kind: 'melee' } },
  { id: 'fe_child', name: '잠든 아이', tier: 'summon', color: '#ffd166', radius: 0.35, look: 'sleepwalker_child', stats: stats(1, 0, 0, 0), basic: { kind: 'melee' } },
];

/** Which unit each event puts on the field. */
export const FIELD_EVENT_UNIT: Partial<Record<FieldEventId, string>> = {
  lucky_toad: 'fe_toad',
  possessed_printer: 'fe_printer',
  sleeping_patient: 'fe_patient',
  midnight_surge: 'fe_shadow',
  sleepwalker: 'fe_child',
};

// ─────────────────────────── Texts (generated from the numbers) ───────────────────────────

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
const signed = (x: number) => `${x < 0 ? '−' : '+'}${pct(x)}`;

/** '공격력 +20%·공격 속도 +15%' for a trace. */
function traceEffect(traceId: string): { long: string; short: string; name: string } {
  const t = GOEDAM_TRACES.find(x => x.id === traceId);
  if (!t) return { long: traceId, short: traceId, name: traceId };
  const parts: string[] = [];
  if (t.mods?.atkPct) parts.push(`공격력 ${signed(t.mods.atkPct)}`);
  if (t.mods?.atkSpeedPct) parts.push(`공격 속도 ${signed(t.mods.atkSpeedPct)}`);
  if (t.mods?.hpPct) parts.push(`최대 HP ${signed(t.mods.hpPct)}`);
  if (t.damageTaken) parts.push(`받는 피해 ${signed(t.damageTaken)}`);
  const floors = t.floors === 1 ? '이번 층' : t.floors === 2 ? '이번 층 + 다음 층' : t.floors ? `${t.floors}층 동안` : '끝까지';
  const short = t.mods?.atkPct ? `공격${signed(t.mods.atkPct)}` : t.damageTaken ? `피해${signed(t.damageTaken)}` : t.name;
  return { long: `「${t.name}」 ${floors} ${parts.join('·')}`, short, name: t.name };
}

/** Reward for the banner / toast ('궁극기 게이지 +40%'), or the pill's one word ('궁극기+40%'). */
export function fieldEventRewardText(r: FieldEventReward, short = false): string {
  switch (r.kind) {
    case 'ultAdd':
      return short ? `궁극기+${pct(r.value)}` : `궁극기 게이지 +${pct(r.value)}`;
    case 'petReset':
      return short ? '펫 쿨 0' : '펫 쿨 초기화';
    case 'healParty':
      return short ? `회복+${pct(r.pct)}` : `HP ${pct(r.pct)} 회복 · 부활 대기 −${r.reviveCut}초`;
    case 'benchSwapReset':
      return short ? '교체 쿨 0' : '재등장 쿨 초기화';
    case 'trace': {
      const t = traceEffect(r.traceId);
      return short ? t.short : t.long;
    }
    case 'exposeAll':
      return short ? '적 취약' : `모든 적 받는 피해 +${pct(r.vulnerable)} · ${r.stun}초 기절`;
  }
}

/** Banner third line: '18초 안에 잡으면 모두 궁극기 게이지 +40%'. */
export function fieldEventGoalText(def: FieldEventDef): string {
  return `${def.duration}초 안에 ${def.task.replace('{n}', String(def.goal))}면 모두 ${fieldEventRewardText(def.reward)}`;
}
