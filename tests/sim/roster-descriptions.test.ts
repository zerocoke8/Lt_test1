// Skill descriptions (Korean, shown on the preset screen / skill sheet) must match the data exactly.
// Balance passes change numbers in src/data/characters.ts (docs/balance.md); this catches a stale "%", "초" or "칸".
import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../../src/data';
import type { AreaShape, Effect, SkillAction, SkillDef } from '../../src/types';

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
  }
}

function effectNumbers(e: Effect): number[] {
  switch (e.kind) {
    case 'damage':
    case 'heal':
      return [e.amount * 100];
    case 'shield':
      return [e.amount * 100, e.duration];
    case 'status':
      return [e.duration, e.value * 100];
    case 'knockback':
    case 'pull':
      return [e.distance];
    case 'swapCooldownReduce':
      return [e.seconds];
    case 'cleanse':
      return [];
  }
}

/** Every number the data can explain (dimensions, offsets, delays, hits, zones, effect values, part count). */
function dataNumbers(skill: SkillDef): number[] {
  const out: number[] = [skill.actions.length];
  for (const a of skill.actions) {
    out.push(...areaNumbers(a.area));
    if (a.offset) out.push(Math.abs(a.offset.x), Math.abs(a.offset.y));
    if (a.delay) out.push(a.delay);
    if (a.hits) out.push(a.hits, a.hitInterval ?? 0.2);
    if (a.zone) out.push(a.zone.duration, a.zone.tickInterval);
    if (a.dash) out.push(a.dash.distance);
    for (const e of a.effects) out.push(...effectNumbers(e));
  }
  return out;
}

const descNumbers = (d: string) => (d.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

/** Phrases the description must contain for each tuned effect (the numbers a balance pass changes). */
function requiredPhrases(a: SkillAction): string[] {
  const out: string[] = [];
  for (const e of a.effects) {
    switch (e.kind) {
      case 'damage':
        out.push(`${pct(e.amount)}% 피해`);
        break;
      case 'heal':
        out.push(`HP ${pct(e.amount)}%`);
        break;
      case 'shield':
        out.push(`최대 HP ${pct(e.amount)}%, ${fmt(e.duration)}초`);
        break;
      case 'knockback':
        out.push(`${fmt(e.distance)}칸 넉백`);
        break;
      case 'pull':
        out.push(`${fmt(e.distance)}칸 끌어당`);
        break;
      case 'swapCooldownReduce':
        out.push(`쿨 ${fmt(e.seconds)}초 감소`);
        break;
      case 'cleanse':
        out.push('정화');
        break;
      case 'status':
        switch (e.status) {
          case 'stun':
            out.push(`${fmt(e.duration)}초 기절`);
            break;
          case 'slow':
            // a zone re-applies a short slow every tick: the text gives the strength only ("5초간 … 50% 둔화")
            out.push(a.zone ? `${pct(e.value)}% 둔화` : `${fmt(e.duration)}초간 ${pct(e.value)}% 둔화`);
            break;
          case 'burn':
            out.push(`${fmt(e.duration)}초 화상(초당 공격력 ${pct(e.value)}%)`);
            break;
          case 'haste':
            out.push(`${fmt(e.duration)}초간`, `공격 속도 +${pct(e.value)}%`);
            break;
          case 'atkUp':
            out.push(`${fmt(e.duration)}초간`, `공격력 +${pct(e.value)}%`);
            break;
          case 'defUp':
            out.push(`${fmt(e.duration)}초간`, `방어 +${pct(e.value)}%`);
            break;
          default:
            break;
        }
        break;
    }
  }
  if (a.zone) out.push(`${fmt(a.zone.duration)}초간 ${fmt(a.zone.tickInterval)}초마다`);
  if (a.dash) out.push(`${fmt(a.dash.distance)}칸 돌진`);
  return out;
}

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

  it('a drag skill hits one target harder when it does nothing else or hits a narrow strip (designer rule)', () => {
    // compared on real damage per hit (attack × % × expected crit, passive stats included), not on the card %:
    // attack ranges from 15 to 40, so 300% of a gunner is less than 210% of a berserker
    const perTarget = (id: string) => {
      const c = CHARACTERS.find(x => x.id === id)!;
      const ps = c.passive.stats ?? {};
      const atk = c.stats.atk * (1 + (ps.atkPct ?? 0));
      const critChance = Math.min(1, c.stats.critChance + (ps.critChance ?? 0));
      const critMult = c.stats.critMult + (ps.critMult ?? 0);
      const pctMax = Math.max(...c.drag.actions.flatMap(a => a.effects).map(e => (e.kind === 'damage' ? e.amount : 0)));
      return atk * pctMax * (1 + critChance * (critMult - 1));
    };
    // no function at all (레인저) > narrowest path + a token stun (블레이드) > cone + knockback (거너) > widest cone + slow (버서커)
    expect(perTarget('ranger')).toBeGreaterThan(perTarget('blade'));
    expect(perTarget('blade')).toBeGreaterThan(perTarget('gunner'));
    expect(perTarget('gunner')).toBeGreaterThan(perTarget('berserker'));
    // every damage dealer hits harder per target than every CC / support skill
    for (const dealer of ['blade', 'berserker', 'ranger', 'gunner']) {
      for (const util of ['guardian', 'paladin', 'warden', 'bard', 'chrono']) expect(perTarget(dealer), `${dealer} vs ${util}`).toBeGreaterThan(perTarget(util) * 1.5);
    }
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
        const known = [...dataNumbers(sk), ...(sk.cooldown != null ? [sk.cooldown] : [])];
        for (const n of descNumbers(sk.description)) expect(known.some(k => Math.abs(k - n) < 1e-6), `${c.id}: "${fmt(n)}" in "${sk.description}"`).toBe(true);
        for (const a of sk.actions) for (const ph of requiredPhrases(a)) expect(sk.description, `${c.id}: missing "${ph}"`).toContain(ph);
      });
    }
  }
});
