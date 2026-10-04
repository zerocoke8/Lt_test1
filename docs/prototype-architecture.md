# 프로토 구조 (웹)

- 스택: Vite + TypeScript + Canvas 2D (엔진 없음). 테스트는 Vitest, 브라우저 확인은 Playwright.
- `npm run build` 하면 `dist/index.html` 한 파일로 나옴 (vite-plugin-singlefile).
- 멀티플레이(게임 서버, 매칭, 배포)는 [`docs/multiplayer.md`](multiplayer.md).

## 모듈과 경계

| 경로 | 역할 | 의존 |
|---|---|---|
| `src/types.ts` | **공용 계약**. GameState(읽기 모델), Command(입력), GameEvent(연출), Tunables, 모듈 API | — |
| `src/config.ts` | 기본 튜닝값, 상수(틱, 아레나 크기, 봇 프리셋, 몬스터 해금 층) | types |
| `src/data/*` | 임시 콘텐츠: 캐릭터 12 (역할별 3), 펫 8, 일반몹 5, 중형보스 2, 보스 1, 보상, 유물 | types |
| `src/sim/*` | 게임 규칙 전부. DOM/Canvas 접근 금지. 고정 틱(30Hz), 시드 랜덤(`Rng`) | types, config, data |
| `src/sim/geometry.ts`, `src/sim/preview.ts` | 순수 함수: 형태 판정(circle/line/rect/cone/ring/cross, 돌진), 드래그 미리보기 파트(`previewPartsFor`) | types, data |
| `src/render/*` | Canvas 쿼터뷰 렌더링. GameState를 읽기만 함 | types, config, data, sim의 순수 모듈 |
| `src/ui/*` | DOM HUD, 드래그 입력, 화면(프리셋/매칭·방/보상/결과), 디버그 패널, 앱 루프 | types, config, data, sim(createGame + 순수 모듈), render(createRenderer), net |
| `src/net/*` | 멀티플레이 클라이언트: 연결, 로비, `RemoteGame`(서버 스냅샷 → `Game` 인터페이스) | types, config, sim의 순수 모듈 |
| `server/*` | Node 게임 서버 (방, 서버 권위 sim, 스냅샷) → `dist-server/index.js` | types, config, data, sim, net/protocol |
| `src/main.ts` | 진입점 → `ui/app.ts`의 `startApp()` | ui |

규칙:
- sim만 GameState를 바꿈. render/ui는 읽고 `game.dispatch(Command)`로만 요청.
- 연출(데미지 숫자, 스킬 이펙트)은 `game.drainEvents()`의 GameEvent로 전달.
- 봇은 플레이어 슬롯의 조작 주체만 다름 (`PlayerState.isBot`). 봇도 같은 Command를 dispatch (sim 내부 `bot.ts`).
- 숫자는 `Tunables`(디버그 슬라이더로 실시간 조절)나 `src/data`에 둠. 코드에 하드코딩하지 않음.
- render/ui/net이 sim에서 가져다 쓰는 것은 **상태를 바꾸지 않는 순수 함수만**: `sim/geometry`(형태), `sim/preview`(미리보기 파트), `sim/players`의 `canSwapState`/`canUsePetState`/`canUltState`. 그래서 멀티 클라이언트도 서버 sim과 같은 미리보기·판정 조건을 씀.
- `Zone.area`: 띠·고리·십자 등 원이 아닌 장판은 정확한 모양을 담음 (없으면 `radius` 원). 렌더러와 스냅샷이 그대로 사용.

## 화면 좌표

- 논리 해상도 1280×720. Canvas와 HUD를 같은 배율로 확대해 레터박스 처리.
- 월드 단위: 캐릭터 지름 ≈ 1. 일반층 아레나 36×12(가로 1.5화면), 보스층 24×12(한 화면).
- 쿼터뷰: 바닥 평면 (x, y)를 y축으로 눌러 그림. y가 클수록 화면 아래(카메라 쪽). y값으로 정렬해서 그림.
- 카메라는 내 필드 캐릭터를 가로로만 따라감. 필드가 비면 멈춤. 드래그 중에는 고정.
- 혼자 하기: sim은 30Hz, 화면은 60Hz → 렌더러에는 직전 틱과 지금 틱 사이를 이은 위치를 넘김 (`render/smooth.ts`, 최대 1틱 ≈ 0.03초 늦음, sim 상태는 건드리지 않음). 멀티는 `RemoteGame`이 스냅샷 사이를 보간.

