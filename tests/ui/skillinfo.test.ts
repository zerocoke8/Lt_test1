// Skill sheet text (카드 탭/길게 누르기): built from the data, so a retuned number shows up without text edits.
import { describe, expect, it } from 'vitest';
import { CHARACTERS, getCharacter } from '../../src/data';
import type { SkillDef } from '../../src/types';
import { MAX_COOLDOWN_REDUCTION } from '../../src/sim/constants';
import { normalCooldownFor } from '../../src/sim/cooldowns';
import { cleanState } from '../../server/snapshot';
import { areaLabel, cdText, pct, secs, skillRows, skillSummary } from '../../src/ui/skillinfo';
import { advance, makeGame } from '../sim/helpers';

describe('skill sheet rows', () => {
  it('every character gets its 5 skills with a type, a trigger and a one-line summary', () => {
    for (const c of CHARACTERS) {
      const rows = skillRows(c, { normal: c.normal.cooldown, drag: c.swapCooldown, ult: 30 });
      expect(rows.map(r => r.type)).toEqual(['평타', '패시브', '일반', '드래그', '궁극기']);
      expect(rows[2].trigger).toBe(`${secs(c.normal.cooldown ?? 6)}초마다 자동`);
      expect(rows[3].trigger).toBe(`등장 시 · 쿨 ${secs(c.swapCooldown)}초`);
      expect(rows[4].trigger).toBe('게이지 30초 · 탭');
      for (const r of rows) {
        expect(r.name.length, `${c.id} ${r.kind}`).toBeGreaterThan(0);
        expect(r.summary.length, `${c.id} ${r.kind}`).toBeGreaterThan(0);
        expect(r.summary).not.toMatch(/undefined|NaN/);
      }
    }
  });

  it('summaries quote the data numbers (damage %, hits, statuses)', () => {
    for (const c of CHARACTERS) {
      for (const sk of [c.normal, c.drag, c.ult] as SkillDef[]) {
        const text = skillSummary(sk);
        for (const a of sk.actions) {
          for (const e of a.effects) {
            if (e.kind === 'damage') expect(text, `${sk.id}`).toContain(`피해 ${pct(e.amount)}`);
            if (e.kind === 'shield') expect(text, `${sk.id}`).toContain(`보호막 ${pct(e.amount)}`);
          }
          if ((a.hits ?? 1) > 1) expect(text, `${sk.id}`).toContain(`×${a.hits}`);
        }
      }
    }
  });

  it('shapes read as the field shows them (fixed directions, multi-spot, dash)', () => {
    expect(skillSummary(getCharacter('blade').drag)).toMatch(/^→ \d+(\.\d+)?칸 돌진/);
    expect(skillSummary(getCharacter('gunner').drag)).toContain('← 부채꼴');
    expect(skillSummary(getCharacter('mage').drag)).toContain('5곳');
    expect(skillSummary(getCharacter('shadow').drag)).toContain('3곳');
    expect(skillSummary(getCharacter('bard').drag)).toContain('세로 띠');
    expect(skillSummary(getCharacter('guardian').drag)).toContain('가로 띠');
    expect(areaLabel({ shape: 'cross', length: 3.5, width: 1.3, diagonal: true }, 'point')).toBe('X자 3.5');
    expect(areaLabel({ shape: 'circle', radius: 99 }, 'self')).toBe('전체');
  });

  it('a field says how often it repeats (else "회복 2%" reads as 2% in total)', () => {
    const spring = getCharacter('cleric').drag;
    const zone = spring.actions.find(a => a.zone)!;
    const heal = zone.effects.find(e => e.kind === 'heal')!;
    expect(heal.kind === 'heal' && skillSummary(spring)).toContain(`${zone.zone!.tickInterval}초마다 회복 ${pct(heal.amount)} · ${zone.zone!.duration}초 장판`);
    expect(skillSummary(getCharacter('mage').ult)).toContain('0.5초마다 피해 50%');
  });

  it('seconds read like a countdown (decimals only under 10 s)', () => {
    expect(secs(6)).toBe('6');
    expect(secs(6.24)).toBe('6.2');
    expect(secs(12.4)).toBe('12');
  });
});

