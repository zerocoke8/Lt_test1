# 궁극기 연출 강화 (기획 23차 · 24차 → 8장)

> 디자이너 요청(그대로): "현재 궁극기 모드가 추가되어있는데, 조준형이던 드래그형이던 새로 추가된 궁극기가 좀 연출이 약해.
> 궁극기를 좀더 화려하게 만들어줘. 궁극기라는게 체감되게. 화려하게 만드는 작업중 기존 궁극기가 너무 단순하다고 판단되면 아예 바꿔도 좋아.
> 밸런스를 힘들게 잡을필요는 없어. 나중에 한번에 잡을께."

대상: 궁극기 테스트 모드의 30개 궁극기(`<캐릭터>_ua` 조준 · `<캐릭터>_ud` 드래그). 오늘 궁극기(`<캐릭터>_u`: 클래식 · 원정 · 보스 레이드)는
**숫자도 그림도 소리도 바뀌지 않음**. 위력은 눈대중(밸런스는 나중에 한 번에).

---

## 1. 한눈에

1. 모든 궁극기가 **모으기 → 터짐 → 여운** 세 박자로 끝남. 마지막 한 방(★마무리)이 다른 박자보다 확실히 큼. 30개 모두 마무리가 0.8~2.45초 사이.
2. **조준 발사**: 컷인 띠가 지나가는 동안 겨눈 자리만 밝게 뚫려 있고, 네 모서리 잠금 표시가 조여들어 「찰칵」 잠김. 0.45초에 캐릭터 가슴에서 겨눈 곳으로 빛줄기가 쏘아짐.
3. **드래그 이동**: 돌진은 잔상 4개 · 흙먼지 · 속도선, 순간이동은 빛 기둥 + 번개 줄로 어디서 어디로 갔는지 보임. 착지하면 바닥이 갈라지고 쿵.
4. **착지 컷**: 드래그의 작은 띠 대신, 착지 직후 화면 반대쪽 절반에 비스듬한 띠(초상 + 궁극기 이름)가 0.25초 지나감. 착지 자리는 밝게 남음.
5. **마무리 직전**: 0.35초 전 화면 가장자리가 캐릭터 색으로 물들고, 빛이 한 점으로 모이고, 0.12초 전 공격 자리만 남기고 세상이 어두워짐(숨 고르기).
6. **마무리 순간**: 0.13초 멈춤 + 화면 번쩍 + 5% 확대 + 큰 흔들림 + 한자 한 글자(城 · 斬 · 凍 · 滅 …)가 화면에 쾅. 이어서 여진 흔들림과 불씨. (**→ 8장**: 24차에 한자는 없앰, 대신 글자 없는 충격 프레임)
7. **여운**: 바닥에 3초쯤 자국(금 간 바닥 · 베인 자국 · 서리 · 먹물 · 꽃잎 · 문양). 적의 경고처럼 보이지 않게 아주 옅게(빨강 금지).
8. **캐릭터 그림**: 오늘 궁극기의 전용 그림(떨어지는 방패 · 철창 · 초승달 · 종 · 滅 글자 …)을 30개에도 쓰고, 캐릭터마다 새 그림을 더함.
9. **설계도 바꾼 것 15개**: 늦거나 한 방이 없던 것. 메이지 조준 4.85초 → 2.45초, 클레릭 드래그 종 4.5초 → 2초, 퇴마사 · 퍼펫티어 3~3.5초 → 2초 안팎, 메딕 · 크로노 조준에 마무리 추가 등(3장).
10. **소리**: 새 파일 없음. 지금 소리(456개)를 겹치고 이어 붙임 — 돌진 · 순간이동 소리, 착지 쿵, 마무리 직전 다른 소리를 잠깐 줄였다가 쾅.
11. **다른 사람 · 봇의 궁극기**는 지금처럼 흐리게(멈춤 · 흔들림 · 확대 · 큰 글자 없음). 클래식 · 원정 · 보스 레이드는 그대로.
12. 일시정지 설정 줄에 **「궁극기 연출 강화 (궁극기 테스트)」** 켜기/끄기 — 끄면 22차 연출로 비교 가능(기본: 켬).
13. **24차 (8장)**: 큰 글자는 없앰 → 글자 없는 「충격 프레임」(어둠 컷 + 캐릭터 모양 흰 별 + 빛줄기 + 충격파). 약하던 다섯 개(섀도우 드래그 · 레인저 조준 · 드래그 · 바드 드래그 · 크로노 드래그)는 새로 짬. 궁극기 버튼 옆에 「충전」 버튼.

---

## 2. 공통 연출 규칙

### 2-1. 박자 이름 (모든 궁극기 공통)

각 궁극기의 부분(action)마다 역할이 하나 붙음(`src/data/ultTest/beats.ts`가 데이터에서 계산). 캐릭터 그림이 없는 박자도 역할 기본 그림이 나옴.

| 역할 | 뜻 | 기본 그림 (캐릭터 그림이 없을 때) | 내 손맛 |
|---|---|---|---|
| 길 `path` | 드래그로 지나간 길의 타격 | 길을 따라 캐릭터 색 빛줄기(폭 ×1.1, 0.3초) + 가운데 흰 줄기, 맞은 적마다 X자 베기(최대 6) | 흔들림 2 |
| 첫 타 `opener` | 적에게 처음 닿는 박자 | 범위 번쩍 0.6, 별 40px, 둘레까지 퍼지는 고리, 불꽃 14, 맞은 적 표시 | 흔들림 4 (멈춤은 캐릭터별로 정함, 2-2) |
| 쌓기 `build` | 그 사이 박자 | 칠수록 커짐(×1.1씩, 8번까지), 첫 번째와 세 번째마다 범위 번쩍 0.45, 별 24px × 크기, 불꽃 ≤ 10 | 흔들림 1.5 → 4.5 (번째마다 +0.5), 연타 마지막 5 |
| ★마무리 `finisher` | 궁극기마다 딱 하나 (`finale`) | 2-3 | 2-3 |
| 짝 `twin` | 마무리와 같은 이름 · 같은 순간의 다른 부분(아군 회복 · 두 번째 띠) | 범위 번쩍 0.7 (아군이면 빛기둥) | 없음 |
| 뒤풀이 `after` | 마무리보다 0.5초 넘게 뒤의 박자(워든 해방, 버서커 마무리 일격) | 첫 타 그림 ×1.2 | 흔들림 6, 범위 0.8 |
| 장판 `zone` | 장판이 생기는 부분 | 첫 틱에 룬 원 하나(0.6초), 다음 틱은 맞을 때만 불꽃 2 | 없음 |
| 지원 `support` | 아군 · 자신에게 거는 부분 | 닿은 아군(최대 4)에 빛기둥 + 금빛 가루, 자신은 방울막, 「모든 아군」은 가루만 | 없음 |

### 2-2. 숫자 표

멈춤은 「연출」 멈춤 설정 75ms 기준(설정에 비례). 흔들림은 논리 px(폰은 지금처럼 ×1.5까지 자동 보정, 상한 18).

| 무엇 | 내 궁극기 | 다른 플레이어 · 봇 |
|---|---|---|
| ★마무리 멈춤 | **0.13초** (설정 150ms면 최대 0.16초). 1초 예산을 넘어도 됨 — 시전 한 번에 한 번(2-10 ①). 1초 안에 내 마무리가 또 오면 그건 예산 안에서만 | 없음 |
| 중간 멈춤 | 「접촉」 박자 하나만 0.035~0.055초 (1초 160ms 예산 안), 마무리보다 0.5초 이상 앞선 박자에만 | 없음 |
| 착지 멈춤 (드래그) | 0.05초 — 단, 0.8초 안에 중간 멈춤이 있는 궁극기는 없음(흔들림만; 3장 표의 「착지 흔들만」) | 없음 |
| 뒤풀이 멈춤 | 캐릭터별 0.07~0.1초 (예산 안) | 없음 |
| 흔들림 | 마무리 12 (0.4초) + 여진 4 (0.6초, 멈춤 뒤) · 접촉 4~7 · 착지 7 · 돌진 2 · 쌓기 1.5~4.5 | 없음 |
| 화면 번쩍 | 마무리 0.42 (캐릭터 화면색, 0.06초 + 0.07초 사라짐) | 화면 안이면 절반 |
| 범위 번쩍 (모양 안만) | 마무리 1.0 · 접촉 0.6~0.9 · 쌓기 0.45 | ×0.55 |
| 숨 고르기 | 마무리 0.35초 전 가장자리 물듦(캐릭터 비네트), 0.12초 전 공격 자리(+0.4칸)만 남기고 35% 어둡게. 모양이 6칸보다 크면 어둡게는 빼고 물듦만 | 없음 |
| 확대 | 마무리 5% (멈춤 동안 그대로 → 0.28초 동안 돌아옴) | 없음 |
| 큰 글자 (**→ 8장**: 24차에 없앰 — 대신 충격 프레임 8-2-2, 남의 것은 없음) | ~~마무리에 한자 한 글자 150px, 0.35초 머묾~~ | ~~땅 위 작은 글자 60px, 흐리게~~ |
| 속도선 | 마무리 28줄 방사(0.22초) · 돌진 12줄(0.2초) | 없음 |
| 바닥 자국 | 마무리 · 착지 · 돌진 길. 2.5~4초, 알파 ≤ 0.32, 테두리 ≤ 0.35, 빨강 · 깜빡임 금지 | 2개까지 |
| 입자 | 시전 한 번 최대 약 120 (테스트 상한 150) | ×0.55, 낮은 세부 |
| 아군 예고 · 장판 채우기 | 22차의 절반(테두리 · 무늬는 그대로) — 「평평한 색판」 해결 | 같음 |

### 2-3. ★마무리 (공통 문법, `ultFinisher`)

한 시전에 한 번. 그 궁극기의 `finale` 이름을 가진 부분 중 적을 치는 것(마지막 타격이 가장 늦은 것)이 마무리, 같은 이름의 나머지는 「짝」.

| 때 | 내 화면 |
|---|---|
| t − 0.35초 | 가장자리 비네트(캐릭터 비네트 색 · 세기) 0.35초 |
| t − 0.3초 | 빛 모으기: 고리 3개가 R×1.8 → 0.3으로 조여듦, 불꽃 14개가 빨려 들어감, 가운데 빛기둥(폭 0.5, 높이 7) 솟음, 낮은 진동 1.5 |
| t − 0.12초 | 숨 고르기: 공격 자리만 남기고 35% 어둡게 (적 경고는 어둠 위에 다시 그림) |
| **t** | 어둠 끊김 → 화면 번쩍 0.42 + 멈춤 0.13초 + 흔들림 12 + 5% 확대 + 방사 속도선 28 + 범위 번쩍 1.0 + 흰 별 70px + 고리 3겹(캐릭터 색 0.5R→1.0R 굵게 · 흰 0.3R→1.15R · 가는 흰 0.8R→1.35R) + 빛기둥(폭 1.1, 높이 9) + 맞은 적마다 별 · 불꽃(최대 10) + 불꽃 40 · 파편 10 + 큰 글자(**→ 8장**: 24차 충격 프레임) + 바닥 자국. **멈춘 첫 화면에 이미 다 보여야 함**(나이 0에서 꽉 찬 모습) |
| t + 0.12초 (멈춤 뒤) | 여진 흔들림 4 (0.6초) + 가장자리 비네트 0.4 (0.6초) |
| t + 0.2 ~ 2.0초 | 불씨 14개가 천천히 떠오름 |

**큰 글자** (**→ 8장**: 24차에 없앰 — 아래는 23차 기록, 지금은 충격 프레임 8-2-2): 공격 자리 화면 위치에서 70px 위(가로 90~1190, 세로 170~460 안으로), 150px 굵게, 캐릭터 화면색 + 10px 어두운 테두리, 0.05초 흰 속빛. 1.9배 → 1배로 0.09초에 쾅(원 + 먹물 방울 6개) → 0.35초 머묾 → 0.3초 동안 12px 떠오르며 사라짐. 실제 시계로 움직임(멈춤 중에도 쾅).

**캐릭터 표** (`theme.ts` 기본값; 궁극기별로 바꿀 수 있음):

| 캐릭터 | 글자 (**→ 8장**: 24차에 없앰, 대신 별 모양 8-2-2 표) | 화면색 | 비네트 색 · 세기 | 불꽃 | 바닥 자국 · 색 |
|---|---|---|---|---|---|
| 가디언 | 城 | #dbe9ff | #cfe8ff · 0.3 | Glass | crater · #cfe0ff |
| 팔라딘 | 審 | #fff3b0 | #fff3b0 · 0.3 | Gold | sigil · #ffd166 |
| 워든 | 獄 | #e8f0d0 | #c9d6a3 · 0.3 | Square | crater · #c9d6a3 |
| 블레이드 | 斬 | #ffe3ec | #000000 · 0.5 | Petal | gash · #ffe3ec |
| 버서커 | 破 | #ffd0c2 | #ff3b1f · 0.25 | Ember | crater · #5c4033 |
| 섀도우 | 影 | #e6dcff | #0b0820 · 0.45 | Ink | ink · #1b1c3d |
| 레인저 | 穿 | #fff6d0 | #000000 · 0.35 | Feather | crater · #c9ffe9 |
| 메이지 | 凍 | #e0f7ff | #bfefff · 0.35 | Glass | frost · #bdeeff |
| 거너 | 爆 | #ffe2b8 | #000000 · 0.35 | Square | scorch · #3a2e26 |
| 클레릭 | 聖 | #fffbe6 | #fffbe6 · 0.3 | Feather | sigil · #ffe08a |
| 메딕 | 救 | #d9fbff | #bdf6ff · 0.3 | Square | sigil · #2ec4b6 |
| 퇴마사 | 滅 | #ffd6d6 | #3a0a0c · 0.45 | Paper | ink · #2a1a1a |
| 바드 | 響 | #ffe6ff | #e056fd · 0.35 | Note | petals · #e056fd |
| 크로노 | 止 | #eef0ff | #eef0ff · 0.35 | Glass | sigil · #cfd5ff |
| 퍼펫티어 | 幕 | #ffd6ea | #2a0a1a · 0.45 | Petal | petals · #ffb3d9 |

(23차: 한자는 지금도 퇴마사 滅 · 印에 쓰는 것처럼 기기 글꼴로 그려짐 — 24차에 없앰, → 8장. 아군만 회복하는 마무리가 생기면 「축복」 판: 멈춤 · 흔들림 없이 번쩍 0.28, 확대 2%, 아군 빛기둥(최대 6) + 가루 20 + 문양 자국 — 지금 30개에는 없음.)

### 2-4. 조준 발사 순간 (놓은 뒤 0 → 0.45초)

- 컷인 띠(0~0.5초, 세상 40% 어둡게, 0.39~0.45초 흰 닦기)는 지금 그대로. 띠 자리를 고를 때 겨눈 자리도 피함(무게 2).
- **어둠 속 구멍**: 띠가 세상을 어둡게 하는 동안 겨눈 자리(첫 박자 크기 + 0.5칸, 1.2~4.5칸)만 밝게 남음 — 바닥 조준 표시가 그대로 보임.
- **잠금 표시** (22차의 0.8초 줄어드는 고리 대신): 0~0.18초 네 모서리 괄호가 2.2배 → 1배로 조여듦 + 아래에 도는 룬 원(캐릭터 색) + 흰 고리 팡 → 0.18~0.4초 괄호가 ±6% 숨쉼 → **0.4초 「찰칵」** 0.9배로 딱 붙고 흰 고리. 마무리가 겨눈 자리에 0.8초 이후 떨어지면 잠금 표시가 알파 0.6으로 천천히 돌며 마무리까지(최대 3초) 남아 있다가 같이 터짐.
  - 겨눈 자리에 떨어지는 박자가 없는 궁극기(블레이드 · 워든 · 버서커 · 섀도우 · 메이지 조준: 내 자리에서 겨눈 쪽으로)는 작은 잠금(반경 1, 0.6초)만. (23차 검토: 섀도우 조준은 ★초승달이 겨눈 곳에 떨어지게 바꿔서 큰 잠금 — 7-4)
- **조준선**(내 것, 0.38~0.52초): 캐릭터 가슴(높이 0.6)에서 겨눈 곳까지 0.05초에 그려짐 — 흰 3px 심 + 캐릭터 색 9px 빛 + 겨눈 쪽으로 달리는 ››› 세 개. 0.45초에 겨눈 곳으로 0.08초 만에 빨려 들어가고 캐릭터에서 총구 별(40px). 겨눈 곳이 1.5칸보다 가깝거나, 궁극기가 끄면(`sight: false`) 없음. 겨눈 자리에 박자가 없으면 첫 박자가 닿는 끝까지만.
- **모으기**(띠 동안 캐릭터): 고리 3개가 2.6 → 0.4로 0.4초 동안 조여듦 + 불꽃 12개 빨려 들어감.
- **미리보기**(누르고 있는 동안): 마무리가 떨어질 부분은 테두리 두 줄 + 가운데 점이 깜빡임(어디가 큰 한 방인지 보임).
- 다른 플레이어: 잠금 표시 알파 0.6, 조준선 알파 0.5(››› 없음). 어둠 구멍 없음.

### 2-5. 드래그 이동 · 착지 · 착지 컷

게임은 놓는 순간(0초) 캐릭터를 옮기고, 화면은 그 이동을 그림.

- **돌진** (0.16초): 지금의 줄무늬 + 잔상 4개(길의 25/50/75/100%, 각 0.28초, 0.035초 간격, 캐릭터 색) + 출발점 흙먼지(연기 6 · 돌 4) + 길 위 불꽃 3번 × 3 + 길에 「베인 자국」(폭 = 몸 × 1.2, 1.6초). 내 것: 흔들림 2 + 이동 방향 속도선 12줄(0.2초, 알파 0.3).
- **순간이동**: 출발점에 안으로 빨려 드는 고리(1.6 → 0.1, 0.16초) + 지금의 연기 + 세로 빛 틈(폭 0.25, 높이 5, 0.14초) → 길은 캐릭터 색 번개 줄(0.2초, 22차 점선 대신) → 도착점: 몸 0.08초 숨김 → 흰 빛기둥(폭 0.6, 높이 6, 0.12초) + 살짝 떨어져 내림(0.6, 0.18초). 착지 ≈ 0.18초.
- **착지** (`ultTouchdown`, 실제 도착 순간 — 22차는 0초에 그려서 캐릭터보다 먼저 터졌음): 구덩이 고리(0.3 → 2.2, 굵기 7, 채움 0.22, 0.4초) + 흰 충격 고리(0.2 → 3.4) + 금(반경 1.8, 7줄) + 먼지(연기 8 · 돌 8) + 작은 구덩이 자국(반경 1.1, 2초). 내 것: 흔들림 7(0.25초) + 멈춤 0.05초(2-2 조건).
- **착지 컷** (내 것, 「컷인 짧게」가 아닐 때): 착지 + 0.03초부터 0.45초까지(돌진 약 0.26초, 순간이동 약 0.24초).
  - 세상 30% 어둡게, 착지 자리(첫 박자 크기, 2~5칸 + 0.4)만 밝게. 캐릭터는 어둠 위에 다시 그림.
  - 높이 96px 비스듬한 띠: 착지 자리의 반대쪽 절반(착지 화면 y ≥ 330이면 y 205, 아니면 470)에, 캐릭터가 온 쪽에서 0.06초에 미끄러져 들어옴 — 초상 원 + 「<이름> · 궁극기」 + 궁극기 이름 40px 굵게 + 속도선. 0.39~0.45초 흰 닦기로 나감 — 첫 타가 닦기와 함께 떨어짐.
  - 착지 후 0.45초까지 0.2초가 안 남으면 띠 없이 22차 작은 띠.
  - 왜 큰 띠가 아닌가: 큰 띠는 화면 274px(필드의 ~80%) × 0.5초라 0.45초 첫 타를 가림.
- 다른 플레이어의 드래그: 이동 · 착지 그림만 0.55 세기, 낮은 세부. 띠 · 흔들림 · 멈춤 없음.

### 2-6. 여운 (바닥 자국)

- 종류: `crater` 구덩이(어두운 타원 + 옅은 테 + 금 6줄) · `gash` 베인 자국(캐릭터 색 빛줄 → 0.6초에 어두운 갈색으로 식음) · `scorch` 그을림 · `frost` 서리(옅은 하늘색 + 결정 8개) · `sigil` 천천히 도는 문양 · `ink` 먹물 · `petals` 바닥의 음표 · 꽃잎 · 종이.
- 남기는 것: 마무리, 착지, 돌진 길뿐. 쌓기 박자는 안 남김(지저분해짐).
- 2.5~4초(0.1초에 나타남, 마지막 0.8초에 사라짐). 알파 ≤ 0.32. 크기 = 모양 × 0.9 (모양 밖으로 색을 칠하지 않음).
- 동시에 6개(내 것 4 · 남의 것 2), 넘치면 가장 오래된 것이 0.2초에 사라짐.

### 2-7. 소리 (새 파일 없음 — 있는 456개만)

- 놓는 순간: 지금 그대로(`ult.<캐릭터>.cutin` 안의 0.45초 상승음 + 다른 소리 줄이기).
- 내 드래그 이동: 돌진 `dash.<역할>`, 순간이동 `mon.blink` −3dB (지금은 내 순간이동이 무음, 돌진 소리는 우연히만 났음), 착지 `drag._role.<역할>` −2dB를 실제 도착 순간에.
- 박자 소리 찾는 순서(이 30개만): 그 궁극기 데이터의 `sfx`(3장의 「sfx」) → 캐릭터 궁극기 줄 → 캐릭터 드래그 줄 → 없으면:
  - 마무리가 아닌 박자: `drag._role.<역할>` −4dB, 시전 한 번에 한 번만(22차는 박자마다 3초짜리 역할 소리가 겹쳤음).
  - 마무리: `ult._role.<역할>`을 0.5초 앞당겨 예약(그 소리의 쾅이 타격과 맞도록 — 22차는 0.5초 늦게 쾅).
- 마무리 겹소리(내 것): 0.18초 전 효과음 −10dB로 숨 고르기(그 소리에 이미 줄이기가 있으면 생략) · 맞은 적 2마리 이상이면 `drag.crunch` −3dB · 마무리가 1.2초보다 늦으면 마무리 0.2초 전부터 0.8초 동안 배경음 −10dB.
- 다른 사람에게 들리는 것: 마무리 박자 소리만(이 30개는 `finale` 이름으로 정함).
- `groggy.break`(그로기 전용)는 쓰지 않음.
- 확인: `npm run sfx:preview`로 귀로 듣기. `ult._role.ranged`는 겹소리로 작으면 +3dB.

### 2-8. 다른 플레이어 · 폰 · 설정

- 다른 플레이어 · 봇의 궁극기: 멈춤 · 흔들림 · 어둡게/구멍 · 확대 · 속도선 · 착지 컷 · 화면 큰 글자 **없음**. 땅 위 그림은 0.55 세기 + 낮은 세부(빛기둥 빼고 고리 절반), 바닥 자국 2개까지, 마무리 화면 번쩍은 화면 안일 때 절반(지금 규칙).
- 폰이 버거울 때(그림 해상도 1.25배 이하로 내려간 상태): 불꽃 · 불씨 절반, 바닥 자국 금 없음, 큰 글자 먹물 방울 없음, 방향 속도선 없음.
- 화면 층 효과(큰 글자 · 속도선 · 확대 · 숨 고르기 어둠)는 한 번에 하나씩 — 새 것이 옛 것을 바꿈.
- 「연출」 설정:
  - 멈춤 0 → 멈춤 전부 없음.
  - 흔들림 0 → 흔들림 · 확대 · 속도선 없음.
  - 기기 「동작 줄이기」 → 흔들림 ×0.3, 확대 · 속도선 없음, 큰 글자는 쾅 없이 나타남.
  - 「컷인 짧게」 → 착지 컷 없이 작은 띠(22차와 같음).
  - **「궁극기 연출 강화」 끔** → 22차 연출 규칙(캐릭터 그림 · 마무리 문법 · 잠금 · 착지 컷 · 바닥 자국 · 새 소리 규칙 없음; 23차 데이터는 그대로). 기기마다 저장.
- 카드를 끌거나 궁극기를 겨누기 시작하면 확대는 즉시 풀림.

### 2-9. 지키는 것

- **보이는 곳 = 맞는 곳**: 모든 그림은 그 박자의 실제 자리 · 시작점에서. 색 채우기는 모양 안만, 모양 밖은 0.35초 안에 사라지는 가는 흰 고리뿐. 잠금 표시 크기 = 실제 모양.
- **첫 효과 0.45초**: 데이터의 효과는 0.45초부터(이동만 0초). 모으기 · 조준선 · 착지 컷은 그림일 뿐.
- **오늘 궁극기 불변**: 오늘 표(`stagefx.ts` PREP/LAND, `impact.ts` IMPACT, `marks.ts` 표, `audio/stages.ts`)에 새 열쇠를 넣지 않음. 클래식 · 원정 · 보스 레이드 게임 결과(골든) · 그림 · 소리 그대로.
- 게임 규칙(서버) 변화는 30개의 데이터뿐. 메시지 모양은 그대로(프로토콜 8 유지).

### 2-10. 두 설계안에서 고른 것

설계안 ① = 궁극기별 내용, ② = 공통 손맛. 둘 다 폰에서 안전하면 더 화려한 쪽.

| # | 부딪힌 점 | 고른 것 | 이유 |
|---|---|---|---|
| ① | 마무리 멈춤: ① 0.105~0.115초(한 번 상한 0.12초 안) / ② 0.13초, 예산 무시 | **② 0.13초** | 더 큼. 시전 한 번에 한 번(게이지 30초), 그로기 0.18초 · 저스트도 예산 무시. 1초 안 두 번째는 예산 안으로 |
| ② | 흔들림: ① 9~11 / ② 12 + 여진 4 | **② 12 + 여진** | 상한 18 안. 여진은 멈춤 뒤라 큰 흔들림을 덮지 않음 |
| ③ | 중간 멈춤: ① 첫 접촉 35~55ms / ② 마무리만 멈춤 | **① 하나만** (0.055초 이하, 예산 안, 마무리보다 0.5초 이상 앞선 박자에만) | 첫 접촉의 무게. 두 번 연달아 멈추면 덜컥거려서 하나만 |
| ④ | 착지 멈춤: ② 0.05초 / ①의 0.45초 첫 타 멈춤과 0.27초 차 | 0.8초 안에 중간 멈춤이 있으면 착지는 흔들림만 | 같은 자리 두 번 멈춤 방지 |
| ⑤ | 마무리 고르기: ② 「가장 늦은 적 박자」 자동 / ① 궁극기별 | **데이터 `finale`로 30개 모두 명시** | 자동이면 워든 해방(5.9초) · 버서커 마무리 일격(8.25초)이 뽑힘 |
| ⑥ | 숨 고르기: ① 비네트 / ② 공격 자리만 남기고 어둡게 | **둘 다** (비네트 t−0.35, 어둡게 t−0.12) | 다른 층이라 겹쳐도 읽힘. 긴 모양(6칸 넘음)은 어둡게 빼고 비네트만 |
| ⑦ | ①의 「×1.3 / ×1.4 크게」 / ② 「색은 모양 밖으로 안 나감」 | **세기(입자 수 · 밝기) × k, 모양은 실제 크기 그대로** | 보이는 곳 = 맞는 곳 |
| ⑧ | 소리 덮어쓰기 표(①의 ALT) 자리 | **각 궁극기 데이터의 `sfx`** (지금 소리 칸 모양 그대로) + ②의 감독 규칙 | 그룹이 자기 파일만 고침, 새 파일 없음 |
| ⑨ | ① `only:'first'`를 impact.ts에 추가 | 안 넣음. 캐릭터 그림의 손맛을 「(박자) → 숫자」 함수로 쓸 수 있음 | 오늘 표 코드를 안 건드림 |
| ⑩ | ①이 적은 일부 지금 숫자가 실제와 다름(가디언 성채 250%/1.5초, 클레릭 고리 0.7/0.95초, 바드 70% 등) | **지금 데이터 숫자 유지**, 새 부분과 시간만 바꿈 | 밸런스는 나중에 |
| ⑪ | ①의 추가 변경: 퇴마사 조준 속박 추가 · 멸 180%, 메딕 제세동 180%/160%, 메딕 사이렌 5초/0.5초, 버서커 드래그 가르기 0.75초, 퍼펫티어 조준 실 장판 | **안 받음** | 이유 없는 수치 변경. 메딕은 22차 「힐러라 150% · 1초」 결정 유지. 실 장판은 0.8초 뒤 커튼콜이라 불필요 |
| ⑫ | 가디언 조준 결계 0.85 → 1.5초 (①) | **0.85초 그대로** | 결계가 먼저 있고 1.5초 「성채 전개」가 그 위에서 터짐(테스트 「1.1초에 결계 있음」 유지) |
| ⑬ | ① 아군 예고/장판 「평평한 색판」 | 이 30개의 예고 · 장판 채우기 절반 + 오늘 무늬 연결(`motif` · `decor`) | 「연출이 약해」의 가장 큰 원인 |

---

## 3. 캐릭터별 30개

**읽는 법**
- 시각 = 놓은 뒤 초. `stage` = 박자 이름(데이터 · 소리 · 그림 열쇠). 역할은 2-1.
- 손맛(내 것만): 「멈춤 .055」 = 0.055초, 「흔들 7」 = 흔들림 7, 「범위 .9」 = 범위 번쩍 0.9. **★** = 2-3 공통 마무리(멈춤 0.13 · 흔들 12+4 · 화면 0.42 · 숨 고르기 · 확대 5% · 큰 글자 · 바닥 자국)에 그 궁극기 그림을 더함.
- 소리: 「행」 = 캐릭터 궁극기/드래그 줄에서 찾은 지금 소리, 「sfx」 = 그 궁극기 데이터의 덮어쓰기(`UltAltDef.sfx`).
- 구현 줄(영어 약식, 4장 API): `alias X` = 오늘 그림 X 재사용(`@point` = 그 박자 자리에서), `k` = 세기, `seq` = 같은 이름 박자 중 몇 번째.
- 드래그 표의 이동 줄에 「착지 흔들만」이라고 적힌 궁극기는 look에 `touchdownStop: 0` (2-2 착지 멈춤 규칙).
- **설계 변경** 궁극기는 「데이터」에 바뀌는 부분(정확한 숫자)과 새 설명 줄. 표에 없는 부분은 지금 그대로.
- 모든 궁극기에 `finale`(마무리 이름)을 넣음.

### 그룹 A

#### A1. 가디언 조준 「성채 투척」 — 설계 변경 (마무리 「성채 전개」 추가) · finale `wave`

방패를 던져 끌어오고 → 성채가 떨어지고 → 1.5초에 육각 방패막이 펼쳐지며 터짐.

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0.45 | `rally` 첫 타 | 가디언 둘레 사슬 + 겨눈 곳까지 강철빛 조준선 → 방패가 날아감(0.2초), 직선 위로 방패 물결, 끌려오는 적에게 전기 줄(최대 8), 유리 8 | 흔들 3 · 범위 .6 | 행 `ult.guardian.rally` |
| 0.45 | `aegis` 지원 | 아군마다 빛기둥 | — | 행 (없음) |
| 0.85 | `citadel` 접촉 | 하늘에서 방패(2.6)가 겨눈 곳에 떨어짐(마지막 0.4초) → 육각판 · 고리 3 · 별 · 돌 · 유리 + 방사형 금(반경 3.8, 10줄) | **멈춤 .055** · 흔들 7 · 범위 .9 | 행 `ult.guardian.citadel` |
| 0.85~6.85 | `barrier` 장판 | 육각 돔 장식 | — | 행 `ult.guardian.barrier` 반복 |
| 1.5 | `wave` ★ | 0.6초 전부터 반경 4.5 육각판이 가운데부터 차오름 + 안으로 조이는 고리 2 → 강철 · 흰 고리 3겹(굵기 8) 폭발, 유리 14 · 사각 6 | ★ (城) | sfx `drag.guardian.charge` lead 0.5 + `drag.guardian.wave` |

데이터 (새 부분 하나, 결계 앞에 넣음):
```ts
finale: 'wave',
sfx: { wave: [{ id: 'drag.guardian.charge', lead: 0.5 }, { id: 'drag.guardian.wave' }] },
// after 'citadel', before the two 'barrier' parts (they stay at 0.85):
{ stage: 'wave', center: 'point', delay: 1.5, telegraphLead: 0.35, area: { shape: 'circle', radius: 4.5 }, affects: 'enemies',
  effects: [{ kind: 'damage', amount: 1.4 }, { kind: 'knockback', distance: 1.5 }, { kind: 'status', status: 'stun', duration: 0.5, value: 0 }] },
```
새 설명: 「모든 아군에게 보호막(최대 HP 30%, 8초). 겨눈 곳으로 방패를 던져 직선(길이 9, 폭 2.6)의 적을 그곳으로 3칸 끌어당기고 공격력 60% 피해 + 4초 도발. 0.85초에 겨눈 곳 반경 3.5에 성채 낙하: 공격력 250% 피해 + 1.5초 기절, 그 자리 반경 4에 6초간 결계(아군 방어 +30%, 적 30% 둔화). 1.5초에 성채 전개(반경 4.5): 공격력 140% 피해 + 1.5칸 넉백 + 0.5초 기절.」

구현:
- `rally`: alias `guardian_u:rally` (caster: chains PREP, tethers LAND) + prep `aimLine(caster→point, w 2.6, #cfe0ff, 0.45 s)` + land (hit 0) `orbFly` 0.2 s, ShieldWave (ang = ultAngle, r 9, w 2.6, 0.5 s), Glass 8 · impact `{ shake: 3, flash: 0.6 }`.
- `aegis`: alias `guardian_u:aegis`. `barrier`: alias `guardian_u:barrier`, decor `hexDome`.
- `citadel`: alias `guardian_u:citadel` `@point` (prep + land) + `crackFx(r 3.8, n 10, steel)` · impact `{ stop: 55, shake: 7, flash: 0.9 }` · motif `outline`.
- `wave`: prep `areaFx(Hex, circle 4.5, 0.6 s, wait delay−0.6)` + inward rings 4.5→1 ×2 (0.4 s) · land rings 0.5→5.5 ×3 width 8 + Glass 14 + Square 6 · finisher `{ glyph: '城' }` · motif `countdown`.

#### A2. 가디언 드래그 「성벽 대강림」 — 설계 변경 (마무리 「성벽 돌파」 추가, 이름 바꿈) · finale `wave`

돌진 → 착지 내려찍기 → 방패 넷이 떨어져 성벽 → 1.6초에 성벽이 앞으로 밀려 나감.

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0~0.16 | 이동(돌진 8) | 공통 돌진 + 길 따라 방패 물결(0.35초) + 사각 불꽃 10 | 흔들 2 (착지 흔들만) | `dash.tank` |
| 0.45 | 길 `rally` | 공통 길 + 맞은 적에 돌 6 | 흔들 2 | 행 `ult.guardian.rally` |
| 0.45 | `slam` 첫 타 | 오늘 드래그 「내려찍기」 그림 + 금(반경 2.6, 8줄) | 흔들 5 · 범위 .7 | 행 `drag.guardian.slam` |
| 0.45 | `aegis` 지원 | 아군 빛기둥 | — | — |
| 0.75 | `citadel` 접촉 | 0.35초 전 성벽 자리에 육각판 + 방패 4개가 성벽 줄(−4.5/−1.5/1.5/4.5)에 차례로 떨어짐 → 가로지르는 방패 물결(13칸, 굵기 3), 흰 물결, 별 60, 유리 14, 돌 12 | **멈춤 .055** · 흔들 7 · 범위 .9 | 행 `ult.guardian.citadel` |
| 0.75~6.75 | `barrier` 장판 | 육각 벽 장식 | — | 행 반복 |
| 1.6 | `wave` ★ | 성벽 가운데로 조이는 고리 → 오늘 드래그 「방패 파도」 그림이 성벽 앞 띠를 따라 앞으로(회전 맞춤) | ★ (城) | sfx (A1과 같음) |

데이터:
```ts
finale: 'wave',
sfx: { wave: [{ id: 'drag.guardian.charge', lead: 0.5 }, { id: 'drag.guardian.wave' }] },
// part 0: stage 'rally' → 'slam' (values unchanged); the path keeps stage 'rally'
// new, last:
{ stage: 'wave', rel: 'aim', center: 'point', offset: { x: 1.5, y: 0 }, delay: 1.6, telegraphLead: 0.4,
  area: { shape: 'rect', dir: 'right', anchor: 'start', length: 5, width: 13 }, affects: 'enemies',
  effects: [{ kind: 'damage', amount: 1.6 }, { kind: 'knockback', distance: 2.5 }, { kind: 'status', status: 'stun', duration: 0.5, value: 0 }] },
```
새 설명: 「끌어 놓은 곳까지 돌진(최대 8칸)하며 지나간 길(폭 2.2)에 공격력 50% 피해. 착지 지점 반경 2.4에 공격력 100% 피해 + 0.8초 기절, 모든 아군에게 보호막(최대 HP 30%, 8초). 0.75초에 돌진 방향을 가로막는 성벽(길이 13, 폭 3): 공격력 220% 피해 + 1.5초 기절 + 4초 도발. 성벽은 6초간 남아 아군 방어 +30%, 적 40% 둔화. 1.6초에 성벽이 앞으로 밀려 나감(성벽 앞 1.5칸부터 길이 5, 폭 13): 공격력 160% 피해 + 2.5칸 넉백 + 0.5초 기절.」

구현:
- look `guardian_ud`: move = ShieldWave along the dash (ang = move angle, r = dash length, w 2.2, 0.35 s) + Square 10 along.
- `guardian_ud_path:rally`: role default + Rock 6 at each enemy hit.
- `slam`: alias `guardian_d:slam` + crackFx(r 2.6, n 8) · impact `{ shake: 5, flash: 0.7 }`.
- `citadel`: prep areaFx(Hex, wall, 0.35 s) + 4 × `fallAt(Shield 1.4)` on the wall line (wait delay−0.35+0.04·i, dur 0.35) · land ShieldWave across (ang = ultAngle, r 13, w 3) + white wave + star 60 + Glass 14 + Rock 12 · impact `{ stop: 55, shake: 7, flash: 0.9 }`.
- `barrier`: decor `hexWall`. `aegis`: alias `guardian_u:aegis`.
- `wave`: prep inward rings on the wall centre · alias `guardian_d:wave` (rot-aware, k 1.3) · finisher `{ glyph: '城' }` · motif `outline`.

#### A3. 팔라딘 조준 「성창 심판」 — 연출만 (예고 짧게) · finale `tribunal`

창 8개가 걸어 들어오고 → 1.2초 큰 십자.

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0.45 | `sanctuary` 지원 | 오늘 그림(빛기둥 6 + 아군 빛) | — | 행 (없음) |
| 0.6~0.95 | `spear` ×8 첫 타 → 쌓기 | 창이 하늘(높이 7)에서 0.25초에 꽂힘, 바깥 것일수록 크게, 꽂힐 때마다 조금씩 커짐 | 첫 창 **멈춤 .03** · 흔들 3 · 범위 .5, 나머지 흔들 1.5 | 행 `ult.paladin.spear` 타격마다 |
| 1.2 | `tribunal` ★ | 0.75초 전부터 겨눈 곳에 십자 낙인이 타오르고 큰 창 4개가 십자 끝에 꽂힘 → 오늘 「대심판」(십자 물결, 빛기둥 1.8×12, 팔 기둥 8, 금빛 22) | ★ (審) | 행 `ult.paladin.tribunal` |

