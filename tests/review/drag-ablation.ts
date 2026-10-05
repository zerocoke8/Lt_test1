// Balance-critic check of docs/balance.md (not a test; run by hand). Two modes:
//
//   MODE=ablate  — outcome ablation of each drag skill. Same player-0 setup as tests/playtest/drag-bench.ts (party =
//                  the same character ×3, "designer" aim, swap every 4 s, ult 0.5 s after full, drag-neutral rewards),
//                  but instead of PRICING the effects with the value model it REMOVES groups of effects from the
//                  drag skill at runtime and measures what the run actually loses (paired seeds):
//                    full  — unchanged
//                    noCC  — stun / slow / pull / knockback removed
//                    noSup — heal / shield / ally buffs / cleanse / swap-cd cut removed
//                    noStun / noSlow / noDisp — only that one CC kind removed
//                    none  — every effect removed (the character still appears)
//                  Outcome: party HP lost (all 3 players, shield-absorbed excluded), party damage taken, character
//                  deaths, floors cleared, time to finish floors 1..N.
//   MODE=pacing  — game-level pacing, OLD (git HEAD) vs NEW drag numbers, several human parties, seeds the balance pass
//                  did not use. OLD_CHARS=<json [{id, drag, swapCooldown}] of git HEAD's src/data/characters.ts>.
//   MODE=rows    — print the drag row of the in-game skill sheet for all 12.
//
// env: SEEDS=48 SEED0=5000 FLOORS=5 CHARS=guardian,cleric VARIANTS=full,noCC,noSup,none POLICY=designer|best
//      PARTIES="blade,mage,cleric;guardian,ranger,bard" (pacing) OUT=path.json
//      GOEDAM=leave (기획 10차 괴담 rooms after floors 2–4: off|leave|random|first|greedy|forced:<room>:<opt>)
// Run: npx vite-node tests/review/drag-ablation.ts

import fs from 'node:fs';
import { BOT_PRESETS, DEFAULT_TUNABLES, TICK_RATE, VIEW_WIDTH_UNITS } from '../../src/config';
import { CHARACTERS, getCharacter } from '../../src/data';
import { bestDropPoint } from '../../src/sim/bot';
import { createGameWithWorld, dispatch, tick } from '../../src/sim/game';
import { canSwap } from '../../src/sim/players';
import { previewPartsFor } from '../../src/sim/preview';
import { effStats } from '../../src/sim/stats';
import { activeEntity, clampToArena, edgeDist, getEntity, isAlive, type SimEntity, type World } from '../../src/sim/world';
import { skillRows } from '../../src/ui/skillinfo';
import type { CharacterDef, Effect as SkillEffect, PlayerSetup, Vec2 } from '../../src/types';
import { dragNeutralPick } from '../playtest/drag-value';
import { goedamPilot, goedamTunables, parseGoedamPolicy } from '../playtest/goedam-policy';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const MODE = env.MODE ?? 'ablate';
const SEEDS = Number(env.SEEDS ?? 48);
const SEED0 = Number(env.SEED0 ?? 5000);
const FLOORS = Number(env.FLOORS ?? 5);
const CHARS = env.CHARS ? env.CHARS.split(',') : CHARACTERS.map(c => c.id);
const VARIANTS = (env.VARIANTS ?? 'full,noCC,noSup,none').split(',');
const POLICY = env.POLICY ?? 'designer';
/** 기획 10차: 괴담 room policy (tests/playtest/goedam-policy.ts); 'leave' = 'off' bit for bit. */
const GOEDAM = parseGoedamPolicy(env.GOEDAM);
const DT = 1 / TICK_RATE;

const AIM_OFFSET: Record<string, Vec2> = {
  blade: { x: -3, y: 0 },
  berserker: { x: -1.6, y: 0 },
  shadow: { x: -2.2, y: 0 },
  ranger: { x: -2.5, y: 0 },
  gunner: { x: 2, y: 0 },
};
const weight = (e: SimEntity) => (e.tier === 'boss' ? 3 : e.tier === 'mid' ? 2 : 1);

