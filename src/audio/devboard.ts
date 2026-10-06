// 기획 13차 효과음: debug panel "효과음" board (docs/sfx.md 2-1 devboard.ts): pick a family, ▶ any id, see whether it is
// a synth or a file, re-bake after tuning recipes. Also the test hook `window.__proto.sfx` (play / ids / recent).

import { button, h } from '../ui/dom';
import { sfx, type RecentEntry } from './index';

export interface SfxDebugApi {
  play(id: string): boolean;
  ids(): string[];
  readonly recent: readonly RecentEntry[];
  readonly unlocked: boolean;
  readonly muted: boolean;
}

export const sfxDebugApi: SfxDebugApi = {
  play: id => sfx.play(id),
  ids: () => sfx.ids(),
  get recent() {
    return sfx.recent;
  },
  get unlocked() {
    return sfx.unlocked;
  },
  get muted() {
    return sfx.muted;
  },
};

/** Family of an id for the board: 'drag.guardian', 'ult.blade', 'mon', 'ui' … */
export function boardFamily(id: string): string {
  const [a, b] = id.split('.');
  return a === 'drag' || a === 'ult' || a === 'boss' || a === 'gd' || a === 'fe' ? `${a}.${b}` : a;
}

export function mountSfxBoard(sec: HTMLElement): void {
  const ids = sfx.ids();
  const fams = [...new Set(ids.map(boardFamily))];
  let pick = 0;
  const head = h('div', 'dbg-jump', sec);
  button('dbg-btn dbg-step', '◀', head, () => setFam(pick - 1));
  const label = h('span', 'dbg-floor dbg-room', head);
  button('dbg-btn dbg-step', '▶', head, () => setFam(pick + 1));
  const grid = h('div', 'dbg-grid', sec);
  const info = h('div', 'dbg-note', sec);
  const foot = h('div', 'dbg-btnrow', sec);
  button('dbg-btn', '다시 굽기', foot, () => {
    sfx.engine.rebake();
    showInfo();
  });
  function setFam(i: number): void {
    pick = (i + fams.length) % fams.length;
    label.textContent = `${fams[pick]} (${pick + 1}/${fams.length})`;
    grid.replaceChildren();
    for (const id of ids.filter(x => boardFamily(x) === fams[pick])) {
      const b = button('dbg-btn', `▶ ${id.slice(fams[pick].length + 1) || id}`, grid, () => {
        sfx.unlock();
        sfx.play(id);
        showInfo();
      });
      b.dataset.sfx = '';
      b.title = `${id} · ${sfx.engine.isFile(id) ? '파일' : '합성'}`;
    }
    showInfo();
  }
  function showInfo(): void {
    const mb = ((sfx.engine.baker.bytes() + sfx.engine.bufferBytes()) / 1e6).toFixed(1);
    info.textContent = `${sfx.unlocked ? '켜짐' : '첫 터치 전'}${sfx.muted ? ' · 음소거' : ''} · 구운 소리 ${mb}MB · 재생 중 ${sfx.engine.active}`;
  }
  setFam(0);
}
