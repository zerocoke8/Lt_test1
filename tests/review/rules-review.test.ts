// Adversarial rules-compliance review (R1–R24 + 기획서 ✅/🔶 items).
// Each test probes an edge case the main suite does not cover directly.
// The deviations it found (it.fails) are fixed; those tests now run as regular regression tests ("former deviations").

import { describe, expect, it } from 'vitest';
import { FLOOR_WAVES, TICK_RATE } from '../../src/config';
import { getCharacter, getMonster } from '../../src/data';
import { applyDamage, killEntity } from '../../src/sim/combat';
import { createUnit } from '../../src/sim/entities';
import { tick } from '../../src/sim/game';
import { rewardFamily } from '../../src/sim/rewards';
import type { GameEvent } from '../../src/types';
import {
  active,
  advance,
  BOT1,
  BOT2,
  clearEvents,
  drain,
  eventsOf,
  HUMAN,
  HUMAN2,
  killActive,
  makeGame,
  quietFloor,
  spawnAt,
  type TestGame,
} from '../sim/helpers';

const T = (s: number) => Math.round(s * TICK_RATE);
function ticks(tg: TestGame, n: number): void {
  for (let i = 0; i < n; i++) if (tg.w.state.phase === 'combat') tick(tg.w);
  drain(tg);
}
const ENEMY_SRC = { casterId: null, team: 'enemy' as const, player: null, source: 'basic' as const, isDrag: false };
const ALLY_SRC = (player = 0) => ({ casterId: null, team: 'ally' as const, player, source: 'basic' as const, isDrag: false });

// ───────────────────────────── swaps ─────────────────────────────

describe('swap edge cases (R2–R4, R6, R7)', () => {
  it('swap while the leaving character holds a target lock: the new one locks the enemy nearest to the drop point', () => {
    const tg = makeGame();
    quietFloor(tg);
    const far = spawnAt(tg, 'golem', { x: 30, y: 6 });
    const a = active(tg);
    a.targetId = far.id; // locked on the far golem
    const near = spawnAt(tg, 'golem', { x: 4, y: 6 });
    near.hp = near.maxHp = near.rt.base.maxHp = 1e9; // survives the drag skill
    near.rt.base.moveSpeed = 0;
    far.rt.base.moveSpeed = 0;
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 5, y: 6 } }).ok).toBe(true);
    ticks(tg, T(0.6)); // after appear lock
    const b = active(tg);
    expect(b.partyIndex).toBe(1);
    expect(b.targetId).toBe(near.id);
  });

  it('appear lock blocks a 2nd swap for exactly appearLockTime; card cooldown reason wins', () => {
    const tg = makeGame();
    quietFloor(tg);
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } }).ok).toBe(true);
    expect(tg.game.canSwap(0, 2)).toEqual({ ok: false, reason: '등장 중' });
    expect(tg.game.canSwap(0, 1)).toEqual({ ok: false, reason: '이미 필드에 있음' });
    ticks(tg, T(0.5) - 1);
    expect(tg.game.canSwap(0, 2).ok).toBe(false);
    ticks(tg, 1);
    expect(tg.game.canSwap(0, 2).ok).toBe(true);
    // the appearing character is invulnerable during the appear window
    const b = active(tg);
    expect(b.invulnTime).toBe(0);
  });

  it('swap to a dead character is refused and changes nothing', () => {
    const tg = makeGame();
    quietFloor(tg);
    killActive(tg);
    const before = JSON.stringify(tg.w.state.players[0].party.map(m => [m.dead, m.swapCooldownRemaining, m.entityId]));
    const r = tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 0, pos: { x: 10, y: 6 } });
    expect(r).toEqual({ ok: false, reason: '사망' });
    expect(tg.w.state.players[0].activeIndex).toBeNull();
    expect(JSON.stringify(tg.w.state.players[0].party.map(m => [m.dead, m.swapCooldownRemaining, m.entityId]))).toBe(before);
    expect(tg.w.state.players[0].stats.swaps).toBe(0);
  });

  it('a pending enemy AoE resolves on whoever is on the field at that moment: the benched character dodges it', () => {
    const tg = makeGame();
    quietFloor(tg);
    const a = active(tg);
    a.pos = { x: 10, y: 6 };
    tg.w.state.players[0].party[0].normalCooldownRemaining = 99; // no shield-bash stun on the ogre
    const ogre = spawnAt(tg, 'ogre', { x: 11.5, y: 6 });
    ogre.rt.skillCds[0] = 0;
    ogre.rt.base.atkSpeed = 0.0001;
    ogre.rt.attackCd = 999;
    ticks(tg, 1); // ogre casts slam (1.2 s telegraph) on the guardian
    expect(tg.w.state.telegraphs.length).toBe(1);
    const hpBefore = tg.w.state.players[0].party[0].hp;
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: 30, y: 6 } }).ok).toBe(true);
    ticks(tg, T(1.3));
    expect(tg.w.state.players[0].party[0].hp).toBe(hpBefore); // bench untouched
  });
});

