// Pure display helpers (no DOM). Unit-tested in tests/ui.

import { BOSS_ENRAGED_EMPTY_FIELD_FAIL } from '../config';
import { getGoedamOption, goedamResultView, type GoedamOptionView } from '../data';
import type { BasicAttack, CommandResult, DamageSource, GoedamProgress, GoedamStage, GoedamTag, PlayerState, Role, RunResult, StatusId } from '../types';

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
  grudge: '원한', // 기획 17차 (원한의 쪽지)
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
  grudge: '원',
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

// ─────────────────────────── 보스 레이드 (기획 19차, docs/boss-raid.md 7장) ───────────────────────────

/** The mode's name on chips and tags. */
export const RAID_LABEL = '보스 레이드';

/** Progress pill: '보스 7/20' (floor n = the n-th boss; `total` = Tunables.maxFloor). */
export function raidProgress(floor: number, total: number): string {
  return `보스 ${Math.max(0, Math.floor(floor))}/${total}`;
}

/** Floor banner / result chip: '7층 · 문서 파쇄기'. */
export function raidFloorTitle(floor: number, bossName: string): string {
  return `${floor}층 · ${bossName}`;
}

/** Longest 괴담 line the floor banner shows (it is up for about 2 s of reading: one short sentence, one line on a phone). */
export const RAID_BANNER_LORE_MAX = 28;

/**
 * 기획 19차 review: the banner's 괴담 line — `loreShort` when the boss has one, else the first sentence of its lore (the
 * whole line is on the pause screen and in docs/bosses.md).
 */
export function raidBannerLore(boss: { lore?: string; loreShort?: string }): string {
  if (boss.loreShort) return boss.loreShort;
  const lore = boss.lore ?? '';
  const end = lore.indexOf('. ');
  return end < 0 ? lore : lore.slice(0, end + 1);
}

/** Floor-start banner of a raid floor: '7층 · 문서 파쇄기' / the boss's 괴담 line / '보스 7/20 · HP를 0으로 만들면 퇴각해요'. */
export function raidBanner(floor: number, boss: { name: string; lore?: string; loreShort?: string }, total: number): { big: string; lore: string; sub: string } {
  return { big: raidFloorTitle(floor, boss.name), lore: raidBannerLore(boss), sub: `${raidProgress(floor, total)} · HP를 0으로 만들면 퇴각해요` };
}

/** Clear banner line under 「보스 퇴각!」: '7층 돌파 · 보스 7/20'. */
export function raidClearSub(floor: number, total: number): string {
  return `${floor}층 돌파 · ${raidProgress(floor, total)}`;
}

/** Bosses beaten in a finished run: every floor on a win, the floors below the one the run ended on otherwise. */
export function raidBossesBeaten(r: Pick<RunResult, 'outcome' | 'floorReached'>): number {
  return r.outcome === 'victory' ? Math.max(0, r.floorReached) : Math.max(0, r.floorReached - 1);
}

/**
 * Result line of a raid: the win says 「보스 20종을 모두 쓰러뜨렸어요」 when the run had one boss per floor (`roster` = the
 * bosses that are on = `total` floors); with bosses switched off (some came twice) it says 「20층을 모두 돌파했어요」.
 * Every floor is a boss floor, so no '(보스층)'.
 */
export function raidResultReason(r: RunResult, quitWhileOut: boolean, total: number, roster: number = total): string {
  if (r.reason === 'cleared') return roster === total ? `보스 ${total}종을 모두 쓰러뜨렸어요` : `${total}층을 모두 돌파했어요`;
  return resultReason(r, quitWhileOut, true).replace(' (보스층)', '');
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
