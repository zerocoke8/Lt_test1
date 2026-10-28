# 궁극기 테스트 모드 (기획 22차)

궁극기를 **어떻게 쓰는지**(조작)를 바꿔 보는 실험 모드. 판 자체는 **보스 레이드 그대로**(20층 · 층마다 보스 · 층 보상 · 그로기 · 「보스 고르기」 디버그). 새 궁극기 조작은 이 모드 안에서만 있고, 클래식 탑 · 원정 · 보스 레이드는 한 글자도 안 바뀜(같은 시드 = 같은 판, 테스트로 확인).

---

## 1. 모드

- 메인 화면 **네 번째 카드 「궁극기 테스트」**(보스 레이드 · 궁극기 조작 실험). 카드 아래: 내 최고 기록 + 마지막으로 고른 방식(「첫 도전 · 방식 조준」).
- 편성 화면 제목 「궁극기 테스트 편성」. 오른쪽 위에 **「궁극기 방식」 상자**(현재 / 조준 / 드래그) — 고르면 이 기기에 기억됨. 아래 캐릭터 설명의 궁극기 줄이 고른 방식의 궁극기로 바뀜(전용 설계가 아직 없으면 「(전용 조준 궁극기 준비 중) …」 + 지금 궁극기 설명).
- 기록은 **따로**(`swap-tower.ultTest.v1`) — 보스 레이드 기록과 안 섞임.
- 멀티: 보스 레이드처럼 「방 만들기」를 하면 **궁극기 테스트 방**(매칭 · 방 목록 · 방 화면에 「궁극기 테스트」 표시). 방에 들어올 때 각자 편성에서 고른 방식을 가져옴(클래식 탑을 고르고 코드로 들어온 사람은 「현재」). **봇 자리는 방장의 방식**(혼자 하기: 내 방식).
- 게임 중 바꾸기: 디버그 맨 위 **「궁극기 방식」** 단추 3개 → **모든 플레이어(봇 포함)** 의 방식이 바뀜. 멀티는 방장만. 같은 칸에 「궁극기 충전」.

## 2. 세 가지 방식

| 방식 | 궁극기 버튼 | 무엇이 나가나 |
|---|---|---|
| 현재 | 탭 | 지금 궁극기 그대로 |
| 조준 | 누른 채 끌어서 겨눔 → 떼면 발사 | 그 캐릭터의 **조준 궁극기**를 겨눈 곳에 / 겨눈 쪽으로 |
| 드래그 | 버튼을 필드로 끌어 놓음 | 필드 캐릭터가 **그 자리로 순식간에 이동**(번쩍 or 돌진, 착지 연출) → 거기서 **드래그 궁극기** |

- 조준 · 드래그에서도 **짧게 탭하면 지금 궁극기**(이동 없음).
- 끄는 동안 버튼은 「끌기!」, 위에 「조준」 / 「드래그」 표시. 손가락 위 80px 지점이 겨누는 곳(카드 끌기와 같음 — 손가락이 안 가림).

## 3. 조작 (버튼 제스처)

- 버튼을 누르고 12px 넘게 움직이면 **조준 시작** → 필드에 미리보기가 손가락을 따라옴:
  - 궁극기의 **실제 범위 · 방향**(원 · 고리 · 선 · 부채꼴 · 돌진 길) — 캐릭터 색, 아군만 받는 범위는 연두 점선.
  - 조준: 캐릭터 → 겨눈 곳 점선 + 조준점. 드래그: 이동 화살표(번쩍 = 점선, 돌진 = 실선) + 착지 자리 동그라미.
  - 'target' 부분이 노릴 적에게 테두리.
  - 손가락 옆 글자: 「놓으면 발사」 / 「놓으면 이동 · 발사」 / 「놓으면 취소」 / 「필드 위에서 놓기」.
