// 괴담 방 「이상한 방」 (기획 10차, docs/goedam-rooms.md 6장): phase 'goedam' → my options → result card → 계속.
// Drawn only from state.goedam + the data text functions (src/data/goedam.ts): a late snapshot or a reconnect redraws the
// same screen, just without the reveal animation. Multiplayer: the room deadline, the others' picks after mine, a wait panel.

import type { CommandResult, GameState, GoedamProgress, GoedamState, PlayerState } from '../types';
import { zoneOf } from '../config';
import {
  GOEDAM_USUAL,
  getGoedamOption,
  getGoedamRoom,
  getGoedamTrace,
  goedamObservation,
  goedamOptionView,
  goedamResultView,
  goedamRoomDesc,
  goedamTraceDuration,
  goedamTraceKind,
  type GoedamLine,
  type GoedamOptionView,
} from '../data';
import { button, h, setClass, setText, show } from './dom';
import { goedamOptionKind, goedamOtherRow, goedamTagLabel, goedamTimerText, goedamWaitText } from './format';

export interface GoedamView {
  localPlayer: number;
  multi: boolean;
  /** Room deadline on the local clock (Date.now() ms), null = none (solo). */
  deadline: number | null;
}

export interface GoedamCallbacks {
  /** Send {type:'goedam', option}; option is an option id or 'continue'. */
  onChoose(option: string): CommandResult;
  onMenu(): void;
}

/** The light flickers this long between my pick and the result card (show only: the result is already fixed). */
const REVEAL_MS = 600;
/**
 * The option buttons take taps only this long after the room shows: the room opens on the same tick as the last reward
 * pick, so a double-tap on a reward card would otherwise land on an option nobody read (picks cannot be undone).
 */
const ARM_MS = 450;
/** A pick with no answer for this long unlocks the buttons again (a lost message; the sim refuses a second pick). */
const PENDING_MS = 4000;
/** Details longer than this (relic / card descriptions) get their own line under the effect. */
const DETAIL_TAIL_MAX = 20;
/** Rooms whose wrong-floor chip glitches to 'F½' (the elevator shows the floor that is not there). */
const GLITCH_ROOMS = new Set(['elevator_whisper']);

/** 96 px room symbols (inline SVG, no files: the artifact build has none). `.hot` parts glow in the zone tint. */
const ROOM_ART: Record<string, string> = {
  broken_vending:
    '<rect x="14" y="5" width="36" height="54" rx="4"/><rect x="19" y="11" width="19" height="26" rx="2"/><path d="M22 17h13M22 23h13M22 29h13"/><circle class="hot" cx="44" cy="15" r="3"/><rect class="hot" x="21" y="45" width="22" height="6" rx="2"/>',
  elevator_whisper:
    '<rect x="10" y="10" width="44" height="50" rx="2"/><path d="M32 10v50"/><path d="M24 4l4-3 4 3M36 1l4 3 4-3"/><rect class="hot" x="44" y="24" width="8" height="10" rx="2"/>',
  ringing_phone:
    '<rect x="16" y="6" width="32" height="52" rx="5"/><path class="hot" d="M22 14c0-3 4-5 10-5s10 2 10 5l-3 4h-14z"/><path d="M24 26h4M30 26h4M36 26h4M24 33h4M30 33h4M36 33h4M24 40h4M30 40h4M36 40h4"/><path d="M6 14c-3 4-3 10 0 14M58 14c3 4 3 10 0 14"/>',
  overtime_roster:
    '<rect x="12" y="10" width="36" height="48" rx="3"/><rect x="22" y="5" width="16" height="8" rx="2"/><path d="M18 22h22M18 30h22M18 38h22M18 46h12"/><circle class="hot" cx="48" cy="46" r="10"/><path d="M48 40v6l4 3"/>',
  copier:
    '<rect x="8" y="22" width="48" height="26" rx="4"/><path d="M16 22V8h32v14"/><rect class="hot" x="16" y="40" width="32" height="18" rx="1"/><circle cx="21" cy="47" r="2.5"/><circle cx="31" cy="47" r="2.5"/><path d="M38 50l3-3 3 3"/>',
  endless_corridor:
    '<path d="M4 4l20 20h16L60 4M4 60l20-20h16l20 20M24 24v16M40 24v16"/><rect class="hot" x="28" y="27" width="8" height="13"/><path d="M9 20v20M55 20v20"/>',
  red_blue_paper:
    '<rect x="8" y="14" width="22" height="34" rx="4" fill="#d6283c"/><rect x="34" y="14" width="22" height="34" rx="4" fill="#2864d6"/><ellipse cx="19" cy="14" rx="11" ry="4"/><ellipse cx="45" cy="14" rx="11" ry="4"/><path class="hot" d="M30 52c0 4 4 6 4 6"/>',
  night_rounds:
    '<path d="M18 44V30a14 14 0 0 1 28 0v14l4 6H14z"/><path class="hot" d="M27 52a5 5 0 0 0 10 0"/><path d="M32 10v6M6 24l6 3M58 24l-6 3"/>',
  iv_drip:
    '<path d="M32 2v6"/><rect x="18" y="8" width="28" height="28" rx="6"/><path class="hot" d="M22 22h20v8a6 6 0 0 1-6 6h-8a6 6 0 0 1-6-6z"/><path d="M32 36v10"/><path class="hot" d="M32 50c-3 4-3 6 0 8 3-2 3-4 0-8z"/>',
  sky_eye:
    '<path d="M2 32c8-14 20-20 30-20s22 6 30 20c-8 14-20 20-30 20S10 46 2 32z"/><circle class="hot" cx="32" cy="32" r="11"/><circle cx="32" cy="32" r="4" fill="currentColor"/><path d="M10 14l4 5M54 14l-4 5M32 4v6"/>',
  red_mask:
    '<path d="M14 12c0-6 36-6 36 0v14c0 4-4 6-8 6H22c-4 0-8-2-8-6z"/><path class="hot" d="M16 32h32l-4 16c-2 6-22 6-24 0z"/><path d="M16 36L4 30M48 36l12-6"/><circle cx="24" cy="20" r="2" fill="currentColor"/><circle cx="40" cy="20" r="2" fill="currentColor"/>',
  cursed_relic:
    '<rect x="8" y="22" width="48" height="34" rx="3"/><path d="M8 32h48M14 22l4-12h28l4 12"/><rect class="hot" x="20" y="18" width="8" height="30" rx="1"/><rect class="hot" x="36" y="18" width="8" height="30" rx="1"/>',
};

