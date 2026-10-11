// 기획 19차 보스 레이드 (docs/bosses.md 2장): the number tables of every boss as markdown, straight from the data files
// (src/data/bosses/*.ts) — per zone: boss numbers, 기획 20차 form numbers (form, body, walk, seats, front / back,
// footprints) and pattern numbers; then the summon-only units. After a retune run it with `write` so the doc and the
// data never drift.
//
//   npx vite-node tests/review/boss-table.ts write     rewrites docs/bosses.md between the boss-table:start / end markers
//   npx vite-node tests/review/boss-table.ts           prints the tables only
//
// A boss switched off for the raid (`raid: false` in its data) shows 「끔」 in the 레이드 column.
// 기획 20차 wording in the pattern table: 「아레나 (x, y)」 = center 'arena' · 「보는 쪽 기준 (앞 n, 옆 m)」 = rel 'facing' ·
// 「기울인 띠 n°」 = rot · 부가: 「돌진 n칸」 「돌진 뒤 n초 멈춤」 「길에 흔적 n초」 「자리 이동(다음)」 「표식(교체로 풀림)」
// 「한 번만 맞음」 · a skill with `cycle` prints each variant as its own rows (「번갈아 n번째」).

import fs from 'node:fs';
import { BOSSES, BOSS_RAID, BOSS_RAID_BAND, BOSS_UNITS, RAID_ZONES, ZONE_BOSSES, getMonster } from '../../src/data';
import { BOSS_FORM, BOSS_FORM_LABEL } from '../../src/data/bosses/forms';
import { BOSS_SKILL_KIND } from '../../src/audio/synth/bossVoices';
import type { AreaShape, BossDef, Effect, MonsterSkill, SkillAction, Vec2 } from '../../src/types';

const ZONE_NAME: Record<string, string> = { lobby: '로비·상가 (1~5층)', office: '사무실 (6~10층)', ward: '폐병동 (11~15층)', rooftop: '옥상·이계 (16~20층)' };
const BAND: Record<string, string> = { early: '앞', mid: '중', late: '뒤' };
const DIR: Record<string, string> = { right: '→', left: '←', down: '↓', up: '↑' };
const STATUS: Record<string, string> = { stun: '기절', slow: '둔화', burn: '화상', atkDown: '공격력↓', haste: '가속', vulnerable: '취약', root: '속박', atkUp: '공격력↑', defUp: '방어↑', regen: '재생' };
const n = (v: number): string => String(Math.round(v * 1000) / 1000);
const xy = (p: Vec2): string => `(${n(p.x)}, ${n(p.y)})`;
const formOf = (b: BossDef): NonNullable<BossDef['form']> => b.form ?? 'fixed';

/** A direction in words: a fixed dir arrow, or (기획 20차) a rot — relative to the facing when the part is rel 'facing'. */
function way(a: { dir: string; rot?: number }, rel: boolean): string {
  if (a.rot == null) return DIR[a.dir] ?? a.dir;
  if (!rel) return ` ${n(a.rot)}°`;
  const r = ((a.rot % 360) + 360) % 360;
  return r === 0 ? ' 앞' : r === 180 ? ' 뒤' : r === 90 ? ' 오른쪽' : r === 270 ? ' 왼쪽' : ` 앞에서 ${n(a.rot)}°`;
}

function area(a: AreaShape, rel = false, rots?: number[]): string {
  switch (a.shape) {
    case 'circle':
      return `원 r${n(a.radius)}`;
    case 'single':
      return '한 명';
    case 'line':
      return `직선 길이 ${n(a.length)} · 폭 ${n(a.width)}`;
    case 'rect': {
      const centre = a.anchor === 'center' ? ' (가운데 기준)' : '';
      if (a.rot == null) return `띠${DIR[a.dir] ?? a.dir} 길이 ${n(a.length)} · 폭 ${n(a.width)}${centre}`;
      const angles = rots && rots.length > 1 ? ` ${rots.map(n).join(' / ')}°` : way(a, rel);
      const tilted = rel && (!rots || rots.length < 2) ? `띠${angles}` : `기울인 띠${angles}`;
      return `${tilted} 길이 ${n(a.length)} · 폭 ${n(a.width)}${centre}`;
    }
    case 'cone':
      return `부채꼴${way(a, rel)} r${n(a.radius)} · ${n(a.angle)}°`;
    case 'ring':
      return a.outer >= 20 ? `안전 원 r${n(a.inner)} 밖 전부 (고리 ${n(a.inner)}~${n(a.outer)})` : `고리 ${n(a.inner)}~${n(a.outer)}`;
    case 'cross':
      return `${a.diagonal ? 'X자' : '십자'} 길이 ${n(a.length)} · 폭 ${n(a.width)}`;
    case 'fan':
      return `부채꼴 r${n(a.radius)} · ${n(a.angle)}°`;
  }
}

