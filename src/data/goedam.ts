import type {
  AppliedReward,
  GoedamAnomaly,
  GoedamEffect,
  GoedamLogEntry,
  GoedamOptionDef,
  GoedamOutcome,
  GoedamParams,
  GoedamRoomDef,
  GoedamTag,
  GoedamTraceDef,
  Rarity,
} from '../types';
import { CHARACTERS } from './characters';
import { RELICS } from './relics';
import { RARITY_LABEL, REWARDS } from './rewards';

// 기획 10차: 층 사이 괴담 방 「이상한 방」 (docs/goedam-rooms.md). 숫자는 이 파일에만 둔다 (확률, %, 흔적 기간).
// 버튼·결과 문구는 아래 숫자로 만들어서 글과 실제 효과가 어긋나지 않는다.

// ─────────────────────────── 흔적 (5장) ───────────────────────────

export const GOEDAM_TRACES: GoedamTraceDef[] = [
  { id: 'bitten_finger', name: '물린 손가락', icon: '🩹', floors: 1, mods: { atkPct: -0.15 }, banner: '물린 손가락이 욱신거린다' },
  { id: 'passenger', name: '동승자', icon: '👤', floors: 1, damageTaken: 0.12, banner: '동승자가 따라 내렸다' },
  { id: 'looked_back', name: '돌아본 자', icon: '👀', floors: 3, mods: { hpPct: -0.12 }, banner: '거울 속 눈이 따라온다' },
  { id: 'crossed_line', name: '혼선', icon: '📞', floors: 2, ultCharge: -0.3, banner: '수화기 너머 목소리가 아직 들린다' },
  { id: 'silence', name: '고요', icon: '🔕', floors: 2, ultCharge: 0.3, banner: '귓가가 고요하다' },
  { id: 'overtime_pay', name: '야근 수당', icon: '💼', floors: null, mods: { atkPct: 0.15, hpPct: -0.1 }, banner: '야근 수당이 들어왔다' },
  { id: 'stand_in', name: '대타', icon: '🕛', floors: 2, ultCharge: -0.3, banner: '누군가 대신 퇴근했다' },
  { id: 'smeared_ink', name: '번진 잉크', icon: '🖋️', floors: 2, damageTaken: 0.1, banner: '손등에 잉크가 번져 있다' },
  { id: 'red_paper', name: '빨간 휴지', icon: '🩸', floors: null, mods: { atkPct: 0.2, hpPct: -0.15 }, banner: '손이 아직 빨갛다' },
  { id: 'blue_paper', name: '파란 휴지', icon: '🧊', floors: null, damageTaken: -0.1, mods: { atkSpeedPct: -0.1 }, banner: '몸이 아직 차갑다' },
  { id: 'needle_mark', name: '주사 자국', icon: '💉', floors: 1, mods: { atkSpeedPct: -0.15 }, banner: '팔에 주사 자국이 남았다' },
  { id: 'needle', name: '주삿바늘', icon: '📍', floors: 2, mods: { atkSpeedPct: -0.12 }, banner: '주삿바늘이 아직 꽂혀 있다' },
  { id: 'clear_drip', name: '맑은 수액', icon: '💧', floors: null, mods: { hpPct: 0.08 }, banner: '맑은 수액이 돈다' },
  { id: 'murky_drip', name: '탁한 수액', icon: '🫗', floors: 3, mods: { atkSpeedPct: -0.08 }, banner: '탁한 수액이 돈다' },
  { id: 'nameless', name: '이름 없는 환자', icon: '🏷️', floors: 3, damageTaken: -0.1, banner: '아무도 당신 이름을 모른다' },
  { id: 'remembered', name: '기억된 자', icon: '👁️', floors: null, mods: { critChance: 0.1 }, damageTaken: 0.08, banner: '하늘의 눈이 당신을 기억한다' },
  { id: 'caught_lie', name: '들킨 거짓말', icon: '😷', floors: 2, damageTaken: 0.12, banner: '빨간 마스크가 뒤따른다' },
  { id: 'torn_smile', name: '찢어진 미소', icon: '✂️', floors: 3, mods: { hpPct: -0.08 }, banner: '찢어진 미소가 떠오른다' },
  { id: 'box_owner', name: '함의 주인', icon: '📦', floors: null, mods: { hpPct: -0.1 }, banner: '함의 주인이 바뀌었다' },
  { id: 'box_owner_weak', name: '함의 주인 (약)', icon: '🗝️', floors: 3, mods: { hpPct: -0.1 }, banner: '함 속의 손이 아직 잡고 있다' },
];

// ─────────────────────────── 방 12종 (4장) ───────────────────────────

