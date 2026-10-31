# 아트 · 모션 · 효과음 리뉴얼 인계 (24차 → 새 가지 `art/renewal`)

> 기준 커밋 `ab97de5`(기획 24차), 2026-10-31. 경로는 저장소 기준, `파일:줄`은 `ab97de5` 기준.
> 「확인 못 함」 = 이번에 확인 못 함. 「확인 필요」 = 바깥 제품 사실인데 1차 출처로 못 굳힘. 「제안」 = 아직 안 정함. 「추론」 = 출처 숫자로 계산.
> 함께 읽을 것: `docs/current-rules.md`(지금 규칙 · 열린 질문), `docs/art-asset-inventory.md`(그림 목록 · id · 크기 · 효과음 순서 · 검사 표). 폴더 · 이름 · 시트 형식 · 정할 것 목록은 **이 문서가 정본**.

## 0. 이 문서 쓰는 법

**디자이너 1분 요약**
- 플레이(규칙 · 숫자 · 멀티)는 그대로. 그림 · 동작 · 효과음만 새로 만들어요.
- 새 가지는 푸시해도 라이브 게임에 안 올라가요. 폰에서는 새 비공개 아티팩트로 봐요.
- 지금 답할 것은 넷이에요. 나머지는 「추천대로」면 돼요.
  1. 그림체: 25차에 후보 3~4개를 보고 고름 (11장 1번).
  2. 시험 조합: 가디언 + 외발 우산 + 로비 (11장 2번).
  3. 폰으로 보는 길: 새 비공개 아티팩트 (7장 2번).
  4. 25차 영상 돈 상한: $50 (11장 17번).
- 순서: 9장 「디자이너 준비」 → 메인 세션이 이 세 문서를 커밋 · 푸시(문서만이라 배포 안 됨) → 아래 상자를 **PC의 Claude Code** 새 세션에 붙여 넣기.

**새 세션**: 2 → 4 → 5 → 10장 순서로. 7장은 새 세션이 정해도 되는 기술 결정. 바깥 제품 사실([S*])은 25차 첫 일로 1차 출처를 다시 확인, 디자이너용 글에는 모델 이름을 뺌.

### 새 세션 시작 문장 (그대로 붙여 넣기)

```text
이 PC(Windows)의 Claude Code에서 시작해 줘. 아트·모션·효과음 리뉴얼이야.

1. 가지: `claude/design-notes-v0`을 pull 해서 최신으로(24차 ab97de5 + 인계 문서 커밋). 거기서 새 가지 `art/renewal`을 만들어. 이 일은 이 가지에서만 해.
2. 먼저 읽을 것(이 순서): CLAUDE.md → docs/art-renewal-handoff.md → docs/current-rules.md → docs/art-asset-inventory.md
3. 목표: 지금 플레이(규칙·숫자·멀티)는 그대로. 그림(캐릭터·몬스터·보스·배경·UI·효과), 동작, 효과음은 모두 새로. 그림은 Codex 이미지 생성, 동작은 시댄스 2.5 영상 → 스프라이트. 효과음 도구는 인계 11장 질문으로 나한테 물어봐 줘.
4. 이번 차(25차): 그림체 정하기 + 파이프라인 시험.
   - 그림체 후보 3~4개를 캐릭터 1·몬스터 1·배경 1로 그려서 보여 줘.
   - 내가 고르면 캐릭터 1명의 필수 7동작(대기·이동·공격·시전·등장·피격·사망) + 몬스터 1 + 배경 1을 끝까지 만들어 게임에 넣어 줘.
   - 「그림: 코드 / 새 그림」 스위치로 둘을 비교할 수 있게.
   - 효과음은 분위기 문장 시험 15개만.
5. 지킬 것: src/sim, src/data 숫자, server, 통신(프로토콜 8)은 건드리지 않기, sim 골든 테스트 다시 기록 안 하기. CLAUDE.md와 다르면 이 가지에서는: 아티팩트 XERw… 안 덮음, 푸시해도 배포 안 됨(Actions 수동 실행 금지), PixiJS 보류(인계 7장 1번).
6. 늘 하던 대로(CLAUDE.md): 한국어 쉬운 말 · 번호 질문 + (추천), 큰 일은 Workflow(설계 2관점 → 문서 → 만들기 → 통합 → 독립 검토 → 고치기), 반쯤 된 것은 커밋 안 함, 키는 내가 .env.local에 직접(읽거나 출력하지 않기), 바뀐 것은 폰 크기(844×390) 사진과 짧은 영상으로.
```

---

## 1. 지금까지 (1~24차)

커밋 44개. 차수별 결정은 `docs/game-design.md`(24차 = §37 → 25차는 `## 38. 25차 결정`), 지금 규칙은 `docs/current-rules.md`. 1~7차 교대 자동전투 · 멀티 → 8~14차 괴담 빌딩 · 괴담 방 · 힐러 · 그로기 · 컷인 → 15~21차 원정 · 저스트 · 층 보상 · 효과음 456 · 보스 레이드 → 22~24차 궁극기 테스트 · 연출 · 충격 프레임 · 「충전」.

---

## 2. 지킬 것 (플레이 기반)

판정은 `src/sim`, 그림은 `src/render`(Canvas 2D), UI는 `src/ui`(DOM), 소리는 `src/audio`. 렌더는 상태를 읽기만 함 → **그림 · 동작 · 소리만 바꾸면 플레이는 안 바뀜.**

