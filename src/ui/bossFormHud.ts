// 기획 20차 보스 형태 HUD (docs/bosses.md 1장 · 3장 N5 · N6): what the HUD adds for bosses that move.
//   · the name tag over a moving boss (「보스」 chip that follows its head; the whole name for a moment after the floor
//     starts, after it jumps to another place and while a card is dragged) — a small body is found at once on a phone
//   · the form line of the floor banner / the boss box / the pause screen ('배회형 · 맵을 걸어 다녀요 …')
//   · which card is marked (rule N6: a Telegraph.mark on my field character → 「교체!」 on its card)
//   · the one-line pattern tips of a raid (MonsterSkill.hint) in their own slot under the boss box
// 기획 20차 점검 (the phone review): the tips left the 1.5 s toast stack — one tip at a time, on screen for the length of
// the warning + 2.5 s (at least 4 s), also while a card is dragged, on the first two casts of a pattern; the 「뒤!」 /
// 「막힘」 pops over the boss are gone (my own hits say it on their damage number: render/vfx.ts); a tag the top HUD
// row would push down onto the body hangs beside the body; a boss that leaves fakes (BossDef.decoy) shows no tag for
// a few seconds after it jumped; the whole name waits for the floor banner to leave.
// Hud (hud.ts) owns the DOM around it and calls onEvent() / update(). The pure helpers are tested in
// tests/ui/boss-form-hud.test.ts.

import type { BossDef, BossForm, GameEvent, GameState, Vec2 } from '../types';
import { LOGICAL_W } from '../types';
import { getBoss } from '../data';
import { BOSS_FORM_LABEL, BOSS_FORM_TIP, GUARD_HIT_TEXT } from '../data/bosses/forms';
import { PX_PER_UNIT } from '../render/camera';
import { bossBody } from '../render/bosses/body';
import { h, replayClass, setClass, setStyle, setText, show } from './dom';

/** The tag shows the whole boss name this long after the floor starts / after the boss jumped. */
const TAG_STRONG_MS = 2600;
/** A move of this many cells between two HUD updates is a jump (relocate, dive, rush): the tag snaps and lights up. */
const TAG_JUMP = 1.5;
/** Logical px between the head of the body and the tag (the canvas draws its ▼ in this gap). */
const TAG_GAP = 40;
/** The tag never climbs into the top HUD row (player panels, timer) … */
const TAG_TOP = 118;
/** … stays under the boss box with its pattern pill in the middle of the screen (logical x from – to) … */
const TAG_TOP_MID = 138;
const TAG_MID = { from: 400, to: 960 };
/** … under a pattern tip (the slot under the boss box) while one shows … */
const TAG_TOP_TIP = 218;
/** … and on the left under the status chips the two player panels hang (logical x up to here, y down to here). */
const TAG_LEFT = { to: 440, top: 150 };
/** A tag hung beside the body: px between the body's edge and the tag, and how far under the top limit its foot is. */
const TAG_SIDE_GAP = 10;
const TAG_SIDE_DROP = 34;
const TAG_EDGE = 70;
/** A flat body (the moon's reflection) has no height: its tag floats this far over the centre. */
const FLAT_HEAD = 56;
/** 「뒤!」 / 「막힘」 — the words on my own damage numbers (render/vfx.ts draws them; kept here for the HUD tests). */
export const GUARD_POP_TEXT = GUARD_HIT_TEXT;

// ── pattern tips (기획 20차 점검) ──
/** A tip stays this long after its warning landed, and never less than TIP_MIN_MS. */
const TIP_AFTER_MS = 2500;
const TIP_MIN_MS = 4000;
/** A newer tip waits until the one showing has been up this long (then it replaces it). */
const TIP_READ_MS = 2500;
/** A pattern's tip is said on its first N casts of a run. */
export const TIP_REPEAT = 2;
/** At most this many tips wait behind the one showing (the oldest waiting one is dropped). */
const TIP_QUEUE = 2;
/** The first N tips of a run also say where they can be read again. */
const TIP_MORE = 2;
export const TIP_MORE_TEXT = '⚙ 일시정지 화면에서 다시 볼 수 있어요';
/** Parts of one cast arrive within this many sim seconds of each other. */
const SAME_CAST = 0.2;