const W_LOBBY: Record<Rarity, number> = { common: 70, rare: 25, epic: 5 };
const EPIC: Record<Rarity, number> = { common: 0, rare: 0, epic: 100 };
/** 저주받은 유물 for a player who already owns every relic: a reward with these odds instead. */
export const GOEDAM_RELIC_FALLBACK = EPIC;
const trace = (traceId: string): GoedamEffect => ({ kind: 'trace', traceId });
const NOTHING = '아무 일도 없었다';
/** The 지나간다 option every room ends with (bots, timeout and disconnect pick it). */
const leave = (label: string, title: string, done: string): GoedamOptionDef => ({
  id: 'leave',
  label,
  done,
  tags: ['safe'],
  outcomes: [{ id: 'leave', chance: 1, title, tone: 'neutral', effects: [] }],
});

export const GOEDAM_ROOMS: GoedamRoomDef[] = [
  // ── 로비·상가층 (2·3·4층 클리어 뒤)
  {
    id: 'broken_vending',
    name: '고장 난 자판기',
    zone: 'lobby',
    weight: 1,
    icon: '🥫',
    desc: "불 꺼진 상가 끝, 버튼이 전부 '품절'인 자판기에서 이름 없는 버튼 하나만 깜빡인다. 거스름돈 구멍에서 따뜻한 숨이 새어 나온다.",
    options: [
      {
        id: 'press',
        label: '이름 없는 버튼을 누른다',
        done: '버튼을 눌렀다',
        tags: ['gamble'],
        cost: [{ kind: 'hpLoss', pct: 0.15 }],
        outcomes: [
          { id: 'clunk', chance: 0.7, title: '덜컹! 캔이 떨어졌다', tone: 'good', effects: [{ kind: 'reward', weights: { common: 40, rare: 50, epic: 10 } }] },
          { id: 'mimic', chance: 0.3, title: '자판기 미믹이었다', tone: 'bad', effects: [{ kind: 'hpLoss', pct: 0.1 }] },
        ],
      },
      {
        id: 'coin_slot',
        label: '거스름돈 구멍에 손을 넣는다',
        done: '구멍에 손을 넣었다',
        tags: ['gamble'],
        outcomes: [
          { id: 'warm', chance: 0.5, title: '따뜻한 동전이 손에 감긴다', tone: 'good', effects: [{ kind: 'ultSet', value: 1 }, { kind: 'resetCooldowns', petsOnly: true }] },
          { id: 'bitten', chance: 0.5, title: '물렸다!', tone: 'bad', effects: [trace('bitten_finger')] },
        ],
      },
      leave('그냥 지나간다', '등 뒤에서 캔 떨어지는 소리가 난다. 돌아보지 않는다.', '그냥 지나갔다'),
    ],
  },
  {
    id: 'elevator_whisper',
    name: '엘리베이터 속삭임',
    zone: 'lobby',
    floors: { min: 3, max: 4 },
    weight: 1,
    floorWeight: { 4: 2 },
    icon: '🛗',
    desc: "계단이 잠겨 탄 엘리베이터에 없는 층 버튼 '{n}½'이 켜진다. 거울 속 당신들 뒤에 한 사람이 더 서 있다.",
    rule: '돌아보지 마. 끝까지 타.',
    options: [
      {
        id: 'ride',
        label: '속삭임대로 끝까지 탄다',
        done: '끝까지 탔다',
        tags: ['cost'],
        outcomes: [
          {
            id: 'ride',
            chance: 1,
            title: '문이 열린다. 누군가 같이 내린다',
            tone: 'good',
            effects: [{ kind: 'resetCooldowns' }, { kind: 'ultAdd', value: 0.5 }, trace('passenger')],
          },
        ],
      },
      {
        id: 'look_back',
        label: '뒤를 돌아본다',
        done: '돌아봤다',
        tags: ['gamble'],
        outcomes: [
          { id: 'empty', chance: 0.3, title: '아무도 없다, 거울에 손자국만', tone: 'good', effects: [{ kind: 'reward', weights: { common: 0, rare: 80, epic: 20 } }] },
          { id: 'eyes', chance: 0.7, title: '눈이 마주쳤다', tone: 'bad', effects: [trace('looked_back')] },
        ],
      },
      leave('다음 층에서 바로 내린다', '속삭임은 따라 내리지 않았다… 아마도.', '바로 내렸다'),
    ],
  },
  {
    id: 'ringing_phone',
    name: '울리는 공중전화',
    zone: 'lobby',
    weight: 1,
    icon: '☎️',
    desc: '아무도 없는 로비에서 공중전화가 울린다. 받으면 수화기 너머에서 내 목소리가 들린다.',
    options: [
      {
        id: 'answer',
        label: '전화를 받는다',
        done: '전화를 받았다',
        tags: ['cost'],
        outcomes: [{ id: 'answer', chance: 1, title: '수화기 너머의 내가 웃는다', tone: 'good', effects: [{ kind: 'ultSet', value: 1 }, trace('crossed_line')] }],
      },
      {
        id: 'hang_up',
        label: '수화기를 내려놓는다',
        done: '수화기를 내려놓았다',
        tags: ['cost'],
        outcomes: [{ id: 'hang_up', chance: 1, title: '로비가 고요해졌다', tone: 'neutral', effects: [{ kind: 'ultSet', value: 0 }, trace('silence')] }],
      },
      leave('전화선을 뽑는다', NOTHING, '전화선을 뽑았다'),
    ],
  },
  // ── 사무실층 (6·7·8·9층 클리어 뒤)
  {
    id: 'overtime_roster',
    name: '야근 출석부',
    zone: 'office',
    weight: 1,
    icon: '📋',
    desc: '23:59에 멈춘 경비실. 출석부의 퇴근 칸은 수십 줄째 비어 있다. 볼펜이 어느새 손에 쥐어져 있다.',
    options: [
      {
        id: 'sign_in',
        label: '출근 칸에 서명한다',
        done: '출근 칸에 서명했다',
        tags: ['cost', 'permanent'],
        outcomes: [{ id: 'sign_in', chance: 1, title: '출근 처리되었습니다', tone: 'neutral', effects: [trace('overtime_pay')] }],
      },
      {
        id: 'sign_out',
        label: '퇴근 칸에 서명한다',
        done: '퇴근 칸에 서명했다',
        tags: ['gamble'],
        outcomes: [
          { id: 'leave_early', chance: 0.5, title: '칼퇴!', tone: 'good', effects: [{ kind: 'heal', pct: 1 }, { kind: 'resetCooldowns' }] },
          { id: 'caught', chance: 0.5, title: '붙잡혔다', tone: 'bad', effects: [{ kind: 'ultSet', value: 0 }, trace('stand_in')] },
        ],
      },
      leave('펜을 내려놓는다', "등 뒤에서 경비원: '내일 또 오실 거잖아요.'", '펜을 내려놓았다'),
    ],
  },
  {
    id: 'copier',
    name: '원본을 넣어 주세요',
    zone: 'office',
    weight: 1,
    icon: '🖨️',
    desc: "빈 복사실에서 복사기가 혼자 돌며 당신 파티의 얼굴을 찍어 낸다. 마지막 장에 작게: '원본을 넣어 주세요.'",
    options: [
      {
        id: 'insert',
        label: '원본을 넣는다',
        done: '원본을 넣었다',
        tags: ['cost'],
        needs: 'copy',
        outcomes: [{ id: 'copied', chance: 1, title: '똑같은 한 장이 나왔다', tone: 'good', effects: [{ kind: 'copyReward' }, trace('smeared_ink')] }],
      },
      {
        id: 'tray',
        label: '용지함을 열어 본다',
        done: '용지함을 열었다',
        tags: ['gamble'],
        outcomes: [
          { id: 'found', chance: 0.6, title: '용지함 속에 무언가 있다', tone: 'good', effects: [{ kind: 'reward', weights: W_LOBBY }] },
          { id: 'wrapped', chance: 0.4, title: '종이가 손을 감는다', tone: 'bad', effects: [{ kind: 'hpLoss', pct: 0.2 }] },
        ],
      },
      leave('전원 코드를 뽑는다', '코드를 뽑았는데도 한 장이 더 나온다. 백지다.', '전원 코드를 뽑았다'),
    ],
  },
  {
    id: 'endless_corridor',
    name: '끝나지 않는 복도',
    zone: 'office',
    weight: 1,
    icon: '🚪',
    desc: '같은 복도를 세 번째 지나고 있다.',
    rule: '평소와 다른 점이 있으면 돌아가고, 없으면 계속 가세요.',
    options: [
      {
        id: 'walk',
        label: '계속 걸어간다',
        done: '계속 걸어갔다',
        tags: ['observe'],
        outcomes: [
          { id: 'right', when: 'normal', title: '복도 끝에 계단이 보인다', tone: 'good', effects: [{ kind: 'reward', weights: W_LOBBY }, { kind: 'ultAdd', value: 0.3 }] },
          { id: 'wrong', when: 'anomaly', title: '복도가 처음부터 다시', tone: 'bad', effects: [{ kind: 'hpLoss', pct: 0.15 }, { kind: 'ultSet', value: 0 }] },
        ],
      },
      {
        id: 'turn_back',
        label: '뒤돌아 처음으로 간다',
        done: '뒤돌아 갔다',
        tags: ['observe'],
        outcomes: [
          { id: 'right', when: 'anomaly', title: '복도 끝에 계단이 보인다', tone: 'good', effects: [{ kind: 'reward', weights: W_LOBBY }, { kind: 'ultAdd', value: 0.3 }] },
          { id: 'wrong', when: 'normal', title: '복도가 처음부터 다시', tone: 'bad', effects: [{ kind: 'hpLoss', pct: 0.15 }, { kind: 'ultSet', value: 0 }] },
        ],
      },
      leave('벽에 기대 기다린다', '발소리가 당신을 지나쳐 간다.', '벽에 기대 기다렸다'),
    ],
  },
  // ── 폐병동층 (11·12·13·14층 클리어 뒤)
  {
    id: 'red_blue_paper',
    name: '빨간 휴지, 파란 휴지',
    zone: 'ward',
    weight: 1,
    icon: '🧻',
    desc: "폐병동 화장실 맨 끝 칸. 문 너머에서 쉰 목소리가 묻는다. '빨간 휴지 줄까, 파란 휴지 줄까?'",
    rule: '아무것도 받지 마.',
    options: [
      {
        id: 'red',
        label: '빨간 휴지',
        done: '빨간 휴지를 받았다',
        tags: ['cost', 'permanent'],
        outcomes: [{ id: 'red', chance: 1, title: '손끝이 빨갛게 물든다', tone: 'neutral', effects: [trace('red_paper')] }],
      },
      {
        id: 'blue',
        label: '파란 휴지',
        done: '파란 휴지를 받았다',
        tags: ['cost', 'permanent'],
        outcomes: [{ id: 'blue', chance: 1, title: '몸이 파랗게 식는다', tone: 'neutral', effects: [trace('blue_paper')] }],
      },
      leave('아무것도 받지 않는다', '웃음소리가 뚝 그친다.', '아무것도 받지 않았다'),
    ],
  },
  {
    id: 'night_rounds',
    name: '회진 시간',
    zone: 'ward',
    weight: 1,
    icon: '🛎️',
    desc: '머리맡 호출 벨이 혼자 울리고, 복도 끝에서 바퀴 소리가 다가온다.',
    rule: '회진 중에는 누워서 눈을 감으십시오.',
    options: [
      {
        id: 'lie_down',
        label: '누워서 눈을 감는다',
        done: '누워서 눈을 감았다',
        tags: ['cost'],
        outcomes: [
          {
            id: 'rounds',
            chance: 1,
            title: '바퀴 소리가 머리맡에서 멈췄다 간다',
            tone: 'good',
            effects: [{ kind: 'heal', pct: 0.25 }, { kind: 'revive', hpFrac: 0.5 }, trace('needle_mark')],
          },
        ],
      },
      {
        id: 'peek',
        label: '실눈을 뜨고 본다',
        done: '실눈을 떴다',
        tags: ['gamble'],
        outcomes: [
          { id: 'cart', chance: 0.5, title: '약 카트를 봤다', tone: 'good', effects: [{ kind: 'resetCooldowns', petsOnly: true }, { kind: 'rewardFixed', rewardId: 'petcd_rare' }] },
          { id: 'doll', chance: 0.5, title: '간호 인형과 눈이 마주쳤다', tone: 'bad', effects: [{ kind: 'hpLoss', pct: 0.2 }, trace('needle')] },
        ],
      },
      leave('벨 줄을 뽑는다', NOTHING, '벨 줄을 뽑았다'),
    ],
  },
  {
    id: 'iv_drip',
    name: '이름이 적힌 링거',
    zone: 'ward',
    weight: 1,
    icon: '💧',
    desc: '빈 병실에서 링거액이 아직도 한 방울씩 떨어진다. 라벨에는 내 이름이 적혀 있다.',
    options: [
      {
        id: 'drip',
        label: '링거를 맞는다',
        done: '링거를 맞았다',
        tags: ['gamble'],
        outcomes: [
          { id: 'clear', chance: 0.6, title: '맑은 수액', tone: 'good', effects: [{ kind: 'heal', pct: 1 }, trace('clear_drip')] },
          { id: 'murky', chance: 0.4, title: '탁한 수액', tone: 'bad', effects: [{ kind: 'hpLoss', pct: 0.2 }, trace('murky_drip')] },
        ],
      },
      {
        id: 'erase',
        label: '라벨의 이름을 지운다',
        done: '이름을 지웠다',
        tags: ['gamble'],
        outcomes: [
          { id: 'nameless', chance: 0.5, title: '아무도 당신을 부르지 않는다', tone: 'good', effects: [trace('nameless')] },
          { id: 'other', chance: 0.5, title: '지운 자리에 다른 이름이 번진다', tone: 'bad', effects: [{ kind: 'ultSet', value: 0 }] },
        ],
      },
      leave('병실을 나간다', '치운 바늘이 내일 아침 다시 꽂혀 있을 것 같다.', '병실을 나갔다'),
    ],
  },
  // ── 옥상·이계 (16·17·18·19층 클리어 뒤)
  {
    id: 'sky_eye',
    name: '하늘의 눈',
    zone: 'rooftop',
    weight: 1,
    icon: '👁️',
    desc: '붉은 하늘 한가운데 거대한 눈꺼풀이 떨린다.',
    rule: '눈이 뜨이면 바닥만 보십시오.',
    options: [
      {
        id: 'look_up',
        label: '올려다본다',
        done: '올려다봤다',
        tags: ['cost', 'permanent'],
        outcomes: [{ id: 'seen', chance: 1, title: '눈이 당신을 기억했다', tone: 'neutral', effects: [trace('remembered')] }],
      },
      {
        id: 'shoot',
        label: '궁극기를 하늘에 쏘아 올린다',
        done: '궁극기를 쏘아 올렸다',
        tags: ['gamble'],
        cost: [{ kind: 'ultSet', value: 0 }],
        outcomes: [
          { id: 'flinch', chance: 0.5, title: '눈이 움찔한다', tone: 'good', effects: [{ kind: 'reward', weights: EPIC }] },
          { id: 'laugh', chance: 0.5, title: '눈이 웃는다', tone: 'bad', effects: [] },
        ],
      },
      leave('바닥만 본다', '그림자 하나가 발치를 천천히 지나간다.', '바닥만 봤다'),
    ],
  },
  {
    id: 'red_mask',
    name: '빨간 마스크의 질문',
    zone: 'rooftop',
    weight: 1,
    icon: '😷',
    desc: "옥상 물탱크 옆 그늘에 빨간 마스크를 쓴 여자가 서 있다. '…나, 예뻐?'",
    options: [
      {
        id: 'pretty',
        label: '「예뻐요」',
        done: "'예뻐요'라고 했다",
        tags: ['gamble'],
        outcomes: [
          { id: 'really', chance: 0.4, title: '정말?', tone: 'good', effects: [{ kind: 'reward', weights: EPIC }] },
          { id: 'unmask', chance: 0.6, title: '마스크를 내린다—', tone: 'bad', effects: [{ kind: 'hpLoss', pct: 0.3 }, trace('caught_lie')] },
        ],
      },
      {
        id: 'so_so',
        label: '「그저 그래요」',
        done: "'그저 그래요'라고 했다",
        tags: ['gamble'],
        outcomes: [
          { id: 'flustered', chance: 0.8, title: '당황해서 사라진다', tone: 'good', effects: [{ kind: 'reward', weights: { common: 100, rare: 0, epic: 0 } }] },
          { id: 'torn', chance: 0.2, title: '찢어진 미소', tone: 'bad', effects: [trace('torn_smile')] },
        ],
      },
      leave('못 본 척 지나간다', NOTHING, '못 본 척 지나갔다'),
    ],
  },
  // ── 어디서나 (6~19층, 런당 최대 1번 — 방은 런에서 다시 나오지 않는다)
  {
    id: 'cursed_relic',
    name: '저주받은 유물',
    zone: 'any',
    floors: { min: 6, max: 19 },
    weight: 0.6,
    icon: '📦',
    desc: '부적이 겹겹이 붙은 나무함 안에서, 누군가 당신이 가진 유물 이름을 하나씩 부른다.',
    rule: '열면 주인이 바뀐다.',
    options: [
      {
        id: 'open',
        label: '부적을 뜯고 연다',
        done: '부적을 뜯고 열었다',
        tags: ['cost', 'permanent'],
        outcomes: [{ id: 'opened', chance: 1, title: '함이 열렸다', tone: 'good', effects: [{ kind: 'relic' }, trace('box_owner')] }],
      },
      {
        id: 'peel_one',
        label: '부적을 한 장만 뗀다',
        done: '부적을 한 장 뗐다',
        tags: ['gamble'],
        outcomes: [
          { id: 'slides', chance: 0.5, title: '함이 스르르 열린다', tone: 'good', effects: [{ kind: 'relic' }] },
          { id: 'hand', chance: 0.5, title: '손이 먼저 나왔다', tone: 'bad', effects: [trace('box_owner_weak')] },
        ],
      },
      leave('부적을 다시 붙인다', '뒤에서 누군가 혀를 찬다.', '부적을 다시 붙였다'),
    ],
  },
];

