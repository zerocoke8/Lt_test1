import type { BossDef, MonsterDef } from '../types';

// 일반몹 5종, 중형보스 2종, 보스 1종 (기획서 확정 수량) + 소환체.
// 수치는 1층 기준. 층마다 FloorPlan.statMult(기본 +12%/층)가 HP·공격력에 곱해짐.
// 플레이테스트 반영 (2026-10-04): 1층이 28초·무위협이라 교체 안 해도 똑같이 깨져서 일반몹 HP·공격력 ×2.5,
// 중형보스 HP ×2.5·공격력 ×1.5 (보스는 그대로). tests/playtest/balance.ts로 30시드 확인.

export const MONSTERS: MonsterDef[] = [
  // ── 일반몹 ──
  {
    id: 'slime', name: '슬라임', tier: 'normal', color: '#74c69d', radius: 0.4,
    stats: { maxHp: 150, atk: 15, def: 0, atkSpeed: 0.8, range: 0.4, moveSpeed: 2.0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee' },
  },
  {
    id: 'goblin', name: '고블린', tier: 'normal', color: '#a7c957', radius: 0.35,
    stats: { maxHp: 112, atk: 17.5, def: 0, atkSpeed: 1.2, range: 0.4, moveSpeed: 3.6, critChance: 0.05, critMult: 1.5 },
    basic: { kind: 'melee' },
  },
  {
    id: 'skeleton_archer', name: '해골 궁수', tier: 'normal', color: '#e9ecef', radius: 0.35,
    stats: { maxHp: 100, atk: 20, def: 0, atkSpeed: 0.7, range: 5, moveSpeed: 2.4, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 10 },
  },
  {
    id: 'bomb_bug', name: '자폭벌레', tier: 'normal', color: '#ffb703', radius: 0.3,
    stats: { maxHp: 62, atk: 25, def: 0, atkSpeed: 1, range: 0.2, moveSpeed: 4.2, critChance: 0, critMult: 1 },
    basic: { kind: 'explode', radius: 1.6, amount: 3 },
  },
  {
    id: 'golem', name: '바위 골렘', tier: 'normal', color: '#8d99ae', radius: 0.6,
    stats: { maxHp: 500, atk: 35, def: 0.2, atkSpeed: 0.5, range: 0.5, moveSpeed: 1.6, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee', splashRadius: 1 },
  },

  // ── 중형보스 ──
  {
    id: 'ogre', name: '오우거 족장', tier: 'mid', color: '#bc4749', radius: 0.9,
    stats: { maxHp: 2250, atk: 33, def: 0.15, atkSpeed: 0.6, range: 0.8, moveSpeed: 2.2, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee', splashRadius: 1.5 },
    skills: [
      {
        id: 'ogre_slam', name: '내려찍기', cooldown: 7, initialDelay: 4, castRange: 2.5,
        action: { center: 'target', area: { shape: 'circle', radius: 3 }, affects: 'enemies', delay: 1.2, effects: [{ kind: 'damage', amount: 2.5 }, { kind: 'status', status: 'stun', duration: 0.8, value: 0 }] },
      },
    ],
  },
  {
    id: 'lich', name: '리치', tier: 'mid', color: '#7b2cbf', radius: 0.8,
    stats: { maxHp: 1750, atk: 27, def: 0.1, atkSpeed: 0.6, range: 6, moveSpeed: 1.8, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 9, splashRadius: 1 },
    skills: [
      {
        id: 'lich_summon', name: '해골 소환', cooldown: 12, initialDelay: 3,
        action: { center: 'self', area: { shape: 'circle', radius: 2 }, affects: 'enemies', effects: [], summon: { unitId: 'skeleton_archer', count: 3, duration: 0 } },
      },
      {
        id: 'lich_curse', name: '저주 장판', cooldown: 9, initialDelay: 6,
        action: { center: 'target', area: { shape: 'circle', radius: 2.5 }, affects: 'enemies', delay: 0.8, effects: [{ kind: 'damage', amount: 0.4 }, { kind: 'status', status: 'slow', duration: 1, value: 0.4 }], zone: { duration: 4, tickInterval: 0.5 } },
      },
    ],
  },

  // ── 아군 소환체 ──
  {
    id: 'turret', name: '포탑', tier: 'summon', color: '#adb5bd', radius: 0.45, stationary: true,
    stats: { maxHp: 300, atk: 0, def: 0.2, atkSpeed: 2, range: 6, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    // atk 0 → sim uses owner's pet power (same as pet damage source) × 0.5 per shot.
    basic: { kind: 'projectile', speed: 16 },
  },
];

export const BOSSES: BossDef[] = [
  {
    id: 'abyss_watcher', name: '심연의 감시자', tier: 'boss', color: '#3a0ca3', radius: 3, stationary: true,
    stats: { maxHp: 9000, atk: 30, def: 0.2, atkSpeed: 0.5, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        id: 'boss_burst', name: '심연 폭발', cooldown: 8, initialDelay: 4,
        action: { center: 'target', area: { shape: 'circle', radius: 3 }, affects: 'enemies', delay: 1.5, effects: [{ kind: 'damage', amount: 3 }] },
      },
      {
        id: 'boss_summon', name: '권속 소환', cooldown: 15, initialDelay: 6,
        action: { center: 'self', area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [], summon: { unitId: 'goblin', count: 4, countMax: 6, duration: 0 } },
      },
      {
        id: 'boss_rift', name: '대지 균열', cooldown: 14, initialDelay: 10,
        action: { center: 'target', area: { shape: 'line', length: 16, width: 3 }, affects: 'enemies', delay: 1.8, effects: [{ kind: 'damage', amount: 4 }] },
      },
      {
        id: 'boss_tentacles', name: '촉수 난무', cooldown: 18, initialDelay: 15,
        action: { center: 'target', area: { shape: 'circle', radius: 5 }, affects: 'enemies', delay: 2, effects: [{ kind: 'damage', amount: 3.5 }, { kind: 'knockback', distance: 2 }] },
      },
    ],
    enrage: { atkMult: 1.6, atkSpeedMult: 1.5, cooldownMult: 0.6, summonCountMult: 1.5 },
  },
];

export const NORMAL_MONSTER_IDS = ['slime', 'goblin', 'skeleton_archer', 'bomb_bug', 'golem'];
export const MID_BOSS_IDS = ['ogre', 'lich'];
