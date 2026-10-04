// Short stacked messages (cosmetic; auto-dismiss). Same text within 0.6 s is coalesced.

import { h } from './dom';

export type ToastKind = 'info' | 'warn' | 'good';

export interface Toaster {
  show(text: string, kind?: ToastKind): void;
  clear(): void;
}

export function createToaster(parent: HTMLElement, cls = ''): Toaster {
  const box = h('div', `toasts ${cls}`.trim(), parent);
  let last = '';
  let lastAt = 0;
  return {
    show(text, kind = 'info') {
      const now = performance.now();
      if (text === last && now - lastAt < 600) return;
      last = text;
      lastAt = now;
      const t = h('div', `toast toast-${kind}`, box, text);
      while (box.childElementCount > 3) box.firstElementChild?.remove();
      setTimeout(() => t.classList.add('is-leaving'), 1500);
      setTimeout(() => t.remove(), 1900);
    },
    clear() {
      box.replaceChildren();
    },
  };
}
