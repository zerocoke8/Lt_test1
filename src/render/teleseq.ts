// 기획 8차 리뷰 (readability): the parts of one multi-part enemy skill — 문짝 쓸기 (4 bands), 메스 투척 (3 lines),
// 층수 카운트다운 / 촉수 (ring → center), 도장 연타 (+ → X → ●) — are all telegraphed the moment it is cast. Drawn at full
// strength they read as one red wall ("nothing looks safe"). This groups the telegraphs of one cast (matched to that
// frame's skillCast events: same caster + same skill) and orders them by landing time, so the renderer draws only the
// next part strongly and the later ones as numbered outlines with a sweep arrow. Pure bookkeeping, no drawing.

import type { GameEvent, Telegraph } from '../types';

export interface TeleSeqInfo {
  /** 1-based landing order inside its cast. */
  order: number;
  /** Parts in the cast. */
  count: number;
  /** Lands next (the soonest of the parts still up; parts landing together are all "next"). */
  next: boolean;
  group: number;
}

interface PendingCast {
  key: string;
  cx: number;
  cy: number;
  shape: string;
  used: boolean;
}

interface Group {
  id: number;
  /** telegraph ids in landing order */
  ids: number[];
  order: Map<number, number>;
  /** smallest `remaining` among its live telegraphs this frame */
  min: number;
  live: number;
}

/** Parts landing within this many seconds of each other count as one step. */
const SAME_STEP = 0.05;

export class TeleSequencer {
  private casts: PendingCast[] = [];
  private readonly seen = new Set<number>();
  private readonly groupOf = new Map<number, Group>();
  private readonly groups: Group[] = [];
  private nextId = 1;
  private stamp = 0;
  private readonly liveStamp = new Map<number, number>();

  /** Feed every event of the frame (only telegraphed enemy monster casts matter). */
  noteEvent(ev: GameEvent): void {
    if (ev.type !== 'skillCast' || ev.team !== 'enemy' || !(ev.delay != null && ev.delay > 0)) return;
    this.casts.push({ key: `${ev.sourceId}|${ev.skillId}`, cx: ev.center.x, cy: ev.center.y, shape: ev.area.shape, used: false });
  }

  /** Once per drawn frame, after the frame's events: group new telegraphs, refresh which part is next. */
  track(teles: readonly Telegraph[]): void {
    const stamp = ++this.stamp;
    let fresh: { t: Telegraph; key: string }[] | null = null;
    for (const t of teles) {
      if (t.team !== 'enemy') continue;
      this.liveStamp.set(t.id, stamp);
      if (this.seen.has(t.id)) continue;
      this.seen.add(t.id);
      const c = this.casts.find(k => !k.used && k.shape === t.area.shape && Math.abs(k.cx - t.center.x) < 1e-3 && Math.abs(k.cy - t.center.y) < 1e-3);
      if (!c) continue;
      c.used = true;
      (fresh ??= []).push({ t, key: c.key });
    }
    this.casts.length = 0;
    if (fresh) {
      const byKey = new Map<string, Telegraph[]>();
      for (const f of fresh) {
        const list = byKey.get(f.key);
        if (list) list.push(f.t);
        else byKey.set(f.key, [f.t]);
      }
      byKey.forEach(list => {
        if (list.length < 2) return;
        list.sort((a, b) => a.remaining - b.remaining || a.id - b.id);
        const g: Group = { id: this.nextId++, ids: list.map(t => t.id), order: new Map(), min: 0, live: 0 };
        let rank = 0;
        let prev = -Infinity;
        for (const t of list) {
          if (t.remaining - prev > SAME_STEP) rank++;
          prev = t.remaining;
          g.order.set(t.id, rank);
          this.groupOf.set(t.id, g);
        }
        this.groups.push(g);
      });
    }
    // which part is next, per group; forget gone telegraphs / groups
    for (const g of this.groups) {
      g.min = Infinity;
      g.live = 0;
    }
    for (const t of teles) {
      const g = this.groupOf.get(t.id);
      if (!g) continue;
      g.live++;
      if (t.remaining < g.min) g.min = t.remaining;
    }
    for (let i = this.groups.length - 1; i >= 0; i--) {
      const g = this.groups[i];
      if (g.live > 0) continue;
      for (const id of g.ids) this.groupOf.delete(id);
      this.groups.splice(i, 1);
    }
    if (this.seen.size > 64) {
      this.seen.forEach(id => {
        if (this.liveStamp.get(id) !== stamp) {
          this.seen.delete(id);
          this.liveStamp.delete(id);
        }
      });
    }
  }

  /** Sequence info of an enemy telegraph that belongs to a multi-part cast (null = a lone telegraph). */
  info(t: Telegraph, out: TeleSeqInfo): TeleSeqInfo | null {
    const g = this.groupOf.get(t.id);
    if (!g || g.live < 1) return null;
    out.order = g.order.get(t.id) ?? 1;
    out.count = g.order.get(g.ids[g.ids.length - 1]) ?? g.ids.length;
    out.next = t.remaining <= g.min + SAME_STEP;
    out.group = g.id;
    return out;
  }

  reset(): void {
    this.casts.length = 0;
    this.seen.clear();
    this.groupOf.clear();
    this.groups.length = 0;
    this.liveStamp.clear();
  }
}
