// Skill sheet text (카드 탭/길게 누르기): built from the data, so a retuned number shows up without text edits.
import { describe, expect, it } from 'vitest';
import { CHARACTERS, getCharacter } from '../../src/data';
import type { SkillDef } from '../../src/types';
import { MAX_COOLDOWN_REDUCTION } from '../../src/sim/constants';
import { normalCooldownFor, swapCooldownOf } from '../../src/sim/cooldowns';
import { cleanState } from '../../server/snapshot';
import { areaLabel, cdText, pct, secs, skillRows, skillSummary } from '../../src/ui/skillinfo';
import { advance, makeGame } from '../sim/helpers';

describe('skill sheet rows', () => {
  it('every character gets its 5 skills with a type, a trigger and a one-line summary', () => {
    for (const c of CHARACTERS) {
      const rows = skillRows(c, { normal: c.normal.cooldown, drag: c.swapCooldown, ult: 30 });
      expect(rows.map(r => r.type)).toEqual(['평타', '패시브', '일반', '드래그', '궁극기']);
      expect(rows[2].trigger).toBe(`${secs(c.normal.cooldown ?? 6)}초마다 자동`);
      expect(rows[3].trigger).toBe(`등장 시 · 나가면 쿨 ${secs(c.swapCooldown)}초`);
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
    expect(skillSummary(getCharacter('mage').drag)).toContain('6곳');
    expect(skillSummary(getCharacter('paladin').ult)).toContain('8곳'); // 기획 13차 빛의 창
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
    expect(skillSummary(getCharacter('mage').ult)).toContain('0.5초마다 피해 45%');
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

  it('drag "나가면 쿨 N초" (swapCooldownOf, used by the sheet) = what the card gets when it leaves, rewards and multiplier included; same on the wire copy', () => {
    const tg = makeGame({ tunables: { swapCooldownMult: 0.8 } });
    const p = tg.w.state.players[0];
    p.rewards.push({ rewardId: 'swapcd_epic', partyIndex: 0 }); // picked while guardian is on the field
    const said = swapCooldownOf(tg.w.tunables, p, 0);
    expect(said).toBeCloseTo((getCharacter('guardian').swapCooldown - 3) * 0.8, 9);
    expect(swapCooldownOf(tg.w.tunables, cleanState(tg.w.state).players[0], 0)).toBeCloseTo(said, 9);
    expect(skillRows(getCharacter('guardian'), { drag: said })[3].trigger).toBe(`등장 시 · 나가면 쿨 ${secs(said)}초`);
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } }).ok).toBe(true);
    expect(p.party[0].swapCooldownTotal).toBeCloseTo(said, 9);
    expect(p.party[0].swapCooldownRemaining).toBeCloseTo(said, 9);
    tg.w.tunables.instantCooldowns = true;
    expect(swapCooldownOf(tg.w.tunables, p, 1)).toBe(0);
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

describe('기획 14차 궁극기 개별 게이지 in the skill sheet', () => {
  it('per-character mode: this card\'s field / bench fill times; bench ratio 0 = 충전 없음', () => {
    const def = getCharacter('mage');
    expect(skillRows(def, { ult: 30 })[4].trigger).toBe('게이지 30초 · 탭');
    expect(skillRows(def, { ult: 30, ultBench: 90 })[4].trigger).toBe('필드 30초 · 대기 90초');
    expect(skillRows(def, { ult: 30, ultBench: Infinity })[4].trigger).toBe('필드 30초 · 대기 안 참');
  });
});


describe('기획 14차 교체 에너지 in the skill sheet', () => {
  it('the drag row says the swap cost instead of the cooldown; cooldown cuts read as energy (N s × regen)', () => {
    const chrono = getCharacter('chrono');
    const rows = skillRows(chrono, { energy: { cost: 6, regen: 1 } });
    expect(rows[3].trigger).toBe('교체 ⚡6');
    expect(rows[3].summary).toContain('교체 에너지 +2');
    expect(rows[3].summary).not.toContain('대기 캐릭터 쿨');
    expect(rows[4].summary).toContain('모두의 교체 에너지 +4');
    expect(skillRows(chrono, { energy: { cost: 5.5, regen: 1.5 } })[3].trigger).toBe('교체 ⚡5.5');
    // the rift's refund is a fixed 2 (priced into 크로노's cost); the ult's 4 s scale with the regen slider
    expect(skillRows(chrono, { energy: { cost: 6, regen: 1.5 } })[3].summary).toContain('교체 에너지 +2');
    expect(skillRows(chrono, { energy: { cost: 6, regen: 1.5 } })[4].summary).toContain('모두의 교체 에너지 +6');
    // off: today's text
    expect(skillRows(chrono)[3].summary).toContain('대기 캐릭터 쿨 -2초');
  });
});
