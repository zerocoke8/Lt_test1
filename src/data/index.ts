import type { BossDef, CharacterDef, MonsterDef, PetDef, RelicDef, RewardDef } from '../types';
import { CHARACTERS } from './characters';
import { PETS } from './pets';
import { BOSSES, MONSTERS } from './monsters';
import { REWARDS } from './rewards';
import { RELICS } from './relics';

export { CHARACTERS, PETS, MONSTERS, BOSSES, REWARDS, RELICS };
export { NORMAL_MONSTER_IDS, MID_BOSS_IDS } from './monsters';
export { RARITY_WEIGHTS, RARITY_LABEL, RARITY_COLOR } from './rewards';

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
const monsterOrBoss = index<MonsterDef>([...MONSTERS, ...BOSSES], 'monster');
export const getMonster = (id: string): MonsterDef => monsterOrBoss(id);
export const getBoss = index<BossDef>(BOSSES, 'boss');

export const ROLE_LABEL: Record<CharacterDef['role'], string> = {
  tank: '탱커',
  melee: '근접딜러',
  ranged: '원거리딜러',
  support: '서포터',
};
