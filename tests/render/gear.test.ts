// 기획 15차 원정: gear drawing (render/gear.ts via units.ts drawBody) and the picture-file slot (render/gearArt.ts).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { drawBody } from '../../src/render/units';
import { unitLook } from '../../src/render/look';
import { buildArtTable, gearArtName, gearArtNames } from '../../src/render/gearArt';
import { gearBandsOf, type GearBand, type GearBands } from '../../src/data/gear';
import { CHARACTERS } from '../../src/data';

type Call = [string, ...unknown[]];

/** A 2D context that records every call (with arguments) and every property write. */
function recordingCtx() {
  const log: Call[] = [];
  const xs: number[] = [];
  const store: Record<string | symbol, unknown> = { globalAlpha: 1 };
  const ctx = new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...a: unknown[]) => {
        log.push([String(prop), ...a.map(v => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v))]);
        if ((prop === 'moveTo' || prop === 'lineTo') && typeof a[0] === 'number') xs.push(a[0] as number);
        if (prop === 'measureText') return { width: 10 };
        return undefined;
      };
    },
    set(target, prop, value) {
      log.push([`=${String(prop)}`, value]);
      target[prop] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log, xs };
}

const W = 40;
function drawHero(id: string, gear?: GearBands | null, gearFx?: number) {
  const r = recordingCtx();
  drawBody(r.ctx, unitLook('character', id), 'character', 200, 300, W, W * 1.3, 1, 1.7, 0.4, false, gear, gearFx);
  return r;
}
const full = (b: GearBand, relic = 1): GearBands => ({ w: b, a: b, c: b, r: relic, rb: b });
const paths = (log: Call[]) => log.filter(c => c[0] === 'beginPath').length;

describe('gear on a hero (9장)', () => {
  it('no gear draws exactly the classic picture (gear absent = null = an empty loadout)', () => {
    for (const c of CHARACTERS) {
      const base = drawHero(c.id).log;
      expect(drawHero(c.id, null).log).toEqual(base);
      expect(drawHero(c.id, gearBandsOf({})).log).toEqual(base);
    }
  });

  it('every band changes the picture, and the bands differ from each other', () => {
    const seen = new Set<string>([JSON.stringify(drawHero('blade').log)]);
    for (let b = 1 as GearBand; b <= 4; b = (b + 1) as GearBand) {
      const key = JSON.stringify(drawHero('blade', full(b, 0)).log);
      expect(seen.has(key), `band ${b}`).toBe(false);
      seen.add(key);
    }
  });

  it('each slot alone shows (weapon, armor, charm, relic)', () => {
    const base = JSON.stringify(drawHero('mage').log);
    for (const g of [{ w: 2, a: 0, c: 0, r: 0, rb: 0 }, { w: 0, a: 2, c: 0, r: 0, rb: 0 }, { w: 0, a: 0, c: 2, r: 0, rb: 0 }, { w: 0, a: 0, c: 0, r: 3, rb: 2 }] as GearBands[])
      expect(JSON.stringify(drawHero('mage', g).log), JSON.stringify(g)).not.toBe(base);
  });

  it('budget: at most 15 extra paths per hero, never shadowBlur, outline within +30 % of the body width', () => {
    for (const c of CHARACTERS) {
      const base = drawHero(c.id);
      for (let b = 1 as GearBand; b <= 4; b = (b + 1) as GearBand) {
        const g = drawHero(c.id, full(b, 8));
        expect(paths(g.log) - paths(base.log), `${c.id} b${b}`).toBeLessThanOrEqual(15);
        expect(g.log.some(x => x[0] === '=shadowBlur'), c.id).toBe(false);
      }
      // armor / charm (body-hugging parts) stay within ±0.65 w of the centre (the weapon side is the hand prop)
      const body = drawHero(c.id, { w: 0, a: 4, c: 4, r: 0, rb: 0 });
      const known = new Set(base.xs);
      for (const x of body.xs.filter(v => !known.has(v))) expect(Math.abs(x - 200), c.id).toBeLessThanOrEqual(W * 0.65 + 4);
    }
  });

  it('other players’ glow is dimmer (gearFx) but the shapes are the same', () => {
    const mine = drawHero('blade', full(4));
    const other = drawHero('blade', full(4), 0.55);
    expect(other.log.filter(c => c[0] !== '=globalAlpha')).toEqual(mine.log.filter(c => c[0] !== '=globalAlpha'));
    expect(JSON.stringify(other.log)).not.toBe(JSON.stringify(mine.log));
  });

  it('gearBandsOf: tiers → bands, relic icon index, null when nothing is worn', () => {
    expect(gearBandsOf(undefined)).toBeNull();
    expect(gearBandsOf({})).toBeNull();
    expect(gearBandsOf({ weapon: { slot: 'weapon', tier: 1, rarity: 'common' } })).toEqual({ w: 1, a: 0, c: 0, r: 0, rb: 0 });
    expect(gearBandsOf({ armor: { slot: 'armor', tier: 7, rarity: 'rare', optionId: 'a_evac' }, relic: { slot: 'relic', tier: 12, rarity: 'epic', relicId: 'echo_seal' } })).toEqual({ w: 0, a: 3, c: 0, r: 1, rb: 4 });
  });
});