// ─────────────────────────── Lookups ───────────────────────────

const ROOM_BY_ID = new Map(GOEDAM_ROOMS.map(r => [r.id, r]));
const TRACE_BY_ID = new Map(GOEDAM_TRACES.map(t => [t.id, t]));

export function getGoedamRoom(id: string): GoedamRoomDef {
  const r = ROOM_BY_ID.get(id);
  if (!r) throw new Error(`unknown goedam room: ${id}`);
  return r;
}

export function getGoedamTrace(id: string): GoedamTraceDef {
  const t = TRACE_BY_ID.get(id);
  if (!t) throw new Error(`unknown goedam trace: ${id}`);
  return t;
}

export function getGoedamOption(roomId: string, optionId: string): GoedamOptionDef | undefined {
  return getGoedamRoom(roomId).options.find(o => o.id === optionId);
}

/** Pick weight of a room after `floor` (0 = it cannot appear there). Zone rules only; repeats are the schedule's job. */
export function goedamRoomWeight(room: GoedamRoomDef, floor: number, theme: string): number {
  if (room.zone !== 'any' && room.zone !== theme) return 0;
  if (room.floors && (floor < room.floors.min || floor > room.floors.max)) return 0;
  return room.weight * (room.floorWeight?.[floor] ?? 1);
}

