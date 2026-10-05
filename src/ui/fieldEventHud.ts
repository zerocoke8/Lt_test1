// 기획 12차 돌발 괴담 HUD (docs/combat-events.md 2-4): the one-line pill under the floor box (icon · seconds · progress ·
// reward word), the low start banner, success / failure toasts with the credit name, and gold pulses on what the reward
// touched (ult button, pet cards, character cards, trace chips). Hud (hud.ts) owns the elements and calls update().

import type { FieldEventDef, FieldEventState, GameEvent, GameState } from '../types';
import { fieldEventGoalText, fieldEventRewardText, getFieldEvent } from '../data';
import { h, replayClass, setClass, setStyle, setText, show } from './dom';
import { markTipSeen, tipSeen } from './storage';
import type { ToastKind } from './toast';

/** One-time tip on the floor-2 toad's banner. */
const TOAD_TIP_ID = 'fieldEventToad';
const TOAD_TIP = '카드를 옆에 떨어뜨리면 그 캐릭터가 잡으러 가요';
/** Banner time (ms): the warning plus a moment to read the goal. */
const BANNER_MS = 2200;

/** What the credited player did, for the success toast ('민지가 금두꺼비를 잡았다!'). */
const DEED: Record<FieldEventDef['id'], string> = {
  lucky_toad: '금두꺼비를 잡았다',
  possessed_printer: '프린터를 부쉈다',
  sleeping_patient: '환자를 깨웠다',
  open_shaft: '통로를 닫았다',
  midnight_surge: '그림자를 쓸어 담았다',
  dark_lamps: '마지막 비상등을 켰다',
  sleepwalker: '아이를 출구까지 데려갔다',
};

export interface FieldEventHudDeps {
  localPlayer: number;
  toast(text: string, kind: ToastKind): void;
  /** Where a reward shows: the ult button, my pet cards, my character cards, the trace chips. */
  pulseTargets(): { ult: HTMLElement; pets: HTMLElement[]; chars: HTMLElement[]; traces: HTMLElement };
}

/** Subject particle for a name: 이 after a final consonant (digits read in Korean), else 가. */
export function subjectOf(name: string): string {
  const ch = name.trim().slice(-1);
  const code = ch.charCodeAt(0);
  let batchim = false;
  if (code >= 0xac00 && code <= 0xd7a3) batchim = (code - 0xac00) % 28 !== 0;
  else if (/[0-9]/.test(ch)) batchim = '013678'.includes(ch);
  else if (/[a-z]/i.test(ch)) batchim = 'lmnr'.includes(ch.toLowerCase());
  return `${name}${batchim ? '이' : '가'}`;
}

/** Success toast: '민지가 금두꺼비를 잡았다! 모두 궁극기 게이지 +40%' (or '23:59 정각 성공! …' without a name). */
export function fieldEventToast(s: GameState, local: number, id: FieldEventDef['id'], player: number | null): string {
  const def = getFieldEvent(id);
  const reward = `모두 ${fieldEventRewardText(def.reward)}`;
  const p = player != null ? s.players[player] : undefined;
  if (!p) return `${def.name} 성공! ${reward}`;
  const who = p.id === local ? '내가' : subjectOf(p.name);
  return `${who} ${DEED[id]}! ${reward}`;
}

/** The pill's progress: a bar fraction (0..1) or a short text ('●●○', '7/10'). */
export function pillProgress(s: GameState, ev: FieldEventState): { bar: number | null; text: string } {
  const unit = s.entities.find(e => e.id === ev.entityIds[0] && e.hp > 0);
  switch (ev.id) {
    case 'lucky_toad':
      return { bar: unit ? unit.hp / unit.maxHp : 0, text: '' };
    case 'possessed_printer':
      return { bar: unit ? unit.hp / unit.maxHp : 0, text: `${ev.printed ?? 0}/${getFieldEvent(ev.id).params.printMax}` };
    case 'sleeping_patient':
      return { bar: ev.progress / 100, text: '' };
    case 'sleepwalker':
      return { bar: ev.progress / ev.goal, text: '' };
    case 'midnight_surge':
      return { bar: null, text: `${Math.floor(ev.progress)}/${ev.goal}` };
    default:
      return { bar: null, text: '●'.repeat(Math.floor(ev.progress)) + '○'.repeat(Math.max(0, ev.goal - Math.floor(ev.progress))) };
  }
}