// ───────────────────────────── empty field ─────────────────────────────

describe('empty field (R9, R10, R14)', () => {
  it('ult with an empty field is refused; the gauge stays full and fullSince is kept', () => {
    const tg = makeGame();
    quietFloor(tg);
    ticks(tg, T(30));
    const p = tg.w.state.players[0];
    expect(p.ult.charge).toBe(1);
    const since = p.ult.fullSince;
    killActive(tg);
    const r = tg.game.dispatch({ type: 'ult', player: 0 });
    expect(r).toEqual({ ok: false, reason: '필드에 캐릭터 없음' });
    ticks(tg, T(2));
    expect(p.ult.charge).toBe(1);
    expect(p.ult.fullSince).toBe(since);
    expect(p.stats.ultsUsed).toBe(0);
  });

  it('pet with an empty field still fires (pets are not characters); power = best party base atk', () => {
    const tg = makeGame();
    quietFloor(tg);
    killActive(tg);
    const s = spawnAt(tg, 'golem', { x: 10, y: 6 });
    s.rt.base.moveSpeed = 0;
    s.rt.base.def = 0;
    const hp0 = s.hp;
    expect(tg.game.dispatch({ type: 'pet', player: 0, petIndex: 0, pos: { x: 10, y: 6 } }).ok).toBe(true);
    ticks(tg, T(0.6));
    // frog_bomb: 3 × max(18, 32, 30) = 96 (crit chance 0 for pets)
    expect(hp0 - s.hp).toBeCloseTo(96, 5);
    expect(tg.w.state.players[0].stats.damageBySource.pet).toBeCloseTo(96, 5);
    expect(tg.w.state.players[0].activeIndex).toBeNull(); // not a swap
  });

  it('active dies while the other cards are on cooldown: field stays empty through cooldowns and revive (no auto swap)', () => {
    const tg = makeGame();
    quietFloor(tg);
    const p = tg.w.state.players[0];
    // 기획 6차: a card starts cooling when it leaves the field, so 1→2→3 leaves cards 1·2 cooling
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } }).ok).toBe(true);
    ticks(tg, T(0.5));
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: 10, y: 6 } }).ok).toBe(true);
    ticks(tg, T(0.5));
    expect(p.party[0].swapCooldownRemaining).toBeGreaterThan(0);
    expect(p.party[1].swapCooldownRemaining).toBeGreaterThan(0);
    killActive(tg);
    clearEvents(tg);
    expect(p.activeIndex).toBeNull();
    ticks(tg, T(31));
    expect(p.party[2].dead).toBe(false); // revived as a card
    expect(p.activeIndex).toBeNull();
    expect(eventsOf(tg, 'appear').length).toBe(0);
    expect(tg.w.state.entities.some(e => e.kind === 'character')).toBe(false);
  });

  it('revive happens exactly reviveTime after death with reviveHpFrac × bench maxHp, frozen during the reward phase', () => {
    const tg = makeGame();
    quietFloor(tg);
    const p = tg.w.state.players[0];
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } }).ok).toBe(true);
    ticks(tg, T(0.5));
    killActive(tg); // blade dies
    const m = p.party[1];
    expect(m.reviveRemaining).toBe(30);
    ticks(tg, T(10));
    // clear the floor while dead → reward phase (time frozen)
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } }).ok).toBe(true);
    expect(tg.w.state.phase).toBe('reward');
    const left = m.reviveRemaining;
    const t0 = tg.w.state.time;
    tg.game.step(5);
    tg.game.step(5);
    expect(m.reviveRemaining).toBe(left);
    expect(tg.w.state.time).toBe(t0);
    expect(tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 }).ok).toBe(true);
    clearEvents(tg);
    ticks(tg, T(20) - 1);
    expect(m.dead).toBe(true);
    ticks(tg, 1);
    expect(m.dead).toBe(false);
    expect(m.hp).toBeCloseTo(m.maxHp * 0.5, 6);
    expect(eventsOf(tg, 'revive').length).toBe(1);
  });
});

