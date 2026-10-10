// 기획 17차 「내 빌드」 (docs/floor-rewards.md 그 밖의 화면 규칙): rerolls left, the 13 synergy tags (n/3, finished ones
// gold with their bonus line), my floor rewards grouped 파티 → 직업 → 캐릭터별 → 협동 with repeats merged
// (「공격력 강화 ×3 · +38%」), and (optionally) relics. buildSummary is PURE over plain data, so the reward sheet, the
// pause menu (a PlayerState) and the 원정 lobby (a saved run's carry, no game running) share it.

import type { AppliedReward, Rarity, RewardDef, Role, SynergyTag } from '../types';
import { RARITY_COLOR, RARITY_LABEL, RELIC_TAGS, ROLE_NAME, ROLE_TAGS, SYNERGY_TAGS, TAG_SET_BONUS, TAG_SET_SIZE, getCharacter, getFamily, getRelic, getReward, hasFamily } from '../data';
import { h } from './dom';

export interface BuildTag {
  id: SynergyTag;
  label: string;
  color: string;
  glyph: string;
  count: number;
  /** ≥ 3: the set bonus is on. */
  done: boolean;
  bonus: string;
}

export interface BuildLine {
  /** Family key (data-family in the DOM). */
  family: string;
  name: string;
  /** Copies merged into this line. */
  count: number;
  /** Highest rarity among them. */
  rarity: Rarity;
  /** '+38%' for the basic stat families, else the best copy's description. */
  detail: string;
  /** The basic families' summed value reads as a short number (detail sits on the name row). */
  short: boolean;
  curse: boolean;
}

export interface BuildGroup {
  title: string;
  lines: BuildLine[];
}

export interface BuildSummary {
  rerolls: number;
  tags: BuildTag[];
  /** Finished sets (count ≥ 3). */
  sets: number;
  groups: BuildGroup[];
  relics: { id: string; name: string; description: string }[];
  /** Floor rewards owned (copies). */
  total: number;
}

const RANK: Record<Rarity, number> = { common: 1, rare: 2, epic: 3, legendary: 4 };

/** Basic families shown as one summed number: value → text. */
const SUMMED: Record<string, (v: number) => string> = {
  atk: v => `+${pctText(v)}`,
  hp: v => `+${pctText(v)}`,
  aspd: v => `+${pctText(v)}`,
  crit: v => `+${pctText(v)}`,
  def: v => `−${pctText(v)}`,
  petcd: v => `−${pctText(v)}`,
  dragdmg: v => `+${pctText(v)}`,
  dragrad: v => `+${pctText(v)}`,
  appshield: v => `${pctText(v)}`,
  normcd: v => `−${pctText(v)}`,
  ultdmg: v => `+${pctText(v)}`,
  swapcd: v => `−${Math.round(v * 10) / 10}초`,
};

