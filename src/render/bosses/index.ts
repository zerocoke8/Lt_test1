// 기획 19차 보스 레이드: the boss art registry (docs/bosses.md 4장). Looks, warning motifs and summon bodies of the
// new bosses, one file per zone. The classic four are not rows here: boss.ts draws them directly (classic.ts + the
// watcher in boss.ts), and an id without a row falls back to the watcher's art — so a boss can exist before its look.

import type { BossLook, CreatureDrawFn, TeleMotif } from './types';
import { LOBBY_LOOKS, LOBBY_MINION_LOOKS, LOBBY_TELE_MOTIF } from './lobby';
import { OFFICE_LOOKS, OFFICE_MINION_LOOKS, OFFICE_TELE_MOTIF } from './office';
import { WARD_LOOKS, WARD_MINION_LOOKS, WARD_TELE_MOTIF } from './ward';
import { ROOFTOP_LOOKS, ROOFTOP_MINION_LOOKS, ROOFTOP_TELE_MOTIF } from './rooftop';

export type { BossDrawFn, BossDrawOpts, BossLook, CreatureDrawFn, TeleMotif } from './types';
export { BOSS_DROP, drawElevatorKeeper, drawOvertimeLord, drawSurgeonDirector } from './classic';

/** Boss id → look (new bosses only). */
export const BOSS_LOOKS: Record<string, BossLook> = { ...LOBBY_LOOKS, ...OFFICE_LOOKS, ...WARD_LOOKS, ...ROOFTOP_LOOKS };

/** Boss skill id → the small extra on its warning. */
export const BOSS_TELE_MOTIF: Record<string, TeleMotif> = { ...LOBBY_TELE_MOTIF, ...OFFICE_TELE_MOTIF, ...WARD_TELE_MOTIF, ...ROOFTOP_TELE_MOTIF };

/** MonsterDef.look → the body of a boss's summon-only unit (뽑기 인형, 외짝 양말, 오류 창). */
export const MINION_LOOKS: Record<string, CreatureDrawFn> = { ...LOBBY_MINION_LOOKS, ...OFFICE_MINION_LOOKS, ...WARD_MINION_LOOKS, ...ROOFTOP_MINION_LOOKS };

/** The registered look of a boss (undefined = the classic four and bosses without art yet). */
export function bossLook(id: string): BossLook | undefined {
  return Object.prototype.hasOwnProperty.call(BOSS_LOOKS, id) ? BOSS_LOOKS[id] : undefined;
}