interface PendingPick {
  option: string;
  at: number;
}

export class GoedamScreen {
  readonly el: HTMLElement;
  private readonly cb: GoedamCallbacks;
  // top strip
  private readonly floorChip: HTMLElement;
  private readonly players: HTMLElement;
  private readonly timer: HTMLElement;
  // left column
  private readonly art: HTMLElement;
  private readonly name: HTMLElement;
  private readonly desc: HTMLElement;
  private readonly note: HTMLElement;
  private readonly seen: HTMLElement;
  // right column
  private readonly options: HTMLElement;
  private readonly card: HTMLElement;
  private readonly others: HTMLElement;
  private readonly wait: HTMLElement;
  private readonly waitText: HTMLElement;
  private readonly error: HTMLElement;
  private contBtn: HTMLButtonElement | null = null;
  private roomKey = '';
  private optionsKey = '';
  private cardKey = '';
  private othersKey = '';
  private playersKey = '';
  /** My pick / 계속 sent and not answered yet (buttons locked, '…'). */
  private pending: PendingPick | null = null;
  private contPending: PendingPick | null = null;
  /** performance.now() when the result card may show after my own pick (null = show it at once, no animation). */
  private revealAt: number | null = null;
  private animateCard = false;
  /** performance.now() from which the option buttons take taps (see ARM_MS). */
  private armAt = 0;

  constructor(parent: HTMLElement, cb: GoedamCallbacks) {
    this.cb = cb;
    this.el = h('div', 'screen goedam is-hidden', parent);
    const strip = h('div', 'gd-strip', this.el);
    this.floorChip = h('div', 'gd-floor', strip);
    this.players = h('div', 'gd-players', strip);
    this.timer = h('div', 'gd-timer is-hidden', strip);
    const menu = button('gd-menu', '❚❚', strip, () => this.cb.onMenu());
    menu.setAttribute('aria-label', '메뉴');

    const body = h('div', 'gd-body', this.el);
    const left = h('div', 'gd-left', body);
    const head = h('div', 'gd-head', left);
    this.art = h('div', 'gd-art', head);
    this.name = h('div', 'gd-name', head);
    this.desc = h('div', 'gd-desc', left);
    this.note = h('div', 'gd-note is-hidden', left);
    this.seen = h('div', 'gd-seen is-hidden', left);

    const right = h('div', 'gd-right', body);
    this.options = h('div', 'gd-options', right);
    this.card = h('div', 'gd-card is-hidden', right);
    this.others = h('div', 'gd-others is-hidden', right);
    this.wait = h('div', 'gd-wait is-hidden', right);
    h('div', 'rw-wait-spin', this.wait);
    this.waitText = h('div', 'gd-wait-text', this.wait);
    this.error = h('div', 'gd-error is-hidden', right);
  }

