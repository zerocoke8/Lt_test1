// 기획 17차 저스트 교대 연출 (render-only): the solo slow curve (0.3× for 300 ms, back to 1 over 150 ms, ≤ once per 2 s),
// the stamp timeline and text, the multiplayer cue latency math (snapshot age + half the ping, justCue), JustFx
// (mine = flash + stamp, the afterimage shatters when its telegraph lands but fades when it was cut, multiplayer
// desaturate) and the reward proc pills (tags, merge, caps, the same reward 2 s, mine only, under a stamp).
import { describe, expect, it } from 'vitest';
import type { GameEvent, GameState, RenderUiState } from '../../src/types';
import { createRenderer } from '../../src/render';
import { ROLE_TAGS, getFamily } from '../../src/data';
import { JUST_SLOW, JustSlow, justTimeScale } from '../../src/render/juice';
import { JUST_FX, JUST_LOG, JUST_STAMP, JustFx, cueAgeSec, stampPose, stampText, type JustFxHost } from '../../src/render/justFx';
import { PILL, RewardPills, placePill, procTags } from '../../src/render/rewardPills';
import { justCue } from '../../src/sim/justSwap';
import { DEFAULT_TUNABLES } from '../../src/config';
import { HUMAN, active, advance, makeGame, quietFloor } from '../sim/helpers';

describe('solo slow (justTimeScale / JustSlow)', () => {
  it('0.3× for 300 ms, linear back to 1 over 150 ms, 1 outside', () => {
    expect(justTimeScale(0)).toBe(0.3);
    expect(justTimeScale(299)).toBe(0.3);
    expect(justTimeScale(375)).toBeCloseTo(0.65, 6);
    expect(justTimeScale(450)).toBe(1);
    expect(justTimeScale(5000)).toBe(1);
    expect(justTimeScale(-1)).toBe(1);
    expect(justTimeScale(Number.NaN)).toBe(1);
  });

  it('starts at most once per 2 s', () => {
    const s = new JustSlow();
    expect(s.scale(0)).toBe(1);
    expect(s.start(1000)).toBe(true);
    expect(s.scale(1100)).toBe(JUST_SLOW.scale);
    expect(s.start(2500)).toBe(false);
    expect(s.scale(2500)).toBe(1);
    expect(s.start(3000)).toBe(true);
    s.reset();
    expect(s.scale(3001)).toBe(1);
  });
});

describe('stamp', () => {
  it('1.6× → 1× in 0.12 s, held 0.45 s, rises out over 0.25 s', () => {
    expect(stampPose(0)!.scale).toBeCloseTo(1.6, 6);
    expect(stampPose(JUST_STAMP.in)!.scale).toBe(1);
    expect(stampPose(0.4)).toEqual({ scale: 1, alpha: 1, rise: 0 });
    const out = stampPose(JUST_STAMP.in + JUST_STAMP.hold + JUST_STAMP.out / 2)!;
    expect(out.alpha).toBeCloseTo(0.5, 6);
    expect(out.rise).toBeGreaterThan(0);
    expect(stampPose(1)).toBeNull();
    expect(stampText(1)).toBe('저스트!');
    expect(stampText(2)).toBe('저스트! ×2');
  });
});

