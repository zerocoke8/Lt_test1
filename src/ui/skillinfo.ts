// Compact skill lines for the combat skill sheet (카드 탭/길게 누르기) and the cards' normal-skill cooldown (마름모).
// Pure (no DOM): every number comes from the data (src/data), so retuned skills read correctly without text edits.

import type { AreaShape, BasicAttack, CharacterDef, Dir, Effect, SkillAction, SkillDef, StatusId } from '../types';

const ARROW: Record<Dir, string> = { right: '→', left: '←', up: '↑', down: '↓' };

/** 1.5 → "1.5", 2 → "2", 0.25 → "0.25" (no trailing zeros). */
export function num(v: number): string {
  return String(Math.round(v * 100) / 100);
}

export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** Short footprint label: "원 반경 2", "→ 직선 12", "가로 띠 7", "고리 0.6~4", "X자 3.5" … */
export function areaLabel(area: AreaShape, center: SkillAction['center']): string {
  switch (area.shape) {
    case 'single':
      return center === 'woundedAlly' ? '가장 다친 아군' : '단일 대상';
    case 'circle':
      if (area.radius >= 50) return '전체';
      return `${center === 'self' ? '자기 주변' : '원'} 반경 ${num(area.radius)}`;
    case 'line':
      return `대상 방향 직선 ${num(area.length)}`;
    case 'rect':
      if ((area.anchor ?? 'start') === 'center') return `${area.dir === 'up' || area.dir === 'down' ? '세로' : '가로'} 띠 ${num(area.length)}`;
      return `${ARROW[area.dir]} 직선 ${num(area.length)}`;
    case 'cone':
      return `${ARROW[area.dir]} 부채꼴 ${num(area.radius)}`;
    case 'fan':
      return `대상 방향 부채꼴 ${num(area.radius)}`;
    case 'ring':
      return `고리 ${num(area.inner)}~${num(area.outer)}`;
    case 'cross':
      return `${area.diagonal ? 'X자' : '십자'} ${num(area.length)}`;
  }
}

const STATUS_SHORT: Record<StatusId, (value: number, duration: number) => string> = {
  stun: (_v, d) => `기절 ${num(d)}초`,
  slow: v => `둔화 ${pct(v)}`,
  burn: (_v, d) => `화상 ${num(d)}초`,
  atkUp: v => `공격력 +${pct(v)}`,
  atkDown: v => `공격력 -${pct(v)}`,
  defUp: v => `방어 +${pct(v)}`,
  haste: v => `공속 +${pct(v)}`,
  regen: (v, d) => `재생 ${num(d)}초`,
  vulnerable: v => `받는 피해 +${pct(v)}`,
  lifesteal: v => `흡혈 ${pct(v)}`,
  drain: v => `흡혼 표식 ${pct(v)}`,
  // 기획 13차
  taunt: (_v, d) => `도발 ${num(d)}초`,
  tether: v => `묶기 반경 ${num(v)}`,
  root: (_v, d) => `속박 ${num(d)}초`,
  stasis: (_v, d) => `정지 ${num(d)}초`,
  charm: (_v, d) => `조종 ${num(d)}초`,
  splashUp: v => `공격 범위 +${num(v)}`,
};

/** 기획 14차 교체 에너지: present while the mode is on — cooldown cuts read as energy (N s × regen). */
export interface EnergyOpts {
  regen: number;
}

