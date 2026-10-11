// 기획 19차 보스 레이드: the boss sound registry — one file per zone, merged here (voices.ts re-exports BOSS_VOICE).

import type { BossKind, BossVoice } from './types';
import { LOBBY_BOSS_VOICE } from './lobby';
import { OFFICE_BOSS_VOICE } from './office';
import { WARD_BOSS_VOICE } from './ward';
import { ROOFTOP_BOSS_VOICE } from './rooftop';

export { BOSS_KINDS, BOSS_TIMBRES, type BossKind, type BossTimbre, type BossVoice } from './types';

/** Boss id → voice row (boss.intro / boss.phase / boss.death and the kinds of its skills). */
export const BOSS_VOICE: Record<string, BossVoice> = { ...LOBBY_BOSS_VOICE, ...OFFICE_BOSS_VOICE, ...WARD_BOSS_VOICE, ...ROOFTOP_BOSS_VOICE };

/** Boss skill id → wind-up / impact kind, from every voice row (skill ids are unique across bosses). */
export const BOSS_SKILL_KIND: Record<string, BossKind> = Object.assign({}, ...Object.values(BOSS_VOICE).map(v => v.kinds));

/** The kind of a boss skill ('burst' without a row). */
export function bossSkillKind(skillId: string): BossKind {
  return BOSS_SKILL_KIND[skillId] ?? 'burst';
}