// ─────────────────────────── Text (generated from the numbers) ───────────────────────────

/** One line of an option button or result card. Button `text` stays ≤ GOEDAM_LINE_MAX characters. */
export interface GoedamLine {
  tone: 'gain' | 'cost' | 'neutral';
  /** '대체로 70%', '반반 50%', '같으면', '확정' … (null on plain gain/cost lines and continuation lines). */
  lead: string | null;
  /** Probability 0..1 for the bar behind the line; null when it is not a roll. */
  chance: number | null;
  text: string;
  /** Small print under the line (reward rarity odds, relic effect). */
  detail?: string;
}

export const GOEDAM_LINE_MAX = 24;

export interface GoedamOptionView {
  id: string;
  label: string;
  tags: GoedamTag[];
  lines: GoedamLine[];
}

export interface GoedamResultView {
  title: string;
  tone: 'good' | 'bad' | 'neutral';
  lines: GoedamLine[];
  /** 끝나지 않는 복도: what was (or was not) different. */
  note?: string;
}

const pct = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;
const signed = (v: number) => `${v < 0 ? '−' : '+'}${pct(v)}`;

/** '3½층' — the floor that should not exist (the room sits after floor n). */
export function goedamLabel(floor: number): string {
  return `${floor}½층`;
}

/** Room scene text with {n} filled in. */
export function goedamRoomDesc(room: GoedamRoomDef, floor: number): string {
  return room.desc.split('{n}').join(String(floor));
}