// ───────────────────────────── death / out ─────────────────────────────

describe('R11 out → spectating → wipe', () => {
  it('all 3 dead → out: commands refused, the run goes on, out player never revives', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2] });
    quietFloor(tg);
    const p = tg.w.state.players[0];
    p.party[1].dead = true;
    p.party[1].reviveRemaining = 25;
    p.party[2].dead = true;
    p.party[2].reviveRemaining = 25;
    killActive(tg, 0);
    expect(p.out).toBe(true);
    expect(eventsOf(tg, 'playerOut').map(e => e.player)).toEqual([0]);
    expect(tg.w.state.phase).toBe('combat');
    expect(tg.game.canSwap(0, 0).reason).toBe('관전 중');
    expect(tg.game.canUsePet(0, 0).reason).toBe('관전 중');
    expect(tg.game.dispatch({ type: 'ult', player: 0 }).reason).toBe('관전 중');
    ticks(tg, T(40));
    expect(p.party.every(m => m.dead)).toBe(true); // spectating for the rest of the run
    expect(tg.w.state.phase).toBe('combat');
    const q = tg.w.state.players[1];
    q.party[1].dead = true;
    q.party[2].dead = true;
    killActive(tg, 1);
    expect(tg.w.state.phase).toBe('runOver');
    expect(tg.w.state.runResult).toMatchObject({ outcome: 'defeat', reason: 'wipe' });
  });
});

// ───────────────────────────── floors ─────────────────────────────

describe('normal floor clear / cap (R15, R16)', () => {
  it('waves postponed at the cap are never dropped: every planned monster eventually spawns', () => {
    const tg = makeGame({ tunables: { maxAliveMonsters: 6, invincible: true, monsterHpMult: 1e6, midBossTimeTrigger: 1e6, midBossKillTrigger: 1e6 } });
    const plan = tg.w.state.plan;
    const planned = plan.waves.reduce((a, w) => a + w.spawns.reduce((b, g) => b + g.count, 0), 0);
    let spawned = 0;
    for (let i = 0; i < 40 && tg.w.state.phase === 'combat'; i++) {
      ticks(tg, T(3));
      spawned = eventsOf(tg, 'spawn').filter(e => e.tier === 'normal').length;
      const alive = tg.w.state.entities.filter(e => e.team === 'enemy' && e.hp > 0 && !e.rt.gone).length;
      // the alive cap holds (a single oversize wave may still enter an empty field)
      expect(alive).toBeLessThanOrEqual(Math.max(6, ...plan.waves.map(w => w.spawns.reduce((b, g) => b + g.count, 0))));
      tg.game.dispatch({ type: 'debug', action: { kind: 'killAll' } });
    }
    expect(spawned).toBe(planned);
  });

  it('clear waits for summoned adds of the mid boss (lich skeletons) even after the lich died', () => {
    const tg = makeGame({ startFloor: 2 }); // floor 2 → lich
    const s = tg.w.state;
    expect(s.plan.midBossId).toBe('lich');
    quietFloor(tg);
    const lich = spawnAt(tg, 'lich', { x: 30, y: 6 });
    s.midBossSpawned = true;
    // an add summoned by the lich (enemy summon, no expiry)
    const add = createUnit(tg.w, getMonster('skeleton_archer'), { x: 31, y: 3 }, 'enemy', { kind: 'summon', ownerPlayer: null, expiresIn: null, hpMult: 1, atkMult: 1 });
    killEntity(tg.w, lich, null);
    ticks(tg, 2);
    expect(s.phase).toBe('combat');
    expect(s.monstersAlive).toBe(1);
    killEntity(tg.w, add, null);
    ticks(tg, 1);
    expect(s.phase).toBe('reward');
  });

  it('the forced mid boss waits for room under the alive cap (postponed, never dropped), then comes', () => {
    // 기획서 9-1: "동시에 최대 30마리" holds for the mid boss too.
    const tg = makeGame({ tunables: { invincible: true, monsterHpMult: 1e6, maxAliveMonsters: 30, midBossKillTrigger: 1e6, midBossTimeTrigger: 3 } });
    quietFloor(tg);
    tg.w.spawner.midTriggered = false;
    const slimes = [];
    for (let i = 0; i < 30; i++) {
      const m = spawnAt(tg, 'slime', { x: 2 + (i % 10) * 3, y: 2 + Math.floor(i / 10) * 3 });
      m.rt.base.moveSpeed = 0;
      m.hp = m.maxHp = m.rt.base.maxHp = 1e9;
      slimes.push(m);
    }
    const alive = () => tg.w.state.entities.filter(e => e.team === 'enemy' && e.hp > 0 && !e.rt.gone).length;
    ticks(tg, T(4.5));
    expect(alive()).toBe(30);
    expect(tg.w.state.midBossSpawned).toBe(false);
    killEntity(tg.w, slimes[0], null); // room for one
    ticks(tg, T(1.2)); // 1 s spawn marker
    expect(tg.w.state.midBossSpawned).toBe(true);
    expect(alive()).toBe(30);
  });

  it('enemy summons only fill the room left under the alive cap', () => {
    const tg = makeGame({ startFloor: 2, tunables: { invincible: true, maxAliveMonsters: 30 } });
    quietFloor(tg);
    for (let i = 0; i < 28; i++) {
      const m = spawnAt(tg, 'slime', { x: 2 + (i % 10) * 3, y: 2 + Math.floor(i / 10) * 3 });
      m.rt.base.moveSpeed = 0;
      m.hp = m.maxHp = m.rt.base.maxHp = 1e9;
    }
    const lich = spawnAt(tg, 'lich', { x: 30, y: 9 }); // 해골 소환: 3 skeletons
    lich.rt.skillCds[0] = 0;
    lich.rt.skillCds[1] = 99;
    ticks(tg, 2);
    const alive = tg.w.state.entities.filter(e => e.team === 'enemy' && e.hp > 0 && !e.rt.gone).length;
    expect(alive).toBe(30);
  });
});