/** How long a tip shows for a warning of `warnSec` seconds. */
export function tipShowMs(warnSec: number): number {
  return Math.max(TIP_MIN_MS, Math.round(Math.max(0, warnSec) * 1000) + TIP_AFTER_MS);
}

export interface TipItem {
  id: string;
  name: string;
  text: string;
  ms: number;
}

/**
 * Which tip shows when (no DOM — tested in tests/ui/boss-form-hud.test.ts). cast() = a part of a boss pattern with a
 * tip was cast at sim time `simTime`; pump(now) = the item to show now (a new one), 'hide', or null = no change.
 */
export class TipQueue {
  private readonly count = new Map<string, number>();
  private readonly castAt = new Map<string, number>();
  private waiting: TipItem[] = [];
  private current: TipItem | null = null;
  private shownAt = 0;
  private until = 0;

  /** True when this cast's tip was taken (one of the first TIP_REPEAT casts; other parts of the same cast only stretch it). */
  cast(id: string, name: string, text: string, warnSec: number, simTime: number): boolean {
    const ms = tipShowMs(warnSec);
    const last = this.castAt.get(id);
    if (last != null && Math.abs(simTime - last) < SAME_CAST) {
      if (this.current?.id === id) this.until = Math.max(this.until, this.shownAt + ms);
      for (const w of this.waiting) if (w.id === id) w.ms = Math.max(w.ms, ms);
      return false;
    }
    const n = this.count.get(id) ?? 0;
    if (n >= TIP_REPEAT) return false;
    this.count.set(id, n + 1);
    this.castAt.set(id, simTime);
    this.waiting.push({ id, name, text, ms });
    while (this.waiting.length > TIP_QUEUE) this.waiting.shift();
    return true;
  }

  pump(now: number): TipItem | 'hide' | null {
    if (this.waiting.length > 0 && (!this.current || now - this.shownAt >= TIP_READ_MS)) {
      this.current = this.waiting.shift()!;
      this.shownAt = now;
      this.until = now + this.current.ms;
      return this.current;
    }
    if (this.current && now >= this.until) {
      this.current = null;
      return 'hide';
    }
    return null;
  }

  get showing(): boolean {
    return this.current != null;
  }

  /** A new floor: nothing shows, nothing waits, sim time starts over (the per-run counts stay). */
  floor(): void {
    this.waiting = [];
    this.current = null;
    this.castAt.clear();
  }
}
/** The badge on the card of a marked field character (rule N6). */
export const MARK_CARD_TEXT = '교체!';

function bossDef(id: string | undefined): BossDef | null {
  if (!id) return null;
  try {
    return getBoss(id);
  } catch {
    return null;
  }
}

/** The form of a boss by id ('fixed' for the classic four and for unknown ids). */
export function bossFormOfId(id: string | undefined): BossForm {
  return bossDef(id)?.form ?? 'fixed';
}

/** '배회형' … for a boss id. */
export function bossFormLabel(id: string | undefined): string {
  return BOSS_FORM_LABEL[bossFormOfId(id)];
}

/** One line for the floor banner and the pause screen: '배회형 · 맵을 걸어 다녀요 — 탱커 도발이 통해요'. '' for an unknown boss. */
export function bossFormLine(id: string | undefined): string {
  if (!bossDef(id)) return '';
  const f = bossFormOfId(id);
  return `${BOSS_FORM_LABEL[f]} · ${BOSS_FORM_TIP[f]}`;
}

export interface PatternTip {
  id: string;
  name: string;
  hint: string;
  /** The boss's signature pattern (BossDef.signature). */
  signature: boolean;
}

/** Every pattern of a boss that has a tip (phase patterns too), the signature first. */
export function bossPatternTips(id: string | undefined): PatternTip[] {
  const def = bossDef(id);
  if (!def) return [];
  const all = [...def.skills, ...(def.phases ?? []).flatMap(p => p.skills ?? [])];
  const tips = all.filter(sk => !!sk.hint).map(sk => ({ id: sk.id, name: sk.name, hint: sk.hint!, signature: sk.id === def.signature }));
  return [...tips.filter(t => t.signature), ...tips.filter(t => !t.signature)];
}