describe('card diamond (일반스킬 쿨)', () => {
  it('seconds: whole seconds while ≥ 3 s, one decimal for the last 3 s, always rounded up (never "0.0" while cooling)', () => {
    expect(cdText(7)).toBe('7');
    expect(cdText(6.3)).toBe('7');
    expect(cdText(5.42)).toBe('6');
    expect(cdText(3.05)).toBe('4');
    expect(cdText(3)).toBe('3.0');
    expect(cdText(2.94)).toBe('3.0');
    expect(cdText(2.4)).toBe('2.4');
    expect(cdText(0.91)).toBe('1.0');
    expect(cdText(0.9)).toBe('0.9');
    expect(cdText(0.01)).toBe('0.1');
    expect(cdText(12.4)).toBe('13');
    // phone width: at most 3 characters ("2.4", "13"), so the number stays narrower than the diamond
    for (let v = 0.01; v < 20; v += 0.01) expect(cdText(v).length).toBeLessThanOrEqual(3);
  });

  it('full cooldown (the sim\'s normalCooldownFor, also used by the HUD): data × reward cuts, capped; same on the wire copy; 0 with instant cooldowns', () => {
    const tg = makeGame();
    const p = tg.w.state.players[0];
    const base = (i: number) => getCharacter(p.party[i].defId).normal.cooldown ?? 6;
    // a multiplayer client only has the snapshot (rounded, sim internals stripped): it must get the same seconds
    const sameOnWire = () => {
      const wp = cleanState(tg.w.state).players[0];
      p.party.forEach((m, i) => expect(normalCooldownFor(tg.w.tunables, wp, i), `${m.defId} #${i}`).toBeCloseTo(normalCooldownFor(tg.w.tunables, p, i), 9));
    };
    p.party.forEach((_, i) => expect(normalCooldownFor(tg.w.tunables, p, i)).toBe(base(i)));
    sameOnWire();
    p.rewards.push({ rewardId: 'normcd_rare', partyIndex: 1 });
    expect(normalCooldownFor(tg.w.tunables, p, 1)).toBeLessThan(base(1));
    expect(normalCooldownFor(tg.w.tunables, p, 0)).toBe(base(0));
    sameOnWire();
    for (let k = 0; k < 4; k++) p.rewards.push({ rewardId: 'normcd_epic', partyIndex: 1 });
    expect(normalCooldownFor(tg.w.tunables, p, 1)).toBeCloseTo(base(1) * (1 - MAX_COOLDOWN_REDUCTION), 9); // 0.3 + 4×0.45, capped
    sameOnWire();
    tg.w.tunables.instantCooldowns = true;
    expect(normalCooldownFor(tg.w.tunables, p, 0)).toBe(0);
  });

  it('right after the field character\'s auto skill fires, its timer starts at that full cooldown', () => {
    const tg = makeGame();
    const p = tg.w.state.players[0];
    p.rewards.push({ rewardId: 'normcd_common', partyIndex: 0 });
    const idx = p.activeIndex!;
    const total = normalCooldownFor(tg.w.tunables, p, idx);
    let seen = -1;
    for (let t = 0; t < 60 * 30 && seen < 0; t++) {
      const before = p.party[idx].normalCooldownRemaining;
      advance(tg, 1 / 30);
      if (p.party[idx].normalCooldownRemaining > before + 0.5) seen = p.party[idx].normalCooldownRemaining;
    }
    expect(seen, 'the auto skill fired').toBeGreaterThan(0);
    expect(seen).toBeLessThanOrEqual(total + 1e-9);
    expect(seen).toBeGreaterThan(total - 1 / 30 - 1e-9);
  });
});