describe('timeouts and boss (R17, R18)', () => {
  it('normal floor: timeout = defeat even while waves are postponed', () => {
    const tg = makeGame({ tunables: { normalFloorTime: 30, invincible: true, monsterHpMult: 1e6, maxAliveMonsters: 5 } });
    ticks(tg, T(31));
    expect(tg.w.state.runResult).toMatchObject({ outcome: 'defeat', reason: 'timeout' });
    expect(tg.game.telemetry().floorTimes.at(-1)).toMatchObject({ floor: 1, outcome: 'fail' });
  });

  it('boss floor: timeout enrages (no defeat) and boss HP 0 on the timeout tick still retreats/clears', () => {
    const tg = makeGame({ startFloor: 5, tunables: { bossFloorTime: 30, invincible: true } });
    const s = tg.w.state;
    ticks(tg, T(30) - 1);
    expect(s.bossEnraged).toBe(false);
    const boss = tg.w.byId.get(s.bossId!)!;
    applyDamage(tg.w, ALLY_SRC(0), boss, 1e12, false); // boss to 0 right before the timeout tick
    expect(boss.hp).toBe(0);
    expect(tg.w.byId.get(s.bossId!)!.rt.gone).toBe(false); // does not die
    ticks(tg, 1);
    expect(s.phase).toBe('reward');
    expect(s.bossEnraged).toBe(false);
    expect(eventsOf(tg, 'bossRetreat').length).toBe(1);
    expect(eventsOf(tg, 'death').some(e => e.tier === 'boss')).toBe(false);
    expect(s.rewardOffers!.every(o => o.isRelic)).toBe(true);
    expect(new Set(s.rewardOffers!.map(o => o.rewardId)).size).toBe(3);
  });

  it('boss floor: burn DoT that drops the boss to 0 also triggers the retreat', () => {
    const tg = makeGame({ startFloor: 5, tunables: { invincible: true } });
    const s = tg.w.state;
    const boss = tg.w.byId.get(s.bossId!)!;
    boss.hp = 1;
    boss.statuses.push({ id: 'burn', remaining: 3, total: 3, value: 100, sourcePlayer: 0 });
    ticks(tg, T(1));
    expect(s.phase).toBe('reward');
  });

  it('enraged boss stays enraged; a later timeout never defeats the run on a boss floor', () => {
    const tg = makeGame({ startFloor: 5, tunables: { bossFloorTime: 5, invincible: true } });
    ticks(tg, T(60));
    expect(tg.w.state.phase).toBe('combat');
    expect(tg.w.state.bossEnraged).toBe(true);
    expect(tg.w.state.runResult).toBeNull();
  });
});

