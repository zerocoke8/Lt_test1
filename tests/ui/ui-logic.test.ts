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

  it('기획 15차: the 궁극기 게이지 section holds the two ult sliders; the 14차 test toggles are gone', () => {
    expect(SLIDERS.filter(s => s.group === '궁극기 게이지').map(s => [s.key, s.min, s.max])).toEqual([
      ['ultFieldChargeTime', 5, 90],
      ['ultBenchRatio', 0, 1],
    ]);
    expect(TOGGLES.map(t => t.key)).toEqual(['invincible', 'instantCooldowns']);
    expect(DEFAULT_TUNABLES.ultFieldChargeTime).toBe(30);
    expect(DEFAULT_TUNABLES.ultBenchRatio).toBeCloseTo(1 / 3, 12);
    for (const k of ['ultPerCharacter', 'ultChargeTime', 'swapEnergyMode', 'swapEnergyMax', 'swapEnergyRegen']) expect(DEFAULT_TUNABLES).not.toHaveProperty(k);
    // an old browser's saved 14차 toggles / sliders are dropped silently; the ult sliders are kept (clamped)
    const old = { ultPerCharacter: true, ultChargeTime: 12, swapEnergyMode: true, swapEnergyMax: 6, swapEnergyRegen: 2, ultBenchRatio: 3 };
    expect(sanitizeOverrides(old)).toEqual({ ultBenchRatio: 1 });
    // slider formats (0.05 steps → 2 decimals, 0.1 / 0.5 → 1, 0.01 → 2)
    expect(formatTunable(SLIDERS.find(s => s.key === 'swapCooldownMult')!, 1)).toBe('1.00×');
    expect(formatTunable(SLIDERS.find(s => s.key === 'waveInterval')!, 8)).toBe('8.0초');
    expect(formatTunable(SLIDERS.find(s => s.key === 'ultBenchRatio')!, 1 / 3)).toBe('0.33×');
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
    expect(sanitizeOverrides({ ultFieldChargeTime: 99999, gameSpeed: 3, bogus: 1, invincible: 'yes' })).toEqual({ ultFieldChargeTime: 90 });
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
