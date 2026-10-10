import type { RewardFamilyDef } from '../../types';
import { PREF_DEALER, pct } from './base';

// 기획 17차 Track C — 규칙 변경·성장 + 저주·도박 + 협동 + 경제 (docs/floor-rewards.md). Behaviour: src/sim/rewards/rules.ts.
// 27 families. Numbers live in params per rarity (the sim reads them with query.rewardParam); 「두 번」 = power / %
// added, counts / radius the larger one, unless the family says otherwise. Run counters live in
// PlayerState.rewardState (whitelisted keys only: nails, candlesKills, candlesBonus, debt, boxBump, greedyPicks,
// greedySkip, understudyLeft, punchInLeft); internal cooldowns and stacks in p.rt.reward.

/** 자라는 손톱: the attack bonus stops here (percent points). */
export const NAILS_MAX = 30;
/** 백 개의 촛불: team kills per step and the crit cap (percent points). */
export const CANDLES_KILLS = 40;
export const CANDLES_MAX = 10;
/** 이중 장전: charges a card holds. */
export const DOUBLE_LOAD_CHARGES = 2;
/** 빈자리의 대타: uses per floor when taken twice. */
export const UNDERSTUDY_TWICE = 3;
/** 창문 너머 지원사격: seconds between volleys. */
export const WINDOW_FIRE_EVERY = 5;
/** 빚쟁이의 방문: normal reward screens skipped. */
export const DEBT_SKIPS = 2;

/** Fixed numbers of the families (the card text shows them). */
export const RULES_NUM = {
  coin: { chance: 0.5, heads: 1.8, tails: 0.5 },
  deadline: { timeLeft: 40, bossHp: 0.5 },
  teamRelay: { window: 2, icd: 8 },
  jointRite: { window: 1.5, range: 3, radius: 2.5, icd: 6 },
  threeIncense: { window: 5, stun: 1.5, vuln: 0.2, vulnDur: 4, groggy: 0.25 },
  redThread: { icd: 6, dur: 3 },
  standIn: { dur: 4, taunt: 3, tauntRadius: 4 },
  helpingHand: { range: 3, icd: 10 },
  bloodOath: { range: 3, lowHp: 0.3, icd: 10 },
} as const;

const AUTO = 1;
const POSITIONAL = 0.6;
const CURSE = 0.5;

const who = (ctx: { char?: string }) => ctx.char ?? '{char}';
const sec = (v: number) => `${v}초`;