## 규칙 체크리스트 (기획서 → 구현)

| # | 규칙 | 근거 |
|---|---|---|
| R1 | 1번 캐릭터가 필드에 있는 상태로 시작. 게임 시작 시 2·3번은 바로 교체 가능 | 원안, 가정 |
| R2 | 대기 카드를 드래그해서 놓은 지점에 등장 + 그 자리에서 드래그스킬. 기존 캐릭터는 사라짐 | 1차 6 |
| R3 | 드래그 중 드래그스킬 범위 표시. 필드 캐릭터 재드래그 불가 | 1차 6 |
| R4 | 재등장 쿨 = 캐릭터별 swapCooldown(8~12초) = 드래그스킬 쿨. **등장 순간부터** 돎 (1번 캐릭터는 t=0에 등장한 것으로 봄). 공통 쿨 없음. 등장 연출 0.5초 동안 교체 불가 + 무적 (층 시작 재등장도 같음) | 1차 7, 23, 가정 |
| R5 | 이동·평타·일반스킬 완전 자동 | 1차 4 |
| R6 | 타겟: 가장 가까운 적. 잡으면 죽거나 사라질 때까지 유지. 예외 없음(몬스터 종류·역할 무관, 도발 없음). 근처에 없으면 맵에서 찾아 이동, 없으면 대기 | 1차 5, 2차 Q4 |
| R7 | 몬스터도 같은 규칙. 노리던 캐릭터가 교체로 사라지면 새로 가장 가까운 대상 | 1차 5 |
| R8 | 디버그 토글 `bossLockReleaseSec`: 0이 아니면 보스 타겟을 N초 뒤 해제 | 2차 Q4 |
| R9 | 궁극기 게이지: 플레이어마다 1개, 내 캐릭터 3명 공용, 시간으로만 충전(ultChargeTime). 가득 차면 탭 → 필드 캐릭터가 사용. 필드가 비면 사용 불가 | 1차 8, 2차 Q1 |
| R10 | HP는 캐릭터별. 죽으면 reviveTime(30초) 뒤 카드로 부활(HP reviveHpFrac). 자동 등장 없음: 유저가 직접 드래그 | 1차 9 |
| R11 | 내 캐릭터 3명이 동시에 죽어 있으면 그 플레이어는 사망(관전). 플레이어 3명 모두 사망하면 런 실패 | 2차 Q3 |
| R12 | 대기 중: 쿨만 돎, HP 회복 없음, 피해 없음, 버프·디버프 시간은 흐름. 내려간 캐릭터의 장판·소환물은 남음 | 1차 19 |
| R13 | 패시브는 필드에 있을 때만. 스킬 대상·조준은 데이터로 지정 | 1차 20, 21 |
| R14 | 펫: 8종 중 3마리. 드래그해서 놓은 지점에서 발동, 교체 아님. 펫마다 쿨 | 1차 4, 2차 Q6 |
| R15 | 일반층: 웨이브를 waveInterval마다 스폰(4~6마리, 동시 최대 maxAliveMonsters, 넘치면 미룸), 스폰 1초 전 바닥 마커, 가장자리 6~8곳. 웨이브 수는 정해져 있음(`FLOOR_WAVES`: 1층 5, 층 번호마다 +1, 최대 10). 중형보스 1마리: midBossKillTrigger 처치 또는 midBossTimeTrigger초에 등장. 중형보스도 동시 최대에 걸리면 미룸, 적 소환은 남은 자리만큼 | 1차 12, 13, 가정 |
| R16 | 일반층 클리어 = 모든 웨이브 스폰 완료 + 중형보스 스폰 완료 + 살아 있는 적 0 | 1차 13 |
| R17 | 일반층 제한시간(normalFloorTime) 초과 = 런 실패 | 2차 Q2 |
| R18 | 보스층: 보스는 고정, 잡몹 소환(4~6, 광폭화 ×1.5) + 광역공격(예고 후 판정). 시간 초과 시 광폭화. 보스 HP 0 = 퇴각하며 클리어(쓰러지지 않음). 같은 틱에 퇴각과 전멸이 겹치면 퇴각(클리어)이 먼저. 광폭화 뒤 필드에 아군 캐릭터가 `BOSS_ENRAGED_EMPTY_FIELD_FAIL`(30)초 연속 없으면 실패(방치 방지) | 1차 22, 2차 Q2, 해석, 가정 |
| R19 | 층 클리어 시 상태 전부 유지 + 살아 있는 캐릭터 최대 HP 20% 회복. 다음 층은 직전 필드 캐릭터가 드래그스킬 없이 시작 | 1차 17 |
| R20 | 층 보상: 3개 중 1개, 레어도 일반/희귀/영웅. 일반층은 스탯·스킬, 보스층은 유물. 봇은 랜덤 선택. 보상 화면 동안 시간 정지 | 1차 14, 18 |
| R21 | 5층마다 보스. maxFloor(기본 20)까지, 도달하면 승리 | 2차 Q7 |
| R22 | 결과창: 플레이어별 기여도(딜량, 보스 피해, 받은 피해, 처치, 회복) + 튜닝 로그(분당 교체, 스킬별 피해 비중, 궁극기 대기 시간). 피해 집계는 초과 피해(overkill) 제외 | 1차 15, 리스크 메모 |
| R23 | 봇: 같은 규칙. HP 30% 이하면 교체, 아니면 20~30초마다. 착지 지점은 드래그스킬 범위 안 적이 가장 많은 곳 (사람처럼 자기 화면 `VIEW_WIDTH_UNITS` 안에서만). 궁극기는 가득 차고 0.5~3초 뒤. 펫은 쿨이 돌고 적이 있으면 | 1차 16 |
| R24 | 디버그: 슬라이더(Tunables 전부), 궁극기 충전, 쿨 초기화, 적 전멸, 층 건너뛰기/이동, 광폭화 강제, 무적, 게임 속도 | 리스크 메모 |