function cluster(units: SimEntity[], healer: boolean): Vec2 | null {
  let best: Vec2 | null = null;
  let bestN = 0;
  for (const f of units) {
    let n = 0;
    let sx = 0;
    let sy = 0;
    for (const q of units) {
      if (Math.hypot(q.pos.x - f.pos.x, q.pos.y - f.pos.y) > 2.5) continue;
      const wq = healer ? 1 + (1 - q.hp / q.maxHp) * 3 : weight(q);
      n += wq;
      sx += q.pos.x * wq;
      sy += q.pos.y * wq;
    }
    if (n > bestN) {
      bestN = n;
      best = { x: sx / n, y: sy / n };
    }
  }
  return best;
}

function viewOf(w: World, me: SimEntity | null | undefined): { lo: number; hi: number } {
  const a = w.state.plan.arena;
  const half = VIEW_WIDTH_UNITS / 2;
  const x = me?.pos.x ?? a.width / 2;
  const cx = a.width <= VIEW_WIDTH_UNITS ? a.width / 2 : Math.min(a.width - half, Math.max(half, x));
  return { lo: cx - half, hi: cx + half };
}

// ─────────────────────────── drag-skill surgery (runtime only) ───────────────────────────

const ORIGINAL = new Map<string, { drag: CharacterDef['drag']; cd: number }>(
  CHARACTERS.map(c => [c.id, { drag: structuredClone(c.drag), cd: c.swapCooldown }]),
);

const isCC = (e: SkillEffect) => e.kind === 'pull' || e.kind === 'knockback' || (e.kind === 'status' && (e.status === 'stun' || e.status === 'slow'));
const isSup = (e: SkillEffect) =>
  e.kind === 'heal' || e.kind === 'shield' || e.kind === 'cleanse' || e.kind === 'swapCooldownReduce' || (e.kind === 'status' && ['defUp', 'atkUp', 'haste', 'regen'].includes(e.status));

function setVariant(id: string, variant: string): void {
  const def = getCharacter(id);
  const orig = structuredClone(ORIGINAL.get(id)!.drag);
  const isStun = (e: SkillEffect) => e.kind === 'status' && e.status === 'stun';
  const isSlow = (e: SkillEffect) => e.kind === 'status' && e.status === 'slow';
  const isDisp = (e: SkillEffect) => e.kind === 'pull' || e.kind === 'knockback';
  const drop: Record<string, (e: SkillEffect) => boolean> = {
    full: () => false,
    noCC: isCC,
    noSup: isSup,
    noStun: isStun,
    noSlow: isSlow,
    noDisp: isDisp,
    none: () => true,
  };
  const keep = (e: SkillEffect) => !drop[variant](e);
  for (const a of orig.actions) a.effects = a.effects.filter(keep);
  def.drag = orig;
}
function restore(): void {
  for (const c of CHARACTERS) {
    const o = ORIGINAL.get(c.id)!;
    c.drag = structuredClone(o.drag);
    c.swapCooldown = o.cd;
  }
}

// ─────────────────────────── one run ───────────────────────────

interface Outcome {
  hpLost: number;
  taken: number;
  absorbed: number;
  deaths: number;
  myDeaths: number;
  floors: number;
  time: number;
  /** Σ seconds of the cleared floors 1..FLOORS (normal floors) */
  normalSec: number;
  bossSec: number | null;
  bossCleared: boolean;
  timeouts: number;
  wipe: boolean;
  casts: number;
  dealt: number;
  floorSec: number[];
}