- **취소**: 버튼 위로 다시 끌고 와서 놓기(빨간 테두리) 또는 필드 밖에서 놓기 → 아무것도 안 나가고 게이지 그대로.
- 미리보기는 게임이 실제로 쓰는 계산과 **같은 것**으로 그림(보이는 곳 = 맞는 곳).
- 멀티: 손을 떼는 순간 명령 하나가 감 — `{ type: 'ult', aim: { mode, point } }`. 서버가 방식이 맞는지(디버그로 바뀌었으면 「궁극기 방식이 바뀌었어요」), 지점이 숫자인지 확인하고, 지점은 경기장 안으로 당김. 너무 오래된 화면을 보고 겨눈 명령(2초 넘게)은 교체처럼 취소. **세 화면 모두 같은 자리에서 터짐**(서버가 한 번 계산해서 모두에게 보냄). 다른 사람 화면에는 조준점이 잠깐 보이고(0.8초), 드래그면 착지 연출.

## 4. 대체 규칙 (전용 궁극기가 아직 없는 캐릭터)

15명 모두 지금 바로 쓸 수 있게, 전용 조준 / 드래그 궁극기가 없으면 **지금 궁극기를 이렇게 바꿔서** 씀 (`src/sim/ultTest.ts`):

**조준**
- **방향형**(네모 · 부채꼴 · 선 · 돌진이 하나라도 있는 궁극기 — 지금은 블레이드 천검난무): 시전자 자리는 그대로, **방향만 겨눈 쪽으로 돌림**(첫 방향 부분 기준으로 전부 같이 돌림).
- **범위형**(나머지 14명): 시전자 주변에 터지던 부분을 **겨눈 곳으로 옮김**(오프셋 모양 그대로 — 팔라딘 창 8개, 퍼펫티어 인형 4개).
- 그대로 두는 것: **자기 강화**(버서커 광란, 워든 보호막, 크로노 쿨 감소 …)와 **아군 전체**(가디언 보호막, 클레릭 은총, 메딕 골든 아워 …).
- 대상을 노리던 부분(레인저 · 메이지 · 거너 · 섀도우): 겨눈 곳에서 **2.5칸 안의 가장 가까운 적**이 대상. 아무도 없으면 겨눈 곳 그 자리.

**드래그**
- 겨눈 곳으로 **번쩍 이동**(최대 **9칸** — 더 멀면 그 방향으로 9칸), 거기서 **지금 궁극기 그대로**. 'target' 부분은 착지 자리 2.5칸 안의 적(없으면 원래 대상).

공통: 겨눈 곳은 경기장 안으로 당김. 이동 · 시전 중 무적 0.5초, 효과는 0.45초부터(컷인 규칙 그대로). 위력은 지금 궁극기와 같음(밸런스 측정 안 함).

**봇**: 조준이면 보스(없으면 자기 대상 → 가장 가까운 적)를 겨눔, 드래그면 보스 바로 앞(자기 쪽)으로 이동. 전용 설계에 `botAim: 'ally'`면 가장 다친 아군, `'self'`면 제자리. 무작위 없음.

## 5. 데이터 구조 — 캐릭터별 설계 넣는 법

### 5-1. 파일

| 파일 | 누가 고침 | 내용 |
|---|---|---|
| `src/data/ultTest/groupA.ts` | 그룹 A | 가디언 · 팔라딘 · 워든 · 블레이드 · 버서커 · 섀도우 · 레인저 · 메이지 |
| `src/data/ultTest/groupB.ts` | 그룹 B | 거너 · 클레릭 · 메딕 · 퇴마사 · 바드 · 크로노 · 퍼펫티어 |
| `src/render/ultTest/groupA.ts` / `groupB.ts` | 각 그룹 | 추가 연출(필요할 때만) |
| `src/data/ultTest/types.ts` | 코어 | 모양 · 규칙 숫자(`ULT_TEST`) |
| `src/data/ultTest/index.ts` · `src/sim/ultTest.ts` · `src/render/ultTest/{index,core,preview}.ts` | 코어 | 등록 · 계산 · 그리기 |

### 5-2. 모양

