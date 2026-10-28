// 기획 22차 궁극기 테스트 — 그룹 B의 조준 / 드래그 궁극기 추가 연출 (docs/ult-test.md 6장). Characters: gunner · cleric ·
// medic · exorcist · bard · chrono · puppeteer. Only the group-B content track edits this file.
//
// Register a module for extras (most alt ults need none — their stages are drawn by the stage tables / generic land):
//   registerUltFx({
//     onEvent(ev, view) {
//       if (ev.type === 'skillStage' && ev.skillId === 'cleric_ua' && ev.stage === 'halo' && ev.hit === 0) {
//         view.host.ring(ev.center.x, ev.center.y, 0.3, 3, 0.6, '#ffe8a3', 4, 0.15);
//       }
//     },
//   });

import { registerUltFx } from './index';

void registerUltFx; // (no group-B extras yet)
