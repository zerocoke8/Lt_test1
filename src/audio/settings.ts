// 기획 13차 효과음: volume / mute, saved on this device (`swapTower.audio.v1`); blocked storage → defaults (2-4).

export interface AudioSettings {
  muted: boolean;
  /** 전체. */
  master: number;
  /** 효과음 (effects + my drag / ult bus). */
  sfx: number;
  /** UI clicks (no slider; follows 효과음 × this). */
  ui: number;
  /** 배경음. */
  bg: number;
}

export const AUDIO_KEY = 'swapTower.audio.v1';
export const AUDIO_DEFAULTS: Readonly<AudioSettings> = { muted: false, master: 0.8, sfx: 1, ui: 0.7, bg: 0.35 };

const unit = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);

export function sanitizeAudio(raw: unknown): AudioSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    muted: typeof r.muted === 'boolean' ? r.muted : AUDIO_DEFAULTS.muted,
    master: unit(r.master, AUDIO_DEFAULTS.master),
    sfx: unit(r.sfx, AUDIO_DEFAULTS.sfx),
    ui: unit(r.ui, AUDIO_DEFAULTS.ui),
    bg: unit(r.bg, AUDIO_DEFAULTS.bg),
  };
}

export function loadAudio(): AudioSettings {
  try {
    const s = globalThis.localStorage?.getItem(AUDIO_KEY);
    return sanitizeAudio(s ? JSON.parse(s) : null);
  } catch {
    return { ...AUDIO_DEFAULTS };
  }
}

export function saveAudio(a: AudioSettings): void {
  try {
    globalThis.localStorage?.setItem(AUDIO_KEY, JSON.stringify(sanitizeAudio(a)));
  } catch {
    /* storage unavailable — ignore */
  }
}

/** `?mute=1` in the address: forced silence for automated tests / recordings (the recent log keeps going). */
export function forcedMute(search: string | undefined = globalThis.location?.search): boolean {
  if (!search) return false;
  try {
    return new URLSearchParams(search).get('mute') === '1';
  } catch {
    return false;
  }
}