function runOne(party: string[], seed: number, policy: string, aimChar: string | null, onTick?: (w: World) => void): Outcome {
  const human: PlayerSetup = { name: '나', isBot: false, characters: party, pets: ['frog_bomb', 'fairy_heal', 'cat_void'] };
  const players: PlayerSetup[] = [human, ...BOT_PRESETS.map(b => ({ name: b.name, isBot: true, characters: [...b.characters], pets: [...b.pets] }))];
  const { world: w } = createGameWithWorld({ seed, players, tunables: { ...DEFAULT_TUNABLES, ...goedamTunables(GOEDAM) } });
  const s = w.state;
  const p = s.players[0];
  const pilot = goedamPilot(w, GOEDAM);
  let lastSwap = -99;
  let ultAt: number | null = null;
  let think = 0;
  let card = 0;
  const o: Outcome = { hpLost: 0, taken: 0, absorbed: 0, deaths: 0, myDeaths: 0, floors: 0, time: 0, normalSec: 0, bossSec: null, bossCleared: false, timeouts: 0, wipe: false, casts: 0, dealt: 0, floorSec: [] };
  let dead = s.players.map(q => q.party.map(m => m.dead));
  const maxTicks = TICK_RATE * 60 * 40;
  for (let t = 0; t < maxTicks; t++) {
    if (s.floor > FLOORS) break;
    if (s.phase === 'reward') {
      if (s.floor >= FLOORS) break;
      pilot.settle([0], dragNeutralPick);
      lastSwap = -99;
      continue;
    }
    if (s.phase === 'runOver') {
      if (s.runResult?.reason === 'wipe') o.wipe = true;
      if (s.runResult?.reason === 'timeout') o.timeouts++;
      break;
    }
    think -= DT;
    if (think <= 0 && s.phase === 'combat' && !p.out) {
      think = 0.25;
      const me = activeEntity(w, p);
      const foes = s.entities.filter(e => e.team === 'enemy' && isAlive(e));
      if (p.ult.charge >= 1 && me && foes.length) {
        if (ultAt == null) ultAt = s.time + 0.5;
        if (s.time >= ultAt && dispatch(w, { type: 'ult', player: 0 }).ok) ultAt = null;
      }
      const ready = [0, 1, 2].filter(i => canSwap(w, 0, i).ok);
      const due = (s.time - lastSwap >= 4 || !me) && (foes.length > 0 || !me);
      if (ready.length && due) {
        const idx = [1, 2, 0].map(k => (card + k) % 3).find(i => ready.includes(i))!;
        let pos: Vec2;
        if (policy === 'best') pos = bestDropPoint(w, p, idx);
        else {
          const parts = previewPartsFor(s, 0, 'swap', idx);
          const healer = !parts.some(pt => pt.affects === 'enemies');
          const view = viewOf(w, me);
          const allyChars = s.entities.filter(e => e.team === 'ally' && e.kind === 'character' && isAlive(e));
          const pool = healer ? allyChars : foes.filter(e => e.pos.x >= view.lo && e.pos.x <= view.hi);
          const c = cluster(pool, healer);
          const selfPos = me ? { ...me.pos } : { x: (view.lo + view.hi) / 2, y: s.plan.arena.height / 2 };
          const off = AIM_OFFSET[aimChar ?? p.party[idx].defId] ?? { x: 0, y: 0 };
          const q = c ? { x: c.x + off.x, y: c.y + off.y } : selfPos;
          pos = clampToArena(w, { x: Math.min(view.hi, Math.max(view.lo, q.x)), y: q.y });
        }
        if (dispatch(w, { type: 'swap', player: 0, partyIndex: idx, pos }).ok) {
          lastSwap = s.time;
          card = idx;
          o.casts++;
        }
      }
    }
    const floorBefore = s.floor;
    tick(w);
    onTick?.(w);
    for (const ev of w.events) {
      if (ev.type === 'damage' && ev.targetTeam === 'ally') o.absorbed += ev.absorbed ?? 0;
    }
    w.events.length = 0;
    if (s.floor === floorBefore && s.phase === 'combat') {
      s.players.forEach((q, pi) =>
        q.party.forEach((m, i) => {
          if (m.dead && !dead[pi][i]) {
            o.deaths++;
            if (pi === 0) o.myDeaths++;
          }
        }),
      );
    }
    dead = s.players.map(q => q.party.map(m => m.dead));
  }
  for (const f of w.floorTimes) {
    if (f.floor > FLOORS) continue;
    if (f.outcome === 'clear') {
      o.floors++;
      o.floorSec[f.floor - 1] = f.seconds;
      if (f.floor % 5 === 0) {
        o.bossCleared = true;
        o.bossSec = f.seconds;
      } else o.normalSec += f.seconds;
    }
  }
  o.time = s.time;
  for (const q of s.players) {
    o.taken += q.stats.damageTaken;
    o.dealt += q.stats.damageDealt;
  }
  o.hpLost = o.taken - o.absorbed;
  return o;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
};
const r1 = (x: number) => Math.round(x * 10) / 10;
const r0 = (x: number) => Math.round(x);
const seedOf = (k: number) => 7001 + (SEED0 + k) * 104729;
const out: Record<string, unknown> = { mode: MODE, seeds: SEEDS, seed0: SEED0, floors: FLOORS, policy: POLICY };