function effects(list: Effect[]): { dmg: string; extra: string } {
  const dmg: string[] = [];
  const extra: string[] = [];
  for (const e of list) {
    if (e.kind === 'damage') dmg.push(n(e.amount));
    else if (e.kind === 'status') {
      const pct = e.status === 'stun' || e.status === 'root' ? '' : e.status === 'burn' ? ` ${n(e.value * 100)}%/초` : ` ${n(e.value * 100)}%`;
      extra.push(`${STATUS[e.status] ?? e.status}${pct} ${n(e.duration)}초`);
    } else if (e.kind === 'pull') extra.push(`끌기 ${n(e.distance)}`);
    else if (e.kind === 'knockback') extra.push(`밀기 ${n(e.distance)}${e.dir ? DIR[e.dir] ?? e.dir : ''}`);
    else if (e.kind === 'heal') extra.push(`회복 ${n(e.amount * 100)}%`);
    else if (e.kind === 'shield') extra.push(`보호막 ${n(e.amount * 100)}% ${n(e.duration)}초`);
    else extra.push(e.kind);
  }
  return { dmg: dmg.join(' + ') || '—', extra: extra.join(', ') };
}

/** A part without where / when it lands (and without a strip's angle) — parts with the same key are one row. */
function partKey(a: SkillAction): string {
  const { offset: _offset, delay: _delay, ...rest } = a;
  const shape = rest.area.shape === 'rect' && rest.area.rot != null ? { ...rest.area, rot: 0 } : rest.area;
  return JSON.stringify({ ...rest, area: shape });
}

