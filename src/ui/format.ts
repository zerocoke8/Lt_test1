// Pure display helpers (no DOM). Unit-tested in tests/ui.

import { BOSS_ENRAGED_EMPTY_FIELD_FAIL } from '../config';
import { ENERGY } from '../sim/energy';
import { getGoedamOption, goedamResultView, type GoedamOptionView } from '../data';
import type { BasicAttack, CommandResult, DamageSource, GoedamProgress, GoedamStage, GoedamTag, PlayerState, Role, RunResult, SkillDef, StatusId } from '../types';

/** 75.2 → "01:16" (ceil so the timer reads 00:01 until it really hits 0). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds - 1e-6));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** Whole seconds left for a countdown badge (ceil, never shows 0 while > 0). */
export function countdown(seconds: number): number {
  return seconds > 0 ? Math.max(1, Math.ceil(seconds - 1e-6)) : 0;
}

/** 12345 → "12,345"; 1234567 → "123.5만". */
export function formatNumber(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) >= 1_000_000) return `${(v / 10_000).toFixed(1)}만`;
  return v.toLocaleString('ko-KR');
}

export function formatPct(frac: number, digits = 0): string {
  return `${(frac * 100).toFixed(digits)}%`;
}

/** Short Korean glyph per role, same convention as the renderer's unit bodies. */
export const ROLE_GLYPH: Record<Role, string> = { tank: '방', melee: '근', ranged: '원', healer: '힐', support: '지' };

export const STATUS_LABEL: Record<StatusId, string> = {
  stun: '기절',
  slow: '둔화',
  burn: '화상',
  atkUp: '공격력 증가',
  atkDown: '공격력 감소',
  defUp: '방어 증가',
  haste: '가속',
  regen: '재생',
  vulnerable: '취약',
  lifesteal: '흡혈',
  drain: '흡혼 표식', // 기획 12차 (퇴마사)
  // 기획 13차 스킬 리뉴얼
  taunt: '도발',
  tether: '묶기',
  root: '속박',
  stasis: '정지',
  charm: '조종',
  splashUp: '공격 범위 증가',
};

/** One-character pip glyph. */
export const STATUS_GLYPH: Record<StatusId, string> = {
  stun: '기',
  slow: '둔',
  burn: '화',
  atkUp: '공',
  atkDown: '약',
  defUp: '방',
  haste: '속',
  regen: '재',
  vulnerable: '취',
  lifesteal: '흡',
  drain: '혼',
  taunt: '!',
  tether: '묶',
  root: '속',
  stasis: '정',
  charm: '조',
  splashUp: '범',
};

export const SOURCE_LABEL: Record<DamageSource, string> = {
  basic: '평타',
  passive: '패시브',
  normal: '일반스킬',
  drag: '드래그스킬',
  ult: '궁극기',
  pet: '펫',
  relic: '유물',
  zone: '장판',
  summon: '소환수',
};

export const SOURCE_COLOR: Record<DamageSource, string> = {
  basic: '#8d99ae',
  passive: '#b5838d',
  normal: '#4cc9f0',
  drag: '#3ddc84',
  ult: '#ffd166',
  pet: '#f472b6',
  relic: '#c77dff',
  zone: '#f9844a',
  summon: '#90be6d',
};

export function basicAttackText(b: BasicAttack): string {
  switch (b.kind) {
    case 'melee':
      return b.splashRadius ? `가장 가까운 적을 근접 공격 (주변 반경 ${b.splashRadius} 범위 피해).` : '가장 가까운 적을 근접 공격.';
    case 'projectile':
      return b.splashRadius ? `가장 가까운 적에게 투사체 발사 (반경 ${b.splashRadius} 범위 피해).` : '가장 가까운 적에게 투사체 발사.';
    case 'explode':
      return `대상에게 돌진해 반경 ${b.radius} 폭발.`;
  }
}