## 테스트

| 명령 | 내용 |
|---|---|
| `npm test` (`npx vitest run`) | Vitest 31파일 314개: sim 규칙(R1–R35, 형태 판정 = 미리보기, 12종 로스터, 멀티 플레이어 보상·봇 교대), 렌더 카메라/불변성/형태/솔로 틱 보간, UI 로직, 게임 서버(`tests/net`: 방·명령·스냅샷·끊김/재접속, 늦은 명령·서버 제한·5초 핑), 연결(4001·조용한 끊김·서버 깨우기), `RemoteGame`(보간·끊김 감지), 리뷰 테스트(`tests/review`) |
| `npx tsc --noEmit` / `npm run typecheck:server` | 타입 검사 (브라우저 + 테스트 / 서버) |
| `npm run e2e` (`npx playwright test`) | Playwright 3개 프로젝트 (아래). 시작할 때 `vite build` → `vite preview :4173` |
| `PERF=1 npx playwright test perf` | 실시간 프레임 측정 (40초 일반 플레이 + 몹 30마리·궁극기 스트레스) |

Playwright 프로젝트 (`playwright.config.ts`, Chromium은 `/opt/pw-browsers/chromium`):
- `phone` (844×390@3x, 터치) / `desktop` (1280×720, 마우스): 아래 솔로 스펙.
  - `tests/e2e/smoke.spec.ts`: 프리셋 → 전투 → 실제 포인터 드래그로 교체/펫 → 궁극기 탭 → 1층 클리어·보상 → 5층 보스 광폭화·퇴각 → 유물 → 포기 → 결과. 콘솔 에러 0. 폰 스크린샷은 `docs/screenshots/*.png` (솔로 세트).
  - `tests/e2e/flows.spec.ts`: 일반층 시간 초과 실패, 보스층 시간 초과 광폭화, 최고층 승리, 전멸 → 관전 → 결과 (관전 띠·멈춘 숫자 없음, `docs/screenshots/spectate.png`), 바닥 맨 아래 조준(손가락이 카드 줄 위여도 놓기 가능), 세로 화면 정지, PC 단축키.
  - `tests/e2e/artifact.spec.ts`: claude.ai Artifact 빌드(`scripts/make-artifact.mjs`)를 게임 서버 없는 정적 호스트에 올린 것처럼 띄움 → 페이지 말고는 요청 0개(/healthz·WebSocket 없음), 콘솔 에러 0, "혼자 하기 전용" 안내, 출발 → 혼자 하기. 일반 빌드는 같은 호스트에서 /healthz 한 번(404)만 묻고 재시도 없음.
