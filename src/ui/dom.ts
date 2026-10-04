// Tiny DOM helpers. The set* functions skip the DOM write when the value hasn't changed,
// so the HUD can call them every update without causing style recalcs.

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  parent?: HTMLElement | null,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}

/** Button with type=button (never submits) and a label. */
export function button(cls: string, label: string, parent?: HTMLElement | null, onClick?: (ev: MouseEvent) => void): HTMLButtonElement {
  const b = h('button', cls, parent, label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

const memo = new WeakMap<Element, Map<string, string | boolean>>();

function changed(el: Element, key: string, v: string | boolean): boolean {
  let m = memo.get(el);
  if (!m) {
    m = new Map();
    memo.set(el, m);
  }
  if (m.get(key) === v) return false;
  m.set(key, v);
  return true;
}

export function setText(el: Element, s: string): void {
  if (changed(el, '#text', s)) el.textContent = s;
}

export function setStyle(el: HTMLElement, prop: string, v: string): void {
  if (changed(el, prop, v)) el.style.setProperty(prop, v);
}

export function setClass(el: Element, cls: string, on: boolean): void {
  if (changed(el, `.${cls}`, on)) el.classList.toggle(cls, on);
}

export function setAttr(el: Element, name: string, v: string): void {
  if (changed(el, `@${name}`, v)) el.setAttribute(name, v);
}

export function show(el: HTMLElement, on: boolean): void {
  setClass(el, 'is-hidden', !on);
}

/** Restart a CSS animation class (e.g. shake) on an element. */
export function replayClass(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  memo.get(el)?.delete(`.${cls}`);
}

/** Inline SVG role icons (tank shield / melee sword / ranged bow / support cross). */
export const ROLE_ICON: Record<string, string> = {
  tank: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" fill="currentColor"/></svg>',
  melee:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 2h-4.5L6.8 10.7l-1.7-1.7-1.4 1.4 2.5 2.5L3 16.1 4.4 17.5 3 19l2 2 1.5-1.4 1.4 1.4 3.2-3.2 2.5 2.5 1.4-1.4-1.7-1.7L22 8.5V2Z" fill="currentColor"/></svg>',
  ranged:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5" stroke="currentColor" stroke-width="2.4"/></svg>',
  support: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z" fill="currentColor"/></svg>',
};

export const ICON_GEAR =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1l.4 2.6h4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5L19.4 13ZM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" transform="translate(-1 0)"/></svg>';

export const ICON_FULLSCREEN =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>';
