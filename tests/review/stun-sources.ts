// Independent review (not a test; run by hand): what the 4차 rule ("기절하면 공격 대기시간이 멈춤") did to the stuns
// that are NOT drag skills — pets (owl_frost, cat_void), guardian's normal skill, paladin / warden / chrono ults, the
// ogre's slam on players — plus a stun-lock check on the ogre (mid boss, not immune).
//
// All three players are bots (stock bot behaviour: aim, pets, ults, random rewards). Paired seeds, floors 1..FLOORS.
// Rules: new = the sim as is; old = the 2차 rule emulated (before each tick, every stunned unit's attack timer counts
// down by one tick — exactly what unitTimers did before dd240f1).
// Variants remove the stun from one source group at runtime (data mutated in memory, restored after):
//   full · noPet (owl_frost, cat_void) · noNormal (guardian) · noUlt (paladin, warden, chrono) · noOgre (ogre slam) · noDrag
// Outcome per run: party damage taken / HP lost (shield-absorbed excluded) / deaths / wipe / boss clear, and on the
// ogre: share of its alive-and-engaged time spent stunned, basic attacks per engaged second, slams.
//
// env: SEEDS=48 SEED0=9000 FLOORS=5 PARTY=guardian,paladin,chrono PETS=owl_frost,cat_void,frog_bomb VARIANTS=full,noPet,…
// Run: npx vite-node tests/review/stun-sources.ts

import { BOT_PRESETS, DEFAULT_TUNABLES, TICK_RATE } from '../../src/config';
import { CHARACTERS, PETS, getMonster } from '../../src/data';
import { createGameWithWorld, tick } from '../../src/sim/game';
import { hasStatus } from '../../src/sim/status';
import { effStats } from '../../src/sim/stats';
import { edgeDist, getEntity, isAlive, type SimEntity, type SimStatus, type World } from '../../src/sim/world';
import type { BossDef, Effect, PlayerSetup, SkillAction } from '../../src/types';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const SEEDS = Number(env.SEEDS ?? 48);
const SEED0 = Number(env.SEED0 ?? 9000);
const FLOORS = Number(env.FLOORS ?? 5);
const PARTY = (env.PARTY ?? 'guardian,paladin,chrono').split(',');
const PET_IDS = (env.PETS ?? 'owl_frost,cat_void,frog_bomb').split(',');
const VARIANTS = (env.VARIANTS ?? 'full,noPet,noNormal,noUlt,noOgre,noDrag').split(',');
const DT = 1 / TICK_RATE;

const isStun = (e: Effect) => e.kind === 'status' && e.status === 'stun';
const strip = (a: SkillAction): SkillAction => ({ ...a, effects: a.effects.filter(e => !isStun(e)) });

// originals
const ORIG = {
  chars: new Map(CHARACTERS.map(c => [c.id, structuredClone({ normal: c.normal, drag: c.drag, ult: c.ult })])),
  pets: new Map(PETS.map(p => [p.id, structuredClone(p.action)])),
  ogre: structuredClone(getMonster('ogre').skills![0].action),
};
function restore(): void {
  for (const c of CHARACTERS) {
    const o = structuredClone(ORIG.chars.get(c.id)!);
    c.normal = o.normal;
    c.drag = o.drag;
    c.ult = o.ult;
  }
  for (const p of PETS) p.action = structuredClone(ORIG.pets.get(p.id)!);
  getMonster('ogre').skills![0].action = structuredClone(ORIG.ogre);
}
function setVariant(v: string): void {
  restore();
  if (v === 'noPet') for (const p of PETS) p.action = strip(p.action);
  if (v === 'noNormal') for (const c of CHARACTERS) c.normal = { ...c.normal, actions: c.normal.actions.map(strip) };
  if (v === 'noUlt') for (const c of CHARACTERS) c.ult = { ...c.ult, actions: c.ult.actions.map(strip) };
  if (v === 'noDrag') for (const c of CHARACTERS) c.drag = { ...c.drag, actions: c.drag.actions.map(strip) };
  if (v === 'noOgre') getMonster('ogre').skills![0].action = strip(getMonster('ogre').skills![0].action);
}

interface Out {
  taken: number;
  hpLost: number;
  deaths: number;
  wipe: boolean;
  boss: boolean;
  casts: Record<string, number>;
  ogreEng: number;
  ogreEngStun: number;
  ogreAttacks: number;
  ogreSlams: number;
  /** character-seconds stunned (players) and their attack-timer seconds frozen while a target was in reach */
  charStun: number;
  /** per stun source (status src): stunned enemy-s, engaged enemy-s, HP kept (new rule: every engaged s; old: engaged s with the swing due) */
  src: Record<string, { sec: number; eng: number; hpNew: number; hpOld: number }>;
  /** player characters stunned by monsters: engaged s and their basic damage lost (new: every engaged s; old: swing due) */
  charEng: number;
  charLostNew: number;
  charLostOld: number;
  dealt: number;
}