/** Is `entityId` (my field character) the unit a mark is tied to right now (rule N6)? */
export function isMarked(s: Pick<GameState, 'telegraphs'>, entityId: number | null): boolean {
  return entityId != null && s.telegraphs.some(t => t.team === 'enemy' && t.mark === entityId);
}

export interface TagOpts {
  /** A pattern tip is showing: the middle of the screen is taken further down. */
  tip?: boolean;
  /** Body and tag width in px — with them, a tag that would be pushed down onto the body hangs beside it instead. */
  bodyW?: number;
  tagW?: number;
}

/**
 * Where the tag stands (logical px, its bottom centre) for a boss whose feet are at `foot` on screen: over the head; when
 * the top HUD row leaves no room there, beside the body (on the side away from the nearer wall) — never on the body.
 */
export function tagAnchor(foot: Vec2, bodyHeightPx: number, flat: boolean, o: TagOpts = {}): Vec2 {
  const head = flat ? foot.y - FLAT_HEAD : foot.y - bodyHeightPx;
  const x = Math.max(TAG_EDGE, Math.min(LOGICAL_W - TAG_EDGE, foot.x));
  const mid = x >= TAG_MID.from && x <= TAG_MID.to;
  const top = mid ? (o.tip ? TAG_TOP_TIP : TAG_TOP_MID) : o.bodyW && x < TAG_LEFT.to ? TAG_LEFT.top : TAG_TOP;
  const want = head - TAG_GAP;
  if (want >= top || flat || !o.bodyW) return { x, y: Math.max(top, want) };
  const side = foot.x < LOGICAL_W / 2 ? 1 : -1;
  const half = (o.tagW ?? 90) / 2;
  const sx = Math.max(half + 6, Math.min(LOGICAL_W - half - 6, foot.x + side * (o.bodyW / 2 + half + TAG_SIDE_GAP)));
  // hung toward the middle it may reach under the tip slot: then it goes below the tip
  const underTip = !!o.tip && sx + half > TAG_MID.from && sx - half < TAG_MID.to;
  return { x: sx, y: Math.max((underTip ? TAG_TOP_TIP : top) + TAG_SIDE_DROP, foot.y - bodyHeightPx * 0.55) };
}

export interface BossFormHudDeps {
  root: HTMLElement;
  /** World → logical screen px (the renderer's camera); null in tests / before the first frame. */
  locate: ((world: Vec2) => Vec2) | null;
  /** A card is being dragged (the tag lights up: the player is choosing where to drop). */
  dragging(): boolean;
  /** Ms the floor banner covers the arena after a raid floor starts (the whole name shows once it is gone). */
  bannerMs?: number;
}

export class BossFormHud {
  private readonly d: BossFormHudDeps;
  private readonly tag: HTMLElement;
  private readonly tagName: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly tipName: HTMLElement;
  private readonly tipText: HTMLElement;
  private readonly tipMore: HTMLElement;
  /** Pattern tips of this run (the HUD is rebuilt per run). */
  private readonly tips = new TipQueue();
  private tipsSaid = 0;
  private strongUntil = 0;
  /** A boss that leaves fakes: no tag until this time (it has just jumped — BossDef.decoy). */
  private hideUntil = 0;
  private lastPos: Vec2 | null = null;
  private lastBoss = '';

  constructor(d: BossFormHudDeps) {
    this.d = d;
    this.tag = h('div', 'boss-tag is-hidden', d.root);
    h('span', 'boss-tag-k', this.tag, '보스');
    this.tagName = h('span', 'boss-tag-n', this.tag);
    this.tip = h('div', 'raid-tip is-hidden', d.root);
    const row = h('div', 'raid-tip-row', this.tip);
    this.tipName = h('span', 'raid-tip-k', row);
    this.tipText = h('span', 'raid-tip-t', row);
    this.tipMore = h('div', 'raid-tip-more is-hidden', this.tip, TIP_MORE_TEXT);
  }

