// 기획 17차 HUD bits (docs/just-swap.md 배우게 하는 표시, docs/floor-rewards.md 그 밖의 화면 규칙):
//  - 저스트 cue on my field card: a thin red edge while an enemy telegraph covers my character ('위험'), a gold pulse once
//    it lands within the 저스트 window ('지금!'; multiplayer turns it on earlier by the snapshot age + half the ping).
//  - learner help: 「지금!」 chevrons over the ready bench cards until 5 저스트 succeeded on this device (설정 「저스트 도우미」).
//  - my first 저스트 ever: one toast that says what it does.
//  - small chips under the 흔적 row for the reward counters (빚 · 상자 · 욕심 · 촛불 · 손톱), the 빚 skip toast, and a
//    toast at the next floor start for the synergy sets completed on the last reward screen.

import type { GameEvent, GameState, PlayerState, SynergyTag, Tunables } from '../types';
import { TAG_INFO, TAG_SET_BONUS, TAG_SET_SIZE } from '../data';
import { justCue, justParams } from '../sim/justSwap';
import { rewardCount, rewardParam } from '../sim/rewards/query';
import { h, setClass, show } from './dom';
import { FEEL, JUST_TUTOR_GOAL, bumpJustTutor, justTutorCount, markTipSeen, tipSeen } from './storage';
import type { ToastKind } from './toast';

const FIRST_TIP = 'justFirst';
const CANDLES_EVERY = 40;

export interface JustCue {
  danger: boolean;
  now: boolean;
}

/** The first-저스트 help line with the live numbers. PURE. */
export function justHelpText(mult: number, cut: number): string {
  return `저스트 교대! 맞기 직전에 바꾸면 다음 캐릭터 드래그 +${Math.round((mult - 1) * 100)}%, 나간 캐릭터 쿨 −${Math.round(cut * 100)}%`;
}

/** Learner chevrons show: help on, under the goal, cue 'now'. PURE. */
export function showsLearner(helper: boolean, successes: number, cueNow: boolean): boolean {
  return helper && successes < JUST_TUTOR_GOAL && cueNow;
}

export interface RewardChip {
  key: string;
  text: string;
  kind: 'curse' | 'growth' | 'info';
}

/** Counter chips of my rewards (rewardState is public and carried). PURE. */
export function rewardChips(me: PlayerState, expedition: boolean): RewardChip[] {
  const st = me.rewardState ?? {};
  const unit = expedition ? '단계' : '층';
  const out: RewardChip[] = [];
  if ((st.debt ?? 0) > 0) out.push({ key: 'debt', text: `빚 ${st.debt}${unit}`, kind: 'curse' });
  if ((st.boxBump ?? 0) > 0) out.push({ key: 'box', text: '상자 ↑', kind: 'info' });
  if ((st.greedyPicks ?? 0) > 0) out.push({ key: 'greedy', text: `욕심 ${2 + (st.greedyPicks ?? 0)}장`, kind: 'curse' });
  else if ((st.greedySkip ?? 0) > 0) out.push({ key: 'greedy', text: '욕심 · 다음 없음', kind: 'curse' });
  if (rewardCount(me, 'candles') > 0) {
    const every = rewardParam(me, 'candles', 'kills', 'max') || CANDLES_EVERY;
    out.push({ key: 'candles', text: `촛불 ${(st.candlesKills ?? 0) % every}/${every} · +${st.candlesBonus ?? 0}%`, kind: 'growth' });
  }
  if ((st.nails ?? 0) > 0 && rewardCount(me, 'nails') > 0) out.push({ key: 'nails', text: `손톱 +${st.nails}%`, kind: 'growth' });
  return out;
}

export interface JustHudDeps {
  root: HTMLElement;
  localPlayer: number;
  toast(text: string, kind?: ToastKind): void;
  /** True while a full screen covers the HUD (hold toasts). */
  covered(): boolean;
  tunables(): Tunables;
  /** Multiplayer: seconds the cue runs early (snapshot age + half the ping); solo 0. */
  cueAge(): number;
}

export class JustHud {
  private readonly chips: HTMLElement;
  private chipsKey = '';
  private tutor = justTutorCount();
  private readonly pendingSets: SynergyTag[] = [];
  private readonly held: string[] = [];

  constructor(private readonly d: JustHudDeps) {
    this.chips = h('div', 'hud-rwchips is-hidden', d.root);
  }

  /** The cue of my field character now. */
  cue(s: GameState): JustCue {
    if (s.phase !== 'combat') return { danger: false, now: false };
    const c = justCue(s, this.d.tunables(), this.d.localPlayer, this.d.cueAge());
    return { danger: c.danger, now: c.now };
  }

  /** Bench chevrons: help on and fewer than JUST_TUTOR_GOAL successes. */
  learner(cueNow: boolean): boolean {
    return showsLearner(FEEL.justHelper, this.tutor, cueNow);
  }

  /** Card classes: the field card's 위험 / 지금!, the ready bench cards' chevrons. */
  applyCard(el: HTMLElement, active: boolean, ready: boolean, cue: JustCue): void {
    setClass(el, 'is-just-danger', active && cue.danger && !cue.now);
    setClass(el, 'is-just-now', active && cue.now);
    setClass(el, 'is-just-hint', !active && ready && this.learner(cue.now));
  }

  onEvent(s: GameState, e: GameEvent): void {
    const me = this.d.localPlayer;
    switch (e.type) {
      case 'justSwap':
        if (e.player !== me) return;
        this.tutor = bumpJustTutor();
        if (!tipSeen(FIRST_TIP)) {
          markTipSeen(FIRST_TIP);
          const p = s.players[me];
          const jp = p ? justParams({ tunables: this.d.tunables() }, p) : { mult: 1.5, cut: 0.4 };
          this.d.toast(justHelpText(jp.mult, jp.cut), 'good');
        }
        return;
      case 'tagSet':
        if (e.player === me && !this.pendingSets.includes(e.tag)) this.pendingSets.push(e.tag);
        return;
      case 'floorStart':
        for (const t of this.pendingSets.splice(0)) this.d.toast(`#${TAG_INFO[t].label} ${TAG_SET_SIZE}개 모음 · ${TAG_SET_BONUS[t]}`, 'good');
        return;
      case 'rewardProc':
        // 빚쟁이 / 욕심: the screen was skipped (no unit: the core's toast text)
        if (e.player === me && e.entityId == null && e.partyIndex == null && e.text) this.say(e.text);
        return;
    }
  }

  /** Held toasts go out once the field shows again. */
  flush(): void {
    if (this.d.covered()) return;
    for (const t of this.held.splice(0)) this.d.toast(t, 'warn');
  }

  private say(text: string): void {
    if (this.d.covered()) this.held.push(text);
    else this.d.toast(text, 'warn');
  }

  updateChips(s: GameState, me: PlayerState): void {
    const list = rewardChips(me, !!s.expedition);
    const key = list.map(c => `${c.key}:${c.text}`).join('|');
    if (key === this.chipsKey) return;
    this.chipsKey = key;
    this.chips.replaceChildren();
    show(this.chips, list.length > 0);
    for (const c of list) {
      const el = h('span', `hud-rwchip kind-${c.kind}`, this.chips, c.text);
      el.dataset.chip = c.key;
    }
  }
}