function dps(w: World, e: SimEntity): number {
  let aps = effStats(w, e).atkSpeed;
  if (e.enraged && e.rt.monDef?.tier === 'boss') aps *= (e.rt.monDef as BossDef).enrage.atkSpeedMult;
  return effStats(w, e).atk * aps;
}
function engaged(w: World, e: SimEntity, kind: 'character' | 'enemy'): SimEntity | null {
  const t = getEntity(w, e.targetId);
  if (!t || !isAlive(t)) return null;
  if (kind === 'character' && t.kind !== 'character') return null;
  return edgeDist(e, t) <= e.rt.base.range + 0.05 ? t : null;
}

function runOne(seed: number, rule: 'new' | 'old'): Out {
  const me: PlayerSetup = { name: 'P', isBot: true, characters: PARTY, pets: PET_IDS };
  const players: PlayerSetup[] = [me, ...BOT_PRESETS.map(b => ({ name: b.name, isBot: true, characters: [...b.characters], pets: [...b.pets] }))];
  const { world: w } = createGameWithWorld({ seed, players, tunables: { ...DEFAULT_TUNABLES } });
  const s = w.state;
  const o: Out = { taken: 0, hpLost: 0, deaths: 0, wipe: false, boss: false, casts: {}, ogreEng: 0, ogreEngStun: 0, ogreAttacks: 0, ogreSlams: 0, charStun: 0, src: {}, charEng: 0, charLostNew: 0, charLostOld: 0, dealt: 0 };
  let absorbed = 0;
  const ogreIds = new Set<number>();
  for (let t = 0; t < TICK_RATE * 60 * 40; t++) {
    if (s.floor > FLOORS || (s.phase === 'reward' && s.floor >= FLOORS)) break;
    if (s.phase === 'runOver') {
      if (s.runResult?.reason === 'wipe') o.wipe = true;
      break;
    }
    if (rule === 'old') {
      // 2차 rule: the attack timer keeps counting down during a stun (unitTimers skips it now → do it here)
      for (const e of s.entities) if (isAlive(e) && hasStatus(e, 'stun')) e.rt.attackCd = e.rt.attackCd - DT <= 1e-6 ? 0 : e.rt.attackCd - DT;
    }
    tick(w as World);
    for (const e of s.entities) {
      if (!isAlive(e)) continue;
      if (e.defId === 'ogre') {
        ogreIds.add(e.id);
        const tg = getEntity(w, e.targetId);
        if (tg && isAlive(tg) && edgeDist(e, tg) <= e.rt.base.range + 0.05) {
          o.ogreEng += DT;
          if (hasStatus(e, 'stun')) o.ogreEngStun += DT;
        }
      }
      if (e.kind === 'character' && hasStatus(e, 'stun')) {
        o.charStun += DT;
        const t = engaged(w, e, 'enemy');
        if (t) {
          o.charEng += DT;
          const d = dps(w, e) * (1 - effStats(w, t).def);
          o.charLostNew += DT * d;
          if (e.rt.attackCd <= 0) o.charLostOld += DT * d;
        }
      }
      if (e.team === 'enemy') {
        for (const st of e.statuses as SimStatus[]) {
          if (st.id !== 'stun') continue;
          const k = st.sourcePlayer == null ? 'monster' : (st.src ?? '?');
          const a = (o.src[k] ??= { sec: 0, eng: 0, hpNew: 0, hpOld: 0 });
          a.sec += DT;
          const t = engaged(w, e, 'character');
          if (!t) continue;
          a.eng += DT;
          const d = dps(w, e) * (1 - effStats(w, t).def);
          a.hpNew += DT * d;
          if (e.rt.attackCd <= 0) a.hpOld += DT * d;
        }
      }
    }
    for (const ev of w.events) {
      if (ev.type === 'damage' && ev.targetTeam === 'ally') absorbed += ev.absorbed ?? 0;
      if (ev.type === 'death' && ev.kind === 'character') o.deaths++;
      if (ev.type === 'attack' && ogreIds.has(ev.sourceId)) o.ogreAttacks++;
      if (ev.type === 'skillCast') {
        const k = `${ev.slot}:${ev.skillId}`;
        o.casts[k] = (o.casts[k] ?? 0) + 1;
        if (ev.skillId === 'ogre_slam') o.ogreSlams++;
      }
    }
    w.events.length = 0;
  }
  for (const f of w.floorTimes) if (f.floor === 5 && f.outcome === 'clear') o.boss = true;
  for (const q of s.players) {
    o.taken += q.stats.damageTaken;
    o.dealt += q.stats.damageDealt;
  }
  o.hpLost = o.taken - absorbed;
  return o;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const se = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1) / Math.max(1, xs.length));
};
const seedOf = (k: number) => 7001 + (SEED0 + k) * 104729;

const res: Record<string, Out[]> = {};
for (const rule of ['new', 'old'] as const) {
  for (const v of VARIANTS) {
    setVariant(v);
    res[`${rule}/${v}`] = Array.from({ length: SEEDS }, (_, k) => runOne(seedOf(k), rule));
  }
}
restore();