  /**
   * A part of a raid pattern that has a tip was cast (`warnSec` = its warning, `simTime` = GameState.time). The tip
   * shows in its own slot on the first TIP_REPEAT casts of the pattern. Returns whether this cast's tip was taken.
   */
  patternTip(skillId: string, name: string, hint: string, warnSec: number, simTime: number): boolean {
    const taken = this.tips.cast(skillId, name, hint, warnSec, simTime);
    this.pumpTips(simTime);
    return taken;
  }

  /** The slot runs on GAME time (a paused game keeps its tip, the debug game speed keeps tips in step with the fight). */
  private pumpTips(simTime: number): void {
    const next = this.tips.pump(simTime * 1000);
    if (next === 'hide') show(this.tip, false);
    else if (next) {
      setText(this.tipName, next.name);
      setText(this.tipText, next.text);
      show(this.tipMore, this.tipsSaid < TIP_MORE);
      this.tipsSaid++;
      show(this.tip, true);
      replayClass(this.tip, 'is-new');
    }
  }

  onEvent(_s: GameState, e: GameEvent): void {
    if (e.type !== 'floorStart') return;
    // the whole name is for after the floor banner (it lies over the place most moving bosses appear)
    this.strongUntil = performance.now() + (this.d.bannerMs ?? 0) + TAG_STRONG_MS;
    this.hideUntil = 0;
    this.lastPos = null;
    this.tips.floor();
    show(this.tip, false);
  }

  /** Per HUD update (~30 Hz): the tip slot runs its queue; the tag follows the moving boss. */
  update(s: GameState): void {
    if (s.phase !== 'combat' && this.tips.showing) {
      this.tips.floor();
      show(this.tip, false);
    } else this.pumpTips(s.time);
    const boss = s.phase === 'combat' && s.bossId != null ? s.entities.find(e => e.id === s.bossId) : undefined;
    const form = boss ? bossFormOfId(boss.defId) : 'fixed';
    const alive = !!boss && boss.hp > 0 && form !== 'fixed' && !!this.d.locate;
    if (!alive || !boss || !this.d.locate) {
      show(this.tag, false);
      this.lastPos = null;
      return;
    }
    const def = bossDef(boss.defId);
    if (boss.defId !== this.lastBoss) {
      this.lastBoss = boss.defId;
      setText(this.tagName, def?.name ?? '');
      this.tag.dataset.form = form;
    }
    const now = performance.now();
    const jumped = !!this.lastPos && Math.hypot(boss.pos.x - this.lastPos.x, boss.pos.y - this.lastPos.y) >= TAG_JUMP;
    if (jumped) {
      // 가짜 찾기: with a fake standing, the jump is not announced — no flash, no name, no tag at all for a moment
      const decoy = def?.decoy;
      if (decoy && s.entities.some(e => e.defId === decoy.unit && e.hp > 0)) {
        this.hideUntil = now + decoy.hide * 1000;
        this.strongUntil = 0;
      } else {
        this.strongUntil = now + TAG_STRONG_MS;
        replayClass(this.tag, 'is-pop');
      }
    }
    const hidden = now < this.hideUntil;
    show(this.tag, !hidden);
    // a jump snaps (no glide across the arena); a walk glides between two HUD updates
    setClass(this.tag, 'is-snap', jumped || !this.lastPos);
    this.lastPos = { x: boss.pos.x, y: boss.pos.y };
    if (hidden) return;
    const body = bossBody(boss.defId);
    const foot = this.d.locate(boss.pos);
    if (!Number.isFinite(foot.x) || !Number.isFinite(foot.y)) return;
    // while a card is dragged the name helps aim the drop — but never while the boss hides among its fakes
    setClass(this.tag, 'is-strong', now < this.strongUntil || this.d.dragging());
    const at = tagAnchor(foot, body.h * PX_PER_UNIT, !!body.flat, { tip: this.tips.showing, bodyW: body.w * PX_PER_UNIT, tagW: this.tag.offsetWidth || undefined });
    setStyle(this.tag, 'transform', `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -100%)`);
  }
}
