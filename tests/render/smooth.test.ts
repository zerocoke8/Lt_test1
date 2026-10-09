// Solo draw smoothing (src/render/smooth.ts): 30 Hz sim on a 60 Hz screen moves on every frame, never touches the
// sim's state, snaps teleports and returns the state itself when nothing moves.
import { describe, expect, it } from 'vitest';
import { TickSmoother } from '../../src/render/smooth';
import { HUMAN, BOT1, makeGame } from '../sim/helpers';

describe('TickSmoother (solo)', () => {
  it('a real run: on-screen units move on every 60 Hz frame (raw 30 Hz state moves on every other one); sim state untouched', () => {
    const tg = makeGame({ players: [HUMAN, BOT1], seed: 7 });
    const g = tg.game;
    const sm = new TickSmoother();
    let now = 0;
    const raw: number[] = [];
    const drawn: number[] = [];
    const before = JSON.stringify(g.state.entities.map(e => e.pos));
    // warm up until something walks
    let mid = new Map<number, string>();
    for (let i = 0; i < 240; i++) {
      now += 1000 / 60;
      g.step(1 / 60);
      sm.view(g.state, now, 1);
      if (i === 229) mid = new Map(g.state.entities.map(e => [e.id, JSON.stringify(e.pos)]));
    }
    expect(JSON.stringify(g.state.entities.map(e => e.pos))).not.toBe(before); // the sim itself moved
    // 기획 16차 템포: a unit that walked in the last warm-up frames (spawns come close, so the party may stand and fight)
    const walker = g.state.entities.find(e => (e.kind === 'monster' || e.kind === 'character') && mid.has(e.id) && mid.get(e.id) !== JSON.stringify(e.pos));
    const id = (walker ?? g.state.entities.find(e => e.kind === 'monster' || e.kind === 'character'))!.id;
    let prevRaw: { x: number; y: number } | null = null;
    let prevDrawn: { x: number; y: number } | null = null;
    let movingFrames = 0;
    for (let i = 0; i < 120; i++) {
      now += 1000 / 60;
      g.step(1 / 60);
      const e = g.state.entities.find(x => x.id === id);
      if (!e) break;
      const snapshot = JSON.stringify(e.pos);
      const v = sm.view(g.state, now, 1);
      expect(JSON.stringify(e.pos)).toBe(snapshot); // sim state untouched
      const d = v.entities.find(x => x.id === id)!.pos;
      if (prevRaw && prevDrawn) {
        const rawStep = Math.hypot(e.pos.x - prevRaw.x, e.pos.y - prevRaw.y);
        const drawnStep = Math.hypot(d.x - prevDrawn.x, d.y - prevDrawn.y);
        raw.push(rawStep);
        drawn.push(drawnStep);
        if (rawStep > 0 || drawnStep > 0) movingFrames++;
      }
      prevRaw = { ...e.pos };
      prevDrawn = { ...d };
    }
    expect(movingFrames).toBeGreaterThan(20);
    // while the unit walks: raw frames alternate move/still, drawn frames all move
    const walking = raw.map((r, i) => ({ r, d: drawn[i], next: raw[i + 1] ?? 0, prev: raw[i - 1] ?? 0 })).filter(x => x.prev > 0 || x.r > 0 || x.next > 0);
    const rawStill = walking.filter(x => x.r === 0).length / Math.max(1, walking.length);
    const drawnStill = walking.filter(x => x.d === 0).length / Math.max(1, walking.length);
    expect(rawStill).toBeGreaterThan(0.3);
    expect(drawnStill).toBeLessThan(rawStill / 2);
  });

  it('teleports and new units are drawn where they are; nothing moving → the same state object', () => {
    const tg = makeGame({ players: [HUMAN, BOT1], seed: 8 });
    const s = tg.game.state;
    const sm = new TickSmoother();
    expect(sm.view(s, 0, 1)).toBe(s);
    const e = s.entities[0];
    const x0 = e.pos.x;
    s.tick += 1;
    e.pos = { x: x0 + 0.1, y: e.pos.y };
    // the frame that sees the new tick still shows the previous tick's spot, then it glides over one tick (33 ms)
    const v0 = sm.view(s, 10, 1);
    expect(v0).not.toBe(s);
    expect(v0.entities[0].pos.x).toBeCloseTo(x0, 6);
    expect(sm.view(s, 10 + 1000 / 90, 1).entities[0].pos.x).toBeCloseTo(x0 + 0.1 / 3, 6);
    expect(sm.view(s, 50, 1).entities[0].pos.x).toBeCloseTo(x0 + 0.1, 6);
    // at 2× game speed a tick lasts half as long
    expect(sm.view(s, 10 + 1000 / 90, 2).entities[0].pos.x).toBeCloseTo(x0 + 0.2 / 3, 6);
    s.tick += 1;
    e.pos = { x: x0 + 8, y: e.pos.y };
    expect(sm.view(s, 41, 1).entities[0].pos.x).toBe(x0 + 8);
    // a new run (tick back to 0) starts clean
    s.tick = 0;
    expect(sm.view(s, 50, 1)).toBe(s);
  });
});
