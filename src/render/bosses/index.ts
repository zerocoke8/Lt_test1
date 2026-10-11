// 기획 19차 보스 레이드: the boss art registry (docs/bosses.md 4장). Looks, warning motifs and summon bodies of the
// new bosses, one file per zone. The classic four are not rows here: boss.ts draws them directly (classic.ts + the
// watcher in boss.ts), and an id without a row falls back to the watcher's art — so a boss can exist before its look.

import type { BossLook, CreatureDrawFn, TeleMotif, ZoneLook } from './types';
import { LOBBY_LOOKS, LOBBY_MINION_LOOKS, LOBBY_TELE_MOTIF, LOBBY_ZONE_LOOKS } from './lobby';
import { OFFICE_LOOKS, OFFICE_MINION_LOOKS, OFFICE_TELE_MOTIF, OFFICE_ZONE_LOOKS } from './office';
import { WARD_LOOKS, WARD_MINION_LOOKS, WARD_TELE_MOTIF, WARD_ZONE_LOOKS } from './ward';
import { ROOFTOP_LOOKS, ROOFTOP_MINION_LOOKS, ROOFTOP_TELE_MOTIF, ROOFTOP_ZONE_LOOKS } from './rooftop';

export type { BossBody, BossBodyFn, BossBodyFrame, BossDrawFn, BossDrawOpts, BossLook, BossPose, BossStageLook, CreatureDrawFn, TeleMotif, ZoneLook } from './types';
export { BOSS_DROP, drawElevatorKeeper, drawOvertimeLord, drawSurgeonDirector } from './classic';

/** Boss id → look (new bosses only). */
export const BOSS_LOOKS: Record<string, BossLook> = { ...LOBBY_LOOKS, ...OFFICE_LOOKS, ...WARD_LOOKS, ...ROOFTOP_LOOKS };

/** Boss skill id → the small extra on its warning. */
export const BOSS_TELE_MOTIF: Record<string, TeleMotif> = { ...LOBBY_TELE_MOTIF, ...OFFICE_TELE_MOTIF, ...WARD_TELE_MOTIF, ...ROOFTOP_TELE_MOTIF };

/**
 * 기획 20차: Zone.look → how that trail is painted (커피 웅덩이, 연필 선 …). A look without a row gets the plain
 * enemy-zone colours, so a trail can exist before its art.
 */
export const BOSS_ZONE_LOOKS: Record<string, ZoneLook> = { ...LOBBY_ZONE_LOOKS, ...OFFICE_ZONE_LOOKS, ...WARD_ZONE_LOOKS, ...ROOFTOP_ZONE_LOOKS };

/** MonsterDef.look → the body of a boss's summon-only unit (뽑기 인형, 외짝 양말, 오류 창). */
export const MINION_LOOKS: Record<string, CreatureDrawFn> = { ...LOBBY_MINION_LOOKS, ...OFFICE_MINION_LOOKS, ...WARD_MINION_LOOKS, ...ROOFTOP_MINION_LOOKS };

/** The registered look of a boss (undefined = the classic four and bosses without art yet). */
export function bossLook(id: string): BossLook | undefined {
  return Object.prototype.hasOwnProperty.call(BOSS_LOOKS, id) ? BOSS_LOOKS[id] : undefined;
}