- **건드리지 않는 곳**: `src/sim/**`, `src/data/**`(숫자 · id · 모양 · 시간 · 색), `src/config.ts`, `server/**`(예외: `server/http.ts`의 `TYPES` 표에 형식 추가만), `src/net/**`, `src/types.ts`의 sim · 통신 모양. 프로토콜 8.
  - 데이터 `color`도 그대로: 투사체 색은 sim 상태(`Projectile.color`, `src/types.ts:1138`)에 실림 — 값은 `src/sim/units.ts:470`의 `charDef.color ?? monDef.color`. 렌더는 이 색으로 투사체 모양을 찾음(`src/render/index.ts:2185–2191`). 데이터 색을 바꾸면 스냅샷도 바뀜.
  - 데이터 id도 그대로: 소리 id가 데이터 id로 만들어짐.
- **골든 · 결정론 — 다시 기록 금지**: `tests/sim/default-off-golden.test.ts`, `determinism.test.ts`, `healers.test.ts` `GOLDEN`(:361), `boss-raid.test.ts` `GOLDEN_ORDER_SEED_1`(:113, 검사 :89). 깨지면 그림 일이 플레이를 건드린 것 → 되돌리기.
- **모양 = 판정**: 적 예고 · 장판 · 미리보기 · 조준선 · 안전 자리 구멍은 sim 모양 그대로(`tests/render/shapes-render.test.ts:76`). 테두리 안 무늬만 그림으로. 정보 표시(HP 바, 이름표, ▼, 숫자, 콜아웃, 화면 밖 화살표, 표식 배지, 중형보스 왕관 · 바닥 고리)는 코드.
- **시간은 sim이 정함 — 영상을 sim에 맞춤**:
  - 기본 공격 0.25초(`min(0.25, 공격쿨 × 0.8)`, `src/sim/constants.ts:9`, `src/sim/units.ts:456`), 근접 타격 0.07초 고정(`SWING_WINDUP` `src/render/vfx.ts:260`) → 0.25초면 28 %.
  - 등장: 잠금 0.5초(`src/config.ts:11`), 낙하 0.12초 + 찌그러짐 0.26초(`DASH_LAND` `src/render/dashtime.ts:2`).
  - 궁극기: 시전 0.5초, 컷인 `guard 0.5` · `firstHit 0.45`(`src/config.ts:94`). 스킬 시전 `castTime` 0.2~0.4초(`src/data/characters.ts`).
  - 보스 준비: 조각 `delay` × 「보스 예고 시간 배율」(`src/sim/units.ts:444`). 그로기: 쓰러짐 0.25 · 유지 5 · 일어남 0.8초(`src/render/groggyFx.ts`).
- **그림 규칙**: `GameState`를 바꾸지 않음(`renderer.test.ts`), `shadowBlur` 금지(`:223`), 히트스톱 동안 렌더 시계 `time`이 멈춤(`index.ts:1726`) → 프레임은 `time` · `animProgress`로(`performance.now()` 금지). 그림 스위치는 이 기기만. `worldToScreen / screenToWorld` 정확히(드래그 입력 · e2e · 소리 좌우). 멈춤 · 흔들림 · 어둡게는 내 큰 박자만. 궁극기 테스트 30개는 글자 없음(24차) — 새 그림 · 영상에도.
- **유지할 모듈**: 소리가 쓰는 `DASH_LAND`, `ULT_FX`, `TOUCHDOWN` · `touchdownAt` · `ultLook`(`render/ultTest/settings.ts` · `stories.ts`). UI가 쓰는 `render`의 `gearArt` `juice` `ultTest/settings` `look` `cutin` `smooth` `shapeIcon` `justFx` `camera` `bosses/body`.
- **바꿔도 되는 곳**: `src/render/**`, `src/ui/**`의 보이는 것 · CSS, `src/audio/files/*`(mp3 · `levels.json` · `generated.json`), `scripts/sfx-prompts*`, 새 `src/assets/**`, 새 `scripts/art-*.mjs`, `vite.config.ts` 파일 규칙, `tests/**`(새 검사 · Chromium 경로), `.gitignore` · `.dockerignore`, `docs/**`, `.github/workflows/`(아트 가지 전용 · 가지 조건).

---

## 3. 바꿀 것 → 목록 · 숫자는 `docs/art-asset-inventory.md` 0-1

그림 파일 0장 — 모두 코드 그림. 캐릭터 15(같은 캡슐 몸 + 소품 9종) · 펫 8 · 아군 소환물 9 · 몬스터 13 · 중형 6 · 보스 20 · 소환 · 돌발 9 · 배경 판 11 + 보스 바닥 8 · UI · 효과(전부 코드) · 효과음 456(6,097,169 바이트). 어림: 움직이는 프레임 약 2,200장 + 정지 그림 약 450장.

---

## 4. 구조와 끼워 넣을 자리

### 4-1. 렌더가 받는 것
- `createRenderer(canvas)`(`src/render/index.ts:78`) → `render(state, events, realDt, ui)`(`src/types.ts:1734`).
- 유닛(`Entity`, `types.ts:890`): `defId`, `pos`, `radius`, `facing`, `anim`(`idle` `move` `attack` `cast` `appear` `stunned`, `:911`), `animTime`. 진행 = `animProgress`(`src/render/units.ts:182`). 한 번짜리 연출은 `GameEvent`(46종), 유닛별 연출 기록은 렌더 메모(`UnitMemo`).
- 멀티: 스냅샷 15 Hz, `plan.waves[].spawns`가 비어서 옴 → 다음 웨이브 몬스터를 미리 못 앎.

