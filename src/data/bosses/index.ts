// 기획 19차 보스 레이드: the boss registry — one data file per zone (docs/bosses.md). BOSSES keeps the classic four
// first, in the order they always had (floor 5 · 10 · 15 · 20), then the new bosses zone by zone.

import type { BossDef, MonsterDef } from '../../types';
import { LOBBY_BOSSES, LOBBY_UNITS } from './lobby';
import { OFFICE_BOSSES, OFFICE_UNITS } from './office';
import { WARD_BOSSES, WARD_UNITS } from './ward';
import { ROOFTOP_BOSSES, ROOFTOP_UNITS } from './rooftop';

const ZONE_LISTS: readonly BossDef[][] = [LOBBY_BOSSES, OFFICE_BOSSES, WARD_BOSSES, ROOFTOP_BOSSES];

/** Every boss: the classic four (each zone file's first entry), then the rest of each zone. */
export const BOSSES: BossDef[] = [...ZONE_LISTS.map(list => list[0]), ...ZONE_LISTS.flatMap(list => list.slice(1))];

/** Summon-only units of the new bosses (뽑기 인형, 외짝 양말, 오류 창): getMonster resolves them, wave pools never see them. */
export const BOSS_UNITS: MonsterDef[] = [...LOBBY_UNITS, ...OFFICE_UNITS, ...WARD_UNITS, ...ROOFTOP_UNITS];

export { ENRAGE, ahead, arenaAt, at, band, chargeAt, rays, relocateTo, repeat, row, rowR, safeRing, scan, seq, spokes, sweep } from './helpers';
export { BOSS_FORM, BOSS_FORM_LABEL, BOSS_FORM_TIP, BOT_RAID, GUARD_HIT_COLOR, GUARD_HIT_TEXT, SAFE_HOLD, ZONE_AVOID } from './forms';