/** Same-shaped parts of one variant as rows: a sweep (every delay differs) is one row, a volley is one row per delay. */
function partRows(boss: BossDef, parts: SkillAction[], note?: string): string[][] {
  const fixed = formOf(boss) === 'fixed';
  const groups: SkillAction[][] = [];
  for (const p of parts) {
    const g = groups.find(x => partKey(x[0]) === partKey(p));
    if (g) g.push(p);
    else groups.push([p]);
  }
  const split = groups.flatMap(g => {
    const delays = [...new Set(g.map(p => p.delay ?? 0))];
    // a cross of beams (two strips per step) stays one row; otherwise a volley is one row per delay
    return delays.length === g.length || g[0].once ? [g] : delays.map(d => g.filter(p => (p.delay ?? 0) === d));
  });
  return split.map(g => {
    const a = g[0];
    const fx = effects(a.effects);
    const more: string[] = [];
    if (note) more.push(note);
    if (fx.extra) more.push(fx.extra);
    if (a.hits && a.hits > 1) more.push(`${a.hits}연타(${n(a.hitInterval ?? 0)}초 간격)`);
    if (a.zone) more.push(`장판 ${n(a.zone.duration)}초(${n(a.zone.tickInterval)}초마다)`);
    if (a.summon) more.push(`소환 ${getMonster(a.summon.unitId).name} ${a.summon.count}${a.summon.countMax ? `~${a.summon.countMax}` : ''}${a.summon.duration > 0 ? ` (${n(a.summon.duration)}초)` : ''}`);
    // 기획 20차 part fields
    if (a.charge) more.push(a.charge.distance >= 20 ? `돌진 ${n(a.charge.distance)}칸(벽까지)` : `돌진 ${n(a.charge.distance)}칸`);
    if (a.charge?.recover) more.push(`돌진 뒤 ${n(a.charge.recover)}초 멈춤`);
    if (a.trail) more.push(`길에 흔적 ${n(a.trail.duration)}초 (${n(a.trail.spacing)}칸마다 r${n(a.trail.radius)}, ${n(a.trail.tickInterval)}초마다 ${effects(a.trail.effects).dmg === '—' ? '' : `피해 ${effects(a.trail.effects).dmg}`}${effects(a.trail.effects).extra ? ` + ${effects(a.trail.effects).extra}` : ''})`);
    if (a.blink) more.push(a.blink.behind ? '대상 등 뒤로 순간이동' : '대상 곁으로 순간이동');
    if (a.relocate) more.push('자리 이동(다음)');
    if (a.bound) more.push('표식(교체로 풀림)');
    if (a.once) more.push('한 번만 맞음');
    if (a.follow) more.push('따라옴');
    if (a.telegraphLead != null) more.push(`마지막 ${n(a.telegraphLead)}초만 예고`);
    if (a.affects === 'self') more.push('보스 자신(노란 고리)');
    const rel = a.rel === 'facing';
    const aimed = a.area.shape === 'line' || a.area.shape === 'fan';
    const placed = g.some(p => p.offset && (p.offset.x !== 0 || p.offset.y !== 0));
    let where: string;
    let spots = '';
    if (a.relocate) where = '다음 자리 둘레 ';
    else if (a.center === 'arena') {
      where = '';
      const uniq = [...new Set(g.map(p => xy(p.offset ?? { x: 0, y: 0 })))];
      spots = ` — 아레나 ${uniq.join(' ')}`;
    } else if (a.center === 'self') {
      where = placed ? '' : aimed ? '보스→대상 ' : rel ? '몸에서 ' : '보스 둘레 ';
      if (placed && rel) spots = ` — 보는 쪽 기준 ${[...new Set(g.map(p => `(앞 ${n(p.offset?.x ?? 0)}, 옆 ${n(p.offset?.y ?? 0)})`))].join(' ')}`;
      // a fixed boss's offsets are arena spots seen from the top centre (x 0..24, y 0..12); a moving body's are from itself
      else if (placed) spots = fixed ? ` — 시작 자리 ${g.map(p => xy({ x: (p.offset?.x ?? 0) + 12, y: (p.offset?.y ?? 0) - 1.2 })).join(' ')}` : ` — 몸 기준 ${g.map(p => xy(p.offset ?? { x: 0, y: 0 })).join(' ')}`;
    } else {
      where = a.charge ? '보스→대상 돌진길 ' : aimed ? '보스→대상 ' : '대상 ';
      if (placed) spots = ` — 대상 기준 ${g.map(p => xy(p.offset ?? { x: 0, y: 0 })).join(' ')}`;
    }
    const rots = a.area.shape === 'rect' && a.area.rot != null ? [...new Set(g.map(p => (p.area as { rot: number }).rot))] : undefined;
    const delays = [...new Set(g.map(p => n(p.delay ?? 0)))].join(' / ');
    return [delays === '0' ? '즉시' : delays, `${where}${area(a.area, rel, rots)}${g.length > 1 ? ` ×${g.length}` : ''}${spots}`, fx.dmg, more.join(', ') || '—'];
  });
}

/** Every variant of a skill: its action / extra, then (기획 20차 rule N7) each `cycle` entry. */
function variants(sk: MonsterSkill): SkillAction[][] {
  return [[sk.action, ...(sk.extra ?? [])], ...(sk.cycle ?? []).map(v => [v.action, ...(v.extra ?? [])])];
}

function skillRows(boss: BossDef, first: boolean, sk: MonsterSkill, phase: string): string[] {
  const rows = variants(sk).flatMap((parts, v) => partRows(boss, parts, sk.cycle?.length ? `번갈아 ${v + 1}번째` : undefined));
  const mark = boss.signature === sk.id ? '★ ' : '';
  return rows.map((r, i) => {
    const who = first && i === 0 ? `**${boss.name}**` : '';
    const name = i === 0 ? `${mark}${sk.name} \`${sk.id}\`${phase}` : '〃';
    const cd = i === 0 ? `${n(sk.cooldown)} / ${n(sk.initialDelay ?? 0)}` : '';
    return `| ${who} | ${name} | ${cd} | ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]}${i === 0 && sk.castMove ? ', 걸으면서 씀' : ''} | ${i === 0 ? (BOSS_SKILL_KIND[sk.id] ?? '?') : ''} |`;
  });
}