describe('gear pictures (9-6, docs/gear-art-prompts.md)', () => {
  const doc = readFileSync(join(__dirname, '../../docs/gear-art-prompts.md'), 'utf8');
  const table = doc.slice(doc.indexOf('## 6.'), doc.indexOf('## 7.'));
  const docNames = [...table.matchAll(/`(gear-[a-z0-9_-]+)\.png`/g)].map(m => m[1]);

  it('the game looks for exactly the 52 names of the prompt sheet', () => {
    expect(docNames.length).toBe(52);
    expect([...gearArtNames()].sort()).toEqual([...docNames].sort());
    expect(new Set(gearArtNames()).size).toBe(52);
  });

  it('names by slot / family / band / relic', () => {
    expect(gearArtName('weapon', 'bow', 3)).toBe('gear-weapon-bow-b3');
    expect(gearArtName('armor', null, 4)).toBe('gear-armor-b4');
    expect(gearArtName('charm', null, 1)).toBe('gear-charm-b1');
    expect(gearArtName('relic', null, 2, 'blood_chalice')).toBe('gear-relic-blood_chalice');
    for (const n of gearArtNames()) expect(n).toMatch(/^gear-(weapon-[a-z]+-b[1-4]|armor-b[1-4]|charm-b[1-4]|relic-[a-z_]+)$/);
  });

  it('files: known names map to their url, unknown names are reported', () => {
    const r = buildArtTable({ '../assets/gear/gear-armor-b2.png': 'data:a', '../assets/gear/gear-sword-b9.png': 'data:b' });
    expect(r.table.get('gear-armor-b2')).toBe('data:a');
    expect(r.unknown).toEqual(['gear-sword-b9']);
    expect(buildArtTable({}).table.size).toBe(0);
  });

  it('size budget: each picture ≤ 60 KB, all ≤ 3.5 MB, every file named from the list', () => {
    const dir = join(__dirname, '../../src/assets/gear');
    expect(existsSync(dir)).toBe(true);
    const files = readdirSync(dir).filter(f => f.endsWith('.png'));
    const known = new Set(gearArtNames());
    let total = 0;
    for (const f of files) {
      const size = statSync(join(dir, f)).size;
      total += size;
      expect(size, f).toBeLessThanOrEqual(60 * 1024);
      expect(known.has(f.replace(/\.png$/, '')), `${f}: name not in docs/gear-art-prompts.md`).toBe(true);
    }
    expect(total).toBeLessThanOrEqual(3.5 * 1024 * 1024);
  });
});