  get visible(): boolean {
    return !this.el.classList.contains('is-hidden');
  }

  /** The server refused my pick / 계속 (multiplayer): unlock and say why, inside the screen (the HUD is covered). */
  refuse(reason: string): void {
    this.pending = null;
    this.contPending = null;
    this.optionsKey = '';
    this.showError(reason);
  }

  hide(): void {
    show(this.el, false);
    this.roomKey = '';
    this.pending = null;
    this.contPending = null;
    this.revealAt = null;
  }

  update(s: GameState, view: GoedamView): void {
    const g = s.phase === 'goedam' ? s.goedam : null;
    const pr = g?.players[view.localPlayer];
    const me = s.players[view.localPlayer];
    if (!g || !pr || !me) {
      if (this.visible || this.roomKey) this.hide();
      return;
    }
    show(this.el, true);
    const key = `${g.floor}|${g.roomId}`;
    if (key !== this.roomKey) this.openRoom(g, pr, key);
    this.updateStrip(s, g, view);
    const now = performance.now();
    if (pr.stage === 'choosing') {
      if (this.pending && now - this.pending.at > PENDING_MS) {
        this.pending = null;
        this.optionsKey = '';
      }
      this.showOptions(g, pr, me, false, now < this.armAt);
      return;
    }
    // my own pick just resolved: keep the picked button up while the light flickers, then the card
    if (this.pending) {
      this.pending = null;
      this.revealAt = now + REVEAL_MS;
      this.animateCard = true;
    }
    if (this.revealAt != null && now < this.revealAt) {
      this.showOptions(g, pr, me, true, false);
      return;
    }
    this.revealAt = null;
    setClass(this.el, 'is-flicker', false);
    this.showCard(s, g, pr, me, view);
  }

  // ─────────────────────────── room (left column) ───────────────────────────

  private openRoom(g: GoedamState, pr: GoedamProgress, key: string): void {
    this.roomKey = key;
    this.optionsKey = '';
    this.cardKey = '';
    this.othersKey = '';
    this.playersKey = '';
    this.pending = null;
    this.contPending = null;
    this.revealAt = null;
    this.animateCard = false;
    this.armAt = performance.now() + ARM_MS;
    this.showError(null);
    const room = getGoedamRoom(g.roomId);
    const zone = zoneOf(g.floor);
    this.el.dataset.zone = zone.theme;
    this.el.dataset.room = room.id;
    // wrong-floor chip: '3½층 · 로비·상가층' (the elevator's own label glitches to 'F½')
    this.floorChip.replaceChildren();
    const label = h('span', 'gd-floor-n', this.floorChip, g.label);
    if (GLITCH_ROOMS.has(room.id)) {
      label.classList.add('is-glitch');
      label.dataset.glitch = 'F½';
    }
    h('span', 'gd-floor-z', this.floorChip, `· ${zone.name}`);
    const art = ROOM_ART[room.id];
    if (art) this.art.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true">${art}</svg>`;
    else this.art.textContent = room.icon;
    setText(this.name, room.name);
    setText(this.desc, goedamRoomDesc(room, g.floor));
    // the rule note is the only place rules live (기획 6장): the corridor adds 「평소」 under it
    const corridor = pr.params.anomaly !== undefined;
    this.note.replaceChildren();
    show(this.note, !!room.rule);
    if (room.rule) {
      h('div', 'gd-note-rule', this.note, room.rule);
      if (corridor) h('div', 'gd-note-usual', this.note, `평소: ${GOEDAM_USUAL}`);
    }
    this.seen.replaceChildren();
    show(this.seen, corridor);
    if (corridor) {
      h('span', 'gd-seen-k', this.seen, '지금 보이는 것');
      h('span', 'gd-seen-v', this.seen, goedamObservation(pr.params.anomaly));
    }
    show(this.card, false);
    show(this.options, true);
  }

