import type { BossDef, CharacterDef, MonsterDef, PetDef, RelicDef, RewardDef } from '../types';
import { CHARACTERS } from './characters';
import { PETS } from './pets';
import { BOSSES, MONSTERS } from './monsters';
import { REWARDS } from './rewards';
import { RELICS } from './relics';
import { FIELD_EVENT_UNITS } from './fieldEvents';
import { REWARD_UNITS } from './rewardUnits';

export { CHARACTERS, PETS, MONSTERS, BOSSES, REWARDS, RELICS };
export { NORMAL_MONSTER_IDS, MID_BOSS_IDS, BOSS_IDS } from './monsters';
export { RARITY_WEIGHTS, RARITY_LABEL, RARITY_COLOR } from './rewards';
// 기획 17차: families, tags, rarity bands (src/data/rewards/)
export { PREF_DEALER, FAMILIES, RARITIES, RARITY_BY_BAND, getFamily, hasFamily, rewardFamily, isBasicFamily, familyRarities, MAX_REROLLS, TAG_INFO, SYNERGY_TAGS, TAG_SET_SIZE, TAG_SET_BONUS, TAG_BONUS, RELIC_TAGS, ROLE_TAGS, ROLE_NAME, SWAP_TAGS } from './rewards';
export { REWARD_UNITS } from './rewardUnits';
export * from './goedam';
export * from './fieldEvents';

function index<T extends { id: string }>(list: T[], what: string): (id: string) => T {
  const map = new Map(list.map(x => [x.id, x]));
  return (id: string) => {
    const v = map.get(id);
    if (!v) throw new Error(`unknown ${what}: ${id}`);
    return v;
  };
}

export const getCharacter = index<CharacterDef>(CHARACTERS, 'character');
export const getPet = index<PetDef>(PETS, 'pet');
export const getReward = index<RewardDef>(REWARDS, 'reward');
export const getRelic = index<RelicDef>(RELICS, 'relic');
// 기획 12차: 돌발 괴담 units resolve by id too (they are not in MONSTERS, so wave pools / roster tests never see them)
// 기획 17차: floor-reward summons (afterimages, turret, straw doll, mine) resolve by id too, never in MONSTERS
const monsterOrBoss = index<MonsterDef>([...MONSTERS, ...BOSSES, ...FIELD_EVENT_UNITS, ...REWARD_UNITS], 'monster');
export const getMonster = (id: string): MonsterDef => monsterOrBoss(id);
export const getBoss = index<BossDef>(BOSSES, 'boss');

export const ROLE_LABEL: Record<CharacterDef['role'], string> = {
  tank: '탱커',
  melee: '근접딜러',
  ranged: '원거리딜러',
  healer: '힐러', // 기획 12차
  support: '서포터',
};
