// 기획 20차 보스 형태 HUD (src/ui/bossFormHud.ts): the pure helpers — the form line of the banner / pause screen, the
// pattern tips (signature first), the marked-card check (rule N6) and where the name tag of a moving boss stands.

import { describe, expect, it } from 'vitest';
import { BOSSES, RAID_BOSS_IDS, getBoss } from '../../src/data';
import { BOSS_FORM_LABEL, BOSS_FORM_TIP } from '../../src/data/bosses/forms';
import { GUARD_POP_TEXT, MARK_CARD_TEXT, TIP_MORE_TEXT, TIP_REPEAT, TipQueue, bossFormLabel, bossFormLine, bossFormOfId, bossPatternTips, isMarked, tagAnchor, tipShowMs } from '../../src/ui/bossFormHud';
import { LOGICAL_W, type Telegraph } from '../../src/types';

describe('form line', () => {
  it('every raid boss has one: 「형태 · 한 줄」, short enough for the banner on a phone', () => {
    for (const id of RAID_BOSS_IDS) {
      const form = getBoss(id).form ?? 'fixed';
      expect(bossFormOfId(id), id).toBe(form);
      expect(bossFormLabel(id), id).toBe(BOSS_FORM_LABEL[form]);
      expect(bossFormLine(id), id).toBe(`${BOSS_FORM_LABEL[form]} · ${BOSS_FORM_TIP[form]}`);
      expect(bossFormLine(id).length, id).toBeLessThanOrEqual(32);
    }
  });

  it('the classic four are fixed; an unknown boss has no line', () => {
    for (const id of ['elevator_keeper', 'overtime_lord', 'surgeon_director', 'abyss_watcher']) expect(bossFormLine(id)).toMatch(/^고정형 · /);
    expect(bossFormLine('washer_drum')).toMatch(/^배회형 · /);
    expect(bossFormLine('dead_monitor')).toMatch(/^자리 이동형 · /);
    expect(bossFormLine('inverted_moon')).toMatch(/^전장형 · /);
    expect(bossFormLine(undefined)).toBe('');
    expect(bossFormLine('no_such_boss')).toBe('');
    expect(bossFormOfId('no_such_boss')).toBe('fixed');
  });

  it('labels are four different short words', () => {
    const labels = Object.values(BOSS_FORM_LABEL);
    expect(new Set(labels).size).toBe(4);
    for (const l of labels) expect(l.length).toBeLessThanOrEqual(6);
  });
});

describe('pattern tips', () => {
  it('lists the patterns that have a tip, the signature first, phase patterns included', () => {
    for (const b of BOSSES) {
      const all = [...b.skills, ...(b.phases ?? []).flatMap(p => p.skills ?? [])];
      const tips = bossPatternTips(b.id);
      expect(tips.map(t => t.id).sort(), b.id).toEqual(all.filter(s => s.hint).map(s => s.id).sort());
      for (const t of tips) {
        expect(t.name.length, t.id).toBeGreaterThan(0);
        expect(t.hint, t.id).toBe(all.find(s => s.id === t.id)!.hint);
      }
      const sig = tips.findIndex(t => t.signature);
      if (sig >= 0) {
        expect(sig, b.id).toBe(0);
        expect(tips[0].id, b.id).toBe(b.signature);
      }
      expect(tips.filter(t => t.signature).length, b.id).toBeLessThanOrEqual(1);
    }
    expect(bossPatternTips(undefined)).toEqual([]);
    expect(bossPatternTips('no_such_boss')).toEqual([]);
  });
});

describe('mark on my field character (rule N6)', () => {
  const tele = (mark: number | undefined, team: 'enemy' | 'ally' = 'enemy'): Telegraph =>
    ({ id: 1, team, center: { x: 0, y: 0 }, origin: { x: 0, y: 0 }, area: { shape: 'single' }, remaining: 2, total: 3.5, ...(mark != null ? { mark } : null) }) as Telegraph;

  it('only an enemy mark tied to that entity counts', () => {
    expect(isMarked({ telegraphs: [tele(7)] }, 7)).toBe(true);
    expect(isMarked({ telegraphs: [tele(7)] }, 8)).toBe(false);
    expect(isMarked({ telegraphs: [tele(undefined)] }, 7)).toBe(false);
    expect(isMarked({ telegraphs: [tele(7, 'ally')] }, 7)).toBe(false);
    expect(isMarked({ telegraphs: [tele(7)] }, null)).toBe(false);
    expect(isMarked({ telegraphs: [] }, 7)).toBe(false);
  });

  it('player-facing words', () => {
    expect(MARK_CARD_TEXT).toBe('교체!');
    expect(GUARD_POP_TEXT).toEqual({ back: '뒤!', front: '막힘' });
  });
});

describe('name tag anchor', () => {
  it('stands over the head, a gap above it', () => {
    const at = tagAnchor({ x: 640, y: 500 }, 120, false);
    expect(at.x).toBe(640);
    expect(at.y).toBeLessThan(500 - 120);
    expect(at.y).toBeGreaterThan(500 - 120 - 80);
  });

  it('never climbs into the top HUD row and never leaves the screen sideways', () => {
    const top = tagAnchor({ x: 640, y: 150 }, 140, false);
    expect(top.y).toBeGreaterThanOrEqual(100);
    expect(tagAnchor({ x: -50, y: 400 }, 100, false).x).toBeGreaterThan(0);
    expect(tagAnchor({ x: LOGICAL_W + 50, y: 400 }, 100, false).x).toBeLessThan(LOGICAL_W);
  });

  it('a flat body (the moon on the floor) gets a low tag near its centre', () => {
    const flat = tagAnchor({ x: 640, y: 500 }, 300, true);
    const tall = tagAnchor({ x: 640, y: 500 }, 300, false);
    expect(flat.y).toBeGreaterThan(tall.y);
    expect(flat.y).toBeLessThan(500);
  });
});