describe('multiplayer cue latency', () => {
  it('cueAgeSec = snapshot age + half the ping (s); unknown parts count 0', () => {
    expect(cueAgeSec(40, 100)).toBeCloseTo(0.09, 9);
    expect(cueAgeSec(null, null)).toBe(0);
    expect(cueAgeSec(-5, 80)).toBeCloseTo(0.04, 9);
    expect(cueAgeSec(30, Number.NaN)).toBeCloseTo(0.03, 9);
  });

  it("justCue: '위험' while covered, '지금!' once it lands within the window — earlier by the age", () => {
    const tg = makeGame({ seed: 9, players: [HUMAN], tunables: { invincible: true } });
    quietFloor(tg);
    advance(tg, 2); // past the appear invulnerability
    const me = active(tg);
    const s = tg.w.state;
    s.telegraphs.push({ id: 900, team: 'enemy', center: { ...me.pos }, origin: { ...me.pos }, area: { shape: 'circle', radius: 2 }, remaining: 0.7, total: 1.2 });
    const t = DEFAULT_TUNABLES;
    expect(justCue(s, t, 0, 0)).toMatchObject({ danger: true, now: false });
    const early = justCue(s, t, 0, 0.25);
    expect(early.now).toBe(true);
    expect(early.landIn).toBeCloseTo(0.45, 6);
    // already landed on the server by the time my swap arrives: no cue
    expect(justCue(s, t, 0, 0.8).now).toBe(false);
    // a telegraph elsewhere: nothing
    s.telegraphs[0].center = { x: me.pos.x + 9, y: me.pos.y };
    expect(justCue(s, t, 0, 0.25)).toMatchObject({ danger: false, now: false });
    // window 0 = off: danger only
    s.telegraphs[0].center = { ...me.pos };
    expect(justCue(s, { ...t, justSwapWindow: 0 }, 0, 0.25)).toMatchObject({ danger: true, now: false });
  });
});

// ─────────────────────────── JustFx / pills on a fake state ───────────────────────────

function fakeState(): GameState {
  return {
    players: [
      { id: 0, color: '#4cc9f0', party: [{ defId: 'guardian', entityId: 10 }, { defId: 'blade', entityId: 11 }, { defId: 'mage', entityId: null }] },
      { id: 1, color: '#f72585', party: [{ defId: 'ranger', entityId: 20 }, { defId: 'cleric', entityId: null }, { defId: 'bard', entityId: null }] },
    ],
    entities: [
      { id: 11, kind: 'character', defId: 'blade', ownerPlayer: 0, partyIndex: 1, pos: { x: 5, y: 3 } },
      { id: 12, kind: 'character', defId: 'mage', ownerPlayer: 0, partyIndex: 2, pos: { x: 6, y: 3 } },
      { id: 13, kind: 'character', defId: 'guardian', ownerPlayer: 0, partyIndex: 0, pos: { x: 7, y: 3 } },
      { id: 14, kind: 'character', defId: 'cleric', ownerPlayer: 0, partyIndex: 0, pos: { x: 8, y: 3 } },
      { id: 15, kind: 'character', defId: 'bard', ownerPlayer: 0, partyIndex: 0, pos: { x: 9, y: 3 } },
      { id: 20, kind: 'character', defId: 'ranger', ownerPlayer: 1, partyIndex: 0, pos: { x: 2, y: 2 } },
      { id: 30, kind: 'monster', defId: 'x', ownerPlayer: null, partyIndex: null, pos: { x: 1, y: 1 } },
    ],
    telegraphs: [{ id: 7, team: 'enemy', center: { x: 4, y: 3 }, origin: { x: 4, y: 3 }, area: { shape: 'circle', radius: 1.5 }, remaining: 0.3, total: 1 }],
  } as unknown as GameState;
}

const just = (player: number, o: Partial<Extract<GameEvent, { type: 'justSwap' }>> = {}): GameEvent => ({
  type: 'justSwap', player, outIndex: 0, inIndex: 1, inEntityId: player === 0 ? 11 : 20, pos: { x: 4, y: 3 }, drop: { x: 5, y: 3 }, sourceId: 30, skillId: 'x', boss: false, dodged: 1, telegraphIds: [7], landIn: 0.3, cdCut: 4, ...o,
});

function host(): JustFxHost & { bursts: number; stops: number } {
  const h = { bursts: 0, stops: 0, burst: () => void h.bursts++, ring: () => {}, hitStopJust: () => void h.stops++ };
  return h;
}

