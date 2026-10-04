// What cutting bench swap cooldowns is worth in casts (docs/balance.md 3장 크로노 쿨 감소, 0-2 기획 6차 쿨 시작 시점).
// Run: npx vite-node tests/playtest/cd-cut.ts
//   env: CUT_SEEDS=24 CUT_SEED0=0 CUT_FLOORS=3 CUT_PARTY=chrono,blade,mage CUT_RHYTHMS=4,3,2,0
//        CUT_VARIANTS=full,noDragCut,swapcd2,rabbit,hunter  CUT_OUT=path.json
//
// Player 0 = CUT_PARTY, swaps to the next ready card (rotation) every R s (R = 0: as soon as one is ready), bot aim,
// ult 0.5 s after full, drag-neutral floor rewards (like drag-bench.ts). Players 1–2 = stock bots. Variants (paired
// seeds):
//   full       — data as is
//   noDragCut  — 크로노's drag skill without its bench cooldown cut (ult cut kept)
//   swapcd2    — + "빠른 교대" −2 s on all three cards (rare floor reward)
//   rabbit     — 시간 토끼 pet (bench cd −4 s), used whenever ready in combat
//   hunter     — 사냥꾼의 표식 relic (bench cd −0.5 s per kill)
// Reported: drag casts per combat minute (all cards / 크로노 only), bench cooldown actually cut per 크로노 drag cast,
// player 0's drag damage and the party's damage taken per combat minute, floor 1..N time.
// "extra casts per 크로노 cast" = (casts/min full − noDragCut) ÷ 크로노 casts/min (full); one extra cast of a card with
// cooldown C is worth ≈ C × the roster's mean value per cooldown-second, so the cdSec weight (drag-value.ts) this
// party implies = extra casts × mean cooldown of the cast cards ÷ cut seconds per 크로노 cast measured HERE.
// (drag-bench.ts measures the cut in a 크로노×3 party, where part of it is lost to the swap rhythm: compare the
// extra value per cast, not the weights — docs/balance.md 0-2.)

import fs from 'node:fs';
import { BOT_PRESETS, DEFAULT_TUNABLES, TICK_RATE } from '../../src/config';
import { getCharacter, getReward } from '../../src/data';
import { bestDropPoint } from '../../src/sim/bot';
import { createGameWithWorld, dispatch, tick } from '../../src/sim/game';
import { canSwap, canUsePet } from '../../src/sim/players';
import { activeEntity, isAlive } from '../../src/sim/world';
import type { PlayerSetup, RewardEffect } from '../../src/types';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const SEEDS = Number(env.CUT_SEEDS ?? 24);
const SEED0 = Number(env.CUT_SEED0 ?? 0);
const FLOORS = Number(env.CUT_FLOORS ?? 3);
const PARTY = (env.CUT_PARTY ?? 'chrono,blade,mage').split(',');
const RHYTHMS = (env.CUT_RHYTHMS ?? '4,3,2,0').split(',').map(Number);
const VARIANTS = (env.CUT_VARIANTS ?? 'full,noDragCut,swapcd2,rabbit,hunter').split(',');
const DT = 1 / TICK_RATE;

function rewardRank(eff: RewardEffect): number {
  switch (eff.kind) {
    case 'petCooldown':
      return 0;
    case 'skill':
      return eff.slot === 'normal' ? 1 : eff.slot === 'ult' ? 2 : eff.slot === 'basic' ? 3 : 20;
    case 'stat':
      return eff.mods.defFlat ? 4 : eff.mods.hpPct ? 5 : eff.mods.atkSpeedPct ? 6 : eff.mods.critChance ? 7 : 8;
    case 'appearShield':
      return 15;
    case 'swapCooldown':
      return 16;
  }
}

