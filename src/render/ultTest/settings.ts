// 기획 23차 궁극기 연출 강화 (docs/ult-fx.md 2-8, 4-4): the device-local switch of the stronger 궁극기 테스트 looks and
// the renderer's load flag. No imports on purpose: the sound director (src/audio/director.ts) and the pause panel read
// it too, and this file must never pull the renderer into them.

/**
 * 「궁극기 연출 강화」 (일시정지 「연출」, saved per device). true = the 23차 looks (character stories, the finisher grammar,
 * lock-on, landing strip, floor marks, the new sound rules); false = the 22차 looks (the 23차 data stays either way).
 */
export const ULT_FX: { boost: boolean } = { boost: true };

/** Stored settings → a valid one (anything unknown → the default: on). */
export function sanitizeUltFx(raw: unknown): { boost: boolean } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { boost: typeof r.boost === 'boolean' ? r.boost : true };
}

/**
 * The phone is struggling: render/index.ts sets it every frame (the backing-scale governor's cap ≤ 1.25). The 23차
 * extras then go light — half the sparks / embers, no floor-mark cracks, no directional speed lines; 기획 24차: the
 * impact frame without its streaks and second ring (read when it is pushed).
 */
export const FX_LOAD: { low: boolean } = { low: false };