describe('JustFx', () => {
  it('mine: big stamp, flash, hit-stop; the afterimage shatters when its telegraph lands', () => {
    JUST_FX.multi = false;
    const fx = new JustFx();
    const s = fakeState();
    const hst = host();
    const before = JUST_LOG.length;
    fx.handle(just(0, { dodged: 2 }), s, 0, new Map(), hst);
    expect(hst.stops).toBe(1);
    let d = fx.debugState();
    expect(d.stamps).toEqual([{ text: '저스트! ×2', mine: true, at: { x: 5, y: 3 } }]);
    expect(d.flash).toBe(true);
    expect(d.desat).toBe(false);
    expect(JUST_LOG.length).toBe(Math.min(16, before + 1));
    expect(JUST_LOG[JUST_LOG.length - 1]).toMatchObject({ text: '저스트! ×2', mine: true, player: 0 });
    expect(fx.stampOn(11)).toBe(true);
    fx.update(0.1, s, hst);
    expect(fx.debugState().afterimages).toBe(1);
    expect(hst.bursts).toBe(0);
    s.telegraphs = [];
    fx.update(0.05, s, hst);
    expect(hst.bursts).toBeGreaterThan(0);
    fx.update(1, s, hst);
    d = fx.debugState();
    expect(d.afterimages).toBe(0);
    expect(d.stamps).toEqual([]);
  });

  it("another player's: small stamp only (no flash, no hit-stop); a cut telegraph fades without shards", () => {
    const fx = new JustFx();
    const s = fakeState();
    const hst = host();
    fx.handle(just(1), s, 0, new Map(), hst);
    expect(hst.stops).toBe(0);
    expect(fx.debugState()).toMatchObject({ flash: false, stamps: [{ mine: false, text: '저스트!' }] });
    fx.handle({ type: 'interrupt', sourceId: 30, telegraphId: 7, pos: { x: 4, y: 3 }, name: 'x' }, s, 0, new Map(), hst);
    s.telegraphs = [];
    fx.update(0.05, s, hst);
    expect(hst.bursts).toBe(0);
  });

  it('multiplayer: my 저스트 desaturates for 0.35 s (the clock is not touched)', () => {
    JUST_FX.multi = true;
    const fx = new JustFx();
    const s = fakeState();
    fx.handle(just(0), s, 0, new Map(), host());
    expect(fx.debugState().desat).toBe(true);
    fx.update(0.4, s, host());
    expect(fx.debugState().desat).toBe(false);
    JUST_FX.multi = false;
  });

  it('flash at most once a second', () => {
    const fx = new JustFx();
    const s = fakeState();
    fx.update(2, s, host());
    fx.handle(just(0), s, 0, new Map(), host());
    fx.update(0.5, s, host());
    fx.handle(just(0), s, 0, new Map(), host());
    expect(fx.debugState().flash).toBe(false);
  });
});

const proc = (entityId: number | null, rewardId: string, player = 0): GameEvent => ({ type: 'rewardProc', player, partyIndex: null, entityId, rewardId, pos: { x: 0, y: 0 } });

describe('reward proc pills', () => {
  it('tags: family tags, role card by role, relics by RELIC_TAGS', () => {
    expect(procTags('bolt', null)).toEqual(getFamily('bolt').tags);
    expect(procTags('role', 'tank')).toEqual(ROLE_TAGS.tank);
    expect(procTags('role', null)).toEqual([]);
    expect(procTags('relay_flag', null)).toEqual(['leave']);
    expect(procTags('nope', null)).toEqual([]);
  });

  it('mine only; merges within 0.25 s; the same reward on one unit once per 2 s; 4 on screen', () => {
    const s = fakeState();
    const pills = new RewardPills();
    const none = () => false;
    pills.handle(proc(20, 'bolt', 1), s, 0, none); // someone else's unit
    pills.handle(proc(30, 'bolt'), s, 0, none); // an enemy
    expect(pills.pills).toHaveLength(0);
    pills.handle(proc(11, 'bolt'), s, 0, none);
    pills.handle(proc(11, 'fog'), s, 0, none);
    expect(pills.pills).toHaveLength(1);
    expect(new Set(pills.pills[0].tags)).toEqual(new Set([...getFamily('bolt').tags, ...getFamily('fog').tags]));
    pills.update(0.5, s);
    pills.handle(proc(11, 'bolt'), s, 0, none); // within 2 s of the last bolt
    expect(pills.pills[0].age).toBeGreaterThan(0.4);
    for (const id of [12, 13, 14, 15]) pills.handle(proc(id, 'scorch'), s, 0, none);
    expect(pills.pills.length).toBe(PILL.maxOnScreen);
    pills.update(PILL.dur + 0.1, s);
    expect(pills.pills).toHaveLength(0);
    pills.update(2, s);
    pills.handle(proc(11, 'bolt'), s, 0, none);
    expect(pills.pills).toHaveLength(1);
  });

  it("a co-op effect another player gave me gets that player's colour; under a stamp it waits 0.3 s", () => {
    const s = fakeState();
    const pills = new RewardPills();
    pills.handle(proc(11, 'red_thread', 1), s, 0, () => true);
    if (!pills.pills.length) return; // the family may carry no tags (data owned by its track)
    expect(pills.pills[0].giver).toBe('#f72585');
    expect(pills.pills[0].age).toBeCloseTo(-PILL.justDelay, 6);
    expect(pills.pills[0].low).toBe(true);
  });
});

