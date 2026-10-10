import type { MonsterDef } from '../types';

// 기획 17차 floor-reward summons (src/sim/rewards/fx.ts spawnShooter / spawnDecoy / placeMine). Never in MONSTERS
// (wave pools / roster tests iterate that). Shooters are stationary, untargetable and shoot their basic projectile at
// the nearest enemy in range; fx.ts sets their attack, interval and range per spawn. Looks reuse existing art.

const SHOOTER_STATS = { maxHp: 1, atk: 1, def: 0, atkSpeed: 1, range: 5, moveSpeed: 0, critChance: 0, critMult: 1.5 };

export const REWARD_UNITS: MonsterDef[] = [
  // 잔상 / 둘이서 / 도플갱어 분신: afterimages (shared cap 2 per player)
  { id: 'rw_shade', name: '잔상', tier: 'summon', color: '#b8c0ff', radius: 0.45, stationary: true, stats: { ...SHOOTER_STATS }, basic: { kind: 'projectile', speed: 15 } },
  { id: 'rw_duet', name: '둘이서', tier: 'summon', color: '#f9c74f', radius: 0.45, stationary: true, stats: { ...SHOOTER_STATS }, basic: { kind: 'projectile', speed: 15 } },
  { id: 'rw_doppel', name: '도플갱어', tier: 'summon', color: '#c77dff', radius: 0.45, stationary: true, stats: { ...SHOOTER_STATS }, basic: { kind: 'projectile', speed: 15 } },
  // 두고 간 포탑 (cap 1 per player)
  { id: 'rw_turret', name: '두고 간 포탑', tier: 'summon', color: '#adb5bd', radius: 0.45, stationary: true, stats: { ...SHOOTER_STATS, range: 6 }, basic: { kind: 'projectile', speed: 16 } },
  // 짚 인형 미끼: a decoy like the 종이 인형 (shares its cap), no burst
  {
    id: 'rw_straw', name: '짚 인형', tier: 'summon', color: '#e9c46a', radius: 0.45, stationary: true, inert: true, look: 'paper_doll',
    stats: { maxHp: 100, atk: 1, def: 0.2, atkSpeed: 0.01, range: 0, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee' },
  },
  // 발밑 지뢰: inert and untargetable; fx.ts tickMines sets it off
  { id: 'rw_mine', name: '지뢰', tier: 'summon', color: '#f94144', radius: 0.35, stationary: true, inert: true, stats: { maxHp: 1, atk: 1, def: 0, atkSpeed: 0.01, range: 0, moveSpeed: 0, critChance: 0, critMult: 1.5 }, basic: { kind: 'melee' } },
];
