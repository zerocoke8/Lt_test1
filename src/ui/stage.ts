// Fixed 1280×720 logical stage (canvas + DOM HUD), scaled to fit the safe area with letterboxing.
// Portrait → "가로로 돌려 주세요" overlay. Fullscreen helper with orientation lock (best effort).

import { LOGICAL_H, LOGICAL_W, type Vec2 } from '../types';
import { h } from './dom';

/** Below this stage scale (≈ 844×390 phones: 0.54) the HUD's small text is enlarged (.stage.is-small). */
export const SMALL_STAGE_SCALE = 0.75;

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface StageFit {
  scale: number;
  /** Stage top-left in client px. */
  left: number;
  top: number;
}

/** Largest 16:9 fit inside the viewport minus safe-area insets, centered in the safe rect. Pure. */
export function computeFit(vw: number, vh: number, insets: Insets): StageFit {
  const aw = Math.max(1, vw - insets.left - insets.right);
  const ah = Math.max(1, vh - insets.top - insets.bottom);
  const scale = Math.min(aw / LOGICAL_W, ah / LOGICAL_H);
  return {
    scale,
    left: insets.left + (aw - LOGICAL_W * scale) / 2,
    top: insets.top + (ah - LOGICAL_H * scale) / 2,
  };
}

/** Client px → logical stage px. Pure. */
export function clientToLogical(clientX: number, clientY: number, fit: StageFit): Vec2 {
  return { x: (clientX - fit.left) / fit.scale, y: (clientY - fit.top) / fit.scale };
}

export class Stage {
  readonly host: HTMLElement;
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  /** Combat HUD layer (above canvas). */
  readonly hudLayer: HTMLElement;
  /** Full-stage screens/overlays (preset, reward, result, pause). */
  readonly screenLayer: HTMLElement;
  /** Top-most: drag ghost, toasts. */
  readonly topLayer: HTMLElement;
  fit: StageFit = { scale: 1, left: 0, top: 0 };
  portrait = false;
  private readonly probe: HTMLElement;
  private readonly rotate: HTMLElement;
  private listeners: (() => void)[] = [];

  constructor(root: HTMLElement) {
    this.host = h('div', 'stage-host', root);
    this.probe = h('div', 'safe-probe', this.host);
    this.el = h('div', 'stage', this.host);
    this.canvas = h('canvas', 'stage-canvas', this.el);
    this.hudLayer = h('div', 'layer layer-hud', this.el);
    this.screenLayer = h('div', 'layer layer-screen', this.el);
    this.topLayer = h('div', 'layer layer-top', this.el);
    this.rotate = h('div', 'rotate-overlay is-hidden', this.host);
    const box = h('div', 'rotate-box', this.rotate);
    h('div', 'rotate-icon', box);
    h('div', 'rotate-title', box, '가로로 돌려 주세요');
    h('div', 'rotate-sub', box, '이 게임은 가로 화면 전용이에요');

    const relayout = () => this.relayout();
    window.addEventListener('resize', relayout);
    window.addEventListener('orientationchange', () => setTimeout(relayout, 120));
    document.addEventListener('fullscreenchange', relayout);
    window.visualViewport?.addEventListener('resize', relayout);
    this.relayout();
  }

  onLayout(fn: () => void): void {
    this.listeners.push(fn);
  }

  private readInsets(): Insets {
    try {
      const cs = getComputedStyle(this.probe);
      const px = (s: string) => {
        const v = parseFloat(s);
        return Number.isFinite(v) ? v : 0;
      };
      return { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
    } catch {
      return { top: 0, right: 0, bottom: 0, left: 0 };
    }
  }

  relayout(): void {
    const r = this.host.getBoundingClientRect();
    const vw = r.width || window.innerWidth;
    const vh = r.height || window.innerHeight;
    this.portrait = vh > vw * 1.05;
    this.rotate.classList.toggle('is-hidden', !this.portrait);
    const fit = computeFit(vw, vh, this.readInsets());
    fit.left += r.left;
    fit.top += r.top;
    this.fit = fit;
    this.el.style.transform = `translate(${(fit.left - r.left).toFixed(2)}px, ${(fit.top - r.top).toFixed(2)}px) scale(${fit.scale.toFixed(5)})`;
    // phones in landscape draw the 1280×720 stage at ~0.54: small HUD text gets a bigger size there (styles.css)
    this.el.classList.toggle('is-small', fit.scale < SMALL_STAGE_SCALE);
    for (const fn of this.listeners) fn();
  }

  /** Client px → logical stage px (accounts for scale + letterbox). */
  toLogical(clientX: number, clientY: number): Vec2 {
    return clientToLogical(clientX, clientY, this.fit);
  }

  /** Logical stage px → client px. */
  toClient(p: Vec2): Vec2 {
    return { x: this.fit.left + p.x * this.fit.scale, y: this.fit.top + p.y * this.fit.scale };
  }
}

export function isFullscreen(): boolean {
  return !!document.fullscreenElement;
}

/** Toggle fullscreen; on enter also try to lock landscape. Every call is best-effort (iOS Safari has neither). */
export async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
  } catch {
    /* not allowed — ignore */
  }
  try {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (o && typeof o.lock === 'function') await o.lock('landscape');
  } catch {
    /* not supported — ignore */
  }
}