// ── 기획 20차 점검 (the phone review): the tip slot, the tag beside a body, short tips ──

describe('pattern tips: their own slot (기획 20차 점검)', () => {
  it('a tip stays for the warning + 2.5 s, never less than 4 s', () => {
    expect(tipShowMs(0)).toBe(4000);
    expect(tipShowMs(1.2)).toBe(4000);
    expect(tipShowMs(2.6)).toBe(5100);
    expect(tipShowMs(3.5)).toBe(6000);
  });

  it('one at a time: the next tip waits until the one showing was up 2.5 s, then replaces it; the slot empties when the time is up', () => {
    const q = new TipQueue();
    expect(q.cast('a', '가', '첫 팁', 1, 4)).toBe(true);
    expect(q.pump(1000)).toMatchObject({ id: 'a', name: '가', text: '첫 팁', ms: 4000 });
    expect(q.showing).toBe(true);
    expect(q.cast('b', '나', '둘째 팁', 3, 6)).toBe(true);
    expect(q.pump(2000)).toBeNull(); // a has been up 1 s only
    expect(q.pump(3499)).toBeNull();
    expect(q.pump(3500)).toMatchObject({ id: 'b', ms: 5500 });
    expect(q.pump(8999)).toBeNull();
    expect(q.pump(9000)).toBe('hide');
    expect(q.showing).toBe(false);
    expect(q.pump(9100)).toBeNull();
  });

  it('the parts of one cast are one tip (the longest warning counts); a pattern is said on its first two casts of a run', () => {
    const q = new TipQueue();
    expect(q.cast('a', '가', '팁', 1.2, 10)).toBe(true);
    expect(q.cast('a', '가', '팁', 3, 10)).toBe(false); // the second part, same tick
    expect(q.pump(0)).toMatchObject({ id: 'a', ms: 5500 });
    expect(q.cast('a', '가', '팁', 3.4, 10)).toBe(false); // a later part stretches the one showing
    expect(q.pump(5600)).toBeNull();
    expect(q.pump(5900)).toBe('hide');
    expect(q.cast('a', '가', '팁', 1, 22)).toBe(true); // the second cast
    expect(q.pump(6000)).toMatchObject({ id: 'a' });
    expect(q.cast('a', '가', '팁', 1, 34)).toBe(false); // the third: no more
    expect(TIP_REPEAT).toBe(2);
  });

  it('at most two wait; a new floor empties the slot but keeps the per-run counts', () => {
    const q = new TipQueue();
    q.cast('a', '가', '1', 1, 1);
    q.pump(0);
    q.cast('b', '나', '2', 1, 2);
    q.cast('c', '다', '3', 1, 3);
    q.cast('d', '라', '4', 1, 4); // b is dropped
    expect(q.pump(2500)).toMatchObject({ id: 'c' });
    expect(q.pump(5000)).toMatchObject({ id: 'd' });
    q.floor();
    expect(q.showing).toBe(false);
    expect(q.pump(6000)).toBeNull();
    // the same boss again on the next floor (debug 보스 고르기): the cast at the same floor time is a new cast
    expect(q.cast('a', '가', '1', 1, 1)).toBe(true);
    expect(q.cast('a', '가', '1', 1, 13)).toBe(false);
  });

  it('every tip of the 16 new bosses is one short clause (≤ 21 characters) and they are all different', () => {
    const seen = new Set<string>();
    for (const b of BOSSES) {
      if (!b.form) continue; // the classic four keep their words
      for (const t of bossPatternTips(b.id)) {
        expect(t.hint.length, `${t.id}: ${t.hint}`).toBeLessThanOrEqual(21);
        expect(t.hint.endsWith('.'), t.id).toBe(false);
        seen.add(t.hint);
      }
    }
    expect(seen.size).toBeGreaterThan(40);
    expect(TIP_MORE_TEXT).toContain('일시정지');
  });
});

describe('name tag: beside the body when the top HUD row leaves no room over the head (기획 20차 점검)', () => {
  const BODY = { bodyW: 150, tagW: 200 };

  it('a tall body near the top wall: the tag hangs at its side, clear of the body, toward the middle of the screen', () => {
    const left = tagAnchor({ x: 200, y: 240 }, 160, false, BODY);
    expect(left.x - 100).toBeGreaterThanOrEqual(200 + 75); // the tag's left edge is right of the body
    expect(left.y).toBeGreaterThan(150);
    expect(left.y).toBeLessThanOrEqual(240);
    const right = tagAnchor({ x: 1100, y: 240 }, 160, false, BODY);
    expect(right.x + 100).toBeLessThanOrEqual(1100 - 75);
  });

  it('with room over the head it stays over the head; a flat body never gets a side tag', () => {
    const at = tagAnchor({ x: 640, y: 500 }, 120, false, BODY);
    expect(at.x).toBe(640);
    expect(at.y).toBe(500 - 120 - 40);
    expect(tagAnchor({ x: 640, y: 170 }, 300, true, BODY).x).toBe(640);
  });

  it('under a pattern tip the middle of the screen is taken further down', () => {
    const plain = tagAnchor({ x: 640, y: 330 }, 150, false);
    const tip = tagAnchor({ x: 640, y: 330 }, 150, false, { tip: true });
    expect(plain.y).toBe(140);
    expect(tip.y).toBeGreaterThan(190);
  });

  it('the tag never leaves the screen sideways', () => {
    const at = tagAnchor({ x: 1250, y: 240 }, 160, false, BODY);
    expect(at.x + 100).toBeLessThanOrEqual(LOGICAL_W);
    expect(at.x - 100).toBeGreaterThanOrEqual(0);
  });
});