- `multi`: `tests/e2e/multi.spec.ts` — 빌드한 실제 게임 서버(`dist-server`) + 폰 브라우저 3개, 조용한 끊김(오프라인 폰), 탭 복제. 자세한 흐름은 `docs/multiplayer.md` 5장. 스크린샷 `docs/screenshots/multi-*.png`.
- 리뷰용 멀티 UI 확인(2번 자리 플레이어, 메뉴 아래 Space 궁극기 없음): `npx playwright test -c tests/review/playwright.multi-review.config.ts`.
- 다른 작업과 동시에 돌릴 때: `E2E_PORT=4191 E2E_OUT=<빌드 폴더> E2E_RESULTS=<결과 폴더> npx playwright test`.
- 테스트용 훅: `window.__proto` (`game`, `phase`, `mode`, `localPlayer`, `net`, `startRun(overrides)`, `ui.dragTo`, `ui.fingerFor`, `ui.dragPreview`).

## 멀티플레이 구조 (3차)

| 경로 | 역할 |
|---|---|
| `src/net/protocol.ts` | 클라이언트↔서버 메시지 계약 (공용) |
| `src/net/*` | 브라우저 쪽: WebSocket 연결, 로비 클라이언트, `RemoteGame`(서버 스냅샷을 `Game` 인터페이스로 감쌈) |
| `server/*` | Node 게임 서버: 정적 파일(dist) 제공 + `/ws` WebSocket, 방 관리, 방마다 `src/sim` 실행(서버 권위) |

- 서버가 30Hz로 sim을 돌리고 15Hz로 스냅샷(GameState + 그 사이 이벤트)을 보냄. 클라이언트는 유닛마다 최근 스냅샷 위치(서버 시각)를 들고 "서버 지금 − 지연"에서 보간해서 그림. 지연 = 스냅샷 간격 + 측정한 도착 흔들림(+0.01초, 0.05~0.35초) → 늦은 스냅샷 하나에 유닛이 멈추지 않음.
  - 스냅샷은 sim 내부 값(`rt`, `src`)을 빼고 소수 2자리. 클라이언트가 안 쓰는 값은 줄임: 웨이브 구성(`plan.waves[].spawns` → 빈 배열, 개수만 씀), `targetHeldFor`(정수 초). 튜닝값은 바뀔 때 + 1초마다, 튜닝 로그(telemetry)는 런이 끝난 뒤에만.
  - 측정(브라우저 3개, 실제 서버): 스냅샷 원본 JSON 평균 6~7KB(일반)·16KB(몹 30마리, 최대 25KB), 실제 전송량(permessage-deflate) 클라이언트당 4.6KB/s(일반)·13KB/s(스트레스). 숫자는 `docs/multiplayer.md` 6장.
- 클라이언트는 `Command`만 보냄. 서버가 보낸 사람의 슬롯 번호로 `player`를 덮어씀. 디버그·튜닝 명령은 방장만.
  - `cmd.atTick` = 보낼 때 가진 최신 스냅샷의 틱. 서버는 그 스냅샷을 보낸 지 `MAX_COMMAND_AGE_MS`(2초)가 넘은 교체·펫 명령을 거절 (조용한 끊김 뒤 옛 위치로 교체되는 것 방지).
- 연결 (`src/net/connection.ts`): 응답 없는 서버는 3분 동안 다시 확인('probing'), 정적 호스트(404 등)는 한 번만. 온라인 중 핑에 5초 동안 아무것도 안 오면 소켓을 새로 염. 닫힘 코드 4001(다른 탭이 같은 토큰으로 접속)이면 다시 접속하지 않고 'replaced' → "여기서 계속"으로만 되찾음.
- `RemoteGame.stalled`: 게임 중 1.5초 동안 스냅샷이 없으면 HUD 배너 + 교체·펫·궁극기·보상 거절, 5초면 `reconnectNow()`.
- 서버(`server/*`): 핑 5초마다(응답 없는 소켓은 5~10초 안에 끊고 자리를 봇에게), 전체 제한 `maxConnections`·`maxConnectionsPerIp`·`maxPlayingRooms`(넘으면 503 / `error: server_busy`), 파티 안 같은 캐릭터·펫 중복은 거절(플레이어끼리는 허용).
- UI는 `Game` 인터페이스만 사용 → 솔로(`createGame`)와 멀티(`RemoteGame`)가 같은 화면 코드를 씀. 내 슬롯 = `localPlayer`.
- claude.ai Artifact 빌드(`npm run build:artifact`)는 솔로 전용: `make-artifact.mjs`가 `window.__SWAP_TOWER_SOLO__ = true`를 넣어서 /healthz 확인도 WebSocket도 하지 않음 (네트워크 요청 0, 콘솔 에러 0).

## 규칙 체크리스트 추가 (3차)

