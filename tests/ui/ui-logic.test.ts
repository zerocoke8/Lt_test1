import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNABLES } from '../../src/config';
import { CHARACTERS, GOEDAM_ROOMS, PETS, getCharacter, goedamOptionView } from '../../src/data';
import type { GoedamProgress, Tunables } from '../../src/types';
import {
  countdown,
  formatClock,
  goedamOptionKind,
  goedamOtherRow,
  goedamTagLabel,
  goedamTimerText,
  goedamWaitText,
  refusalText,
  energyNum,
  energyRuleText,
  resultReason,
} from '../../src/ui/format';
import { clientToLogical, computeFit } from '../../src/ui/stage';
import { DEFAULT_PRESET, sanitizePreset } from '../../src/ui/storage';
import { SLIDERS, TOGGLES, diffFromDefaults, formatTunable, sanitizeOverrides } from '../../src/ui/tunables';

describe('stage fit (letterbox + safe area)', () => {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };

  it('fits 16:9 exactly at 1280×720', () => {
    expect(computeFit(1280, 720, none)).toEqual({ scale: 1, left: 0, top: 0 });
  });

  it('letterboxes a wide phone horizontally and stays centered', () => {
    const f = computeFit(844, 390, none);
    expect(f.scale).toBeCloseTo(390 / 720, 6);
    expect(f.top).toBeCloseTo(0, 6);
    expect(f.left).toBeCloseTo((844 - 1280 * f.scale) / 2, 6);
  });

  it('keeps the stage inside the safe area (notch + home indicator)', () => {
    const ins = { top: 0, right: 47, bottom: 21, left: 47 };
    const f = computeFit(844, 390, ins);
    expect(f.left).toBeGreaterThanOrEqual(47 - 1e-9);
    expect(f.left + 1280 * f.scale).toBeLessThanOrEqual(844 - 47 + 1e-9);
    expect(f.top + 720 * f.scale).toBeLessThanOrEqual(390 - 21 + 1e-9);
  });

  it('client → logical round-trips through the fit', () => {
    const f = computeFit(844, 390, none);
    const p = clientToLogical(f.left + 640 * f.scale, f.top + 360 * f.scale, f);
    expect(p.x).toBeCloseTo(640, 6);
    expect(p.y).toBeCloseTo(360, 6);
  });
});

describe('format helpers', () => {
  it('clock rounds up so it never shows 00:00 early', () => {
    expect(formatClock(120)).toBe('02:00');
    expect(formatClock(75.2)).toBe('01:16');
    expect(formatClock(0.01)).toBe('00:01');
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(-3)).toBe('00:00');
  });

  it('countdown never shows 0 while time remains', () => {
    expect(countdown(0)).toBe(0);
    expect(countdown(0.02)).toBe(1);
    expect(countdown(9.5)).toBe(10);
  });

  it('turns sim refusal codes into player-facing Korean', () => {
    expect(refusalText({ ok: false, reason: '쿨타임' }, { kind: 'swap', cooldown: 7.2 })).toBe('재등장 대기 중 · 8초');
    expect(refusalText({ ok: false, reason: '쿨타임' }, { kind: 'pet', cooldown: 30 })).toBe('펫 쿨타임 · 30초');
    expect(refusalText({ ok: false, reason: '사망' }, { kind: 'swap', revive: 12.1 })).toContain('13초');
    expect(refusalText({ ok: false, reason: '알 수 없음' }, { kind: 'swap' })).toBe('알 수 없음');
  });

  it('explains a quit differently when the player was already out', () => {
    const r = { outcome: 'defeat' as const, reason: 'quit' as const, floorReached: 3, duration: 100 };
    expect(resultReason(r, true)).not.toBe(resultReason(r, false));
  });

  it('a timeout on a boss floor (enraged, nobody on the field) is explained differently from a normal-floor timeout', () => {
    const r = { outcome: 'defeat' as const, reason: 'timeout' as const, floorReached: 5, duration: 200 };
    expect(resultReason(r, false)).toContain('일반층');
    expect(resultReason(r, false, true)).toContain('광폭화');
  });
});

describe('preset persistence', () => {
  it('keeps a valid preset as-is (order = slot order)', () => {
    const p = { characters: ['cleric', 'guardian', 'mage'], pets: ['owl_frost', 'cat_void', 'rabbit_time'] };
    expect(sanitizePreset(p)).toEqual(p);
  });

  it('drops unknown/duplicate ids and tops up to 3 + 3', () => {
    const p = sanitizePreset({ characters: ['nope', 'mage', 'mage'], pets: 'garbage' });
    expect(p.characters).toHaveLength(3);
    expect(p.characters[0]).toBe('mage');
    expect(new Set(p.characters).size).toBe(3);
    expect(p.pets).toEqual(DEFAULT_PRESET.pets);
    for (const id of p.characters) expect(CHARACTERS.some(c => c.id === id)).toBe(true);
    for (const id of p.pets) expect(PETS.some(c => c.id === id)).toBe(true);
  });

  it('handles null / non-object input', () => {
    expect(sanitizePreset(null)).toEqual(DEFAULT_PRESET);
    expect(sanitizePreset(42)).toEqual(DEFAULT_PRESET);
  });
});