  // ─────────────────────────── top strip ───────────────────────────

  private updateStrip(s: GameState, g: GoedamState, view: GoedamView): void {
    const pr = g.players[view.localPlayer];
    // countdown (server room deadline: '그냥 지나간다' for whoever has not chosen)
    const left = view.multi && view.deadline != null ? Math.max(0, Math.ceil((view.deadline - Date.now()) / 1000)) : null;
    show(this.timer, left != null);
    if (left != null) {
      setText(this.timer, goedamTimerText(left, pr.stage));
      setClass(this.timer, 'is-urgent', left <= 5);
    }
    // multiplayer: who has chosen (✓) — what they chose only shows after my own pick
    const others = view.multi ? s.players.filter(p => p.id !== view.localPlayer) : [];
    const pk = others.map(p => `${p.name}:${g.players[p.id]?.stage}`).join('|');
    if (pk === this.playersKey) return;
    this.playersKey = pk;
    this.players.replaceChildren();
    for (const p of others) {
      const st = g.players[p.id]?.stage ?? 'done';
      const chip = h('span', `gd-pchip${st === 'choosing' ? '' : ' is-done'}`, this.players);
      chip.style.setProperty('--pc', p.color);
      h('span', 'gd-pchip-n', chip, p.name);
      h('span', 'gd-pchip-s', chip, st === 'choosing' ? '…' : '✓');
    }
  }

  // ─────────────────────────── options ───────────────────────────

  private showOptions(g: GoedamState, pr: GoedamProgress, me: PlayerState, revealing: boolean, arming: boolean): void {
    show(this.options, true);
    show(this.card, false);
    show(this.others, false);
    show(this.wait, false);
    setClass(this.el, 'is-flicker', revealing);
    setClass(this.options, 'is-arming', arming);
    const picked = revealing ? pr.choice : (this.pending?.option ?? null);
    const key = `${this.roomKey}|${pr.options.map(o => `${o.id}${o.hidden ? '-' : ''}`).join(',')}|${picked ?? ''}`;
    if (key === this.optionsKey) return;
    this.optionsKey = key;
    this.options.replaceChildren();
    setClass(this.options, 'is-locked', picked != null);
    for (const slot of pr.options) {
      if (slot.hidden) continue;
      const v = goedamOptionView(g.roomId, slot.id, pr.params, me.party);
      this.optionButton(v, picked);
    }
  }

  private optionButton(v: GoedamOptionView, picked: string | null): void {
    const kind = goedamOptionKind(v);
    const b = button(`gd-opt kind-${kind}`, '', this.options, () => this.pick(v.id));
    b.dataset.option = v.id;
    if (picked != null) b.classList.add(picked === v.id ? 'is-picked' : 'is-dim');
    const head = h('div', 'gd-opt-head', b);
    h('span', 'gd-opt-label', head, v.label);
    if (picked === v.id) h('span', 'gd-opt-wait', head, '…');
    const tags = h('span', 'gd-tags', head);
    for (const t of v.tags) h('span', `gd-tag tag-${t}`, tags, goedamTagLabel(t));
    const rolled = v.lines.some(l => l.lead != null);
    let chance: number | null = null;
    for (const l of v.lines) {
      // a roll's second line (lead null) keeps its parent's bar: it is the same roll, not a separate sure effect
      if (!rolled || l.lead != null) chance = l.chance;
      this.line(b, l, rolled, chance);
    }
  }

  /** One effect line: odds lead + probability bar behind it (rolls), or '＋'/'−' (sure options). */
  private line(parent: HTMLElement, l: GoedamLine, rolled: boolean, chance: number | null): void {
    const cont = rolled && l.lead == null;
    const row = h('div', `gd-line tone-${l.tone}${cont ? ' is-cont' : ''}`, parent);
    if (chance != null) {
      row.classList.add('has-bar');
      row.style.setProperty('--ch', `${Math.round(chance * 100)}%`);
    }
    if (rolled) h('span', `gd-lead${cont ? ' is-cont' : ''}`, row, l.lead ?? '');
    else h('span', 'gd-sign', row, l.tone === 'cost' ? '−' : '＋');
    h('span', 'gd-line-t', row, l.text);
    // a relic / card description is the only text saying what it does: its own full-width line, not a right-aligned tail
    if (l.detail) h('span', `gd-line-d${l.detail.length > DETAIL_TAIL_MAX ? ' is-full' : ''}`, row, l.detail);
  }

