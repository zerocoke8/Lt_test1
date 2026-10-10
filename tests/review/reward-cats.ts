// 기획 17차 밸런스: the floor-reward family → category table of docs/floor-rewards.md (the 8 idea categories + 기본 +
// 시스템), shared by tests/review/critic-20f.ts and tests/review/reward-bench.ts.

import { FAMILIES } from '../../src/data/rewards';

export const CATEGORY_FAMILIES: Record<string, readonly string[]> = {
  기본: ['atk', 'hp', 'aspd', 'crit', 'def', 'petcd', 'dragdmg', 'dragrad', 'swapcd', 'appshield', 'normcd', 'ultdmg'],
  시스템: ['incense', 'gilded'],
  '등장·착지': ['bolt', 'startle', 'beckon', 'scorch', 'relay_line', 'inplace', 'prompt', 'rested', 'talisman', 'doppel'],
  퇴장: ['relay_blast', 'shade', 'mine', 'grudge', 'evac', 'farewell', 'fog', 'shove'],
  '직업 특기': ['role'],
  '교대 연계': ['baton', 'combo', 'handover', 'cover_swap', 'aftercare', 'relay3', 'partners', 'tricolor'],
  '궁·보스·펫·상태': [
    'swap_charge', 'intermission', 'ult_linger', 'duet', 'overcharge', 'groggy_drop', 'groggy_rush', 'crusher', 'pet_call',
    'pet_scent', 'tamer', 'pet_breeder', 'fire_hand', 'burn_chain', 'spell_ext', 'expose', 'possess', 'ghost_hunter',
  ],
  저스트: ['just_counter', 'just_cd', 'just_ult', 'just_window', 'just_guard', 'just_freeze', 'just_ghost'],
  '규칙·성장': ['double_load', 'understudy', 'punch_in', 'window_fire', 'nails', 'candles'],
  '저주·도박': ['blood_contract', 'coin', 'haste_cost', 'blood_entry', 'ledge', 'hungry_pet', 'soul_loan', 'red_moon', 'deadline', 'last_one', 'box_in_box', 'debt', 'greedy'],
  협동: ['team_relay', 'joint_rite', 'three_incense', 'red_thread', 'stand_in', 'helping_hand', 'shared_soul', 'blood_oath'],
};

/** family key → category (families missing from the table → '기타', so a new family shows up in the report). */
export const REWARD_CATEGORY: Record<string, string> = Object.fromEntries(
  FAMILIES.map(f => [f.key, Object.entries(CATEGORY_FAMILIES).find(([, ks]) => ks.includes(f.key))?.[0] ?? '기타']),
);