export class FieldEventHud {
  private readonly pill: HTMLElement;
  private readonly icon: HTMLElement;
  private readonly secs: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly barFill: HTMLElement;
  private readonly prog: HTMLElement;
  private readonly reward: HTMLElement;
  private readonly bannerBox: HTMLElement;
  private readonly deps: FieldEventHudDeps;

  constructor(parent: HTMLElement, bannerBox: HTMLElement, deps: FieldEventHudDeps) {
    this.deps = deps;
    this.bannerBox = bannerBox;
    this.pill = h('div', 'fe-pill hud-block is-hidden', parent);
    this.icon = h('span', 'fe-icon', this.pill);
    this.secs = h('span', 'fe-secs', this.pill);
    this.bar = h('span', 'fe-bar', this.pill);
    this.barFill = h('span', 'fe-bar-fill', this.bar);
    this.prog = h('span', 'fe-prog', this.pill);
    this.reward = h('span', 'fe-reward', this.pill);
  }

  update(s: GameState, events: GameEvent[]): void {
    for (const e of events) this.onEvent(s, e);
    this.updatePill(s);
  }

  private onEvent(s: GameState, e: GameEvent): void {
    // the banner comes with the event itself (the warning shows in the pill and as the gold mark on the field)
    if (e.type === 'fieldEventStart') this.banner(s, getFieldEvent(e.id));
    else if (e.type === 'fieldEventEnd') {
      if (e.success) {
        this.deps.toast(fieldEventToast(s, this.deps.localPlayer, e.id, e.player), 'good');
        this.pulse(getFieldEvent(e.id));
      } else {
        this.deps.toast(`놓쳤다… ${getFieldEvent(e.id).name}`, 'info');
      }
    }
  }

  /** Low banner (the boss-phase strip): 「돌발 괴담 · 이름」, the 괴담 line, the goal + reward; the toad's tip once. */
  private banner(s: GameState, def: FieldEventDef): void {
    this.bannerBox.replaceChildren();
    setClass(this.bannerBox, 'is-low', true);
    const b = h('div', 'banner banner-event', this.bannerBox);
    h('div', 'banner-big', b, `${def.icon} 돌발 괴담 · ${def.name}`);
    h('div', 'banner-lore', b, def.premise);
    h('div', 'banner-sub', b, fieldEventGoalText(def));
    if (def.id === 'lucky_toad' && s.floor === 2 && !tipSeen(TOAD_TIP_ID)) {
      markTipSeen(TOAD_TIP_ID);
      h('div', 'banner-tip', b, TOAD_TIP);
    }
    setTimeout(() => b.remove(), BANNER_MS);
  }

  /** Gold pulse on what the reward touched. */
  private pulse(def: FieldEventDef): void {
    const t = this.deps.pulseTargets();
    const r = def.reward;
    const els =
      r.kind === 'ultAdd' ? [t.ult] : r.kind === 'petReset' ? t.pets : r.kind === 'healParty' || r.kind === 'benchSwapReset' ? t.chars : r.kind === 'trace' ? [t.traces] : [];
    for (const el of els) replayClass(el, 'is-fe-reward');
  }

  private updatePill(s: GameState): void {
    const ev = s.fieldEvent;
    show(this.pill, !!ev && s.phase === 'combat');
    if (!ev) return;
    const def = getFieldEvent(ev.id);
    setText(this.icon, def.icon);
    setClass(this.pill, 'is-warn', ev.stage === 'warn');
    setClass(this.pill, 'is-urgent', ev.stage === 'active' && ev.remaining < 5);
    if (ev.stage === 'warn') {
      setText(this.secs, '!');
      show(this.bar, false);
      setText(this.prog, def.name);
      setText(this.reward, '');
      show(this.reward, false);
      return;
    }
    setText(this.secs, String(Math.max(0, Math.ceil(ev.remaining))));
    const p = pillProgress(s, ev);
    show(this.bar, p.bar != null);
    if (p.bar != null) setStyle(this.barFill, 'transform', `scaleX(${Math.max(0, Math.min(1, p.bar)).toFixed(3)})`);
    setText(this.prog, p.text);
    show(this.prog, p.text !== '');
    setClass(this.prog, 'is-dots', /[●○]/.test(p.text));
    show(this.reward, true);
    setText(this.reward, fieldEventRewardText(def.reward, true));
  }
}