if (MODE === 'ablate') {
  const rows: Record<string, unknown>[] = [];
  for (const id of CHARS) {
    const res: Record<string, Outcome[]> = {};
    for (const v of VARIANTS) {
      setVariant(id, v);
      res[v] = [];
      for (let k = 0; k < SEEDS; k++) res[v].push(runOne([id, id, id], seedOf(k), POLICY, id));
      restore();
    }
    const full = res.full;
    for (const v of VARIANTS) {
      if (v === 'full') continue;
      const xs = res[v];
      // paired differences (variant − full), per FULL cast
      const casts = mean(full.map(o => o.casts));
      const diff = (f: (o: Outcome) => number) => full.map((o, i) => f(xs[i]) - f(o));
      const dHp = diff(o => o.hpLost);
      const dTaken = diff(o => o.taken);
      const dDeaths = diff(o => o.deaths);
      const dFloors = diff(o => o.floors);
      // time over floors both cleared (normal floors only)
      const dNormal = full.map((o, i) => {
        let a = 0;
        let b = 0;
        for (let f = 0; f < FLOORS; f++) {
          if ((f + 1) % 5 === 0) continue;
          if (o.floorSec[f] != null && xs[i].floorSec[f] != null) {
            a += o.floorSec[f];
            b += xs[i].floorSec[f];
          }
        }
        return b - a;
      });
      const dBoss = full.map((o, i) => (o.bossSec != null && xs[i].bossSec != null ? xs[i].bossSec! - o.bossSec : NaN)).filter(Number.isFinite);
      const se = (d: number[]) => sd(d) / Math.sqrt(d.length);
      rows.push({
        char: id,
        variant: v,
        castsPerRun: r1(casts),
        'ΔhpLost/cast': `${r0(mean(dHp) / casts)} ±${r0(se(dHp) / casts)}`,
        'Δtaken/cast': `${r0(mean(dTaken) / casts)} ±${r0(se(dTaken) / casts)}`,
        'Δdeaths/run': `${r1(mean(dDeaths))} ±${r1(se(dDeaths))}`,
        'Δfloors/run': r1(mean(dFloors)),
        'ΔnormalSec/run': `${r1(mean(dNormal))} ±${r1(se(dNormal))}`,
        'ΔbossSec': dBoss.length ? `${r1(mean(dBoss))} ±${r1(se(dBoss))}` : '-',
        wipesFull: full.filter(o => o.wipe).length,
        wipesVar: xs.filter(o => o.wipe).length,
        bossClrFull: full.filter(o => o.bossCleared).length,
        bossClrVar: xs.filter(o => o.bossCleared).length,
        hpLostFullRun: r0(mean(full.map(o => o.hpLost))),
        normalSecFull: r1(mean(full.map(o => o.normalSec))),
      });
    }
    console.error(`${id} done`);
  }
  console.table(rows);
  out.rows = rows;
} else if (MODE === 'pacing') {
  const parties = (env.PARTIES ?? 'blade,mage,cleric;guardian,ranger,bard;paladin,gunner,chrono;warden,shadow,berserker').split(';').map(s => s.split(','));
  const oldPath = env.OLD_CHARS;
  if (!oldPath) throw new Error('OLD_CHARS=<json [{id, drag, swapCooldown}] of the pre-pass data (git HEAD)> required');
  const oldChars = JSON.parse(fs.readFileSync(oldPath, 'utf8')) as Pick<CharacterDef, 'id' | 'drag' | 'swapCooldown'>[];
  const applyOld = () => {
    for (const c of CHARACTERS) {
      const o = oldChars.find(x => x.id === c.id)!;
      c.drag = structuredClone(o.drag);
      c.swapCooldown = o.swapCooldown;
    }
  };
  const table: Record<string, unknown>[] = [];
  for (const party of parties) {
    for (const ver of ['old', 'new']) {
      if (ver === 'old') applyOld();
      else restore();
      const runs: Outcome[] = [];
      for (let k = 0; k < SEEDS; k++) runs.push(runOne(party, seedOf(k), 'best', null));
      const row: Record<string, unknown> = { party: party.join('/'), ver };
      for (let f = 1; f <= FLOORS; f++) {
        const secs = runs.map(o => o.floorSec[f - 1]).filter((x): x is number => x != null).sort((a, b) => a - b);
        row[`F${f}`] = secs.length ? `${r1(secs[Math.floor(secs.length / 2)])} (${secs.length})` : '-';
      }
      row.timeouts = runs.reduce((a, o) => a + o.timeouts, 0);
      row.wipes = runs.filter(o => o.wipe).length;
      row.deaths = r1(mean(runs.map(o => o.deaths)));
      row.myDeaths = r1(mean(runs.map(o => o.myDeaths)));
      table.push(row);
    }
    restore();
    console.error(`${party.join('/')} done`);
  }
  console.table(table);
  out.table = table;
}
if (MODE === 'stunprobe') {
  // Of the enemy-seconds my drag stun is credited with (bench: × enemy DPS), how many were on an enemy that was
  // actually in attack range of its target (could have hit someone)?
  for (const id of CHARS) {
    let all = 0;
    let engaged = 0;
    let allDps = 0;
    let engDps = 0;
    for (let k = 0; k < SEEDS; k++) {
      runOne([id, id, id], seedOf(k), POLICY, id, w => {
        for (const e of w.state.entities) {
          if (e.team !== 'enemy' || !isAlive(e)) continue;
          const st = e.statuses.find(x => x.id === 'stun') as (typeof e.statuses)[number] & { sourcePlayer?: number | null; src?: string } | undefined;
          if (!st || st.sourcePlayer !== 0 || st.src !== 'drag') continue;
          const dps = effStats(w, e).atk * e.rt.base.atkSpeed;
          all += DT;
          allDps += DT * dps;
          const t = getEntity(w, e.targetId);
          if (t && isAlive(t) && edgeDist(e, t) <= e.rt.base.range + 0.05) {
            engaged += DT;
            engDps += DT * dps;
          }
        }
      });
    }
    console.log(id, 'stunned enemy-s', r1(all), 'in range of its target', `${Math.round((100 * engaged) / Math.max(1e-9, all))}%`, 'DPS-weighted', `${Math.round((100 * engDps) / Math.max(1e-9, allDps))}%`);
  }
}
if (MODE === 'zoneticks') {
  // how many times does a drag zone actually apply its effects? (cleric: "4초간 0.5초마다")
  const human: PlayerSetup = { name: '나', isBot: false, characters: ['blade', 'cleric', 'mage'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] };
  const { world: w } = createGameWithWorld({ seed: 1, players: [human], tunables: { ...DEFAULT_TUNABLES } });
  for (let t = 0; t < TICK_RATE * 2; t++) tick(w);
  const me = activeEntity(w, w.state.players[0])!;
  const r = dispatch(w, { type: 'swap', player: 0, partyIndex: 1, pos: { ...me.pos } });
  const z = w.state.zones.find(q => q.ownerPlayer === 0 && q.rt.ctx.slot === 'drag');
  let applied = 0;
  let prev = z?.rt.nextTick ?? 0;
  for (let t = 0; t < TICK_RATE * 6 && z && w.state.zones.includes(z); t++) {
    tick(w);
    if (z.rt.nextTick > prev + 1e-9) applied++;
    prev = z.rt.nextTick;
  }
  console.log('swap ok', r.ok, 'zone', !!z, 'duration', z?.total, 'tickInterval', z?.rt.tickInterval, 'applications', applied);
}
if (MODE === 'rows') {
  for (const c of CHARACTERS) {
    const r = skillRows(c).find(x => x.kind === 'drag')!;
    console.log(c.name, r.trigger, '|', r.summary);
  }
}
if (env.OUT) fs.writeFileSync(env.OUT, JSON.stringify(out, null, 1));
