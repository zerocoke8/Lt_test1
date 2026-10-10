// 기획 17차 층 보상 (docs/floor-rewards.md): the public face of src/sim/rewards/ — offers / picks / grants, the bot pick,
// queries and the hook bus types (tracks import the modules directly).
export * from './offers';
export { botPickIndex, botPickMember, offerScore, RARITY_SCORE } from './botPick';
export { familyRewards, memberRewards, rewardCount, rewardLevel, rewardParam, roleLevel, roleRewards, tagActive, tagCounts, tagsOf } from './query';
export type { AppearInfo, CdAcc, DragMods, JustInfo, LeaveInfo, RewardHooks } from './types';
