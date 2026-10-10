// 기획 17차 전투 중 발동 표시 (docs/floor-rewards.md 그 밖의 화면 규칙): a floor reward that fired puts a small pill
// with its tag icons (no words) over that character for 0.9 s. Procs within 0.25 s merge (≤ 3 icons + '+N'); one pill
// per unit, 4 on screen, the same reward on one unit at most every 2 s. Only over MY characters — a co-op effect another
// player gave me gets that player's colour as the border. Under a 「저스트!」 stamp it waits 0.3 s and sits lower.

import type { GameEvent, GameState, Role, SynergyTag } from '../types';
import { RELIC_TAGS, ROLE_TAGS, TAG_INFO, getCharacter, getFamily, hasFamily } from '../data';
import { Camera } from './camera';
import { boldFont } from './look';
import { bodyHeight, bodyTop, bodyWidth, type UnitMemo } from './units';

export const PILL = { dur: 0.9, merge: 0.25, maxIcons: 3, maxOnScreen: 4, sameGap: 2, justDelay: 0.3 } as const;

/** Tag icons of a proc (family key; 「직업 특기」 by the unit's role; relic ids by RELIC_TAGS). PURE. */
export function procTags(rewardId: string, role: Role | null): SynergyTag[] {
  if (rewardId === 'role') return role ? [...ROLE_TAGS[role]] : [];
  if (hasFamily(rewardId)) return [...getFamily(rewardId).tags];
  const r = RELIC_TAGS[rewardId];
  return r ? [r] : [];
}

export interface Pill {
  entityId: number;
  tags: SynergyTag[];
  /** Procs merged past the icon cap. */
  extra: number;
  /** Seconds since it showed (negative = waiting under a stamp). */
  age: number;
  /** Border: '' = mine, else the giving player's colour. */
  giver: string;
  low: boolean;
  x: number;
  y: number;
}

/** A screen box a pill must not sit on (a skill callout after its layout pass): centre x, top / bottom y, width. */
export interface PillAvoid {
  x: number;
  top: number;
  bottom: number;
  w: number;
}

/** Pill gap to a callout it moved off (px) and the highest it may go (under the top HUD row). */
const AVOID_GAP = 3;
const PILL_MIN_Y = 150;

/**
 * 기획 17차 리뷰: move a pill (centre x, y; size w × h) off every callout box it overlaps — above the callout, or below
 * it when there is no room above (moves only up, then once out of room only down, so it settles). PURE.
 */
export function placePill(x: number, y: number, w: number, h: number, avoid: readonly PillAvoid[]): number {
  let down = false;
  for (let guard = 0; guard < 8; guard++) {
    const hit = avoid.find(a => Math.abs(a.x - x) < (a.w + w) / 2 + 4 && y - h / 2 < a.bottom + AVOID_GAP && a.top - AVOID_GAP < y + h / 2);
    if (!hit) break;
    const up = hit.top - AVOID_GAP - h / 2;
    if (!down && up >= PILL_MIN_Y) y = up;
    else {
      down = true;
      y = hit.bottom + AVOID_GAP + h / 2;
    }
  }
  return y;
}

export class RewardPills {
  pills: Pill[] = [];
  /** `${entity}|${reward}` → clock of the last proc shown. */
  private readonly last = new Map<string, number>();
  private clock = 0;

  reset(): void {
    this.pills = [];
    this.last.clear();
  }