function effectLabel(e: Effect, hits: number, spots: number, energy?: EnergyOpts): string {
  switch (e.kind) {
    case 'damage': {
      const reps = hits > 1 ? `×${hits}` : '';
      return `피해 ${pct(e.amount)}${reps}`;
    }
    case 'heal':
      return `회복 ${pct(e.amount)}${hits > 1 ? `×${hits}` : ''}`;
    case 'shield':
      return `보호막 ${pct(e.amount)}`;
    case 'status':
      return STATUS_SHORT[e.status](e.value, e.duration);
    case 'knockback':
      return `${e.dir ? ARROW[e.dir] + ' ' : ''}넉백 ${num(e.distance)}`;
    case 'pull':
      return `끌어당김 ${num(e.distance)}`;
    case 'cleanse':
      return '정화';
    case 'swapCooldownReduce':
      if (energy) return `${e.allPlayers ? '모두의 ' : ''}교체 에너지 +${num(e.energy ?? e.seconds * energy.regen)}`;
      return `${e.allPlayers ? '모두의 ' : ''}대기 캐릭터 쿨 -${num(e.seconds)}초`;
    // 기획 12차 (메딕)
    case 'benchHeal':
      return `${e.allPlayers ? '모두의 ' : ''}대기 캐릭터 회복 ${pct(e.amount)}`;
    case 'reviveReduce':
      return `${e.allPlayers ? '모두의 ' : ''}부활 대기 -${num(e.seconds)}초`;
    // 기획 13차 (바드 앙코르)
    case 'benchStatus':
      return `${e.allPlayers ? '모두의 ' : ''}대기 캐릭터 ${STATUS_SHORT[e.status](e.value, e.duration)}`;
  }
}

/** Actions that are the same footprint at several spots (meteors, chained blasts) → one entry with a spot count. */
function groupActions(actions: readonly SkillAction[]): { action: SkillAction; spots: number; effects: Effect[] }[] {
  const out: { action: SkillAction; spots: number; effects: Effect[]; key: string }[] = [];
  for (const a of actions) {
    const key = JSON.stringify({ area: a.area, affects: a.affects, center: a.center, zone: a.zone, hits: a.hits });
    const same = out.find(o => o.key === key && (a.offset || o.action.offset));
    if (!same) {
      out.push({ action: a, spots: 1, effects: [...a.effects], key });
      continue;
    }
    same.spots++;
    for (const e of a.effects) if (!same.effects.some(x => JSON.stringify(x) === JSON.stringify(e))) same.effects.push(e);
  }
  return out;
}

/**
 * One line for a skill: footprint + main effects, built from the data, e.g.
 * "→ 6칸 돌진 · 피해 270% · 기절 0.4초", "원 반경 1.5 5곳 · 피해 170% · 화상 3초",
 * "원 반경 3 · 아군 정화 · 회복 7% / 아군 0.5초마다 회복 2% · 4초 장판".
 */
export function skillSummary(skill: Pick<SkillDef, 'actions'>, energy?: EnergyOpts): string {
  const parts: string[] = [];
  const seenArea = new Set<string>();
  for (const { action: a, spots, effects: effs } of groupActions(skill.actions)) {
    const hits = Math.max(1, a.hits ?? 1);
    const effects: string[] = [];
    for (const e of effs) {
      const label = effectLabel(e, hits, spots, energy);
      if (!effects.includes(label)) effects.push(label);
    }
    if (a.summon) effects.push('소환');
    if (a.zone) effects.push(`${num(a.zone.duration)}초 장판`);
    if (effects.length === 0) continue;
    const bits: string[] = [];
    if (a.dash) bits.push(`${ARROW[a.dash.dir]} ${num(a.dash.distance)}칸 돌진`);
    else if (a.affects !== 'self') {
      const label = spots > 1 ? `${areaLabel(a.area, a.center)} ${spots}곳` : areaLabel(a.area, a.center);
      if (!seenArea.has(label)) {
        seenArea.add(label);
        bits.push(label);
      }
    }
    // player-level effects (cooldown cut, bench heal, revive cut) are not "자신"
    const onlyCd = effs.every(e => e.kind === 'swapCooldownReduce' || e.kind === 'benchHeal' || e.kind === 'reviveReduce' || e.kind === 'benchStatus');
    const who = a.affects === 'allies' ? '아군 ' : a.affects === 'self' && !onlyCd ? '자신 ' : '';
    // a field repeats its effects: say how often, or "회복 2%" reads as 2% in total
    const every = a.zone ? `${num(a.zone.tickInterval)}초마다 ` : '';
    bits.push(who + every + effects.join(' · '));
    parts.push(bits.join(' · '));
  }
  return parts.join(' / ');
}

export function basicSummary(b: BasicAttack): string {
  switch (b.kind) {
    case 'melee':
      return b.splashRadius ? `근접 · 주변 반경 ${num(b.splashRadius)}` : '근접 · 가장 가까운 적';
    case 'projectile':
      return b.splashRadius ? `원거리 투사체 · 반경 ${num(b.splashRadius)}` : '원거리 투사체 · 가장 가까운 적';
    case 'explode':
      return `자폭 반경 ${num(b.radius)}`;
  }
}