/** '대체로 70%' / '반반 50%' / '가끔 40%' / '드물게 30%'. */
export function goedamChanceLabel(p: number): string {
  const word = p >= 0.6 ? '대체로' : Math.abs(p - 0.5) < 1e-9 ? '반반' : p > 0.3 ? '가끔' : '드물게';
  return `${word} ${pct(p)}`;
}

/** 끝나지 않는 복도: chance that something differs when the room opens (one of GOEDAM_ANOMALIES, evenly). */
export const GOEDAM_ANOMALY_CHANCE = 0.5;
export const GOEDAM_ANOMALIES: GoedamAnomaly[] = ['clock', 'door', 'light'];
export const GOEDAM_USUAL = '형광등 4 · 문 3 · 시계 23:59';
const ANOMALY_SEEN: Record<GoedamAnomaly, string> = {
  clock: '형광등 4 · 문 3 · 시계 23:61',
  door: '형광등 4 · 문 4 · 시계 23:59',
  light: '형광등 4 (하나 거꾸로) · 문 3 · 시계 23:59',
};
const ANOMALY_NOTE: Record<GoedamAnomaly, string> = {
  clock: '시계가 23:61이었다',
  door: '문이 하나 더 있었다',
  light: '형광등 하나가 거꾸로 켜져 있었다',
};