describe('floor transition (R19–R21)', () => {
  it('carries cooldowns / gauge / statuses / revive timers; heals only the living; re-appears without a drag skill', () => {
    const tg = makeGame({ players: [HUMAN, BOT1, BOT2] });
    quietFloor(tg);
    const p = tg.w.state.players[0];
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } }).ok).toBe(true);
    ticks(tg, T(1));
    const a = active(tg);
    a.hp = a.maxHp * 0.5;
    a.statuses.push({ id: 'haste', remaining: 20, total: 20, value: 0.1, sourcePlayer: 0 });
    p.party[2].dead = true;
    p.party[2].hp = 0;
    p.party[2].reviveRemaining = 17;
    p.party[0].hp = p.party[0].maxHp * 0.3;
    p.pets[1].cooldownRemaining = 9;
    const snap = {
      swapCd: p.party.map(m => m.swapCooldownRemaining),
      ult: p.ult.charge,
      haste: a.statuses.find(x => x.id === 'haste')!.remaining,
    };
    clearEvents(tg);
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } }).ok).toBe(true);
    expect(tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 }).ok).toBe(true);
    const evs = drain(tg);
    expect(tg.w.state.floor).toBe(2);
    expect(p.activeIndex).toBe(1);
    expect(p.party.map(m => m.swapCooldownRemaining)).toEqual(snap.swapCd);
    expect(p.ult.charge).toBe(snap.ult);
    expect(p.pets[1].cooldownRemaining).toBe(9);
    expect(active(tg).statuses.find(x => x.id === 'haste')!.remaining).toBe(snap.haste);
    expect(p.party[2].dead).toBe(true);
    expect(p.party[2].hp).toBe(0);
    expect(p.party[2].reviveRemaining).toBe(17);
    expect(p.party[1].hp / p.party[1].maxHp).toBeCloseTo(0.7, 6);
    expect(p.party[0].hp / p.party[0].maxHp).toBeCloseTo(0.5, 6);
    expect(evs.some((e: GameEvent) => e.type === 'skillCast' && e.player === 0 && e.slot === 'drag')).toBe(false);
    expect(evs.some((e: GameEvent) => e.type === 'appear')).toBe(false);
    expect(p.stats.swaps).toBe(1);
  });

  it('floor re-appear: same 0.5 s appear window as a swap (invulnerable, no swap), but no drag skill / cooldown', () => {
    // R4 (등장 연출 0.5초 = 교체 불가 + 무적) applies to the floor-start re-appear too (R19: 드래그스킬 없이).
    const tg = makeGame();
    quietFloor(tg);
    const p = tg.w.state.players[0];
    const cds = p.party.map(m => m.swapCooldownRemaining);
    tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    clearEvents(tg);
    tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
    const a = active(tg);
    expect(a.anim).toBe('appear');
    expect(a.rt.lockTime).toBeCloseTo(tg.game.tunables.appearLockTime);
    expect(a.invulnTime).toBeCloseTo(tg.game.tunables.appearInvulnTime);
    expect(tg.game.canSwap(0, 1)).toEqual({ ok: false, reason: '등장 중' });
    expect(p.party.map(m => m.swapCooldownRemaining)).toEqual(cds);
    expect(eventsOf(tg, 'skillCast').some(e => e.slot === 'drag')).toBe(false);
    ticks(tg, T(0.5));
    expect(tg.game.canSwap(0, 1).ok).toBe(true);
    expect(active(tg).invulnTime).toBe(0);
  });

  it('reward phase: 3 distinct offers, nothing ticks while choosing, bots already picked', () => {
    const tg = makeGame({ players: [HUMAN, BOT1, BOT2] });
    quietFloor(tg);
    tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    const s = tg.w.state;
    expect(s.phase).toBe('reward');
    const offers = s.rewardOffers!;
    expect(offers.length).toBe(3);
    expect(new Set(offers.map(o => rewardFamily(o.rewardId))).size).toBe(3);
    expect(offers.every(o => !o.isRelic)).toBe(true);
    expect(s.players[1].rewards.length + s.players[2].rewards.length).toBe(2);
    const snap = JSON.stringify([s.time, s.floorTime, s.players.map(p => [p.ult, p.party.map(m => m.swapCooldownRemaining), p.pets.map(x => x.cooldownRemaining)])]);
    for (let i = 0; i < 10; i++) tg.game.step(0.25);
    expect(JSON.stringify([s.time, s.floorTime, s.players.map(p => [p.ult, p.party.map(m => m.swapCooldownRemaining), p.pets.map(x => x.cooldownRemaining)])])).toBe(snap);
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 5, y: 5 } }).reason).toBe('전투 중이 아님');
    expect(tg.game.dispatch({ type: 'pet', player: 0, petIndex: 0, pos: { x: 5, y: 5 } }).reason).toBe('전투 중이 아님');
  });

  it('boss floor at maxFloor: retreat = victory (no reward screen)', () => {
    const tg = makeGame({ startFloor: 5, tunables: { maxFloor: 5, invincible: true } });
    const boss = tg.w.byId.get(tg.w.state.bossId!)!;
    applyDamage(tg.w, ALLY_SRC(0), boss, 1e12, false);
    ticks(tg, 1);
    expect(tg.w.state.runResult).toMatchObject({ outcome: 'victory', reason: 'cleared', floorReached: 5 });
    expect(tg.w.state.rewardOffers).toBeNull();
  });

  it('floors are generated past 5: boss every 5th floor up to maxFloor 20', () => {
    const tg = makeGame({ tunables: { maxFloor: 20 } });
    const kinds: string[] = [];
    for (let f = 1; f <= 20; f++) {
      tg.game.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: f } });
      kinds.push(tg.w.state.plan.kind);
    }
    expect(kinds.map((k, i) => (k === 'boss' ? i + 1 : 0)).filter(Boolean)).toEqual([5, 10, 15, 20]);
  });
});

