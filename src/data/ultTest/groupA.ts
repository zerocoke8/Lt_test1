// 기획 22차 궁극기 테스트 — 그룹 A의 캐릭터별 조준 / 드래그 궁극기 (docs/ult-test.md 5장).
// Characters (roster order): guardian 가디언 · paladin 팔라딘 · warden 워든 · blade 블레이드 · berserker 버서커 ·
// shadow 섀도우 · ranger 레인저 · mage 메이지.
// A character missing here (or a missing aim / drag) uses the fallback (src/sim/ultTest.ts): 조준 = today's ult
// re-centred on the aimed point (area ults) or turned toward it (direction ults); 드래그 = blink to the point, today's ult.
// Only this file (and src/render/ultTest/groupA.ts) belongs to the group-A content track.
//
// Shape (src/data/ultTest/types.ts UltAltDef = the existing ult SkillDef + move / aimRange / botAim):
//   guardian: {
//     aim:  { id: 'guardian_ua', name: '…', slot: 'ult', description: '…', castTime: ULT_CAST_TIME, actions: [ … ] },
//     drag: { id: 'guardian_ud', …, move: { kind: 'dash', maxRange: 8 }, actions: [ … ] },
//   },

import type { UltAltSet } from './types';

export const GROUP_A: Record<string, UltAltSet> = {};
