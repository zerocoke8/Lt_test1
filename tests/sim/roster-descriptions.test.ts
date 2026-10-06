// Skill descriptions (Korean, shown on the preset screen / skill sheet) must match the data exactly.
// Balance passes change numbers in src/data/characters.ts (docs/balance.md); this catches a stale "%", "초" or "칸".
import { describe, expect, it } from 'vitest';
import { CHARACTERS, getMonster } from '../../src/data';
import { hitsArea } from '../../src/sim/geometry';
import { partsForActions } from '../../src/sim/preview';
import type { AreaShape, CharacterDef, Effect, SkillAction, SkillDef, StatusId } from '../../src/types';

/** Number as a description writes it: 1 → "1", 0.4 → "0.4", 2.5 → "2.5". */
const fmt = (x: number) => String(Number(x.toFixed(2)));
const pct = (x: number) => fmt(x * 100);

function areaNumbers(a: AreaShape): number[] {
  switch (a.shape) {
    case 'circle':
      return [a.radius];
    case 'single':
      return [];
    case 'line':
    case 'rect':
      return [a.length, a.width];
    case 'cone':
    case 'fan':
      return [a.radius, a.angle];
    case 'ring':
      return [a.inner, a.outer];
    case 'cross':
      return [a.length, a.width, 4]; // "상하좌우 / 대각선 4방향"
    default:
      return [];
  }
}

function effectNumbers(e: Effect): number[] {
  switch (e.kind) {
    case 'damage':
      return [e.amount * 100];
    case 'heal':
      // 기획 13차 클레릭: the overflow shield's cap (% of max HP) and time
      return [e.amount * 100, ...(e.overflowShield ? [e.overflowShield.cap * 100, e.overflowShield.duration] : [])];
    case 'shield':
      return [e.amount * 100, e.duration];
    case 'status':
      return [e.duration, e.value * 100, e.value]; // value as is: tether radius, splashUp range (기획 13차)
    case 'knockback':
    case 'pull':
      return [e.distance];
    case 'swapCooldownReduce':
    case 'reviveReduce':
      return [e.seconds];
    case 'benchHeal':
      return [e.amount * 100];
    case 'benchStatus':
      return [e.duration, e.value * 100];
    case 'cleanse':
      return [];
  }
}

/** 기획 12차: a summon's numbers (lifetime, inherited HP %, and what its onDeath does — 종이 인형 bursting). */
function summonNumbers(s: NonNullable<SkillAction['summon']>): number[] {
  const out = [s.count, s.duration];
  if (s.inherit) out.push(s.inherit.hp * 100, s.inherit.atk * 100);
  const od = getMonster(s.unitId).onDeath?.action;
  if (od) {
    out.push(...areaNumbers(od.area));
    for (const e of od.effects) out.push(...effectNumbers(e));
  }
  return out;
}

/** Every number the data can explain (dimensions, offsets, delays, hits, zones, effect values, part counts). */
function dataNumbers(skill: SkillDef): number[] {
  const out: number[] = [skill.actions.length];
  // 기획 13차: how many parts share a stage ("빛의 창 8개", "분신 3번", "여섯 곳")
  const stages = new Map<string, number>();
  for (const a of skill.actions) if (a.stage) stages.set(a.stage, (stages.get(a.stage) ?? 0) + 1);
  out.push(...stages.values());
  for (const a of skill.actions) {
    out.push(...areaNumbers(a.area));
    if (a.offset) out.push(Math.abs(a.offset.x), Math.abs(a.offset.y));
    if (a.delay) out.push(a.delay);
    if (a.hits) out.push(a.hits, a.hitInterval ?? 0.2, (a.delay ?? 0) + (a.hits - 1) * (a.hitInterval ?? 0.2));
    if (a.zone) out.push(a.zone.duration, a.zone.tickInterval, (a.delay ?? 0) + a.zone.duration);
    if (a.dash) out.push(a.dash.distance);
    if (a.charge) out.push(a.charge.distance);
    if (a.summon) out.push(...summonNumbers(a.summon));
    // 기획 13차 mechanics
    if (a.blinkChain) out.push(a.blinkChain.count, a.blinkChain.radius, a.blinkChain.interval, a.blinkChain.maxPerTarget);
    if (a.allyRange) out.push(a.allyRange);
    if (a.maxTargets) out.push(a.maxTargets);
    if (a.healPerHit) out.push(a.healPerHit.radius, a.healPerHit.amount * 100, a.healPerHit.maxHits);
    for (const e of a.effects) out.push(...effectNumbers(e));
  }
  return out;
}