### 4-2. 좌표 · 크기
- 논리 1280×720, 가로 24칸 → 1칸 53.33 px, 바닥 세로 1칸 29.33 px(눌림 0.55, `src/render/camera.ts:14`), 높이 1칸 42.67 px. 화면 y = 150 + wy × 29.33. 경기장 24×12 = y 150~502, 카메라 고정. 화면 띠: 벽 40~150 · 바닥 150~502 · 절벽 502~548.
- 폰 844×390: 무대 ×0.5417, 백버퍼 논리 px당 1.625(PC 최대 2, 느리면 1).
- 그리는 순서: 배경 → 보스 바닥 → [clip: 장판 · 아군 예고 · 바닥 효과] → 그림자 · 고리 → 고정 보스 → 적 예고 → 잔상 → 유닛(y 순, 내 것 마지막) → 투사체 · 공중 효과 → 머리 위 정보 → 화면층 → DOM HUD(`index.ts:1853–1965`).
- 방향은 좌우만: `s = cos(facing) >= 0 ? 1 : −1`(`index.ts:1338`). 오른쪽 보기로 그리고 뒤집음.

### 4-3. 프레임 크기 · 동작 (표는 인벤토리 0-3 · 2-2)
- 8차 줄(`docs/prototype-architecture.md:233`)은 반지름 0.5로 계산 — **실제 `CHAR_RADIUS` 0.45**(`src/sim/constants.ts:5`) → 몸 **44×57 논리 px**(폭 `units.ts:188`, 키 ×1.3 `look.ts:117`). 소품(앞 41 · 위 68)까지 좌우 대칭이면 PC 2배 164×136 → 128은 작음.
- **프레임 크기**(그림 한 장의 틀; 월드 1칸과 다른 말, 제안): 캐릭터 **192×192**(논리 96², 기준점 [96, 176]) · 일반 몬스터 128(큰 넷 `golem` `iv_zombie` `eye_stalk` `red_mask` 192) · 중형 256×256(`signal_man`만 256×320, 왕관은 코드) · 움직이는 보스 보스마다 256~512(긴 변 320~512) · 고정 보스 부품별(원본 800×700+) · 배경 원본 2640×1520(논리 사방 20 px 흔들림 여유, 16의 배수) · 보스 바닥 2560×704 · 초상 256² · 컷인 상반신 512×640 · 효과 논리 × 2.
- **코드 변형과 스프라이트**: 그 동작의 스프라이트가 있으면 그 동작의 코드 변형(`computePose` `index.ts:958–1096`의 `z` · `lean` · `hMul` · `wMul` · `tilt`; 걷기 `:1031–1037`)을 끔 — 두 번 튕기지 않게. 남기는 것 = 사건 변형(피격 튕김, 착지 찌그러짐, 궁극기 크기 ×1.22 · ×1.14 · 뜸). 사건 변형은 영상으로 만들지 않음. 무기 회전(`swing` · `recoil`)은 그림에서 뺌.
- **재생 시계**: 대기 = 렌더 시계 반복 ≈ 2.42초(`sin(time × 2.6 + m.phase)`, 위상 `id × 1.618` `units.ts:96`). 이동 = 두 걸음 0.628초(`sin(time × 10 + m.phase)`, 속도와 무관) → 프레임 `floor(frac((time × 10 + m.phase) / 2π) × 8)`. 공격 · 시전 · 등장 = `animProgress`; 근접 타격 프레임 = `animProgress` ≥ 0.07 / 동작 길이인 첫 프레임(보통 28 %). 보스 몸 = `idle` `walk` `windup` `attack` `groggy`(`src/render/bosses/types.ts:13`), 걸음 1주기 1.3칸. 프레임 수는 인벤토리 2-2(25차 = 필수 7동작, 선택 4동작은 26차).
- **걷기**: 가디언 `moveSpeed` 3.2(`src/data/characters.ts:55`) → 두 걸음에 약 2칸(107 논리 px) = 「달리기」 느낌. 미끄러져 보이면 렌더만으로 「간 거리로 프레임 고르기」를 시험.

### 4-4. 끼워 넣을 자리 (가장 작은 수정)
- **몸**: `drawBody`(`src/render/units.ts:518–861`)를 부르는 곳 10곳: `index.ts:1376`(필드), `vfx.ts:2499 / 2518 / 2522 / 2529`(잔상 · 죽음 · 퇴장), `justFx.ts:229–230`, `cutin.ts:422 / 637`, `gearArt.ts:234`(원정 인형). **25차 분기는 `index.ts:1376` · `vfx.ts` 4곳 · `justFx.ts` 2곳만.** 컷인(2.8배라 흐려짐 → 컷인 초상은 따로) · 원정 인형 · 장비를 낀 몸(`gear` 인자)은 26차까지 코드 그림. 분기에서도 중형 왕관(`crown` `units.ts:293`, 부름 `:860`)은 그림. 자세는 모듈 변수로(본보기 `HERO_POSE` `units.ts:67`). `UnitLook`에 `id`를 `makeLook`(`look.ts:171`)에서 더함.
- **흰 번쩍임 · 잔상 · 내 외곽선**: 스프라이트마다 흰 실루엣을 한 번 구워 둠(`source-in`, 매 프레임 필터 금지). 내 캐릭터 외곽선(검정 4.5 + 플레이어 색 2.5 px, 「나」, ▼; `index.ts:1483–1506`, `units.ts:1018–1037`)도 이것으로 → 25차 완료 기준.
- **투사체** `drawProjectiles`(`index.ts:1570`) · `drawStyledProjectile`(`:2193`). **고정 보스** `drawBossArt`(`src/render/boss.ts:58`). **움직이는 보스** `drawBossBody`(`bosses/body.ts:265`). **보스 바닥** `BossStage`(`bosses/stage.ts:20`, `bake()` :66). **배경** `Backdrop.bake()`(`src/render/ground.ts:113`, 층마다 한 번; 위 HUD가 y 약 92 위를 가림, 바닥은 낮은 대비).
- **DOM 초상** `portrait()` · `petIcon()`(`src/ui/preset.ts:74 / 81`). **컷인 띠 초상** `cutin.ts`(띠 1760×273.6, 캐시 `:370`). 장비 겹치기(`drawGearBack/Armor/Charm/Front`)는 26차.