데이터: 창 8개 `telegraphLead: 0.15` (예고 8개가 화면을 덮어서; 떨어지는 창이 예고). `finale: 'tribunal'`.

구현: `sanctuary` alias `paladin_u:sanctuary` · `spear` alias `paladin_u:spear` (prep + land, `seqAsHit`) · impact `(s) => s.seq === 0 ? { stop: 30, shake: 3, flash: 0.5 } : { shake: 1.5, flash: 0.3 }` · `tribunal` alias `paladin_u:tribunal` (prep `@point`, land as is) + 4 × fallAt(Spear 1.6) on the arm tips (wait delay−0.3) · finisher `{ glyph: '審' }`.

#### A4. 팔라딘 드래그 「축복의 돌격」 — 연출만 (이름 바꿈) · finale `tribunal`

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0~0.16 | 이동(돌진 9) | 공통 + 길 위 금빛 빛줄기(폭 1.2, 0.3초) | 흔들 2 (착지 흔들만) | `dash.tank` |
| 0.45 | 길 `blessing` | 지나간 아군에 빛 + 길 따라 금빛 가루 | — | sfx `_path: null` (아래 원과 겹침) |
| 0.45 | `brand` 접촉 | 오늘 「낙인」 + 십자 낙인이 0.95초까지 맥박치며 남음 | **멈춤 .04** · 흔들 4 · 범위 .7 | 행 `drag.paladin.brand` |
| 0.45 | `blessing` 지원 | 오늘 「축복」 | — | 행 `drag.paladin.blessing` |
| 0.95 | `tribunal` ★ | 0.5초 전부터 낙인 맥박이 빨라짐 → 오늘 「빛기둥」 ×1.3 세기 + 금빛 고리 0.5→5 | ★ (審) | 행 `ult.paladin.tribunal` |
| 0.95 | `core` 짝 | 오늘 「가운데」(별 58) | 범위 .7 | 행 (없음) |

데이터: 길 `stage` `sanctuary` → `blessing`; 십자 낙인 `spear` → `brand`; 반경 4 아군 `sanctuary` → `blessing`; 가운데 원 `tribunal` → `core`; 큰 십자는 `tribunal` 그대로. `finale: 'tribunal'`, `sfx: { _path: null }`.

구현: look move = beam(gold, w 1.2, 0.3 s) · `paladin_ud_path:blessing` alliesGlow + Gold spray along · `brand` alias `paladin_d:brand` + areaFx(Brand, 0.5 s, wait 0) pulsing · impact `{ stop: 40, shake: 4, flash: 0.7 }` · `blessing` alias `paladin_d:blessing` · `tribunal` prep Brand pulse (wait delay−0.5) · alias `paladin_d:pillar` (k 1.3) + rings 0.5→5 HOLY · `core` alias `paladin_d:core` · impact `{ flash: 0.7 }`.

#### A5. 워든 조준 「사슬 갈고리 · 철창」 — 시간만 조정 (철창 0.9 → 1초) · finale `cage`