describe('debug tunables', () => {
  const keys = Object.keys(DEFAULT_TUNABLES) as (keyof Tunables)[];

  it('has a slider for every numeric Tunable and a toggle for every boolean one', () => {
    for (const k of keys) {
      if (typeof DEFAULT_TUNABLES[k] === 'number') expect(SLIDERS.some(s => s.key === k), k).toBe(true);
      else expect(TOGGLES.some(t => t.key === k), k).toBe(true);
    }
  });

  it('기획 14차 test rules: off by default, each with its own sliders (shown under its toggle)', () => {
    for (const t of TOGGLES.filter(x => x.mode)) {
      expect(DEFAULT_TUNABLES[t.key], t.key).toBe(false);
      expect(SLIDERS.filter(s => s.mode === t.key).length, t.key).toBeGreaterThanOrEqual(2);
    }
    expect(SLIDERS.filter(s => s.mode === 'ultPerCharacter').map(s => s.key)).toEqual(['ultFieldChargeTime', 'ultBenchRatio']);
    for (const s of SLIDERS) if (s.mode) expect(TOGGLES.some(t => t.key === s.mode && t.mode), s.key).toBe(true);
    expect(DEFAULT_TUNABLES.ultFieldChargeTime).toBe(30);
    expect(DEFAULT_TUNABLES.ultBenchRatio).toBeCloseTo(1 / 3, 12);
    expect(sanitizeOverrides({ ultPerCharacter: true, ultBenchRatio: 3 })).toEqual({ ultPerCharacter: true, ultBenchRatio: 1 });
  });

  it('기획 14차 교체 에너지: toggle + 최대 에너지 (4–20, 10) and 에너지 차는 속도 (0.25–3 /s, 1) right under it', () => {
    expect(SLIDERS.filter(s => s.mode === 'swapEnergyMode').map(s => [s.key, s.min, s.max])).toEqual([
      ['swapEnergyMax', 4, 20],
      ['swapEnergyRegen', 0.25, 3],
    ]);
    expect([DEFAULT_TUNABLES.swapEnergyMode, DEFAULT_TUNABLES.swapEnergyMax, DEFAULT_TUNABLES.swapEnergyRegen]).toEqual([false, 10, 1]);
    expect(sanitizeOverrides({ swapEnergyMode: true, swapEnergyMax: 99, swapEnergyRegen: 0 })).toEqual({ swapEnergyMode: true, swapEnergyMax: 20, swapEnergyRegen: 0.25 });
    const regen = SLIDERS.find(s => s.key === 'swapEnergyRegen')!;
    expect(formatTunable(regen, 0.25)).toBe('0.25/초');
    expect(formatTunable(SLIDERS.find(s => s.key === 'swapEnergyMax')!, 12)).toBe('12');
    // the older sliders keep their format (0.05 steps → 2 decimals, 0.1 / 0.5 → 1)
    expect(formatTunable(SLIDERS.find(s => s.key === 'swapCooldownMult')!, 1)).toBe('1.00×');
    expect(formatTunable(SLIDERS.find(s => s.key === 'waveInterval')!, 8)).toBe('8.0초');
  });

  it('기획 14차 교체 에너지: refusal text and the cooldown wording rewritten for energy mode', () => {
    expect(refusalText({ ok: false, reason: '에너지 부족' }, { kind: 'swap', energy: { need: 6, secs: 2.2 } })).toBe('에너지 부족 · ⚡6 필요 (3초 후)');
    expect(refusalText({ ok: false, reason: '에너지 부족' }, { kind: 'swap', energy: { need: 5.5, secs: Infinity } })).toBe('에너지 부족 · ⚡5.5 필요');
    expect(energyRuleText('블레이드의 재등장 쿨 -2초 (최소 4초)', 1)).toBe('블레이드 교체 비용 ⚡-1');
    expect(energyRuleText('적을 처치할 때마다 대기 캐릭터 재등장 쿨 0.5초 감소.', 2)).toBe('적을 처치할 때마다 교체 에너지 +1.');
    expect(energyRuleText('내 대기 캐릭터 재등장 쿨 4초 감소 + 반경 3 아군', 1)).toBe('내 교체 에너지 +4 + 반경 3 아군');
    expect(energyRuleText('재등장 쿨 초기화', 1)).toBe('교체 에너지 가득');
    expect(energyRuleText('교체 쿨 0', 1)).toBe('에너지 가득');
    // 빠른 교대 follows the regen slider (v/2 s of regen); 크로노 균열's refund is a fixed 2 at any regen
    expect(energyRuleText('블레이드의 재등장 쿨 -2초 (최소 4초)', 2)).toBe('블레이드 교체 비용 ⚡-2');
    const chrono = getCharacter('chrono');
    expect(energyRuleText(chrono.drag.description, 3, chrono.drag)).toContain('내 교체 에너지 +2.');
    expect(energyRuleText(chrono.ult.description, 3, chrono.ult)).toContain('모든 플레이어의 교체 에너지 +12.');
    expect(energyNum(6)).toBe('6');
    expect(energyNum(6.44)).toBe('6.4');
  });

  it('slider ranges contain the default value', () => {
    for (const s of SLIDERS) {
      const v = DEFAULT_TUNABLES[s.key];
      expect(v, s.key).toBeGreaterThanOrEqual(s.min);
      expect(v, s.key).toBeLessThanOrEqual(s.max);
    }
  });

  it('persists only changed values (never gameSpeed) and sanitizes on load', () => {
    const t: Tunables = { ...DEFAULT_TUNABLES, swapCooldownMult: 0.5, gameSpeed: 4, invincible: true };
    const diff = diffFromDefaults(t);
    expect(diff).toEqual({ swapCooldownMult: 0.5, invincible: true });
    expect(sanitizeOverrides(diff)).toEqual(diff);
    expect(sanitizeOverrides({ ultChargeTime: 99999, gameSpeed: 3, bogus: 1, invincible: 'yes' })).toEqual({ ultChargeTime: 90 });
    expect(sanitizeOverrides(null)).toEqual({});
  });
});