interface Acc {
  runs: number;
  combatSec: number;
  casts: number;
  castCdSum: number;
  chronoCasts: number;
  chronoCut: number;
  floorSec: number;
  floorsCleared: number;
  wipes: number;
  /** Player 0's drag damage (all cards) and party damage taken. */
  dragDmg: number;
  partyTaken: number;
}
const newAcc = (): Acc => ({ runs: 0, combatSec: 0, casts: 0, castCdSum: 0, chronoCasts: 0, chronoCut: 0, floorSec: 0, floorsCleared: 0, wipes: 0, dragDmg: 0, partyTaken: 0 });

const chronoCutEffects = getCharacter('chrono')
  .drag.actions.flatMap(a => a.effects)
  .filter((e): e is Extract<typeof e, { kind: 'swapCooldownReduce' }> => e.kind === 'swapCooldownReduce');
const chronoCutSeconds = chronoCutEffects.map(e => e.seconds);

function runOne(variant: string, rhythm: number, seed: number, acc: Acc): void {
  chronoCutEffects.forEach((e, i) => (e.seconds = variant === 'noDragCut' ? 0 : chronoCutSeconds[i]));
  const pets = variant === 'rabbit' ? ['rabbit_time', 'frog_bomb', 'fairy_heal'] : ['frog_bomb', 'fairy_heal', 'cat_void'];
  const human: PlayerSetup = { name: '나', isBot: false, characters: [...PARTY], pets };
  const players: PlayerSetup[] = [human, ...BOT_PRESETS.map(b => ({ name: b.name, isBot: true, characters: [...b.characters], pets: [...b.pets] }))];
  const { world: w } = createGameWithWorld({ seed, players, tunables: { ...DEFAULT_TUNABLES } });
  const s = w.state;
  const p = s.players[0];
  if (variant === 'swapcd2') for (let i = 0; i < p.party.length; i++) p.rewards.push({ rewardId: 'swapcd_rare', partyIndex: i });
  if (variant === 'hunter') p.relics.push('hunter_mark');
  let lastSwap = -99;
  let ultAt: number | null = null;
  let think = 0;
  let card = 0;
  const maxTicks = TICK_RATE * 60 * 30;
  for (let t = 0; t < maxTicks; t++) {
    if (s.floor > FLOORS) break;
    if (s.phase === 'reward') {
      if (s.floor >= FLOORS) break;
      const offers = s.rewardOffersByPlayer[0] ?? s.rewardOffers ?? [];
      let pick = 0;
      offers.forEach((o, i) => {
        if (!o.isRelic && rewardRank(getReward(o.rewardId).effect) < rewardRank(getReward(offers[pick].rewardId).effect)) pick = i;
      });
      dispatch(w, { type: 'chooseReward', player: 0, offerIndex: pick });
      lastSwap = -99;
      continue;
    }
    if (s.phase === 'runOver') {
      if (s.runResult?.reason === 'wipe') acc.wipes++;
      break;
    }
    if (s.phase === 'combat') acc.combatSec += DT;
    think -= DT;
    if (think <= 0 && s.phase === 'combat' && !p.out) {
      think = 0.25;
      const me = activeEntity(w, p);
      const foes = s.entities.filter(e => e.team === 'enemy' && isAlive(e));
      if (p.ult.charge >= 1 && me && foes.length) {
        if (ultAt == null) ultAt = s.time + 0.5;
        if (s.time >= ultAt && dispatch(w, { type: 'ult', player: 0 }).ok) ultAt = null;
      }
      if (variant === 'rabbit' && me && foes.length && canUsePet(w, 0, 0).ok) dispatch(w, { type: 'pet', player: 0, petIndex: 0, pos: { ...me.pos } });
      const ready = [0, 1, 2].filter(i => canSwap(w, 0, i).ok);
      const due = (s.time - lastSwap >= rhythm || !me) && (foes.length > 0 || !me);
      if (ready.length && due) {
        const idx = [1, 2, 0].map(k => (card + k) % 3).find(i => ready.includes(i))!;
        const benchCd = p.party.map(m => m.swapCooldownRemaining);
        const leaving = p.activeIndex;
        if (dispatch(w, { type: 'swap', player: 0, partyIndex: idx, pos: bestDropPoint(w, p, idx) }).ok) {
          lastSwap = s.time;
          card = idx;
          acc.casts++;
          acc.castCdSum += getCharacter(p.party[idx].defId).swapCooldown;
          if (p.party[idx].defId === 'chrono') {
            acc.chronoCasts++;
            const leaveStartsCd = p.party[idx].swapCooldownRemaining <= 1e-9;
            p.party.forEach((m, i) => {
              if (i === idx) return;
              const base = i === leaving && leaveStartsCd ? m.swapCooldownTotal : benchCd[i];
              acc.chronoCut += Math.max(0, base - m.swapCooldownRemaining);
            });
          }
        }
      }
    }
    tick(w);
    w.events.length = 0;
  }
  const ft = w.floorTimes.filter(f => f.outcome === 'clear' && f.floor <= FLOORS);
  acc.floorsCleared += ft.length;
  if (ft.length === FLOORS) acc.floorSec += ft.reduce((a, f) => a + f.seconds, 0);
  acc.runs++;
  acc.dragDmg += p.stats.damageBySource.drag;
  for (const q of s.players) acc.partyTaken += q.stats.damageTaken;
  chronoCutEffects.forEach((e, i) => (e.seconds = chronoCutSeconds[i]));
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const out: Record<string, unknown> = { seeds: SEEDS, seed0: SEED0, floors: FLOORS, party: PARTY };
const rows: Record<string, unknown>[] = [];
for (const rhythm of RHYTHMS) {
  const accs: Record<string, Acc> = {};
  for (const v of VARIANTS) {
    const acc = newAcc();
    for (let k = 0; k < SEEDS; k++) runOne(v, rhythm, 7001 + (SEED0 + k) * 104729, acc);
    accs[v] = acc;
  }
  const cpm = (a: Acc) => a.casts / Math.max(1e-9, a.combatSec / 60);
  const full = accs.full;
  for (const v of VARIANTS) {
    const a = accs[v];
    const row: Record<string, unknown> = {
      rhythm: rhythm || 'ready',
      variant: v,
      castsPerMin: r2(cpm(a)),
      secPerSwap: r2(60 / cpm(a)),
      vsFull: full ? `${Math.round((100 * cpm(a)) / cpm(full))}%` : '',
      chronoPerMin: r2(a.chronoCasts / Math.max(1e-9, a.combatSec / 60)),
      cutPerChronoCast: r1(a.chronoCut / Math.max(1, a.chronoCasts)),
      dragDmgPerMin: Math.round(a.dragDmg / Math.max(1e-9, a.combatSec / 60)),
      takenPerMin: Math.round(a.partyTaken / Math.max(1e-9, a.combatSec / 60)),
      floorSecAvg: r1(a.floorSec / Math.max(1, a.runs)),
      cleared: `${a.floorsCleared}/${a.runs * FLOORS}`,
      wipes: a.wipes,
    };
    if (v === 'noDragCut' && full && full.chronoCasts > 0) {
      const extra = (cpm(full) - cpm(a)) / (full.chronoCasts / (full.combatSec / 60));
      const meanCd = full.castCdSum / Math.max(1, full.casts);
      const cut = full.chronoCut / Math.max(1, full.chronoCasts);
      row.extraPerChronoCast = r2(extra);
      row.impliedCdSecWeight = r2((extra * meanCd) / Math.max(1e-9, cut));
      // the same in drag damage only (no CC / support): extra drag damage per 크로노 cast
      const chronoPerMin = full.chronoCasts / (full.combatSec / 60);
      row.extraDragDmgPerChronoCast = Math.round((full.dragDmg / (full.combatSec / 60) - a.dragDmg / (a.combatSec / 60)) / chronoPerMin);
    }
    rows.push(row);
  }
  console.error(`rhythm ${rhythm || 'ready'} done`);
}
console.table(rows);
out.rows = rows;
if (env.CUT_OUT) fs.writeFileSync(env.CUT_OUT, JSON.stringify(out, null, 1));