const descNumbers = (d: string) => (d.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

/** Phrases the description must contain for each tuned effect (the numbers a balance pass changes). */
function requiredPhrases(a: SkillAction): string[] {
  const out: string[] = [];
  for (const e of a.effects) out.push(...effectPhrases(a, e));
  // a zone re-applies its effects: the text gives its length, and how often when it damages / heals
  if (a.zone) {
    out.push(`${fmt(a.zone.duration)}초간`);
    if (a.effects.some(e => e.kind === 'damage' || e.kind === 'heal')) out.push(`${fmt(a.zone.tickInterval)}초마다`);
  }
  if (a.dash) out.push(a.dash.atFire ? `${fmt(a.dash.distance)}칸` : `${fmt(a.dash.distance)}칸 돌진`);
  if (a.charge) out.push(`${fmt(a.charge.distance)}칸`);
  // 기획 13차
  if (a.blinkChain) out.push(`${a.blinkChain.count}번 순간이동`);
  if (a.maxTargets) out.push(`${a.maxTargets}마리까지`);
  if (a.healPerHit) out.push('맞은 적 1명당', `HP ${pct(a.healPerHit.amount)}%`);
  return out;
}

function effectPhrases(a: SkillAction, e: Effect): string[] {
  switch (e.kind) {
    case 'damage':
      return [`${pct(e.amount)}% 피해`, ...(e.crit === 'always' ? ['치명타 확정'] : [])];
    case 'heal':
      return [`HP ${pct(e.amount)}%`, ...(e.overflowShield ? ['넘친 회복은 보호막', `최대 HP ${pct(e.overflowShield.cap)}%`] : [])];
    case 'shield':
      return [`최대 HP ${pct(e.amount)}%, ${fmt(e.duration)}초`];
    case 'knockback':
      return [`${fmt(e.distance)}칸 넉백`];
    case 'pull':
      return [`${fmt(e.distance)}칸 끌어당`];
    case 'swapCooldownReduce':
      return [`쿨 ${fmt(e.seconds)}초 감소`];
    case 'cleanse':
      return ['정화'];
    // 기획 12차 (메딕)
    case 'benchHeal':
      return [`대기 캐릭터 HP ${pct(e.amount)}%`];
    case 'reviveReduce':
      return [`부활 대기 ${fmt(e.seconds)}초 감소`];
    // 기획 13차 (바드 앙코르)
    case 'benchStatus':
      return ['대기 캐릭터', ...statusPhrases(a, e.status, e.duration, e.value)];
    case 'status':
      return statusPhrases(a, e.status, e.duration, e.value);
  }
}

function statusPhrases(a: SkillAction, status: StatusId, duration: number, value: number): string[] {
  // a zone re-applies a short status every tick: the text gives the strength only ("4초간 … 50% 둔화")
  const z = !!a.zone;
  const lasting = (strength: string) => (z ? [strength] : [`${fmt(duration)}초간`, strength]);
  switch (status) {
    case 'stun':
      return [`${fmt(duration)}초 기절`];
    case 'slow':
      return [z ? `${pct(value)}% 둔화` : `${fmt(duration)}초간 ${pct(value)}% 둔화`];
    case 'burn':
      return [`${fmt(duration)}초 화상(초당 공격력 ${pct(value)}%)`];
    case 'haste':
      return lasting(`공격 속도 +${pct(value)}%`);
    case 'atkUp':
      return lasting(`공격력 +${pct(value)}%`);
    case 'defUp':
      return lasting(`방어 +${pct(value)}%`);
    // 기획 12차
    case 'atkDown':
      return lasting(`공격력 −${pct(value)}%`);
    case 'drain':
      return [`${fmt(duration)}초간 흡혼 표식`, `피해의 ${pct(value)}%`];
    // 기획 13차
    case 'vulnerable':
      return lasting(`받는 피해 +${pct(value)}%`);
    case 'regen':
      return [`${fmt(duration)}초간 초당 HP ${pct(value)}% 재생`];
    case 'lifesteal':
      return [`피해의 ${pct(value)}% 흡혈`];
    case 'taunt':
      return [`${fmt(duration)}초 도발`];
    case 'tether':
      return ['밖으로 못 나'];
    case 'root':
      return [`${fmt(duration)}초 속박`];
    case 'stasis':
      return [`${fmt(duration)}초 정지`, `피해의 ${pct(value)}%`];
    case 'charm':
      return [`${fmt(duration)}초간 조종`];
    case 'splashUp':
      return [`기본 공격 범위 +${fmt(value)}`];
    default:
      return [];
  }
}

// ─────────────────────────── per-target damage (기획 13차: the sum over every beat) ───────────────────────────

/** Expected crit factor of a damage effect (crit 'always' = the full crit multiplier). */
function critFactor(c: CharacterDef, e: Extract<Effect, { kind: 'damage' }>): number {
  const ps = c.passive.stats ?? {};
  const chance = Math.min(1, c.stats.critChance + (ps.critChance ?? 0));
  const mult = c.stats.critMult + (ps.critMult ?? 0);
  return e.crit === 'always' ? mult : 1 + chance * (mult - 1);
}

/** Times an action hits one unit standing in it: hits, or zone ticks. */
function timesHit(a: SkillAction): number {
  if (a.zone) return Math.round(a.zone.duration / a.zone.tickInterval);
  return Math.max(1, a.hits ?? 1);
}

/**
 * The most damage % (× expected crit) one enemy takes from a drag skill: the best spot on a grid around the drop point,
 * summing every damaging beat whose (preview) footprint covers it — DoTs and summons left out.
 */
function perTargetPct(c: CharacterDef): number {
  const actions = c.drag.actions.filter(a => a.center !== 'woundedAlly');
  const parts = partsForActions(actions, 1);
  let best = 0;
  for (let x = -8; x <= 8; x += 0.2) {
    for (let y = -4; y <= 4; y += 0.2) {
      let sum = 0;
      parts.forEach((p, i) => {
        const a = actions[i];
        if (p.affects !== 'enemies' || !hitsArea(p.area, p.offset, p.offset, { x, y }, 0.45)) return;
        for (const e of a.effects) if (e.kind === 'damage') sum += e.amount * timesHit(a) * critFactor(c, e);
      });
      best = Math.max(best, sum);
    }
  }
  return best;
}

/** Same in real damage: × attack (passive atk included). */
function perTargetDamage(c: CharacterDef): number {
  return perTargetPct(c) * c.stats.atk * (1 + (c.passive.stats?.atkPct ?? 0));
}

const char = (id: string) => CHARACTERS.find(x => x.id === id)!;

describe('drag-skill descriptions match the data (balance pass, docs/balance.md)', () => {
  for (const c of CHARACTERS) {
    it(`${c.id} ${c.drag.name}: every tuned number is in the text, and every number in the text comes from the data`, () => {
      const d = c.drag.description;
      for (const a of c.drag.actions) for (const ph of requiredPhrases(a)) expect(d, `${c.id}: missing "${ph}"`).toContain(ph);
      const known = dataNumbers(c.drag);
      for (const n of descNumbers(d)) expect(known.some(k => Math.abs(k - n) < 1e-6), `${c.id}: "${fmt(n)}" in "${d}" is not in the data`).toBe(true);
      // the cooldown is shown next to the text from data (재등장 쿨 N초); the text itself never states it
      expect(d).not.toMatch(/재등장 쿨 \d+(?:\.\d+)?초(?! 감소)/);
    });
  }

  it('a drag skill hits one target harder when it does nothing else or hits a narrow strip (designer rule, 기획 13차: summed over its beats)', () => {
    // within a role the card % (× expected crit) per target keeps the order of docs/skill-renewal.md 4-1:
    // no function at all (레인저) > cone + knockback (거너) > widest area + burn (메이지); 블레이드 > 버서커 > 섀도우
    const pctOf = (id: string) => perTargetPct(char(id));
    expect(pctOf('ranger')).toBeGreaterThan(pctOf('gunner'));
    expect(pctOf('gunner')).toBeGreaterThan(pctOf('mage'));
    expect(pctOf('blade')).toBeGreaterThan(pctOf('berserker'));
    expect(pctOf('berserker')).toBeGreaterThan(pctOf('shadow'));
    // in real damage (attack 15..40), every damage dealer hits one target harder than every CC / healer / support skill
    const dealers = CHARACTERS.filter(c => c.role === 'melee' || c.role === 'ranged');
    const weakest = Math.min(...dealers.map(perTargetDamage));
    for (const d of dealers) {
      for (const u of CHARACTERS.filter(c => c.role !== 'melee' && c.role !== 'ranged')) expect(perTargetDamage(d), `${d.id} vs ${u.id}`).toBeGreaterThan(perTargetDamage(u) * 1.5);
    }
    // healers / supporters stay under 2/3 of the weakest dealer (skill-renewal 4-1)
    for (const u of CHARACTERS.filter(c => c.role === 'healer' || c.role === 'support')) expect(perTargetDamage(u), u.id).toBeLessThan((weakest * 2) / 3);
  });

  it('re-appear cooldowns stay in 8–12 s (기획서 4장)', () => {
    for (const c of CHARACTERS) {
      expect(c.swapCooldown, c.id).toBeGreaterThanOrEqual(8);
      expect(c.swapCooldown, c.id).toBeLessThanOrEqual(12);
    }
  });
});

describe('normal / ult descriptions use only numbers from the data', () => {
  for (const c of CHARACTERS) {
    for (const sk of [c.normal, c.ult]) {
      it(`${c.id} ${sk.name}`, () => {
        // castRange: 메딕 응급 주사 "반경 6 안에서" (기획 12차)
        const known = [...dataNumbers(sk), ...(sk.cooldown != null ? [sk.cooldown] : []), ...(sk.castRange != null ? [sk.castRange] : [])];
        for (const n of descNumbers(sk.description)) expect(known.some(k => Math.abs(k - n) < 1e-6), `${c.id}: "${fmt(n)}" in "${sk.description}"`).toBe(true);
        for (const a of sk.actions) for (const ph of requiredPhrases(a)) expect(sk.description, `${c.id}: missing "${ph}"`).toContain(ph);
      });
    }
  }
});
