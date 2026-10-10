import type { RewardFamilyDef } from '../../types';

// 기획 17차: reward-screen system cards (docs/floor-rewards.md 「보상 화면 카드」). Core-owned (src/sim/rewards/base.ts).

/** Rerolls cap (다시 뽑기 최대 5). */
export const MAX_REROLLS = 5;

export const SYSTEM_FAMILIES: RewardFamilyDef[] = [
  {
    key: 'incense',
    name: '여분의 향',
    tags: [],
    target: 'self',
    flag: 'economy',
    botWeight: 0,
    params: { common: { rerolls: 2 } },
    describe: v => `다시 뽑기 +${v.rerolls} (최대 ${MAX_REROLLS})`,
  },
  {
    key: 'gilded',
    name: '금박 부적',
    tags: [],
    target: 'self',
    botWeight: 0.8,
    params: { common: {} },
    describe: () => '가장 최근에 고른 일반 보상 1개를 희귀로 올려요',
  },
];