// ───────────────────────────── bots ─────────────────────────────

describe('R23 bots obey the same validation', () => {
  it('every bot appear/pet/ult was legal at the moment it happened (60 s of 3 bots)', () => {
    const bot0 = { ...BOT1, name: 'B0' };
    const tg = makeGame({ seed: 77, players: [bot0, BOT1, BOT2] });
    const s = tg.w.state;
    const violations: string[] = [];
    for (let i = 0; i < T(120) && s.phase === 'combat'; i++) {
      const before = s.players.map(p => ({
        lock: p.appearLock,
        active: p.activeIndex,
        party: p.party.map(m => ({ cd: m.swapCooldownRemaining, dead: m.dead })),
        pets: p.pets.map(x => x.cooldownRemaining),
        ult: p.ult.charge,
        hadField: p.activeIndex != null,
        out: p.out,
      }));
      tick(tg.w);
      for (const ev of tg.game.drainEvents()) {
        if (ev.type === 'appear') {
          const b = before[ev.player];
          const m = b.party[ev.partyIndex];
          // the bot acts after the per-tick timers, so allow one tick of countdown
          if (b.out || m.dead || m.cd > 1 / TICK_RATE + 1e-6 || b.lock > 1 / TICK_RATE + 1e-6 || b.active === ev.partyIndex) {
            violations.push(`illegal swap t=${s.time.toFixed(2)} p${ev.player} idx${ev.partyIndex} ${JSON.stringify(b)}`);
          }
        }
      }
      for (let pi = 0; pi < s.players.length; pi++) {
        const p = s.players[pi];
        const b = before[pi];
        if (p.stats.ultsUsed > 0 && p.ult.charge === 0 && b.ult < 1 - 1 / (30 * TICK_RATE) - 1e-9 && b.ult !== 0) {
          // ult fired without a full gauge
          violations.push(`ult without full gauge p${pi}`);
        }
        p.pets.forEach((x, k) => {
          if (x.cooldownRemaining > b.pets[k] + 1e-9 && b.pets[k] > 1 / TICK_RATE + 1e-6) violations.push(`pet on cooldown p${pi} k${k}`);
        });
      }
    }
    expect(violations).toEqual([]);
    expect(s.players.some(p => p.stats.swaps > 0)).toBe(true);
  });
});

// ───────────────────────────── telemetry ─────────────────────────────

