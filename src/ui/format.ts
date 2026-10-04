// Pure display helpers (no DOM). Unit-tested in tests/ui.

import { BOSS_ENRAGED_EMPTY_FIELD_FAIL } from '../config';
import type { BasicAttack, CommandResult, DamageSource, Role, RunResult, StatusId } from '../types';

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
export const ROLE_GLYPH: Record<Role, string> = { tank: '방', melee: '근', ranged: '원', support: '지' };

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
export function refusalText(r: CommandResult, opts: { cooldown?: number; revive?: number; kind: 'swap' | 'pet' }): string {
  switch (r.reason) {
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
