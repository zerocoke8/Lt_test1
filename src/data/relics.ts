import type { RelicDef } from '../types';

// 보스층 클리어 보상 (기획서 10장). 3개 제시 → 1개 선택. 효과는 sim의 relic 훅에서 id로 처리.

export const RELICS: RelicDef[] = [
  { id: 'echo_seal', name: '메아리 인장', rarity: 'epic', description: '드래그스킬이 1초 뒤 같은 자리에서 50% 위력으로 한 번 더 발동.', params: { delay: 1, power: 0.5 } },
  { id: 'relay_flag', name: '교대의 깃발', rarity: 'rare', description: '교체할 때 퇴장하는 캐릭터 자리에 폭발(반경 2, 공격력 200%).', params: { radius: 2, amount: 2 } },
  { id: 'vanguard_helm', name: '선봉의 투구', rarity: 'common', description: '등장 후 4초간 공격력 +40%.', params: { duration: 4, atkPct: 0.4 } },
  { id: 'hunter_mark', name: '사냥꾼의 표식', rarity: 'rare', description: '적을 처치할 때마다 대기 캐릭터 재등장 쿨 0.5초 감소.', params: { seconds: 0.5 } },
  { id: 'phoenix_feather', name: '불사조 깃털', rarity: 'rare', description: '부활 시간 -40%, 부활 시 HP 100%.', params: { revivePct: 0.4, hpFrac: 1 } },
  { id: 'beast_collar', name: '야수의 목걸이', rarity: 'common', description: '펫 쿨타임 -30%, 펫 효과 +30%.', params: { cdPct: 0.3, powerPct: 0.3 } },
  { id: 'rage_breaker', name: '광기 사냥꾼', rarity: 'common', description: '보스·중형보스에게 주는 피해 +25%, 광폭화 상태면 +50%.', params: { pct: 0.25, enragedPct: 0.5 } },
  { id: 'blood_chalice', name: '흡혈의 잔', rarity: 'common', description: '드래그스킬 피해의 20%만큼 그 캐릭터 HP 회복.', params: { pct: 0.2 } },
];
