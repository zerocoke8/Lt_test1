// 기획 22차 궁극기 테스트 — 그룹 A의 조준 / 드래그 궁극기 추가 연출 (docs/ult-test.md 6장). Characters: guardian · paladin ·
// warden · blade · berserker · shadow · ranger · mage. Only the group-A content track edits this file.
//
// Register a module for extras (most alt ults need none — their stages are drawn by the stage tables / generic land):
//   registerUltFx({
//     onEvent(ev, view) {
//       if (ev.type === 'skillStage' && ev.skillId === 'mage_ua' && ev.stage === 'nova' && ev.hit === 0) {
//         view.host.ring(ev.center.x, ev.center.y, 0.3, 4, 0.5, '#9ad8ff', 4, 0.1);
//       }
//     },
//   });

import { registerUltFx } from './index';

void registerUltFx; // (no group-A extras yet)