갈고리를 던져 끌어오고(0.2초 미끄러짐) → 다 끌려온 뒤 1초에 철창.

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0.45 | `chainstorm` 지원 | 방울막(#c7e59a) + 사슬이 소용돌이(3→1, 0.5초) | — | 행 (없음) |
| 0.45 | `hook` 첫 타 | 0.45초 동안 12칸 사슬 조준선 + 워든 둘레 도는 사슬 → 사슬이 띠 끝까지 날아감(0.18초) → 맞은 적마다 워든과 사슬로 이어져 끌려옴(0.45초), 사각 불꽃 3 | **멈춤 .045** · 흔들 4 · 범위 .6 | 행 `drag.warden.hook` |
| 1.0 | `cage` ★ | 철창(3)이 하늘(높이 9)에서 떨어짐 → 오늘 「철창」(고리, 돌 16, 별 60) + 금(반경 3.3, 8줄) | ★ (獄) | 행 `ult.warden.cage` |
| 1.0~6.0 | `prison` 장판 | 감옥 장식 | — | 행 반복 |
| 6.0 | `release` 뒤풀이 | 오늘 「해방」 + 사슬 고리 12개가 튐 | **멈춤 .07** · 흔들 6 · 범위 .8 | 행 `ult.warden.release` |

데이터: `cage` · `prison` delay 0.9 → 1, `release` delay 5.9 → 6. `finale: 'cage'`. 설명의 「0.9초에」 → 「1초에」(나머지 그대로).

구현: `chainstorm` selfBubble + chains(r 3→1, 0.5 s) · `hook` prep aimLine(12, CHAIN, w 2.4) + Chains on the warden · land tetherFx(Chain, warden→band end, 0.18 s) + per enemy tetherFx(Chain, warden↔enemy, follow2, 0.45 s) + Square 3 · impact `{ stop: 45, shake: 4, flash: 0.6 }` · `cage` alias `warden_u:cage` (prep `@point`, land) + crackFx(r 3.3, n 8) · finisher `{ glyph: '獄' }` · `prison` decor `prison` · `release` alias `warden_u:release` (prep `@point`, land) + Square 12 · impact `{ stop: 70, shake: 6, flash: 0.8 }` · motif `countdown`.

#### A6. 워든 드래그 「사슬 대감옥」 — 연출만 · finale `cage`

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0~0.16 | 이동(돌진 8) | 공통 + 출발점→착지 사슬(처짐 0.2, 0.35초) | 착지 **멈춤 .05** · 흔들 7 | `dash.tank` |
| 0.45 | 길 `chainstorm` | 착지점에서 끌린 적마다 사슬 | 흔들 2 | 행 (없음) |
| 0.45 | `hook` 첫 타 | 사슬 원(6) + 사방 16줄 사슬(6.5) + 맞은 적마다 사슬 | 흔들 5 · 범위 .6 (멈춤 없음: 마무리 0.35초 전) | 행 `drag.warden.hook` |
| 0.45 | `chainstorm` 지원 | 방울막 | — | — |
| 0.8 | `cage` ★ | A5와 같음(착지 자리) | ★ (獄) | 행 |
| 5.8 | `release` 뒤풀이 | A5와 같음 | **멈춤 .07** · 흔들 6 | 행 |

구현: look move = tetherFx(Chain, from→to, sag 0.2, 0.35 s) · `warden_ud_path:chainstorm` tethers landing→each enemy hit · `hook` alias `warden_u:chainstorm` (caster = landing) + alias `warden_d:hook` · impact `{ shake: 5, flash: 0.6 }` · `chainstorm` selfBubble · `cage` / `prison` / `release` as A5. `finale: 'cage'`.

#### A7. 블레이드 조준 「천검 · 검기 폭풍」 — 연출만 · finale `issen`

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0.5~1.4 | `storm` ×10 첫 타 → 쌓기 | 부채꼴 안 아무 곳에 베기 2개씩(칠수록 커짐), 3번째마다 흰 X 베기, 첫 번째에 블레이드가 한 바퀴(반경 1.5) + 꽃잎 6 | 흔들 3 · 범위 .4 (마지막만), 나머지 흔들 1.5 | 행 `ult.blade.storm` |
| 1.8 | `issen` ★ | 0.3초 전 세상이 검게 물들고(0.55) 16칸 띠를 따라 흰 조준선 + 블레이드 잔상 → 흰 빛줄기(3.3) + 진홍 빛줄기(1.2), 띠를 가로지르는 굵은 베기 7개(0.02초 간격), 꽃잎 18, 띠가 거의 가로면 화면을 가로지르는 흰 선 | ★ (斬, 자국 gash) | 행 `ult.blade.issen` (줄이기 포함) |

구현: look `{ lock: 'small' }` · `storm` land: 2 × slash at `randomIn(s)` (grow 0.05/hit), every 3rd hit xslash 40 white, hit 0 Spin r 1.5 + Petal 6 · impact `(s) => s.hit === s.hits - 1 ? { shake: 3, flash: 0.4 } : { shake: 1.5 }` · `issen` prep aimLine(white, w 3, wait delay−0.25) + afterimage · land beamAlong(w 3.3 white, 0.35 s) + beamAlong(w 1.2 crimson) + 7 heavy slashes across (wait 0.02·i) + Petal 18 along + `h.screen.slash(y)` when |sin(ultAngle)| < 0.35 · charge `{ vignetteColor: '#000000', vignette: 0.55 }` · finisher `{ glyph: '斬' }` · motif `aim`. `finale: 'issen'`.

#### A8. 블레이드 드래그 「천검 삼연섬」 — 연출만 (이름 바꿈) · finale `issen`

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0~0.16 | 이동(돌진 8) | 공통 + 잔상 3 | 흔들 2 (착지 흔들만) | `dash.melee` |
| 0.45 | `dash` 접촉 | 오늘 드래그 「돌진 베기」 ×1.3 세기(베기 4, 잔상 3, 물결) — 회전 맞춤 | **멈춤 .045** · 흔들 5 · 범위 .7 | 행 `drag.blade.dash` |
| 0.75 | `return` 쌓기 | 오늘 「되돌아 베기」를 실제 방향으로(먼 끝 → 착지점 X 베기 7) + 꽃잎 6 | 흔들 4 · 범위 .6 | 행 `drag.blade.return` |
| 1.1 | `issen` ★ | 0.25초 전 검게 물듦(0.5) + 길 따라 흰 조준선 → 오늘 「폭발」(흰 물결, 꽃잎 기둥 6) + 흰 빛줄기(3.3) + 별 60, 가로면 화면 흰 선 | ★ (斬) | 행 `ult.blade.issen` |

데이터: 1번 부분 `hop` → `dash`, 2번 부분 `hop` → `return`. `finale: 'issen'`.

구현: look move = 3 afterimages · `dash` alias `blade_d:dash` (rot, k 1.3) · impact `{ stop: 45, shake: 5, flash: 0.7 }` · `return` alias `blade_d:return` (`lineAsRect`; the core makes it follow the real line) + Petal 6 · impact `{ shake: 4, flash: 0.6 }` · `issen` prep aimLine(white, 0.3 s) · land alias `blade_d:burst` (rot) + beamAlong(w 3.3 white) + star 60 + screen.slash when horizontal · charge `{ vignetteColor: '#000000', vignette: 0.5 }` · finisher `{ glyph: '斬' }`.

#### A9. 버서커 조준 「혈귀 돌진」 — 설계 변경 (마무리 「혈귀 낙하」 추가, 이름 바꿈) · finale `quake`

돌진 → 포효 → 1.5초에 그 자리로 뛰어올라 내려찍기 → (8.25초 마무리 일격은 덤).

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0.45 | `split` 첫 타 | 0.45초 동안 6칸 용암빛 조준선 + 버서커 불씨 6 → 띠 따라 땅이 갈라짐(5줄) + 돌 10 + 잔상 3 + 끝에 별 40 | **멈춤 .045** · 흔들 5 · 범위 .7 | 행 `drag.berserker.split` (lead 0.15) |
| 0.45 | `frenzy` 지원 | 오늘 「광란」 | — | 행 심장 소리 반복 |
| 0.7 | `roar` 쌓기 | 오늘 「포효」(멈춘 자리) | 흔들 4 · 범위 .6 | 행 `ult.berserker.roar` |
| 1.5 | `quake` ★ | 0.5초 전 버서커가 높이 2.4로 뛰어오름(그 자리 1.5칸 안일 때) + 몸에 용암 기둥 → 오늘 드래그 「내려찍기」 ×1.4 세기 + 반경 3 둘레 용암 기둥 6 + 그을림(2.5, 3초) | ★ (破, 자국은 그을림으로 대신) | sfx `drag.berserker.slam` lead 0.12 + `drag.berserker.quake` |
| 8.25 | `finale` 뒤풀이 | 오늘 「마무리 일격」 그대로 | **멈춤 .1** · 흔들 10 · 화면 .38 #ffd0c2 (오늘과 같음) | 행 `ult.berserker.finale` |

데이터:
```ts
finale: 'quake',
sfx: { quake: [{ id: 'drag.berserker.slam', lead: 0.12 }, { id: 'drag.berserker.quake' }] },
// part 0: stage 'rush' → 'split' (values unchanged)
// new, after 'roar' (the rush moved the berserker at cast, so 'self' = where the rush stops — the preview draws it there):
{ stage: 'quake', center: 'self', delay: 1.5, telegraphLead: 0.4, area: { shape: 'circle', radius: 3.8 }, affects: 'enemies',
  effects: [{ kind: 'damage', amount: 2.2 }, { kind: 'status', status: 'stun', duration: 0.6, value: 0 }, { kind: 'knockback', distance: 1 }] },
```
새 설명: 「겨눈 쪽으로 6칸 돌진(폭 2.6)하며 공격력 150% 피해 + 0.8초 기절, 0.7초에 멈춘 자리 반경 3.2에 공격력 120% 피해. 1.5초에 그 자리로 뛰어올라 내려찍기(반경 3.8): 공격력 220% 피해 + 0.6초 기절 + 1칸 넉백. 8초간 공격력 +50%, 공격 속도 +50%, 피해의 25% 흡혈, 기본 공격 범위 +0.4. 끝날 무렵(8.25초) 주변 반경 3.5에 마무리 일격: 공격력 250% 피해 + 1.5칸 넉백.」

구현: look `{ lock: 'small' }` · `split` prep aimLine(LAVA, 6, 0.45 s) + Ember 6 on the caster · land crackFx(ang = ultAngle, spread 0.5 rad, r 6, n 5) + Rock 10 along + 3 afterimages along + star 40 at the far end · impact `{ stop: 45, shake: 5, flash: 0.7 }` · `frenzy` alias `berserker_u:frenzy` · `roar` alias `berserker_u:roar` · impact `{ shake: 4, flash: 0.6 }` · `quake` prep `h.hop(src, 2.4, 0.5)` via `h.later(delay−0.5)` when the caster is ≤ 1.5 from the spot + lightPillar LAVA on the caster · land alias `berserker_d:slam` (k 1.4) + 6 × lightPillar LAVA on r 3 + scorchFx(r 2.5, 3 s) · charge `{ vignette: 0.25 }` · finisher `{ glyph: '破' }` · linger `null` · `finale` alias `berserker_u:finale` · impact `{ stop: 100, shake: 10, flash: 1, screen: 0.38, screenColor: '#ffd0c2' }` · motif `countdown`.

#### A10. 버서커 드래그 「혈귀 대지분쇄」 — 설계 변경 (여진 → 용암 분출 3번, 이름 바꿈) · finale `quake`

뛰어올라 0.45초에 쿵 → 부채꼴 가르기 → 갈라진 줄을 따라 용암이 먼 곳부터 착지 쪽으로 세 번 솟고 마지막(착지 바로 앞, 끌어 놓은 보스 위)이 가장 큼.

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0~0.45 | 이동(순간이동 9 → 도약) | 출발점 잔상 + 불씨, 도착점에서 몸 0.08초 숨김 → 높이 2.6에서 0.45초에 내려꽂힘. 착지 컷은 공중에 있는 동안(0.08~0.42초) | (착지 = 아래 `slam`) | `mon.blink` −3dB |
| 0.45 | `slam` 첫 타 · 착지 | 오늘 드래그 「내려찍기」 + 그을림(2) | **멈춤 .05** · 흔들 6 · 범위 .8 | 행 `drag.berserker.slam` |
| 0.45 | `frenzy` 지원 | 오늘 「광란」 | — | 행 |
| 0.7 | `split` 쌓기 | 0.3초 전 희미한 금 → 오늘 「가르기」 ×1.3 세기(회전 맞춤) | 흔들 4 · 범위 .7 | 행 `drag.berserker.split` |
| 1.25 / 1.38 | `quake` 쌓기 ×2 | (7칸 · 4.5칸 앞) 0.3초 전 그 자리에 불씨가 솟음 → 용암 기둥(폭 0.8/1.0, 높이 5/6), 불씨 6, 돌 6 | 흔들 3 · 범위 .6 | sfx 쿵 lead 0.12 (단계마다 +2음) |
| 1.5 | `quake` ★ | (1.5칸 앞) 갈라진 줄 전체가 9칸까지 빛남 → 큰 용암 기둥(1.3 × 8) + 고리 0.4→3.5 + 별 52 | ★ (破) | sfx 마지막 `drag.berserker.quake` (쾅 순간에) |

데이터:
```ts
finale: 'quake',
sfx: { quake: { id: 'drag.berserker.slam', on: 'hit', step: 2, max: 3, last: 'drag.berserker.quake', lead: 0.12 } }, // lead: 23차 검토
// part 0: stage 'roar' → 'slam' (values unchanged); 'frenzy', 'split' (0.7) unchanged
// the last part (stage 'finale', cone 10 / 45°, 150 %) is REMOVED and replaced by three geysers along the crack
// (23차 검토: x 3 / 6 / 9 → 7 / 4.5 / 1.5 — back toward the landing, the ★ on the boss it was dropped on):
{ stage: 'quake', rel: 'aim', center: 'point', offset: { x: 7, y: 0 }, delay: 1.25, telegraphLead: 0.45, area: { shape: 'circle', radius: 1.8 }, affects: 'enemies',
  effects: [{ kind: 'damage', amount: 1.5 }, { kind: 'status', status: 'burn', duration: 3, value: 0.2 }] },
{ stage: 'quake', rel: 'aim', center: 'point', offset: { x: 4.5, y: 0 }, delay: 1.38, telegraphLead: 0.45, area: { shape: 'circle', radius: 2 }, affects: 'enemies',
  effects: [{ kind: 'damage', amount: 1.5 }, { kind: 'status', status: 'burn', duration: 3, value: 0.2 }] },
{ stage: 'quake', rel: 'aim', center: 'point', offset: { x: 1.5, y: 0 }, delay: 1.5, telegraphLead: 0.45, area: { shape: 'circle', radius: 2.6 }, affects: 'enemies',
  effects: [{ kind: 'damage', amount: 2.5 }, { kind: 'status', status: 'stun', duration: 0.6, value: 0 }, { kind: 'status', status: 'burn', duration: 3, value: 0.2 }] },
```
새 설명: 「끌어 놓은 곳으로 뛰어들어(최대 9칸) 반경 3에 공격력 120% 피해 + 0.5초 기절. 8초간 공격력 +50%, 공격 속도 +50%, 피해의 25% 흡혈, 기본 공격 범위 +0.4. 0.7초에 뛰어든 쪽 부채꼴(반경 6.5, 110°)을 갈라 공격력 200% 피해 + 3초간 40% 둔화. 1.25초부터 갈라진 쪽 7칸 · 4.5칸 · 1.5칸 앞에서 착지 쪽으로 차례로 용암 분출: 앞의 둘(반경 1.8, 2)은 각각 공격력 150% 피해, 마지막(반경 2.6)은 공격력 250% 피해 + 0.6초 기절, 모두 3초 화상(초당 공격력 20%).」

구현: look `berserker_ud` `{ touchdownAt: 0.45, stripFrom: 0.08, genericMove: 'lite', move: ghost + Ember trail at the start, hideFor(0.08) + later(0.08, hop(src, 2.6, 0.37)) }` (no separate touchdown picture: the `slam` beat is the touchdown) · `slam` alias `berserker_d:slam` + scorchFx(r 2) · impact `{ stop: 50, shake: 6, flash: 0.8 }` · `frenzy` alias · `split` prep crackFx(k 0.5, 0.3 s) · alias `berserker_d:split` (rot, k 1.3) · impact `{ shake: 4, flash: 0.7 }` · `quake` prep (seq 0 only) crackFx(LAVA, along the aim to 9) + Ember rising at the spot (wait delay−0.3) · land lightPillar LAVA (w/h by seq: 0.8×5, 1.0×6, 1.3×8) + Ember 6 + Rock 6 · non-finisher impact `{ shake: 3, flash: 0.6 }` · the finisher adds rings 0.4→3.5 + star 52 · finisher `{ glyph: '破' }`.

#### A11. 섀도우 조준 「월영 질주」 — 연출만 · finale `moon`

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0~0.45 | (먹물 속으로 사라짐 — 지금 그대로) | 발밑 먹물 웅덩이(1.2) | — | — |
| 0.45 | `dance` 띠 · 첫 타 | 띠 따라 검보라 빛줄기(폭 2) + 가는 흰 줄기, 잔상 4, 먹물 10 | **멈춤 .045** · 흔들 4 · 범위 .7 | 행 `ult.shadow.dance` |
| 0.6~0.8 | `dance` 분신 ×3 쌓기 | 오늘 「분신 폭발」(점점 커짐) | 흔들 1.5 | 행 |
| 1.4 | `moon` ★ | 겨눈 곳(8칸 안) 위에 초승달이 걸림(오늘 그림, 세상이 보랏빛으로 물듦) → 오늘 「초승달 베기」 + 먹물 10 | ★ (影, 먹물 자국) | 행 `ult.shadow.moon` |

데이터 (23차 검토): `aimRange: 8` · `moon` center `'self'`(8칸 돌진이 멈춘 자리) → `'point'`(겨눈 곳). 새 설명의 마무리: 「1.4초에 겨눈 곳(8칸 안) 초승달 베기(반경 2.8): …」.

구현: look `{ lock: 'point' }` (23차 검토: 전에는 `'small'`) · `dance` prep (the rect part only) scorchFx(ink, r 1.2) at the caster · land rect: beamAlong(#1b1c3d, w 2) + beamAlong(white, w 0.5) + 4 afterimages along + Ink 10 · land circles: alias `shadow_u:dance` (`seqAsHit`) · impact `(s) => s.area.shape === 'rect' ? { stop: 45, shake: 4, flash: 0.7 } : { shake: 1.5, flash: 0.4 }` · `moon` alias `shadow_u:moon` (prep + land) + Ink 10 · finisher `{ glyph: '影' }` · motif `reticle`. `finale: 'moon'`.

#### A12. 섀도우 드래그 「그림자 대처형진」 — 연출만 (이름 바꿈) · finale `moon` (**→ 8장 A12′**: 24차에 「흑월 대처형진」으로 새로 짬, 아래는 23차 기록)

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0~0.18 | 이동(순간이동 9) | 공통 + 착지점 먹물 웅덩이 | (착지 흔들만) | `mon.blink` |
| 0.45~0.69 | `clone` ×4 첫 타 → 쌓기 | 오늘 드래그 「분신」(점점 커짐) | 첫 분신 **멈춤 .04** · 흔들 4, 나머지 흔들 1.5 | 행 `drag.shadow.clone` |
| 0.75 | `vanish` 지원 | 오늘 「사라짐」 + 미끄러진 길에 잔상 3 | — | 행 (없음) |
| 1.0 | `execute` 쌓기 | 오늘 드래그 「처형」(X 낙인 + 조이는 고리 → X 베기) | 흔들 6 · 범위 .9 | 행 `drag.shadow.execute` |
| 1.5 | `moon` ★ | 대상 위 초승달 → 초승달 베기 | ★ (影) | 행 `ult.shadow.moon` |

데이터: 분신 4개 `dance` → `clone`, X 십자 `dance` → `execute`. `finale: 'moon'`.

구현: look move = alias PREP `shadow_d:clone` (the ink pool) at the landing · `clone` alias `shadow_d:clone` (`seqAsHit`) · impact `(s) => s.seq === 0 ? { stop: 40, shake: 4 } : { shake: 1.5 }` · `vanish` alias `shadow_u:vanish` + 3 afterimages along the slide · `execute` alias `shadow_d:execute` (prep + land) · impact `{ shake: 6, flash: 0.9 }` · `moon` alias `shadow_u:moon` · finisher `{ glyph: '影' }` · motif `reticle`.

#### A13. 레인저 조준 「매의 화살비」 — 연출만 · finale `skyshot` (**→ 8장 A13′**: 24차에 「매의 화살비 · 천공 강하」로 새로 짬, 아래는 23차 기록)

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0.5~1.38 | `barrage` ×12 첫 타 → 쌓기 | 레인저→겨눈 곳 가는 조준선(0.45초) + 활에 빛 → 화살이 반경 2.5 안 아무 곳에 꽂힘, 3번째마다 흙먼지 | 흔들 1 · 범위 .3 (마지막만), 나머지 흔들 0.8 | 행 `ult.ranger.barrage` |
| 1.6~2.0 | `rain` ×5 쌓기 | 오늘 「화살비」(하늘로 쏘아 올림 → 쏟아짐) | 흔들 2 · 범위 .4 | 행 `ult.ranger.rain` |
| 2.3 | `skyshot` ★ | 조준 표시 + 금빛 기둥 + 떨어지는 큰 화살(오늘 그림) → 오늘 「하늘 화살」 + 그을림(1.2) | ★ (穿) | 행 `ult.ranger.skyshot` |

구현: `barrage` prep aimLine(caster→point, #c9ffe9, w 0.8, 0.45 s) + star on the bow · land `runStory('ranger_u:barrage', 'land', …, { x, y } = randomIn(s))` + every 3rd hit Smoke puff · impact `(s) => s.hit === s.hits - 1 ? { shake: 1, flash: 0.3 } : { shake: 0.8 }` · `rain` alias `ranger_u:rain` · impact `{ shake: 2, flash: 0.4 }` · `skyshot` alias `ranger_u:skyshot` + scorchFx(r 1.2) · charge `{ vignetteColor: '#000000', vignette: 0.35 }` · finisher `{ glyph: '穿' }` · motif `reticle` (rain, skyshot). `finale: 'skyshot'`.

#### A14. 레인저 드래그 「매의 대일격」 — 연출만 (이름 바꿈) · finale `pierce` (**→ 8장 A14′**: 24차에 새로 짬, 아래는 23차 기록)

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0~0.16 | 이동(돌진 9) | 공통 + 착지에서 앞구르기(높이 1.2, 0.35초) + 깃털 8 | 착지 **멈춤 .05** · 흔들 7 | `dash.ranged` |
| 0.5~1.22 | `volley` ×10 첫 타 → 쌓기 | 대상을 지나는 조준선(따라감) → 세 줄 연사(점점 커짐) | 흔들 1 · 범위 .35 (마지막만) | sfx 활 당김(시전) + 연사 6번 |
| 1.25 | `pierce` ★ | 줄어드는 고리 + 렌즈 빛 → 빛줄기(1.8) + 흰 빛줄기, 큰 화살(2.4), 깃털, 대상에 별 60 | ★ (穿) | 행 `drag.ranger.pierce` |

데이터: `barrage` → `volley`, `skyshot` → `pierce`. `finale: 'pierce'`, `sfx: { volley: [{ id: 'drag.ranger.draw', on: 'cast' }, { id: 'drag.ranger.volley', on: 'hit', step: 2, max: 6 }] }`.

구현: look `{ move: Feather 8 along, touchdown: later(0, hop(src, 1.2, 0.35)) }` · `volley` alias `ranger_d:volley` (`lineAsRect`, prep + land) · impact as A13 barrage · `pierce` alias `ranger_d:pierce` (`lineAsRect`) + star 60 at the target · charge `{ vignetteColor: '#000000', vignette: 0.4 }` · finisher `{ glyph: '穿' }` · motif `aim` (both).

#### A15. 메이지 조준 「블리자드 · 빙결풍」 — 설계 변경 (4.85초 → 2.45초, 고드름 추가) · finale `shatter`

눈보라 → 고드름 다섯 개가 차례로 → 얼림 → 2.45초에 깨짐. (22차는 0.45~4.45초 내내 같은 부채꼴뿐이었음.)

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0.45~2.45 | `blizzard` 장판 | 0.45초 동안 메이지 발밑 얼음 룬(1.8) → 부채꼴 가운데 눈(반경 5, 2.1초) + 얼음 물결 · 고리 + 부채꼴을 쓸고 가는 유리 16, 틱마다 유리 4 | 첫 틱 **멈춤 .04** · 흔들 4 · 범위 .6 | 행 `ult.mage.blizzard` 반복(2초) |
| 0.9~1.7 | `hail` ×5 쌓기 | 얼음 유성(0.6)이 하늘(높이 7)에서 0.22초에 떨어짐 → 얼음 고리(1.5), 유리 6, 흰 별 24(점점 커짐) | 흔들 2 · 범위 .5 | sfx `fx.frost` 타격마다 +1음 |
| 2.05 | `freeze` 쌓기 | 0.3초 전 하늘색 물듦 → 오늘 「얼림」(적마다 얼음, 안으로 조이는 고리) | 흔들 5 · 범위 .7 | 행 `ult.mage.freeze` |
| 2.45 | `shatter` ★ | 오늘 「깨짐」 ×1.2 세기 + 흰 부채꼴 물결 | ★ (凍, 서리 자국) | 행 `ult.mage.shatter` |

데이터 (모두 rel 'aim', center 'self', 부채꼴은 반경 8 · 80° 그대로):
```ts
finale: 'shatter',
sfx: { hail: { id: 'fx.frost', on: 'hit', step: 1, max: 5 } },
// 'blizzard': zone { duration: 4, tickInterval: 0.5 } → { duration: 2, tickInterval: 0.4 } (effects unchanged)
// new, after 'blizzard' (all inside the fan):
...([[3, -1.5, 0.9], [4.5, 1.5, 1.1], [6, -1, 1.3], [7, 1.2, 1.5], [5, 0, 1.7]] as const).map(([x, y, d]) => ({
  stage: 'hail', rel: 'aim', center: 'self', offset: { x, y }, delay: d, telegraphLead: 0.25, area: { shape: 'circle', radius: 1.3 }, affects: 'enemies',
  effects: [{ kind: 'damage', amount: 0.6 }, { kind: 'status', status: 'slow', duration: 2, value: 0.5 }] })),
// 'freeze': delay 4.45 → 2.05, telegraphLead 0.5 → 0.4 · 'shatter': delay 4.85 → 2.45
```
새 설명: 「겨눈 쪽 부채꼴(반경 8, 80°)에 2초간 0.4초마다 공격력 45% 피해 + 50% 둔화. 0.9초부터 부채꼴 안 다섯 곳에 고드름(반경 1.3)이 차례로 떨어짐: 각각 공격력 60% 피해 + 2초간 50% 둔화. 2.05초에 얼려 1초 기절 + 3초간 받는 피해 +25%, 2.45초에 깨지며 공격력 300% 피해.」

구현: look `{ lock: 'small' }` · `blizzard` prep rune(caster, r 1.8, ICE, 0.45 s) · land hit 0: snow(4.5 ahead, r 5, 2.1 s) + `runStory('mage_u:blizzard', 'land')` placed at the fan middle + Glass 16 swept along the fan; later ticks Glass 4 · impact `(s) => s.hit === 0 ? { stop: 40, shake: 4, flash: 0.6 } : null` · decor `blizzard` (the core clips it to the cone) · `hail` prep fallAt(Meteor 0.6, ICE, z 7, 0.22 s) · land ring ICE r 1.5 + Glass 6 + star 24 (grow by seq) · impact `{ shake: 2, flash: 0.5 }` · `freeze` prep vignette #bfefff 0.3 (later delay−0.3) · alias `mage_u:freeze` · impact `{ shake: 5, flash: 0.7 }` · motif `countdown` · `shatter` alias `mage_u:shatter` (k 1.2) + white cone wave · charge `{ vignette: 0 }` (the freeze already tinted) · finisher `{ glyph: '凍' }`.

#### A16. 메이지 드래그 「빙결 유성우」 — 연출만 · finale `shatter`

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0~0.18 | 이동(순간이동 9) | 공통 + 착지점 얼음 고리 · 유리 + 발밑 얼음 룬(3.4, 1.5초) | (착지 흔들만) | `mon.blink` + sfx 룬(시전) |
| 0.45~1.01 | `freeze` 우박 ×8 첫 타 → 쌓기 | 얼음 유성(0.6)이 높이 7에서 떨어짐 → 얼음 연기, 유리 6, 별 22(점점 커짐) | 첫 우박 **멈춤 .035** · 흔들 3, 나머지 흔들 1.5 | sfx `fx.frost` 타격마다 +1음 |
| 1.3 | `shatter` ★ | 0.55초 동안 큰 얼음 유성(1.7)이 높이 11에서 떨어짐 → 오늘 「깨짐」 + 얼음 폭발(반경 3 번쩍, 흰 고리, 유리 16) + 반경 3 적마다 얼음 + 서리 그을림(2.4, 3초) | ★ (凍) | 행 `ult.mage.shatter` |
| 1.3~4.3 | `blizzard` 장판 | 눈보라 장식 + 눈(2.8) | — | 행 반복 |

데이터: `finale: 'shatter'`, `sfx: { freeze: [{ id: 'drag.mage.sigil', on: 'cast', db: -4 }, { id: 'fx.frost', on: 'hit', step: 1, max: 8 }] }`.

구현: look `{ touchdown: ring ICE + Glass + rune(r 3.4, ICE, 1.5 s) }` · `freeze` prep fallAt(Meteor 0.6, ICE, z 7, 0.22 s) · land puff + Glass 6 + star 22 (grow by seq) · impact `(s) => s.seq === 0 ? { stop: 35, shake: 3, flash: 0.5 } : { shake: 1.5 }` · motif `rune` · `shatter` prep fallAt(Meteor 1.7, ICE, z 11, 0.55 s) · land alias `mage_u:shatter` `@point` + fireBurst-like ice burst + Encase on enemies in r 3 + scorchFx(frost, r 2.4, 3 s) · charge `{ vignette: 0.35 }` · finisher `{ glyph: '凍' }` · linger `null` · motif `rune` · `blizzard` decor `blizzard` + snow(r 2.8).

### 그룹 B

#### B1. 거너 조준 「포화 지원 · 이동 탄막」 — 연출만 · finale `heavy`

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0.5~1.4 | `shells` 5곳 × 2 첫 타 → 쌓기 | 첫 자리에만 빨간 신호탄(기둥 + 연기) · 자리마다 포탄 둘이 높이 8에서 0.2초에 떨어짐 → 오늘 「포탄」이 반경 2.5 안 아무 곳에 + 작은 그을림(0.8, 1.5초), 점점 커짐 | 첫 포탄 **멈춤 .035** · 흔들 4 · 범위 .5, 나머지 흔들 2.5 | 행 `ult.gunner.shells` |
| 1.9 | `heavy` ★ | 조준 표시(3) + 큰 포탄(1.6)이 높이 10에서 → 오늘 「대구경 포탄」(큰 폭발, 연기, 고리, 그을림) | ★ (爆, 자국은 오늘 그을림) | 행 `ult.gunner.heavy` |

구현: `shells` prep 2 × fallAt(Shell 0.5, z 8, wait delay−0.2 + 0.1·i) + (seq 0 only) red flare pillar + Smoke 10 · land `runStory('gunner_u:shells', 'land', …, randomIn(s))` + scorchFx(r 0.8, 1.5 s) (grow by seq) · impact `(s) => s.seq === 0 && s.hit === 0 ? { stop: 35, shake: 4, flash: 0.5 } : { shake: 2.5, flash: 0.3 }` · `heavy` alias `gunner_u:heavy` (prep + land) · charge `{ vignetteColor: '#000000', vignette: 0.35 }` · finisher `{ glyph: '爆' }` · linger `null` · motif `reticle`. `finale: 'heavy'`.

#### B2. 거너 드래그 「펌프 버스트 · 대구경 슬러그」 — 연출만 (이름 바꿈) · finale `slug`

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0~0.16 | 이동(돌진 7) | 공통 + 무릎 미끄럼 불꽃, 탄피, 연기 줄 | (착지 흔들만) | `dash.ranged` |
| 0.45 / 0.7 / 0.95 | `blast1` ×3 첫 타 → 쌓기 | 오늘 「산탄」(탄 14, 총구 불, 부채꼴 물결, 탄피, 연기 — 회전 맞춤), 점점 커짐 | 첫 발 **멈춤 .04** · 흔들 4 · 범위 .6, 나머지 흔들 3 · 범위 .5 | sfx 펌프(시전) + 발사 3번(−1음씩) |
| 1.3 | `slug` ★ | 총열이 달아오르고 0.45초 동안 주황 조준선(폭 2) → 오늘 「슬러그」(빛줄기 둘, 총구 40, 연기, 탄피) + 반동 잔상 + 띠 끝 별 50 | ★ (爆) | 행 `drag.gunner.slug` |

데이터: `shells` → `blast1`(지금 소리는 날아오는 포격 소리라 맞지 않음). `finale: 'slug'`, `sfx: { blast1: [{ id: 'drag.gunner.pump', on: 'cast' }, { id: 'drag.gunner.blast', on: 'hit', step: -1, max: 3 }] }`.

구현: look `{ move: Square brass + Smoke along }` · `blast1` land `shotgun()` (rot, grow per hit) · impact `(s) => s.hit === 0 ? { stop: 40, shake: 4, flash: 0.6 } : { shake: 3, flash: 0.5 }` · motif `fan` · `slug` prep alias `gunner_d:slug` + aimLine(orange, w 2, 0.45 s) · land alias `gunner_d:slug` (rot) + afterimage behind + star 50 at the lane end · charge `{ vignetteColor: '#000000', vignette: 0.35 }` · finisher `{ glyph: '爆' }` · motif `fan`.

#### B3. 클레릭 조준 「대천사 강림 · 조여드는 빛」 — 설계 변경 (마무리 「대천사 강림」 추가) · finale `descend`

큰 회복 → 빛의 고리 셋이 조여듦 → 1.6초에 대천사가 내려와 빛기둥.

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0.45 | `grace` 지원 | 오늘 「은총」 + 겨눈 곳 위로 깃털 10 | 화면 .3 #fffbe6 | 행 `ult.cleric.grace` |
| 0.45 / 0.7 / 0.95 | `judgement` ×3 첫 타 → 쌓기 | 빛의 고리가 r+1 → r×0.35로 조여듦(마지막은 흰색) | 셋째 고리 **멈춤 .045** · 흔들 5 · 범위 .8, 앞 둘 흔들 2.5 · 범위 .5 | 행 `ult.cleric.judgement` (내려가는 종소리) |
| 1.6 | `descend` ★ | 0.9초 전부터 겨눈 곳 위(높이 3)에 날개(4.5)가 나타나고 가는 빛기둥이 자람 → 빛기둥(2.2 × 12, 0.9초) + 성스러운 고리 0.5→6 ×3 + 흰 별 70 + 깃털 18 + 금빛 12 | ★ (聖) | sfx `drag.cleric.descend` + `heal.big` −4dB |
| 1.6 | `descend` 짝(아군) | 아군 빛(#7dffb3), 기둥 없이 | — | — |

데이터:
```ts
finale: 'descend',
sfx: { descend: [{ id: 'drag.cleric.descend' }, { id: 'heal.big', db: -4 }] },
// new, last two:
{ stage: 'descend', center: 'point', delay: 1.6, telegraphLead: 0.5, area: { shape: 'circle', radius: 2.8 }, affects: 'enemies',
  effects: [{ kind: 'damage', amount: 2 }, { kind: 'status', status: 'stun', duration: 0.8, value: 0 }] },
{ stage: 'descend', center: 'point', delay: 1.6, telegraphLead: 0, area: { shape: 'circle', radius: 6 }, affects: 'allies',
  effects: [{ kind: 'heal', amount: 0.12 }] },
```
새 설명: 「겨눈 곳 반경 6 아군 HP 45% 회복 + 정화(넘친 회복은 보호막, 최대 HP 25%까지 6초) + 6초간 초당 HP 3% 재생 + 6초간 방어 +15%. 빛의 고리 3번이 겨눈 곳으로 조여듦(반경 7.5 / 5 / 2.5): 각각 공격력 80% 피해, 앞의 둘은 1.5칸 끌어당김, 마지막은 1.2초 기절. 1.6초에 대천사 강림: 반경 2.8 적 공격력 200% 피해 + 0.8초 기절, 반경 6 아군 HP 12% 회복.」

구현: `grace` alias `cleric_u:grace` + Feather 10 over the point · impact `{ screen: 0.3, screenColor: '#fffbe6' }` · `judgement` alias `cleric_u:judgement` + rings r+1 → r·0.35 (white on seq 2) · impact `(s) => s.seq === 2 ? { stop: 45, shake: 5, flash: 0.8 } : { shake: 2.5, flash: 0.5 }` · motif `ticks` · `descend` (enemy) prep Wings(r 4.5, z 3, wait delay−0.9) + lightPillar thin growing · land lightPillar(w 2.2, h 12, GOLD, 0.9 s) + rings 0.5→6 HOLY ×3 + star 70 + alias `cleric_d:descend` (k 1.6) · charge `{ vignette: 0.3 }` · finisher `{ glyph: '聖' }` · twin (ally) alliesGlow(#7dffb3, beam false) · motif `ticks`.

#### B4. 클레릭 드래그 「성역의 종 · 천상의 울림」 — 설계 변경 (종 4.5초 → 2초, 종소리 두 번, 이름 바꿈) · finale `bell`

순간이동 → 성역 → 하늘에서 종이 천천히 내려오며 두 번 울리고 → 2초에 떨어짐. (22차는 0.45~4.5초 사이에 아무것도 없었음.)

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0~0.18 | 이동(순간이동 9) | 공통 + 출발 · 도착 깃털 | 착지 **멈춤 .05** · 흔들 7 | `mon.blink` |
| 0.45 | `descend` 지원 | 오늘 드래그 「강림」(빛기둥 1.2 × 8, 고리, 깃털) + 아군 빛 | 흔들 3 · 화면 .25 #fffbe6 | 행 `drag.cleric.descend` |
| 0.45~4.45 | `sanctuary` 장판 | 성역 장식 + 빛 가루 | — | 행 성역 소리 |
| 0.45~2.0 | (종) | 종(2.2)이 높이 7에서 1.55초 동안 천천히 내려옴 | — | — |
| 1.0 / 1.4 | `judgement` 종소리 ×2 쌓기 | 금빛 고리 0.5→5.5 ×2 + 음표 + 금빛 6 | 흔들 3 · 범위 .6 | 행 `ult.cleric.judgement` (두 번, 내려가는 음) |
| 2.0 | `bell` ★ | 종이 땅에 닿음 → 오늘 드래그 「종」 ×1.4 세기 + 빛기둥(2 × 10) + 흰 고리 0.4→6.5 + 금빛 16 + 깃털 10 | ★ (聖, 화면색 #fff3b0) | sfx `drag.cleric.bell` lead 0.4 + `ult.cleric.grace` −6dB |
| 2.0 | `bell` 짝(아군) | 아군 빛(#7dffb3) | — | — |

데이터 (전체):
```ts
finale: 'bell',
sfx: { bell: [{ id: 'drag.cleric.bell', lead: 0.4 }, { id: 'ult.cleric.grace', db: -6 }] },
actions: [
  // 0: stage 'grace' → 'descend' (allies r 5: cleanse, heal 0.25 + overflow shield, defUp 0.15 / 6 s — unchanged)
  // 1: stage 'grace' → 'sanctuary' (allies r 5 zone 4 s / 0.5, heal 0.04 — unchanged)
  { stage: 'judgement', center: 'point', delay: 1, telegraphLead: 0, area: { shape: 'circle', radius: 5 }, affects: 'enemies',
    effects: [{ kind: 'damage', amount: 0.6 }, { kind: 'status', status: 'slow', duration: 1, value: 0.4 }] },
  { stage: 'judgement', center: 'point', delay: 1.4, telegraphLead: 0, area: { shape: 'circle', radius: 5 }, affects: 'enemies',
    effects: [{ kind: 'damage', amount: 0.6 }, { kind: 'status', status: 'slow', duration: 1, value: 0.4 }] },
  // was 'judgement' at 4.5: stage → 'bell', delay 4.5 → 2, telegraphLead 1 (enemies r 5: damage 3, stun 1.5 — unchanged)
  // was 'grace' at 4.5:     stage → 'bell', delay 4.5 → 2 (allies r 5: heal 0.12 — unchanged)
]
```
새 설명: 「끌어 놓은 곳으로 순간 이동(최대 9칸). 반경 5 아군 정화 + HP 25% 회복(넘친 회복은 보호막, 최대 HP 20%까지 6초) + 6초간 방어 +15%. 4초간 성역: 0.5초마다 HP 4% 회복. 하늘에서 종이 내려오며 1초 · 1.4초에 울림(반경 5): 각각 공격력 60% 피해 + 1초간 40% 둔화. 2초에 큰 종: 반경 5 적에게 공격력 300% 피해 + 1.5초 기절, 아군 HP 12% 회복.」

구현: look `{ move: Feather burst at from and to }` · `descend` alias `cleric_d:descend` + alliesGlow · impact `{ shake: 3, screen: 0.25, screenColor: '#fffbe6' }` · `sanctuary` decor `sanctuary` + alias `cleric_d:sanctuary` · `bell` (enemy) prep fallAt(Bell 2.2, z 7, wait 0.45, dur 1.55) (no PREP alias: today's bell is smaller and faster) · `judgement` land rings 0.5→5.5 GOLD ×2 0.6 s + notes + Gold 6 · impact `{ shake: 3, flash: 0.6 }` · `bell` land alias `cleric_d:bell` (k 1.4) + lightPillar(w 2, h 10) + white rings 0.4→6.5 + Gold 16 + Feather 10 · finisher `{ glyph: '聖', screenColor: '#fff3b0' }` · twin alliesGlow(#7dffb3) · motif `ticks`.

#### B5. 메딕 조준 「골든 아워 · 응급 거점」 — 설계 변경 (제세동 마무리 추가) · finale `defib`

힐장판(응급 거점)이 충전되고 → 두 번 지지직 → 1.9초 「클리어!」 제세동. (22차는 0.45초 회복 뒤 6초 평평한 장판뿐.)

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0.45 | `golden` 지원 | 0.45초 동안 겨눈 곳에 흰 십자(2.2 × 0.9)가 타오르고 흰 빛기둥(0.9 × 6) → 오늘 「골든 아워」 + 오늘 드래그 「응급처치」 그림 | — | 행 `ult.medic.golden` |
| 0.45~6.45 | `siren` 장판 | 틱마다 오늘 「사이렌」(청록 고리 + 빨강/흰 고리) + 성역 장식(메딕 색) | — | 행 `ult.medic.siren` |
| 1.0 / 1.4 | `charge` ×2 쌓기 | 거점 가운데에서 안의 적마다 번개(최대 6, 0.22초) + 적마다 별 24(점점 커짐) | 흔들 2.5 · 범위 .5 | sfx `drag.medic.defib` −10dB (lead 0.15) |
| 1.9 | `defib` ★ | 0.3초 전 십자 네 팔을 따라 번개 → 오늘 드래그 「제세동」 ×1.5 세기 + 맞은 적마다 번개 + 흰 사각 10 | ★ (救) | 행 `drag.medic.defib` (lead 0.15) |
| 1.9 | `firstaid` 짝(아군) | 오늘 드래그 「응급처치」 | — | 행 `drag.medic.firstaid` |

데이터:
```ts
finale: 'defib',
sfx: { charge: { id: 'drag.medic.defib', db: -10, lead: 0.15 } }, // lead: 23차 검토
// 'golden' ×2 and 'siren' (6 s / 1 s) unchanged; new, last four:
{ stage: 'charge', center: 'point', delay: 1, telegraphLead: 0, area: { shape: 'circle', radius: 4.5 }, affects: 'enemies',
  effects: [{ kind: 'damage', amount: 0.4 }, { kind: 'status', status: 'slow', duration: 1, value: 0.4 }] },
{ stage: 'charge', center: 'point', delay: 1.4, telegraphLead: 0, area: { shape: 'circle', radius: 4.5 }, affects: 'enemies',
  effects: [{ kind: 'damage', amount: 0.4 }, { kind: 'status', status: 'slow', duration: 1, value: 0.4 }] },
{ stage: 'defib', center: 'point', delay: 1.9, telegraphLead: 0.5, area: { shape: 'cross', length: 6, width: 2.4 }, affects: 'enemies',
  effects: [{ kind: 'damage', amount: 1.5 }, { kind: 'status', status: 'stun', duration: 1, value: 0 }] },
{ stage: 'firstaid', center: 'point', delay: 1.9, telegraphLead: 0, area: { shape: 'circle', radius: 4.5 }, affects: 'allies',
  effects: [{ kind: 'heal', amount: 0.15 }] },
```
새 설명: 「겨눈 곳 반경 4.5 아군 HP 30% 회복 + 6초간 공격 속도 +25%. 모든 플레이어의 대기 캐릭터 HP 40% 회복 + 쓰러진 캐릭터 부활 대기 20초 감소. 6초간 응급 거점: 1초마다 사이렌, 안의 아군 HP 5% 회복 + 정화. 1초 · 1.4초에 거점이 충전되며 안의 적 공격력 40% 피해 + 1초간 40% 둔화, 1.9초에 「클리어!」 제세동 십자(+, 상하좌우 6칸, 폭 2.4): 공격력 150% 피해 + 1초 기절, 반경 4.5 아군 HP 15% 회복.」 (제세동 150% · 1초는 22차 「힐러라 낮춤」 결정 유지.)

구현: `golden` prep areaFx(Brand, white cross 2.2 × 0.9, 0.45 s) + lightPillar(white, 0.9 × 6) · land alias `medic_u:golden` + `runStory('medic_d:firstaid', 'land')` at the point · `siren` alias `medic_u:siren` `@point` · decor `sanctuary` · `charge` land boltFx(point → each enemy in r 4.5, ≤ 6, #bdf6ff, 0.22 s) + star 24 each (grow by seq) · impact `{ shake: 2.5, flash: 0.5 }` · `defib` prep alias `medic_d:defib` · land alias `medic_d:defib` (k 1.5) + bolts to each enemy hit + Square white 10 · charge `{ vignette: 0.3 }` · finisher `{ glyph: '救' }` · motif `countdown` · `firstaid` alias `medic_d:firstaid`.

#### B6. 메딕 드래그 「코드 블루 · 긴급 출동」 — 설계 변경 (충전 두 번 → 제세동 1.6초, 이름 바꿈) · finale `defib`

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0~0.16 | 이동(돌진 9) | 공통 + 길 위 가는 청록 빛줄기 + 출발점 빨강/흰 고리(사이렌) + 흰 사각 | 착지 **멈춤 .05** · 흔들 7 | `dash.healer` |
| 0.45 | 길 `path` | 지나간 아군 빛(#7dffb3) + 출발 → 도착 번개(심전도 줄) | — | sfx `drag.medic.firstaid` −6dB |
| 0.45 | `firstaid` 지원 | 오늘 드래그 「응급처치」 | — | 행 `drag.medic.firstaid` |
| 0.45 | `golden` 지원 | (대기 캐릭터 회복 — 그림 없음) | — | 행 `ult.medic.golden` |
| 0.85 / 1.2 | `charge` ×2 쌓기 | 십자 네 팔을 따라 번개(점점 커짐) | 흔들 2.5 · 범위 .5 | sfx `drag.medic.defib` −10dB (lead 0.15) |
| 1.6 | `defib` ★ | 오늘 「제세동」 ×1.5 + 하늘색 고리 0.5→5 + 맞은 적마다 번개 | ★ (救) | 행 `drag.medic.defib` |

데이터:
```ts
finale: 'defib',
sfx: { _path: { id: 'drag.medic.firstaid', db: -6 }, charge: { id: 'drag.medic.defib', db: -10, lead: 0.15 } }, // lead: 23차 검토
// part 0: stage 'golden' → 'firstaid' (cross allies heal 0.25 — unchanged); part 1 'golden' (self, bench) unchanged
// new before 'defib':
{ stage: 'charge', center: 'point', delay: 0.85, telegraphLead: 0, area: { shape: 'cross', length: 5, width: 2.4 }, affects: 'enemies',
  effects: [{ kind: 'damage', amount: 0.5 }, { kind: 'status', status: 'slow', duration: 1, value: 0.4 }] },
{ stage: 'charge', center: 'point', delay: 1.2, telegraphLead: 0, area: { shape: 'cross', length: 5, width: 2.4 }, affects: 'enemies',
  effects: [{ kind: 'damage', amount: 0.5 }, { kind: 'status', status: 'slow', duration: 1, value: 0.4 }] },
// 'defib': delay 0.8 → 1.6, telegraphLead 0.4 (cross 5 / 2.4, damage 1.5, stun 1 — unchanged)
```
새 설명: 「끌어 놓은 곳까지 달려가며(최대 9칸) 지나간 길(폭 2.4) 아군 HP 20% 회복 + 정화. 도착 지점 십자(+, 상하좌우 5칸, 폭 2.4) 아군 HP 25% 회복, 모든 플레이어의 대기 캐릭터 HP 40% 회복 + 부활 대기 20초 감소. 0.85초 · 1.2초에 십자가 충전되며 안의 적 공격력 50% 피해 + 1초간 40% 둔화, 1.6초에 제세동: 공격력 150% 피해 + 1초 기절.」

구현: look `{ move: beam(MEDIC thin) along + red/white ring at from + Square white }` · `medic_ud_path:path` alliesGlow(#7dffb3) + boltFx(from → to) · `firstaid` alias `medic_d:firstaid` · `charge` `runStory('medic_d:defib', 'prep')` drawn at land (grow by seq) · impact `{ shake: 2.5, flash: 0.5 }` · `defib` alias `medic_d:defib` (k 1.5) + rings 0.5→5 #bdf6ff + bolts to each enemy hit · charge `{ vignette: 0.3 }` · finisher `{ glyph: '救' }` · motif `countdown`.

#### B7. 퇴마사 조준 「봉마 결계 · 부적 장벽」 — 설계 변경 (교차 봉인, 3.5초 → 2.2초) · finale `destroy`

부적 벽 → 1.1초 벽을 가로지르는 봉인 → 2.2초 두 줄 모두 滅. (22차는 0.45~3.5초 평평한 띠뿐, 22차 질문 「느리다」의 답.)

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0.45 | `greatseal` 첫 타 | 0.45초 동안 퇴마사에게서 부적 8장이 벽 자리로 날아가 꽂히고 벽에 먹 낙인 → 封 글자(60px) + 부적 물결 + 종이 12 + 맞은 적마다 먹물 | **멈춤 .045** · 흔들 4 · 범위 .7 | 행 `ult.exorcist.greatseal` |
| 0.45~2.45 | `storm` 장판 | 부적 장식 + 오늘 「부적 폭풍」(혼령) | — | 행 반복(2초) |
| 1.1 | `seal` 쌓기 | 0.3초 전 겨눈 줄을 따라 부적 4장 → 띠 물결 + 印 글자(50px) + 종이 8 | 흔들 4 · 범위 .7 | 행 `drag.exorcist.seal` |
| 2.2 | `destroy` ★ | 0.5초 전 겨눈 곳 위(높이 3.2)에 滅(96px)이 떠오름, 붉은 먹빛 물듦(0.45) → 오늘 「멸」(먹 고리, 적마다 혼령, 종이) + 두 띠 모두 부적빛 번쩍 + 불씨 10 | ★ (滅, 먹물 자국) | 행 `ult.exorcist.destroy` |
| 2.2 | `destroy` 짝 ×2 | 가로 띠 번쩍 · 아군 빛 | — | — |

데이터:
```ts
finale: 'destroy',
// 'greatseal' unchanged · 'storm': zone { duration: 3, tickInterval: 0.5 } → { duration: 2, tickInterval: 0.4 }
// new, after 'storm':
{ stage: 'seal', rel: 'aim', center: 'point', delay: 1.1, telegraphLead: 0.3, area: { shape: 'rect', dir: 'right', anchor: 'center', length: 7, width: 2 }, affects: 'enemies',
  effects: [{ kind: 'damage', amount: 0.8 }, { kind: 'status', status: 'drain', duration: 10, value: 0.55 }] },
// 'destroy' (the wall): delay 3.5 → 2.2 (telegraphLead 0.5, damage 1.6, stun 1.2 — unchanged)
// new, right after it:
{ stage: 'destroy', rel: 'aim', center: 'point', delay: 2.2, telegraphLead: 0, area: { shape: 'rect', dir: 'right', anchor: 'center', length: 7, width: 2 }, affects: 'enemies',
  effects: [{ kind: 'damage', amount: 1.6 }, { kind: 'status', status: 'stun', duration: 1.2, value: 0 }] },
// 'destroy' (allies r 7 heal 0.08): delay 3.5 → 2.2
```
새 설명: 「겨눈 방향과 직각으로 겨눈 곳을 가로지르는 부적 벽(길이 9, 폭 2): 적 공격력 100% 피해 + 10초간 흡혼 표식(피해의 55%). 2초간 0.4초마다 공격력 25% 피해 + 50% 둔화. 1.1초에 겨눈 방향으로 벽을 가로지르는 봉인(길이 7, 폭 2): 공격력 80% 피해 + 10초간 흡혼 표식(피해의 55%). 2.2초에 두 줄 모두 멸(滅): 공격력 160% 피해 + 1.2초 기절, 겨눈 곳 반경 7 아군 HP 8% 회복.」

구현: `greatseal` prep 8 × Talisman caster → spots along the wall (`footAlong`) + areaFx(Brand, INK, 0.45 s) · land glyphFx('封', 60, z 1.2) + wave TALISMAN + Paper 12 along + Ink at each enemy · impact `{ stop: 45, shake: 4, flash: 0.7 }` · `storm` decor `talismans` + alias `exorcist_u:storm` · `seal` prep 4 × Talisman along the aim (wait delay−0.3) · land wave + glyphFx('印', 50) + Paper 8 · impact `{ shake: 4, flash: 0.7 }` · `destroy` (wall = the finisher: bigger footprint) prep alias `exorcist_u:destroy` `@point` · land alias `exorcist_u:destroy` + Ember 10 · charge `{ vignette: 0.45 }` · finisher `{ glyph: '滅' }` · twins: rect flash TALISMAN / alliesGlow · motif `countdown`.

#### B8. 퇴마사 드래그 「팔문 봉인진 · 백귀 결계」 — 설계 변경 (팔문 8개, 3.5초 → 2초) · finale `destroy`

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0~0.18 | 이동(순간이동 9) | 공통 + 착지점 먹물 웅덩이(1.6) + 부적이 0초에 날아가 0.45초에 고리에 꽂힘 | (착지 흔들만) | `mon.blink` |
| 0.45 | `greatseal` 첫 타 | 오늘 「대결계」 | **멈춤 .045** · 흔들 4 · 범위 .6 | 행 `ult.exorcist.greatseal` |
| 0.45~2.45 | `storm` 장판 | 부적 장식 + 혼령 | — | 행 반복 |
| 0.9~1.32 | `seal` 문 ×8 쌓기 | 4칸 둘레 여덟 곳에 차례로(이동한 쪽부터 시계 방향) 부적빛 기둥(0.6 × 5) + 고리(1.3) + 종이 4, 점점 커짐 | 흔들 2 · 범위 .5 | sfx `drag.exorcist.seal` 문마다 +1음 |
| 2.0 | `destroy` ★ | 0.6초 전 滅(120px, 높이 3.2) → 오늘 「멸」 + 오늘 드래그 「멸」(붉은 印, 먹 고리, 불씨) + 회복 가루 | ★ (滅) | 행 `ult.exorcist.destroy` |

데이터:
```ts
finale: 'destroy',
sfx: { seal: { id: 'drag.exorcist.seal', on: 'hit', step: 1, max: 8 } },
// 'greatseal' unchanged · 'storm': zone { duration: 3, tickInterval: 0.5 } → { duration: 2, tickInterval: 0.4 }
// new, eight gates on a ring of 4 (k = 0..7, k·45° clockwise from the way it moved):
...[[4, 0], [2.83, 2.83], [0, 4], [-2.83, 2.83], [-4, 0], [-2.83, -2.83], [0, -4], [2.83, -2.83]].map(([x, y], k) => ({
  stage: 'seal', rel: 'aim', center: 'point', offset: { x, y }, delay: 0.9 + 0.06 * k, telegraphLead: 0.25,
  area: { shape: 'circle', radius: 1.3 }, affects: 'enemies',
  effects: [{ kind: 'damage', amount: 0.5 }, { kind: 'status', status: 'drain', duration: 10, value: 0.6 }] })),
// 'destroy': delay 3.5 → 2 (values and healPerHit unchanged)
```
(지연은 소수 둘째 자리로 적음: 0.9, 0.96, 1.02, 1.08, 1.14, 1.2, 1.26, 1.32.)

새 설명: 「끌어 놓은 곳으로 순간 이동(최대 9칸). 둘레 고리(안쪽 0.8 ~ 바깥 5.5)에 부적 결계: 공격력 130% 피해 + 10초간 흡혼 표식(피해의 60%) + 2초 속박. 2초간 부적 폭풍(반경 5.5, 0.4초마다 공격력 20% 피해). 0.9초부터 4칸 둘레 여덟 문이 차례로 열림(반경 1.3): 각각 공격력 50% 피해 + 10초간 흡혼 표식(피해의 60%). 2초에 멸(滅): 반경 5.5 적에게 공격력 180% 피해 + 1초 기절, 맞은 적 1명당 반경 6 아군 HP 4% 회복(최대 5명).」

구현: look `{ move: scorchFx(ink, r 1.6) at to + runStory('exorcist_d:seal', 'prep') toward the ring (pins at 0.45) }` · `greatseal` alias `exorcist_u:greatseal` · impact `{ stop: 45, shake: 4, flash: 0.6 }` · `storm` decor `talismans` + Spirits · `seal` lightPillar TALISMAN 0.6 × 5 + ring r 1.3 + Paper 4 (grow by seq) · impact `{ shake: 2, flash: 0.5 }` · `destroy` prep glyphFx('滅', 120, z 3.2, wait delay−0.6) · land alias `exorcist_u:destroy` + alias `exorcist_d:destroy` + Gold motes · charge `{ vignette: 0.45 }` · finisher `{ glyph: '滅' }` · motif `countdown`.

#### B9. 바드 조준 「음파 직격 · 포르티시모」 — 설계 변경 (박자 0.35초 간격 + 「포르티시모」) · finale `forte`

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0.45 | `choir` 지원 | 띠를 따라 오선지(1.8초) + 오늘 「합창」 | — | 행 `ult.bard.choir` |
| 0.45 | `encore` 지원 | 오늘 「앙코르」 음표 | — | 행 |
| 0.45 / 0.8 / 1.15 | `beat` ×3 첫 타 → 쌓기 | 바드에서 띠를 따라 음파 물결 + 띠 세 곳에서 음표 4~6, 점점 커짐, 박자마다 자홍 비네트 0.25 | 흔들 2.5 · 범위 .5 | sfx `ult.bard.beat` 3번 |
| 1.7 | `forte` ★ | 0.35초 전 자홍 물듦 + 바드가 살짝 뛰어오름(0.6) → 흰 빛줄기(5, 0.4초) + 자홍 빛줄기(2.5) + 음표 20 + 바드 둘레 고리 0.5→6 + 띠 가운데 별 56 | ★ (響, 음표 자국) | sfx `drag.bard.forte` + `ult.bard.beat.last` |

데이터:
```ts
finale: 'forte',
sfx: { beat: { id: 'ult.bard.beat', on: 'hit', max: 3 }, forte: [{ id: 'drag.bard.forte' }, { id: 'ult.bard.beat.last' }] },
// 'beat': hitInterval 0.6 → 0.35 (hits 3, line 14 × 4, damage 0.7, slow 0.3 / 2 s — unchanged)
// new, last:
{ stage: 'forte', center: 'point', delay: 1.7, telegraphLead: 0.4, area: { shape: 'line', length: 14, width: 5 }, affects: 'enemies',
  effects: [{ kind: 'damage', amount: 1.8 }, { kind: 'knockback', distance: 2 }, { kind: 'status', status: 'stun', duration: 0.6, value: 0 }] },
```
새 설명: 「겨눈 쪽 직선(길이 14, 폭 4)으로 음파: 띠 안 아군 HP 25% 회복 + 정화 + 10초간 공격력 +40% · 공격 속도 +30%, 적 0.35초마다 공격력 70% 피해 ×3 + 2초간 30% 둔화. 1.7초에 포르티시모(길이 14, 폭 5): 공격력 180% 피해 + 2칸 넉백 + 0.6초 기절. 모든 플레이어의 대기 캐릭터 10초간 공격력 +15% · 공격 속도 +15%.」

구현: `choir` prep Staff along the band (`lineAsRect` frame, 1.8 s) · land alias `bard_u:choir` · `encore` alias `bard_u:encore` · `beat` land role path-style beam from the bard + Note 4–6 at 3 `footAlong` points (grow per hit) + (mine) vignette #e056fd 0.25 for 0.2 s · impact `{ shake: 2.5, flash: 0.5 }` · `forte` prep later(delay−0.3, hop(bard, 0.6, 0.3)) · land beamAlong(white, w 5, 0.4 s) + beamAlong(#e056fd, w 2.5) + Note 20 + rings at the bard 0.5→6 + star 56 mid-band · charge `{ vignette: 0.35 }` · finisher `{ glyph: '響' }`.

#### B10. 바드 드래그 「공명 삼중주 · 피날레」 — 연출만 (이름 바꿈) · finale `forte` (**→ 8장 B10′**: 24차에 「공명 무대 · 피날레」로 새로 짬, 아래는 23차 기록)

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0~0.16 | 이동(돌진 9) | 공통 + 길 위 음표 8 | (착지 흔들만) | `dash.support` |
| 0.45 | `beat1` 접촉 | 오늘 드래그 「첫 박」(오선지 띠, 물결, 음표) | **멈춤 .04** · 흔들 4 · 범위 .6 | 행 `drag.bard.beat1` |
| 0.45 | `choir` · `encore` 지원 | 오늘 그림 | — | 행 |
| 0.75 | `beat2` ×2 쌓기 | 오늘 드래그 「둘째 박」 좌우 | 흔들 3 · 범위 .5 | 행 `drag.bard.beat2` (한 번) |
| 1.1 | `forte` ★ | 0.3초 전 자홍 물듦 → 오늘 드래그 「포르테」 ×1.4 세기 + 띠 따라 흰 빛줄기(4) | ★ (響) | sfx `drag.bard.forte` + `ult.bard.beat.last` |

데이터: 가운데 적 띠(0.45) `beat` → `beat1`; 왼쪽 적 띠(0.75) `beat` → `beat2`; 오른쪽 적 띠(0.75, 지금 이름 없음) → `beat2`; 마지막 띠(1.1) `beat` → `forte`. 아군 쌍둥이 띠 둘은 이름 없이 그대로. `finale: 'forte'`, `sfx: { forte: [{ id: 'drag.bard.forte' }, { id: 'ult.bard.beat.last' }] }`. (22차의 「오른쪽 띠 따라 그리기」 임시 코드는 지움.)

구현: look `{ move: Note 8 along }` · `beat1` alias `bard_d:beat1` · impact `{ stop: 40, shake: 4, flash: 0.6 }` · `beat2` alias `bard_d:beat2` · impact `{ shake: 3, flash: 0.5 }` · `choir` / `encore` alias `bard_u:encore` · `forte` alias `bard_d:forte` (k 1.4) + beamAlong(white, w 4) · charge `{ vignette: 0.3 }` · finisher `{ glyph: '響' }`.

#### B11. 크로노 조준 「시간 정지 · 시간의 늪」 — 설계 변경 (시곗바늘 세 번 + 「시간 재개」) · finale `stop`

시간이 멈추고 → 멈춘 동안 시곗바늘이 세 번 지나가며 피해가 쌓이고 → 2.3초 「시간 재개」에 한꺼번에 깨짐(정지 끝 2.35초 직전이라 30% 되돌림에 들어감).

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0.45 | `stasis` 첫 타 | 0.3초 동안 겨눈 곳에 큰 시계(4.5)의 바늘이 앞으로 달림 → 오늘 「시간 정지」를 겨눈 곳에(바늘 멈춤, 흰 고리가 안으로, 유리) + 내 화면 색 빠짐 0.6초 | **멈춤 .05** · 흔들 4 · 범위 .6 · 화면 .3 #eef0ff | 행 `ult.chrono.stasis` (똑딱) |
| 0.45~5.45 | `mire` 장판 ×2 | 희미한 시계(5, 세기 0.35)의 바늘이 천천히 거꾸로 | — | sfx 없음 |
| 0.95 / 1.35 / 1.75 | `rift` ×3 쌓기 | 십자 → X → 굵은 십자 낙인(0.5초, #cfd5ff) + 흰 X 베기 50 + 유리 6, 점점 커짐 | 흔들 2.5 · 범위 .5 | sfx `drag.chrono.rift` 바늘마다 +2음 |
| 2.3 | `stop` ★ | 0.35초 전 흰 물듦 → 오늘 드래그 「정지」 ×1.5 + 흰 고리 0.5→6 ×3 + 유리 20(멈춘 시간이 깨짐) | ★ (止) | sfx `drag.chrono.stop` + `ult.chrono.resume` |

데이터:
```ts
finale: 'stop',
sfx: { rift: { id: 'drag.chrono.rift', on: 'hit', step: 2, max: 3 }, stop: [{ id: 'drag.chrono.stop' }, { id: 'ult.chrono.resume' }], mire: null },
// 'stasis' (enemies r 5): stasis duration 2.5 → 1.9 (value 0.3, vulnerable 0.2 / 5 s unchanged) — ends at 2.35 s
// the two stage-less mire zones: give both stage 'mire' (values unchanged); the self part ('stasis', cooldown −4 s) unchanged
// new, last four:
{ stage: 'rift', center: 'point', delay: 0.95, telegraphLead: 0.3, area: { shape: 'cross', length: 5, width: 1.4 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.6 }] },
{ stage: 'rift', center: 'point', delay: 1.35, telegraphLead: 0.3, area: { shape: 'cross', diagonal: true, length: 5, width: 1.4 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.6 }] },
{ stage: 'rift', center: 'point', delay: 1.75, telegraphLead: 0.3, area: { shape: 'cross', length: 5, width: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.8 }] },
{ stage: 'stop', center: 'point', delay: 2.3, telegraphLead: 0.4, area: { shape: 'circle', radius: 5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2 }] },
```
새 설명: 「겨눈 곳 반경 5의 적 1.9초 정지(보스 · 중형보스는 짧게) + 5초간 받는 피해 +20%. 0.95초 · 1.35초에 시곗바늘(십자 +, X자, 상하좌우 5칸, 폭 1.4)이 지나가며 각각 공격력 60% 피해, 1.75초에 굵은 바늘(폭 2) 공격력 80% 피해. 2.3초에 시간 재개(반경 5): 공격력 200% 피해. 정지가 풀릴 때 정지 동안 받은 피해의 30%를 한꺼번에 다시 받음. 그 자리는 5초간 시간의 늪: 안의 적 60% 둔화 + 받는 피해 +20%, 안의 아군 공격 속도 +30%. 모든 플레이어의 대기 캐릭터 재등장 쿨 4초 감소.」

구현: `stasis` (enemy part) prep clock(point, r 4.5, 0.3 s, hands forward) · land alias `chrono_u:stasis` `@point` + (mine) `h.screen.desaturate(0.6)` · impact `{ stop: 50, shake: 4, flash: 0.6, screen: 0.3, screenColor: '#eef0ff' }` · `mire` (hit 0 of the enemy zone only) clock(r 5, 5 s, k 0.35, backward) · `rift` areaFx(Brand, cross / X, 0.5 s, #cfd5ff) + xslash 50 white + Glass 6 (grow by seq) · impact `{ shake: 2.5, flash: 0.5 }` · motif `clock` · `stop` alias `chrono_d:stop` (k 1.5) + white rings 0.5→6 ×3 + Glass 20 · charge `{ vignette: 0.35 }` · finisher `{ glyph: '止' }` · motif `clock`.

#### B12. 크로노 드래그 「시간 균열 · 영겁의 역행」 — 연출만 (이름 바꿈) · finale `stop` (**→ 8장 B12′**: 24차에 새로 짬, 아래는 23차 기록)

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0~0.18 | 이동(순간이동 9) | 공통 + 출발 → 도착 사이 잔상 3(거꾸로 감긴 필름) + 착지점 거꾸로 도는 시계 | (착지 흔들만) | `mon.blink` |
| 0.45 | `rift` 접촉 | 오늘 드래그 「균열」 | **멈춤 .04** · 흔들 4 · 범위 .6 | 행 `drag.chrono.rift` |
| 0.8 | `rewind` 쌓기 | 오늘 드래그 「되감기」 | 흔들 3 | 행 `drag.chrono.rewind` |
| 1.2 | `stasis` 쌓기 | 오늘 「시간 정지」를 착지 자리에 + 내 화면 색 빠짐 0.5초 | 범위 .6 | 행 `ult.chrono.stasis` |
| 1.2 | `stop` ★ | 0.3초 전 흰 물듦 → 오늘 드래그 「정지」 ×1.3 | ★ (止) | 행 `drag.chrono.stop` |

데이터: 1.2초 X자 부분 `stasis` → `stop` (원 정지는 `stasis` 그대로). `finale: 'stop'`.

구현: look `{ move: 3 afterimages from → to + runStory('chrono_d:rift', 'prep') at to }` · `rift` alias `chrono_d:rift` · impact `{ stop: 40, shake: 4, flash: 0.6 }` · `rewind` alias `chrono_d:rewind` · impact `{ shake: 3 }` · `stasis` alias `chrono_u:stasis` `@point` + desaturate(0.5) mine · impact `{ flash: 0.6 }` · motif `clock` · `stop` alias `chrono_d:stop` (k 1.3) · charge `{ vignette: 0.3 }` · finisher `{ glyph: '止' }`.

#### B13. 퍼펫티어 조준 「인형극 개막 · 커튼 라인」 — 설계 변경 (인형 하나씩 던지기 + 실, 3초 → 2초) · finale `curtaincall`

막이 오르고 → 인형 넷을 하나씩 던져 세우고 → 실이 팽팽해지며 끌어오고 → 2초 커튼콜. (22차 질문 「빨리 걷는 보스가 덜 맞음」의 답: 1초 빨라짐.)

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0.45 | `open` 지원 | 오늘 「개막」을 겨눈 곳에(퍼펫티어 스포트라이트는 지금 그대로) | — | 행 `ult.puppeteer.open` |
| 0.45 | `charm` 쌓기 | 오늘 「조종」 + 퍼펫티어 → 조종된 적마다 실(0.6초) | — | 행 `ult.puppeteer.charm` |
| 0.45 / 0.6 / 0.75 / 0.9 | `toss` ×4 첫 타 → 쌓기 | 인형이 포물선으로 날아가 실과 함께 내려앉음(오늘 드래그 「던지기」) + 별, 점점 커짐 | 첫 인형 **멈춤 .04** · 흔들 3 · 범위 .6, 나머지 흔들 2 | sfx `drag.puppeteer.toss` 4번 |
| 1.2 | `thread` 쌓기 | 0.25초 전 이웃 인형끼리 느슨한 실 3줄 → 팽팽하게(굵기 3, 0.5초) + 종이 | 흔들 3 · 범위 .5 | sfx `drag.puppeteer.thread` −4dB |
| 2.0 | `curtaincall` ★ | 0.45초 동안 객석 불이 꺼짐(#2a0a1a 0.45) → 오늘 「커튼콜」 + 띠 물결 + 줄 따라 꽃잎 16 + 인형마다 별 | ★ (幕, 꽃잎 자국) | 행 `ult.puppeteer.curtaincall` |

데이터:
```ts
finale: 'curtaincall',
sfx: { toss: { id: 'drag.puppeteer.toss', on: 'hit', step: 2, max: 4 }, thread: { id: 'drag.puppeteer.thread', db: -4 } },
// 'open', 'charm' unchanged; the four 'dolls' parts are REPLACED by four tosses (same doll, same spots):
...([[-4.5, 0.45], [-1.5, 0.6], [1.5, 0.75], [4.5, 0.9]] as const).map(([y, d]) => ({
  stage: 'toss', rel: 'aim', center: 'point', offset: { x: 0, y }, delay: d, telegraphLead: 0,
  area: { shape: 'circle', radius: 1.6 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.8 }],
  summon: { unitId: 'paper_doll_grand', count: 1, duration: 10, inherit: { hp: 0.65, atk: 1 } } })),
{ stage: 'thread', rel: 'aim', center: 'point', delay: 1.2, telegraphLead: 0, area: { shape: 'rect', dir: 'down', anchor: 'center', length: 12, width: 2.4 }, affects: 'enemies',
  effects: [{ kind: 'pull', distance: 1.5 }, { kind: 'damage', amount: 0.8 }, { kind: 'status', status: 'slow', duration: 2, value: 0.4 }] },
// 'curtaincall': delay 3 → 2 (telegraphLead 0.5, rect 12 × 4, damage 1.5, stun 1 — unchanged)
```
새 설명: 「겨눈 곳 반경 6 적 8초간 공격력 −35%, 일반 적 4마리까지 2.5초간 조종. 겨눈 방향과 직각으로 대형 인형 4개를 0.45초부터 하나씩 던져 한 줄로 세움(가운데에서 1.5칸 · 4.5칸, 떨어진 자리 반경 1.6 공격력 80% 피해, HP = 내 최대 HP 65%, 10초, 부서지면 반경 2.5 공격력 160% 피해). 1.2초에 인형 사이 실이 팽팽해짐(길이 12, 폭 2.4): 1.5칸 끌어당기고 공격력 80% 피해 + 2초간 40% 둔화. 2초에 커튼콜: 인형 줄(길이 12, 폭 4) 공격력 150% 피해 + 1초 기절.」

구현: `open` alias `puppeteer_u:open` `@point` · `charm` alias `puppeteer_u:charm` + tetherFx(Thread, puppeteer → each charmed enemy, 0.6 s) · `toss` alias `puppeteer_d:toss` (prep + land) + alias `puppeteer_u:dolls` (`seqAsHit`) · impact `(s) => s.seq === 0 ? { stop: 40, shake: 3, flash: 0.6 } : { shake: 2 }` · `thread` prep 3 × tetherFx(Thread, neighbour dolls, sag 0.5, wait delay−0.25) · land the same 3 taut (sag 0, w 3, 0.5 s) + Paper · impact `{ shake: 3, flash: 0.5 }` · `curtaincall` alias `puppeteer_u:curtaincall` + wave PUPPET + Petal 16 along + star at each doll spot · charge `{ vignette: 0.45, vignetteLead: 0.45 }` · finisher `{ glyph: '幕' }` · motif `outline`.

#### B14. 퍼펫티어 드래그 「대역 인형극 · 대공연」 — 설계 변경 (끌어오기 + 3초 → 1.9초) · finale `curtaincall`

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0~0.16 | 이동(돌진 8) | 공통 + 출발 → 착지 실(처짐 1.0, 0.35초) + 종이 | (착지 흔들만) | `dash.support` |
| 0.45 | `open` 지원 | 오늘 「개막」을 착지 자리에 | — | 행 |
| 0.45 / 0.6 | `toss` ×2 첫 타 → 쌓기 | B13과 같음 | 첫 인형 **멈춤 .04** · 흔들 3, 둘째 흔들 2 | 행 `drag.puppeteer.toss` |
| 0.75~6.75 | `thread` 장판 | 실 장식 | — | 행 실 소리 |
| 1.3 | `yank` 쌓기 | 0.25초 전 퍼펫티어 → 반경 5 적마다 실 → 팽팽하게 + 끌린 적마다 잔상 + 고리 5→1 안으로 | 흔들 4 · 범위 .6 | sfx `ult.puppeteer.charm` + `fx.pull` −4dB |
| 1.9 | `curtaincall` ★ | B13과 같음(착지 자리) | ★ (幕) | 행 `ult.puppeteer.curtaincall` |

데이터:
```ts
finale: 'curtaincall',
sfx: { yank: [{ id: 'ult.puppeteer.charm' }, { id: 'fx.pull', db: -4 }] },
// 'open', both 'toss', 'thread' unchanged; new before 'curtaincall':
{ stage: 'yank', center: 'point', delay: 1.3, telegraphLead: 0, area: { shape: 'circle', radius: 5 }, affects: 'enemies',
  effects: [{ kind: 'pull', distance: 2 }, { kind: 'damage', amount: 0.8 }] },
// 'curtaincall': delay 3 → 1.9 (telegraphLead 0.5, circle 5, damage 1.2, stun 1 — unchanged)
```
새 설명: 「끌어 놓은 곳까지 뛰어듦(최대 8칸). 반경 5 적 8초간 공격력 −35%. 이동한 쪽 1.5칸 앞 양옆 3칸에 대형 인형 둘(반경 2, HP = 내 최대 HP 65%, 10초): 공격력 180% 피해 + 1.2칸 끌어당김. 두 인형 사이 실(길이 6, 폭 1.4)이 6초간 1초마다 공격력 40% 피해 + 40% 둔화. 1.3초에 실을 당겨 반경 5 적을 2칸 끌어당기고 공격력 80% 피해. 1.9초에 커튼콜: 반경 5 공격력 120% 피해 + 1초 기절.」

구현: look `{ move: tetherFx(Thread, from → to, sag 1.0, 0.35 s) + Paper along }` · `open` alias `puppeteer_u:open` · `toss` as B13 · `thread` decor `thread` · `yank` prep tetherFx(Thread, puppeteer → each enemy in r 5, sag 0.4, wait delay−0.25) · land taut threads + afterimage on each pulled enemy + rings 5→1 · impact `{ shake: 4, flash: 0.6 }` · `curtaincall` as B13 (charge, finisher `{ glyph: '幕' }`).

### 3-끝. 정리

| | 궁극기 |
|---|---|
| 설계 변경 (15) | 가디언 조준 · 드래그, 버서커 조준 · 드래그, 메이지 조준, 클레릭 조준 · 드래그, 메딕 조준 · 드래그, 퇴마사 조준 · 드래그, 바드 조준, 크로노 조준, 퍼펫티어 조준 · 드래그 |
| 시간만 조정 (1) | 워든 조준 (철창 1초, 해방 6초) |
| 연출만 (14) | 팔라딘 조준 · 드래그, 워든 드래그, 블레이드 조준 · 드래그, 섀도우 조준 · 드래그, 레인저 조준 · 드래그, 메이지 드래그, 거너 조준 · 드래그, 바드 드래그, 크로노 드래그 (이름만 바꾼 것 포함) |
| 마무리 시각 | 0.8초(워든 드래그) ~ 2.45초(메이지 조준). 뒤풀이 덤: 워든 해방 5.8/6초, 버서커 마무리 일격 8.25초 |

---

## 4. 기술 설계 (Technical design)

### 4-1. Tracks, order, file ownership

Order: **CORE** first (alone). Then **GROUP A** and **GROUP B** in parallel (they only use the core API below). Then the main session integrates (full checks, e2e incl. 3-player multi, sheets / videos read by eye) and updates the shared docs (`docs/ult-test.md` 7-1 names / descriptions, `docs/game-design.md` §36 = 23차, CLAUDE.md code map).

| Track | Owns (only these files) |
|---|---|
| CORE | `src/data/ultTest/types.ts`, `src/data/ultTest/index.ts`, NEW `src/data/ultTest/beats.ts`; `src/render/ultTest/{index,core,preview}.ts`, NEW `src/render/ultTest/{settings,stories,grammar,theme,decals,kit}.ts`; hooks in `src/render/vfx.ts`, `src/render/stagefx.ts`, `src/render/cutin.ts`, `src/render/juice.ts`, `src/render/marks.ts`, `src/render/index.ts` (and `src/render/impact.ts` only if a type is needed); `src/audio/director.ts`; the toggle in `src/ui/pause.ts` + `src/ui/storage.ts`; tests NEW `tests/render/ult-fx-core.test.ts`, NEW `tests/render/classic-look.test.ts`, small edits to `tests/render/ult-test-render.test.ts` (fake canvas methods); `tests/visual/ult-test-sheet.mjs`, NEW `tests/visual/ult-fx-video.mjs` |
| GROUP A (guardian paladin warden blade berserker shadow ranger mage) | `src/data/ultTest/groupA.ts`, `src/render/ultTest/groupA.ts`, `tests/sim/ult-test-groupA.test.ts`, NEW `tests/render/ult-fx-groupA.test.ts` |
| GROUP B (gunner cleric medic exorcist bard chrono puppeteer) | `src/data/ultTest/groupB.ts`, `src/render/ultTest/groupB.ts`, `tests/sim/ult-test-groupB.test.ts`, NEW `tests/render/ult-fx-groupB.test.ts` |

Rules:
- `src/sim/ultTest.ts` is NOT changed (no sim change is needed: every new part uses existing action fields). No protocol bump (no message shape changes; `finale` / `sfx` are static data the sim never reads).
- Group tracks import render helpers **only from `src/render/ultTest/kit.ts`** (and types from `src/data/ultTest/types.ts`). A missing helper is written privately inside the group's own render file — never added to a core file.
- Group render files keep their 22차 accent map but gate it with `if (ULT_FX.boost) return;` (so the toggle off = the 22차 look); all new looks go through `registerUltStories` / `registerUltLooks`.
- Today's tables (`PREP`, `LAND`, `IMPACT`, `TELE_MOTIF`, `ZONE_DECOR`, `STAGE_CUES`) get **no new keys and no changed values**.
- Render code may use `Math.random`; `beats.ts` and data files are pure (no `Math.random`, no `Date`).

### 4-2. Data additions (`src/data/ultTest/types.ts`) — CORE

```ts
/** 기획 23차: a sound cue of an alt stage (the shape of src/audio/stages.ts Cue minus `fin`/`special`; existing ids only). */
export interface UltCue {
  id: string;
  on?: 'land' | 'hit' | 'cast' | 'zone';
  lead?: number; step?: number; jitter?: number; max?: number; last?: string;
  loop?: boolean; tick?: string; end?: string; duck?: [number, number]; db?: number; loopFor?: number;
}

export interface UltAltDef extends SkillDef {
  // … 22차 fields …
  /**
   * 기획 23차 (render / sound only — the sim never reads it): the climax stage. The finisher is the action with this stage
   * that affects enemies and whose last hit is latest (ties: bigger footprint, then lower index); the other actions of
   * the stage are its twins. Group tests require it on every registered alt.
   */
  finale?: string;
  /**
   * 기획 23차 (sound only): per-stage cue overrides for this alt (key = stage name; '_path' = the drag path beat). Wins over
   * the character's ult / drag rows; null = silent. `fin` is not set here: the finale stage's cues are the ones other
   * players hear.
   */
  sfx?: Readonly<Record<string, UltCue | readonly UltCue[] | null>>;
}
```
`src/data/ultTest/index.ts` re-exports `UltCue` and the beats API.

### 4-3. Beats (`src/data/ultTest/beats.ts`, NEW, pure) — CORE

```ts
export type UltBeatRole = 'path' | 'opener' | 'build' | 'finisher' | 'twin' | 'after' | 'zone' | 'support';

export interface UltBeat {
  actionIndex: number;          // -1 for the path beat
  stage: string;                // '' for a stage-less part
  role: UltBeatRole;
  at: number;                   // delay of its first hit (s after the cast)
  end: number;                  // delay of its last hit: at + (hits − 1) · hitInterval
  hits: number;
  hitInterval: number;
  radius: number;               // footprintRadius(area)
  affects: Affects;
  center: SkillAction['center'];
  seq: number;                  // index among the actions sharing its stage, ordered by (at, actionIndex)
  seqN: number;                 // how many actions share its stage
}

export interface UltBeats {
  skillId: string;
  charId: string;
  mode: 'aim' | 'drag';
  def: UltAltDef;
  beats: readonly UltBeat[];    // index = actionIndex
  path: UltBeat | null;         // the drag path (skill id `<id>_path`), role 'path'
  finisher: number;             // actionIndex of the finisher
  finisherKind: 'strike' | 'bless';
  finisherAt: number;           // the finisher's `end`
  firstAt: number;              // earliest `at` of an action with effects
  firstRadius: number;          // radius of the earliest enemy beat (lock-on / 착지 컷 hole); 1.5 if none
  onPoint: boolean;             // some enemy beat has center 'point' (조준 lock-on sits on the aimed point)
}

/** The beats of an alt ult (`<alt>_path` → the same alt's beats). Null for anything that is not an alt (today's ults, fallbacks). */
export function ultBeats(skillId: string): UltBeats | null;
/** One beat (`<alt>_path`, any index → the path beat). */
export function ultBeatOf(skillId: string, actionIndex: number): UltBeat | null;
/** circle r · ring outer · cone / fan r · cross length · line / rect length / 2 · single 1. */
export function footprintRadius(a: AreaShape): number;
```
Role rules, first match wins: `path` → `finisher` (from `finale`, see 4-2; without `finale`: the enemy action with the latest end) → `twin` (same stage as the finisher) → `zone` (has `zone`) → `support` (affects allies / self) → `after` (at > finisherAt + 0.5) → `opener` (the earliest-landing remaining enemy action, ties lower index) → `build`. `finisherKind` = 'bless' only when the finale stage has no enemy action. Cache in a `WeakMap<UltAltDef, UltBeats>` (fixtures from `setUltAltFixture` stay correct).

### 4-4. Render API for the content tracks (`src/render/ultTest/kit.ts` re-exports everything below) — CORE

```ts
// ── settings.ts (no imports: the sound director reads it too) ──
export const ULT_FX: { boost: boolean };                 // device-local 「궁극기 연출 강화」 (default true)
export function sanitizeUltFx(raw: unknown): { boost: boolean };
export const FX_LOAD: { low: boolean };                  // render/index.ts sets it each frame: governor cap ≤ 1.25

// ── theme.ts ──
// → 8장 (24차): `glyph` is gone — `burst: UltBurst` (8-5-2)
export interface UltTheme { glyph: string; screenColor: string; vignetteColor: string; vignette: number; spark: Pk; decal: DecalKind; decalColor: string; ember: Pk }
export function ultTheme(charId: string): UltTheme;     // the 2-3 table

// ── grammar.ts ──
export interface UltKick { stopMs?: number; shake?: number; shakeDur?: number; screen?: number; color?: string; ignoreBudget?: boolean; capSec?: number }
export interface UltHost extends StageHost {             // implemented by Vfx
  readonly juice: Juice;
  /** World-clock kick after delaySec; stopMs is at the default setting (× hitStopMs / 75). Ignored when !local. */
  kick(delaySec: number, k: UltKick, local: boolean): void;
  /** n particles on a ring of radius r around (x, y, z) flying in to the centre over dur. */
  implode(x: number, y: number, z: number, r: number, n: number, color: string, dur: number, kind?: Pk): void;
  /** Hide a unit's body for sec (world clock). */
  hideFor(entityId: number, sec: number): void;
  /** Run fn after delaySec on the world clock (≤ 48 pending, oldest dropped; cleared on floor change / reset). */
  later(delaySec: number, fn: () => void): void;
  /** 23차 검토: run fn once the SIM clock (GameState.time) is delaySec past now; late = how far past (the finisher's wind-up). */
  laterSim(delaySec: number, fn: (late: number) => void): void;
  /** 23차 검토: finishers of this caster's alt fired so far (a wind-up step queued before one is dropped). */
  finishCount(src: number, skillId: string): number;
}
export interface FinisherSpec {
  kind: 'strike' | 'bless';
  stopMs: number; stopCapMs: number; shake: number; shakeDur: number; tail: number; tailDur: number;
  screen: number; screenColor: string;                   // '' = theme
  breath: number;                                        // focus-dim alpha at t − 0.12 (0 = none; skipped when breathReach > 6 — 23차 검토: a band by its half diagonal)
  zoom: number; speedLines: boolean;
  glyph: string | null; glyphPx: number;                 // null = no stamp ('' = theme glyph) — → 8장 (24차): removed, `impact` · `burst` · `tailColor` instead
  flash: number; star: number; rings: number; pillar: boolean;
  sparks: number; debris: number; embers: number; hitMarks: number;
}
export interface ChargeSpec { lead: number; rings: number; sparks: number; pillar: boolean; rumble: number; vignette: number; vignetteColor: string; vignetteLead: number }
export const FINISH_STRIKE: Readonly<FinisherSpec>;  // 130 / 160 / 12 / 0.4 / 4 / 0.6 / 0.42 / '' / 0.35 / 0.05 / true / '' / 150 / 1 / 70 / 3 / true / 40 / 10 / 14 / 10
export const FINISH_BLESS: Readonly<FinisherSpec>;   // 0 / 0 / 0 / … / screen 0.28 / breath 0 / zoom 0.02 / no speed lines / glyph '' / rings 2 / sparks 20 / embers 10
export const CHARGE: Readonly<ChargeSpec>;           // 0.3 / 3 / 14 / true / 1.5 / theme / theme / 0.35
export function ultFinisher(fx: SkillFx, h: UltHost, s: UltBeatInfo, spec?: Partial<FinisherSpec>): void;
export function ultCharge(fx: SkillFx, h: UltHost, s: UltBeatInfo, spec?: Partial<ChargeSpec>): void;  // call from PREP; schedules itself at delay − lead
export function ultDefault(fx: SkillFx, h: UltHost, s: UltBeatInfo): void;   // the role default picture of s.role (2-1)
export function ultHitMarks(fx: SkillFx, h: UltHost, s: UltBeatInfo, max?: number): void;
export function ultGlyph(x: number, y: number, z: number, text: string, color: string, local: boolean, o?: { px?: number; hold?: number }): void;
export function ultSpeedLines(x: number, y: number, o?: { dir?: number; n?: number; color?: string; alpha?: number }): void;  // screen; radial unless dir
export type DecalKind = 'crater' | 'gash' | 'scorch' | 'frost' | 'sigil' | 'ink' | 'petals';
export interface DecalSpec { kind: DecalKind; x: number; y: number; area: AreaShape; ox: number; oy: number; color: string; dur: number; alpha: number }
export function ultDecal(spec: DecalSpec, local: boolean): void;

// ── stories.ts ──
export interface UltBeatInfo extends StageInfo {   // the same reused object vfx passes today, with these filled in
  mode: 'aim' | 'drag'; charId: string; role: UltBeatRole; beat: UltBeat; beats: UltBeats; theme: UltTheme;
  seq: number; seqN: number;
  toFinish: number;     // seconds from now until the finisher lands (≥ 0)
}
export type UltStoryFn = (fx: SkillFx, h: UltHost, s: UltBeatInfo) => void;
export interface UltAlias {
  key: string;                  // a key of today's PREP / LAND (e.g. 'guardian_u:citadel'); a test checks it exists
  at?: 'caster' | 'point';      // 'point' = re-seat ox, oy := x, y and src, follow := −1 for this call (default 'caster' = as is)
  lineAsRect?: boolean;         // a 'line' beat is passed as { shape: 'rect', dir: 'right', anchor: 'start', length, width, rot } from its origin
  k?: number;                   // strength × (alpha, particle counts) 0.5–1.6; never the footprint
  seqAsHit?: boolean;           // s.hit := seq for the call (today's grow() steps once per beat of the same stage)
  prep?: boolean;               // run its PREP (default: true when PREP[key] exists)
  land?: boolean;               // run its LAND (default true)
}
export type UltImpact = Partial<ImpactSpec> | null | ((s: UltBeatInfo) => Partial<ImpactSpec> | null);
export interface UltStory {
  alias?: UltAlias | readonly UltAlias[];
  prep?: UltStoryFn;            // at its skillCast, after the alias PREP
  land?: UltStoryFn;            // at each skillStage hit / tick, after the alias LAND
  wave?: boolean;               // also draw ultDefault under (default: true only when there is neither alias nor land)
  impact?: UltImpact;           // non-finisher kick (mine) + area flash; absent = role default; null = none. stop ≤ 55 except role 'after' (≤ 100)
  finisher?: Partial<FinisherSpec>;   // read on the finisher beat only
  charge?: Partial<ChargeSpec> | null; // finisher wind-up (null = none)
  linger?: Partial<DecalSpec> | null;  // finisher floor mark (null = none, e.g. the story draws its own Fx.Scorch)
  motif?: TeleMotif;            // the warning look of its delayed parts
  decor?: ZoneDecor;            // the decor of its zone
}
/** key = `<alt>:<stage>` or `<alt>_path:<stage>`; a key registered twice throws. */
export function registerUltStories(map: Readonly<Record<string, UltStory>>): void;
export function ultStoryKeys(): readonly string[];

export interface UltMoveInfo { skillId: string; charId: string; kind: 'dash' | 'blink'; entityId: number; from: Vec2; to: Vec2; color: string; k: number; local: boolean; touchdownAt: number }
export interface UltAltLook {
  move?: (fx: SkillFx, h: UltHost, m: UltMoveInfo) => void;       // at the dash / blink event (0 s), after the shared move
  touchdown?: (fx: SkillFx, h: UltHost, m: UltMoveInfo) => void;  // at touchdownAt, after the shared touchdown
  genericMove?: 'full' | 'lite' | 'none';   // shared move grammar (2-5); 'lite' = no afterimages / speed lines / gash
  touchdownAt?: number;          // default: dash ULT_TEST.dashDuration, blink 0.18. ≥ 0.4 = no shared touchdown (the first beat is the landing)
  touchdownStop?: number;        // my touchdown hit-stop, ms at the default setting (default 50; 0 when a contact stop lands within 0.8 s — 2-2)
  touchdownLive?: boolean;       // 23차 검토: the shared touchdown where the body really is at touchdownAt (a part rushed it on at cast: 블레이드 드래그)
  stripFrom?: number;            // 착지 컷 start (default touchdownAt + 0.03)
  sight?: boolean;               // 조준 sight line (default true)
  lock?: 'point' | 'small' | 'none';  // 조준 lock-on (default: beats.onPoint ? 'point' : 'small')
}
/** key = alt id (e.g. 'berserker_ud'). */
export function registerUltLooks(map: Readonly<Record<string, UltAltLook>>): void;

// ── kit.ts: small helpers (new) ──
export function ultAngle(s: StageInfo): number;   // radians, world: line / fan with origin → atan2(y − oy, x − ox); rect / cone → rot ?? dir; else facing
export function footAlong(s: StageInfo, t: number, out: Vec2): Vec2;   // point at t ∈ [0, 1] along the footprint's long axis
export function randomIn(s: StageInfo, out: Vec2): Vec2;               // random point inside the footprint (Math.random; render only)
export function runStory(key: string, phase: 'prep' | 'land', fx: SkillFx, h: UltHost, s: UltBeatInfo, o?: Omit<UltAlias, 'key' | 'prep' | 'land'> & { x?: number; y?: number }): void;
export function aimLine(fx: SkillFx, x: number, y: number, x2: number, y2: number, w: number, color: string, k: number, wait: number, dur: number): Sfx;
export function orbFly(fx: SkillFx, x: number, y: number, x2: number, y2: number, dur: number, color: string, k: number, z?: number): Sfx;
export function crackFx(fx: SkillFx, x: number, y: number, r: number, n: number, color: string, k: number, o?: { ang?: number; spread?: number; dur?: number; wait?: number }): Sfx;
export function beamAlong(fx: SkillFx, s: StageInfo, w: number, color: string, dur: number, wait?: number): Sfx;   // along a line / rect / cone axis

// ── kit.ts re-exports, unchanged signatures ──
// stagefx.ts (the core adds `export` to these private helpers; no behaviour change): PREP, LAND, STAGE_DETAIL, grow, fallAt,
//   tetherFx, glyphFx, areaFx, rune, scorchFx, boltFx, crosshairFx, snow, aura, fireBurst, lightPillar, rings (the
//   STAGE_DETAIL-aware one), eachEnemy, selfBubble, alliesGlow, shotgun, bardBand, dollBurst, and the colours GOLD HOLY ICE
//   INK TALISMAN PUPPET HANJI LAVA MEDIC; types StageInfo, StageHost.
// castfx.ts: arrow, beam, chains, clock, muzzle, notes, pillar, radiusOf, slash, star, wave, xslash.
// skillfx.ts: Fx, FallObj, TetherStyle, SkillFx, Sfx, dirAngle, screenAngle. fxparts.ts: Pk. marks.ts: TeleMotif, ZoneDecor.
// impact.ts: ImpactSpec. juice.ts: Juice. types: Vec2, AreaShape.
```

**CORE part 1 — what was built beyond (or slightly different from) the list above** (all re-exported by `kit.ts` unless noted):
- `UltHost.drop(entityId, height, dur)` — a body drops in from `height` (the second half of a hop; the blink arrival uses it).
- `registerUltStories` / `registerUltLooks` return an undo `() => void` (tests only; the content files ignore it). `stories.ts` also has `ultStory(key)`, `ultLook(altId)`, `ultLookKeys()` (core-internal readers).
- `grammar.ts`: `ultBreath(h, s, alpha)` (숨 고르기 at t − 0.12; the router calls it on the finisher's PREP with `finisher.breath`), `ultFocus(s, out)` (the middle of a line / fan / rect / cone, else the centre — the glyph, zoom, breath hole and gathering light sit there), `implodeSpeed`. `ChargeSpec.vignette` −1 / `vignetteColor` '' = the theme's.
- `ultGlyph(x, y, z, …)` and `ultSpeedLines(x, y, …)` take a **world** point (drawn on the screen layer).
- `kit.ts`: `runAlias(alias, phase, fx, h, s, at?)` (what the router runs for every `UltStory.alias`; `runStory` wraps it).
- `theme.ts`: `ultThemeIds()`. `decals.ts` (core): `insetArea`, `decalCount` (live marks), `clearDecals`, `DECAL`.
- `cutin.ts`: `ScreenFx.focusDim(x, y, r, alpha, inSec, holdSec, outSec)`, `cancelFocus()`, `focusAlpha()` already exist (part 1 needed them for the breath) — part 2 reuses them for the landing strip.
- `marks.ts`: `hint(ev, key, color, k, motif?, fill = 1)`, `bindZone(zones, ev, key, color, k, decor?, fill = 1)` (`decor` given — even `null` — binds the zone; null = the plain look with `fill`).
- `juice.ts`: `Juice.cancelZoom()` (index.ts calls it when a card / the ult button is dragged).
- `core.ts` (core-internal): `drawUltScreen` (re-exported by `render/ultTest/index.ts`), `ultCam`, `tickUltReal`, `resetUltCore`, `ultFrameEnd`, `ultLockKeep`, `ultMoveTake` / `ultMoveStart`, `pushGlyph` / `pushSpeedLines`, test readers `ultCoreCounts()` / `ultStampText()`; numbers `LOCK`, `SIGHT`, `MOVE`, `GLYPH`. `UltFxView.fx` (the SkillFx pool) is passed with every event.
- The lock-on's size is the first enemy beat that sits ON the aimed point (a line / fan / start-anchored rect / offset part only ends there and is skipped), else `beats.firstRadius`.
- Zones never win the automatic finisher pick (no `finale`) while a strike exists.

**CORE part 2 — the shell** (built after part 1; not re-exported by `kit.ts`, the groups never need them):
- `cutin.ts`: `CutIn.focus: CutInFocus | null`, `CutIn.landAt`, `CutIn.landing(fromSec, focus, fromRight)`, `CutIn.placeStrip(cam)`, the `STRIP` number table (96 px, slide 0.06 s, wipe 0.39–0.45, portrait at x 480 — clear of the HUD tip pill).
- `stories.ts`: `TOUCHDOWN` / `touchdownAt(look)` (blink 0.18, dash `ULT_TEST.dashDuration`, ≥ 0.4 = no shared touchdown) — shared by core.ts and the sound director (which never imports the renderer).
- `core.ts`: `ultLockRadius(b, …)` (the lock-on / 조준 hole size), `ultScreenBusy()` (my glyph or speed lines are up → enemy warnings are drawn again over them; → 8장: 24차 the impact frame instead of the glyph).
- `preview.ts`: `finisherPart()` (which live preview part is the finisher's: double rim + blinking centre dot); `drawUltAimGround(…, lp?)`.
- `director.ts`: `ALT_SOUND` (every 2-7 number). `ui/storage.ts`: `loadUltFx` / `saveUltFx` / `ULT_FX_KEY`.
- Tests: `tests/visual/ult-test-sheet.mjs` reads `ultBeats` through the dev server's own modules (a build without source modules falls back to 0.25 / 0.5 / 1.35 / 2.1 s); `tests/visual/ult-fx-video.mjs` (options `only=` `port=` `url=` `boss=` `point=` `lead=` `tail=`; cuts each clip to [release − 0.6, finisher + 1.2] only when an `ffmpeg` is on the PATH — Playwright's bundled one cannot read webm).

### 4-5. What the core does with them (routing; CORE-internal)

All new paths are guarded by `state.mode === 'ultTest' && ULT_FX.boost` (one compare per event elsewhere) and by `ultBeats(ev.skillId) !== null` (fallback casts keep today's ult id → today's look).

- `vfx.onSkillCast` (staged alt part) → `prepStage` → `ultPrep`: marks.hint with the story's `motif` (and the alt fill ×0.5) → alias PREP(s) → `story.prep` → if role 'finisher': `ultCharge` (unless `charge: null`) and, for 조준, keep the lock-on alive until `finisherAt`.
- `vfx.onStage` → `ultLand`: zone binding with the story's `decor` (bound even without decor, so the alt zone fill ×0.5 applies) → alias LAND(s) → `story.land` → `ultDefault` when `wave` → if role 'finisher' and `hit === hits − 1`: `ultFinisher(story.finisher)` once per (sourceId, skillId) per 2 s, plus the decal (`linger`).
- `vfx.stageImpact` → `ultImpact`: finisher → nothing here (the grammar kicks); others → `story.impact` (function / object / null) or the role default; area flash as today (flurries once, not for self / allies); mine → `kick` (budgeted, FREEZE_MAX cap; stop clamped ≤ 55 ms, `after` ≤ 100 ms); others → half screen flash when in view (today's rule).
- Finisher kick (mine): `juice.finisherStop(sec)` = `hitStop(sec, { cap: 0.16, ignoreBudget: noFinisherOfMineInTheLast(1.0 s real) })`, shake 12 / 0.4, `later(0.12)` tail shake 4 / 0.6 (Juice.shake keeps the stronger, so the tail only takes over once the main shake has decayed — it runs after the stop on the world clock), zoom punch, screen flash, glyph stamp, speed lines.
- The touchdown stop (2-5) = `look.touchdownStop ?? 50` ms (budgeted); the group tracks set 0 on the drag alts marked 「착지 흔들만」 in 3장.
- `vfx.onUltCast` (mine, drag, boost, not 「컷인 짧게」): `cutin.start(…, short = true)` as today, then `cutin.landing(stripFrom, focus, fromRight)` when `0.45 − stripFrom ≥ 0.2`. 조준: `cutin.focus = { x, y, r }`.
- core.ts: lock-on / sight line / caster charge (조준), `pendingMove` (an ultCast(drag) marks its entity; the next dash / blink of that entity **in the same event batch** is the ult move → shared move + `look.move`; touchdown via `later(touchdownAt)`), decal pool (ground layer, inside the arena clip, world clock), the screen layer `drawScreen` (glyph stamp, sight line, speed lines — real clock, also drawn in `drawFrozen`).
- stagefx.ts touch-ups (CORE): `StageInfo` gets `rot?: number` (radians, set only by the alt router for turned rects / cones and `lineAsRect`; `fillStage` resets it to `undefined`). The stories the groups alias with a turned footprint read it **only when defined**: `guardian_d:wave`, `blade_d:dash`, `blade_d:return` (follow ox,oy → x,y), `blade_d:burst`, `berserker_d:split`, `ranger_d:volley`, `ranger_d:pierce`, `gunner_d:slug`, `shotgun()` (gunner_d:blast1), and `mage_u:blizzard` / `mage_u:shatter` if they read the cone's `dir` (plus any other aliased story found reading `area.dir`). Undefined `rot` = today's code path, byte for byte.
- marks.ts: `hint(ev, key, color, k, motif?)`, `bindZone(…, decor?)` optional overrides; `MarkStyle.fill` multiplier (1 by default, 0.5 for alt keys); `blizzardDecor` clips to `z.area` when it is not a circle.
- cutin.ts: `CutIn.focus: { x: number; y: number; r: number } | null`, `CutIn.landAt` (−1 = none), `CutIn.landing(fromSec, focus, fromRight)`; while `landAt ≥ 0` the small banner is replaced by the strip, `dur` = 0.5, `dim()` = the landing dim; `short`, `forced`, `shown.kind 'short'` stay as 22차 (the 22차 test holds). `ScreenFx.focusDim(x, y, r, alpha, inSec, holdSec, outSec, shape?)` (world layer, evenodd hole — 23차 검토: `shape` = a hole in that footprint's own shape; `worldActive()` true while it runs). All unused outside ultTest.
- juice.ts: `ULT_FINISH = { stopSec: 0.13, stopCap: 0.16, gapSec: 1.0, shake: 12, shakeDur: 0.4, tail: 4, tailDur: 0.6, tailAt: 0.12, zoom: 0.05, zoomSec: 0.28 }`; `Juice.finisherStop(sec)`, `zoomPunch(amount, sx, sy, dur?)`, `tickZoom(dt)` (world clock, from Vfx.update), `zoomAt(out): boolean` (false when shake setting 0 / reduced motion / no punch).
- render/index.ts: after the shake translate, `if (!ui.dragPreview && !ui.ultAim && vfx.juice.zoomAt(z)) { c.translate(z.x, z.y); c.scale(z.s, z.s); c.translate(-z.x, -z.y); }` (s > 1 about an on-screen point never exposes an edge; input mapping untouched); `bandAvoid` adds the aimed point span (weight 2) when `cut.focus`; enemy danger redrawn when `cut.active && (!cut.short || cut.landAt >= 0)` or an ult screen effect is up; `drawUltScreen(c, view)` after `vfx.drawScreen` (and in `drawFrozen`); `FX_LOAD.low = governor.cap <= 1.25`.
- preview.ts: the finisher part of the live preview gets a double rim + a pulsing centre dot.
- director.ts (all alt-only, gated by `ULT_FX.boost`): SKILLS also registers `<alt>_path` (same char / role, `path: true`); `cuesOf` for alts = (path beat: `def.sfx._path` →) `def.sfx[stage]` → ult row → drag row; `fin` for alt cues = (stage === def.finale); cue-less non-finisher → `drag._role.<role>` −4 dB once per cast; cue-less finisher → `ult._role.<role>` as a lead-0.5 cue from its skillCast; lead dedupe key includes `cue.id` and the part's `delay` (alts only; 23차 검토); an `on: 'hit'` cue with a `lead` is asked for per part at its skillCast, `lead` s early, stepping up like the hit cues, its `last` id on the blow (23차 검토); move sounds + touchdown; finisher layers (2-7). Boost off → the 22차 paths.
- UI: 「궁극기 연출 강화 (궁극기 테스트): 켬/끔」 — a full-width toggle in the 일시정지 settings row (the same style as 컷인 / 진동 / 저스트; the pause menu has no 「연출」 heading), shown in every mode, saved per device (`swap-tower.ultFx.v1`, `loadUltFx` / `saveUltFx`).

### 4-6. Example (group A render file, 가디언 조준 + 버서커 드래그 이동)

```ts
// src/render/ultTest/groupA.ts — 기획 23차 (docs/ult-fx.md 3장 A1, A10)
import { Fx, FallObj, Pk, aimLine, areaFx, crackFx, orbFly, registerUltLooks, registerUltStories, rings, ultAngle, type UltStory } from './kit';

const STEEL = '#cfe0ff';
const STEEL_LIGHT = '#cfe8ff';

const guardianAim: Record<string, UltStory> = {
  'guardian_ua:rally': {
    alias: { key: 'guardian_u:rally' },                              // chains on the guardian (PREP) · tethers to the pulled (LAND)
    prep: (fx, _h, s) => { aimLine(fx, s.ox, s.oy, s.x, s.y, 2.6, STEEL, s.k, 0, s.delay); },
    land: (fx, h, s) => {
      if (s.hit !== 0) return;
      orbFly(fx, s.ox, s.oy, s.x, s.y, 0.2, STEEL_LIGHT, s.k, 0.8);  // the thrown shield
      const sw = fx.add(Fx.ShieldWave, s.ox, s.oy, 0.5, s.color, s.k);
      sw.ang = ultAngle(s); sw.r = 9; sw.w = 2.6;
      h.spray(s.x, s.y, 0.6, Math.round(8 * s.k), Pk.Glass, STEEL_LIGHT, 3, 2, 0.5);
    },
    impact: { shake: 3, flash: 0.6 },
  },
  'guardian_ua:aegis': { alias: { key: 'guardian_u:aegis' } },
  'guardian_ua:citadel': {
    alias: { key: 'guardian_u:citadel', at: 'point' },               // the falling shield onto the aimed point, then today's burst
    land: (fx, _h, s) => { crackFx(fx, s.x, s.y, 3.8, 10, STEEL, s.k); },
    impact: { stop: 55, shake: 7, flash: 0.9 },
    motif: 'outline',
  },
  'guardian_ua:barrier': { alias: { key: 'guardian_u:barrier' }, decor: 'hexDome' },
  'guardian_ua:wave': {                                              // ★ finale: 'wave' (data)
    prep: (fx, _h, s) => {
      areaFx(fx, Fx.Hex, s.x, s.y, s.area, 0.6, STEEL_LIGHT, s.k, Math.max(0, s.delay - 0.6));
      rings(fx, s.x, s.y, 4.5, 1, 2, 0.4, STEEL_LIGHT, s.k).wait = Math.max(0, s.delay - 0.4);
    },
    land: (fx, h, s) => {
      rings(fx, s.x, s.y, 0.5, 5.5, 3, 0.5, '#ffffff', s.k, -1, 8);
      h.spray(s.x, s.y, 0.6, Math.round(14 * s.k), Pk.Glass, STEEL_LIGHT, 4, 3, 0.7);
      h.spray(s.x, s.y, 0.4, Math.round(6 * s.k), Pk.Square, '#ffffff', 3, 2, 0.5);
    },
    finisher: { glyph: '城' },  /* → 8장: 24차 no glyph key */      // the rest (stop, shake, flash, zoom, decal) = FINISH_STRIKE + theme
    charge: { vignette: 0.3 },
    motif: 'countdown',
  },
};
registerUltStories(guardianAim);

registerUltLooks({
  berserker_ud: {
    touchdownAt: 0.45,                                               // the leap lands on the 0.45 s slam (no shared touchdown)
    stripFrom: 0.08,                                                 // 착지 컷 while it hangs in the air
    genericMove: 'lite',
    move: (_fx, h, m) => {
      h.spray(m.from.x, m.from.y, 0.4, Math.round(10 * m.k), Pk.Ember, '#ff3b1f', 2, 3, 0.6, -1, 5);
      h.hideFor(m.entityId, 0.08);
      h.later(0.08, () => h.hop(m.entityId, 2.6, 0.37));
    },
  },
});
```

### 4-7. Risks the tracks must watch

- **Classic look**: every stagefx / vfx / marks / cutin / index change must leave classic pixels identical → `classic-look.test.ts` (5-1) is recorded by the CORE track as its **first step, before any edit**, and must stay green.
- **Hit-stop over budget**: only my finisher, once per cast; the 1 s guard; settings 0 → none. Tested.
- **Zoom**: never while aiming / dragging; not captured into pick math (toWorld unchanged).
- **Description tests**: every new / changed description must pass the group tests' 「every effect phrase, only numbers from the data」 rules (3장 lines were written to them; adjust wording, never the data, if a phrase is missing).
- **Sounds by stage name**: renames change which existing cue plays — check every changed ult in `npm run sfx:preview` / by ear in game; `ult._role.ranged` may need +3 dB as a layer.
- **Hanja glyph fonts** on the designer's phone (system CJK fallback): check on the phone sheet. (→ 8장: 24차 no glyphs any more.)
- **Particles with 3 seats** in multi: others at k 0.55 + low detail; the 220 soft cap turns extra sparks into squares (acceptable).

---

## 5. 테스트 · 확인 계획

### 5-1. Unit tests (must exist and pass)

CORE — `tests/render/ult-fx-core.test.ts`:
1. `beats.ts`: for every registered alt, roles cover every action; exactly one finisher; `firstAt ≥ 0.45`; when `finale` is set it names a stage with an enemy action; `<alt>_path` resolves to the same beats; a fixture (`setUltAltFixture`) gets fresh beats.
2. Story / look registry: every story key is `<alt>:<stage>` or `<alt>_path:<stage>` of a real stage; every alias key exists in today's `PREP` / `LAND`; every look key is an alt id; a duplicate key throws.
3. Today's tables untouched: no alt key in `PREP` / `LAND` / `IMPACT` / `TELE_MOTIF` / `ZONE_DECOR` / `STAGE_CUES` (the existing stale-key test covers stagefx; extend to marks / cues).
4. Kicks: my finisher → freeze > 0 (0.13 s at the default setting, ≤ 0.16 at 150 ms), zoom active, screen flash, glyph; a second finisher of mine within 1 s → budgeted; another player's / a bot's finisher → no freeze, no shake, no zoom, no dim / focus, no screen glyph; settings hitStop 0 / shake 0 / reduced motion behave as 2-8.
5. Classic isolation: a classic (and a 보스 레이드) game with ults rendered for 10 s never calls the alt router (spy), `juice.zoomAt` stays false, `cutin.focus === null`, `cutin.landAt === -1`.
6. Cut-in: my dragged alt → `short && forced` (the 22차 test) and `landAt ≥ 0`; 「컷인 짧게」 → `landAt === -1`; 조준 → `focus` set during the band, null after.
7. Budgets: each of the 30 casts (fake canvas, local) → peak live particles ≤ 150, SkillFx ≤ 40, decals ≤ 6; three seats casting at once (multi fixture) do not throw.
8. Toggle: `ULT_FX.boost = false` → no story / finisher / lock-on / strip / decal, director takes the 22차 paths.
9. Director: alt `sfx` overrides used (incl. `_path`, `null`); only finale cues reach other players; a cue-less non-finisher stage plays `drag._role.<role>` once per cast; a cue-less finisher is scheduled 0.5 s early; my dash / blink / touchdown sounds; every id in every `sfx` exists (`src/audio/files/<id>.mp3` or a synth id).

CORE — `tests/render/classic-look.test.ts` (recorded **before** the core edits): a seeded classic run (and one 원정, one 보스 레이드 floor) with every character's today's drag and ult, `Math.random` stubbed by a seeded LCG, rendered into a recording fake canvas; the hash of (method, rounded args) is stored and must not change.

GROUP A / B — `tests/sim/ult-test-group{A,B}.test.ts` (updated): every alt has `finale` naming an enemy stage; the data contract (0.45 s rule, stage names, rel 'aim' only, no hidden target in 조준); descriptions (new lines in 3장); 「cast for real」 incl. **preview = landing** for every new part; SOON checks moved where the timing changed (e.g. 크로노 조준 stasis 1.9 s, 퍼펫티어 curtain 2 s, 퇴마사 멸 2.2 / 2 s, 클레릭 드래그 bell 2 s, 메딕 defib); bots still cast every alt within 60 s, the same way twice.
GROUP A / B — `tests/render/ult-fx-group{A,B}.test.ts` (new): every alt of the group has a story for its finale stage; every listed story / look key is registered; all 8 / 7 × 2 casts render 200 frames without throwing with the director attached; per alt at most one non-finisher stop before the finisher, ≤ 55 ms, on a beat landing ≥ 0.5 s before the finisher (`after` beats ≤ 100 ms); drag alts with a contact stop within 0.8 s set `touchdownStop: 0`.

Unchanged and must stay green: goldens / determinism (classic, 원정, 보스 레이드 bit-identical), `tests/render/stagefx.test.ts`, `tests/render/ult-test-render.test.ts` (add any canvas method the new drawing uses to its fake), `tests/sim/ult-test.test.ts`, `tests/net/ult-test.test.ts`, the e2e specs `ult-test.spec.ts` and `multi-ult-test.spec.ts` (3 players: the finisher lands at the same spot on all three screens).

### 5-2. Pictures (read by eye before reporting)

- `tests/visual/ult-test-sheet.mjs`: each row becomes **미리보기 → 0.25초 (착지 · 착지 컷) → 0.5초 (첫 타) → 마무리 + 0.05초 (멈춘 쾅) → 마무리 + 0.8초 (여운)**; the finish times come from `ultBeats`. Default `times=` stays overridable. Sheets: `docs/screenshots/ult-test-sheet-{aim,drag}{,-2,-3}.png` (replaced).
- Look for: the climax is the biggest picture in each row; nothing paints outside its footprint beyond thin rings; enemy warnings readable over the strip / dim; hanja visible; no flat colour slab dominating a frame.

### 5-3. Short phone videos for the designer

- NEW `tests/visual/ult-fx-video.mjs`: Playwright Chromium, viewport 844 × 390 (landscape), `recordVideo` 844 × 390, one clip per ult (release → finisher + 1 s, ~4 s), solo vs a fixed boss.
- Default list (6): 가디언 드래그(착지 컷 + 성벽 돌파), 버서커 드래그(도약 + 용암), 메이지 조준(블리자드 → 깨짐), 크로노 조준(정지 → 재개), 메딕 조준(제세동), 퍼펫티어 조준(커튼콜). `only=` picks others.
- Output `test-results/ult-fx-video/<id>.webm` (not committed; the main session sends them with SendUserFile).

### 5-4. Full checks before the commit (CLAUDE.md)

`npx tsc --noEmit && npm run typecheck:server && npx vitest run` · `npm run build:all && npm run build:artifact` (artifact < 16 MB; no new sound files) · `npx playwright test` (phone, desktop, multi; rerun the 3-player test alone if the PC is busy).

---

## 6. 기획자에게 물어볼 것

1. 마무리 큰 글자: **(추천) 한자 한 글자**(城 · 斬 · 凍 …, 짧고 크게 읽힘) / 한글 단어(「성채」 「일섬」) / 글자 없음.
2. 드래그 궁극기의 이름 띠: **(추천) 착지 컷**(착지 뒤 반대쪽 절반에 비스듬한 띠) / 22차처럼 작은 띠.
3. 마무리 세기(멈춤 0.13초 + 5% 확대 + 흔들림 12): **(추천) 그대로 해 보기.** 어지러우면 「연출」 흔들림을 0으로 하면 확대 · 속도선도 같이 꺼짐. 더 줄이고 싶으면 알려 주시면 숫자 하나로 바꿈.
4. 힐러 · 서포터(클레릭 · 메딕 · 바드 · 크로노 · 퍼펫티어)의 마무리도 딜러와 같은 세기로: **(추천) 같게** — 궁극기는 누구 것이든 궁극기답게 / 한 단계 약하게(멈춤 0.1초, 흔들림 9).
5. 크로노 조준 정지 2.5초 → 1.9초(「시간 재개」가 정지 끝 직전에 터지도록): **(추천) 1.9초** / 2.5초로 두고 재개를 2.9초에.
6. 「궁극기 연출 강화」 켜기/끄기 칸: **(추천) 비교가 끝날 때까지 두기**, 다 보시면 지움.

---

## 7. 만든 결과 — 설계와 다른 점 (통합 기록)

설계(1~5장)대로 만들었고, 아래만 다르게 했음(이유 = 보이는 곳 = 맞는 곳 · 폰에서 읽힘 · 더 화려하게). 숫자 · 시간 · 설명 줄은 3장 그대로(데이터에서 확인).

### 7-1. 공통 (코어)

- **마무리 자동 고르기**(`finale` 없을 때): 장판은 적 박자가 있으면 안 뽑힘 — 지금은 30개 모두 `finale`이 있어 안 쓰임.
- **잠금 표시 크기**: 겨눈 자리 **위에** 떨어지는 첫 적 박자의 크기(직선 · 부채꼴 · 시작점 네모 · 오프셋 부분은 거기서 끝날 뿐이라 건너뜀), 없으면 `firstRadius`.
- **띠 · 십자 · 부채꼴의 마무리 고리**: 둥근 모양만 고리 3겹(0.5R~1.35R). 띠 · 십자 · 부채꼴은 제 모양 위에 물결 둘 + 가는 흰 고리 하나(최대 3칸, 0.3초) — R = 길이/2 고리는 띠 밖을 크게 칠함(2-9).
- **`ultFocus`**: 큰 글자 · 확대 · 숨 고르기 구멍 · 빛 모으기 · (통합) 별 · 빛기둥 · 불꽃 · 파편 · 불씨는 직선 · 부채꼴 · 네모 · 원뿔의 **가운데**에(시작점 = 캐릭터 발밑이 아님).
- **큰 글자 자리**(통합): 세로 265~460(설계 170~460) — 보스 레이드 패턴 팁 칸(위쪽 y 100~190)에 안 가리게. 타격이 너무 위면 글자를 타격 **아래**(110px)에 찍음.
- **입자 예산**: 맞은 적 별은 기다림 없이 불꽃 2개, 연타의 첫 그림은 첫 타격에만(레인저 드래그가 불꽃 140개였음). 예산 테스트는 같은 시드의 「안 쓴 판」과 비교한 그 시전만의 최고치.
- **착지 컷**: 어둡게는 0.06초에 들어와 닦기(0.39~0.45)와 함께 나감, 흰 닦기는 띠 안만, 도착할 때 0.1초 흰 번쩍(추가), 초상은 x 480(HUD 팁 알약에 가렸음), 크로노 회색 화면은 띠 아래에서 안 돎.
- **설정 칸**: 「연출」 제목 아래 체크칸이 아니라 일시정지 설정 줄의 전체 폭 단추(컷인 · 진동 · 저스트와 같은 모양). (통합) **궁극기 테스트의 일시정지에만 보임** — 모든 모드에 한 줄을 더하면 폰(390px)에서 일시정지 상자가 화면보다 커짐(브라우저 테스트 실패). 궁극기 테스트에서는 큰 단추(계속 · 디버그 · 전체 화면 · 포기)를 74 → 48로 낮춰 상자가 화면 안에 들어옴(보스 레이드 일시정지는 22차부터 30px쯤 넘침 — 그대로).
- **소리**: 다른 사람에게는 마무리 단계의 소리만(다른 단계의 'hit' 소리는 안 들림). 소리 없는 마무리의 `ult._role` 소리는 다른 사람에게도(멀리). 숨 고르기 · 배경음 줄이기 시각은 `finisherAt`(마지막 타격), `drag.crunch`는 마무리 마지막 타격에만.
- **(통합) 같은 자리 · 같은 모양의 부분**: 「한 스킬 = 한 번쩍」 규칙(같은 시전자 · 스킬 · 자리 · 모양의 두 번째 skillCast를 버림)이 이 30개에서는 꺼짐(강화 켬일 때) — 클레릭 드래그는 착지 자리에 원 6개를 겹쳐 놓아서 종의 마무리가 모으기 · 숨 고르기 · 전용 경고를 잃었음(종이 안 떨어짐). 그룹 B의 임시 「구조」 코드는 지움.
- **(통합) 0.5초 규칙의 부동소수**: 「마무리보다 0.5초 이상 앞선 박자만 멈춤」을 1e-6 여유로 비교(0.95 − 0.45 = 0.4999…라 팔라딘 드래그 낙인 멈춤이 빠졌음).
- **(통합) 3인 멀티 확인**: `tests/e2e/multi-ult-test.spec.ts`가 ★마무리 경고(가디언 조준 성채 전개 원 4.5 · 가디언 드래그 성벽 돌파 띠 5×13)도 세 화면 같은 자리인지 봄. `tests/e2e/ult-test.spec.ts`는 일시정지의 「궁극기 연출 강화」(켬 → 끔 저장 → 켬, 상자가 화면 안).
- **(통합) 경고 무늬**: 메이지 조준 얼림의 `countdown`(부채꼴 전체 반경 6+의 원을 메이지 둘레에 그림) → `outline`. 원 전용 무늬(`countdown` · `ticks` · `rune`)는 원 모양 박자에만 남음(크로노 조준 시곗바늘 십자의 `clock`은 가는 흰 점선 원이라 그대로).

### 7-2. 그룹 A

- 가디언 조준: 방패 물결은 띠 가운데에 r = 띠 길이(9칸 띠를 정확히 덮음) — 캐릭터 중심이면 절반이 뒤로 감. 조준선은 진짜 9칸 띠를 따라감.
- 가디언 드래그: 오늘 PREP 방패는 끔(0.12초에 떨어짐), 내 방패가 0.45초에 떨어짐. 성벽 방패 넷은 0.75초까지 차례로(설계 공식이면 폭발 뒤에 떨어짐). 성벽 돌파 물결은 `guardian_d:wave` 대신 내 그림(그 이야기는 띠 시작점 중심이라 절반이 성벽 뒤로 감).
- 팔라딘 조준: 큰 창 넷은 0.15~0.06초 먼저 꽂힘. 팔라딘 드래그: 낙인 맥박은 하나(빨라지는 것) — 둘 겹치면 금색 판처럼 보임.
- 워든 드래그: `warden_u:chainstorm` 대신 사슬 8줄 + 사슬 고리(16줄은 0.8초 마무리 때까지 살아 있어 예산 초과). 철창에 테두리 사슬 4줄이 조여듦(추가).
- 블레이드: 검기 베기 크게(52~76px). 일섬 베기 7개는 한 번에, 나이만 다르게(멈춘 화면에 다 보이게).
- 버서커 조준: 1.0초쯤엔 보통 버서커가 그 자리를 떠나 있음 → 그때는 뛰어오르는 대신 용암 덩이가 떨어짐. 버서커 드래그: 높이 2.6에서 떨어지는 `drop` + 착지 용암 고리. 분출 전 0.7초부터 희미한 금, 마무리 때 밝은 금.
- 섀도우: 초승달에 사방에서 들이치는 잔상 4 + 넓은 초승달 베기. 드래그 미끄러짐 잔상은 첫 분신 → 실제 도착 자리(0.17초 뒤 읽음).
- 레인저: 화살비 꽂힐 때 작은 고리 · 별, 하늘 화살에 떨어지는 화살 6 고리 + 금빛 기둥 + 깃털. 드래그 연사는 내 3줄 그림(`ranger_d:volley`의 줄 공식은 3발 넘으면 띠 밖).
- 메이지 조준: 눈보라 · 얼림 · 깨짐 모두 부채꼴 안에 내 그림(오늘 이야기는 반경 8~9 원 · 4.1초 눈 · 메이지 발밑 별). 고드름은 얼음 창(`FallObj.Meteor`는 늘 주황 불덩이). 깨짐의 화면 번쩍은 얼음빛. 메이지 드래그 마무리 자국은 서리.
- 블레이드 조준 · 메이지 조준 · 가디언 드래그 마무리: 별 · 빛기둥 · 불꽃 · 파편 · 불씨를 끄고 띠 / 부채꼴 가운데에 직접 그림(통합에서 코어도 가운데로 옮김 — 둘 다 같은 자리라 겹치지 않음).
- 이름: 3장의 「이름 바꿈」은 이미 그 이름이라 그대로.

### 7-3. 그룹 B

- 설명 길이 테스트: 「22차 가장 긴 것 이하」 → 「그 1.5배 이하」(새 설명 143~311자; 편성 화면 상세는 스크롤).
- 띠를 따라가는 빛줄기는 띠 폭 × 0.7까지(빛줄기는 화면 폭이 같고, 가로 띠는 0.55배로 눌려 보여 넘침).
- 메딕 조준 사이렌 고리는 거점 반경 안(`medic_u:siren`은 11칸까지). 바드 조준 합창은 띠 안 아군만(`bard_u:choir`는 바드 둘레 12칸).
- 무늬: 메딕 제세동(십자) · 퇴마사 조준 봉인 · 멸(띠)은 `outline`(`countdown` 원이 모양 밖).
- 퇴마사 조준 폭풍: `talismans` 장식(반경 r 원) 대신 벽 위에 꽂힌 부적이 폭풍 끝까지 남음.
- 클레릭 드래그 종 시작 높이 = min(7, 0.69·y − 0.1), 최소 2.4(높이 7이면 보스 근처 착지에서 화면 · HUD 위로 나감). 클레릭 조준 날개 높이 2.4(3이면 HUD 아래로 숨음).
- 거너 조준 포탄: 떨어짐과 터짐이 같은 미리 고른 자리(반경 2.5 − 폭발 안). 메딕 제세동 팔 번개는 내 그림(0.3 / 0.2초 전).
- 퇴마사 조준 滅 PREP은 마무리에만(짝 띠가 滅을 두 번 그리지 않게). 퍼펫티어 조준 조종 실은 보스 · 중간 보스 · 소환물 제외(조종 면역).
- `bard_ua` 잠금은 작은 잠금(띠가 바드에서 나가고 겨눈 자리에 떨어지는 박자가 없음).

### 7-4. 검토 후 고침 (23차 검토)

공통 (코어):
- 마무리 준비(가장자리 물듦 · 빛 모으기 · 숨 고르기)를 게임 시계에 맞춤 — 멈춤(설정 150ms, 그로기, 교대)이나 디버그 「게임 속도」 때문에 쾅보다 늦게 나와 쾅 뒤에 35% 어둠이 남던 것을 고침. 쾅이 먼저 오면 남은 준비는 버림. 조준 잠금 표시도 진짜 쾅과 같이 터짐(쾅이 늦으면 최대 0.6초 기다림).
- 내 마무리 뒤 적 경고를 다시 그릴 때 화면 흔들림 · 5% 확대를 따라감(약 20px 어긋나 두 개로 보이던 것), 큰 글자 위에 그림(글자가 경고를 가리지 않음). 클래식 · 원정 · 레이드 · 강화 끔은 그대로.
- 숨 고르기 「6칸」 규칙: 띠는 길이 절반이 아니라 대각선 절반으로 잼 → 가디언 드래그(성벽 5×13) · 바드 드래그 · 퍼펫티어 조준(12×4)은 어둡게 없이 물듦만. 밝은 구멍은 띠 · 십자 · 부채꼴이면 그 모양 그대로(+0.4칸), 원은 둥글게(전에는 띠 가운데 둥근 구멍이라 띠 끝이 어두워졌음).
- 블레이드 드래그: 착지 구덩이 · 금 · 먼지 · 자국이 내려놓은 자리가 아니라 블레이드가 실제로 선 곳(약 7칸 앞)에 (look `touchdownLive`).
- 크로노 조준: 「시간 재개」(`ult.chrono.resume`)가 보스 · 졸개의 시간 정지가 풀릴 때마다 또 나던 것(한 번에 2~3번) → 2.3초 마무리 때 한 번만. 강화 끔은 22차 그대로.
- 멀티 궁극기 테스트 「메뉴」(폰): 70px 멀티 규칙이 48px 규칙을 이겨 110px 넘쳤음 → 큰 단추 44px · 설정 줄 46px · 위아래 여백 · 안내 줄 간격을 줄여 소리 막대 · 안내 줄까지 화면 안. 다른 모드 메뉴는 그대로.
- 게임 중 카드 스킬 창(궁극기 테스트): 「궁극기 · 드래그」 표가 두 줄 높이를 함께 써서 창이 낮아지고, 그래도 화면 위로 나가면 창을 그만큼 내림(위 6px 안; 폰에서 잰 6개는 모두 카드 줄 위에서 끝남). 다른 모드는 그대로.
- 시트 그림 도구(`tests/visual/ult-test-sheet.mjs`): 조준 줄의 0.25초 칸 이름 「착지 · 착지 컷」 → 「컷인 · 잠금」.

그룹 A · B (내용):
- 버서커 드래그 용암 분출: 3칸 · 6칸 · 9칸 → **7칸 · 4.5칸 · 1.5칸**(먼 곳부터 착지 쪽으로). 보스 위에 끌어 놓으면 보스 몸 앞 가장자리에 착지해서, 9칸 앞의 ★(반경 2.6)가 보스를 거의 못 맞히고(50번 중 0번) 반은 맵 밖에서 터졌음. 이제 ★가 끌어 놓은 보스 위(50번 중 50번). 시간 · 반경 · 피해는 그대로, 금은 지금처럼 9칸까지 빛남.
- 섀도우 조준 ★초승달: 8칸 돌진이 멈춘 자리 → **겨눈 곳(8칸 안, `aimRange: 8`)**. 붙어 싸우던 보스를 돌진이 지나쳐 초승달이 보스 뒤 빈 바닥에 떨어졌음(48번 중 23번만 맞음). 돌진은 그대로 겨눈 쪽 8칸, 미리보기 = 떨어지는 곳도 그대로. 잠금 표시는 큰 잠금(겨눈 곳에서 ★까지 기다림). 22차 결정(§35-4 「초승달 = 멈춘 자리」)을 바꾼 것.
- 소리: 앞에 「올라가는 소리」가 붙은 파일(`drag.medic.defib` · `drag.berserker.slam`)을 그냥 틀어 0.1초쯤 늦게 터지던 것 → 메딕 조준 · 드래그 충전 두 번은 각각 0.15초 먼저, 버서커 드래그 분출 쿵 두 번은 각각 0.12초 먼저 요청(lead), 마지막 ★ `drag.berserker.quake`는 쾅 순간에(전에는 두 번째 쿵이 ★ 위에 겹쳤음). 같은 단계의 lead 소리는 박자 시각마다 하나씩(전에는 첫 것만). 강화 끔은 22차 그대로.
- 그룹 B 그림: 폰이 버거울 때(2-8) 그룹 B가 직접 뿌리는 불꽃 · 불씨 · 깃털 · 음표 …도 절반(전에는 코어 몫만 줄었음). 강화 끔의 22차 그림은 그대로.

---

## 8. 24차 — 큰 글자 없애기 · 약한 다섯 개 강화 · 궁극기 충전 버튼

> 기획자 답(그대로): 「1. 글자가 나오는거 별로야. 10. 지금 다섯개 모두 더 화려하게. 나머지는 다 추천대로. 그리고 궁극기테스트 모드는 궁극기버튼 옆에 궁극기게이지 채워주는 버튼좀 넣어줘. 매번 디버그 가기 귀찮아.」

세 설계안(① 궁극기별 이야기 · ② 손맛과 폰 안전 · ③ 장르 문법)을 비교해서 고르고 섞은 결과(근거는 8-7). 지키는 것은 23차와 같음.
- 클래식 · 원정 · 보스 레이드는 숫자 · 그림 · 소리 그대로(골든 다시 녹화 안 함, `classic-look` 그림 해시 · `TABLES_22` 그대로).
- 「궁극기 연출 강화」 끔 = 22차 연출. 시전 한 번에 입자 150 · 효과 40 · 바닥 자국 6 이하. 새 소리 파일 없음(있는 456개만).
- 게임 규칙 변화는 `src/data/ultTest`의 데이터뿐(프로토콜 8 그대로). 다른 사람 · 봇의 궁극기는 흐리게(멈춤 · 흔들림 · 확대 · 어둡게 없음).

### 8-1. 한눈에

1. **큰 글자는 모두 없앰.** ★마무리의 한자(城 · 斬 · 凍 …), 다른 사람 궁극기 위의 작은 한자, 퇴마사 그림 속 封 · 印 · 滅, 퇴마사 조준 컷인 띠의 붉은 낙관 封(궁극기 테스트에서만)까지.
2. **대신 글자 없는 「충격 프레임」.**
   - 내 마무리 순간 0.05초 동안 화면이 그 캐릭터의 어둠색으로 확 덮이고, 맞는 자리에 흰 별 모양 섬광이 쾅.
   - 별 모양은 캐릭터마다 다름(블레이드는 비스듬한 한 줄, 크로노는 12갈래 시계 눈금, 메이지는 눈꽃 …).
   - 이어서 가로 · 세로 빛줄기와 충격파 고리 둘이 화면 밖으로 퍼짐.
   - 다른 사람 · 봇의 궁극기에는 없음.
3. **약하던 다섯 개는 새로 짬.** 다섯 모두 게임 데이터도 바뀜. 위력은 나머지 25개와 비슷하게 눈대중.
   - 섀도우 드래그 「흑월 대처형진」: 분신 여섯이 점점 빠르게 대상을 가로질러 벰 → 벤 자리에 보라 줄이 남음 → 0.5초 정적, 큰 초승달 → 달이 떨어지는 순간 줄 여섯이 한꺼번에 터짐(1.5초).
   - 레인저 조준 「매의 화살비 · 천공 강하」: 굵은 표적 화살 → 화살비 세 겹이 표적으로 좁혀 옴 → 빛의 매가 날개를 펴고 내리꽂히며 큰 화살이 됨(1.9초).
   - 레인저 드래그 「매의 대일격」: 굵은 세 줄 연사 → 하늘에서 화살 셋이 대상을 묶음 → 쏠 줄만 밝게 남는 저격의 숨 → 매와 함께 날아가는 관통(1.5초).
   - 바드 드래그 「공명 무대 · 피날레」: 음파가 박자마다 커지고 조명이 하나씩 켜짐(하나 · 둘 · 셋) → 한 박자 쉼(조명 꺼짐) → 드롭(1.65초).
   - 크로노 드래그 「시간 균열 · 영겁의 역행」: 균열 → 필름 되감기 → 세상이 회색으로 멈추고 같은 균열이 두 번 되풀이 → 시계판이 깨지며 색이 돌아옴(1.65초).
4. **「충전」 버튼**: 궁극기 버튼 오른쪽의 작은 둥근 버튼. 궁극기 테스트에서만 보임(혼자 · 멀티). 누르면 내 세 캐릭터 게이지가 모두 참(디버그 「궁극기 충전」과 같음). 멀티에서는 방장이 아니어도 자기 게이지만 채움.
5. **그대로**(2~9번 추천대로): 착지 컷 띠, 마무리 세기(멈춤 0.13초 · 흔들림 12 · 확대 5%), 힐러 · 서포터도 같은 세기, 크로노 조준 정지 1.9초, 「궁극기 연출 강화」 켜기/끄기 칸, 긴 설명 글, 퇴마사 조준의 붉은 먹 고리, 섀도우 조준 초승달 = 겨눈 곳(8칸 안).

**정해 주실 것** (답이 없으면 (추천)대로):
1. 큰 글자 대신: **(추천) 충격 프레임** / 아무것도 없음(빛 고리만).
2. 퇴마사 조준 컷인 띠의 붉은 낙관 封: **(추천) 궁극기 테스트의 조준 궁극기에서는 지움** / 그대로(띠 장식).
3. 충전 버튼: **(추천) 멀티에서 누구나 자기 게이지** / 방장만.
4. 이름: **(추천) 섀도우 드래그 「흑월 대처형진」, 레인저 조준 「매의 화살비 · 천공 강하」, 바드 드래그 「공명 무대 · 피날레」**(나머지 둘은 지금 이름) / 다섯 모두 지금 이름.

### 8-2. 큰 글자 없애기

#### 8-2-1. 지울 곳 (코드에서 찾은 전부)

| 파일 · 자리 | 무엇 | 처리 |
|---|---|---|
| `src/render/ultTest/grammar.ts` L78–80 `FinisherSpec.glyph / glyphPx`, L117–118 `FINISH_STRIKE`, **L473** `ultGlyph(...)` 호출, L505–511 `ultGlyph()`, L20 `pushGlyph` import, 주석 L5 · L7 | 마무리 150px 도장(내 것), 땅 위 60px 글자(남의 것) | `glyph · glyphPx` 대신 `impact · burst · tailColor`(8-5-2). L473 → 내 것만 `pushImpact(...)`. `ultGlyph` 삭제 |
| `src/render/ultTest/core.ts` `Stamp` L98–110, `stamp · smallStamps` L137–138, reset L161–162, `ultCoreCounts` L174–176, `ultScreenBusy` L182–184, `ultStampText` L186–189, `pushGlyph` L426–435, 그리기 L618–621, `GLYPH` · `drawStamp` L733–800, 주석 L15 | 글자 도장의 상태와 그리기 | 삭제. 충격 프레임(`IMPACT`, `pushImpact`, `drawImpact`, `ultImpactOf`, `ultImpactCut`)으로 바꿈 |
| `src/render/ultTest/theme.ts` `UltTheme.glyph` L9–10, `T()` 첫 인자, 표의 한자 L37–51, FALLBACK `'極'` L54, 주석 L1 | 캐릭터별 한자 | `glyph` → `burst`(별 모양, 8-2-2 표) |
| `src/render/ultTest/kit.ts` L26 `ultGlyph`, L74 `glyphFx` 다시 내보내기 | 그룹 파일이 글자를 다시 쓸 통로 | 둘 다 뺌(`glyphFx` 자체는 `stagefx.ts`에 남음 — 오늘 궁극기용) |
| `src/render/ultTest/groupA.ts` `finisher: { glyph }` 15곳: L237 · 314 · 347 · 386 · 404(워든 둘 공용) · 552 · 583 · 645 · 698 · 742 · 775 · 829 · 856 · 937 · 967 | 마무리 한자 지정 | `glyph` 키만 지움(`...OFF_ANCHOR`, `flash: 0` 등은 남김. 빈 `finisher: {}`가 되면 줄째 지움) |
| `src/render/ultTest/groupB.ts` `finisher: { glyph }` 14곳: L240 · 283 · 337 · 384 · 464 · 501 · 582 · 622 · 680 · 719 · 780 · 812 · 899 · 939 | 같음 | 같음(`sparks: 30`, `screenColor`는 남김) |
| `groupB.ts` **L519** `glyphFx('封', 60)`, **L553** `glyphFx('印', 50)`, **L610** `glyphFx('滅', 120)`, import L43 | 퇴마사 조준 · 드래그 그림 속 한자 | 8-2-3 |
| `groupB.ts` **L565** `runStory('exorcist_u:destroy', 'prep')` | 오늘 PREP이 滅 96px를 그림(`stagefx.ts` L381) | 부르지 않음(8-2-3) |
| `groupB.ts` **L612** 별칭 `{ key: 'exorcist_d:destroy' }` | 오늘 LAND가 印 70px를 그림(`stagefx.ts` L823) | 별칭을 빼고 글자 아닌 부분만 직접(8-2-3) |
| `src/render/cutin.ts` L447 · L744–757 `sealStamp` | 퇴마사 큰 컷인 띠의 붉은 낙관 封(퇴마사 조준 대체 궁극기에서 보임) | `CutIn.noSeal`(기본 false, `start()`마다 false). `vfx.ts`의 `ultCutIn`(내 것 · 강화 켬 · 대체 궁극기)에서만 true. 클래식 그림은 그대로 |
| 주석: `settings.ts` L19, `render/ultTest/index.ts` L61, `render/index.ts` L1943–1951 · L2079, `groupA.ts` L6, `groupB.ts` L6 | 「big glyph」 설명 | 「impact frame」으로 고침 |

#### 8-2-2. 대신 넣는 것: 충격 프레임 (내 ★마무리만, 화면 층, 실제 시계 — 멈춘 화면에도 그림)

| 때 (★부터) | 내 화면 |
|---|---|
| 0 ~ 0.05초 | **어둠 컷**: 화면 전체를 그 캐릭터의 어둠색(`burst.ink`)으로 65% 덮음. 1초에 한 번까지(충전 버튼으로 연달아 써도 번쩍임이 1초에 한 번을 넘지 않음). 적 경고는 그 위에 다시 그림(멈춘 화면 포함) |
| 0.05 ~ 0.11초 | 어둠 0.65 → 0. 밑에 있던 화면 번쩍(0.42, 지금 그대로)이 드러남 |
| 0 ~ 0.06초 | **흰 별 섬광 쾅**: 맞는 자리(`ultFocus`, 몸 높이 0.6)에 캐릭터 모양 별이 1.6배 → 1배. 흰 채움 0.95 + 화면색 테 6px + 어두운 밑줄 3px. 바깥 반지름 R = 모양 크기 × 1.1(화면 px, 120 ~ 220), 안쪽 0.42R(갈래 4개 이하는 0.18R). 별 가운데는 화면 x 100 ~ 1180, y 160 ~ 620 안으로 |
| 0.06 ~ 0.18초 | 별이 머묾 |
| 0.18 ~ 0.38초 | 가시가 1.35배로 늘며 사라짐 |
| 0.02 ~ 0.22초 | **빛줄기**: 별 가운데를 지나는 가로 1100 × 10px(흰 심 + 화면색 테) + 세로 280 × 6px, 가늘어지며 사라짐 |
| 0.03 ~ 0.35초 | **충격파 고리 둘**: 화면색 60 → 480px(굵기 22 → 2), 0.06초 뒤 흰 고리 40 → 360px(굵기 10 → 1) |
| ~ 0.74초 | 그림은 끝, 기록만 남음 — `ultScreenBusy()`가 참이라 마무리 뒤 여운 비네트(0.12 ~ 0.72초)가 끝날 때까지 적 경고를 위에 다시 그림(큰 글자 때와 같은 창). **24차 검토**: 비네트는 게임 시계로 돌아 마무리 멈춤(0.13 ~ 0.16초)만큼 늦게 끝남 → 기록은 0.74초 + 그 멈춤(`extendImpact`) |

캐릭터마다 별 모양만 다름(글자도 문양도 아님):

| 캐릭터 | 갈래 | 들쭉날쭉 | 기울기(rad) | 어둠색 | 느낌 |
|---|---|---|---|---|---|
| 가디언 | 6 | 0.05 | 0 | #070a14 | 고른 육각 별 |
| 팔라딘 | 4 | 0.05 | 0 | #0d0a02 | 십자(+) |
| 워든 | 8 | 0.1 | 0.39 | #080a05 | 여덟 갈래 |
| 블레이드 | 2 | 0 | −0.5 | #000000 | 비스듬한 한 줄(일섬) |
| 버서커 | 12 | 0.3 | 0 | #140402 | 거칠게 깨진 별 |
| 섀도우 | 5 | 0.15 | 0 | #05030f | 다섯 갈래 |
| 레인저 | 4 | 0.05 | 0.785 | #000000 | 길고 가는 X(화살 끝) |
| 메이지 | 6 | 0 | 0.52 | #03080c | 눈꽃 |
| 거너 | 10 | 0.3 | 0 | #0c0703 | 폭발 |
| 클레릭 | 8 | 0.05 | 0 | #0c0a02 | 빛살 |
| 메딕 | 4 | 0 | 0 | #020a0b | + |
| 퇴마사 | 8 | 0.2 | 0.39 | #0c0203 | 부적 불꽃 |
| 바드 | 10 | 0.15 | 0 | #0c020d | 터지는 음 |
| 크로노 | 12 | 0 | 0 | #04050c | 시계 눈금 |
| 퍼펫티어 | 6 | 0.2 | 0.52 | #0c0208 | 꽃잎 |
| (표에 없는 캐릭터) | 8 | 0.1 | 0 | #05060a | — |

화면색 · 비네트 · 불꽃 · 바닥 자국 칸은 2-3 표 그대로.

사람별 · 설정별:
- 다른 사람 · 봇: **없음**. 전의 땅 위 작은 글자(60px)도 없앰. 땅 위 그림(k 0.55)과 화면 안일 때 번쩍 절반은 지금처럼.
- 「연출」 멈춤 0 → 어둠 컷 없음(별 · 빛줄기 · 고리는 있음). 흔들림 0 → 지금처럼 속도선 · 확대만 꺼짐.
- 기기 「동작 줄이기」 → 어둠 컷 · 빛줄기 없음, 별은 쾅 없이 나타남, 고리 절반 밝기.
- 폰이 버거울 때(`FX_LOAD.low`) → 빛줄기 · 둘째 고리 없음.
- 축복 마무리(아군만 — 지금 30개에는 없음) → 어둠 컷 없이 별 0.8배.

그리는 자리:
- `drawUltScreen` 안에서 맨 먼저(그 위에 조준선 · 속도선).
- 살아 있는 화면의 경고 다시 그리기는 지금 코드(`ultScreenBusy`) 그대로.
- **멈춘 화면**(`drawFrozen`)에서는 지금 경고를 다시 그리지 않으므로 새로 넣음: 어둠 컷이 켜진 동안(`ultImpactCut()`) 같은 흔들림 + 5% 확대 변환으로 `drawEnemyDanger`. 궁극기 테스트 · 강화 켬일 때만이라 클래식 경로는 그대로. **24차 검토**: 어둠 컷 동안만이 아니라 살아 있는 화면과 같은 창(`ultScreenBusy()`) 동안 — 컷이 끝난 뒤의 별(멈춤 설정 150ms), 컷이 없는 별(동작 줄이기 · 1초 안 두 번째 마무리)이 경고를 가리던 것. 그리기 전에 `teleSeq.track`으로 멈춤 중 새로 뜬 경고를 묶음(안 묶으면 여러 칸 패턴이 전부 「다음 칸」 빨강으로 번쩍).

#### 8-2-3. 퇴마사 그림 속 글자 대신 (그림만)

| 곳 | 지금 | 바꿈 |
|---|---|---|
| 조준 `exorcist_ua:greatseal` land (L519) | 封 60px | 벽 위 세 곳(`footAlong` 0.2 · 0.5 · 0.8)에 부적빛 기둥 `lightPillar(0.45 × 4, TALISMAN, 0.6초)` + 가운데 금빛 별 56(`#ffe8a3`) |
| 조준 `exorcist_ua:seal` land (L553) | 印 50px 빨강 | 봉인 띠 위 먹 낙인 `areaFx(Fx.Brand, 띠, 0.55초, INK)` + 붉은 먹물 8(`Pk.Ink`, `#a4161a`) + 금빛 별 40 |
| 조준 `exorcist_ua:destroy` ★ prep (L565, 오늘 PREP의 滅 96px) | `runStory('exorcist_u:destroy', 'prep', …)` | 부르지 않음. ★ 0.6초 전 부적 8장이 벽 양 끝에서 겨눈 곳 위 고리(반경 1.4, 높이 2.6)로 날아가 꽂힘(비공개 `talisman()`에 높이 인자 추가) + 0.55초 전 먹 룬(반경 2.4) + 0.5초 전 금빛 가는 고리가 3.2 → 0.5로 조여듦. land는 지금 그대로(붉은 먹 고리 = 8번 답 「그대로」) |
| 드래그 `exorcist_ud:destroy` ★ prep (L610) | 滅 120px(높이 3.2) | 여덟 문 자리(`spots(gateKey)`)에서 가운데로 부적 실 8줄(`tetherFx` Thread, TALISMAN, 0.6초) + 금빛 가는 고리 5.5 → 0.8 |
| 드래그 `exorcist_ud:destroy` 별칭 (L612, 오늘 LAND의 印 70px) | `{ key: 'exorcist_d:destroy' }` | 별칭에서 빼고 글자 아닌 나머지를 직접: 먹 고리 0.4 → R × 1.1 두 겹(굵기 6) + 종이 10 + 불씨 8(`stagefx.ts` L824–826과 같은 값). `{ key: 'exorcist_u:destroy', prep: false }`는 그대로 |
| 퇴마사 조준 컷인 띠의 낙관 封 | 붉은 도장 | 그리지 않음(`CutIn.noSeal`, 8-2-1). 띠의 궁극기 이름 글자는 UI라 그대로 |

#### 8-2-4. 그대로 두는 글자 (범위 밖)

- 오늘 퇴마사 궁극기의 滅(`stagefx.ts` L381) · 印(L823): 클래식 · 원정 · 레이드, 그리고 궁극기 테스트에서 **짧게 탭**한 오늘 궁극기에 나옴. 바꾸면 클래식 그림 해시가 깨짐 — 보고 때 미리 말씀드림.
- 바드 조준 오선지 끝의 ♬(`fxparts.ts` L604–606, `Fx.Staff`): 글자가 아니라 음표 그림이고 오늘 바드 그림과 공용. 바드 드래그는 이번에 오선지를 안 씀.
- UI 글자: 컷인 · 착지 컷 띠의 궁극기 이름(2번 답 그대로), 피해 숫자, 다른 사람 궁극기 이름 알림, 캐릭터 몸의 역할 글자(방 · 근 …).

#### 8-2-5. 「궁극기 연출 강화」 끔 (22차)

바꿀 것 없음.
- 끄면 이야기 · 마무리 문법이 안 돌아서(`vfx.ts`의 `ULT_FX.boost` 조건) 충격 프레임도 없음.
- 22차 강조 그림(`STAGES22` · `STAGES`)에는 글자가 없음.
- 22차 경로는 PREP/LAND를 대체 궁극기 열쇠(`exorcist_ua:destroy` …)로 찾는데 오늘 표에는 그런 열쇠가 없어서 滅 · 印도 원래 안 나옴.
- 컷인 낙관 封은 끔에서는 22차처럼 보임(비교용).

### 8-3. 다섯 궁극기

공통:
- 다섯 모두 **설계 변경**(데이터 + 그림). 데이터는 `src/data/ultTest/group{A,B}.ts`만. 오늘 표(PREP/LAND/IMPACT/TELE_MOTIF/ZONE_DECOR/STAGE_CUES)에 새 열쇠 없음. 새 단계 이름(`mark` · `pin` · `beat3` · `echo`)의 소리는 그 궁극기 데이터의 `sfx`로 정함(있는 id만).
- ★ = 2-3 공통 마무리(멈춤 0.13 · 흔들 12+4 · 화면 0.42 · 숨 고르기 · 확대 5% · **충격 프레임** · 바닥 자국)에 그 궁극기 그림을 더함. ★는 0.8 ~ 2.45초 안.
- 중간 멈춤은 접촉 박자 하나, ★보다 0.5초 이상 앞, 55ms 이하. 그게 착지 0.8초 안이면 look `touchdownStop: 0`.
- 화면 효과(비네트 · 색 빠짐 · 저격 어둠 · 속도선)는 `s.local`일 때만. 남의 것은 k 0.55 + 낮은 세부(빛기둥 자동 생략). 이퀄라이저 막대 · 날개 같은 추가 그림도 남의 것은 절반 이하.
- 하늘에 뜨는 그림(초승달 · 매 날개)의 높이: 위 끝이 화면 y 110 아래(보스 막대 아래)가 되게, 그룹 A 비공개 함수 `skyZ(y, 위로 솟는 px) = clamp(0.687·y + 0.94 − px / 42.7, 하한, 상한)`(화면 y = 150 + 29.3·y − 42.7·z). 섀도우 달(r 60, 빛무리 90px)은 `clamp(0.687·y − 1.17, 0.6, 3.4)` = 달 가운데가 화면 y 200 근처. 매 날개(2.4칸, 위로 약 100px)는 `clamp(0.687·y − 1.4, 0.6, 3)`. 위쪽 줄에 선 고정 보스(y ≈ 3)면 하한에 걸려 조금 높아질 수 있음 — 폰 그림으로 확인.
- 예산 숫자는 어림. 시전마다 예산 테스트로 확인하고, 넘치면 ★의 `sparks` · 먹물 수부터 줄임.
- 설명 글은 그룹 테스트 규칙(효과마다 「공격력 N% 피해」 같은 문구가 그대로 들어가고, 숫자는 데이터에 있는 것만)에 맞춰 씀. 문구가 빠지면 데이터가 아니라 말을 고침.

#### A12′. 섀도우 드래그 「흑월 대처형진」 (전: 그림자 대처형진) — 설계 변경 · finale `moon` · ★ 1.5초 (그대로)

먹물 진에서 솟은 분신 여섯이 점점 빠르게 대상을 가로질러 벰 → 벤 자리에 보라 낙인 줄이 남아 맥박 → 0.5초 정적, 대상 위 낮은 곳에 큰 초승달 → 달이 떨어지는 순간 줄 여섯이 한꺼번에 흰 빛으로 터짐(「이미 베었다」). 23차의 길 위 분신 넷 · 미끄러짐 · X 처형은 없앰.

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0~0.18 | 이동(순간이동 9) | 공통 + 착지 먹물 웅덩이(1.2, 지금) | (착지 흔들만) | `mon.blink` |
| 0~0.45 | (먹물 번짐) | 대상 둘레로 먹 고리가 0.5 → 3.5로 번짐 + 0.3초부터 먹물 웅덩이(반경 3.5, 1.2초) | — | — |
| 0.45 | `clone` 첫 타 (대상 둘레 반경 3.5) | 대상 둘레 여섯 곳(각 베기의 시작 끝)에서 분신이 먹물에서 솟아 자기 차례까지 서 있음 + 오늘 드래그 「분신」 X 하나 + 먹 고리 3.5 + 먹물 12 | **멈춤 .04** · 흔들 4 · 범위 .7 | 행 `drag.shadow.clone` |
| 0.55~1.15 | (본체 숨음) | 섀도우 몸 0.6초 숨김(분신이 곧 본체) → 1.15초에 높이 0.8에서 떨어져 나타남 | — | — |
| 0.6 / 0.7 / 0.79 / 0.87 / 0.94 / 1.0 | `dance` ×6 쌓기 (길이 7, 폭 1.4; 이동 방향 기준 0° · 60° · 120° · 30° · 90° · 150°) | 분신이 대상을 가로질러 돌진(잔상 3, 번갈아 반대쪽에서) + 검보라 빛줄기(0.9) + 흰 심(0.3) + 대상 위 초승달 베기 56px × (1 + 0.12 · 순번) + 먹물 3. **벤 자리에 보라 낙인 줄이 ★까지 남아 맥박.** 여섯째에 흰 X 80px. 다 그으면 대상 위에 열두 갈래 별 | 흔들 1.5 → 3 (번째마다 +0.3), 여섯째 범위 .35 | 행 `ult.shadow.dance` 베기마다 +1음 |
| 1.0~1.5 | (정적) | 분신은 사라지고 낙인 줄 여섯만 맥박. 0.6초 전 세상이 보랏빛(0.5). 대상 위에 큰 초승달(60px, 지금 34px)이 ★ 1초 전부터 차오름 — 달 가운데가 화면 y 200 근처 | 물듦 · 빛 모으기 · 숨 고르기 (공통) | — |
| 1.5 | `moon` ★ (반경 3) | 달이 떨어져 닿음 → 오늘 「초승달 베기」(호 90 + X 70 + 고리 + 유리) + 사방 분신 4가 베어 들어옴 + 넓은 초승달 베기 170px + **낙인 줄 여섯이 한꺼번에 흰 빛줄기(1.0, 0.3초)로 터짐** + 먹 금(반경 3, 6줄) + 먹물 14 | ★ (충격 프레임 · 먹물 자국) | sfx `ult.shadow.moon` lead 0.35(줄이기) + `drag.shadow.execute` lead 0.25 −6dB |

데이터 (전체 교체, `SHADOW_RUN` 지움):
```ts
/** 섀도우 드래그 (기획 24차): six clones cut through its target, faster and faster — [rot° from the way it moved, delay]. */
const SHADOW_CUTS: readonly (readonly [number, number])[] = [[0, 0.6], [60, 0.7], [120, 0.79], [30, 0.87], [90, 0.94], [150, 1]];
// shadow.drag:
id: 'shadow_ud', name: '흑월 대처형진', slot: 'ult', castTime: ULT_CAST_TIME, move: { kind: 'blink', maxRange: 9 }, finale: 'moon',
// 'clone' and 'dance' keep their rows (drag.shadow.clone; ult.shadow.dance on every cut, +1 step) — also right with the switch off.
// The moon restates its row cue (an override replaces the row) and lays the X-cut under it.
sfx: { moon: [{ id: 'ult.shadow.moon', lead: 0.35, duck: [-10, 0.35] }, { id: 'drag.shadow.execute', lead: 0.25, db: -6 }] },
actions: [
  // 드래그 'target' = the enemy nearest the landing spot, else its own target (the preview shows the same one); follow
  { stage: 'clone', center: 'target', follow: true, delay: 0.45, telegraphLead: 0.3, area: { shape: 'circle', radius: 3.5 }, affects: 'enemies',
    effects: [{ kind: 'damage', amount: 0.6 }, { kind: 'status', status: 'vulnerable', duration: 4, value: 0.2 }] },
  ...SHADOW_CUTS.map(([rot, delay]): SkillAction => ({
    stage: 'dance', rel: 'aim', center: 'target', follow: true, delay, telegraphLead: 0,
    area: { shape: 'rect', dir: 'right', anchor: 'center', length: 7, width: 1.4, rot }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.5 }],
  })),
  { stage: 'moon', center: 'target', follow: true, delay: 1.5, telegraphLead: 0.4, area: { shape: 'circle', radius: 3 }, affects: 'enemies',
    effects: [{ kind: 'damage', amount: 2.8, crit: 'always' }, { kind: 'status', status: 'stun', duration: 0.6, value: 0 }] },
],
// REMOVED: the four 'clone' circles along the run, the 'vanish' slide (it stays where it landed), the 'execute' X
```
위력: 전 850%(분신 넷 각 100% — 길 위라 보스엔 보통 1~2개 — + X 200% + 달 250%) → 640%(60% + 50% × 6 + 280% 치명타, 모두 대상에) + 4초간 받는 피해 +20% + 0.6초 기절.

새 설명: 「끌어 놓은 곳에 나타나(최대 9칸) 대상 둘레 반경 3.5에 먹물 진: 공격력 60% 피해 + 4초간 받는 피해 +20%. 0.6초부터 1초까지 분신 여섯이 점점 빠르게 대상을 가로질러 벰(길이 7, 폭 1.4): 각각 공격력 50% 피해. 1.5초에 흑월: 대상에게 초승달 베기(반경 3): 공격력 280% 피해(치명타 확정) + 0.6초 기절.」

구현 (그룹 A):
- look `shadow_ud` 그대로(`touchdownStop: 0`, 착지 먹물). `slideFrom` Map, `shadow_ud:vanish` · `shadow_ud:execute` 이야기는 지움.
- `clone`: prep `rings(fx, x, y, 0.5, 3.5, 1, s.delay, INK_DARK, k, follow)` + `scorchFx(fx, x, y, 3.5, 1.2, true, INK_DARK, k, 0.3)` · land alias `{ key: 'shadow_d:clone', prep: false }` + 분신 6 × `h.afterimage(src, E_i, 자기 베기까지)`(E_i = 가운데 ∓ dir(ultAngle + rot_i) · 3.5, 짝수 −, 홀수 +) + `h.ring(x, y, 0.3, 3.5, 0.35, …)` + Ink 12 + `h.later(0.1, () => h.hideFor(src, 0.6))` + `h.later(0.7, () => h.drop(src, 0.8, 0.2))` · impact `{ stop: 40, shake: 4, flash: 0.7 }`.
- `dance`: land 시작 · 끝 = `footAlong(s, seq % 2 ? 1 : 0)` → 반대 끝, `ghostsAlong(h, src, A, B, 3, 0.25, 0.02)` + `beamAlong(fx, s, 0.9, '#5e60ce', 0.3)` + `beamAlong(fx, s, 0.3, '#ffffff', 0.22, 0.02)` + `slash(fx, x, y, BODY_Z, 화면 각 + π/2, 56 · (1 + 0.12 · seq), MOONLIGHT, k)` + **`areaFx(fx, Fx.Brand, s.x, s.y, s.area, s.toFinish + 0.08, MOONLIGHT, k · 0.7, 0, 3)`**(남는 낙인 줄) + Ink 3. 줄 {x, y, ang}을 비공개 `cutLines` Map(`${src}|${skillId}`, seq 0에서 비움)에 기억. seq 5면 `xslash(80, '#ffffff')` · impact `s => ({ shake: 1.5 + 0.3 * s.seq, flash: s.seq === 5 ? 0.35 : 0 })`.
- `moon`: alias `{ key: 'shadow_u:moon', prep: false }`(오늘 PREP은 달을 높이 3.4에 걸어 보스 막대에 가려짐) · prep `fx.add(Fx.Moon, x, y, 1.0, '#5e60ce', k)` r 60, z = 위 공식, follow, wait delay − 1.0 · land `moonCut(fx, h, s, 14, 170)`(베기 px 인자 추가) + 기억한 줄마다 `beam(…, 1.0, 0.3, '#ffffff', k)` + `crackFx(fx, x, y, 3, 6, INK_DARK, k)` · charge `{ vignette: 0.5, vignetteLead: 0.6 }` · finisher `{ sparks: 30 }` · motif `reticle`.
- 예산 어림: 입자 ≈ 125, SkillFx ≈ 30.
- 끔(22차): `shadow_ud:moon` 강조 그대로, `clone` · `dance`는 기본 물결. 세 단계 소리가 모두 오늘 행이라 22차 소리 경로에서도 맞음.

#### A13′. 레인저 조준 「매의 화살비 · 천공 강하」 (전: 매의 화살비) — 설계 변경 · finale `skyshot` · ★ 2.3 → 1.9초

굵은 표적 화살이 꽂힘 → 화살비 세 겹이 표적으로 좁혀 옴 → 빛의 매가 날개를 펴고 내리꽂히며 큰 화살이 됨. 23차의 가는 화살 12발 연사와 5번 화살비는 없앰.

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0~0.45 | (활 당김) | 레인저 → 겨눈 곳 굵은 금빛 조준선(폭 1.0) + 깃털 10이 활로 빨려 듦 + 0.35초 활에 별 36 | — | 컷인 그대로 |
| 0.45 | `mark` 첫 타 (반경 2) | 흰 빛줄기(0.9) + 흰 속줄기 → 큰 화살(2.2, 지금 1.05)이 꽂힘 → 금빛 조준 표시(반경 2)가 ★까지 남음 + 고리 0.2 → 2 + 깃털 8 · 흙먼지 5 | **멈춤 .045** · 흔들 4 · 범위 .7 | sfx `normal.ranger` |
| 0.8 / 1.05 / 1.3 | `rain` ×3 쌓기 (반경 3.6 → 2.8 → 2) | 0.35초 전 활에서 하늘로 빛 화살(오늘 PREP) → 굵은 화살 6개(0.65, 지금 0.35)가 높이 6에서 고리 안에 꽂힘 + 흰 가는 고리가 r + 0.5 → r로 조여듦 + 꽂힌 곳마다 별 18 · 깃털. 셋째는 가운데 별 50 | 흔들 2 / 3 / 4 · 범위 .45 | sfx `ult.ranger.rain` 고리마다 +2음(lead 0.3) |
| 1.3~1.9 | (매) | 0.6초 전 **빛의 매**: 날개(`Fx.Wings` 2.4, #eafff6)가 겨눈 곳 위에 펼쳐지고 0.07초 간격으로 둘 더(레인저 쪽 위에서 겨눈 곳 쪽 아래로) = 내리꽂는 매의 잔상. 0.45초 전 금빛 날개 한 번 퍼덕(2.0) + 깃털 10이 빨려 듦 + 금빛 기둥(1.2 × 11) | 물듦(검정 0.35) · 빛 모으기 · 숨 고르기 (공통) | sfx `dash.melee` lead 0.45 +4dB (바람 휙 — **24차 검토**: 처음 고른 `ult.ranger.tick` 파일은 40Hz 아래 덩어리라 리미터를 치는 가장 큰 소리였음) |
| 1.9 | `skyshot` ★ (반경 2) | 큰 화살(1.8, 지금 1.1)이 높이 11에서 0.26초 + 화살 8개 왕관(0.5, 반경 1.6)이 0.012초씩 따라 꽂힘 → 오늘 「하늘 화살」(금빛 고리, 별 64, 돌, 깃털) + 금빛 금(반경 3, 10줄) + 흰 고리 0.3 → 4 + 그을림(1.5) + 깃털 분수 16 | ★ (충격 프레임 · 구덩이 자국) | 행 `ult.ranger.skyshot` (lead 0.3) |

데이터 (전체 교체):
```ts
/** 레인저 조준 (기획 24차): the arrow rain closes in on the mark — [radius, delay, damage]; the innermost = the sky arrow's size. */
const HAWK_RAIN: readonly (readonly [number, number, number])[] = [[3.6, 0.8, 1.6], [2.8, 1.05, 1.8], [2, 1.3, 2]];
// ranger.aim:
id: 'ranger_ua', name: '매의 화살비 · 천공 강하', slot: 'ult', castTime: ULT_CAST_TIME, finale: 'skyshot',
sfx: {
  mark: { id: 'normal.ranger' },
  rain: { id: 'ult.ranger.rain', on: 'hit', step: 2, max: 3, lead: 0.3 },                     // a shot-up + pour per ring, rising
  skyshot: [{ id: 'ult.ranger.skyshot', lead: 0.3 }, { id: 'dash.melee', lead: 0.45, db: 4 }], // the row + the hawk's swoop (24차 검토: was ult.ranger.tick −2)
},
actions: [
  { stage: 'mark', center: 'point', delay: 0.45, area: { shape: 'circle', radius: 2 }, affects: 'enemies',
    effects: [{ kind: 'damage', amount: 1 }, { kind: 'status', status: 'vulnerable', duration: 4, value: 0.15 }] },
  ...HAWK_RAIN.map(([radius, delay, amount], i): SkillAction => ({
    stage: 'rain', center: 'point', delay, telegraphLead: 0.25, area: { shape: 'circle', radius }, affects: 'enemies',
    effects: i === 0 ? [{ kind: 'damage', amount }, { kind: 'status', status: 'slow', duration: 2, value: 0.3 }] : [{ kind: 'damage', amount }],
  })),
  { stage: 'skyshot', center: 'point', delay: 1.9, telegraphLead: 0.45, area: { shape: 'circle', radius: 2 }, affects: 'enemies',
    effects: [{ kind: 'damage', amount: 6, crit: 'always' }, { kind: 'status', status: 'stun', duration: 0.5, value: 0 }] },
],
// REMOVED: the 12-arrow 'barrage' (0.5–1.38 s) and the 5-hit 'rain' (1.6–2 s)
```
위력: 전 1490%(70% × 12 + 40% × 5 + 450%) → 1240%(100% + 160% + 180% + 200% + 600% 치명타) + 4초간 받는 피해 +15% + 둔화 + 0.5초 기절. 흩어진 연사 대신 큰 한 방.

새 설명: 「겨눈 곳에 표적 화살(반경 2): 공격력 100% 피해 + 4초간 받는 피해 +15%. 화살비가 표적으로 좁혀 옴: 0.8초에 반경 3.6 공격력 160% 피해 + 2초간 30% 둔화, 1.05초에 반경 2.8 공격력 180% 피해, 1.3초에 반경 2 공격력 200% 피해. 1.9초에 빛의 매가 하늘 화살이 되어 내리꽂힘(반경 2): 공격력 600% 피해(치명타 확정) + 0.5초 기절.」

구현 (그룹 A):
- look 기본 — 잠금 표시 = `mark` 반경 2(= ★ 반경), ★까지 남음.
- `mark`: prep `aimLine(fx, ox, oy, x, y, 1.0, '#ffd23f', k, 0, 0.45)` + `h.implode(ox, oy, BODY_Z, 1.6, cnt(10), FEATHER, 0.4, Pk.Feather)` + `star(fx, ox, oy, BODY_Z, 36, '#ffffff', k, 0.35)` · land `beam(ox, oy, x, y, 0.9, 0.2, ARROW, k)` + `beam(…, 0.3, 0.16, '#ffffff', k, 0.02)` + `arrow(ox, oy, x, y, 0.16, 2.2, ARROW, k)` + `crosshairFx(x, y, 2, s.toFinish + 0.1, '#ffd23f', k, −1)` + `h.ring(x, y, 0.2, 2, 0.3, '#ffffff', 3, 0)` + Feather 8 + Smoke 5 · impact `{ stop: 45, shake: 4, flash: 0.7 }`.
- `rain`: alias `{ key: 'ranger_u:rain', land: false }`(오늘 PREP = 활에서 하늘로 쏘는 빛기둥) · prep: `randomIn(s)` 여섯 곳을 비공개 Map(`${src}|${skillId}|${seq}`)에 기억하고 `h.laterSim(s.delay − 0.18, …)`에서 `fallAt(Arrow, 0.65, 6, 0, 0.18, ARROW, k)` × 6(기다리는 효과를 미리 쌓지 않음 — 예산) · land: 그 자리마다 별 18 + 깃털 1, `h.ring(x, y, r + 0.5, r, 0.25, '#ffffff', 2, 0)`, seq 2면 가운데 별 50 · impact `s => ({ shake: 2 + s.seq, flash: 0.45 })` · motif `reticle`.
- `skyshot`: alias `{ key: 'ranger_u:skyshot', prep: false }`(오늘 PREP의 화살 1.1은 작음. LAND의 금빛 고리 · 별 64 · 돌 · 깃털은 씀).
  - prep: 빛의 매 = `fx.add(Fx.Wings, …)` 셋(r 2.4 · 2.3 · 2.2, `#eafff6`, 0.5초, wait delay − 0.6 + 0.07·i, 자리는 레인저 쪽 1.2칸 → 겨눈 곳 위, z = `skyZ` − 0.6·i, 하한 0.6). `h.laterSim(delay − 0.45, …)`에 금빛 날개(r 2, `#ffd23f`, 0.3초) + `h.implode(x, y, z, 2, cnt(10), '#ffd23f', 0.3, Pk.Feather)`. `lightPillar(x, y, 1.2, 11, '#ffd23f', k, 0.45, −1, delay − 0.45)` + `fallAt(Arrow, 1.8, 11, delay − 0.26, 0.26, '#fff6d0', k)` + 왕관 8 × `fallAt(Arrow, 0.5, 9, delay − 0.24 + 0.012·i, 0.24, ARROW, k, −1, cos·1.6, sin·1.6·0.8)`.
  - land: `crackFx(x, y, 3, 10, '#ffd23f', k)` + `h.ring(x, y, 0.3, 4, 0.35, '#ffffff', 3, 0)` + `scorchFx(x, y, 1.5, 2.5, false, '#3a2e26', k)` + Feather 16.
  - charge `{ vignetteColor: '#000000', vignette: 0.35 }` · finisher `{ sparks: 24 }` · motif `reticle`.
- 예산 어림: 입자 ≈ 120, SkillFx ≈ 30.
- 끔(22차): `ranger_ua:skyshot` 강조 그대로, `mark` · `rain`은 기본 물결. 소리는 `rain` · `skyshot` 오늘 행, `mark`는 22차 역할 소리.

#### A14′. 레인저 드래그 「매의 대일격」 — 설계 변경 · finale `pierce` · ★ 1.25 → 1.5초

착지 앞구르기 · 활 당김 → 굵은 세 줄 연사 → 하늘에서 화살 셋이 대상을 묶음 → 쏠 줄만 밝게 남는 저격의 숨 → 매와 함께 날아가는 관통.

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0~0.16 | 이동(돌진 9) | 공통 + 길 위 깃털 8(지금) | 착지 **멈춤 .05** · 흔들 7 | `dash.ranged` |
| 0.16~0.5 | (착지 · 활 당김) | 앞구르기(1.2, 0.35초, 지금) + 활 둘레 고리 1.8 → 0.3 + 깃털 8이 빨려 듦 + 띠 따라 조준선(오늘 PREP) | — | sfx `drag.ranger.draw` (시전, 지금) |
| 0.5~0.98 | `volley` ×7 첫 타 → 쌓기 (16 × 2) | 굵은 화살(1.8, 한 발마다 × 1.05, 지금 1.2) + 흰 꼬리(0.35, 0.12초). 왼 줄 → 오른 줄 → 세 줄 한꺼번에가 되풀이. 대상에 별 14(세 줄 때 30 + 깃털 3) | 흔들 1, 세 줄 때 1.8, 마지막 2 · 범위 .4 | sfx `drag.ranger.volley` 두 발마다 +2음(지금) |
| 1.1 | `pin` 쌓기 (대상 둘레 반경 1.8) | 0.15초 전 화살 셋이 하늘(높이 6)에서 대상 둘레 삼각형(1.6)에 꽂힘 → 세 화살에서 대상으로 전기 줄(★까지) + 대상에 금빛 조준(1.2) + 깃털 6 | 흔들 4 · 범위 .7 | sfx `fx.tether` + `normal.ranger` −4dB |
| 1.1~1.5 | (저격의 숨) | **내 화면: 쏠 줄(띠 + 0.3)만 남기고 세상 40% 어둡게**(0.08초에 들어와 ★에 끊김) + 띠 따라 금빛 조준선(폭 2.2) + 활에 렌즈 빛(오늘 PREP) | 물듦(검정 0.4) · 빛 모으기 | sfx `dash.melee` lead 0.35 +4dB (매가 날아드는 바람 — **24차 검토**: 전 `ult.ranger.tick` −2dB, 위와 같은 까닭) |
| 1.5 | `pierce` ★ (16 × 2.2) | 오늘 「관통」(빛줄기 둘 + 큰 화살 2.4 + 깃털) + **빛의 매 셋이 띠를 따라 날아감**(날개 1.6, 띠의 0.25 · 0.55 · 0.85 자리, 0.04초 간격) + 띠 안 가는 흰 줄 넷(옆으로 ±0.5 · ±0.9, 0.015초 간격 = 충격 터널) + 거대 화살(3.2) + 대상 별 70 + 활 둘레 고리 0.3 → 2.6 + 레인저 0.7칸 뒤 잔상(반동) + 띠 따라 깃털 12 + 내 화면 띠 방향 속도선 16 | ★ (충격 프레임 · 띠를 따라 베인 자국) | sfx `drag.ranger.pierce` lead 0.25 (행과 같음) |

데이터 (이름 · 이동 · `botAim: 'self'`는 그대로):
```ts
finale: 'pierce',
sfx: {
  volley: [{ id: 'drag.ranger.draw', on: 'cast' }, { id: 'drag.ranger.volley', on: 'hit', step: 2, max: 6 }],   // unchanged
  pin: [{ id: 'fx.tether' }, { id: 'normal.ranger', db: -4 }],
  pierce: [{ id: 'drag.ranger.pierce', lead: 0.25 }, { id: 'dash.melee', lead: 0.35, db: 4 }],         // the row + the hawk's whoosh (24차 검토: was ult.ranger.tick −2)
},
actions: [
  { stage: 'volley', center: 'target', follow: true, delay: 0.5, area: { shape: 'line', length: 16, width: 2 }, affects: 'enemies',
    effects: [{ kind: 'damage', amount: 0.7 }], hits: 7, hitInterval: 0.08 },                                     // was 10 hits
  // a slow, not a root: bosses are immune to root
  { stage: 'pin', center: 'target', follow: true, delay: 1.1, telegraphLead: 0, area: { shape: 'circle', radius: 1.8 }, affects: 'enemies',
    effects: [{ kind: 'damage', amount: 0.8 }, { kind: 'status', status: 'slow', duration: 1.5, value: 0.6 }] },
  { stage: 'pierce', center: 'target', follow: true, delay: 1.5, telegraphLead: 0.4, area: { shape: 'line', length: 16, width: 2.2 }, affects: 'enemies',
    effects: [{ kind: 'damage', amount: 6, crit: 'always' }, { kind: 'knockback', distance: 1.5 }] },            // was 1.25 s, width 1.6
],
```
위력: 전 1300%(70% × 10 + 600%) → 1170%(70% × 7 + 80% + 600% 치명타) + 1.5초간 60% 둔화 + 1.5칸 넉백.

새 설명: 「끌어 놓은 곳으로 몸을 날려(최대 9칸) 대상 쪽 직선(길이 16, 폭 2)으로 0.5초부터 0.08초마다 화살 연사: 공격력 70% 피해 ×7. 1.1초에 화살 셋이 대상 둘레(반경 1.8)에 꽂혀 공격력 80% 피해 + 1.5초간 60% 둔화. 1.5초에 매와 함께 대상을 꿰뚫는 관통 일격(길이 16, 폭 2.2): 공격력 600% 피해(치명타 확정) + 1.5칸 넉백.」

구현 (그룹 A):
- look `ranger_ud`: move 그대로(깃털), touchdown = 지금 앞구르기 `h.hop(1.2, 0.35)` + `rings(fx, to, 1.8, 0.3, 2, 0.3, FEATHER, k)` + `h.implode(to.x, to.y, 0.7, 1.6, cnt(8), FEATHER, 0.3, Pk.Feather)`. `touchdownStop` 기본 50(접촉 멈춤 없음).
- `volley`: alias `{ key: 'ranger_d:volley', lineAsRect: true, land: false }` · land: 줄 = `hit % 3 === 2 ? [−1, 0, 1] : [hit % 3 === 0 ? −1 : 1]`(× 폭 / 2 × 0.55), 줄마다 `arrow(…, 0.2, 1.8 · 1.05^min(6, hit), color, k)` + `beam(…, 0.35, 0.12, '#ffffff', k)`; 대상 `star(14, 세 줄 때 30)` + 세 줄 때 깃털 3 · impact `s => s.hit === s.hits - 1 ? { shake: 2, flash: 0.4 } : { shake: s.hit % 3 === 2 ? 1.8 : 1 }` · motif `aim`.
- `pin`: prep 3 × `fallAt(fx, x, y, FallObj.Arrow, 0.7, 6, delay − 0.15, 0.15, ARROW, k, follow, cos(a_i)·1.6, sin(a_i)·1.6·0.8)`(a_i = 90° + 120°·i) · land 3 × `tetherFx(fx, 꽂힌 곳, x, y, TetherStyle.Electric, s.toFinish + 0.05, ARROW, k, −1, follow, 0, 2)` + `crosshairFx(x, y, 1.2, s.toFinish, '#ffd23f', k, follow)` + Feather 6 · impact `{ shake: 4, flash: 0.7 }`.
- `pierce`: alias `{ key: 'ranger_d:pierce', lineAsRect: true }`(PREP: 활 둘레 조이는 고리 + 렌즈 빛, LAND: 빛줄기 둘 + 큰 화살 2.4 + 깃털).
  - prep (내 것): `h.laterSim(delay − 0.4, …)` → 그 순간의 레인저(`h.memo(src)`)와 대상(`h.memo(follow)`)으로 띠를 다시 재서 `h.screen.focusDim(가운데, r, 0.4, 0.08, 남은 시간, 0, { area: { shape: 'rect', dir: 'right', anchor: 'start', length: 16.6, width: 2.8, rot }, center: 레인저 − u · 0.3, origin: null })` + `aimLine(P0, P1, 2.2, '#ffd23f', k, 0, 0.4)`. 공통 숨 고르기는 띠의 반대각선 8.1 > 6이라 원래 없음 — 이 띠 모양 어둠이 대신하고, ★의 `cancelFocus()`가 끊음.
  - land: `fx.add(Fx.Wings, …)` 셋(r 1.6, z 0.9, `footAlong` 0.25 · 0.55 · 0.85, 0.18초, wait 0.04·i; 남의 것은 하나) + 띠 안 평행 흰 줄 넷 `beam(…, 0.22, 0.2, '#ffffff', k, 0.015·j)`(옆으로 ±0.5 · ±0.9 — 띠 폭 안) + `arrow(P0, P1, 0.2, 3.2, '#ffffff', k)` + 대상 `star(70)` + `rings(ox, oy, 0.3, 2.6, 2, 0.3, '#ffffff', k)` + `h.afterimage(src, 레인저 − u · 0.7, 0.3)` + `sprayAlong(Feather 12)` + 내 것 `ultSpeedLines(x, y, { dir: ultAngle(s), n: 16 })`.
  - charge `{ vignetteColor: '#000000', vignette: 0.4 }` · linger `{ kind: 'gash' }`(띠를 따라) · motif `aim`.
- 예산 어림: 입자 ≈ 110, SkillFx ≈ 25.
- 끔(22차): `ranger_ud:volley`(첫 발) · `ranger_ud:pierce` 강조 그대로, `pin`은 기본 물결.

#### B10′. 바드 드래그 「공명 무대 · 피날레」 (전: 공명 삼중주 · 피날레) — 설계 변경 · finale `forte` · ★ 1.1 → 1.65초

납작하던 세로 띠 셋을 없애고 「커지는 음파 셋 → 한 박자 쉼 → 드롭」으로. 무대 조명 넷과 이퀄라이저 막대로 높이를 줌. 박자는 0.3초(하나 · 둘 · 셋 · 쉼 · 드롭).

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0~0.16 | 이동(돌진 9) | 공통 + 길 위 음표 8(지금) → 착지: 둘레 반경 4.5의 네 곳(45° · 135° · 225° · 315°)에 조명 받침(작은 금빛 고리) | (착지 흔들만) | `dash.support` |
| 0.45 | `choir` · `encore` 지원 (아군 반경 6) | 아군 금빛 + 대기 음표(오늘 「앙코르」) | — | sfx `ult.bard.choir` −6dB · 행 `drag.bard.encore` |
| 0.45 | `beat1` 첫 타 (반경 3) | 바드가 콩 뜀(0.25) + 음파 고리 둘(흰 · 자홍, 0.5 → 3, 굵기 8) + 둘레 이퀄라이저 막대 6(높이 1 ~ 3, 0.25초) + 음표 6 + **조명 하나 켜짐**(자홍 빛기둥 0.5 × 8, 0.3초) + 내 화면 자홍 맥박 0.25 | **멈춤 .04** · 흔들 4 · 범위 .6 | 행 `drag.bard.beat1` |
| 0.75 | `beat2` 쌓기 (반경 4.5) | × 1.15(고리 → 4.5, 막대 6, 음표 8) + 조명 둘 | 흔들 3 · 범위 .5 | 행 `drag.bard.beat2` |
| 1.05 | `beat3` 쌓기 (반경 6) | × 1.3(고리 → 6, 막대 8, 음표 10) + 조명 셋 | 흔들 3.5 · 범위 .5 | sfx `drag.bard.beat2` +2음 + `ult.bard.tick` −4dB |
| 1.35 | (쉼표) | **조명이 다 꺼짐**: 내 화면 0.3초 검게 물듦(0.45) + 바드 머리 위 금빛 음표 하나 + 바드가 뛰어오름(0.6). 빛 모으기 · 숨 고르기(무대 반경 6.4만 밝음) | 빛 모으기 · 숨 고르기 (공통) | (1.45초부터 배경음 −10dB — 공통 규칙) |
| 1.65 | `forte` ★ 드롭 (반경 6) | 조명 넷 + 가운데 큰 흰 빛기둥(1.6 × 12)이 한꺼번에 켜짐 + 받침에서 가운데로 자홍 공명 줄 넷 → 오늘 드래그 「포르테」 × 1.4 + 흰 · 자홍 · 금 고리 3겹(0.5 → 6.5, 굵기 10) + 음표 분수 20 + 막대 12 | ★ (충격 프레임 · 음표 자국) | sfx `drag.bard.forte` + `ult.bard.beat.last` (지금) |

데이터 (전체 교체; `BARD_UD_BUFF` · `BARD_UD_HIT`는 그대로, `band()`와 이름 없는 아군 옆 띠 둘은 지움):
```ts
/** 바드 드래그 (기획 24차): the sound waves grow beat by beat — [stage, delay, radius]; a beat's rest, then the drop. */
const BARD_BEATS: readonly (readonly ['beat1' | 'beat2' | 'beat3', number, number])[] = [['beat1', 0.45, 3], ['beat2', 0.75, 4.5], ['beat3', 1.05, 6]];
// bard.drag:
id: 'bard_ud', name: '공명 무대 · 피날레', slot: 'ult', castTime: ULT_CAST_TIME, move: { kind: 'dash', maxRange: 9 }, finale: 'forte',
sfx: {
  choir: { id: 'ult.bard.choir', db: -6 },                                    // under the beats
  beat3: [{ id: 'drag.bard.beat2', step: 2 }, { id: 'ult.bard.tick', db: -4 }], // the second beat's cue a tone up + a lute pluck
  forte: [{ id: 'drag.bard.forte' }, { id: 'ult.bard.beat.last' }],           // unchanged
},
actions: [
  { stage: 'choir', center: 'point', delay: 0.45, telegraphLead: 0, area: { shape: 'circle', radius: 6 }, affects: 'allies', effects: BARD_UD_BUFF },
  // 'encore' (self, benchStatus atkUp / haste 0.15 × 10 s, every player) — unchanged
  ...BARD_BEATS.map(([stage, delay, radius]): SkillAction => ({
    stage, center: 'point', delay, telegraphLead: 0, area: { shape: 'circle', radius }, affects: 'enemies', effects: BARD_UD_HIT,
  })),
  { stage: 'forte', center: 'point', delay: 1.65, telegraphLead: 0.45, area: { shape: 'circle', radius: 6 }, affects: 'enemies',
    effects: [{ kind: 'damage', amount: 1.8 }, { kind: 'knockback', distance: 2 }, { kind: 'status', status: 'stun', duration: 0.6, value: 0 }] },
],
```
위력: 전 약 210 ~ 270%(가운데 띠 60% + 옆 띠 하나쯤 60% + 150%) → 360%(60% × 3 + 180%) + 2칸 넉백 + 0.6초 기절. 바드 조준 포르티시모(180% + 2칸 넉백 + 0.6초 기절)와 같은 마무리.

새 설명: 「끌어 놓은 곳까지 미끄러져 감(최대 9칸). 반경 6 아군 HP 15% 회복 + 10초간 공격력 +30%·공격 속도 +40%, 모든 플레이어의 대기 캐릭터 10초간 공격력 +15%·공격 속도 +15%. 음파가 박자마다 커짐(0.45초 반경 3, 0.75초 반경 4.5, 1.05초 반경 6): 각각 공격력 60% 피해 + 3초간 40% 둔화. 한 박자 쉬고 1.65초에 피날레(반경 6): 공격력 180% 피해 + 2칸 넉백 + 0.6초 기절.」

구현 (그룹 B):
- look `bard_ud`: `touchdownStop: 0`, move 그대로(음표). touchdown: 착지 둘레 반경 4.5의 네 곳을 `spots(lightKey)`(`${entityId}|bard_ud|lights`)에 기억하고 작은 금빛 고리(받침) 넷 `h.ring(p, 0.2, 0.6, 1.4, GOLD, 2, 0.1)`.
- 비공개 `beat(fx, h, s, n)`(n = 0 · 1 · 2, g = 1 · 1.15 · 1.3): `h.hop(src, 0.25, 0.2)` + `rings(fx, x, y, 0.5, R, 2, 0.35, '#ffffff' / BARD, k, −1, 8)` + 이퀄라이저 막대 `pillar(fx, x + cosθ·R·0.95, y + sinθ·R·0.95, 0.22, 1 + rnd·2·g, GOLD / BARD, k, 0.25)` × 6 · 6 · 8(남의 것 절반) + Note 6 · 8 · 10 + 조명 0..n `lightPillar(spot_i, 0.5, 8, [BARD, GOLD, '#7df9ff', '#ffffff'][i], k, 0.3)` + 내 것 `h.screen.vignette(BARD, 0.25, 0.2, 0)`.
- `beat1` impact `{ stop: 40, shake: 4, flash: 0.6 }` · `beat2` `{ shake: 3, flash: 0.5 }` · `beat3` `{ shake: 3.5, flash: 0.5 }`. 23차 별칭 `bard_d:beat1` · `bard_d:beat2`(세로 띠 오선지 `bardBand`)는 지움.
- `choir`: `alliesGlow(fx, h, s, GOLD, false)`, impact null. `encore` 그대로.
- `forte`: prep `h.laterSim(delay − 0.3, …)` → 내 것 `h.screen.vignette('#05060a', 0.45, 0.3, 0)`(조명 꺼짐) + `notes(fx, 바드, 0.6, GOLD, k, src)` + `h.hop(src, 0.6, 0.3)` · alias `{ key: 'bard_d:forte', k: 1.4 }` · land: 조명 넷 `lightPillar(0.6, 8, …, 0.5)` + 가운데 `lightPillar(x, y, 1.6, 12, '#ffffff', k, 0.5)` + 받침 → 가운데 `beam(…, 0.35, 0.25, BARD, k)` × 4 + `rings(0.5, 6.5, 3, 0.5, …, 10)`(흰 · 자홍 · 금) + Note 20 + 막대 12 · charge `{ vignette: 0 }`(쉼표의 어둠이 물듦을 대신. 빛 모으기 · 숨 고르기는 공통 — 반경 6이라 6.4 구멍) · finisher 기본.
- 예산 어림: ★ SkillFx ≈ 27, 입자 ≈ 110.
- 끔(22차): 바드 드래그는 22차 강조가 원래 없음 → 기본 물결. 소리는 `beat1` · `beat2` · `forte` 오늘 행, `beat3` · `choir`는 22차 경로.

#### B12′. 크로노 드래그 「시간 균열 · 영겁의 역행」 — 설계 변경 · finale `stop` · ★ 1.2 → 1.65초

균열 → 필름 되감기 → 세상이 회색으로 멈춤 → 같은 균열이 흰 사본으로 두 번 되풀이(X → +) → 시계판이 깨지며 색이 돌아옴. 크로노 조준은 「멈추고 다시 흐름」, 드래그는 「되감고 되풀이」라 둘이 겹치지 않음. 23차의 「★와 같은 순간에 회색이 시작 + 흰 번쩍 + 흰 비네트 = 회색 판」을 고침.

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0~0.18 | 이동(순간이동 9) | 공통 + 거꾸로 감긴 필름 잔상 3(지금) + 착지점 바닥에 큰 시계(반경 4, 0.45초)가 거꾸로 빠르게 돎 | (착지 흔들만) | `mon.blink` |
| 0.45 | `rift` 첫 타 (X 5 / 1.8) | 오늘 드래그 「균열」(X 낙인 · 작은 거꾸로 시계 · 유리) + X 네 팔 끝까지 시간색 번개(0.2초) + 흰 X 베기 44 | **멈춤 .04** · 흔들 4 · 범위 .6 | 행 `drag.chrono.rift` (+ 시전 `drag.chrono.wind`) |
| 0.8 | `rewind` 쌓기 (반경 6, 2.5칸 끌어당김) | **필름 되감기**: 반경 6 시계가 0.4초 동안 빠르게 거꾸로 + 끌려오는 적마다 원래 자리 → 지금 자리 점선 줄(0.45초) + 잔상(오늘) + 흰 고리 6 → 0.5 두 겹 + 유리 10이 빨려 듦 | 흔들 3 · 범위 .5 | 행 `drag.chrono.rewind` |
| 1.0 | `stasis` 쌓기 (반경 3.5, 2초 정지) | 오늘 「시간 정지」를 착지 자리에 + 바늘 멈춘 시계(3.5)가 ★까지 + **내 화면 색 빠짐 — ★에 딱 맞춰 색이 돌아옴**(마지막 0.3초 동안) | 범위 .5 | sfx `ult.chrono.stasis` −8dB (**24차 검토**: 전 −2 — 종소리의 가장 큰 곳이 ★에 겹쳐 ★보다 컸음) — 행의 'special'(효과음 버스 저역 필터 + 1초마다 똑딱) 없이. 필터는 효과음 버스만 막으므로 ★ 소리(영웅 버스)를 먹먹하게 한 적은 없음 — 빼서 좋은 것은 맞는 소리들의 둔함과 되풀이와 엇갈리던 1초 똑딱 |
| 1.15 / 1.35 | `echo` ×2 쌓기 (X → +, 5 / 1.8) | **균열이 되풀이됨**: 흰 「되감긴 사본」 낙인 + 0.04초 늦게 시간색 잔상 낙인 + 시곗바늘 빛줄기 + 흰 X · + 베기 50 → 60 + 유리 6. 둘째가 더 큼 → 착지 자리에 여덟 갈래 별 | 흔들 2.5 / 3 · 범위 .5 | sfx `ult.chrono.tock` 바늘마다 +2음, −10dB (**24차 검토**: 전 0 — ★보다 8 ~ 9dB 컸음) |
| 1.65 | `stop` ★ (반경 4) | 0.45초 전 바늘 감기는 소리, 0.3초 전 남색 가장자리(0.3) → 흰 시계판(4)이 12시에 멈춘 채 나타남 → 금 12줄 → **산산이 깨짐**(유리 24) + 오늘 드래그 「정지」 × 1.4 + 기억한 X · + 여덟 팔이 한 번 더 흰 빛줄기 + 흰 고리 3겹 0.5 → 5. 화면색 `#c9d1ff`, 여운 가장자리 남색 `#1c2259`(흰 판 없음) | ★ (충격 프레임 · 문양 자국) | sfx `drag.chrono.wind` lead 0.45 −3dB + `drag.chrono.stop` +4dB (**24차 검토**: 전 0 — 이제 이 시전에서 가장 큰 소리) |
| 2.2 / 3.0 | (정지 풀림: 보스 · 중형보스 1.2초 / 졸개 2초) | 지금 그대로(받은 피해의 30%가 다시 — ★의 피해도 들어감) | — | `ult.chrono.resume` (지금 규칙) |

데이터 (부분 0 · 1 그대로, 순서 3 = `stasis` 유지 → 22차 강조 `chrono_ud:stasis`(`actionIndex 3`)가 계속 맞음):
```ts
finale: 'stop',
sfx: {
  // a plain cue: the ult row's 'stasis' carries the 'special' (the EFFECT-bus lowpass until 3.4 s + a tock a second) — 24차
  // 검토: it never touched the ★ (drag.chrono.stop: hero bus); the build-up now sits under the blow (−8 / −10 / +4)
  stasis: { id: 'ult.chrono.stasis', db: -8 },
  echo: { id: 'ult.chrono.tock', on: 'hit', step: 2, max: 2, db: -10 },
  stop: [{ id: 'drag.chrono.wind', lead: 0.45, db: -3 }, { id: 'drag.chrono.stop', db: 4 }],   // the hands wind back, then the face breaks
},
actions: [
  /* 0 rift (enemies, X 5 / 1.8: 120 % + slow 0.5 / 3 s) · 1 rift (self, swapCooldownReduce 3, every player) — unchanged */
  { stage: 'rewind', center: 'point', delay: 0.8, area: { shape: 'circle', radius: 6 }, affects: 'enemies',
    effects: [{ kind: 'pull', distance: 2.5 }, { kind: 'damage', amount: 0.4 }] },                                   // + damage
  { stage: 'stasis', center: 'point', delay: 1, telegraphLead: 0, area: { shape: 'circle', radius: 3.5 }, affects: 'enemies',
    effects: [{ kind: 'status', status: 'stasis', duration: 2, value: 0.3 }] },                                        // was 1.2 s
  { stage: 'echo', center: 'point', delay: 1.15, telegraphLead: 0, area: { shape: 'cross', diagonal: true, length: 5, width: 1.8 }, affects: 'enemies',
    effects: [{ kind: 'damage', amount: 0.6 }] },
  { stage: 'echo', center: 'point', delay: 1.35, telegraphLead: 0, area: { shape: 'cross', length: 5, width: 1.8 }, affects: 'enemies',
    effects: [{ kind: 'damage', amount: 0.6 }] },
  { stage: 'stop', center: 'point', delay: 1.65, telegraphLead: 0.4, area: { shape: 'circle', radius: 4 }, affects: 'enemies',
    effects: [{ kind: 'damage', amount: 2 }, { kind: 'status', status: 'vulnerable', duration: 5, value: 0.2 }] },    // was the X (5 / 2.4, 160 %) at 1.2 s
],
```
보스 정지 = 2초 × 0.6 = 1.2초 → 2.2초에 풀림. 되풀이 둘과 ★(1.65초)가 그 안이라 30% 되돌림에 들어감(조준과 같은 구조).

위력: 전 280%(120% + 160%) + 되돌림 → 480%(120% + 40% + 60% × 2 + 200%) + 되돌림 + 5초간 받는 피해 +20%. 크로노 조준(60% + 60% + 80% + 200% + 되돌림)과 비슷.

새 설명: 「끌어 놓은 곳으로 순간 이동(최대 9칸). X자 균열(대각선 5칸, 폭 1.8): 공격력 120% 피해 + 3초간 50% 둔화, 모든 플레이어의 대기 캐릭터 재등장 쿨 3초 감소. 0.8초에 반경 6 적을 2.5칸 끌어당기며 되감음: 공격력 40% 피해. 1초에 반경 3.5 적 2초 정지(보스 · 중형보스는 짧게, 풀릴 때 받은 피해의 30% 다시). 1.15초 · 1.35초에 균열이 되풀이됨(X자 → 십자 +, 5칸, 폭 1.8): 각각 공격력 60% 피해. 1.65초에 시계판이 깨짐(반경 4): 공격력 200% 피해 + 5초간 받는 피해 +20%.」

구현 (그룹 B):
- look `chrono_ud`: `touchdownStop: 0`(지금), move = 필름 잔상(지금) + `clock(fx, to.x, to.y, 4, 0.45, TIME, k).flip = −1`.
- `rift`: alias `chrono_d:rift` + (적 부분) X 네 팔 끝까지 `boltFx(…, 0.2, TIME, k)` × 4 + `xslash 44`(지금) · impact 지금.
- `rewind`: alias `chrono_d:rewind` + implode Glass 10(지금) + `clock(fx, x, y, 6, 0.4, '#ffffff', k · 0.8).flip = −1` + `rings(6, 0.5, 2, 0.35, '#ffffff')` + 적(≤ 6)마다 `tetherFx(memo 자리 → follow2 = m.id, TetherStyle.Dotted, 0.45, TIME)`(이 순간의 memo는 끌리기 전 자리) · impact `{ shake: 3, flash: 0.5 }`.
- `stasis`: alias `{ key: 'chrono_u:stasis', at: 'point' }`(지금) + `clock(fx, x, y, 3.5, s.toFinish, TIME, k).flip = 0` + 내 것 `h.screen.desaturate(Math.max(0.3, s.toFinish))`(23차 `desaturate(0.5)`는 ★부터 회색이었음 — 색 빠짐은 끝 0.3초 동안 돌아오므로 ★에 다 돌아와 있음) · impact `{ flash: 0.5 }` · motif `clock`.
- `echo`: `areaFx(fx, Fx.Brand, x, y, area, 0.4, '#ffffff', k)` + `areaFx(…, TIME, k · 0.7, 0.04)` + `xslash(fx, x, y, 0.5, 50 + 10·seq, '#ffffff', k, 0, diag ? 0 : π/4)` + `hands(fx, s, 1 + 0.15·seq)` + Glass 6; 두 십자를 `spots(echoKey)`에 기억 · impact `s => ({ shake: 2.5 + 0.5 * s.seq, flash: 0.5 })` · motif `clock`.
- `stop`: alias `{ key: 'chrono_d:stop', k: 1.4 }` + land `clock(fx, x, y, 4, 0.3, '#ffffff', k).flip = 0` + `crackFx(x, y, 4, 12, '#ffffff', k, { dur: 0.6 })` + Glass 24 + `rings(0.5, 5, 3, 0.4, '#ffffff')` + 기억한 십자마다 팔 빛줄기(흰 w 0.8, 0.25초) · charge `{ vignette: 0.3, vignetteColor: '#1c2259', vignetteLead: 0.3 }` · finisher `{ screenColor: '#c9d1ff', tailColor: '#1c2259', sparks: 30 }` · motif `clock`.
- 예산 어림: ★ 입자 ≈ 115, SkillFx ≈ 20.
- 끔(22차): `chrono_ud:rewind`(고리) · `chrono_ud:stasis`(순서 3) 강조 그대로, `echo` · `stop`은 기본 물결. 소리는 22차 경로(그때는 정지 저역 필터도 22차처럼 있음).

#### 8-3-끝. 정리

| | ★ (전 → 이번) | 중간 멈춤 (★까지) | `touchdownStop` | 데이터 바뀜 | 그림 · 소리만 |
|---|---|---|---|---|---|
| 섀도우 드래그 | 1.5 → 1.5 | `clone` .04 (1.05초) | 0 (그대로) | 부분 전부(먹물 진 · 베기 여섯 · ★ 반경 3 + 기절), 미끄러짐 · X 없앰 | 먹물 번짐, 분신 서기, 남는 낙인 줄, 본체 숨김, 낮은 큰 달, 줄 동시 폭발 |
| 레인저 조준 | 2.3 → 1.9 | `mark` .045 (1.45초) | — | `mark` 추가, 연사 · 5번 화살비 → 좁혀 오는 화살비 셋, ★ 600% + 기절 | 굵은 화살, 빛의 매(날개 셋), 금빛 기둥, 화살 왕관 |
| 레인저 드래그 | 1.25 → 1.5 | 없음 | 기본 50 | 연사 7, `pin` 추가, ★ 폭 2.2 + 넉백 | 굵은 세 줄, 삼각 포박 줄, 저격 어둠, 매 셋, 충격 터널, 베인 자국 |
| 바드 드래그 | 1.1 → 1.65 | `beat1` .04 (1.2초) | 0 (그대로) | 띠 → 원(3 · 4.5 · 6), 아군 원 6, ★ 원 6 + 넉백 · 기절 | 조명 넷, 이퀄라이저, 콩 뜀, 쉼표 어둠, 공명 줄 |
| 크로노 드래그 | 1.2 → 1.65 | `rift` .04 (1.2초) | 0 (그대로) | 되감기 피해, 정지 1초, `echo` 둘 추가, ★ 원 4 · 200% | 큰 바닥 시계, 필름 줄, 흰 사본, 색 돌아옴, 시계판 깨짐, 남색 여운 |

### 8-4. 충전 버튼

| 항목 | 정한 것 |
|---|---|
| 어디 | `.hud-bc` 안, `.ult`의 **형제**(자식이면 누르는 순간 궁극기 손짓이 시작됨). DOM에서는 `.ult` 뒤(CSS `~` 선택자). 논리 px(1280×720): 궁극기 x 577 ~ 703 · y 564 ~ 690 → **충전 x 727 ~ 807 · y 587 ~ 667**(지름 80, 가운데 (767, 627) = 궁극기와 같은 높이, 24px 떨어짐). 폰(×0.54): 지름 43 CSS px + 둘레 10 논리 px 터치 여유 |
| 다른 것과의 거리 | 궁극기 누름 여유(`BUTTON_SLACK` 6 CSS px ≈ 11 논리 px, x ≤ 714)보다 바깥. 펫 카드 3장일 때 첫 장 x 876 → 69px. 궁극기 이름 줄 y 692 ~(버튼 아래). 「조준 / 드래그」 표시 x 600 ~ 680(위). 캐릭터 카드 x ≤ 436. 겹치는 것 없음 |
| 생김새 | 진보라 원(`radial-gradient(#3b2f6b, #171230)`), 테두리 4px `#b49cff`(궁극기 테스트 색). 가운데 「충전」 22px 굵게(폰 `.is-small` 24px) `#f1ebff`. 오른쪽 위에 금빛 작은 원 「+」 배지(26px). `aria-label` · `title` 「궁극기 게이지 채우기 (궁극기 테스트)」 |
| 하는 일 | 디버그 「궁극기 충전」과 같은 명령 `{ type: 'debug', action: { kind: 'chargeUlt', player: 내 번호 } }` → `fillUlts`: **내 세 캐릭터 모두** 가득(필드 · 대기). 봇 · 다른 사람은 그대로 |
| 누른 느낌 | `ui.tap` + 버튼 `is-pop`(0.35초, 1 → 1.12 → 1 + 금빛 빛). 궁극기 원호가 꽉 차고(지금 0.15초 전환) 「끌기!」 / 「탭!」. 필드 게이지가 비어 있었으면 `ultReady` 이벤트로 `ult.ready` 종소리가 저절로 남. **성공 알림 없음**(22차 통합: 디버그 알림이 손가락 꼬리표를 덮었음). 거절되면 `ui.ult.denied` + 이유 알림. (**24차 검토**: 버튼에 `data-sfx=""` — 앱 전체 클릭 소리 `ui.tap`이 더해지지 않게, 0.3초 안 두 번째 누름은 소리 없음) |
| 흐리게 | 내 세 캐릭터 게이지(`memberUltGauge`)가 모두 1 이상이면 `is-full`(알파 0.45, 테두리 `#6b6290`), 눌러도 명령 없음. 필드만 가득이면 그대로 누를 수 있음(대기 캐릭터를 채움). (**24차 검토**: 흐린 버튼을 누르면 `ui.refuse` — `data-sfx`) |
| 숨김 | 궁극기 테스트가 아니면 **아예 만들지 않음**(HUD 생성자에서 `game.state.mode === 'ultTest'`일 때만 — 클래식 · 원정 · 레이드 HUD는 DOM까지 그대로). 전투 단계가 아니거나(보상 · 괴담 방 · 결과) 관전 중(`me.out`)이면 `is-hidden` |
| 잠깐 흐리게 | 궁극기를 겨누는 동안(`.ult.is-aiming ~ .ult-charge`), 카드를 끄는 동안(`.hud.is-drag .ult-charge`) 알파 0.25 · `pointer-events: none`(CSS만) |
| 궁극기 손짓과 안 부딪힘 | ① 형제라 버튼의 누름이 궁극기로 가지 않음. ② 겨누는 동안 포인터가 궁극기 버튼에 잡혀 있어(`setPointerCapture`) 손가락이 충전 버튼 위로 가거나 거기서 떼도 충전 버튼은 클릭을 못 받음 — 거기서 떼면 지금처럼 「궁극기 취소 · 게이지는 그대로」. ③ 충전은 `click`으로만(손 뗄 때), `pointerdown`은 `stopPropagation`, `touch-action: manipulation`. ④ 0.3초 안에 다시 누르면 무시 |
| 혼자 | `game.dispatch` 그대로(디버그 판을 열 필요 없음) |
| 멀티 | 명령 모양 그대로 — **프로토콜 8 유지**. 지금은 디버그가 클라이언트 · 서버 모두 방장 전용이라 두 줄만 고침(아래). 궁극기 테스트 방의 `chargeUlt`만 손님에게 열림. 서버는 이미 `PER_PLAYER_DEBUG`로 보낸 사람 자리에 꽂음(남의 게이지 안 바뀜). 다른 디버그 명령과 다른 모드 방은 지금처럼 방장만. 옛 서버면 손님은 「방장만 할 수 있어요」 알림만 받음 |
| 디버그 판 | 「궁극기 충전」 단추는 그대로 둠 |

멀티 두 줄:
```ts
// src/net/remoteGame.ts dispatch, case 'debug' / 'tunables' (L259–261)
r = this.isHost || (cmd.type === 'debug' && cmd.action.kind === 'chargeUlt' && s.mode === 'ultTest') ? ok : fail('방장만 할 수 있어요');
// server/room.ts, case 'debug' (L418)
if (!isHost && !(cmd.action.kind === 'chargeUlt' && this.variant === 'ultTest')) return fail('방장만 할 수 있어요');
```

HUD · 연결:
```ts
// src/ui/hud.ts
export interface HudCallbacks { /* … */ /** 기획 24차 궁극기 테스트: the 「충전」 button (fill my three gauges). */ onUltCharge?(): void }
// constructor, right after this.ultMode — only when s.mode === 'ultTest':
//   this.ultCharge = h('button', 'ult-charge', bc, '충전') + h('span', 'ult-charge-badge', …, '+'); aria-label / title
//   pointerdown → ev.stopPropagation(); click → (0.3 s guard, not .is-full) cb.onUltCharge?.(), class 'is-pop' for 350 ms
// updateUlt: show(ultCharge, s.phase === 'combat' && !me.out); setClass(ultCharge, 'is-full', every memberUltGauge(me, i).charge >= 1)

// src/ui/app.ts hudCallbacks
onUltCharge: () => chargeMyUlt(),
// chargeMyUlt: game && screen is combat && !paused && !menuOpen →
//   r = game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: localPlayer } });
//   sfx.ui(r.ok ? 'ui.tap' : 'ui.ult.denied'); if (!r.ok) hud.toast(r.reason ?? '충전할 수 없어요', 'warn')
```

```css
/* src/ui/ultTest.css — 기획 24차: 「충전」 next to the ult button (built only in 궁극기 테스트) */
.ult-charge {
  position: absolute;
  left: calc(50% + 87px); /* the ult's right edge (50% + 63) + 24 */
  top: 23px; /* centred on the ult (63 − 40) */
  width: 80px;
  height: 80px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: radial-gradient(circle, #3b2f6b 0%, #171230 75%);
  border: 4px solid #b49cff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  color: #f1ebff;
  font-size: 22px;
  font-weight: 900;
  cursor: pointer;
  touch-action: manipulation;
  user-select: none;
  transition: opacity 0.15s, transform 0.08s;
}
.ult-charge::before { content: ''; position: absolute; inset: -10px; border-radius: 50%; } /* a bigger touch target */
.ult-charge-badge {
  position: absolute; right: -4px; top: -4px; width: 26px; height: 26px; border-radius: 50%;
  background: var(--gold); color: #2a210c; font-size: 20px; line-height: 26px; text-align: center; pointer-events: none;
}
.stage.is-small .ult-charge { font-size: 24px; }
.ult-charge:active { transform: scale(0.92); }
.ult-charge.is-full { opacity: 0.45; border-color: #6b6290; color: #9a90b8; }
.ult-charge.is-pop { animation: ultChargePop 0.35s ease-out; }
@keyframes ultChargePop {
  40% { transform: scale(1.12); box-shadow: 0 0 24px rgba(255, 209, 102, 0.9); }
}
.ult.is-aiming ~ .ult-charge,
.hud.is-drag .ult-charge { opacity: 0.25; pointer-events: none; }
```

### 8-5. 기술 설계 (Technical design)

#### 8-5-1. Tracks, order, file ownership

All four tracks start at once in one working tree. CORE does its **step C1 first** (the API of 8-5-2 with the two shims, small) so GROUP-B's `tailColor` typechecks; the content tracks code against 8-5-2 meanwhile. UI is independent. Subagents never commit; each runs its own tests (Playwright with its own outDir and `E2E_OUT`, `E2E_PORT`, `E2E_RESULTS`).

| Track | Owns (only these files) |
|---|---|
| CORE | `src/render/ultTest/{grammar,core,theme,settings,kit,index}.ts`; hooks in `src/render/index.ts` (the frozen-frame warning redraw only), `src/render/cutin.ts` (`CutIn.noSeal` only), `src/render/vfx.ts` (`ultCutIn` sets `noSeal`; comments); `src/data/ultTest/beats.ts` (no change expected); tests `tests/render/ult-fx-core.test.ts` (**never** `TABLES_22`), `tests/render/ult-test-render.test.ts` (fake canvas methods only, if the impact frame needs one) |
| GROUP-A | `src/data/ultTest/groupA.ts`, `src/render/ultTest/groupA.ts`, `tests/sim/ult-test-groupA.test.ts`, `tests/render/ult-fx-groupA.test.ts` — A12′ A13′ A14′, delete the 15 `glyph` keys |
| GROUP-B | `src/data/ultTest/groupB.ts`, `src/render/ultTest/groupB.ts`, `tests/sim/ult-test-groupB.test.ts`, `tests/render/ult-fx-groupB.test.ts` — B10′ B12′, 퇴마사 8-2-3, delete the 14 `glyph` keys and the `glyphFx` import |
| UI | `src/ui/hud.ts`, `src/ui/ultTest.css`, `src/ui/app.ts`, `src/net/remoteGame.ts`, `server/room.ts`; tests `tests/e2e/ult-test.spec.ts`, `tests/e2e/multi-ult-test.spec.ts`, `tests/net/ult-test.test.ts`, `tests/net/remoteGame.test.ts`; NEW `tests/visual/ult-charge-shot.mjs` (phone picture of the button) |
| INTEGRATION (main session) | after the four: deletes the two shims (`FinisherSpec.glyph?`, kit's `glyphFx` re-export), turns on the source-scan guard if it was skipped, the shared docs, full checks, sheets / videos / screenshot by eye, then commit + push + artifact |

Rules (as 4-1): group tracks import render helpers only from `kit.ts` (a missing helper is written privately in the group file — `skyZ`, `beat`, `cutLines` …); data files stay pure (no `Math.random` / `Date`); today's tables get no new keys; every new stage name has an `sfx` cue in its alt's data; every picture inside its footprint (2-9) except airborne ones (moon, wings) and thin white rings; screen effects only `if (s.local)`.

#### 8-5-2. CORE API (what the content tracks may rely on)

```ts
// ── grammar.ts ──
export interface FinisherSpec {
  kind: 'strike' | 'bless';
  stopMs: number; stopCapMs: number; shake: number; shakeDur: number; tail: number; tailDur: number;
  screen: number; screenColor: string; breath: number; zoom: number; speedLines: boolean;
  /** 24차 충격 프레임 (mine only): the dark cut's alpha at the blow (0 = none). Strike 0.65, bless 0. */
  impact: number;
  /** 24차 충격 프레임 (mine only): the white star burst's size × (0 = none). Strike 1, bless 0.8. */
  burst: number;
  /** 24차: the edge tint after the blow ('' = the theme's vignetteColor; 크로노 드래그 '#1c2259'). */
  tailColor: string;
  flash: number; star: number; rings: number; pillar: boolean;
  sparks: number; debris: number; embers: number; hitMarks: number;
  /** @deprecated 24차 shim — ignored; deleted at integration once no group file sets it. */
  glyph?: string | null;
}
// REMOVED: glyphPx, ultGlyph(). ultFinisher: `if (s.local && (sp.impact > 0 || sp.burst > 0)) pushImpact(...)` where the glyph was;
// the tail: h.screen.vignette(sp.tailColor || th.vignetteColor, 0.4, 0.6, 0).
// R px = clamp(roundR(area) × PX_PER_UNIT × IMPACT.rK, IMPACT.rMin, IMPACT.rMax) × burst; point = ultFocus, height 0.6.

// ── theme.ts ──
export interface UltBurst { spikes: number; jag: number; tilt: number; ink: string }   // the 8-2-2 table
export interface UltTheme { burst: UltBurst; screenColor: string; vignetteColor: string; vignette: number; spark: Pk; decal: DecalKind; decalColor: string; ember: Pk }

// ── core.ts (core-internal; tests read them) ──
export const IMPACT = {
  cut: 0.05, cutFade: 0.06, cutAlpha: 0.65, gap: 1.0,           // the dark cut; at most once per gap s (real clock)
  slam: 0.06, slamFrom: 1.6, hold: 0.12, out: 0.2, grow: 1.35,  // the star
  rMin: 120, rMax: 220, rK: 1.1, inner: 0.42, innerFew: 0.18, rim: 6,
  flareAt: 0.02, flareSec: 0.2, flareW: 1100, flareH: 10, flareV: 280, flareVH: 6,
  ring1: [60, 480, 22, 2, 0.32], ring2: [40, 360, 10, 1, 0.3], ring2At: 0.06, ringAt: 0.03,
  busy: 0.74, x0: 100, x1: 1180, y0: 160, y1: 620,
} as const;
/** Mine only (the grammar calls it after its `s.local` check); a new one replaces the old. cut = the dark-cut alpha (core
 *  zeroes it for the 1 s gap / hit-stop setting 0 / reduced motion); points of the star computed once (Math.random jag). */
export function pushImpact(x: number, y: number, rPx: number, charId: string, theme: UltTheme, color: string, cut: number, burst: number): void;
export function ultImpactOf(): string | null;   // tests: the char id of my impact frame while it is up (replaces ultStampText)
export function ultImpactCut(): boolean;        // the dark cut is on this frame (render/index.ts drawFrozen redraws the warnings)
export function ultScreenBusy(): boolean;       // impact (≤ IMPACT.busy s) or speed lines up
export function ultCoreCounts(): { locks: number; sights: number; impact: boolean; cut: boolean; lines: boolean; pending: number };
// REMOVED: Stamp, pushGlyph, GLYPH, drawStamp, ultStampText, smallStamps. drawImpact runs FIRST in drawUltScreen.

// ── kit.ts ── − ultGlyph (C1), − glyphFx (integration), + `export type { FocusShape } from '../cutin'` (A14′'s 저격 어둠)
// ── cutin.ts / vfx.ts ── CutIn.noSeal = false (reset in start()); drawBand: `if (ink && !this.noSeal) sealStamp(…)`;
//    Vfx.ultCutIn (mine, boost, alt): cut.noSeal = true
// ── render/index.ts drawFrozen ── after drawUltScreen: if (state.mode === 'ultTest' && ULT_FX.boost && ultImpactCut())
//    { save; translate(shake o); the live path's zoom if vfx.juice.zoomAt(ZOOM); drawEnemyDanger(state); restore }
```

What the content tracks need from CORE: (1) nothing to remove their `glyph` keys (the shim keeps either state compiling); (2) `tailColor` (GROUP-B, B12′) — lands in C1; (3) their render tests switch `ultStampText()` → `ultImpactOf() === charId` and drop `ultTheme(c).glyph`. Everything else they use is already in `kit.ts`: `Fx.Moon` / `Fx.Wings` / `Fx.Brand`, `fallAt`, `tetherFx` (`TetherStyle.Electric` / `Dotted` / `Thread`), `lightPillar`, `crosshairFx`, `boltFx`, `scorchFx`, `areaFx`, `rings`, `pillar`, `clock`, `notes`, `arrow`, `beam`, `slash`, `xslash`, `crackFx`, `beamAlong`, `footAlong`, `randomIn`, `ultAngle`, `ultSpeedLines`, `UltHost.{laterSim, later, hideFor, drop, hop, afterimage, implode, memo, screen.focusDim / desaturate / vignette}`.

#### 8-5-3. Shared files — who edits what

| File | Who | What |
|---|---|---|
| `src/data/ultTest/beats.ts` | CORE only — no change expected | the new stage names get their roles from today's rules (`clone` / `mark` / `volley` / `beat1` / `rift` opener, the rest build, the finale finisher). A content track that finds a wrong role reports it |
| `src/data/ultTest/types.ts`, `index.ts` | nobody | `UltCue` already covers every new cue |
| `src/audio/director.ts` | nobody (the main session only, if a check shows a need) | every new sound is data `sfx`; the 크로노 정지 lowpass is solved by the plain-cue override in data |
| `src/render/stagefx.ts`, `castfx.ts`, `fxparts.ts`, `marks.ts`, `impact.ts`, `src/audio/stages.ts` | nobody | today's tables and today's looks never change |
| `docs/ult-fx.md` | main session | after integration: 8-8 「만든 결과 — 설계와 다른 점」, pointers 「→ 8장」 on 2-2 (큰 글자 row), 2-3 (큰 글자 paragraph, 캐릭터 표 글자 칸), 4-4 (`glyph`) and the 3장 rows A12 · A13 · A14 · B10 · B12 |
| `docs/ult-test.md` 7-1, `docs/game-design.md` §37 (24차), `CLAUDE.md` | main session | the five names / descriptions; the 24차 decisions; the 23차 code-map line (hanja list → 충격 프레임) + one line for the charge button + §37 in the round list |
| `docs/screenshots/*` | main session (sheets) · UI (writes the button-shot script; the main session runs it) | |

#### 8-5-4. Notes for the tracks

- CORE: the dark cut, the star and the rings are one record (`impact`), drawn on the real clock; keep the record `IMPACT.busy` s so `ultScreenBusy()` keeps the 23차 window (glyph slam 0.09 + hold 0.35 + fade 0.3). The star's screen point clamps into x0–x1 / y0–y1 like the glyph did, but stays ON the blow (no 「위로 70px」 offset). Count nothing toward the particle / SkillFx budgets (screen layer).
- CORE: the 1 s gate uses the same real clock as `Juice.finisherStop`'s gap; reduced motion = `prefersReducedMotion()`; `FX_LOAD.low` read at push.
- GROUP-A: `moonCut` gets a slash-size parameter (default 130 keeps 섀도우 조준 as it is). The shadow's clones are afterimages: check they draw while the body is hidden (`hideFor`) — if not, start the hide after the clones are pushed.
- GROUP-A: `skyZ` formula in 8-3 공통; the wings' / moon's top must stay under logical y 110 with a fixed boss on the top row (check on the phone sheet with `boss=` a top-centre boss).
- GROUP-B: `spots()` keys: `${src}|${skillId}|lights` (bard), `${src}|${skillId}|echo` (chrono), cleared at seq 0 / the touchdown.
- GROUP-B: the chrono `stasis` override must be a plain cue (no `special`) — `UltCue` has no `special` field, so any override drops the lowpass and the 1 s tocks (the `echo` tocks replace them).
- UI: the button is built only when `game.state.mode === 'ultTest'` at HUD construction; a multi room's first snapshot already carries `mode` (variant rooms send it).

### 8-6. 테스트 · 확인 계획

**단위 테스트 (반드시 통과)**

CORE — `tests/render/ult-fx-core.test.ts` (`TABLES_22`는 손대지 않음):
1. 충격 프레임: 내 마무리 → `ultImpactOf() === charId`, 어둠 컷 켜짐(`ultCoreCounts().cut`), 0.74초 뒤 기록 꺼짐(24차 검토: 실제 마무리면 0.74초 + 그 멈춤). 다른 사람 · 봇 → 없음. 축복 → 어둠 컷 없이 별만. 1초 안 두 번째 내 마무리 → 어둠 컷 없음(별은 있음). 멈춤 설정 0 → 어둠 컷 없음. 동작 줄이기 → 어둠 컷 · 빛줄기 없음, 쾅 없음. `FX_LOAD.low` → 빛줄기 · 둘째 고리 없음.
2. 경고: 살아 있는 화면에서 충격 프레임 위에 적 경고(23차 「경고가 글자 위」 테스트를 바꿈 — 기록 캔버스의 표식 `'城'` → 어둠 컷의 `fillStyle`). 멈춘 화면(`drawFrozen`)에서도 어둠 컷 동안 경고가 그 위에, 흔들림 · 5% 확대 변환을 따라(24차 검토: 기록이 있는 멈춘 프레임 모두 — 멈춤 150ms에서 컷 뒤 프레임도, 멈춤 중 새로 뜬 여러 칸 패턴은 순서대로).
3. 테마: 15캐릭터 모두 `burst`(갈래 ≥ 2, 어둠색 밝기 < 0.1), 어느 칸에도 한자 없음. 2-3 표의 나머지 칸 그대로.
4. 여운 색: `finisher.tailColor`가 있으면 그 색 비네트.
5. **글자 없음 가드** (새):
   - 소스: `src/render/ultTest/*.ts`의 코드 줄(주석 빼고)에 `glyphFx` · `ultGlyph` · `fillText` · `strokeText` · 한자가 든 문자열이 없음.
   - 그려 보기: 30개 × 조준 · 드래그 × 강화 켬 · 끔 × (내 것, 봇) 시전 뒤 6초 동안 `Fx.Glyph` 효과가 하나도 안 생김(`SkillFx.add` 감시), `drawUltScreen`이 `fillText` · `strokeText`를 한 번도 안 부름.
   - 컷인: 내 `exorcist_ua`(강화 켬) → `cutin.noSeal === true`. 강화 끔 · 클래식 퇴마사 궁극기 → `false`.
   - (♬은 `Fx.Staff` 음표라 이 가드에 걸리지 않음, 8-2-4.)
6. 그대로: 클래식 · 레이드에서 대체 궁극기 경로 안 돎(지금 테스트), `classic-look` 해시 · 골든 · 결정성 그대로.

GROUP A:
- `tests/sim/ult-test-groupA.test.ts`:
  - L543 단계 목록 → 섀도우 드래그 `['clone', 'dance', 'dance', 'dance', 'dance', 'dance', 'dance', 'moon']`, 레인저 드래그 `['volley', 'pin', 'pierce']`, 레인저 조준 `['mark', 'rain', 'rain', 'rain', 'skyshot']`.
  - finale 시각: `shadow_ud` 1.5 · `ranger_ua` 1.9 · `ranger_ud` 1.5. 미끄러짐이 없어졌으니 L433의 `shadow` 예외(드래그 뒤 몸 = 착지 자리)는 지움(통과 확인).
  - 고정 보스에 실제 시전: 모든 적 부분이 보스를 맞힘(`targets ≥ 1`), 미리보기 = 착지(따라가는 부분 빼고), 설명 규칙, 봇이 60초 안에 같은 방식으로 두 번.
- `tests/render/ult-fx-groupA.test.ts`:
  - 「마무리 이야기 + 글자」(L147–153) → 「마무리 이야기가 있고 `finisher`에 `glyph` 키 없음」.
  - 이야기 열쇠 목록(L43–46): `shadow_ud:vanish` · `shadow_ud:execute` 빼고 `shadow_ud:dance` 더함(`shadow_ud:clone` · `shadow_ud:moon`은 그대로), `ranger_ua:barrage` 빼고 `ranger_ua:mark` 더함, `ranger_ud:pin` 더함.
  - 세 개의 예산(입자 ≤ 150 · 효과 ≤ 40 · 자국 ≤ 6), 멈춤 규칙, 200프레임 오류 없음(소리 감독 붙여서), 내 마무리에 `ultImpactOf()`가 `'shadow'` / `'ranger'`.

GROUP B:
- `tests/sim/ult-test-groupB.test.ts`:
  - finale 표에 `bard_ud` 1.65 · `chrono_ud` 1.65 추가.
  - L557–576 바드 드래그 → 원(3 · 4.5 · 6) + 피날레 6, 적 단계 `['beat1', 'beat2', 'beat3', 'forte']` 모두 보스 맞힘, 반경 6 안 아군 버프, 회전 안 함.
  - L614–635 크로노 드래그 → 1.75초까지 진행, `stasis` 순서 [3], `echo` [4, 5], `stop` [6], 보스 정지 · 받는 피해 +20%, 2초 더 가면 `stasisEnd` 되돌림.
  - 설명 길이(오늘 가장 긴 설명의 1.5배 이하) · 숫자 규칙, `target` 안 씀.
- `tests/render/ult-fx-groupB.test.ts`:
  - L98 `GLYPH` 표 · L169–173 · L279–294 → `ultImpactOf() === charId`.
  - 두 개의 예산 · 멈춤 · 200프레임.
  - 퇴마사 조준 · 드래그 시전 중 `Fx.Glyph` 0개.
  - 크로노 드래그 ★ 프레임에는 색 빠짐이 끝나 있음.

UI · 넷:
- `tests/net/ult-test.test.ts`: 궁극기 테스트 방 손님의 `chargeUlt` → ok, 그 손님 게이지만 가득(방장 · 봇 그대로). 클래식 방 손님 → 「방장만 할 수 있어요」. 궁극기 테스트 방 손님의 다른 디버그(`ultMode`, `killAll`) → 여전히 거절.
- `tests/net/remoteGame.test.ts`: 손님 클라이언트의 `chargeUlt`(궁극기 테스트 방) → 보냄, `killAll` → 「방장만 할 수 있어요」.
- `tests/e2e/ult-test.spec.ts` (폰 · 데스크톱):
  - 버튼이 궁극기 테스트 전투에만 보임(같은 파일에서 클래식 게임을 하나 열어 `.ult-charge` 없음 확인).
  - 누르면 `.ult.is-full` + 「끌기!」, 알림 없음. 세 게이지가 다 차면 `is-full`(흐림).
  - 궁극기를 겨누는 동안 흐리고 못 누름. 궁극기를 끌어 버튼 위에서 떼면 취소(게이지 그대로, 충전 명령 없음). 버튼을 눌러 궁극기 위로 밀어도 조준이 시작되지 않음.
  - 버튼 상자가 궁극기 누름 상자(+ 여유) · 캐릭터 카드 · 펫 카드 · 궁극기 이름과 안 겹침(844×390, 카드 3 · 펫 3, 가장 긴 대체 궁극기 이름 — **24차 검토**: 「매의 화살비 · 천공 강하」가 아니라 거너 드래그 「펌프 버스트 · 대구경 슬러그」. 테스트는 30개 이름을 화면의 `.ult-name`에 넣어 재고 가장 넓은 것을 씀).
- `tests/e2e/multi-ult-test.spec.ts` (3인): 손님 B가 누르면 B 게이지만 가득(A · 봇 그대로). 지금 확인(★ 경고가 세 화면 같은 자리)은 유지.

**그림 · 영상 · 귀** (통합에서 눈으로 읽음):
- `node tests/visual/ult-test-sheet.mjs` → 30줄(`docs/screenshots/ult-test-sheet-{aim,drag}*.png`):
  - 「마무리 + 0.05초」 칸에 글자가 없고 충격 프레임(캐릭터 모양 별)이 보이며 그 줄에서 가장 큰 그림인지.
  - 섀도우 달 · 레인저 날개가 보스 막대 아래에 보이는지, 바드 조명이 서 보이는지, 크로노 ★가 색이 돌아온 화면인지.
  - 퇴마사 두 줄에 封 · 印 · 滅이 없는지.
- `node tests/visual/ult-fx-video.mjs only=shadow_ud,ranger_ua,ranger_ud,bard_ud,chrono_ud` + `only=guardian_ud,exorcist_ua,blade_ua`(충격 프레임 세 모양 · 퇴마사 글자 없음) + 섀도우 드래그 · 레인저 조준을 위쪽 고정 보스(`boss=`)에 한 번씩 → `test-results/ult-fx-video/*.webm`를 보내 드림.
- `node tests/visual/ult-charge-shot.mjs` → `docs/screenshots/ult-charge-button.png`(폰 844×390, 누르기 전 · 뒤).
- 강화 끔: 다섯 개를 끔으로 시전해 22차 강조(8-3 각 「끔」 줄)가 나오고 오류가 없는지.
- 귀(게임에서): 크로노 드래그 ★가 먹먹하지 않은지, 섀도우 베기 여섯 · 레인저 화살비 셋 · 바드 셋째 박이 겹쳐 시끄럽지 않은지. 새 파일이 없어 `npm run sfx:preview`는 필요 없음. 크로노 조준(B11)도 정지 저역 필터가 ★(2.3초)를 덮는지 함께 들어 봄 — 덮으면 다음 차 질문(이번 범위 밖). (**24차 검토**: 그 필터는 효과음 버스만 막음 — ★ 소리 같은 `ult.` · `drag.` 소리(영웅 버스)는 안 막음.)

**전체 점검** (CLAUDE.md): `npx tsc --noEmit && npm run typecheck:server && npx vitest run` · `npm run build:all && npm run build:artifact`(16MB 아래, 새 소리 파일 없음) · `npx playwright test`(폰 · 데스크톱 · 멀티, 3인 포함. PC가 바쁘면 3인만 다시).

### 8-7. 판단 근거

설계안 ① = 궁극기별 이야기, ② = 손맛과 폰 안전, ③ = 장르 문법. 기준은 폰에서 느껴지는 화려함, 캐릭터다움, 읽히는지, 지킬 것을 깰 위험, 코드 양.

| # | 부딪힌 점 | 고른 것 | 이유 |
|---|---|---|---|
| ① | 글자 대신: ① 어둠 컷 + 캐릭터 모양 별 + 빛줄기 + 고리 둘 / ② 고리 하나 / ③ 색 반전(difference) + 모두 같은 14갈래 문장 | **①**(어둠 72% → 65%) + ③의 1초 제한 · 설정 규칙 · 별 쾅(1.6 → 1배) · 가시 늘며 사라짐 + ②의 0.74초 경고 창 | 0.13초 멈춘 화면을 채울 덩어리가 필요함(② 밋밋). 색 반전은 적 경고와 캐릭터 색까지 뒤집고 폰 합성 비용이 불확실함. 캐릭터별 갈래 모양이 글자처럼 「누구의 한 방인지」를 보여 줌 |
| ② | 다른 사람 · 봇: ③ 작은 문장 / ①② 없음 | **없음** | 「남의 것은 흐리게」. 땅 위 그림과 번쩍 절반으로 충분 |
| ③ | 퇴마사 컷인 낙관 封: ①② 그대로 / ③ 궁극기 테스트 조준에서만 지움 | **③** | 「글자가 나오는거 별로」에 맞음. 기본값 false라 클래식 그림 해시 그대로 |
| ④ | 멈춘 화면의 경고: ①은 「다시 그림」이라 썼지만 지금 `drawFrozen`엔 없음 / ③ 새로 넣음 | **③** | 어둠 컷이 멈춘 첫 화면을 덮으므로 필요. 궁극기 테스트 · 강화 켬에서만 |
| ⑤ | 섀도우 드래그: ① 모서리 분신 넷 + X + 달 / ② 분신 여섯 점점 빠르게 + X + 달 / ③ 먹물 진 + 베기 여섯(낙인 줄 남김) + 정적 + 달과 함께 줄 폭발 | **③ 바탕** + ②의 점점 빨라지는 간격 · 커지는 베기 · 단계 이름 `dance`(오늘 행 소리 — 끔에서도 맞음) + ①의 낮은 달 높이 | 「베어 둔 것이 한꺼번에 터짐」이 가장 큰 한 방이고, 정적이 마무리를 키움. X 처형은 정적을 깨서 뺌. 이름은 「처형」을 남겨 「흑월 대처형진」 |
| ⑥ | 레인저 조준: ① 표적 + 좁혀 오는 화살비 셋 + 빛의 매(날개) / ② 소용돌이 연사 12 + 가로지르는 흰 줄 매 / ③ 신호 화살 + 연사 7 + 화살비 6 + 땅 위 매 그림자 | **① 바탕** + ②의 화살 왕관 8 · 굵은 화살 + ③의 이름 · 바람 소리(`ult.ranger.tick`) + 날개 세 장 잔상(새로) | 좁혀 오는 고리가 「어디로 떨어지나」를 폰에서 가장 잘 보여 줌. ③의 그림자(알파 0.24)는 폰에서 거의 안 보이고 따로 그리는 코드가 필요. ②의 흰 줄은 매로 안 읽힘 |
| ⑦ | 레인저 드래그: ① 세 줄이 대상 한 점으로 + 매 날개 / ② 9연사 + 충격 터널 · 반동 / ③ 연사 7 + 포박 + 쏠 줄만 밝게 + 매 그림자 | **③ 바탕**(포박 · 저격 어둠) + ①의 띠 따라 날아가는 빛의 매 + ②의 충격 터널 · 반동 잔상 · 베인 자국 · 세 줄 번갈이 | 「숨 → 쏨」의 저격 문법이 한 방을 가장 크게 만듦. 띠가 길어(반대각선 8.1 > 6) 공통 숨 고르기가 꺼지는 빈자리를 띠 모양 어둠이 채움 |
| ⑧ | 바드 드래그: ① 둥근 무대 + 스피커 셋(삼각형) / ② 띠 유지 + 소리 벽 + 폭 9 피날레 / ③ 커지는 음파 셋 + 조명 + 쉼표 + 드롭 | **③ 바탕** + ①의 공명 줄(조명 → 가운데) | 「하나 · 둘 · 셋 · 쉼 · 드롭」이 음악적이고 한눈에 읽힘. ② 띠는 납작함의 원인이 그대로 남고 폭 9 아군 예고가 화면 절반을 덮음 |
| ⑨ | 바드 피해: ③ 새 50% + 30% 둔화 2초 | 지금 `BARD_UD_HIT`(60% + 40% 둔화 3초) 그대로 | 바꿀 이유가 없고 설명 · 테스트가 덜 바뀜 |
| ⑩ | 크로노 드래그: ① 정지 1초 + 역행 X, 회색 없음 / ② 되풀이 둘 + ★ 1.35 + 색 돌아옴 + 남색 여운 / ③ 되풀이 X → + + ★ 1.65 시계판 깨짐 + 색 돌아옴 | **③ 바탕** + ②의 남색 물듦 · 남색 여운(`tailColor`) · 화면색 `#c9d1ff` + ①의 바늘 감기는 소리(`drag.chrono.wind` lead 0.45) | 조준(멈춤 → 재개)과 겹치지 않는 「되감고 되풀이」. 회색 → 색이 돌아오는 순간이 ★. 흰 번쩍 + 흰 비네트(회색 판)를 남색으로 끊음 |
| ⑪ | 크로노 정지 소리: 세 안 모두 행 `ult.chrono.stasis`(정지 길이 + 0.4초 저역 필터) | **데이터에서 필터 없는 소리로 덮어씀** | 필터가 ★(1.65초) 소리를 먹먹하게 함(23차에도 ★가 정지와 같은 순간이었음). **24차 검토로 바로잡음**: 필터는 효과음 버스만 막아 ★ 소리(`drag.chrono.stop`, 영웅 버스)는 원래 안 막혔음 — 덮어써서 얻은 것은 맞는 소리들의 둔함 · 1초 똑딱이 없어진 것. ★를 가장 크게 하는 일은 소리 크기(정지 −8 · 되풀이 −10 · ★ +4)로 함 |
| ⑫ | 충전 버튼 크기 · 자리: 72 / 80 / 64, 모두 오른쪽 | **80**(폰 43px) + 터치 여유 10 | 손가락 크기(44pt) 근처. 펫 카드와 69px |
| ⑬ | 가득일 때: ① 못 누름(세 게이지 모두 가득 또는 전투 아님) / ② 필드만 가득이면 흐리지만 누름 / ③ 셋 다 가득이면 흐리고 명령 없음 | **③** + ②의 「전투 아님 · 관전 중이면 숨김」 | 필드만 가득이면 대기 캐릭터를 채우러 누를 수 있어야 함. 쓸 수 없는 때는 숨기는 편이 덜 헷갈림 |
| ⑭ | 멀티 손님 | 세 안 모두 **누구나 자기 게이지**(두 줄, 프로토콜 8 그대로) | 디버그가 방장 전용이라 그대로면 손님에게 버튼이 쓸모없음. 다른 디버그 명령은 계속 방장만 |

버린 것:
- ③ 색 반전 프레임, 땅 위 매 그림자(위 ①, ⑥).
- ①의 섀도우 X 처형 유지, ②의 섀도우 미끄러짐 없애기만 하는 안(X를 남김) — 정적과 줄 폭발이 더 큼.
- ②의 바드 폭 9 띠 피날레, ②의 크로노 ★ 1.35초(정지와 0.4초 차라 「멈춘 세상」이 짧음).
- ①의 「충격 프레임 기록 0.6초」 — 여운 비네트(0.72초)보다 짧아 경고가 비네트에 덮일 수 있어 ②의 0.74초.

### 8-8. 만든 결과 — 설계와 다른 점 (통합 기록)

설계(8-1 ~ 8-6)대로 만들었고, 아래만 다르게 했음(이유 = 보이는 곳 = 맞는 곳 · 폰에서 읽힘 · 지킬 것). 다섯 궁극기의 숫자 · 시간 · 설명 글은 8-3 그대로(데이터에서 확인), 이름은 8-1 4번 추천대로(섀도우 드래그 「흑월 대처형진」, 레인저 조준 「매의 화살비 · 천공 강하」, 바드 드래그 「공명 무대 · 피날레」, 레인저 드래그 · 크로노 드래그는 지금 이름).

#### 8-8-1. 공통 (코어 · 충격 프레임)

- `IMPACT`에 `z: 0.6`(별이 서는 몸 높이) 칸을 더함 — 설계는 글로만 적었음.
- 컷인 띠 그림 저장(캐시) 열쇠에 `noSeal`을 넣음 — 안 넣으면 같은 궁극기로 「궁극기 연출 강화」를 켰다 껐다 할 때 낙관 封이 찍힌 띠 그림을 다시 쓸 수 있었음.
- 어둠 컷의 1초 제한(`lastCut`)은 `resetUltCore`(층이 바뀜)에서 지우지 않음 — 층이 바뀌어도 1초 안에 두 번째 번쩍임이 끼지 않게. 테스트는 실제 시계를 5초 먼저 돌려 놓고 시작.
- 설계가 말하지 않은 곳(켜 둠): 「동작 줄이기」에서도 별의 가시는 사라질 때 늘어남. 축복 마무리(지금 30개에는 없음)도 고리 · 빛줄기는 그림(어둠 컷만 없음).
- 「글자 없음」 가드(`tests/render/ult-fx-core.test.ts` 14절): ① 소스 검사 — `src/render/ultTest/*.ts`의 코드 줄(주석을 빼는 함수와 그 함수의 테스트 포함)에 `glyphFx` · `ultGlyph` · `fillText` · `strokeText` · 한자 없음 ② 그려 보기 — 30개 × 켬/끔 × 내 것/봇(120번, 6초씩)에 `Fx.Glyph`도 화면 층 글자도 없음 ③ 대조 — 오늘 퇴마사 드래그는 印을 하나 만듦(가드가 글자를 볼 수 있다는 확인) ④ 퇴마사 조준 컷인 낙관 — 내 것 · 켬이면 없음, 끔 · 클래식이면 있음.
- 충격 프레임 그림 확인(코어): 8캐릭터 × 6시각을 Chromium에서 그려 모양 · 시간을 눈으로 확인.

#### 8-8-2. 그룹 A (섀도우 드래그 · 레인저 조준 · 드래그, 글자 키 15곳)

- `skyZ`는 카메라의 정확한 비(0.6875 · 3/128)를 씀 — 설계의 반올림 값(0.687 · 42.7)이면 달이 보스 막대 안으로 0.12px 들어감.
- 새 비공개 함수 `skyNudge`: 그림 · 테스트 보스(닫히지 않는 엘리베이터)는 y −1.2에 있음(설계는 y ≈ 3로 봄). 하한 0.6만으로는 달 빛무리가 화면 위 끝에 닿아서, 하한에 걸리면 달 · 매 날개를 카메라 쪽(화면 아래)으로 조금 내림(그 보스에서 달은 약 3.8칸). 대상이 y ≥ 2.6이면 0.
- 레인저 드래그 `pierce`는 마무리의 방사 속도선을 끔(`finisher: { speedLines: false }`) — 공통 속도선 기록이 이야기의 「띠를 따라가는 16줄」을 덮어써서 안 보였음.
- 레인저 조준 `skyshot`: 준비 그림 전부를 ★ 0.6초 전에 게임 시계로 한 번에 만듦(시전 때부터 기다리는 대신) — 표적의 45ms 멈춤 뒤에도 쾅에 맞고, 기다리는 효과 약 13개가 예산을 안 먹음. 그래서 남의 것은 금빛 기둥이 없음(그 순간엔 낮은 세부 표시가 꺼져 있음).
- 섀도우 분신 자리: 분신 박자(원)는 겨눈 방향을 몰라서, 같은 시전의 베기 박자가 기록한 베기 방향을 읽음. 분신은 제 베기 때까지 서 있음. 본체가 숨은 동안(0.65 ~ 1.05초)에도 분신이 그려짐(테스트), 1.4초부터 본체 다시 보임.
- 설계가 정하지 않은 값: 분신 고리 = 달빛색(굵기 4, 채움 0.1), 여섯째 베기의 12갈래 별 56px, 남의 매는 날개 하나(셋 대신), 저격 어둠 · 조준선은 min(0.4, 지연)만큼 먼저.
- 높이 테스트는 날개가 실제로 그려지는 윤곽(꼭대기 = 폭의 0.47배, 약 60px)으로 잼(조절점이 아니라).
- 예산(내 것, 시전 한 번 최고): 섀도우 드래그 입자 90 · 효과 23 · 자국 2, 레인저 조준 90 · 29 · 1, 레인저 드래그 94 · 23 · 3(한도 150 · 40 · 6). 섀도우 드래그 `touchdownStop: 0` 그대로.

#### 8-8-3. 그룹 B (바드 드래그 · 크로노 드래그 · 퇴마사 글자, 글자 키 14곳)

- 두 색 · 세 색 고리는 고리 하나짜리 `rings()`를 0.05초 간격으로 여러 번 — 한 번에 n겹을 부르면 그 색과 그 색의 밝은 색이 번갈아 나와 「흰 → 자홍」을 못 그림.
- 퇴마사 ★ 준비는 조준 · 드래그 모두 `laterSim(지연 − 0.6)` + `finishCount` 확인으로 돌림(드래그의 여덟 문 자리는 1.32초 뒤에야 생김). 설계에 없던 시간: 부적 날아감 0.25초, 먹 룬 ★ − 0.55초, 금빛 고리는 쾅에 맞춰 다 조여지게.
- `stageLights`: 착지가 조명 네 자리를 기록 안 했거나 다른 자리 둘레면 다시 계산.
- 설계가 정하지 않은 값: 크로노 되풀이 별 48px, 되감기 점선 줄 처짐 0 · 굵기 2, 퇴마사 드래그 부적 실 처짐 0.15 · 굵기 2.
- 예산: 그룹 B 테스트는 입자 상한 120으로 봄(바드 드래그 최고 48 · 28 · 2, 크로노 드래그 36 · 19 · 2, 퇴마사 조준 · 드래그 효과 28 · 27).
- 크로노 드래그 `stasis` 소리는 저역 필터 없는 보통 소리(설계대로). 끔(22차 경로)에서는 필터가 22차처럼 있음. (**24차 검토로 바로잡음**: 그 필터는 효과음 버스만 막아 ★를 먹먹하게 한 적이 없음 — ★가 작게 들린 까닭은 소리 크기여서 8-8-7에서 고침.)
- 퇴마사 두 설명 글의 「멸(滅)」은 그대로 둠(편성 화면 글이고 오늘 퇴마사 설명과 같은 말 — 8-2-1 목록 밖). → game-design §37-5 질문.

#### 8-8-4. 「충전」 버튼 (UI)

- `hud-block` 클래스를 더함 — 없으면 `.hud`의 `pointer-events: none`을 물려받아 못 누름. 「겨누는 동안 · 카드를 끄는 동안」 규칙이 더 구체적이라 그대로 이김.
- CSS 작은 추가: `line-height: 1`, `white-space: nowrap`, `-webkit-user-select: none`, 배지 그림자.
- `chargeMyUlt`는 궁극기 테스트가 아니면 바로 끝남(안전). 보스 레이드 HUD에도 `.ult-charge`가 없는지 확인(설계는 클래식 · 레이드 화면 둘을 말함 — 브라우저 테스트가 둘 다 봄).
- 옛 서버에서 거절되면 앱의 보통 알림 「서버가 거절했어요 · 방장만 할 수 있어요」(거절 소리 없음).
- 알아 둘 것: 디버그 「궁극기 충전」과 같은 `fillUlts`라 게이지를 정확히 100%로 맞춤 — 「두 번 차는 게이지」로 100% 넘은 게이지는 100%로 내려감(이 보상은 궁극기 테스트에서 안 나옴, `docs/ult-test.md` 1장).
- 폰 그림(`docs/screenshots/ult-charge-button.png`, `node tests/visual/ult-charge-shot.mjs`): 충전 버튼 논리 x 727 ~ 807 · y 584 ~ 664(지름 80 = 폰 43 CSS px). 가장 가까운 것: 궁극기 누름 상자 13px, 궁극기 이름 25px, 「조준」 표시 59px, 첫 펫 카드 69px. 겹침 없음. (**24차 검토**: 그때 넣은 「가장 긴 이름」은 레인저 조준이었음 — 진짜 가장 긴 거너 드래그 「펌프 버스트 · 대구경 슬러그」로 고쳐도 겹침 없음 — 검토 측정(폰, CSS px): 이름 상자 y 373 ~ 387 > 버튼 + 테두리 아래 끝 365, 이름 끝 x 485 < 첫 펫 카드 550.) 누르기 전 6% · 2% · 2% → 누른 뒤 100% · 100% · 100%, 「끌기!」, 알림 없음, 버튼 흐림.

#### 8-8-5. 통합에서 한 것 · 본 것

- 두 임시 통로를 지움: `FinisherSpec.glyph?`(grammar.ts), kit.ts의 `glyphFx` 다시 내보내기. 「글자 없음」 소스 가드는 처음부터 켜져 있었고(건너뜀 없음) 이제 통과. 그 밖에 전체 점검에서 깨진 것이 없어 고친 코드는 없음.
- 「궁극기 연출 강화」 끔으로 다섯 개를 시전(임시 테스트, 200프레임 + 소리 감독, 끝나고 지움): 오류 없음. 충격 프레임 · 마무리 멈춤 · 잠금 · 바닥 자국 · 24차 그림(달 · 날개 · 낙인) 없음. 22차 강조는 8-3 각 「끔」 줄대로 — 섀도우 드래그 `moon`, 레인저 조준 `skyshot`, 레인저 드래그 `volley`(첫 발) · `pierce`, 크로노 드래그 `rewind` · `stasis`(순서 3); 바드 드래그는 원래 강조가 없어 기본 물결. 켬이면 다섯 모두 충격 프레임 + 마무리 멈춤 한 번.
- 알게 된 것(고치지 않음):
  1. **위쪽 고정 보스에 대상을 치는 궁극기**: 별 가운데는 설계대로 맞는 자리(화면 y 160 ~ 620 안)에 섬. 맨 위 가운데 고정 보스(엘리베이터 y −1.2 등)를 치면 가운데가 하한 y 160에 걸려 위쪽 가시가 보스 막대 밑으로 들어가고, 그 순간 보스 패턴 팁(화면 y 100 ~ 190, 한 판에 두 번)이 뜨면 팁이 별 위를 덮음(23차 큰 글자는 팁 칸 아래 265 ~ 460으로 옮겼었음). 0.38초짜리라 그대로 둠 → §37-5 질문. → **8-8-6에서 고침**(별 테두리가 늘 팁 칸 아래).
  2. **오늘 퇴마사 궁극기의 滅**(코어가 찾음): 클래식에서도 안 그려짐 — 대봉인 · 폭풍 · 멸 세 시전이 같은 자리 · 같은 크기라 「한 스킬 = 한 번쩍」 규칙이 멸을 버림. 8-2-4는 滅이 남는다고 적었지만 실제로는 안 보임. 고치면 클래식 그림 해시가 바뀌어서 이번 범위 밖.
  3. **맨 위 가운데 고정 보스에서 섀도우 드래그 · 레인저 드래그**: 분신 베기(길이 7) · 포박 화살 · 저격 띠가 대상 = 보스 쪽이라 보스 막대 바로 아래 좁은 곳에 몰리고 줄 절반은 경기장 위로 나가서 폰에서 작게 보임. 걸어 다니는 보스(`boss=washer_drum`)로 다시 찍으면 베기 여섯이 보스를 크게 가로지르며 잘 읽힘. 설계대로 둠 → §37-5 6번. → **8-8-6에서 고침**(기획자 「더 화려하게」 — 어떤 보스에서도 크게).
- 검사 숫자 · 그림 · 영상 확인은 game-design §37-4. 그림: `docs/screenshots/ult-test-sheet-{aim,drag}{,-2,-3}.png`(「마무리 + 0.05초」 칸 = 충격 프레임, 글자 없음, 빨간 테두리 없음), `docs/screenshots/ult-charge-button.png`. 영상 8개: `test-results/ult-fx-video/{shadow_ud,ranger_ua,ranger_ud,bard_ud,chrono_ud,guardian_ud,exorcist_ua,blade_ua}.webm`.

#### 8-8-6. 눈 검사 뒤 고침 (작게 보이던 둘 · 별이 가려지던 것)

통합 눈 검사에서 나온 두 가지(위 8-8-5 「알게 된 것」 1 · 3번)를 고침. 그림 · 영상의 기본 보스(엘리베이터, 맨 위 가운데 고정, 가운데 y −1.2 · 반지름 3)로 확인.

공통:
- **충격 프레임의 별이 늘 다 보이게.** 폰에서 보스 패턴 팁 칸을 재 보니 논리 y 100 ~ 177(「⚙ 일시정지 화면에서 …」 줄이 있을 때, 없으면 151). 그래서 별 테두리는 y 185(`IMPACT.top` = 177 + 8) 위로 절대 올라가지 않음.
  - 별 가운데의 하한 `IMPACT.y0` 160 → 305(= 185 + 가장 작은 별 120).
  - 높은 타격(위쪽 고정 보스)이면 별이 팁 칸 바로 아래에 서고, 크기가 그 자리에 맞춰 줄어듦(120 이상). 낮은 타격은 크기 그대로.
  - 쾅(1.6배)과 사라질 때 커지는 가시도 테두리가 185 아래 — 그동안은 가운데가 아래로 내려감(칸 밑에서 쾅 하고 자리 잡음). 빛줄기 · 고리는 별 자리 그대로.
- **대상 「위」 그림을 보이는 앞쪽에.** 그룹 A 비공개 함수 `onBody`: 베기 초승달 · X · 별 · 오늘 「분신」 · 「초승달 베기」처럼 대상 위에 그리는 그림을 대상 몸 **안에서** 카메라 쪽으로(반지름 × 0.95까지) 밀어, 그림 가운데가 화면 y 190 근처에 오게 함. 엘리베이터면 몸 앞쪽(화면 y 147 ~ 190, 전에는 60 ~ 90 = 보스 막대 밑). 작은 적 · 아래쪽 대상은 움직이지 않음.
- 잔상 크기: `afterimage(…, scale)` 인자를 더함(기본 1 = 지금과 같은 그리기 — 클래식 그림 해시 그대로).

섀도우 드래그 「흑월 대처형진」:
- 데이터(눈대중): 베기 길이 7 → **9**, 폭 1.4 → **1.8**. 설명 글 · `docs/ult-test.md` · game-design §37-2 숫자도 고침. 시간 · 위력은 그대로.
- 분신 여섯: 몸 **1.6배** + 보랏빛 기둥(폭 0.5 · 높이 3.2) + 발밑 고리. 섀도우가 가라앉는 착지 자리(늘 빈 바닥이라 보임)에 먹물 웅덩이 + 보라 룬 고리(반경 2.4) = 「진」.
- 베기: 띠 폭 그대로의 보라 빛줄기(1.8, 높이 0.2 — 위쪽 보스에서도 막대 밑으로 안 감) + 잔상 4(1.3배) + **화면을 가로지르는 가는 빛줄**(길이의 1.15배씩 양쪽 ≈ 21칸; 남의 것 0.6배) + 초승달 베기 56 → **92px** × (1 + 0.1 · 순번, 굵게). 여섯째 흰 X 80 → 130, 열두 갈래 별 56 → 96.
- 정적(1.0 ~ 1.5초): 여섯째 베기 때 **여섯 줄 흉터**(가는 보라 빛줄, ★까지) — 땅의 낙인 줄은 큰 보스 몸에 가려서.
- 달: 반지름 60 → **92**. 높이 규칙은 초승달 꼭대기가 y 110 아래(옅은 빛무리는 보스 막대 밑으로 들어가도 됨 — 테스트도 초승달로 잼).
- ★: 오늘 「초승달 베기」와 분신 넷(1.6배) · 넓은 베기(170 → **250px**)를 대상 앞쪽에. 여섯 줄이 **화면 끝까지 흰 빛(폭 1.3)으로 터짐**. 먹 금 반경 3 → 4.5, 바닥 보라 충격파 0.6 → 6.5 + 흰 고리 4.5(앞쪽 반이 어떤 보스 밑에서도 보임).
- 예산(내 것, 시전 최고): 입자 92 · 효과 34 · 자국 2.

레인저 드래그 「매의 대일격」:
- 데이터(눈대중): 연사 띠 폭 2 → **2.6**, 관통 폭 2.2 → **3**(넓은 띠). 설명 글 등 숫자 고침.
- 연사: 화살 1.8 → **2.4**(한 발마다 × 1.06), 흰 꼬리 0.35 → 0.7, 활에 섬광(38, 세 줄 때 60 + 바람 고리), 첫 발에 레인저 발밑 **금빛 룬(반경 2.2, ★까지)** — 레인저는 늘 빈 바닥이라 보임. 대상 별은 대상 앞쪽(14 / 30 → 34 / 64).
- 포박: 화살 0.7 → **1.3**(높이 6 → 9), 대상 앞쪽 둘레 1.8칸 삼각형에 꽂힘 + 화살마다 금빛 기둥 + 전기 줄 + 조준 1.2 → 1.8 + 흰 고리.
- 저격의 숨: 레인저 위에 **빛의 매(날개 2.6)가 0.5초 맴돎**(위 끝은 보스 막대 아래, 남의 것도 흐리게).
- ★: 띠 폭 그대로 금빛 빛줄기, 매 날개 1.6 → **2.6**을 띠의 25 · 55 · 85% 대신 **레인저 → 대상 사이**의 25 · 55 · 85%에(화면에 보이는 쪽), 터널 줄은 띠 폭에 맞춤, 거대 화살 3.2 → 4.2, 대상 별 70 → 110(앞쪽), 활 둘레 충격 2.6 → 3.6, 레인저 뒤에서 솟는 금빛 매(3.2), 반동 잔상 0.7 → 1.1칸(1.2배).
- 예산: 입자 96 · 효과 30 · 자국 3.

레인저 조준 · 바드 드래그 · 크로노 드래그(같은 보스로 다시 봄):
- 레인저 조준: 표적 화살 2.2 → 2.8, 화살비 화살 0.65 → **1.0**, 꽂힌 자리 별 18 → 26, 조여 오는 흰 고리 굵게, 셋째 별 50 → 70, 매 날개 2.4 → **2.9**, 금빛 퍼덕 2 → 2.5, 하늘 화살 1.8 → **2.6**, 왕관 화살 0.5 → 0.8. 예산 90 · 29 · 1. (매 날개는 보스 막대 아래 규칙 그대로 — 패턴 팁이 뜨는 순간이면 날개 위쪽이 팁에 가릴 수 있음. 팁은 한 판에 두 번뿐이라 둠.)
- 바드 드래그: 박자마다 그 원 전체가 자홍으로 한 번 맥박, 음파 고리 굵기 8 → 10, 이퀄라이저 막대 굵기 0.22 → 0.34 · 0.5 높게, 박자 조명 기둥 0.5 → 0.7. 예산 48 · 28 · 2.
- 크로노 드래그: 착지 자리 둘레 그림이라 엘리베이터 앞에서도 크게 읽힘 — 그대로.

테스트(고치거나 더함):
- `tests/render/ult-fx-core.test.ts` 13절: 새 시험 「별 테두리는 쾅 · 머묾 · 사라짐 내내 y 185 아래(엘리베이터 높이 · 칸 바로 위 · 낮은 타격), 낮으면 크기 그대로, 높으면 줄되 120 이상」. 별 가운데 시험은 y 305 ~ 620으로. 크기를 재는 시험들은 낮은 타격(y 9)에서.
- `tests/render/ult-fx-groupA.test.ts`: 새 시험 「엘리베이터에서 섀도우 드래그의 베기 · X · 초승달과 레인저 드래그의 큰 별이 화면 y 140 이상(전 60 ~ 90) + 보스 몸 안」. 달 높이 시험은 초승달 기준.
- `tests/sim/ult-test-groupA.test.ts`: 베기 9 × 1.8.

#### 8-8-7. 검토 후 고침 (24차 검토)

독립 검토(기반 · 코어 · 그림 · 소리 · UI · 눈)에서 확인된 15건을 모두 고침. 클래식 · 원정 · 보스 레이드는 그대로(`classic-look` 해시 · `TABLES_22` · 골든 다시 녹화 없이 통과, 프로토콜 8), 「궁극기 연출 강화」 끔 = 22차, 새 소리 파일 없음. 한 줄 = 무엇 / 고침.

| id | 무엇 | 고침 |
|---|---|---|
| leak-groupA-cast-maps | 그룹 A의 시전별 기억(섀도우 드래그 베기 방향 · 줄, 레인저 조준 화살비 자리)이 지워지지 않음 — 베기 방향은 아예 안 지움, 층을 깨 시전이 중간에 끊기면 나머지도 남음, 층 바뀜 · 새 판도 안 지움 | 달이 떨어질 때 그 시전의 기억을 모두 지움, 기억마다 24개까지(가장 오래된 것부터 버림 — 그룹 B `spots`와 같은 방식), `UltFxModule`에 `reset?()`를 더해 `resetUltCore`(층 바뀜 · 새 판)가 모든 모듈의 것을 비움. 테스트: 섀도우 드래그 네 번 연달아 → 매번 끝나면 0, 레인저 조준 중간에 층 바뀜 → 0 |
| F1 (코어) | 멈춘 화면에서 적 경고를 어둠 컷 동안만 다시 그려, 컷이 끝난 뒤(멈춤 설정 150ms)나 컷이 없는 별(동작 줄이기 · 1초 안 두 번째 마무리) 아래에서 경고가 1 ~ 7프레임 가려짐 | `drawFrozen`의 다시 그리기를 살아 있는 화면과 같은 창(`ultScreenBusy()`)으로. 테스트 10절: 기록이 있는 멈춘 프레임마다 경고가 그 위에(75ms · 150ms — 150ms는 컷 뒤 멈춘 프레임도 확인) |
| F2 (코어) | 여운 비네트는 게임 시계라 마무리 멈춤만큼 늦게 끝나는데(≈ 0.83 ~ 0.86초) 기록은 0.74초에 꺼져, 마지막 5 ~ 7프레임 경고가 비네트 밑 | 마무리 멈춤 직후 `extendImpact(남은 멈춤)` → 그 기록은 0.74초 + 멈춤(`Juice.freezeLeft` 읽기 전용 추가). 테스트 4절: 비네트가 도는 마지막 프레임까지 `ultScreenBusy()`(75 · 150ms), 기록 길이 = 0.74 + 멈춤 |
| F3 (코어) | 「클래식 · 강화 끔의 멈춘 화면은 경고를 다시 안 그림」 테스트가 멈춘 프레임을 한 번도 못 봄(빈 검사) | 두 판 모두 직접 멈춤(0.12초 × 2)을 걸고 멈춘 프레임이 4개 이상인지 먼저 확인 |
| F4 (코어) | 별 가운데 테스트의 입력이 모두 경계에 걸려(하한 305로 올린 뒤) 「별이 맞는 자리에」를 안 봄 | 경계에 안 걸리는 타격 둘(y 9 → 388.4 · y 11) 추가, 빛줄기 끝뿐 아니라 별 모양 자체의 가운데도 확인 |
| F1 (그림) | 레인저 드래그 ★의 매 날개 셋 · 레인저 뒤 금빛 매가 높이 고정(1.2 · 1.4)이라 위쪽 고정 보스에서 보스 막대 밑으로(위 끝 y 54 ~ 96, 세탁기 17) | 맴도는 매와 같은 규칙(`hangWings` = `skyZ` · `skyNudge`, 꼭대기 = 폭 × 0.47). 테스트: 엘리베이터 (12, 3.5) · (12, 0) · (8, 3), 세탁기 (12, 0) — 날개 다섯 모두 위 끝 ≥ 110 |
| F6 (그림) | 퇴마사 조준 ★의 부적 고리(滅 대신, 높이 2.6)가 위쪽 고정 보스를 겨누면 전부 보스 막대 밑(y 20 ~ 88) | `talismanRing`: 뒤쪽 부적 위 끝이 y 110 아래가 되게 높이를 2.6 → 0.6까지 낮추고, 그래도 모자라면 카메라 쪽으로(룬 · 금빛 고리는 겨눈 자리 그대로). 테스트: 보스 위(12, −1.2) · (12, 1.5) · 앞(15, 5, 그대로 2.6) |
| S1 (소리) | 단계 소리의 「몇 번째」 세기가 3초 동안 남아, 「충전」으로 3초 안에 다시 쓰면 섀도우 베기 여섯 · 레인저 화살비 셋 · 연사 · 크로노 되풀이가 하나도 안 남 | 궁극기 테스트의 `ultCast`마다 그 시전자 · 그 궁극기의 세기(`hit` · 앞당김 · 길)를 지움(`forgetSteps`). 테스트 12b절: 2.3초 뒤 다시 써도 6 · 3 · 6 · 2번 |
| S2 (소리) | 매 바람 소리로 고른 `ult.ranger.tick` 파일이 거의 40Hz 아래 덩어리(DC 0.08)라 리미터를 치는 그 시전의 가장 큰 소리(−4dB), 다른 사람에게도 들림 | 레인저 조준 `skyshot` · 드래그 `pierce`의 바람을 `dash.melee`(높은 바람이 떨어지는 소리, 효과음 −14 + 4dB)로 — 화살비(−15) · ★(−10)보다 작음. 새 파일 없음. 테스트: 어느 대체 궁극기도 `ult.ranger.tick`을 안 씀 |
| S4 (소리) | 크로노 드래그 ★가 여전히 가장 큰 소리가 아님(똑딱 −4 ~ −8dB가 ★보다 8 ~ 9dB 큼, 정지 종이 ★에 겹침), 「필터가 ★를 먹먹하게 함」이라는 이유도 틀림(필터는 효과음 버스만) | 정지 종 −2 → **−8**, 되풀이 똑딱 0 → **−10**, ★ `drag.chrono.stop` 0 → **+4** → ★가 가장 큼(20ms 창 −11 ~ −12 대 똑딱 −13 ~ −14). 데이터 주석 · B12′ · 8-7 ⑪ · 8-8-3 · §37 이유를 바로잡음. 테스트: 정지 · 똑딱 < ★ |
| S5 (소리) | 「충전」에 `data-sfx`가 없어 앱 전체 클릭 소리 `ui.tap`이 늘 더해짐 — 거절이면 `ui.ult.denied` + `ui.tap`, 흐린 버튼 · 0.3초 안 두 번째도 「됐다」 소리 | 버튼은 `data-sfx=""`(소리는 `chargeMyUlt`만), 셋 다 가득(흐림)이면 `data-sfx="ui.refuse"` |
| charge-dim-press-sound (UI) | S5와 같음 | S5와 같이 고침. 테스트: `uiSoundFor` 세 경우, 브라우저 테스트에서 누르기 전 `''` · 가득 뒤 `ui.refuse` |
| charge-test-wrong-longest-name (UI) | 겹침 테스트 · 그림 도구의 「가장 긴 이름」이 레인저 조준(9자)이었음 — 진짜는 거너 드래그 「펌프 버스트 · 대구경 슬러그」(11자) | 브라우저 테스트는 30개 이름을 화면의 `.ult-name`에 넣어 재고 가장 넓은 것으로(그것이 거너 드래그인지도 확인), 그림 도구는 거너 드래그 이름으로. 8-6 · 8-8-4 고침 |
| R24-EYE-1 (눈) | 멈춘 화면에서 다시 그린 경고 중 멈춤 동안 새로 뜬 여러 칸 패턴(엘리베이터 문짝 넷)이 묶이지 않아 모든 칸이 「다음 칸」 빨강으로 1 ~ 2프레임 번쩍 | 그 다시 그리기 앞에서 `teleSeq.track`(경고 id로 기억 — 다음 살아 있는 프레임에서 다시 묶지 않음). 테스트: 멈춘 프레임에 두 칸 패턴을 띄우면 뒤 칸이 점선 |
| R24-EYE-3 (눈) | 섀도우 드래그 분신 여섯이 베기 양 끝을 번갈아 서서 위쪽 고정 보스에서는 2 ~ 3개가 화면 위 · 위쪽 HUD 뒤(발 y −14 ~ 85) | 분신 발이 y 190보다 위면 그 베기의 다른 끝(대상을 지나는 거울 자리 — 화면 아래쪽)에 서고, 그 베기는 거기서부터 달림(`cutSides`). 끝 = 베기 길이의 절반(대시 시작과 같은 자리). 테스트: 엘리베이터 세 착지에서 분신 발 ≥ 120, 베기마다 분신 자리 → 거울 자리로 |

검사 숫자는 game-design §37-4.