// ── 기획 20차: the form table ──

function walkText(b: BossDef): string {
  const mv = b.move;
  if (!mv) return formOf(b) === 'relocating' ? '「자리 이동」 패턴으로만 옮김' : '—';
  const bits: string[] = [];
  if (mv.mode === 'pursue') bits.push(`쫓기(${mv.target === 'farthest' ? '가장 먼 캐릭터' : '가장 가까운 캐릭터'})`);
  else if (mv.mode === 'keepAway') bits.push(`거리 두기 ${n(mv.keep?.min ?? 4)}~${n(mv.keep?.max ?? 7)}칸`);
  else if (mv.mode === 'patrol') bits.push('순찰(길을 돎)');
  else bits.push('정해진 길(도발 무시)');
  if (mv.retarget != null) bits.push(`${n(mv.retarget)}초마다 다시 고름`);
  if (mv.axis) bits.push('가로 먼저 · 그다음 세로');
  if (mv.dwell) bits.push(`자리마다 ${n(mv.dwell)}초 쉼`);
  bits.push(`몸 돌리기 ${n(mv.turnRate ?? BOSS_FORM.turnRate)}°/초`);
  if (mv.castMove) bits.push('패턴 중에도 안 멈춤');
  return bits.join(' · ');
}

function placeText(b: BossDef): string {
  const form = formOf(b);
  if (form === 'fixed') return '맨 위 가운데 (12, -1.2)';
  if (form === 'relocating') return (b.spots ?? []).map(s => `${xy(s)}${DIR[s.facing]}`).join(' → ');
  const start = b.spawn ?? b.move?.waypoints?.[0] ?? BOSS_FORM.roamSpawn;
  const route = b.move?.waypoints?.length ? ` · 길 ${b.move.waypoints.map(xy).join(' → ')}` : '';
  return `등장 ${xy(start)}${route}`;
}

function guardText(b: BossDef): string {
  const g = b.guard;
  return g ? `앞 ${n(g.frontArc)}° ×${n(g.frontMult)} · 뒤 ${n(g.backArc)}° ×${n(g.backMult)}` : '—';
}

function trailText(b: BossDef): string {
  const t = b.trail;
  if (!t) return '—';
  const fx = effects(t.effects);
  return `${n(t.every)}칸마다 원 r${n(t.radius)} · ${n(t.duration)}초(${n(t.tickInterval)}초마다 피해 ${fx.dmg}${fx.extra ? ` + ${fx.extra}` : ''}) · 최대 ${t.max}개`;
}

function basicText(b: BossDef): string {
  if (b.basic.kind === 'melee') return `근접 ${n(b.stats.range)}${b.basic.splashRadius ? ` (주변 ${n(b.basic.splashRadius)})` : ''}`;
  return `원거리 ${n(b.stats.range)}`;
}

const byId = new Map(BOSSES.map(b => [b.id, b]));
const lines: string[] = [];
const put = (line: string): void => void lines.push(line);