캐릭터 하나 = `{ aim?: 조준 궁극기, drag?: 드래그 궁극기 }`. 각 궁극기는 **지금 궁극기(`CharacterDef.ult`)와 똑같은 모양**(id · name · slot 'ult' · description · castTime · actions)에 세 가지를 더할 수 있음:

- `move` (드래그만): `{ kind: 'dash' | 'blink', maxRange: 칸, path?: { width, affects, effects, delay?, stage? } }` — 이동 방법 · 최대 거리 · 지나간 길에 맞는 공격(선택). 없으면 번쩍 9칸.
- `aimRange` (조준만): 겨눌 수 있는 최대 거리(없으면 어디든).
- `botAim`: 봇이 겨누는 곳 `'enemy'`(기본) · `'ally'` · `'self'`.

액션이 겨눈 곳을 읽는 법:

- `center: 'point'` = **겨눈 곳**(조준) / **착지 자리**(드래그).
- `center: 'self'` = 시전자(드래그는 이미 착지한 자리).
- `center: 'target'` = 겨눈 곳 · 착지 자리에서 2.5칸 안의 가장 가까운 적.
- `rel: 'aim'` = 이 부분의 오프셋 · 네모 / 부채꼴 방향 · 돌진 방향을 **「오른쪽(+x)을 겨눈다」고 치고** 쓰면, 실제 겨눈 쪽으로 돌려서 씀. 조준 = 캐릭터 → 겨눈 곳, 드래그 = 이동한 방향.
- 나머지(delay · hits · zone · summon · dash · charge · follow · stage …)는 다른 스킬과 똑같이 동작.

규칙: 효과는 `delay: 0.45` 이상(컷인), `castTime: ULT_CAST_TIME`(0.5). id는 `<캐릭터>_ua`(조준) · `<캐릭터>_ud`(드래그). `stage` 이름을 지금 궁극기와 같게 쓰면 그 단계의 소리 · 연출이 그대로 나옴(새 이름은 기본 소리 · 기본 착지 연출).

### 5-3. 예시

```ts
import type { UltAltSet } from './types';
import { ULT_CAST_TIME } from './types';

export const GROUP_A: Record<string, UltAltSet> = {
  // 범위형 조준: 겨눈 곳에 운석
  mage: {
    aim: {
      id: 'mage_ua', name: '유성 낙하', slot: 'ult', castTime: ULT_CAST_TIME,
      description: '겨눈 곳 반경 3.5에 0.8초 뒤 공격력 400% 피해 + 1초 기절.',
      actions: [
        { stage: 'meteor', center: 'point', delay: 0.8, area: { shape: 'circle', radius: 3.5 }, affects: 'enemies',
          effects: [{ kind: 'damage', amount: 4 }, { kind: 'status', status: 'stun', duration: 1, value: 0 }] },
      ],
    },
  },
  // 돌진형 드래그: 끌어 놓은 곳까지 돌진하며 길을 베고, 착지해서 앞쪽(이동 방향)으로 일섬
  blade: {
    drag: {
      id: 'blade_ud', name: '질풍 일섬', slot: 'ult', castTime: ULT_CAST_TIME,
      description: '끌어 놓은 곳까지 돌진(최대 8칸)하며 지나간 길에 공격력 200% 피해, 착지해서 앞으로 일섬(길이 7) 공격력 300% 피해.',
      move: { kind: 'dash', maxRange: 8, path: { width: 2, affects: 'enemies', effects: [{ kind: 'damage', amount: 2 }] } },
      actions: [
        { stage: 'issen', rel: 'aim', center: 'self', delay: 0.6,
          area: { shape: 'rect', dir: 'right', anchor: 'start', length: 7, width: 2.5 }, affects: 'enemies',
          effects: [{ kind: 'damage', amount: 3 }] },
      ],
    },
  },
};

export const GROUP_B: Record<string, UltAltSet> = {
  // 자기 강화 + 아군 회복 구역: 겨눈 곳에 치유의 성역 (봇은 가장 다친 아군에)
  cleric: {
    aim: {
      id: 'cleric_ua', name: '성역', slot: 'ult', castTime: ULT_CAST_TIME, botAim: 'ally',
      description: '자신 6초간 방어 +20%. 겨눈 곳 반경 3에 5초간 0.5초마다 아군 HP 4% 회복.',
      actions: [
        { stage: 'grace', center: 'self', delay: 0.45, area: { shape: 'single' }, affects: 'self',
          effects: [{ kind: 'status', status: 'defUp', duration: 6, value: 0.2 }] },
        { stage: 'halo', center: 'point', delay: 0.45, area: { shape: 'circle', radius: 3 }, affects: 'allies',
          effects: [{ kind: 'heal', amount: 0.04 }], zone: { duration: 5, tickInterval: 0.5 } },
      ],
    },
  },
};
```