  private pick(option: string): void {
    if (this.pending || performance.now() < this.armAt) return;
    const r = this.cb.onChoose(option);
    if (!r.ok) {
      this.optionsKey = '';
      this.showError(r.reason ?? '고를 수 없어요');
      return;
    }
    this.showError(null);
    this.pending = { option, at: performance.now() };
    this.optionsKey = '';
  }

  // ─────────────────────────── result card / wait ───────────────────────────

  private showCard(s: GameState, g: GoedamState, pr: GoedamProgress, me: PlayerState, view: GoedamView): void {
    show(this.options, false);
    show(this.card, true);
    const key = `${this.roomKey}|${pr.choice}|${pr.outcome?.id ?? ''}`;
    if (key !== this.cardKey) {
      this.cardKey = key;
      this.buildCard(g, pr, me);
    }
    const done = pr.stage === 'done';
    if (this.contPending && (done || performance.now() - this.contPending.at > PENDING_MS)) this.contPending = null;
    if (this.contBtn) {
      show(this.contBtn, !done);
      setText(this.contBtn, this.contPending ? '…' : '계속 ▶');
      setClass(this.contBtn, 'is-busy', !!this.contPending);
    }
    this.updateOthers(s, g, view);
    show(this.wait, done && view.multi);
    if (done && view.multi) {
      const n = g.players.filter(x => x.stage === 'done').length;
      setText(this.waitText, goedamWaitText(n, g.players.length));
    }
  }

  private buildCard(g: GoedamState, pr: GoedamProgress, me: PlayerState): void {
    this.card.replaceChildren();
    this.contBtn = null;
    if (!pr.choice || !pr.outcome) return;
    const rv = goedamResultView(g.roomId, pr.choice, pr.outcome, pr.params, me.party);
    this.card.className = `gd-card tone-${rv.tone}${this.animateCard ? ' is-reveal' : ''}`;
    this.animateCard = false;
    h('div', 'gd-card-kicker', this.card, getGoedamOption(g.roomId, pr.choice)?.done ?? '');
    h('div', 'gd-card-title', this.card, rv.title);
    if (rv.note) h('div', 'gd-card-note', this.card, rv.note);
    const lines = h('div', 'gd-card-lines', this.card);
    for (const l of rv.lines) {
      const row = h('div', `gd-cline tone-${l.tone}`, lines);
      h('span', 'gd-sign', row, l.tone === 'cost' ? '−' : '＋');
      h('span', 'gd-cline-t', row, l.text);
    }
    if (pr.outcome.traces.length) {
      const chips = h('div', 'gd-card-traces', this.card);
      for (const id of pr.outcome.traces) {
        const t = getGoedamTrace(id);
        const chip = h('span', `gd-trace kind-${goedamTraceKind(t)}`, chips, `${t.icon} ${t.name} · ${goedamTraceDuration(t.floors)}`);
        chip.title = t.banner;
      }
    }
    this.contBtn = button('btn btn-primary gd-continue', '계속 ▶', this.card, () => this.continue());
  }

  private continue(): void {
    if (this.contPending) return;
    const r = this.cb.onChoose('continue');
    if (!r.ok) {
      this.showError(r.reason ?? '계속할 수 없어요');
      return;
    }
    this.showError(null);
    this.contPending = { option: 'continue', at: performance.now() };
  }

  /** Multiplayer, after my pick: one row per other player (name — pick → result, or 고르는 중…). */
  private updateOthers(s: GameState, g: GoedamState, view: GoedamView): void {
    show(this.others, view.multi);
    if (!view.multi) return;
    const rows = s.players
      .filter(p => p.id !== view.localPlayer)
      .map(p => ({ p, text: goedamOtherRow(p, g.roomId, g.players[p.id]) }));
    const key = rows.map(r => `${r.p.id}:${r.text}`).join('|');
    if (key === this.othersKey) return;
    this.othersKey = key;
    this.others.replaceChildren();
    for (const { p, text } of rows) {
      const row = h('div', 'gd-other', this.others);
      h('span', 'gd-other-dot', row).style.background = p.color;
      h('span', 'gd-other-t', row, text);
    }
  }

  private showError(text: string | null): void {
    show(this.error, text != null);
    if (text != null) setText(this.error, `고를 수 없어요 · ${text}`);
  }
}