  /** stamped: a 「저스트!」 stamp is up on that unit. */
  handle(ev: GameEvent, s: GameState, local: number, stamped: (entityId: number) => boolean): void {
    if (ev.type !== 'rewardProc') return;
    const id = ev.entityId ?? memberEntity(s, ev.player, ev.partyIndex);
    if (id == null) return;
    const e = s.entities.find(x => x.id === id);
    if (!e || e.kind !== 'character' || e.ownerPlayer !== local) return;
    const key = `${id}|${ev.rewardId}`;
    const prev = this.last.get(key);
    if (prev != null && this.clock - prev < PILL.sameGap) return;
    let role: Role | null = null;
    try {
      role = getCharacter(e.defId).role;
    } catch {
      role = null;
    }
    const tags = procTags(ev.rewardId, role);
    if (!tags.length) return;
    this.last.set(key, this.clock);
    const giver = ev.player !== local ? (s.players[ev.player]?.color ?? '#ffffff') : '';
    const old = this.pills.find(p => p.entityId === id);
    if (old && old.age < PILL.merge) {
      for (const t of tags) if (!old.tags.includes(t)) old.tags.length < PILL.maxIcons ? old.tags.push(t) : old.extra++;
      if (giver) old.giver = giver;
      return;
    }
    if (old) this.pills.splice(this.pills.indexOf(old), 1);
    if (this.pills.length >= PILL.maxOnScreen) return;
    const low = stamped(id);
    this.pills.push({ entityId: id, tags: tags.slice(0, PILL.maxIcons), extra: Math.max(0, tags.length - PILL.maxIcons), age: low ? -PILL.justDelay : 0, giver, low, x: e.pos.x, y: e.pos.y });
  }

  update(dt: number, s: GameState): void {
    this.clock += dt;
    for (const p of this.pills) {
      p.age += dt;
      const e = s.entities.find(x => x.id === p.entityId);
      if (e) {
        p.x = e.pos.x;
        p.y = e.pos.y;
      }
    }
    this.pills = this.pills.filter(p => p.age < PILL.dur);
    if (this.last.size > 200) for (const [k, t] of this.last) if (this.clock - t > PILL.sameGap) this.last.delete(k);
  }

  /** avoid: the skill callouts on screen (a swap's procs fire as the drag name shows — the name stays readable). */
  draw(c: CanvasRenderingContext2D, cam: Camera, memos: ReadonlyMap<number, UnitMemo>, avoid: readonly PillAvoid[] = []): void {
    for (const p of this.pills) {
      if (p.age < 0) continue;
      const m = memos.get(p.entityId);
      const top = m ? bodyTop(m.look, m.tier, bodyHeight(m.look, m.radius), bodyWidth(m.radius)) : 50;
      const pop = Math.min(1, p.age / 0.1);
      const fade = p.age > PILL.dur - 0.2 ? Math.max(0, (PILL.dur - p.age) / 0.2) : 1;
      const icon = 20;
      const n = p.tags.length + (p.extra > 0 ? 1 : 0);
      const w = n * icon + 10;
      const h = 24;
      const x = cam.sx(p.x);
      // above the head (clear of the HP bar and name tag); under a 저스트 stamp: lower, beside the body
      const y0 = Math.max(PILL_MIN_Y, p.low ? cam.sy(p.y) - top * 0.45 : cam.sy(p.y) - top - 64 - p.age * 10);
      const y = avoid.length ? placePill(x, y0, w, h, avoid) : y0;
      c.save();
      c.globalAlpha = fade;
      c.translate(x, y);
      c.scale(0.7 + 0.3 * pop, 0.7 + 0.3 * pop);
      c.beginPath();
      c.roundRect(-w / 2, -h / 2, w, h, h / 2);
      c.fillStyle = 'rgba(14,16,26,0.86)';
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = p.giver || 'rgba(255,255,255,0.55)';
      c.stroke();
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = boldFont(15);
      let cx = -w / 2 + 5 + icon / 2;
      for (const t of p.tags) {
        c.fillStyle = TAG_INFO[t].color;
        c.fillText(TAG_INFO[t].glyph, cx, 1);
        cx += icon;
      }
      if (p.extra > 0) {
        c.font = boldFont(12);
        c.fillStyle = '#ffffff';
        c.fillText(`+${p.extra}`, cx, 1);
      }
      c.restore();
    }
  }
}

function memberEntity(s: GameState, player: number, idx: number | null): number | null {
  if (idx == null) return null;
  return s.players[player]?.party[idx]?.entityId ?? null;
}