export const RULES_FAMILIES: RewardFamilyDef[] = [
  // ─────────── 규칙 변경·성장 ───────────
  {
    key: 'double_load',
    name: '{char} 이중 장전',
    tags: ['swap', 'growth'],
    target: 'member',
    prefRoles: PREF_DEALER,
    unique: true,
    botWeight: AUTO,
    params: { legendary: { charges: DOUBLE_LOAD_CHARGES, cdPct: 0.1 } }, // 기획 17차 밸런스: +30 % → +10 %
    describe: (v, c) => `${who(c)} 카드에 충전 ${v.charges}칸: 충전이 있으면 쿨 중에도 바로 등장, 쿨이 다 돌면 1칸 참`,
    cost: v => `대가: 그 캐릭터 재등장 쿨 +${pct(v.cdPct)}`,
  },
  {
    key: 'understudy',
    name: '빈자리의 대타',
    tags: ['swap', 'survive'],
    target: 'party',
    // 기획 17차 밸런스 (balance.md 17-3): the stand-in lands where its mate just fell, often into the same attack — it
    // measured −9 % output, so bots (and the reward timeout) rarely take it: 1.0 → 0.3
    botWeight: 0.3,
    params: { rare: { uses: 2 } },
    describe: v => `필드 캐릭터가 쓰러지면 쿨이 가장 짧은 대기 카드가 그 자리에 바로 등장 (층마다 ${v.uses}번, 두 번 고르면 ${UNDERSTUDY_TWICE}번)`,
  },
  {
    key: 'punch_in',
    name: '출근 도장',
    tags: ['swap'],
    target: 'party',
    botWeight: AUTO,
    params: { common: { swaps: 2 }, rare: { swaps: 3 } },
    describe: v => `층(단계)마다 처음 ${v.swaps}번의 교체는 나간 캐릭터에 재등장 쿨이 안 걸림`,
  },
  {
    key: 'window_fire',
    name: '창문 너머 지원사격',
    tags: ['swap'],
    target: 'party',
    botWeight: AUTO,
    params: { rare: { power: 0.3 }, epic: { power: 0.45 } },
    describe: v => `${WINDOW_FIRE_EVERY}초마다 살아 있는 대기 카드 1장당 가장 가까운 적에게 사격 (그 카드 공격력 ${pct(v.power)})`,
  },
  {
    key: 'nails',
    name: '자라는 손톱',
    tags: ['growth'],
    target: 'party',
    botWeight: AUTO,
    params: { rare: { pct: 2 }, epic: { pct: 3 } },
    describe: v => `고른 뒤 층(단계) 시작마다 공격력 +${v.pct}% (최대 +${NAILS_MAX}%)`,
  },
  {
    key: 'candles',
    name: '백 개의 촛불',
    tags: ['growth'],
    target: 'party',
    botWeight: AUTO,
    params: { rare: { kills: CANDLES_KILLS, pct: 1 } },
    describe: v => `고른 뒤 팀이 적 ${v.kills}마리를 쓰러뜨릴 때마다 치명타 확률 +${v.pct}% (런 끝까지, 최대 +${CANDLES_MAX}%)`,
  },
  // ─────────── 괴담 저주·도박 ───────────
  {
    key: 'blood_contract',
    name: '피 묻은 계약서',
    tags: ['curse', 'attack'],
    target: 'party',
    flag: 'curse',
    unique: true,
    botWeight: CURSE,
    params: { epic: { atk: 0.3, stageHp: 0.8 } },
    describe: v => `내 캐릭터 전원 공격력 +${pct(v.atk)}`,
    cost: v => `대가: 층 사이 회복 없음 (원정: 단계 시작 HP ${pct(v.stageHp)})`,
    legacyEffect: v => ({ kind: 'stat', mods: { atkPct: v.atk } }),
  },
  {
    key: 'coin',
    name: '동전 던지기',
    tags: ['curse'],
    target: 'party',
    flag: 'curse',
    unique: true,
    botWeight: CURSE,
    params: { common: { heads: RULES_NUM.coin.heads, tails: RULES_NUM.coin.tails } },
    describe: v => `드래그마다 동전: 앞면이면 드래그 피해 ×${v.heads}`,
    cost: v => `대가: 뒷면이면 드래그 피해 ×${v.tails}`,
  },
  {
    key: 'haste_cost',
    name: '서두르는 대가',
    tags: ['curse', 'swap'],
    target: 'party',
    flag: 'curse',
    botWeight: CURSE,
    params: { rare: { cd: 0.25, hp: 0.08 } },
    describe: v => `재등장 쿨 −${pct(v.cd)} (최소 4초)`,
    cost: v => `대가: 나갈 때 그 캐릭터 HP −최대 HP ${pct(v.hp)} (대기석 회복이 있으면 2배)`,
  },
  {
    key: 'blood_entry',
    name: '피의 등장',
    tags: ['curse', 'appear'],
    target: 'party',
    flag: 'curse',
    botWeight: CURSE,
    params: { rare: { drag: 0.3, hp: 0.1 } },
    describe: v => `등장 드래그스킬 피해·회복 +${pct(v.drag)}`,
    cost: v => `대가: 등장할 때 최대 HP ${pct(v.hp)} 소모 (대기석 회복이 있으면 2배)`,
  },
  {
    key: 'ledge',
    name: '옥상 난간 위',
    tags: ['curse', 'attack'],
    target: 'party',
    flag: 'curse',
    botWeight: CURSE,
    params: { rare: { low: 0.5, lowAtk: 0.2, edge: 0.25, edgeAtk: 0.45, edgeCrit: 0.15 } },
    describe: v => `필드 캐릭터 HP ${pct(v.low)} 이하 공격력 +${pct(v.lowAtk)}, ${pct(v.edge)} 이하 공격력 +${pct(v.edgeAtk)}·치명타 +${pct(v.edgeCrit)}`,
  },
  {
    key: 'hungry_pet',
    name: '굶주린 펫',
    tags: ['curse', 'pet'],
    target: 'party',
    flag: 'curse',
    botWeight: CURSE,
    params: { rare: { power: 0.6, hp: 0.06 } },
    describe: v => `펫 효과 +${pct(v.power)}`,
    cost: v => `대가: 펫을 쓸 때 필드 캐릭터 HP −최대 HP ${pct(v.hp)}`,
  },
  {
    key: 'soul_loan',
    name: '영혼 담보 대출',
    tags: ['curse', 'ult'],
    target: 'party',
    flag: 'curse',
    botWeight: CURSE,
    params: { epic: { power: 0.6, charge: 0.2, hp: 0.2 } },
    describe: v => `궁극기 피해·회복 +${pct(v.power)}, 궁 게이지 충전 +${pct(v.charge)}`,
    cost: v => `대가: 궁극기를 쓸 때 필드 캐릭터 현재 HP ${pct(v.hp)} 소모`,
  },
  {
    key: 'red_moon',
    name: '붉은 달',
    tags: ['curse', 'boss'],
    target: 'party',
    flag: 'curse',
    unique: true,
    botWeight: CURSE,
    params: { epic: { enraged: 0.4, groggy: 1.5, taken: 0.15 } },
    describe: v => `보스층(보스 단계): 광폭화한 보스에게 피해 +${pct(v.enraged)}, 내 그로기 점수 ×${v.groggy}`,
    cost: v => `대가: 보스층에서 내 캐릭터가 받는 피해 +${pct(v.taken)}`,
  },
  {
    key: 'deadline',
    name: '마감 직전',
    tags: ['boss', 'swap'],
    target: 'party',
    botWeight: AUTO,
    params: { rare: { aspd: 0.3, cd: 0.3 } },
    describe: v =>
      `남은 시간 ${RULES_NUM.deadline.timeLeft}초 이하·보스 광폭화·HP ${pct(RULES_NUM.deadline.bossHp)} 이하 보스와 싸우는 중: 공격 속도 +${pct(v.aspd)}, 그동안 거는 재등장 쿨 −${pct(v.cd)} (최소 4초)`,
  },
  {
    key: 'last_one',
    name: '최후의 1인',
    tags: ['curse', 'coop'],
    target: 'party',
    flag: 'curse',
    botWeight: CURSE,
    params: { rare: { atk: 0.5, guard: 0.2, perOut: 0.15 } },
    describe: v => `살아 있는 내 캐릭터가 1명이면 공격력 +${pct(v.atk)}, 받는 피해 −${pct(v.guard)}, 탈락한 다른 플레이어 1명당 공격력 +${pct(v.perOut)}`,
  },
  {
    key: 'box_in_box',
    name: '상자 속 상자',
    tags: ['curse'],
    target: 'self',
    flag: 'economy',
    botWeight: 0,
    params: { common: { bump: 1 } },
    describe: () => '다음 보상 화면의 카드 등급이 한 단계 올라감 (영웅은 그대로)',
    cost: () => '대가: 지금은 아무것도 없음',
  },
  {
    key: 'debt',
    name: '빚쟁이의 방문',
    tags: ['curse'],
    target: 'self',
    flag: 'economy',
    botWeight: 0,
    params: { rare: { skips: DEBT_SKIPS } },
    describe: () => '영웅 보상 1개를 바로 받음',
    cost: v => `대가: 다음 ${v.skips}번의 층 보상 화면을 건너뜀 (유물 화면은 그대로)`,
  },
  {
    key: 'greedy',
    name: '욕심쟁이 계약서',
    tags: ['curse'],
    target: 'self',
    flag: 'economy',
    botWeight: 0,
    params: { rare: { count: 4, picks: 2 } },
    describe: v => `다음 보상 화면에 카드 ${v.count}장, ${v.picks}장을 고름`,
    cost: () => '대가: 이번 보상은 이 계약서뿐',
  },
  // ─────────── 멀티 협동 (봇도 「다른 플레이어」, 탈락한 플레이어는 빼고) ───────────
  {
    key: 'team_relay',
    name: '팀 릴레이',
    tags: ['coop', 'swap'],
    target: 'party',
    flag: 'coop',
    botWeight: AUTO,
    params: { rare: { drag: 0.25, radius: 0.2, ult: 0.05 } },
    describe: v =>
      `다른 플레이어가 교체한 뒤 ${sec(RULES_NUM.teamRelay.window)} 안에 내가 교체: 두 플레이어 모두 다음 드래그 +${pct(v.drag)}·범위 +${pct(v.radius)}, 필드 캐릭터 궁 +${pct(v.ult)} (${sec(RULES_NUM.teamRelay.icd)}에 1번)`,
  },
  {
    key: 'joint_rite',
    name: '합동 의식',
    tags: ['coop'],
    target: 'party',
    flag: 'coop',
    botWeight: POSITIONAL,
    params: { rare: { power: 2.5, groggy: 0.05 } },
    describe: v =>
      `${RULES_NUM.jointRite.window}초 안에 다른 플레이어가 내 착지점 반경 ${RULES_NUM.jointRite.range} 안에 착지: 가운데 반경 ${RULES_NUM.jointRite.radius} 폭발 (공격력 ${pct(v.power)}) + 보스 그로기 +${pct(v.groggy)} (${sec(RULES_NUM.jointRite.icd)}에 1번)`,
  },
  {
    key: 'three_incense',
    name: '삼인 분향',
    tags: ['coop'],
    target: 'party',
    flag: 'coop',
    unique: true,
    botWeight: AUTO,
    params: { legendary: { stun: RULES_NUM.threeIncense.stun, vuln: RULES_NUM.threeIncense.vuln, groggy: RULES_NUM.threeIncense.groggy } },
    describe: v =>
      `${RULES_NUM.threeIncense.window}초 안에 모든 플레이어가 연달아 교체: 모든 적 ${v.stun}초 기절(보스 제외) + 받는 피해 +${pct(v.vuln)} ${RULES_NUM.threeIncense.vulnDur}초 + 보스 그로기 +${pct(v.groggy)} (층마다 1번)`,
  },
  {
    key: 'red_thread',
    name: '빨간 실',
    tags: ['coop', 'survive'],
    target: 'party',
    flag: 'coop',
    botWeight: AUTO,
    params: { common: { shield: 0.08, tankShield: 0.12 } },
    describe: v =>
      `다른 플레이어가 등장하면 내 필드 캐릭터 보호막 최대 HP ${pct(v.shield)} (탱커 ${pct(v.tankShield)}) ${sec(RULES_NUM.redThread.dur)} (${sec(RULES_NUM.redThread.icd)}에 1번)`,
  },
  {
    key: 'stand_in',
    name: '대신 맞아 줄게',
    tags: ['coop', 'survive'],
    target: 'party',
    flag: 'coop',
    requires: 'tank',
    botWeight: AUTO,
    params: { rare: { shield: 0.15 } },
    describe: v =>
      `내 탱커가 등장하면 다른 플레이어 필드 캐릭터 전원 보호막 최대 HP ${pct(v.shield)} ${sec(RULES_NUM.standIn.dur)} + 반경 ${RULES_NUM.standIn.tauntRadius} 적 ${sec(RULES_NUM.standIn.taunt)} 도발`,
  },
  {
    key: 'helping_hand',
    name: '손 내밀기',
    tags: ['coop', 'survive'],
    target: 'party',
    flag: 'coop',
    botWeight: POSITIONAL,
    params: { rare: { cut: 0.5, hp: 0.5 } },
    describe: v =>
      `다른 플레이어 필드 캐릭터 반경 ${RULES_NUM.helpingHand.range} 안에 착지: 그 플레이어의 쓰러진 캐릭터 부활 남은 시간 −${pct(v.cut)}, 부활 HP ${pct(v.hp)} (${sec(RULES_NUM.helpingHand.icd)}에 1번)`,
  },
  {
    key: 'shared_soul',
    name: '나눠 쓰는 영혼',
    tags: ['coop', 'ult'],
    target: 'party',
    flag: 'coop',
    botWeight: AUTO,
    params: { common: { ult: 0.12, restart: 0.15 } },
    describe: v => `궁극기를 쓰면 다른 플레이어 전원의 필드 캐릭터 궁 +${pct(v.ult)}, 내 그 캐릭터 게이지는 ${pct(v.restart)}에서 다시 시작`,
  },
  {
    key: 'blood_oath',
    name: '피의 서약',
    tags: ['coop', 'curse'],
    target: 'party',
    flag: 'coop',
    botWeight: POSITIONAL,
    params: { common: { give: 0.25, healMult: 1.5 } },
    describe: v =>
      `HP ${pct(RULES_NUM.bloodOath.lowHp)} 이하인 다른 플레이어 필드 캐릭터 반경 ${RULES_NUM.bloodOath.range} 안에 등장: 내 현재 HP ${pct(v.give)}를 넘겨 그 ${v.healMult}배 회복 (${sec(RULES_NUM.bloodOath.icd)}에 1번)`,
    cost: v => `대가: 등장 캐릭터 현재 HP ${pct(v.give)}`,
  },
];