function pctText(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function safeReward(id: string): RewardDef | null {
  try {
    return getReward(id);
  } catch {
    return null;
  }
}

function roleOf(party: readonly string[], idx: number | null): Role | null {
  const id = idx != null ? party[idx] : undefined;
  if (!id) return null;
  try {
    return getCharacter(id).role;
  } catch {
    return null;
  }
}

function charName(party: readonly string[], idx: number | null): string | undefined {
  const id = idx != null ? party[idx] : undefined;
  if (!id) return undefined;
  try {
    return getCharacter(id).name;
  } catch {
    return undefined;
  }
}

/** Tags one applied reward counts for (「직업 특기」: its role's tags) — same rule as the sim's tagsOf. */
export function appliedTags(a: AppliedReward, party: readonly string[]): readonly SynergyTag[] {
  const def = safeReward(a.rewardId);
  if (!def) return [];
  if (def.family !== 'role') return def.tags;
  const role = roleOf(party, a.partyIndex);
  return role ? ROLE_TAGS[role] : [];
}

/** Tag counts of rewards + classic relics (the same card twice = 2). */
export function countTags(rewards: readonly AppliedReward[], relics: readonly string[], party: readonly string[]): Record<SynergyTag, number> {
  const out = Object.fromEntries(SYNERGY_TAGS.map(t => [t.id, 0])) as Record<SynergyTag, number>;
  for (const a of rewards) for (const t of appliedTags(a, party)) out[t]++;
  for (const r of relics) {
    const t = RELIC_TAGS[r];
    if (t) out[t]++;
  }
  return out;
}

interface Bucket {
  group: number;
  sub: string;
  key: string;
  family: string;
  defs: RewardDef[];
  idx: number | null;
  role: Role | null;
}

/** Which list an applied reward goes in: 0 파티, 1 직업, 2 캐릭터별 (by member), 3 협동. */
function bucketOf(def: RewardDef, a: AppliedReward, party: readonly string[]): { group: number; sub: string } {
  if (def.flag === 'coop') return { group: 3, sub: '' };
  if (def.target === 'role') return { group: 1, sub: '' };
  if (def.target === 'member') return { group: 2, sub: charName(party, a.partyIndex) ?? '캐릭터' };
  return { group: 0, sub: '' };
}

function lineOf(b: Bucket, party: readonly string[]): BuildLine {
  const best = b.defs.reduce((x, y) => (RANK[y.rarity] > RANK[x.rarity] ? y : x));
  const fam = hasFamily(b.family) ? getFamily(b.family) : null;
  const ctx = { char: charName(party, b.idx), role: b.role ?? undefined };
  const name = b.role ? `${ROLE_NAME[b.role]} 특기` : (fam?.name ?? best.name).split('{char}').join(ctx.char ?? '');
  const sum = SUMMED[b.family];
  if (sum) {
    const total = b.defs.reduce((s, d) => s + (d.params.v ?? 0), 0);
    return { family: b.family, name, count: b.defs.length, rarity: best.rarity, detail: sum(total), short: true, curse: best.flag === 'curse' };
  }
  let detail = best.description;
  try {
    if (fam) detail = fam.describe(best.params, ctx);
  } catch {
    /* keep the stored text */
  }
  return { family: b.family, name, count: b.defs.length, rarity: best.rarity, detail, short: false, curse: best.flag === 'curse' };
}

const GROUP_TITLES = ['파티', '직업', '', '협동'];

/** The 내 빌드 summary. party = the 3 character ids by slot (member names, role tags). */
export function buildSummary(rewards: readonly AppliedReward[], relics: readonly string[], party: readonly string[], rerolls: number): BuildSummary {
  const counts = countTags(rewards, relics, party);
  const tags: BuildTag[] = SYNERGY_TAGS.map(t => ({
    id: t.id,
    label: t.label,
    color: t.color,
    glyph: t.glyph,
    count: counts[t.id],
    done: counts[t.id] >= TAG_SET_SIZE,
    bonus: TAG_SET_BONUS[t.id],
  }));
  const buckets = new Map<string, Bucket>();
  for (const a of rewards) {
    const def = safeReward(a.rewardId);
    if (!def) continue;
    const { group, sub } = bucketOf(def, a, party);
    const role = def.family === 'role' ? roleOf(party, a.partyIndex) : null;
    const key = `${group}|${sub}|${def.family}|${role ?? ''}|${def.target === 'member' ? a.partyIndex : ''}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { group, sub, key, family: def.family, defs: [], idx: a.partyIndex, role }));
    b.defs.push(def);
  }
  const groups: BuildGroup[] = [];
  const ordered = [...buckets.values()].sort((x, y) => x.group - y.group || (x.idx ?? -1) - (y.idx ?? -1));
  for (const b of ordered) {
    const title = b.group === 2 ? b.sub : GROUP_TITLES[b.group];
    let g = groups[groups.length - 1];
    if (!g || g.title !== title) groups.push((g = { title, lines: [] }));
    g.lines.push(lineOf(b, party));
  }
  const relicRows = relics.map(id => {
    try {
      const r = getRelic(id);
      return { id, name: r.name, description: r.description };
    } catch {
      return { id, name: id, description: '' };
    }
  });
  return { rerolls, tags, sets: tags.filter(t => t.done).length, groups, relics: relicRows, total: rewards.length };
}

/** One tag chip: '#퇴장 2/3' (finished: gold '#퇴장 완성'). */
export function tagChip(t: Pick<BuildTag, 'label' | 'color' | 'count' | 'done' | 'glyph'>, parent: HTMLElement): HTMLElement {
  const chip = h('span', `bp-tag${t.done ? ' is-done' : t.count > 0 ? ' is-on' : ''}`, parent);
  chip.style.setProperty('--tc', t.color);
  h('span', 'bp-tag-g', chip, t.glyph);
  h('span', 'bp-tag-l', chip, `#${t.label}`);
  h('span', 'bp-tag-n', chip, t.done ? '완성' : `${Math.min(t.count, TAG_SET_SIZE)}/${TAG_SET_SIZE}`);
  return chip;
}

export interface BuildRenderOpts {
  /** Show the relic rows (the reward sheet; the pause menu lists relics itself). */
  relics?: boolean;
  /** Show '다시 뽑기 N개' (classic + 원정 runs). */
  rerolls?: boolean;
  /** Title row text (default '내 빌드'). */
  title?: string;
}

/** Fill `el` with the summary (replaces its children). */
export function renderBuild(el: HTMLElement, b: BuildSummary, opts: BuildRenderOpts = {}): void {
  el.replaceChildren();
  const head = h('div', 'bp-head', el);
  h('span', 'bp-title', head, opts.title ?? '내 빌드');
  if (opts.rerolls !== false) h('span', 'bp-rerolls', head, `다시 뽑기 ${b.rerolls}개`);
  const chips = h('div', 'bp-tags', el);
  // owned tags first (finished ones leading), then the rest dim
  const tags = [...b.tags].sort((x, y) => Number(y.done) - Number(x.done) || Number(y.count > 0) - Number(x.count > 0));
  for (const t of tags) tagChip(t, chips).dataset.tag = t.id;
  for (const t of b.tags.filter(x => x.done)) {
    const row = h('div', 'bp-bonus', el);
    row.style.setProperty('--tc', t.color);
    h('span', 'bp-bonus-k', row, `#${t.label} 모음`);
    h('span', 'bp-bonus-v', row, t.bonus);
  }
  if (!b.groups.length) h('div', 'bp-empty', el, '아직 고른 층 보상이 없어요');
  for (const g of b.groups) {
    if (g.title) h('div', 'bp-group', el, g.title);
    for (const l of g.lines) {
      const row = h('div', `bp-line${l.curse ? ' is-curse' : ''}`, el);
      row.dataset.family = l.family;
      row.style.setProperty('--rc', RARITY_COLOR[l.rarity]);
      const top = h('div', 'bp-line-top', row);
      h('span', 'bp-dot', top);
      h('span', 'bp-name', top, `${l.name}${l.count > 1 ? ` ×${l.count}` : ''}`);
      if (l.short) h('span', 'bp-val', top, l.detail);
      else h('span', 'bp-rarity', top, RARITY_LABEL[l.rarity]);
      if (!l.short) h('div', 'bp-desc', row, l.detail);
    }
  }
  if (opts.relics && b.relics.length) {
    h('div', 'bp-group', el, `유물 ${b.relics.length}`);
    for (const r of b.relics) {
      const row = h('div', 'bp-line is-relic', el);
      const top = h('div', 'bp-line-top', row);
      h('span', 'bp-dot', top);
      h('span', 'bp-name', top, r.name);
      h('div', 'bp-desc', row, r.description);
    }
  }
}

/** '버프 5개 · 모음 1' (원정 lobby chip). */
export function buildChipText(b: BuildSummary, extra = 0): string {
  return `버프 ${b.total + extra}개${b.sets ? ` · 모음 ${b.sets}` : ''}`;
}