### 4-5. 파일 표 + 코드 예비 (반만 있어도 늘 플레이 가능)
- 본보기: 장비 그림 `src/render/gearArt.ts`(`:15`, 파일 없으면 코드), 효과음 `src/audio/manifest.ts`. `import.meta.glob('../assets/art/**/*.{webp,png}', { eager: true, query: '?url', import: 'default' })` + JSON. 이름 목록은 데이터(`CHARACTERS` `MONSTERS` `BOSSES` `PETS` `ZONES`)에서. 모르는 이름 경고 + 크기 예산 테스트(`tests/render/gear.test.ts:105–139` 본보기).
- 이름 제안(id는 코드 id 그대로, 인벤토리 11장): `src/assets/art/units/<defId>.*`, `bosses/<bossId>.*`(고정 보스 부품 `-part-<이름>`), `stage/<bossId>-p<phase>.webp`, `zones/<theme>-<normal|boss>[-rift<n>].webp`, `portraits/<charId>.webp`, `fx/<name>.*`, `ui/<묶음>/<id>.webp`.
- 찾는 순서: `(id, 동작)` → `(id, idle)` + 코드 변형 → 코드 그림. 안 풀렸거나 Node(Image 없음)면 코드, 기다리지 않음.

### 4-6. 스위치 「그림: 코드 / 새 그림」
- 의존성 없는 모듈(본보기 `src/render/ultTest/settings.ts`), 예 `src/render/art/settings.ts` `ART.mode = 'code' | 'new'`.
- 이 기기 저장(제안 키 `swapTower.art.v1`; 본보기 `src/ui/storage.ts:138 / 162`, 장비 그림 토글 `src/ui/expeditionStore.ts:15`), 디버그 패널 + 일시정지 메뉴, URL `?art=code|new`(`src/ui/app.ts:162`가 URL 칸을 읽음). 라이브로 가는 가지에서는 기본 `code`.

### 4-7. 시트 형식 · 불러오기 · 빌드
- 시트 = WebP 1장 + JSON 1개, TexturePacker 「JSON hash」 모양(`frames` · `animations` · `meta`, PixiJS도 읽음). `meta`에 기준점(발 중앙), 배율, 동작별 재생(`loop` 렌더 시계 / `progress` `animProgress`), `hitFrame`. 투명 가장자리는 잘라 묶음.
- 불러오기: 우선순위 줄 + 동시 3개(소리 `FILE_JOBS` `src/audio/engine.ts:126` 본보기), `createImageBitmap`. 층 시작에 파티 · 펫 → `ZONES[zone].pool` · `mids` · `boss`(`src/config.ts:173`) → `plan.bossId` · `plan.nextBossId`. 구역이 바뀌면 놓아줌. 풀린 메모리 = 폭 × 높이 × 4: 192² 한 장 147,456 B → 근접 캐릭터 50장 ≈ 7.4 MB, 서로 다른 9명이면 ≈ 66 MB(추론) → 25차에 실제로 잰 뒤 예산.
- **클래식 해시**: `classic-look`은 캔버스 호출 · `Math.random` 순서 · `drawImage` 수까지 해시(`tests/render/classic-look.test.ts:73`) → **「코드」 모드 · Node에서는 시트를 불러오지도 `drawImage`를 부르지도 않음**(지키는 검사를 더함), 코드 길의 호출을 더하거나 빼지 않음.
- **빌드**: 지금 Fly 빌드는 소리 말고 모든 파일을 `index.html`에 base64로 넣음(`vite.config.ts:40`, 정규식 `SOUND_FILE` `:13`) → 그림 형식을 정규식에 넣어 따로 캐시되는 파일로. 서버는 해시 이름 파일을 이미 길게 캐시(`HASHED_ASSET` `server/http.ts:35`), `TYPES`에 png · webp · json 있음 → avif · webm · mp4만 추가. 보낸 파일을 메모리에 계속 둠(`:47–73`, 머신 256 MB).

---

## 5. 만드는 순서 (그림 파이프라인)

① **그림체 정하기**
- 후보 3~4개를 같은 캐릭터 1 · 몬스터 1 · 배경 1(+ 효과 1)로, 게임 크기로 줄인 사진도 함께(폰에서 몸 ≈ 24×31 CSS px → 굵은 외곽선 · 단순한 덩어리).
- 프롬프트: 스타일 문단 + 대상 + 변형(본보기 `docs/gear-art-prompts.md` 3장 · 7장). 늘 "no text, no letters, no numbers, no watermark" + 팔레트 hex + "약 30° 위에서 본 옆모습(오른쪽 보기), 전신, 발이 바닥에 보이게, 바닥 그림자 없음"(그림자 · 눌림은 게임이 그림). 프롬프트 `scripts/art-prompts/*.json`, 그림체 바이블 `docs/art-style.md`(제안).

② **Codex 이미지 생성**
- 내장 생성 = `gpt-image-2`, Codex 사용 한도에서 빠짐(평균 3~5배 빨리 닳음). 말로 부탁 또는 `$imagegen`, CLI `-i/--image`로 참고 그림 [S1][S2]. 결과는 `$CODEX_HOME/*` → `art/raw/`로 옮기기. 긴 변 ≤ 3840, 16의 배수, 비율 ≤ 3:1 [S2]. 그림 하나 = 호출 하나(확인 필요).
- **25차 첫 일**: 한 장으로 비대화 명령 · 저장 폴더 · 참고 그림 붙이는 법을 시험해 기록. 안 되면 디자이너가 Codex 앱에서 만들어 `art/raw/`에 넣는 손 길.
- **투명 배경 불확실**: "CLI `gpt-image-2` does not support `background=transparent`" [S2]. API의 `gpt-image-2.5-flare` · `-sunburst`는 투명 지원 [S3][S4](API 키 + 조직 인증). → 단색 배경으로 받아 지우기.
- **키 색은 대상마다**(대상 색과 먼 색, clip json `key` 칸): 기본 `#00FF00`. 초록 · 청록 대상(`slime` `#74c69d`, `warden` `#80b918`, `ranger` `#06d6a0`, `medic` `#2ec4b6`, 펫 `#80ffdb` · `#52b788`, 종이 인형 외곽선 `#3ddc84`)은 `#FF00FF` + despill 안 함.
- 캐릭터마다: 돌려보기 + 기본 자세(= 영상 첫 프레임) + 초상 + 컷인 상반신, 고른 기준 그림을 늘 참고로. API 값: `gpt-image-2` 1024² low/medium/high = $0.006/$0.053/$0.211 [S3].

