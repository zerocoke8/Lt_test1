// Randomized invariant check: random (and garbage) commands from a "human" + 2 bots for several sim minutes,
// verifying read-model consistency after every tick and every command.

import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../../src/config';
import { tick } from '../../src/sim/game';
import { Rng } from '../../src/sim/rng';
import type { Command } from '../../src/types';
import { BOT1, BOT2, HUMAN, makeGame, type TestGame } from '../sim/helpers';

function check(tg: TestGame, where: string): string[] {
  const s = tg.w.state;
  const errs: string[] = [];
  const bad = (m: string) => errs.push(`${where} t=${s.time.toFixed(2)} f${s.floor}: ${m}`);
  const finite = (x: number) => Number.isFinite(x);
  for (const p of s.players) {
    const chars = s.entities.filter(e => e.kind === 'character' && e.ownerPlayer === p.id && !e.rt.gone);
    if (chars.length > 1) bad(`p${p.id} has ${chars.length} field characters`);
    if ((p.activeIndex != null) !== (chars.length === 1)) bad(`p${p.id} activeIndex ${p.activeIndex} vs ${chars.length} entities`);
    if (p.activeIndex != null && chars[0] && chars[0].partyIndex !== p.activeIndex) bad(`p${p.id} active entity partyIndex mismatch`);
    p.party.forEach((m, i) => {
      if (i !== p.activeIndex && m.entityId != null) bad(`p${p.id} bench member ${i} still has entity ${m.entityId}`);
      if (m.dead && (m.hp !== 0 || m.entityId != null)) bad(`p${p.id} dead member ${i} hp=${m.hp} ent=${m.entityId}`);
      if (!m.dead && !(m.hp > 0)) bad(`p${p.id} alive member ${i} hp=${m.hp}`);
      if (m.hp > m.maxHp + 1e-6) bad(`p${p.id} member ${i} hp ${m.hp} > max ${m.maxHp}`);
      if (!(m.swapCooldownRemaining >= 0) || !(m.reviveRemaining >= 0)) bad(`p${p.id} member ${i} negative/NaN timers`);
      // 기획 6차: the cooldown starts when a card leaves the field, so the field card never has one
      if (i === p.activeIndex && m.swapCooldownRemaining !== 0) bad(`p${p.id} field member ${i} cooling ${m.swapCooldownRemaining}`);
      if (!m.dead && m.reviveRemaining !== 0) bad(`p${p.id} alive member ${i} revive ${m.reviveRemaining}`);
    });
    if (p.out && !p.party.every(m => m.dead)) bad(`p${p.id} out but not all dead`);
    if (!(p.ult.charge >= 0 && p.ult.charge <= 1)) bad(`p${p.id} ult charge ${p.ult.charge}`);
    if ((p.ult.charge >= 1) !== (p.ult.fullSince != null) && s.phase === 'combat' && !p.out) bad(`p${p.id} fullSince ${p.ult.fullSince} charge ${p.ult.charge}`);
    if (p.appearLock < 0) bad(`p${p.id} appearLock < 0`);
  }
  for (const e of s.entities) {
    if (e.rt.gone) continue;
    if (!finite(e.hp) || !finite(e.pos.x) || !finite(e.pos.y) || !finite(e.maxHp)) bad(`entity ${e.id} non-finite`);
    if (e.hp > e.maxHp + 1e-6) bad(`entity ${e.id} ${e.defId} hp ${e.hp} > ${e.maxHp}`);
    if (e.kind !== 'character' && e.team === 'enemy' && e.tier !== 'boss' && e.hp <= 0) bad(`dead enemy ${e.id} still listed`);
  }
  if (s.phase === 'reward') {
    const human = s.players[0];
    if (!human.out && !s.rewardOffers) bad('reward phase without offers for the living human');
    if (s.entities.some(e => e.team === 'enemy')) bad('enemies alive during reward');
  }
  if (s.phase === 'combat' && s.plan.kind === 'boss' && s.bossId == null) bad('boss floor without boss');
  if (s.phase === 'combat' && s.plan.kind === 'normal' && s.floorTime > s.plan.timeLimit + 1e-6) bad('normal floor past time limit still in combat');
  return errs;
}

function randomCommand(r: Rng, n: number): Command {
  const k = r.next();
  const garbage = r.chance(0.08);
  const pos = garbage ? { x: r.pick([NaN, -50, 1e9, Infinity]), y: r.pick([NaN, -3, 99]) } : { x: r.range(-2, 40), y: r.range(-2, 14) };
  const player = garbage ? r.pick([-1, 3, 0.5, 1]) : r.int(0, n - 1);
  if (k < 0.45) return { type: 'swap', player, partyIndex: garbage ? r.pick([-1, 3, 1.5]) : r.int(0, 2), pos };
  if (k < 0.65) return { type: 'pet', player, petIndex: garbage ? r.pick([-1, 9]) : r.int(0, 2), pos };
  if (k < 0.8) return { type: 'ult', player };
  if (k < 0.97) return { type: 'chooseReward', player, offerIndex: garbage ? r.pick([-1, 5, 1.2]) : r.int(0, 2) };
  return {
    type: 'debug',
    action: r.pick([{ kind: 'killAll' }, { kind: 'chargeUlt' }, { kind: 'resetCooldowns' }, { kind: 'forceEnrage' }, { kind: 'skipFloor' }] as const),
  };
}

describe('invariants under random commands', () => {
  const cases = [
    { seed: 1, t: { maxFloor: 12, reviveTime: 8 } },
    { seed: 2, t: { maxFloor: 12, reviveTime: 8 } },
    { seed: 3, t: { maxFloor: 12, reviveTime: 20, monsterDmgMult: 4 } },
    { seed: 4, t: { maxFloor: 12, reviveTime: 30, monsterDmgMult: 6, bossFloorTime: 30 } },
  ];
  for (const { seed, t } of cases) {
    it(`seed ${seed} ${JSON.stringify(t)}: 6 sim minutes, no broken invariant`, () => {
      const tg = makeGame({ seed, players: [HUMAN, BOT1, BOT2], tunables: t });
      const r = new Rng(seed * 7919);
      const errs: string[] = [];
      const s = tg.w.state;
      for (let i = 0; i < 6 * 60 * TICK_RATE && s.phase !== 'runOver'; i++) {
        if (s.phase === 'combat') tick(tg.w);
        errs.push(...check(tg, 'tick'));
        if (r.chance(0.06)) {
          const cmd = randomCommand(r, s.players.length);
          tg.game.dispatch(cmd);
          errs.push(...check(tg, `after ${JSON.stringify(cmd)}`));
        }
        if (s.phase === 'reward' && r.chance(0.2)) tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: r.int(0, 2) });
        tg.game.drainEvents();
        if (errs.length > 20) break;
      }
      expect(errs.slice(0, 20)).toEqual([]);
    });
  }
});