export type SkillRowKind = 'basic' | 'passive' | 'normal' | 'drag' | 'ult';

export interface SkillRow {
  kind: SkillRowKind;
  /** "평타" / "패시브" / "일반" / "드래그" / "궁극기" */
  type: string;
  /** When it goes off: "자동", "상시", "6초마다 자동", "등장 시 · 나가면 쿨 10초", "게이지 30초 · 탭". */
  trigger: string;
  name: string;
  summary: string;
}

export const SKILL_TYPE_LABEL: Record<SkillRowKind, string> = {
  basic: '평타',
  passive: '패시브',
  normal: '일반',
  drag: '드래그',
  ult: '궁극기',
};

/** Whole seconds when ≥ 10 or integral, one decimal otherwise ("6", "7.5"). */
export function secs(v: number): string {
  if (v >= 10 || Math.abs(v - Math.round(v)) < 0.05) return String(Math.round(v));
  return v.toFixed(1);
}

/** Under this many seconds the card number gets a decimal ("2.4"); above it whole seconds ("6"). */
export const CD_DECIMAL_UNDER = 3;

/**
 * Card cooldown number (일반스킬 마름모): whole seconds while ≥ 3 s ("7" … "4"), one decimal for the last 3 s ("3.0" …
 * "0.1") — narrow, so it stays readable at phone size without hiding the sweep. Always rounded up: "4" = 3–4 s left,
 * and a skill that is still cooling never reads "0" / "0.0".
 */
export function cdText(v: number): string {
  const t = Math.ceil(v * 10 - 1e-6) / 10;
  if (t > CD_DECIMAL_UNDER) return String(Math.ceil(v - 1e-6));
  return Math.max(0.1, t).toFixed(1);
}

/**
 * The five skill rows of a character for the sheet. Cooldowns are the live ones when known
 * (normal: after reward reductions, drag: this card's re-appear cooldown, ult: the gauge time).
 */
export function skillRows(
  def: CharacterDef,
  cd: { normal?: number; drag?: number; ult?: number; ultBench?: number; energy?: EnergyOpts & { cost: number } } = {},
): SkillRow[] {
  const normalCd = cd.normal ?? def.normal.cooldown ?? 6;
  const dragCd = cd.drag ?? def.swapCooldown;
  const en = cd.energy;
  return [
    { kind: 'basic', type: SKILL_TYPE_LABEL.basic, trigger: '자동', name: '기본 공격', summary: basicSummary(def.basic) },
    { kind: 'passive', type: SKILL_TYPE_LABEL.passive, trigger: '필드에서 상시', name: def.passive.name, summary: def.passive.description },
    { kind: 'normal', type: SKILL_TYPE_LABEL.normal, trigger: `${secs(normalCd)}초마다 자동`, name: def.normal.name, summary: skillSummary(def.normal, en) },
    // 기획 6차: the re-appear (= drag skill) cooldown starts when this character is swapped out.
    // 기획 14차 교체 에너지: no cooldown — the swap-in costs energy
    {
      kind: 'drag',
      type: SKILL_TYPE_LABEL.drag,
      // (short: the name must not be cut off — the live column carries '⚡부족 N초')
      trigger: en ? `교체 ⚡${num(en.cost)}` : `등장 시 · 나가면 쿨 ${secs(dragCd)}초`,
      name: def.drag.name,
      summary: skillSummary(def.drag, en),
    },
    {
      kind: 'ult',
      type: SKILL_TYPE_LABEL.ult,
      // 기획 14차 궁극기 개별 게이지: this card's own gauge — field time and bench time (short: the name must not be cut off)
      trigger:
        cd.ult != null && cd.ultBench != null
          ? `필드 ${secs(cd.ult)}초 · 대기 ${Number.isFinite(cd.ultBench) ? `${secs(cd.ultBench)}초` : '안 참'}`
          : cd.ult != null
            ? `게이지 ${secs(cd.ult)}초 · 탭`
            : '게이지 가득 · 탭',
      name: def.ult.name,
      summary: skillSummary(def.ult, en),
    },
  ];
}