describe('R22 telemetry', () => {
  it('swaps/min, damage share and ult delay are computed from player 0 and frozen time', () => {
    const tg = makeGame();
    quietFloor(tg);
    const g = spawnAt(tg, 'golem', { x: 20, y: 6 });
    g.rt.base.maxHp = g.hp = g.maxHp = 1e9;
    ticks(tg, T(30)); // ult full at 30 s
    ticks(tg, T(4));
    expect(tg.game.dispatch({ type: 'ult', player: 0 }).ok).toBe(true);
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: g.pos.x, y: g.pos.y } }).ok).toBe(true);
    ticks(tg, T(26));
    const t = tg.game.telemetry();
    const s = tg.w.state;
    expect(t.swapsPerMinute).toBeCloseTo(1 / (s.time / 60), 6);
    expect(t.avgUltDelay).toBeCloseTo(4, 1);
    const sum = Object.values(t.damageShareBySource).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 9);
    expect(t.damageShareBySource.drag).toBeGreaterThan(0);
    expect(t.damageShareBySource.ult).toBeGreaterThan(0);
  });
});

// ───────────────────────────── R4 start card ─────────────────────────────

describe('R4 start card', () => {
  it('character 1 has no cooldown while it fights, but swapping it out starts one: no free 1→2→1 drag skill', () => {
    // 기획 6차: "캐릭터가 스왑되서 나간 순간부터 쿨타임이 돌아야해" — card 1 starts cooling when it leaves.
    const tg = makeGame();
    quietFloor(tg);
    const p = tg.w.state.players[0];
    ticks(tg, T(5));
    expect(p.party[0].swapCooldownRemaining).toBe(0); // on the field from t = 0: nothing ran down
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } }).ok).toBe(true);
    ticks(tg, T(0.5));
    expect(tg.game.canSwap(0, 0)).toEqual({ ok: false, reason: '쿨타임' });
    // full cooldown from the moment it left (5 s on the field did not count)
    expect(p.party[0].swapCooldownRemaining).toBeCloseTo(getCharacter('guardian').swapCooldown - 0.5, 5);
    expect(tg.game.canSwap(0, 2).ok).toBe(true); // cards 2·3 still start at 0
  });
});

// ───────────────────────────── former deviations (fixed; kept as regression tests) ─────────────────────────────

describe('former deviations', () => {
  it('R15: the alive cap also holds for the forced mid boss', () => {
    const tg = makeGame({ tunables: { invincible: true, maxAliveMonsters: 30, midBossKillTrigger: 1e6, midBossTimeTrigger: 3 } });
    quietFloor(tg);
    tg.w.spawner.midTriggered = false;
    for (let i = 0; i < 30; i++) {
      const m = spawnAt(tg, 'slime', { x: 2 + (i % 10) * 3, y: 2 + Math.floor(i / 10) * 3 });
      m.rt.base.moveSpeed = 0;
      m.hp = m.maxHp = m.rt.base.maxHp = 1e9;
    }
    ticks(tg, T(4.5));
    const alive = tg.w.state.entities.filter(e => e.team === 'enemy' && e.hp > 0 && !e.rt.gone).length;
    expect(alive).toBeLessThanOrEqual(30);
  });

  it('relic beast_collar ("펫 효과 +30%") also boosts the golem_turret pet', () => {
    const shot = (collar: boolean): number => {
      const tg = makeGame({ players: [{ ...HUMAN, pets: ['golem_turret', 'fairy_heal', 'frog_bomb'] }] });
      quietFloor(tg);
      if (collar) tg.w.state.players[0].relics.push('beast_collar');
      const g = spawnAt(tg, 'golem', { x: 30, y: 6 });
      g.rt.base.moveSpeed = 0;
      g.rt.base.def = 0;
      g.hp = g.maxHp = g.rt.base.maxHp = 1e9;
      active(tg).rt.base.atkSpeed = 1e-6; // keep the guardian out of it
      active(tg).rt.attackCd = 1e9;
      tg.w.state.players[0].party[0].normalCooldownRemaining = 1e9;
      tg.game.dispatch({ type: 'pet', player: 0, petIndex: 0, pos: { x: 26, y: 6 } });
      clearEvents(tg);
      ticks(tg, T(3));
      const d = eventsOf(tg, 'damage').filter(e => e.targetId === g.id);
      return d[0]?.amount ?? 0;
    };
    const base = shot(false);
    expect(base).toBeGreaterThan(0);
    expect(shot(true)).toBeCloseTo(base * 1.3, 6);
  });

  it('boss pattern "잡몹 소환은 15초마다 4~6마리"', () => {
    const tg = makeGame({ startFloor: 5, tunables: { invincible: true, bossFloorTime: 1e6 } });
    const counts: number[] = [];
    for (let k = 0; k < 8; k++) {
      clearEvents(tg);
      ticks(tg, T(15));
      const n = eventsOf(tg, 'spawn').filter(e => e.tier === 'normal').length; // boss adds keep their def tier
      if (n > 0) counts.push(n);
      tg.game.dispatch({ type: 'debug', action: { kind: 'killAll' } });
    }
    expect(counts.length).toBeGreaterThan(3);
    expect(counts.every(n => n >= 4 && n <= 6)).toBe(true);
    expect(new Set(counts).size).toBeGreaterThan(1);
  });

  it('wave count "1층 N웨이브, 층마다 +1" counts by floor number (boss floors do not shift it); documented cap', () => {
    const tg = makeGame({ tunables: { maxFloor: 20 } });
    const counts: Record<number, number> = {};
    const want: Record<number, number> = {};
    for (const f of [1, 2, 4, 6, 9, 14]) {
      tg.game.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: f } });
      counts[f] = tg.w.state.plan.waves.length;
      want[f] = Math.min(FLOOR_WAVES.max, FLOOR_WAVES.first + (f - 1) * FLOOR_WAVES.perFloor);
    }
    expect(counts).toEqual(want);
    expect(counts[6]).toBe(counts[4] + 2); // floor 5 (boss) still counts as a floor
  });
});