### 5-4. 추가 연출 (필요할 때만)

```ts
// src/render/ultTest/groupA.ts
import { registerUltFx } from './index';
registerUltFx({
  onEvent(ev, view) {
    if (ev.type === 'skillStage' && ev.skillId === 'mage_ua' && ev.stage === 'meteor' && ev.hit === 0) {
      view.host.ring(ev.center.x, ev.center.y, 0.3, 4, 0.5, '#9ad8ff', 4, 0.1);
    }
  },
});
```
`view.host`에 `ring` · `burst` · `flash` · `shake`. `draw(ctx, state, view, now)`로 매 프레임 바닥에 그려도 됨(`view.cam`으로 화면 좌표). 궁극기 테스트가 아닐 때는 불리지 않음.

### 5-5. 한 캐릭터 시험하기

- 주소: `/?mode=ultTest&ult=aim&chars=mage,guardian,cleric&boss=washer_drum` — 궁극기 테스트 · 조준 · 그 파티(첫 번째가 필드)로 혼자 하기, 1층 보스 지정(첫 판만). `ult=drag` / `now`.
- 게임 중: 디버그 「궁극기 방식」 → 방식 바꾸기, 「궁극기 충전」 → 바로 써 보기. 「보스 고르기」로 보스 바꾸기.
- 테스트: `tests/sim/ult-test.test.ts`의 「content split …」가 등록된 데이터 모양을 확인. 시뮬에서 한 캐릭터: `makeGame({ mode: 'ultTest', players: [{ ...HUMAN, characters: ['mage', …], ultMode: 'aim' }], bossRaid: { onlyBoss: 'elevator_keeper', hpMult: 50 } })` → `dispatch({ type: 'debug', action: { kind: 'chargeUlt' } })` → `dispatch({ type: 'ult', player: 0, aim: { mode: 'aim', point: { x: 6, y: 8 } } })` → 'skillCast' 이벤트의 center 확인.

## 6. 코드 지도 (코어)

- 시뮬: `src/sim/ultTest.ts`(계획 `planUlt` · 대체 규칙 `aimFallback` · `rel: 'aim'` 돌리기 `turnAimParts` · 미리보기 `ultPreviewParts` · 봇 `botUltAim` — 모두 순수 함수), `src/sim/players.ts useUlt`(이동 · 시전), `src/sim/game.ts`(모드 · 디버그 'ultMode').
- 화면: `src/ui/ultAim.ts`(버튼 제스처), `src/ui/hud.ts`(방식 표시 · 이름), `src/ui/preset.ts`(「궁극기 방식」), `src/ui/debug.ts`, `src/ui/mainMenu.ts`, `src/ui/ultTest.css`, `src/render/ultTest/`.
- 통신: 프로토콜 **8** — `createRoom.mode 'ultTest'`, `PresetChoice.ultMode`, ult 명령의 `aim`, 디버그 'ultMode', `PlayerState.ultMode`, `ultCast.aim`.
- 테스트: `tests/sim/ult-test.test.ts`, `tests/net/ult-test.test.ts`, `tests/ui/ult-test-ui.test.ts`, `tests/render/ult-test-render.test.ts`, `tests/e2e/ult-test.spec.ts`(혼자, 실제 손가락 제스처), `tests/e2e/multi-ult-test.spec.ts`(폰 3대).