/** Player-facing text for a refused swap/pet command (sim reasons are short Korean codes). */
/** 기획 14차 교체 에너지: an energy amount — whole when it is ("6"), else one decimal ("5.5", "6.4"). */
export function energyNum(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * 기획 14차 교체 에너지: rewrite the re-appear-cooldown wording of a description (reward, relic, pet, skill, 돌발 괴담)
 * into what it does in energy mode (src/sim/energy.ts rule c): a bench cut of N s → '교체 에너지 +N×regen', 빠른 교대
 * '재등장 쿨 −v초' → '교체 비용 −v/2×regen', '재등장 쿨 초기화' / '교체 쿨 0' → '에너지 가득'. Other text is returned
 * unchanged. `skill`: a skill whose cut carries a fixed energy (크로노 균열) reads that amount for its N s.
 */
export function energyRuleText(text: string, regen: number, skill?: Pick<SkillDef, 'actions'>): string {
  const fixed = new Map<number, number>();
  for (const a of skill?.actions ?? []) for (const e of a.effects) if (e.kind === 'swapCooldownReduce' && e.energy != null) fixed.set(e.seconds, e.energy);
  return text
    .replace(/(대기 캐릭터 )?재등장 쿨 (\d+(?:\.\d+)?)초 감소/g, (_m, _w, n: string) => `교체 에너지 +${energyNum(fixed.get(Number(n)) ?? Number(n) * regen)}`)
    .replace(/의 재등장 쿨 -(\d+(?:\.\d+)?)초 \(최소 4초\)/g, (_m, n: string) => ` 교체 비용 ⚡-${energyNum(Number(n) * ENERGY.rewardPerSec * regen)}`)
    .replace(/재등장 쿨 초기화/g, '교체 에너지 가득')
    .replace(/교체 쿨 0/g, '에너지 가득');
}

export function refusalText(
  r: CommandResult,
  opts: { cooldown?: number; revive?: number; kind: 'swap' | 'pet'; energy?: { need: number; secs: number } },
): string {
  switch (r.reason) {
    case '에너지 부족': {
      // 기획 14차 교체 에너지
      const e = opts.energy;
      if (!e) return '교체 에너지가 부족해요';
      return `에너지 부족 · ⚡${energyNum(e.need)} 필요${Number.isFinite(e.secs) && e.secs > 0 ? ` (${countdown(e.secs)}초 후)` : ''}`;
    }
    case '쿨타임':
      return opts.kind === 'swap' ? `재등장 대기 중 · ${countdown(opts.cooldown ?? 0)}초` : `펫 쿨타임 · ${countdown(opts.cooldown ?? 0)}초`;
    case '사망':
      return `쓰러진 캐릭터 · 부활까지 ${countdown(opts.revive ?? 0)}초`;
    case '이미 필드에 있음':
      return '이미 필드에 있는 캐릭터예요';
    case '등장 중':
      return '등장 중에는 교체할 수 없어요';
    case '관전 중':
      return '사망 — 관전 중이에요';
    case '전투 중이 아님':
      return '지금은 쓸 수 없어요';
    default:
      return r.reason ?? '사용할 수 없어요';
  }
}

export function resultTitle(r: RunResult): string {
  return r.outcome === 'victory' ? '승리!' : '패배';
}

export function resultReason(r: RunResult, quitWhileOut: boolean, bossFloor = false): string {
  switch (r.reason) {
    case 'cleared':
      return '최고층까지 모두 클리어했어요';
    case 'timeout':
      // boss floors never fail on time alone: only an enraged boss with nobody on the field (soft-lock guard)
      return bossFloor ? `광폭화 후 ${BOSS_ENRAGED_EMPTY_FIELD_FAIL}초 동안 필드에 아무도 없음 (보스층)` : '제한시간 초과 (일반층)';
    case 'wipe':
      return '플레이어 3명이 모두 사망';
    case 'quit':
      return quitWhileOut ? '내 캐릭터 전멸 후 관전 종료' : '런 포기';
  }
}

// ─────────────────────────── 괴담 방 (기획 10차) ───────────────────────────

const GOEDAM_TAG_LABEL: Record<GoedamTag, string> = { safe: '안전', cost: '대가', gamble: '도박', observe: '관찰', permanent: '영구' };

/** Risk chip text: '도박'. */
export function goedamTagLabel(t: GoedamTag): string {
  return GOEDAM_TAG_LABEL[t];
}

/** Button size class: rolls (도박·관찰) are tall, sure deals medium, 지나간다 small. */
export function goedamOptionKind(v: Pick<GoedamOptionView, 'id' | 'tags'>): 'leave' | 'gamble' | 'cost' {
  if (v.id === 'leave') return 'leave';
  return v.tags.includes('gamble') || v.tags.includes('observe') ? 'gamble' : 'cost';
}

/** Room deadline line (multiplayer): what happens when it runs out at my stage. */
export function goedamTimerText(left: number, stage: GoedamStage): string {
  if (stage === 'choosing') return `${left}초 · 안 고르면 '그냥 지나간다'`;
  return stage === 'result' ? `${left}초 뒤 자동으로 계속` : `${left}초 안에 다음 층`;
}

/** '다른 플레이어 기다리는 중 (2/3)'. */
export function goedamWaitText(done: number, total: number): string {
  return `다른 플레이어 기다리는 중 (${done}/${total})`;
}

/** Wait-panel row of another player: '하늘 — 동전을 넣는다 → 덜컹!' / '민지 — 고르는 중…' / 'BOT 1 — (봇) 그냥 지나갔다'. */
export function goedamOtherRow(
  p: Pick<PlayerState, 'name' | 'isBot'> & { party: readonly { defId: string }[] },
  roomId: string,
  pr: GoedamProgress | undefined,
): string {
  if (!pr || pr.stage === 'choosing' || !pr.choice || !pr.outcome) return `${p.name} — 고르는 중…`;
  const o = getGoedamOption(roomId, pr.choice);
  if (p.isBot) return `${p.name} — (봇) ${o?.done ?? pr.choice}`;
  const rv = goedamResultView(roomId, pr.choice, pr.outcome, pr.params, p.party);
  return `${p.name} — ${o?.label ?? pr.choice} → ${rv.title}`;
}
