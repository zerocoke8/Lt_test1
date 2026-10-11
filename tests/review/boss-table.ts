// 기획 19차 보스 레이드 (docs/bosses.md 2장): the number tables of every boss as markdown, straight from the data files
// (src/data/bosses/*.ts) — two tables per zone (boss numbers, pattern numbers) + the summon-only units. After a retune
// run it with `write` so the doc and the data never drift.
//
//   npx vite-node tests/review/boss-table.ts write     rewrites docs/bosses.md between the boss-table:start / end markers
//   npx vite-node tests/review/boss-table.ts           prints the tables only
//
// A boss switched off for the raid (`raid: false` in its data) shows 「끔」 in the 레이드 column.

import fs from 'node:fs';
import { BOSSES, BOSS_RAID, BOSS_RAID_BAND, BOSS_UNITS, RAID_ZONES, ZONE_BOSSES, getMonster } from '../../src/data';
import { BOSS_SKILL_KIND } from '../../src/audio/synth/bossVoices';
import type { AreaShape, BossDef, Effect, MonsterSkill, SkillAction } from '../../src/types';

const ZONE_NAME: Record<string, string> = { lobby: '로비·상가 (1~5층)', office: '사무실 (6~10층)', ward: '폐병동 (11~15층)', rooftop: '옥상·이계 (16~20층)' };
const BAND: Record<string, string> = { early: '앞', mid: '중', late: '뒤' };
const DIR: Record<string, string> = { right: '→', left: '←', down: '↓', up: '↑' };
const STATUS: Record<string, string> = { stun: '기절', slow: '둔화', burn: '화상', atkDown: '공격력↓', haste: '가속', vulnerable: '취약', root: '속박', atkUp: '공격력↑', defUp: '방어↑', regen: '재생' };
const n = (v: number): string => String(Math.round(v * 1000) / 1000);

function area(a: AreaShape): string {
  switch (a.shape) {
    case 'circle':
      return `원 r${n(a.radius)}`;
    case 'single':
      return '한 명';
    case 'line':
      return `직선 길이 ${n(a.length)} · 폭 ${n(a.width)}`;
    case 'rect':
      return `띠${DIR[a.dir] ?? a.dir} 길이 ${n(a.length)} · 폭 ${n(a.width)}${a.anchor === 'center' ? ' (가운데 기준)' : ''}`;
    case 'cone':
      return `부채꼴${DIR[a.dir] ?? a.dir} r${n(a.radius)} · ${n(a.angle)}°`;
    case 'ring':
      return `고리 ${n(a.inner)}~${n(a.outer)}`;
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

/** A part without where / when it lands — parts with the same key are one row. */
function partKey(a: SkillAction): string {
  const { offset: _offset, delay: _delay, ...rest } = a;
  return JSON.stringify(rest);
}

/** Same-shaped parts of one skill as rows: a sweep (every delay differs) is one row, a volley is one row per delay. */
function partRows(sk: MonsterSkill): string[][] {
  const groups: SkillAction[][] = [];
  for (const p of [sk.action, ...(sk.extra ?? [])]) {
    const g = groups.find(x => partKey(x[0]) === partKey(p));
    if (g) g.push(p);
    else groups.push([p]);
  }
  const split = groups.flatMap(g => {
    const delays = [...new Set(g.map(p => p.delay ?? 0))];
    return delays.length === g.length ? [g] : delays.map(d => g.filter(p => (p.delay ?? 0) === d));
  });
  return split.map(g => {
    const a = g[0];
    const fx = effects(a.effects);
    const more: string[] = [];
    if (fx.extra) more.push(fx.extra);
    if (a.hits && a.hits > 1) more.push(`${a.hits}연타(${n(a.hitInterval ?? 0)}초 간격)`);
    if (a.zone) more.push(`장판 ${n(a.zone.duration)}초(${n(a.zone.tickInterval)}초마다)`);
    if (a.summon) more.push(`소환 ${getMonster(a.summon.unitId).name} ${a.summon.count}${a.summon.countMax ? `~${a.summon.countMax}` : ''}`);
    if (a.follow) more.push('따라옴');
    if (a.telegraphLead != null) more.push(`마지막 ${n(a.telegraphLead)}초만 예고`);
    if (a.affects === 'self') more.push('보스 자신(노란 고리)');
    const self = a.center === 'self';
    const aimed = a.area.shape === 'line' || a.area.shape === 'fan';
    const placed = g.some(p => p.offset);
    const where = self ? (placed ? '' : '보스 둘레 ') : aimed ? '보스→대상 ' : '대상 ';
    // boss-centred offsets are printed as arena spots (x 0..24, y 0..12); target-centred ones as offsets from the target
    const spot = (p: SkillAction): string => {
      const o = p.offset ?? { x: 0, y: 0 };
      return self ? `(${n(o.x + 12)}, ${n(o.y - 1.2)})` : `(${n(o.x)}, ${n(o.y)})`;
    };
    const spots = placed ? ` — ${self ? '시작 자리' : '대상 기준'} ${g.map(spot).join(' ')}` : '';
    const delays = [...new Set(g.map(p => n(p.delay ?? 0)))].join(' / ');
    return [delays === '0' ? '즉시' : delays, `${where}${area(a.area)}${g.length > 1 ? ` ×${g.length}` : ''}${spots}`, fx.dmg, more.join(', ') || '—'];
  });
}

function skillRows(boss: BossDef, first: boolean, sk: MonsterSkill, phase: string): string[] {
  return partRows(sk).map((r, i) => {
    const who = first && i === 0 ? `**${boss.name}**` : '';
    const name = i === 0 ? `${sk.name} \`${sk.id}\`${phase}` : '〃';
    const cd = i === 0 ? `${n(sk.cooldown)} / ${n(sk.initialDelay ?? 0)}` : '';
    return `| ${who} | ${name} | ${cd} | ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} | ${i === 0 ? (BOSS_SKILL_KIND[sk.id] ?? '?') : ''} |`;
  });
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
  put('\n패턴 수치:\n');
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
put('| id | 이름 | HP | 공격 | 공속 | 사거리 | 이동 | 반지름 | 고정 |');
put('|---|---|---|---|---|---|---|---|---|');
for (const u of BOSS_UNITS) put(`| \`${u.id}\` | ${u.name} | ${u.stats.maxHp} | ${u.stats.atk} | ${u.stats.atkSpeed} | ${u.stats.range} | ${u.stats.moveSpeed} | ${u.radius} | ${u.stationary ? '예' : ''} |`);

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
