// 기획 13차 효과음: sound controls (docs/sfx.md 2-4) — 🔊/🔇 toggle + 전체 / 효과음 / 배경음 sliders in the pause menu,
// and a small 🔊 toggle on the preset screen. Saved on this device by src/audio/settings.ts.

import './sound.css';
import { sfx } from '../audio';
import type { AudioSettings } from '../audio/settings';
import { button, h } from './dom';

const SLIDERS: { key: keyof Pick<AudioSettings, 'master' | 'sfx' | 'bg'>; label: string }[] = [
  { key: 'master', label: '전체' },
  { key: 'sfx', label: '효과음' },
  { key: 'bg', label: '배경음' },
];

function toggleText(): string {
  if (sfx.forcedMute) return '🔇\nmute=1';
  return sfx.settings.muted ? '🔇\n꺼짐' : '🔊\n켜짐';
}

export interface SoundPanel {
  readonly el: HTMLElement;
  /** Re-read the settings (another screen may have changed them). */
  sync(): void;
}

/** Pause-menu block: toggle + three sliders. */
export function createSoundPanel(parent: HTMLElement): SoundPanel {
  const el = h('div', 'snd-panel', parent);
  const toggle = button('snd-toggle', '', el, () => {
    sfx.setSettings({ muted: !sfx.settings.muted });
    sync();
  });
  toggle.dataset.sfx = '';
  const rows = SLIDERS.map(s => {
    const row = h('label', 'snd-row', el);
    h('span', 'snd-label', row, s.label);
    const input = h('input', '', row);
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = '5';
    const val = h('span', 'snd-val', row);
    input.addEventListener('input', () => {
      sfx.setSettings({ [s.key]: Number(input.value) / 100 });
      val.textContent = input.value;
    });
    input.addEventListener('change', () => sfx.ui('ui.tap.soft'));
    return { s, input, val };
  });
  function sync(): void {
    toggle.textContent = toggleText();
    toggle.setAttribute('aria-label', sfx.muted ? '소리 켜기' : '소리 끄기');
    toggle.classList.toggle('is-off', sfx.muted);
    for (const r of rows) {
      const v = Math.round(sfx.settings[r.s.key] * 100);
      r.input.value = String(v);
      r.val.textContent = String(v);
    }
  }
  sync();
  return { el, sync };
}

/** Preset screen: a small 🔊 / 🔇 button. */
export function createSoundToggle(parent: HTMLElement): HTMLButtonElement {
  const b = button('icon-btn snd-mini', '', parent, () => {
    sfx.setSettings({ muted: !sfx.settings.muted });
    sync();
    if (!sfx.muted) sfx.ui('ui.tap');
  });
  b.dataset.sfx = '';
  const sync = () => {
    b.textContent = sfx.muted ? '🔇' : '🔊';
    b.setAttribute('aria-label', sfx.muted ? '소리 켜기' : '소리 끄기');
  };
  sync();
  return b;
}