for (const zone of RAID_ZONES) {
  put(`\n### ${ZONE_NAME[zone]}\n`);
  put('보스 수치 (1층 기준):\n');
  put('| 보스 | id | 레이드 | HP | 공격 | 방어 | 공속 | 그로기 | 페이즈 (HP 아래 · 이름 · 공속 · 쿨) | 구간 | 괴담 한 줄 |');
  put('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const id of ZONE_BOSSES[zone]) {
    const b = byId.get(id);
    if (!b) {
      put(`| (데이터 없음) | \`${id}\` | | | | | | | | | |`);
      continue;
    }
    const ph = (b.phases ?? []).map(p => `${n(p.hpBelow * 100)}% 「${p.name ?? ''}」 ×${n(p.atkSpeedMult ?? 1)} · ×${n(p.cooldownMult ?? 1)}`).join(' / ');
    const on = b.raid === false ? '끔' : '켬';
    const band = id === BOSS_RAID.finalBoss ? '최종(20층)' : (BAND[BOSS_RAID_BAND[id]] ?? '?');
    put(`| ${b.name} | \`${b.id}\` | ${on} | ${b.stats.maxHp} | ${b.stats.atk} | ${b.stats.def} | ${b.stats.atkSpeed} | ${b.groggy?.threshold ?? '—'} | ${ph} | ${band} | ${b.lore} |`);
  }
  put('\n보스 형태 (기획 20차):\n');
  put('| 보스 | 형태 | 몸 반지름 | 이동 속도 | 기본 공격 | 걸음 | 등장 자리 · 자리 목록 | 앞뒤 배율 | 발자국 |');
  put('|---|---|---|---|---|---|---|---|---|');
  for (const id of ZONE_BOSSES[zone]) {
    const b = byId.get(id);
    if (!b) continue;
    put(`| ${b.name} | ${BOSS_FORM_LABEL[formOf(b)]} \`${formOf(b)}\` | ${n(b.radius)} | ${b.stats.moveSpeed > 0 ? n(b.stats.moveSpeed) : '—'} | ${basicText(b)} | ${walkText(b)} | ${placeText(b)} | ${guardText(b)} | ${trailText(b)} |`);
  }
  put('\n패턴 수치 (★ = 대표 패턴):\n');
  put('| 보스 | 패턴 | 쿨 / 첫 시전(초) | 예고(초) | 범위 | 피해(×공격) | 부가 | 소리 |');
  put('|---|---|---|---|---|---|---|---|');
  for (const id of ZONE_BOSSES[zone]) {
    const b = byId.get(id);
    if (!b) continue;
    let first = true;
    for (const sk of b.skills ?? []) {
      for (const row of skillRows(b, first, sk, '')) put(row);
      first = false;
    }
    for (const p of b.phases ?? []) for (const sk of p.skills ?? []) for (const row of skillRows(b, false, sk, ` (페이즈 ${n(p.hpBelow * 100)}%)`)) put(row);
  }
}

put('\n### 새 쫄 (소환 전용)\n');
put('| id | 이름 | HP | 공격 | 공속 | 사거리 | 이동 | 반지름 | 고정 | 패턴 |');
put('|---|---|---|---|---|---|---|---|---|---|');
for (const u of BOSS_UNITS) {
  const sk = (u.skills ?? []).map(s => `${s.name} \`${s.id}\` 쿨 ${n(s.cooldown)} / 첫 ${n(s.initialDelay ?? 0)}`).join(', ');
  put(`| \`${u.id}\` | ${u.name} | ${u.stats.maxHp} | ${u.stats.atk} | ${u.stats.atkSpeed} | ${u.stats.range} | ${u.stats.moveSpeed} | ${u.radius} | ${u.stationary ? '예' : ''} | ${sk || '—'} |`);
}

const DOC = 'docs/bosses.md';
const START = /<!-- boss-table:start[^>]*-->/;
const END = '<!-- boss-table:end -->';

/** Replace what stands between the two markers of docs/bosses.md with the tables (line endings of the doc kept). */
function writeDoc(table: string): void {
  const doc = fs.readFileSync(DOC, 'utf8');
  const eol = doc.includes('\r\n') ? '\r\n' : '\n';
  const start = START.exec(doc);
  const end = doc.indexOf(END);
  if (!start || end < start.index) throw new Error(`${DOC}: the boss-table:start / boss-table:end markers are missing`);
  const head = doc.slice(0, start.index + start[0].length);
  fs.writeFileSync(DOC, head + eol + table.split('\n').join(eol) + eol + eol + doc.slice(end));
  console.log(`${DOC}: 2장 표를 데이터에서 다시 뽑았어요 (보스 ${BOSSES.length}종).`);
}

const argv = (globalThis as { process?: { argv: string[] } }).process?.argv ?? [];
if (argv.slice(2).some(a => a.toLowerCase() === 'write' || a.toUpperCase() === 'WRITE=1')) writeDoc(lines.join('\n'));
else console.log(lines.join('\n'));

export {};