/** 끝나지 않는 복도: the 「지금 보이는 것」 line for this player. */
export function goedamObservation(anomaly: GoedamAnomaly | null | undefined): string {
  return anomaly ? ANOMALY_SEEN[anomaly] : GOEDAM_USUAL;
}

export function goedamTraceKind(t: GoedamTraceDef): 'curse' | 'bless' | 'mixed' {
  const parts = traceParts(t);
  const good = parts.some(x => x.good);
  const bad = parts.some(x => !x.good);
  return good && bad ? 'mixed' : good ? 'bless' : 'curse';
}

/** '받는 피해 +12%' / '공격력 +15% · 최대 HP −10%'. */
export function goedamTraceEffectText(t: GoedamTraceDef): string {
  return traceParts(t).map(x => x.text).join(' · ');
}

/** '1층' / '영구'. */
export function goedamTraceDuration(floorsLeft: number | null): string {
  return floorsLeft == null ? '영구' : `${floorsLeft}층`;
}

/** Floor-start banner line: '동승자가 따라 내렸다 — 받는 피해 +12%'. */
export function goedamTraceBanner(id: string): string {
  const t = getGoedamTrace(id);
  return `${t.banner} — ${goedamTraceEffectText(t)}`;
}

/** Expiry toast: '혼선이 풀렸다'. */
export function goedamTraceExpiredText(id: string): string {
  const name = getGoedamTrace(id).name.replace(/\s*\(.*\)$/, '');
  return `${name}${hasBatchim(name) ? '이' : '가'} 풀렸다`;
}

