import type { PetDef } from '../types';

// 임시 펫 8종 (기획서: 8종 중 3마리를 골라 감). 드래그해서 놓은 지점에서 발동, 교체가 아님.
// 펫 피해 = 주인의 필드 캐릭터 공격력 × amount (필드가 비어 있으면 파티 최고 기본 공격력).

export const PETS: PetDef[] = [
  {
    id: 'frog_bomb',
    name: '불꽃 개구리',
    color: '#ff7b00',
    description: '0.5초 뒤 반경 2.5에 공격력 300% 폭발.',
    cooldown: 35,
    action: { center: 'point', area: { shape: 'circle', radius: 2.5 }, affects: 'enemies', delay: 0.5, effects: [{ kind: 'damage', amount: 3 }] },
  },
  {
    id: 'fairy_heal',
    name: '치유 요정',
    color: '#80ffdb',
    description: '반경 3.5 아군 HP 25% 회복.',
    cooldown: 40,
    action: { center: 'point', area: { shape: 'circle', radius: 3.5 }, affects: 'allies', effects: [{ kind: 'heal', amount: 0.25 }] },
  },
  {
    id: 'turtle_guard',
    name: '수호 거북',
    color: '#52b788',
    description: '반경 3.5 아군에게 보호막(최대 HP 30%, 5초).',
    cooldown: 40,
    action: { center: 'point', area: { shape: 'circle', radius: 3.5 }, affects: 'allies', effects: [{ kind: 'shield', amount: 0.3, duration: 5 }] },
  },
  {
    id: 'owl_frost',
    name: '서리 부엉이',
    color: '#90e0ef',
    description: '반경 3 적 1초 기절 + 3초간 60% 둔화 + 공격력 50% 피해.',
    cooldown: 35,
    action: { center: 'point', area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.5 }, { kind: 'status', status: 'stun', duration: 1, value: 0 }, { kind: 'status', status: 'slow', duration: 3, value: 0.6 }] },
  },
  {
    id: 'golem_turret',
    name: '포탑 골렘',
    color: '#adb5bd',
    description: '10초간 가장 가까운 적을 쏘는 포탑 소환.',
    cooldown: 45,
    action: { center: 'point', area: { shape: 'circle', radius: 1 }, affects: 'allies', effects: [], summon: { unitId: 'turret', count: 1, duration: 10 } },
  },
  {
    id: 'cat_void',
    name: '블랙홀 고양이',
    color: '#5a189a',
    description: '반경 4 적을 끌어당기고 공격력 60% 피해 + 0.5초 기절.',
    cooldown: 40,
    action: { center: 'point', area: { shape: 'circle', radius: 4 }, affects: 'enemies', effects: [{ kind: 'pull', distance: 3 }, { kind: 'damage', amount: 0.6 }, { kind: 'status', status: 'stun', duration: 0.5, value: 0 }] },
  },
  {
    id: 'drum_raccoon',
    name: '전투북 너구리',
    color: '#c9184a',
    description: '6초간 반경 3.5 장판 안 아군 공격력 +30%.',
    cooldown: 45,
    action: { center: 'point', area: { shape: 'circle', radius: 3.5 }, affects: 'allies', effects: [{ kind: 'status', status: 'atkUp', duration: 1, value: 0.3 }], zone: { duration: 6, tickInterval: 0.5 } },
  },
  {
    id: 'rabbit_time',
    name: '시간 토끼',
    color: '#f4d35e',
    description: '내 대기 캐릭터 재등장 쿨 4초 감소 + 반경 3 아군 5초간 공격 속도 +30%.',
    cooldown: 50,
    action: { center: 'point', area: { shape: 'circle', radius: 3 }, affects: 'allies', effects: [{ kind: 'swapCooldownReduce', seconds: 4 }, { kind: 'status', status: 'haste', duration: 5, value: 0.3 }] },
  },
];
