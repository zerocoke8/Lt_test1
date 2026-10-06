// 기획 13차 효과음: one click listener at the app root gives every button a sound (docs/sfx.md 2-1 uiSfx.ts).
// `data-sfx="<id>"` on a button picks its sound, `data-sfx=""` silences it; otherwise the table below decides by
// class / label so screens need no audio code. Runs after the button's own handler (bubble phase), so state the
// handler just changed (선택됨, 포기 확인) is visible.

import { GOEDAM_ROOMS } from '../data';

/** Minimal element surface (tests pass plain objects). */
export interface UiTarget {
  matches(sel: string): boolean;
  closest(sel: string): UiTarget | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  readonly textContent: string | null;
  readonly classList: { contains(c: string): boolean };
}

type Pick = string | ((el: UiTarget) => string);

const COST_OPTIONS = new Set(GOEDAM_ROOMS.flatMap(r => r.options.filter(o => o.tags.includes('cost') || o.tags.includes('permanent')).map(o => o.id)));

/** First matching selector wins ('' = silent: that action has its own sound elsewhere). */
const TABLE: [string, Pick][] = [
  ['.hud .icon-btn:not(.btn-dbg)', ''], // ⚙ → ui.pause.open from the pause hook
  ['.rw-card', ''], // reward.pick.* from the app
  ['.gd-menu', ''],
  ['.pause .btn-primary', ''], // 계속 → ui.pause.close
  ['.pause .btn-danger', el => ((el.textContent ?? '').includes('한 번 더') ? 'ui.warn' : 'ui.back')],
  ['.btn-start', 'ui.start'],
  ['.lb-create, .lb-join, .lb-solo, .lb-room-row', 'ui.confirm'],
  ['.lb-back, .lb-leave, .lb-preset, .sp-btn', 'ui.back'],
  ['.ps-card, .slot-chip', el => (el.classList.contains('is-picked') ? 'ui.select' : 'ui.select.off')],
  ['.gd-opt.kind-gamble', 'gd.pick.gamble'],
  ['.gd-opt', el => (COST_OPTIONS.has(el.getAttribute('data-option') ?? '') ? 'gd.pick.cost' : 'gd.pick')],
  ['.gd-continue', 'gd.continue'],
  ['.dbg-btn, .dbg-hbtn, .icon-btn, .snd-toggle', 'ui.tap.soft'],
];

/** Buttons named by their label (result / room screens). */
const BY_LABEL: Record<string, string> = { '다시 하기': 'ui.start', 방으로: 'ui.confirm', '방 나가기': 'ui.back', 프리셋으로: 'ui.back' };

/** The sound for a click on `target` (null = not a button / silent). */
export function uiSoundFor(target: UiTarget | null): string | null {
  const el = target?.closest('button, [data-sfx]') ?? null;
  if (!el) return null;
  if (el.hasAttribute('data-sfx')) return el.getAttribute('data-sfx') || null;
  if (el.classList.contains('is-disabled')) return 'ui.refuse';
  for (const [sel, pick] of TABLE) {
    if (!el.matches(sel)) continue;
    const id = typeof pick === 'string' ? pick : pick(el);
    return id || null;
  }
  const label = (el.textContent ?? '').trim();
  return BY_LABEL[label] ?? 'ui.tap';
}