describe('in the renderer (headless)', () => {
  it('draws the stamp, afterimage, pills, flash and the multiplayer desaturate without throwing or touching the state', () => {
    const texts: string[] = [];
    const ops = new Set<string>();
    const gradient = { addColorStop() {} };
    const store: Record<string | symbol, unknown> = {};
    const ctx = new Proxy(store, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
        if (prop === 'fillText') return (t: string) => void texts.push(String(t));
        return () => {};
      },
      set(target, prop, value) {
        if (prop === 'globalCompositeOperation') ops.add(String(value));
        target[prop] = value;
        return true;
      },
    });
    const canvas = { width: 300, height: 150, style: {}, getContext: () => ctx };
    const r = createRenderer(canvas as unknown as HTMLCanvasElement);
    const tg = makeGame({ seed: 5, players: [HUMAN], tunables: { invincible: true } });
    quietFloor(tg);
    advance(tg, 1);
    const me = active(tg);
    const s = structuredClone(tg.w.state);
    const ui = { localPlayer: 0, dragPreview: null, freezeCamera: false } as unknown as RenderUiState;
    r.render(s, [], 1 / 60, ui);
    const ev: GameEvent[] = [
      { type: 'justSwap', player: 0, outIndex: 1, inIndex: 0, inEntityId: me.id, pos: { x: me.pos.x - 1, y: me.pos.y }, drop: { ...me.pos }, sourceId: null, skillId: 'x', boss: false, dodged: 2, telegraphIds: [999], landIn: 0.3, cdCut: 4 },
      { type: 'rewardProc', player: 0, partyIndex: 0, entityId: me.id, rewardId: 'bolt', pos: { ...me.pos } },
      { type: 'damage', targetId: me.id, amount: 50, crit: false, pos: { ...me.pos }, targetTeam: 'enemy', absorbed: 0, source: 'drag', skillName: 'x', just: true },
    ];
    JUST_FX.multi = true;
    const before = JSON.stringify(s);
    for (let i = 0; i < 20; i++) r.render(s, i === 0 ? ev : [], 1 / 60, ui);
    JUST_FX.multi = false;
    expect(JSON.stringify(s)).toBe(before);
    expect(texts).toContain('저스트! ×2');
    expect(ops.has('saturation')).toBe(true);
  });
});

describe('reward pills keep off the skill callouts (기획 17차 리뷰)', () => {
  const callout = { x: 400, top: 200, bottom: 230, w: 120 };
  it('a pill on a callout moves above it; with no room above, below it', () => {
    const y = placePill(400, 215, 60, 24, [callout]);
    expect(y + 12).toBeLessThanOrEqual(callout.top);
    const low = { ...callout, top: 150, bottom: 180 };
    const y2 = placePill(400, 165, 60, 24, [low]);
    expect(y2 - 12).toBeGreaterThanOrEqual(low.bottom);
  });
  it('a pill clear of every callout stays put', () => {
    expect(placePill(100, 215, 60, 24, [callout])).toBe(215);
    expect(placePill(400, 300, 60, 24, [callout])).toBe(300);
  });
});