| # | 규칙 | 근거 |
|---|---|---|
| R25 | 캐릭터 12종 (역할별 3), 프리셋에서 3명 선택 | 3차 1 |
| R26 | 드래그스킬 형태: rect(가로·세로 띠, 직선), cone, ring, cross(+/X), 돌진(dash), 여러 지점(offset+delay), circle | 3차 2 |
| R27 | 방향형 스킬은 데이터에 고정된 방향(dir)을 씀. 놓은 위치가 기준점. 미리보기 = 실제 판정 범위(모든 파트, 오프셋, 돌진 경로) | 3차 2 |
| R28 | 돌진: 놓은 지점에 등장 → dir 방향으로 distance만큼 이동하며 경로상 적 타격, 끝 지점에 멈춤(아레나 안으로 보정) | 3차 2 |
| R29 | 봇 착지 지점은 실제 형태(파트 전체)로 적을 가장 많이 맞히는 곳 | R23 확장 |
| R30 | 매칭: 프리셋 다음 화면. 닉네임, 방 목록, 방 만들기, 코드로 참가, 혼자 하기 | 3차 3 |
| R31 | 방 최대 3명. 방장만 시작. 시작하면 빈자리를 봇 프리셋으로 채움. 게임 중인 방에는 새로 못 들어감 | 3차 3 |
| R32 | 서버 권위: 모든 판정은 서버 sim. 명령의 player는 서버가 보낸 사람 슬롯으로 강제. 기준 스냅샷이 2초보다 오래된 교체·펫 명령은 거절 | 3차 3 |
| R33 | 층 보상: 사람마다 자기 보상을 고름. 모두 고를 때까지(최대 20초) 다음 층 대기. 시간 초과면 랜덤 | 가정 |
| R34 | 게임 중 연결 끊김 → 그 슬롯을 봇이 조작(`setPlayerBot`), 같은 토큰으로 재접속하면 복귀 (같은 기기·브라우저: 새로고침, 탭을 닫았다 다시 열기). 조용한 끊김도 5~10초 안에 봇. 같은 토큰의 두 번째 탭이 자리를 가져가면 이전 탭은 멈춤("다른 탭에서 접속 중"). 방장이 나가면 다음 사람이 방장 (자동 방 이름 "○○의 방"도 따라 바뀜) | 가정 |
| R35 | 멀티에서는 일시정지 없음. 디버그 패널·튜닝은 방장만, 모두에게 적용 | 가정 |

## 3차 리뷰·플레이테스트 반영 (2026-10-04)

수치·동작 변경 (숫자는 데이터/설정에 있음):

| 항목 | 전 | 후 | 위치 |
|---|---|---|---|
| 워든 속박의 고리 안쪽 빈 원 | 1.2 | 0.6 (무리 위에 놓아도 가운데 적이 맞음. 벤치: 무리 위 4.1명·50 피해 vs 최적 4.5명·57, 전에는 2.7명·30) | `src/data/characters.ts` |
| 범위 보상: 고리 | 안쪽·바깥 둘 다 커짐 | 바깥만 커짐 (빈 원 크기 유지) | `src/sim/geometry.ts` `scaleArea` |
| 범위 보상: 십자 | 팔 길이만 | 팔 길이 + 두께 (띠·직선과 같음) | 같은 곳 |
| 서버 핑 간격 | 15초 | 5초 | `server/server.ts` `heartbeatMs` |
| 서버 전체 제한 | 없음 | 소켓 300, 주소당 16, 동시 게임 20 (Render 무료 `MAX_GAMES=3`) | `server/server.ts`, `render.yaml` |
| 늦은 교체·펫 명령 | 그대로 적용 | 기준 스냅샷이 2초보다 오래되면 거절 | `src/net/protocol.ts` `MAX_COMMAND_AGE_MS` |

화면: 관전 중에는 카드·펫의 멈춘 숫자 대신 "사망"/"—", 관전 안내는 바닥 아래 얇은 띠 + 보조 버튼, 보상 화면은 "관전 중 · 보상 없음". 전투 카드 왼쪽 위에 드래그스킬 모양 배지. 다른 플레이어의 스킬 연출·장판은 0.55 세기 (`render/look.ts` `OTHER_PLAYER_FX`). 드래그 미리보기 테두리에 흰 점선(적 예고와 구분), 들고 있는 카드는 반투명. 바닥 맨 아래쪽을 조준해 손가락이 카드 줄 위에 있어도 착지 지점이 바닥이면 놓을 수 있음.