describe('기획 8차 zone label', () => {
  it('names the zone from the plan theme, else from the floor number', async () => {
    const { zoneName } = await import('../../src/ui/hud');
    expect(zoneName('office', 7)).toBe('사무실층');
    expect(zoneName(undefined, 3)).toBe('로비·상가층');
    expect(zoneName(undefined, 12)).toBe('폐병동층');
    expect(zoneName('rooftop', 20)).toBe('옥상·이계');
  });
});

describe('기획 10차 괴담 방 text', () => {
  const party = [{ defId: CHARACTERS[0].id }, { defId: CHARACTERS[1].id }, { defId: CHARACTERS[2].id }];

  it('labels risk chips and sizes buttons by kind (도박·관찰 tall, 지나간다 small)', () => {
    expect(['safe', 'cost', 'gamble', 'observe', 'permanent'].map(t => goedamTagLabel(t as never))).toEqual(['안전', '대가', '도박', '관찰', '영구']);
    expect(goedamOptionKind({ id: 'leave', tags: ['safe'] })).toBe('leave');
    expect(goedamOptionKind({ id: 'look_back', tags: ['gamble'] })).toBe('gamble');
    expect(goedamOptionKind({ id: 'count', tags: ['observe'] })).toBe('gamble');
    expect(goedamOptionKind({ id: 'ride', tags: ['cost'] })).toBe('cost');
  });

  it('every room keeps leave last and at most one tall option (fits ~470 px without scroll)', () => {
    for (const room of GOEDAM_ROOMS) {
      const kinds = room.options.map(o => goedamOptionKind(goedamOptionView(room.id, o.id, {}, party)));
      expect(kinds[kinds.length - 1], room.id).toBe('leave');
      expect(kinds.filter(k => k === 'leave'), room.id).toHaveLength(1);
      expect(room.options.length, room.id).toBeLessThanOrEqual(3);
    }
  });

  it('timer and wait lines', () => {
    expect(goedamTimerText(25, 'choosing')).toBe("25초 · 안 고르면 '그냥 지나간다'");
    expect(goedamTimerText(4, 'result')).toBe('4초 뒤 자동으로 계속');
    expect(goedamWaitText(2, 3)).toBe('다른 플레이어 기다리는 중 (2/3)');
  });

  it("others' rows: ✓ only before the pick, bots say what they did, humans show pick → result", () => {
    const choosing: GoedamProgress = { stage: 'choosing', options: [], params: {}, choice: null, outcome: null };
    expect(goedamOtherRow({ name: '하늘', isBot: false, party }, 'elevator_whisper', choosing)).toBe('하늘 — 고르는 중…');
    const left: GoedamProgress = { ...choosing, stage: 'done', choice: 'leave', outcome: { id: 'leave', reward: null, relicId: null, traces: [] } };
    expect(goedamOtherRow({ name: 'BOT 1', isBot: true, party }, 'elevator_whisper', left)).toBe('BOT 1 — (봇) 바로 내렸다');
    const rode: GoedamProgress = { ...choosing, stage: 'result', choice: 'ride', outcome: { id: 'ride', reward: null, relicId: null, traces: ['passenger'] } };
    expect(goedamOtherRow({ name: '민지', isBot: false, party }, 'elevator_whisper', rode)).toBe('민지 — 속삭임대로 끝까지 탄다 → 문이 열린다. 누군가 같이 내린다');
  });
});
