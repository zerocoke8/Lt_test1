# 궁극기 연출 강화 (기획 23차)

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
6. **마무리 순간**: 0.13초 멈춤 + 화면 번쩍 + 5% 확대 + 큰 흔들림 + 한자 한 글자(城 · 斬 · 凍 · 滅 …)가 화면에 쾅. 이어서 여진 흔들림과 불씨.
7. **여운**: 바닥에 3초쯤 자국(금 간 바닥 · 베인 자국 · 서리 · 먹물 · 꽃잎 · 문양). 적의 경고처럼 보이지 않게 아주 옅게(빨강 금지).
8. **캐릭터 그림**: 오늘 궁극기의 전용 그림(떨어지는 방패 · 철창 · 초승달 · 종 · 滅 글자 …)을 30개에도 쓰고, 캐릭터마다 새 그림을 더함.
9. **설계도 바꾼 것 15개**: 늦거나 한 방이 없던 것. 메이지 조준 4.85초 → 2.45초, 클레릭 드래그 종 4.5초 → 2초, 퇴마사 · 퍼펫티어 3~3.5초 → 2초 안팎, 메딕 · 크로노 조준에 마무리 추가 등(3장).
10. **소리**: 새 파일 없음. 지금 소리(456개)를 겹치고 이어 붙임 — 돌진 · 순간이동 소리, 착지 쿵, 마무리 직전 다른 소리를 잠깐 줄였다가 쾅.
11. **다른 사람 · 봇의 궁극기**는 지금처럼 흐리게(멈춤 · 흔들림 · 확대 · 큰 글자 없음). 클래식 · 원정 · 보스 레이드는 그대로.
12. 일시정지 설정 줄에 **「궁극기 연출 강화 (궁극기 테스트)」** 켜기/끄기 — 끄면 22차 연출로 비교 가능(기본: 켬).

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
| 큰 글자 | 마무리에 한자 한 글자 150px, 0.35초 머묾 | 땅 위 작은 글자 60px, 흐리게 |
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
| **t** | 어둠 끊김 → 화면 번쩍 0.42 + 멈춤 0.13초 + 흔들림 12 + 5% 확대 + 방사 속도선 28 + 범위 번쩍 1.0 + 흰 별 70px + 고리 3겹(캐릭터 색 0.5R→1.0R 굵게 · 흰 0.3R→1.15R · 가는 흰 0.8R→1.35R) + 빛기둥(폭 1.1, 높이 9) + 맞은 적마다 별 · 불꽃(최대 10) + 불꽃 40 · 파편 10 + 큰 글자 + 바닥 자국. **멈춘 첫 화면에 이미 다 보여야 함**(나이 0에서 꽉 찬 모습) |
| t + 0.12초 (멈춤 뒤) | 여진 흔들림 4 (0.6초) + 가장자리 비네트 0.4 (0.6초) |
| t + 0.2 ~ 2.0초 | 불씨 14개가 천천히 떠오름 |

**큰 글자**: 공격 자리 화면 위치에서 70px 위(가로 90~1190, 세로 170~460 안으로), 150px 굵게, 캐릭터 화면색 + 10px 어두운 테두리, 0.05초 흰 속빛. 1.9배 → 1배로 0.09초에 쾅(원 + 먹물 방울 6개) → 0.35초 머묾 → 0.3초 동안 12px 떠오르며 사라짐. 실제 시계로 움직임(멈춤 중에도 쾅).

**캐릭터 표** (`theme.ts` 기본값; 궁극기별로 바꿀 수 있음):

| 캐릭터 | 글자 | 화면색 | 비네트 색 · 세기 | 불꽃 | 바닥 자국 · 색 |
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

(한자는 지금도 퇴마사 滅 · 印에 쓰는 것처럼 기기 글꼴로 그려짐. 아군만 회복하는 마무리가 생기면 「축복」 판: 멈춤 · 흔들림 없이 번쩍 0.28, 확대 2%, 아군 빛기둥(최대 6) + 가루 20 + 문양 자국 — 지금 30개에는 없음.)

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