③ **시댄스 2.5 영상**
- Dreamina Seedance 2.5, 모델 id `dreamina-seedance-2-5-260628` [S11]. 길: BytePlus ModelArk API(`https://ark.ap-southeast.bytepluses.com/api/v3`, `POST /contents/generations/tasks`, 비동기; 잔액 USD 30 초과 또는 플랜 · 리소스 팩) [S11] / fal.ai(약 2배 값) [S18] / Dreamina 앱(AI 표시 · C2PA, 한국 계정 — 확인 필요).
- 첫 프레임, 또는 첫 + 끝(같은 그림 허용 → 반복 동작; 멈춘 영상이 나온다는 3자 경고 → 확인 필요). 비율 `adaptive`(정사각 → 정사각) [S11]. 4~30초(정수), **24 fps**, 480p/720p/1080p(정사각 640²/960²/1440², 확인 필요), **알파 없음** → `output_format: "mov"`(H.264 yuv444p) [S12].
- `camera_fixed` · `seed` 안 됨 [S12] → 프롬프트에 "static locked-off camera, no zoom, no pan, no cuts, plain <키 색> background". 걷기 · 대기는 "running in place on the spot, feet return to the same spot" + 첫 = 끝 같은 그림. `generate_audio: false`(확인 필요). 주소는 **24시간** 뒤 사라짐 → 바로 내려받기 [S11]. 2.0과 섞지 않기 [S17]. 「예비 → 동작 → 따라감 → 복귀」, 먼지 · 충격은 따로 [S22]. 실제 사람 얼굴 참고 금지 [S11].
- 값: 공식 예시 720p 16:9 5초 $1.156 [S16] → 화소 × 초 비례로 정사각 4초 ≈ 480p $0.41 · 720p $0.92 · 1080p $2.08(추론; 1080p 단가가 다르면 확인 필요). 시험은 480p.