function hasBatchim(word: string): boolean {
  const c = word.charCodeAt(word.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0;
}

interface Part {
  text: string;
  good: boolean;
  detail?: string;
}

function traceParts(t: GoedamTraceDef): Part[] {
  const out: Part[] = [];
  const m = t.mods ?? {};
  const stat = (label: string, v: number | undefined, goodWhenUp = true) => {
    if (v) out.push({ text: `${label} ${signed(v)}`, good: goodWhenUp ? v > 0 : v < 0 });
  };
  stat('공격력', m.atkPct);
  stat('최대 HP', m.hpPct);
  stat('공격 속도', m.atkSpeedPct);
  stat('이동 속도', m.moveSpeedPct);
  stat('치명타', m.critChance);
  stat('받는 피해', t.damageTaken, false);
  stat('궁극기 충전', t.ultCharge);
  return out;
}

function rarityOdds(weights: Record<Rarity, number>): string {
  const rs: Rarity[] = ['common', 'rare', 'epic'];
  return rs.filter(r => weights[r] > 0).map(r => `${RARITY_LABEL[r]} ${weights[r]}`).join(' · ') + '%';
}

function charName(defId: string | null | undefined): string {
  return CHARACTERS.find(c => c.id === defId)?.name ?? '';
}

/** '블레이드 드래그스킬 강화 (희귀)' — a reward bound to a character of `party` (null partyIndex = party-wide). */
export function goedamRewardName(r: AppliedReward, party: readonly { defId: string }[]): string {
  const def = REWARDS.find(x => x.id === r.rewardId);
  if (!def) return r.rewardId;
  const who = r.partyIndex != null ? charName(party[r.partyIndex]?.defId) : '';
  return `${def.name.split('{char}').join(who)} (${RARITY_LABEL[def.rarity]})`;
}

function rewardDescription(r: AppliedReward, party: readonly { defId: string }[]): string {
  const def = REWARDS.find(x => x.id === r.rewardId);
  const who = r.partyIndex != null ? charName(party[r.partyIndex]?.defId) : '';
  return def ? def.description.split('{char}').join(who) : '';
}

/** Parts an effect shows on a button, before anything is rolled. */
function effectParts(e: GoedamEffect, params: GoedamParams, party: readonly { defId: string }[]): Part[] {
  switch (e.kind) {
    case 'hpLoss':
      return [{ text: `HP −${pct(e.pct)}`, good: false }];
    case 'heal':
      return [{ text: e.pct >= 1 ? 'HP 가득' : `HP +${pct(e.pct)}`, good: true }];
    case 'revive':
      return [{ text: `쓰러진 캐릭터 부활`, good: true, detail: `부활 HP ${pct(e.hpFrac)}` }];
    case 'ultSet':
      return [{ text: e.value >= 1 ? '궁극기 가득' : e.value <= 0 ? '궁극기 0' : `궁극기 ${pct(e.value)}`, good: e.value >= 1 }];
    case 'ultAdd':
      return [{ text: `궁극기 +${pct(e.value)}`, good: true }];
    case 'resetCooldowns':
      return [{ text: e.petsOnly ? '펫 쿨 0' : '모든 쿨 0', good: true }];
    case 'reward': {
      const only = (['common', 'rare', 'epic'] as Rarity[]).filter(r => e.weights[r] > 0);
      if (only.length === 1) return [{ text: `${RARITY_LABEL[only[0]]} 보상 1개`, good: true }];
      return [{ text: '보상 1개', good: true, detail: rarityOdds(e.weights) }];
    }
    case 'rewardFixed': {
      const r: AppliedReward = { rewardId: e.rewardId, partyIndex: null };
      return [{ text: goedamRewardName(r, party), good: true, detail: rewardDescription(r, party) }];
    }
    case 'copyReward':
      return params.copy
        ? [{ text: `${goedamRewardName(params.copy, party)} 1장 더`, good: true, detail: rewardDescription(params.copy, party) }]
        : [{ text: '복사할 보상 없음', good: false }];
    case 'relic': {
      const relic = params.relicId ? RELICS.find(x => x.id === params.relicId) : undefined;
      if (relic) return [{ text: `유물 「${relic.name}」`, good: true, detail: relic.description }];
      return effectParts({ kind: 'reward', weights: GOEDAM_RELIC_FALLBACK }, params, party).map(p => ({ ...p, detail: '유물을 모두 가져서 대신' }));
    }
    case 'trace': {
      const t = getGoedamTrace(e.traceId);
      const dur = ` (${goedamTraceDuration(t.floors)})`;
      return traceParts(t).map(p => ({ ...p, text: p.text + dur }));
    }
  }
}

/** Join parts with ' + ' into lines of at most GOEDAM_LINE_MAX characters; only the first line carries the lead. */
function packLines(parts: Part[], tone: GoedamLine['tone'], lead: string | null, chance: number | null): GoedamLine[] {
  const lines: GoedamLine[] = [];
  for (const p of parts) {
    const last = lines[lines.length - 1];
    const joined = last ? `${last.text} + ${p.text}` : '';
    if (last && joined.length <= GOEDAM_LINE_MAX) {
      last.text = joined;
      if (p.detail) last.detail = last.detail ? `${last.detail} · ${p.detail}` : p.detail;
    } else {
      lines.push({ tone, lead: lines.length === 0 ? lead : null, chance: lines.length === 0 ? chance : null, text: p.text, ...(p.detail ? { detail: p.detail } : null) });
    }
  }
  if (lines.length === 0) lines.push({ tone, lead, chance, text: '아무 일 없음' });
  return lines;
}

const TONE: Record<'good' | 'bad' | 'neutral', GoedamLine['tone']> = { good: 'gain', bad: 'cost', neutral: 'neutral' };

/**
 * Button content of one option for one player. Sure options: '＋' gain line(s) then '−' cost line(s).
 * Rolls: one line per outcome (lead = odds, or 같으면/다르면 for the corridor), then the sure cost ('확정').
 * The 지나간다 option has no lines (just its label).
 */
export function goedamOptionView(roomId: string, optionId: string, params: GoedamParams, party: readonly { defId: string }[]): GoedamOptionView {
  const o = getGoedamOption(roomId, optionId);
  if (!o) throw new Error(`unknown goedam option: ${roomId}/${optionId}`);
  const view: GoedamOptionView = { id: o.id, label: o.label, tags: o.tags, lines: [] };
  if (o.id === 'leave') return view;
  const costParts = (o.cost ?? []).flatMap(e => effectParts(e, params, party));
  const sure = o.outcomes.length === 1 && !o.outcomes[0].when;
  if (sure) {
    const all = [...costParts, ...o.outcomes[0].effects.flatMap(e => effectParts(e, params, party))];
    const gains = all.filter(p => p.good);
    const costs = all.filter(p => !p.good);
    if (gains.length) view.lines.push(...packLines(gains, 'gain', null, null));
    if (costs.length) view.lines.push(...packLines(costs, 'cost', null, null));
    return view;
  }
  for (const out of o.outcomes) {
    const lead = out.when ? (out.when === 'normal' ? '같으면' : '다르면') : goedamChanceLabel(out.chance ?? 0);
    view.lines.push(...packLines(out.effects.flatMap(e => effectParts(e, params, party)), TONE[out.tone], lead, out.when ? null : out.chance ?? 0));
  }
  if (costParts.length) view.lines.push(...packLines(costParts, 'cost', '확정', null));
  return view;
}

/** Result card for a resolved pick: title, tone, what actually happened (rolled reward named), corridor note. */
export function goedamResultView(
  roomId: string,
  optionId: string,
  outcome: GoedamOutcome,
  params: GoedamParams,
  party: readonly { defId: string }[],
): GoedamResultView {
  const o = getGoedamOption(roomId, optionId);
  const out = o?.outcomes.find(x => x.id === outcome.id);
  const view: GoedamResultView = { title: out?.title ?? NOTHING, tone: out?.tone ?? 'neutral', lines: [] };
  if (!o || !out) return view;
  const resolved = (e: GoedamEffect): Part[] => {
    if ((e.kind === 'reward' || e.kind === 'rewardFixed' || e.kind === 'copyReward' || (e.kind === 'relic' && !outcome.relicId)) && outcome.reward) {
      return [{ text: `${goedamRewardName(outcome.reward, party)}: ${rewardDescription(outcome.reward, party)}`, good: true }];
    }
    if (e.kind === 'relic' && outcome.relicId) {
      const relic = RELICS.find(x => x.id === outcome.relicId);
      return [{ text: `유물 「${relic?.name ?? outcome.relicId}」: ${relic?.description ?? ''}`, good: true }];
    }
    if (e.kind === 'hpLoss') return [{ text: `전원 HP ${pct(e.pct)} 잃음`, good: false }];
    if (e.kind === 'trace') {
      const t = getGoedamTrace(e.traceId);
      return [{ text: `흔적 「${t.name}」 ${goedamTraceEffectText(t)} (${goedamTraceDuration(t.floors)})`, good: goedamTraceKind(t) !== 'curse' }];
    }
    return effectParts(e, params, party);
  };
  for (const e of [...(o.cost ?? []), ...out.effects]) {
    for (const p of resolved(e)) view.lines.push({ tone: p.good ? 'gain' : 'cost', lead: null, chance: null, text: p.text });
  }
  if (o.outcomes.some(x => x.when)) view.note = params.anomaly ? ANOMALY_NOTE[params.anomaly] : '평소와 같았다';
  return view;
}

/** 괴담 수첩 line: '4½층 엘리베이터 속삭임 — 돌아봤다 (돌아본 자)'. */
export function goedamLogText(e: GoedamLogEntry): string {
  const room = getGoedamRoom(e.roomId);
  const o = room.options.find(x => x.id === e.optionId);
  const traces = e.outcome.traces.map(id => getGoedamTrace(id).name);
  return `${e.label} ${room.name} — ${o?.done ?? e.optionId}${traces.length ? ` (${traces.join(', ')})` : ''}`;
}
