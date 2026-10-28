// 기획 22차 궁극기 테스트 — 그룹 B의 캐릭터별 조준 / 드래그 궁극기 (docs/ult-test.md 5장).
// Characters (roster order): gunner 거너 · cleric 클레릭 · medic 메딕 · exorcist 퇴마사 · bard 바드 · chrono 크로노 ·
// puppeteer 퍼펫티어.
// A character missing here (or a missing aim / drag) uses the fallback (src/sim/ultTest.ts): 조준 = today's ult
// re-centred on the aimed point (area ults) or turned toward it (direction ults); 드래그 = blink to the point, today's ult.
// Only this file (and src/render/ultTest/groupB.ts) belongs to the group-B content track.
//
// Shape (src/data/ultTest/types.ts UltAltDef = the existing ult SkillDef + move / aimRange / botAim):
//   cleric: {
//     aim:  { id: 'cleric_ua', name: '…', slot: 'ult', description: '…', castTime: ULT_CAST_TIME, botAim: 'ally', actions: [ … ] },
//     drag: { id: 'cleric_ud', …, move: { kind: 'blink', maxRange: 9 }, actions: [ … ] },
//   },

import type { UltAltSet } from './types';

export const GROUP_B: Record<string, UltAltSet> = {};
