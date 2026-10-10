import type { Role, SynergyTag } from '../../types';

// 기획 17차 시너지 태그 (docs/floor-rewards.md): every floor reward carries 1–2 tags; classic relics count one each. A
// tag held 3 times (the same card twice = 2) turns its set bonus on — once per tag, never twice.

export interface TagInfo {
  id: SynergyTag;
  /** Chip text without the '#'. */
  label: string;
  color: string;
  /** One short symbol for head pills / chips (canvas-safe). */
  glyph: string;
}

export const SYNERGY_TAGS: readonly TagInfo[] = [
  { id: 'appear', label: '등장', color: '#7bdff2', glyph: '▼' },
  { id: 'leave', label: '퇴장', color: '#b8c0ff', glyph: '▲' },
  { id: 'swap', label: '교대', color: '#4cc9f0', glyph: '⇄' },
  { id: 'just', label: '저스트', color: '#ffd166', glyph: '✦' },
  { id: 'ult', label: '궁극기', color: '#f9c74f', glyph: '★' },
  { id: 'pet', label: '펫', color: '#90be6d', glyph: '♣' },
  { id: 'status', label: '상태이상', color: '#c77dff', glyph: '◎' },
  { id: 'boss', label: '보스', color: '#f3722c', glyph: '♛' },
  { id: 'survive', label: '생존', color: '#43aa8b', glyph: '✚' },
  { id: 'attack', label: '공격', color: '#f94144', glyph: '⚔' },
  { id: 'curse', label: '저주', color: '#e5383b', glyph: '☠' },
  { id: 'coop', label: '협동', color: '#f472b6', glyph: '∞' },
  { id: 'growth', label: '성장', color: '#a7c957', glyph: '↗' },
];

export const TAG_INFO: Record<SynergyTag, TagInfo> = Object.fromEntries(SYNERGY_TAGS.map(t => [t.id, t])) as Record<SynergyTag, TagInfo>;

/** Tags it takes for the set bonus. */
export const TAG_SET_SIZE = 3;

/**
 * Set bonus numbers (read by the sim; core: swap, ult, pet, survive, attack — track A: appear, leave — track B: just,
 * status, boss — track C: curse, coop, growth).
 */
export const TAG_BONUS = {
  appear: { power: 0.2, radius: 0.2, invuln: 0.3 },
  leave: { radius: 0.2, linger: 1 },
  swap: { cd: 1 },
  just: { window: 0.1, power: 0.25 },
  ult: { charge: 0.12 },
  pet: { cd: 0.1, power: 0.1 },
  status: { duration: 0.2 },
  boss: { dmg: 0.1 },
  survive: { received: 0.15 },
  attack: { critMult: 0.25 },
  curse: { costMult: 0.5 },
  coop: { atk: 0.1, range: 5 },
  growth: { ult: 0.1 },
} as const satisfies Record<SynergyTag, Record<string, number>>;

/** The set bonus line (cards: 「3/3 완성!」 + this; 내 빌드). */
export const TAG_SET_BONUS: Record<SynergyTag, string> = {
  appear: '등장·착지 보상의 위력·범위 +20%, 등장 무적 +0.3초',
  leave: '퇴장 보상의 범위 +20%, 남는 것 지속 +1초',
  swap: '모든 캐릭터 재등장 쿨 −1초 (최소 4초)',
  just: '저스트 창 +0.1초, 저스트 드래그 보너스 +75%',
  ult: '궁 게이지 충전 +12%',
  pet: '펫 쿨 −10%, 펫 효과 +10%',
  status: '내가 거는 해로운 상태 지속 +20%',
  boss: '보스·중형보스에게 주는 피해 +10%',
  survive: '받는 회복·보호막 +15%',
  attack: '치명타 피해 +25%p',
  curse: '저주 카드의 HP 대가 절반',
  coop: '다른 플레이어 필드 캐릭터 반경 5 안이면 공격력 +10%',
  growth: '층(단계) 시작 때 내 캐릭터 3명 궁 게이지 +10%',
};

/** Classic relics count one tag each. */
export const RELIC_TAGS: Record<string, SynergyTag> = {
  echo_seal: 'appear',
  relay_flag: 'leave',
  vanguard_helm: 'appear',
  hunter_mark: 'swap',
  phoenix_feather: 'survive',
  beast_collar: 'pet',
  rage_breaker: 'boss',
  blood_chalice: 'survive',
};

/** 「직업 특기」: the tags of the role it was taken for. */
export const ROLE_TAGS: Record<Role, SynergyTag[]> = {
  tank: ['survive', 'leave'],
  melee: ['appear', 'attack'],
  ranged: ['appear', 'leave'],
  healer: ['survive', 'leave'],
  support: ['swap', 'coop'],
};

export const ROLE_NAME: Record<Role, string> = { tank: '탱커', melee: '근접딜러', ranged: '원거리딜러', healer: '힐러', support: '서포터' };

/** The swap guarantee: every normal screen has at least one card with one of these tags. */
export const SWAP_TAGS: readonly SynergyTag[] = ['appear', 'leave', 'swap', 'just'];