④ **스프라이트 만들기** (제안 스크립트, 아직 없음)
1. `scripts/art-frames.mjs`: `ffmpeg -i clip.mov art/raw/<id>/<motion>/%04d.png`(전 프레임) → 키 빼기 시작 값 `chromakey=0x00FF00:0.10:0.05,despill=type=green`(초록 키일 때, 미검증) [S29] → 접촉 시트.
2. 고르기: `art/clips/<id>/<motion>.json`(쓸 프레임 · 반복 구간 · 타격 프레임 · `key`). 걷기는 발이 닿는 프레임으로 두 걸음 한 주기를 찾아 8장을 고르게(4초 = 96장 중). 첫 = 끝 클립은 끝을 빼고 반복.
3. `scripts/art-sprites.mjs`: 클립 전체에 한 이동 · 배율(캐릭터 몸 키 114 px = 논리 57 × 2). 흐르면 발 점(맨 아래 불투명 줄 가운데)을 매끈히 맞춤. 알파를 곱한 상태로 줄임(sharp 이슈 #4051 [S34] → `scripts/art-gear.mjs`처럼 Chromium 캔버스도). 묶기 free-tex-packer-core(MIT, `JsonHash`, 회전 끔, padding · extrude) [S33] → `src/assets/art/**`.
4. 키가 흔들리면 rembg `isnet-anime` / BiRefNet [S30]. 체크무늬 위에서 눈으로.
5. 효과: 검은 배경 + 더하기 합성(`'lighter'`, 지금 코드에 없음). 어두운 효과(먹물 · 연기 · 먼지)는 알파 필요.

⑤ **게임에 넣기**: 4-4 ~ 4-7 + 8장 새 검사. ⑥ **폰 확인**: `?art=code` / `?art=new` 나란히 — `tests/visual/zone-tour.mjs`, `boss-phone-sheet.mjs`, `ult-test-sheet.mjs`, `tests/visual/render-sandbox.html?scene=zoo&gallery=1`, `bench=<id>`. 성능 `node tests/playtest/perf.mjs phone` + 실제 폰.

**파일 두는 곳**
- Codex 원본 · 영상 · 뽑은 프레임 `art/raw/…`(PC), 장비 원본 `art/gear/`(`scripts/art-gear.mjs:8`) → git 제외: 25차에 `.gitignore`에 `art/raw/` · `art/gear/`, `.dockerignore`에 `art`(빌드에 안 씀). 지금 둘 다 `art` 줄 없음.
- 커밋: 그림체 바이블 · 고른 기준 그림(작게) `docs/art-style.md` · `docs/art/`, 프롬프트 `scripts/art-prompts/`, 고른 프레임 목록 `art/clips/*.json`, 게임용 시트 `src/assets/art/**`(크기 예산).

출처(2026-10-31 봄): [S1] learn.chatgpt.com/docs/image-generation · [S2] github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/imagegen/SKILL.md · [S3] developers.openai.com/api/docs/guides/image-generation · [S4] developers.openai.com/api/docs/changelog · [S11] docs.byteplus.com/en/docs/modelark/seedance-2-5 · [S12] …/modelark/create-video-generation-task-api · [S16] …/ModelArk/1544106 · [S17] …/modelark/seedance-2-5-prompt-guide · [S18] fal.ai/learn/tools/how-to-access-seedance-2-5-on-fal · [S19] learn.chatgpt.com/docs/windows/windows-sandbox.md · [S22] layrkits.com/guides/sprite-sheet (3자) · [S29] ffmpeg.org/ffmpeg-filters.html · [S30] github.com/danielgatis/rembg · [S33] github.com/odrick/free-tex-packer-core · [S34] github.com/lovell/sharp/issues/4051

---

## 6. 효과음 새로 만들기 (순서 · 명령은 인벤토리 10-4)

- 그대로: id, `STAGE_CUES`(`src/audio/stages.ts`), `src/audio/ids.ts`, `src/audio/director.ts`, 합성 레시피. 바뀌는 것: 프롬프트 글 · mp3 · `levels.json` · `generated.json`. `src/sim` · `server`는 `src/audio`를 안 씀(테스트가 지킴).
- 도구는 11장 14번(지금 길 = ElevenLabs). 25차는 분위기 문장 시험 15개만, 전부는 30차(11장 15번).
- 건너뜀: 안 울리는 `ult.<char>.tick` 13개. `ult.bard.beat`는 `off`(합성음 유지). 크기 한도 7,212,276 바이트(`tests/ui/audio.test.ts:732–740`).
- 비용은 ElevenLabs 계정에서 먼저 확인(요청 730.6초 + 다시 만들기). 영상의 소리는 효과음으로 안 씀(추천).

---

## 7. 기술 결정 (새 세션이 정함 · 「추천대로」면 이대로)

1. **그리는 방식**: Canvas 2D + `drawImage` **(추천)** — 렌더 60파일 33,712줄 · 검사가 그대로, 코드 / 새 그림 비교 가능 / PixiJS — 거의 다시(섞인 그리기 순서, `setLineDash` 96곳, 짝홀 clip, 글자 76곳, Node 그림 테스트). 시트는 PixiJS도 읽는 형식 → 실제 폰이 백버퍼 1에서도 45 fps 밑이면 그때. CLAUDE.md의 다음 계획(PixiJS)과 다른 추천 — 디자이너 확인 필요.
2. **폰으로 보는 길**: ① 새 비공개 아티팩트 **(추천, 25차)** — 와이파이 · 방화벽 · Fly 토큰 필요 없음, 비교는 일시정지 메뉴 스위치(아티팩트 주소에 `?art=`가 전달되는지는 확인 못 함) / ② 둘째 Fly 앱(이름 · `FLY_API_TOKEN` 종류 확인 못 함) — 멀티 확인이 필요해질 때, 아트 가지 전용 workflow + 머신 요금 / ③ PC + 폰 같은 와이파이: `npm run dev`(`vite --host`, 혼자 하기, 포트 확인 못 함) 또는 `npm run build:all; npm start`(`0.0.0.0:8080`, `server/main.ts:19–20`) — 매번 빌드 · 방화벽 허용.
   - 아트 가지는 푸시로는 배포 안 됨(`fly-deploy.yml:10`). **단, Actions 수동 실행(workflow_dispatch, `:7–8`)은 가지 조건이 없어 어느 가지든 라이브 앱에 배포함 — 아트 가지에서 누르지 않기.**
3. **아티팩트**: 지금 솔로 주소 `XERwnQ1oMjV743egXytiFk`는 아트 가지에서 안 덮음 **(추천)**. 지금 9,667,275 바이트 → 16 MB까지 base64 약 6.3 MB(원본 약 4.7 MB)를 그림 + 새 소리가 나눔 → 솔로판은 가벼운 세트 따로 **(추천)** / 소리를 줄여 같은 세트. 여러 파일 아티팩트의 자기 파일 `fetch()`는 확인 못 함(`artifact.spec.ts`가 `requests == ['/']` 검사).
4. **저장소 · 빌드**: 원본 · 영상 · 프레임은 git 제외, 게임용 시트만 커밋 + 그림 형식을 `vite.config.ts` 정규식에 넣어 따로 캐시(안 하면 `index.html`이 커짐) **(추천)**. 첫 예산(제안): Fly 판 새 그림 40 MB 이하, 25차 실측 뒤 다시.
5. **폰 성능 예산**(지금 없음): 4-7 계산대로 프레임만으로 64 MB를 넘기 쉬움 → 25차에 실제 폰으로 풀린 크기 · fps · 해상도 조절기 단계를 재고 정함 **(추천)**. 참고: 소리만 1층 시작 약 52 MB(21차).
6. **효과 분류**: 인벤토리 9장 표대로 (a) 코드(판정 모양 · 시간 · 숫자 · 화면 효과) · (b) 영상 플립북(베기 · 폭발 · 오라 …) · (c) 코드 모양 + 그림 텍스처 **(추천)**. 마무리 · 착지 플립북은 **가장 큰 그림이 첫 프레임**.
7. **형식**: WebP(알파, 작음) + JSON **(추천)** / PNG(크지만 어디서나 열림).
8. **영상 길**(영상을 어디서 만드나): BytePlus API **(추천: 공식, 스크립트로 반복; 워터마크 없음은 확인 필요)** / fal.ai / Dreamina 앱(손으로).
9. **Codex 길**(그림을 어떻게 만드나): 내장 생성(ChatGPT 로그인으로 씀, 키 없음 — 확인 필요) **(추천)** / API 키(투명 배경이 꼭 필요할 때).

---

## 8. 깨지는 검사와 대처 (전체 표는 인벤토리 12장)

- **sim 골든 4개**: 다시 기록 금지.
- **`classic-look`** `'455258ec31c41b21'`(클래식 · 원정 · 레이드의 모든 캔버스 호출 + `drawImage` 수): 「코드」 판은 계속 통과(vitest는 Node, `vite.config.ts:70` — Image 없음). 「새 그림」을 기본으로 바꿀 때만 승인 뒤 한 번 `CLASSIC_LOOK_PRINT=1 npx vitest run tests/render/classic-look.test.ts`.
- **`ult-fx-core`** `TABLES_22 'f6a0e926f494f1ca'`(`PREP` `LAND` `IMPACT` `TELE_MOTIF` `ZONE_DECOR` `STAGE_CUES`): 스프라이트 연결은 같은 키의 새 표로 → 안 깨짐. 「글자 없음」(:1817–1933) 그대로. 시전당 예산(입자 ≤ 150 · 효과 ≤ 40 · 자국 ≤ 6): 플립북 1개 = 기록 1개.
- **새로 더할 것**: 그림 이름 표 · 크기 예산, 「코드」 모드는 불러오기 · `drawImage` 없음, 가짜 비트맵으로 새 그림 길(유닛당 `drawImage` 1번 · 뒤집기 · 발 기준점 · 걷기 반복 · 타격 프레임 · 파일 없으면 코드), 층당 메모리 예산.
- 그대로 통과: `renderer` `shapes-render` `boss-looks` `boss-body` `gear` `audio`. e2e 밝기(`smoke.spec.ts:211–214`) · 연필 바닥(`boss-raid.spec.ts:794–801`)은 디자이너와 조정(가짜로 밝히지 않음).
- **PC 주의**: Chromium 경로 `/opt/pw-browsers/chromium`이 고정돼 PC에서 안 도는 도구 — `tests/visual/` `cast-frames` `new-chars` `shoot-exp-bands` `shoot-gear` `shoot-preset` `shoot-shapes` `shoot-zoo` `ui-shoot` `zone-tour`, `tests/render/shoot-sandbox.mjs`, `tests/playtest/lib.mjs`(→ `perf.mjs`) · `mp-*`, `tests/review/card-diamond*.mjs` · `playwright.*review.config.ts`, `scripts/art-gear.mjs:20` → `boss-sheet.mjs:48`처럼 「있으면 쓰고 없으면 기본」으로.

---

## 9. 환경

- **디자이너 PC**(이 문서를 쓴 곳): Windows 10 Pro 10.0.19045, PowerShell, Node v24.19.0, ffmpeg 9.0.2 · ffprobe(WinGet Gyan) · `codex` CLI(npm 전역, 버전 확인 못 함) PATH에 있음. Codex: Windows 10은 "Can work, but is less reliable than Windows 11" [S19].
- **클라우드**: OpenAI 주소가 막혀 있음(CLAUDE.md), BytePlus · fal.ai · ElevenLabs는 확인 못 함 → **생성은 PC에서 (추천)**, 원본도 PC `art/raw/`.
- **디자이너 준비**: ① PC에서 `codex` 로그인 ② BytePlus 결제(잔액 USD 30 초과 또는 플랜, 확인 필요) ③ `.env.local`에 영상 키를 직접(이름 제안 `ARK_API_KEY`, 확인 필요) ④ ElevenLabs 잔액 ⑤ 메인 세션이 문서를 커밋 · 푸시한 뒤 상자 붙여 넣기.
- **키**: `.env.local`에만(`.gitignore`의 `.env.*`): 지금 `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`는 API 길일 때만. 스크립트는 환경에서 읽고 출력 안 함.
- PC에서 `npm run dev:server`는 `PORT=8787 node …`라 안 될 수 있음(확인 못 함) → PowerShell `npm run build:server; $env:PORT='8787'; node dist-server/index.js` + `npm run dev`, 또는 `npm run build:all; npm start`(8080). 그 밖의 PC 주의(동시 수정 금지 · e2e 13분 · 시간에 민감한 테스트)는 CLAUDE.md.

---

## 10. 단계 계획 (제안)

- **25차 그림체 + 시험**: 후보 3~4 → 고름. 기반: 스위치 · 파일 표 · 시트 형식 · 불러오기 · 스크립트 · vite · 무시 규칙. 시험: 캐릭터 1 필수 7동작 + 몬스터 1 + 배경 1 + 효과음 시험 15. 영상(추론): 가디언 7 + 우산 4 + 휘두름 1~2 ≈ 13클립 × 3번 ≈ 40클립 → 480p 약 $16 · 720p 약 $37, 상한 $50. 다 됐다 = 폰에서 「새 그림」 한 판, 「코드」 판 해시 그대로, 내 외곽선, 검사 통과, 클립 값 · 폰 프레임 · 메모리 기록. 보여 줄 것 = 후보 비교(실제 크기), 코드 / 새 그림 나란히, 폰 영상, 접촉 시트.
- **26차 캐릭터**: 15명(선택 4동작 포함) + 초상 · 컷인 15 + 펫 아이콘 8 + 아군 소환물, 장비 겹치는 법. 기준: 같은 크기 · 발 위치, 원정 인형까지.
- **27차 몬스터 · 보스**: 시작 전 §32-4 · §33-4(뺄 보스). 일반 13 · 중형 6 · 소환 · 돌발 9 · 보스 20(많으면 28차로). 기준: 예고 그대로, 방향 · 약점 · 가짜 창 구별. `boss-phone-sheet` · `zone-tour` 나란히.
- **28차 배경 · UI**: 판 11 · 보스 바닥 8 · 가림막 3 · 메인 카드 · 괴담 방 · 아이콘 · 장비 52. 기준: 예고가 읽힘, HUD에 안 가림.
- **29차 효과**: 7장 6번 (b) · (c). 기준: 예산 · 첫 프레임 규칙 · 글자 없음.
- **30차 효과음**: 456개(건너뛸 13개 빼고). 기준: 크기 한도 · 이음새 · 디자이너 귀.
- **마무리**: 「새 그림」 기본, 해시 다시 기록(승인 뒤 한 번), 합치기 · 아티팩트. 기준: 전체 검사 + 3인 멀티 e2e.

---

## 11. 정해 주실 것 (지금은 (추천)대로 시작해요)

1. 그림체: 25차에 후보 3~4개를 그려 보고 고름 **(추천 — 그림으로 봐야 고를 수 있음)**. 예: 굵은 외곽선 카툰 · 손그림 수채 괴담 · 셀 셰이딩 애니 · 도트풍(영상을 줄이는 길과 안 맞을 수 있음).
2. 시험 조합: 가디언 + 외발 우산 + 로비 + 휘두름 효과 **(추천 — 방패 근접이라 타격 순간을 시험, 우산은 단순하고 1층부터, 로비는 첫 구역)** / 블레이드(돌진 · 잔상까지).
3. 보는 방향: 좌우 뒤집기만 **(추천 — 지금도 좌우뿐)** / 위 · 아래 더함(영상 · 용량 2배+).
4. 캐릭터 그림 한 장의 크기: 192 **(추천, PC에서도 선명)** / 160(메모리 약 0.7배) / 128(소품이 잘림).
5. 몸 · 초상의 역할 글자(방 · 근 · 원 · 힐 · 지): 없애고 카드에 작은 역할 아이콘 **(추천 — 24차에 글자를 없애셨음)** / 그대로.
6. 같은 소품 나눠 쓰기: 캐릭터마다 다른 소품(메딕 주사기 · 퇴마사 부적 · 퍼펫티어 실타래 · 워든 사슬 · 크로노 시계) **(추천)** / 지금처럼. 그림만 바꿈(`look.ts`) — 데이터 무기 계열(`src/data/gear.ts:61`) · 장비 52 이름은 그대로(원정 무기와의 차이는 26차).
7. 캐릭터 색: 데이터 색을 그림의 주색으로 **(추천 — 투사체 · 카드 · 컷인과 이어짐)** / 바꿈.
8. 펫: 필드 몸 없음 + 아이콘만 새로 **(추천 — 지금 규칙 그대로, 일이 적음)** / 놓을 때 잠깐 나타남.
9. 배경 글자(간판 · 23:59 · 비상구): 빈 판 + 글자는 코드 **(추천 — 생성 그림 글자는 깨지기 쉬움)** / 없앰.
10. 클래식 퇴마사 印 · 滅 글자: 새 그림 판만 글자 없는 그림, 코드 판은 그대로(해시 유지) **(추천)** / 둘 다 그대로. (滅은 지금도 안 보임 — §37-5 8번)
11. 정보 글자(숫자 · 「저스트!」 · 「그로기!」 · 「끊김!」 · 이름표): 그대로 **(추천 — 읽혀야 하는 정보)** / 그림 아이콘.
12. 「새 그림」 기본: 시험 주소에선 새 그림, 라이브엔 「다 됐다」 하실 때 **(추천)** / 25차부터 라이브도.
13. 원본 보관: PC `art/raw/`(git 제외) + 클라우드 드라이브 백업 **(추천)** / 큰 파일 전용 git 저장(LFS, 용량 요금).
14. 효과음: 도구는 지금 ElevenLabs로 다시 **(추천 — id · 크기 맞춤 · 미리듣기 도구가 그대로)** / 다른 도구. 분위기 문장 후보 2~3개로 15개쯤 만들어 듣고 고름 **(추천)**.
15. 효과음 순서: 25차는 시험 15개만, 전부는 30차 **(추천 — 그림체가 정해진 뒤 소리를 맞춤)** / 25차부터 나눠서. 「다 수정」의 예외: 게임에서 안 울리는 13개는 건너뜀, 바드 박자 1개는 만들면 소리가 없어 지금 소리 유지 **(추천)**.
16. 배경 음악: 이번엔 안 넣음 **(추천 — 새 기능)** / 넣음.
17. 영상 돈: 25차 상한 $50 **(추천)**. 전체 어림(추론): 약 420클립(캐릭터 165 · 몬스터 등 140 · 보스 90 · 효과 20) × 720p $0.92 ≈ $390 + 다시 만들기 → 26차 전에 다시 정함.
18. 영상으로 안 만드는 것: 고정 보스 6(부품 그림 + 코드 움직임 — 문 틈 · 눈이 게임을 따라가야 함), 예고 · 숫자 · HP(보이는 곳 = 맞는 곳) **(추천)** / 고정 보스도 영상.
19. 구역 색 세 벌을 한 벌로 **(추천 — 새 그림체와 함께 정하기 좋은 때)** / 그대로.
20. 이모지 아이콘 41개(+ 🔊 🔇): 그림으로 **(추천 — 기기마다 다르게 보임)** / 유지.
21. 레이드 보스 16의 그림: 보스 정리(§32-4 · §33-4) 뒤에 **(추천 — 지울 보스를 안 그리게)** / 바로.
22. 보상 소환물 5종(지금 덩어리) · 보상 93종 아이콘: 소환물만 **(추천 — 필드에 보이는 것 먼저)** / 둘 다 / 둘 다 안 함.
23. 아트 기간의 플레이 변경: 멈춤 **(추천 — 두 가지가 엉키지 않게)** / 하면 메인 가지에서 하고 차마다 아트 가지로 합침. game-design 장 번호는 겹치지 않게 이어 씀.

**이전 차례 열린 질문**: `docs/current-rules.md` 「열린 질문 모음」. 보스를 그리기 전(27차)에 §32-4 1번(뺄 보스) · §33-4를 한 번 봐 주세요. §34 「남은 것」은 새 소리 확인 목록으로 씁니다.