console.log(`party ${PARTY.join(',')} pets ${PET_IDS.join(',')} + 2 stock bots · seeds ${SEEDS} (SEED0 ${SEED0}) · floors 1..${FLOORS}`);
const castKeys = ['pet:owl_frost', 'pet:cat_void', 'normal:guardian_normal', 'ult:paladin_ult', 'ult:warden_ult', 'ult:chrono_ult', 'monster:ogre_slam'];
const full = res['new/full'];
const allCasts: Record<string, number> = {};
for (const r of full) for (const [k, n] of Object.entries(r.casts)) allCasts[k] = (allCasts[k] ?? 0) + n;
console.log('casts per run (new/full):', Object.fromEntries(Object.entries(allCasts).filter(([k]) => /pet:|ult:|ogre|guardian/.test(k)).map(([k, n]) => [k, +(n / SEEDS).toFixed(2)])));
void castKeys;
// per-source attribution (full variant): HP kept per stun-casting cast. Pets: owl_frost + cat_void casts (all players);
// normal: guardian_n; ult: paladin_u + warden_u + chrono_u; drag: every stun drag.
const castsOf = (re: RegExp) => Object.entries(allCasts).filter(([k]) => re.test(k)).reduce((a, [, n]) => a + n, 0);
const groups: Record<string, RegExp> = { pet: /^pet:(owl_frost|cat_void)$/, normal: /^normal:guardian_n$/, ult: /^ult:(paladin_u|warden_u|chrono_u)$/, drag: /^drag:(guardian_d|paladin_d|blade_d|shadow_d|chrono_d)$/ };
for (const rule of ['new', 'old'] as const) {
  const runs = res[`${rule}/full`];
  const tot: Record<string, { sec: number; eng: number; hpNew: number; hpOld: number }> = {};
  for (const r of runs) for (const [k, a] of Object.entries(r.src)) {
    const t = (tot[k] ??= { sec: 0, eng: 0, hpNew: 0, hpOld: 0 });
    t.sec += a.sec; t.eng += a.eng; t.hpNew += a.hpNew; t.hpOld += a.hpOld;
  }
  for (const [k, t] of Object.entries(tot)) {
    const n = groups[k] ? castsOf(groups[k]) : 0;
    const hp = rule === 'new' ? t.hpNew : t.hpOld;
    console.log(`${rule} rule · stun src ${k.padEnd(7)} enemy-s/run ${(t.sec / SEEDS).toFixed(1)} engaged ${((100 * t.eng) / Math.max(1e-9, t.sec)).toFixed(0)}% · HP kept/run ${(hp / SEEDS).toFixed(0)}${n ? ` · per cast ${(hp / n).toFixed(1)} (${(n / SEEDS).toFixed(1)} casts/run)` : ''}`);
  }
  const lost = rule === 'new' ? mean(runs.map(r => r.charLostNew)) : mean(runs.map(r => r.charLostOld));
  console.log(`${rule} rule · monster stun on characters: char-s/run ${mean(runs.map(r => r.charStun)).toFixed(1)}, engaged ${mean(runs.map(r => r.charEng)).toFixed(1)} s · basic dmg lost/run ${lost.toFixed(0)} (${((100 * lost) / mean(runs.map(r => r.dealt))).toFixed(2)}% of party damage)`);
}
for (const rule of ['new', 'old'] as const) {
  const base = res[`${rule}/full`];
  for (const v of VARIANTS) {
    const r = res[`${rule}/${v}`];
    const dTaken = r.map((x, i) => x.taken - base[i].taken);
    const dLost = r.map((x, i) => x.hpLost - base[i].hpLost);
    const og = r.reduce((a, x) => a + x.ogreEng, 0);
    const ogs = r.reduce((a, x) => a + x.ogreEngStun, 0);
    const oga = r.reduce((a, x) => a + x.ogreAttacks, 0);
    console.log(
      `${rule.padEnd(3)} ${v.padEnd(8)} taken ${mean(r.map(x => x.taken)).toFixed(0).padStart(7)}  Δtaken ${mean(dTaken).toFixed(0).padStart(6)} ±${se(dTaken).toFixed(0).padStart(4)}  ΔhpLost ${mean(dLost).toFixed(0).padStart(6)} ±${se(dLost).toFixed(0).padStart(4)}  deaths ${mean(r.map(x => x.deaths)).toFixed(2)}  wipes ${r.filter(x => x.wipe).length}  boss ${r.filter(x => x.boss).length}  ogre: stunned ${((100 * ogs) / Math.max(1e-9, og)).toFixed(0)}% of engaged · attacks/engaged s ${(oga / Math.max(1e-9, og)).toFixed(2)} · slams/run ${mean(r.map(x => x.ogreSlams)).toFixed(2)}  char stunned s/run ${mean(r.map(x => x.charStun)).toFixed(1)}`,
    );
  }
}