describe('documented interpretations (behaviour as implemented; confirm with the designer)', () => {
  it('딜량 / 스킬별 피해 비중 count no overkill: an 80-damage drag on a smaller bomb bug logs only its HP', () => {
    const tg = makeGame();
    quietFloor(tg);
    const bug = spawnAt(tg, 'bomb_bug', { x: 10, y: 6 });
    bug.rt.base.moveSpeed = 0;
    bug.hp = bug.maxHp = bug.rt.base.maxHp = 25;
    clearEvents(tg);
    // blade: drag = drag % × 32 atk (2.6 × 32 = 83.2 after the balance pass; crit possible → ≥ that)
    const blade = getCharacter('blade');
    const dragPct = blade.drag.actions[0].effects.find(e => e.kind === 'damage')!;
    const fullHit = (dragPct.kind === 'damage' ? dragPct.amount : 0) * blade.stats.atk;
    expect(fullHit).toBeGreaterThan(25);
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } }).ok).toBe(true);
    expect(bug.hp).toBeLessThanOrEqual(0);
    const st = tg.w.state.players[0].stats;
    expect(st.damageBySource.drag).toBeCloseTo(25, 9);
    expect(st.damageDealt).toBeCloseTo(25, 9);
    // the floating number still shows the full hit
    expect(eventsOf(tg, 'damage').find(e => e.targetId === bug.id)!.amount).toBeGreaterThanOrEqual(fullHit - 1e-9);
  });

  it('shield-absorbed damage counts, overkill past HP does not (damage taken too)', () => {
    const tg = makeGame();
    quietFloor(tg);
    const a = active(tg);
    a.invulnTime = 0;
    a.hp = 10;
    a.shield = 30;
    applyDamage(tg.w, ENEMY_SRC, a, 1000, false);
    expect(tg.w.state.players[0].stats.damageTaken).toBeCloseTo(40, 6);
  });

  it('bots, like the human, only drop on their own visible screen (24 units around the field character)', async () => {
    const { bestDropPoint } = await import('../../src/sim/bot');
    const tg = makeGame({ players: [{ ...BOT1, name: 'B' }] });
    quietFloor(tg);
    active(tg).pos = { x: 3, y: 6 };
    for (let i = 0; i < 4; i++) spawnAt(tg, 'slime', { x: 33 + (i % 2) * 0.5, y: 5 + i * 0.5 });
    // camera x = clamp(3, 12, 24) = 12 → visible x ∈ [0, 24]; the cluster at x ≈ 33 is off-screen
    const p = bestDropPoint(tg.w, tg.w.state.players[0], 1);
    expect(p.x).toBeLessThanOrEqual(24);
    // an on-screen cluster is still picked
    for (let i = 0; i < 3; i++) spawnAt(tg, 'slime', { x: 20 + (i % 2) * 0.5, y: 5 + i * 0.5 });
    const q = bestDropPoint(tg.w, tg.w.state.players[0], 1);
    expect(q.x).toBeGreaterThan(19);
    expect(q.x).toBeLessThanOrEqual(24);
  });
});
