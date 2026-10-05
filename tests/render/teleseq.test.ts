// 기획 8차 리뷰: multi-part enemy casts (문짝 쓸기 4 bands, ring → center …) are grouped and ordered so only the next
// part is drawn strongly; lone warnings stay lone.
import { describe, expect, it } from 'vitest';
import { TeleSequencer, type TeleSeqInfo } from '../../src/render/teleseq';
import type { AreaShape, GameEvent, Telegraph } from '../../src/types';

const band: AreaShape = { shape: 'rect', length: 13, width: 6, dir: 'down' };
const cast = (skillId: string, x: number, delay: number, sourceId = 7, area: AreaShape = band): GameEvent => ({
  type: 'skillCast',
  sourceId,
  player: null,
  slot: 'monster',
  skillId,
  name: skillId,
  center: { x, y: 0 },
  area,
  team: 'enemy',
  delay,
});
const tele = (id: number, x: number, remaining: number, area: AreaShape = band): Telegraph => ({
  id,
  team: 'enemy',
  center: { x, y: 0 },
  origin: { x, y: 0 },
  area,
  remaining,
  total: remaining,
});
const out = (): TeleSeqInfo => ({ order: 0, count: 0, next: false, group: 0 });

describe('TeleSequencer', () => {
  it('groups one cast’s parts in landing order; only the soonest is next, and next moves on as parts land', () => {
    const s = new TeleSequencer();
    const xs = [3, 9, 15, 21];
    xs.forEach((x, i) => s.noteEvent(cast('ek_doors', x, 1.4 + i * 0.5)));
    let teles = xs.map((x, i) => tele(10 + i, x, 1.4 + i * 0.5));
    s.track(teles);
    const infos = teles.map(t => ({ ...s.info(t, out())! }));
    expect(infos.map(i => i.order)).toEqual([1, 2, 3, 4]);
    expect(infos.map(i => i.count)).toEqual([4, 4, 4, 4]);
    expect(infos.map(i => i.next)).toEqual([true, false, false, false]);
    expect(new Set(infos.map(i => i.group)).size).toBe(1);
    // the first band lands → the second is next
    teles = teles.slice(1).map(t => ({ ...t, remaining: t.remaining - 1.4 }));
    s.track(teles);
    expect(teles.map(t => s.info(t, out())!.next)).toEqual([true, false, false]);
    expect(s.info(teles[0], out())!.order).toBe(2);
    // all gone → nothing left
    s.track([]);
    expect(s.info(teles[2], out())).toBeNull();
  });

  it('lone warnings and different casters stay ungrouped; same-time parts share a step', () => {
    const s = new TeleSequencer();
    s.noteEvent(cast('eye_glare', 5, 1, 1, { shape: 'fan', radius: 7, angle: 50 }));
    s.noteEvent(cast('eye_glare', 8, 1, 2, { shape: 'fan', radius: 7, angle: 50 }));
    s.noteEvent(cast('combo', 12, 1, 3));
    s.noteEvent(cast('combo', 18, 1, 3));
    const teles = [
      tele(1, 5, 1, { shape: 'fan', radius: 7, angle: 50 }),
      tele(2, 8, 1, { shape: 'fan', radius: 7, angle: 50 }),
      tele(3, 12, 1),
      tele(4, 18, 1),
    ];
    s.track(teles);
    expect(s.info(teles[0], out())).toBeNull();
    expect(s.info(teles[1], out())).toBeNull();
    expect(s.info(teles[2], out())).toMatchObject({ order: 1, next: true, count: 1 });
    expect(s.info(teles[3], out())).toMatchObject({ order: 1, next: true, count: 1 });
  });

  it('a telegraph without its cast event this frame (late snapshot) is drawn as a lone warning; reset forgets all', () => {
    const s = new TeleSequencer();
    s.track([tele(1, 3, 1), tele(2, 9, 1.5)]);
    expect(s.info(tele(1, 3, 1), out())).toBeNull();
    s.noteEvent(cast('ek_doors', 3, 1));
    s.noteEvent(cast('ek_doors', 9, 1.5));
    const t = [tele(5, 3, 1), tele(6, 9, 1.5)];
    s.track(t);
    expect(s.info(t[1], out())).toMatchObject({ order: 2, next: false });
    s.reset();
    expect(s.info(t[1], out())).toBeNull();
  });
});