#### A12. 섀도우 드래그 「그림자 대처형진」 — 연출만 (이름 바꿈) · finale `moon`

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0~0.18 | 이동(순간이동 9) | 공통 + 착지점 먹물 웅덩이 | (착지 흔들만) | `mon.blink` |
| 0.45~0.69 | `clone` ×4 첫 타 → 쌓기 | 오늘 드래그 「분신」(점점 커짐) | 첫 분신 **멈춤 .04** · 흔들 4, 나머지 흔들 1.5 | 행 `drag.shadow.clone` |
| 0.75 | `vanish` 지원 | 오늘 「사라짐」 + 미끄러진 길에 잔상 3 | — | 행 (없음) |
| 1.0 | `execute` 쌓기 | 오늘 드래그 「처형」(X 낙인 + 조이는 고리 → X 베기) | 흔들 6 · 범위 .9 | 행 `drag.shadow.execute` |
| 1.5 | `moon` ★ | 대상 위 초승달 → 초승달 베기 | ★ (影) | 행 `ult.shadow.moon` |

데이터: 분신 4개 `dance` → `clone`, X 십자 `dance` → `execute`. `finale: 'moon'`.

구현: look move = alias PREP `shadow_d:clone` (the ink pool) at the landing · `clone` alias `shadow_d:clone` (`seqAsHit`) · impact `(s) => s.seq === 0 ? { stop: 40, shake: 4 } : { shake: 1.5 }` · `vanish` alias `shadow_u:vanish` + 3 afterimages along the slide · `execute` alias `shadow_d:execute` (prep + land) · impact `{ shake: 6, flash: 0.9 }` · `moon` alias `shadow_u:moon` · finisher `{ glyph: '影' }` · motif `reticle`.

#### A13. 레인저 조준 「매의 화살비」 — 연출만 · finale `skyshot`

| 시각 | 박자 | 그림 | 손맛 | 소리 |
|---|---|---|---|---|
| 0.5~1.38 | `barrage` ×12 첫 타 → 쌓기 | 레인저→겨눈 곳 가는 조준선(0.45초) + 활에 빛 → 화살이 반경 2.5 안 아무 곳에 꽂힘, 3번째마다 흙먼지 | 흔들 1 · 범위 .3 (마지막만), 나머지 흔들 0.8 | 행 `ult.ranger.barrage` |
| 1.6~2.0 | `rain` ×5 쌓기 | 오늘 「화살비」(하늘로 쏘아 올림 → 쏟아짐) | 흔들 2 · 범위 .4 | 행 `ult.ranger.rain` |
| 2.3 | `skyshot` ★ | 조준 표시 + 금빛 기둥 + 떨어지는 큰 화살(오늘 그림) → 오늘 「하늘 화살」 + 그을림(1.2) | ★ (穿) | 행 `ult.ranger.skyshot` |

구현: `barrage` prep aimLine(caster→point, #c9ffe9, w 0.8, 0.45 s) + star on the bow · land `runStory('ranger_u:barrage', 'land', …, { x, y } = randomIn(s))` + every 3rd hit Smoke puff · impact `(s) => s.hit === s.hits - 1 ? { shake: 1, flash: 0.3 } : { shake: 0.8 }` · `rain` alias `ranger_u:rain` · impact `{ shake: 2, flash: 0.4 }` · `skyshot` alias `ranger_u:skyshot` + scorchFx(r 1.2) · charge `{ vignetteColor: '#000000', vignette: 0.35 }` · finisher `{ glyph: '穿' }` · motif `reticle` (rain, skyshot). `finale: 'skyshot'`.

#### A14. 레인저 드래그 「매의 대일격」 — 연출만 (이름 바꿈) · finale `pierce`

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

#### B10. 바드 드래그 「공명 삼중주 · 피날레」 — 연출만 (이름 바꿈) · finale `forte`

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

#### B12. 크로노 드래그 「시간 균열 · 영겁의 역행」 — 연출만 (이름 바꿈) · finale `stop`

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
  glyph: string | null; glyphPx: number;                 // null = no stamp ('' = theme glyph)
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
- `core.ts`: `ultLockRadius(b, …)` (the lock-on / 조준 hole size), `ultScreenBusy()` (my glyph or speed lines are up → enemy warnings are drawn again over them).
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
    finisher: { glyph: '城' },                                       // the rest (stop, shake, flash, zoom, decal) = FINISH_STRIKE + theme
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
- **Hanja glyph fonts** on the designer's phone (system CJK fallback): check on the phone sheet.
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
