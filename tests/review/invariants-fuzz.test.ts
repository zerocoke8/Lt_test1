// Randomized invariant check: random (and garbage) commands from a "human" + 2 bots for several sim minutes,
// verifying read-model consistency after every tick and every command.

import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../../src/config';
import { FIELD_EVENTS, GOEDAM_ROOMS } from '../../src/data';
import { tick } from '../../src/sim/game';
import { Rng } from '../../src/sim/rng';
import { CONTROL_STATUSES, type Command, type DebugAction, type PlayerSetup } from '../../src/types';
import { gearSpecProblem, type GearLoadout } from '../../src/data/gear';
import { EXPEDITION } from '../../src/data/stages';
import { rollStageLoot, stageResultFromState } from '../../src/sim/expedition';
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
    if (p.appearLock < 0) bad(`p${p.id} appearLock < 0`);
    // 기획 15차 궁극기 개별 게이지 (the rule): every member carries its own gauge; no shared gauge, no 14차 energy pool
    if ('ult' in p || 'energy' in p) bad(`p${p.id} carries a removed 14차 field`);
    p.party.forEach((m, i) => {
      const g = m.ult;
      if (!g) return bad(`p${p.id} member ${i} has no gauge`);
      if (!(g.charge >= 0 && g.charge <= 1)) bad(`p${p.id} member ${i} ult charge ${g.charge}`);
      if ((g.charge >= 1) !== (g.fullSince != null) && s.phase === 'combat' && !p.out) bad(`p${p.id} member ${i} fullSince ${g.fullSince} charge ${g.charge}`);
    });
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
  // 기획 10차: the 괴담 room is its own phase (after 'reward'), with room state only while it is open
  if ((s.phase === 'goedam') !== (s.goedam != null)) bad(`phase ${s.phase} with goedam ${s.goedam ? 'open' : 'null'}`);
  if (s.phase === 'goedam') {
    if (s.entities.some(e => e.team === 'enemy')) bad('enemies alive during goedam');
    if (s.goedam!.players.every(pr => pr.stage === 'done')) bad('goedam room open with everyone done');
    s.goedam!.players.forEach((pr, i) => {
      if (s.players[i].isBot && pr.stage !== 'done') bad(`bot p${i} still in the room (${pr.stage})`);
      if ((pr.stage === 'choosing') !== (pr.choice == null)) bad(`p${i} stage ${pr.stage} choice ${pr.choice}`);
    });
  }
  // 기획 12차 돌발 괴담: only in combat on normal floors; its units exist only while it is open (and are its own)
  const fe = s.fieldEvent;
  if (fe && (s.phase !== 'combat' || s.plan.kind !== 'normal')) bad(`field event ${fe.id} open in ${s.phase} / ${s.plan.kind}`);
  for (const e of s.entities) {
    if (e.rt.gone || !e.eventTag) continue;
    if (!fe || !fe.entityIds.includes(e.id)) bad(`event unit ${e.id} ${e.defId} without its event`);
    if (e.eventTag === 'ward' && e.hp <= 0) bad(`ward ${e.id} at ${e.hp} HP`);
  }
  if (fe && !(fe.remaining >= 0 && fe.remaining <= fe.total + 1e-9)) bad(`field event remaining ${fe.remaining}`);
  // 기획 13차 보스 그로기: only on a boss floor in combat; down ⇔ the boss carries the stun, never down and locked at once
  const g = s.bossGroggy;
  if (g) {
    if (s.phase !== 'combat' || s.plan.kind !== 'boss') bad(`groggy gauge in ${s.phase} / ${s.plan.kind}`);
    if (!(g.fill >= 0 && g.fill <= 1)) bad(`groggy fill ${g.fill}`);
    if (!(g.left >= 0 && g.left <= g.total + 1e-9)) bad(`groggy left ${g.left} / ${g.total}`);
    if (!(g.lock >= 0 && g.lock <= g.lockTotal + 1e-9)) bad(`groggy lock ${g.lock}`);
    if (g.left > 0 && g.lock > 0) bad('groggy down and locked');
    if (g.near && (g.left > 0 || g.lock > 0 || g.fill < 0.8)) bad(`groggy near with fill ${g.fill} left ${g.left} lock ${g.lock}`);
    const boss = s.entities.find(e => e.id === s.bossId && !e.rt.gone);
    if (g.left > 0 && boss && !boss.statuses.some(st => st.id === 'stun')) bad('groggy boss without its stun');
  }
  // 기획 13차 스킬 리뉴얼: control statuses only where they may land, tethers hold, status data stays finite
  for (const e of s.entities) {
    if (e.rt.gone) continue;
    for (const st of e.statuses) {
      const d = st.data;
      if (d && [d.anchor?.x, d.anchor?.y, d.radius, d.stored].some(x => x !== undefined && !finite(x))) bad(`entity ${e.id} ${st.id} data non-finite`);
      if (CONTROL_STATUSES.has(st.id) && e.team !== 'enemy') bad(`ally ${e.id} ${e.defId} under ${st.id}`);
      if (st.id === 'splashUp' && e.team !== 'ally') bad(`enemy ${e.id} with splashUp`);
      const bossy = e.tier === 'boss' || e.tier === 'mid';
      if ((st.id === 'taunt' || st.id === 'tether' || st.id === 'charm') && bossy) bad(`${e.tier} ${e.id} under ${st.id}`);
      if (st.id === 'charm' && e.kind === 'summon') bad(`summon ${e.id} charmed`);
      if (st.id === 'stun' && e.tier === 'boss' && !(g && g.left > 0)) bad(`boss stunned outside its groggy`);
      if ((st.id === 'tether' || st.id === 'root') && d?.anchor) {
        const far = Math.hypot(e.pos.x - d.anchor.x, e.pos.y - d.anchor.y) - (d.radius ?? 0);
        if (far > TETHER_SLACK) bad(`${e.id} ${e.defId} ${far.toFixed(2)} outside its ${st.id}`);
      }
      if (st.id === 'stasis' && !(d && (d.stored ?? 0) >= 0)) bad(`stasis on ${e.id} without its store`);
    }
  }
  if (s.phase === 'combat' && s.plan.kind === 'boss' && s.bossId == null) bad('boss floor without boss');
  if (s.phase === 'combat' && s.plan.kind === 'normal' && s.floorTime > s.plan.timeLimit + 1e-6) bad('normal floor past time limit still in combat');
  return errs;
}

/** A tethered unit near the arena edge may sit up to the wall margin off its anchor (clampUnit wins). */
const TETHER_SLACK = 0.6;

/** Every option id of every room, plus 'continue' (invalid ones for the open room are refused). */
const GOEDAM_PICKS = [...new Set(GOEDAM_ROOMS.flatMap(room => room.options.map(o => o.id))), 'continue', 'continue'];

/** 기획 13차 cases: forced breaks / near-full gauges and jumps onto boss floors (older cases keep their streams). */
const GROGGY_DEBUG: DebugAction[] = [{ kind: 'forceGroggy' }, { kind: 'forceGroggy', fill: 0.85 }, { kind: 'jumpFloor', floor: 5 }, { kind: 'jumpFloor', floor: 15 }];

/**
 * 기획 15차: move the two ult sliders (host tunables command, garbage values too), sometimes with an old client's
 * dropped 14차 toggle keys mixed in (ignored by the sanitizer).
 */
function ultSliderCommand(r: Rng): Command {
  const patch = r.pick<Record<string, unknown>>([
    { ultFieldChargeTime: r.range(5, 90) },
    { ultBenchRatio: r.pick([0, 0.1, 1 / 3, 1, 7, -2]) },
    { ultFieldChargeTime: r.pick([0, -4, 1e9, 3]), ultBenchRatio: r.range(0, 1) },
    { ultPerCharacter: r.chance(0.5), swapEnergyMode: r.chance(0.5), swapEnergyMax: 6, ultChargeTime: 2, ultBenchRatio: r.range(0, 1) },
  ]);
  return { type: 'tunables', patch };
}

function randomCommand(r: Rng, n: number, extra: readonly DebugAction[] = []): Command {
  const k = r.next();
  const garbage = r.chance(0.08);
  const pos = garbage ? { x: r.pick([NaN, -50, 1e9, Infinity]), y: r.pick([NaN, -3, 99]) } : { x: r.range(-2, 40), y: r.range(-2, 14) };
  const player = garbage ? r.pick([-1, 3, 0.5, 1]) : r.int(0, n - 1);
  if (k < 0.45) return { type: 'swap', player, partyIndex: garbage ? r.pick([-1, 3, 1.5]) : r.int(0, 2), pos };
  if (k < 0.65) return { type: 'pet', player, petIndex: garbage ? r.pick([-1, 9]) : r.int(0, 2), pos };
  if (k < 0.8) return { type: 'ult', player };
  if (k < 0.9) return { type: 'chooseReward', player, offerIndex: garbage ? r.pick([-1, 5, 1.2]) : r.int(0, 2) };
  if (k < 0.97) return { type: 'goedam', player, option: r.pick(garbage ? ['', 'nope', '__proto__', 'constructor'] : GOEDAM_PICKS) };
  return {
    type: 'debug',
    action: r.pick([
      { kind: 'killAll' },
      { kind: 'chargeUlt' },
      { kind: 'resetCooldowns' },
      { kind: 'forceEnrage' },
      { kind: 'skipFloor' },
      { kind: 'goedamNext' },
      { kind: 'fieldEventNext' },
      { kind: 'fieldEventNext', id: r.pick(FIELD_EVENTS).id },
      ...extra,
    ] as const),
  };
}

/** 기획 13차: parties that together field all 15 renewed characters (a human + 2 bots each). */
const pets = ['frog_bomb', 'fairy_heal', 'owl_frost'];
/** Who applies which control status (fuzz expects it seen when that character is in the parties). */
const OWNER: Record<string, string> = { taunt: 'guardian', tether: 'warden', root: 'exorcist' };
const RENEWAL_A: PlayerSetup[] = [
  { name: '나', isBot: false, characters: ['warden', 'chrono', 'puppeteer'], pets },
  { name: '봇1', isBot: true, characters: ['exorcist', 'berserker', 'bard'], pets },
  { name: '봇2', isBot: true, characters: ['paladin', 'shadow', 'medic'], pets },
];
const RENEWAL_B: PlayerSetup[] = [
  { name: '나', isBot: false, characters: ['guardian', 'blade', 'cleric'], pets },
  { name: '봇1', isBot: true, characters: ['ranger', 'gunner', 'mage'], pets },
  { name: '봇2', isBot: true, characters: ['puppeteer', 'chrono', 'warden'], pets },
];

describe('invariants under random commands', () => {
  const cases = [
    { seed: 1, t: { maxFloor: 12, reviveTime: 8 } },
    { seed: 2, t: { maxFloor: 12, reviveTime: 8 } },
    { seed: 3, t: { maxFloor: 12, reviveTime: 20, monsterDmgMult: 4 } },
    { seed: 4, t: { maxFloor: 12, reviveTime: 30, monsterDmgMult: 6, bossFloorTime: 30 } },
    // 기획 10차: 괴담 rooms on (2 per zone), random picks / continues / garbage ids, fast floors so several rooms open
    { seed: 5, t: { maxFloor: 20, reviveTime: 8, goedamRoomsPerZone: 2, monsterHpMult: 0.2 } },
    { seed: 6, t: { maxFloor: 20, reviveTime: 20, goedamRoomsPerZone: 1, monsterHpMult: 0.3, monsterDmgMult: 3 } },
    // 기획 12차: 돌발 괴담 on every eligible floor (+ random forced ones)
    { seed: 7, t: { maxFloor: 20, reviveTime: 8, fieldEventChance: 1, monsterHpMult: 0.3 } },
    { seed: 8, t: { maxFloor: 12, reviveTime: 20, fieldEventChance: 0.6, goedamRoomsPerZone: 1, monsterDmgMult: 3 } },
    // 기획 13차: boss groggy on (default) with short, repeated breaks and random forced ones
    { seed: 9, t: { maxFloor: 20, reviveTime: 8, monsterHpMult: 0.5, bossGroggyThreshold: 40, bossGroggyDuration: 2 }, groggy: true },
    { seed: 10, t: { maxFloor: 20, reviveTime: 20, monsterDmgMult: 3, bossFloorTime: 20, bossGroggyThreshold: 60 }, groggy: true },
    // 기획 13차 스킬 리뉴얼: all 15 renewed characters (taunt, tether, root, stasis, charm, blink chains, bench buffs …)
    { seed: 11, t: { maxFloor: 20, reviveTime: 8, monsterHpMult: 0.4 }, players: RENEWAL_A },
    { seed: 12, t: { maxFloor: 20, reviveTime: 20, monsterDmgMult: 3, fieldEventChance: 0.6 }, players: RENEWAL_B, groggy: false },
    // 기획 14차 궁극기 개별 게이지 (the rule since 15차): rooms / field events / groggy, and the two sliders moved at
    // random mid-run (garbage values, an old client's dropped toggle keys)
    { seed: 13, t: { maxFloor: 20, reviveTime: 8, goedamRoomsPerZone: 2, fieldEventChance: 1, monsterHpMult: 0.3 }, groggy: true, ultCasts: true },
    { seed: 14, t: { maxFloor: 20, reviveTime: 20, ultFieldChargeTime: 8, monsterDmgMult: 3, goedamRoomsPerZone: 1 }, players: RENEWAL_A, ultSliders: true, ultCasts: true },
    { seed: 15, t: { maxFloor: 20, reviveTime: 8, ultBenchRatio: 1, goedamRoomsPerZone: 2, fieldEventChance: 1, monsterHpMult: 0.3 }, players: RENEWAL_B, groggy: true, ultSliders: true },
  ];
  type Case = { seed: number; t: object; groggy?: boolean; players?: PlayerSetup[]; ultSliders?: boolean; ultCasts?: boolean };
  for (const { seed, t, groggy, players, ultSliders, ultCasts } of cases as Case[]) {
    it(`seed ${seed} ${JSON.stringify(t)}: 6 sim minutes, no broken invariant`, () => {
      const tg = makeGame({ seed, players: players ?? [HUMAN, BOT1, BOT2], tunables: t });
      const r = new Rng(seed * 7919);
      const errs: string[] = [];
      let rooms = 0;
      let breaks = 0;
      let ults = 0;
      const controls = new Set<string>();
      const s = tg.w.state;
      for (let i = 0; i < 6 * 60 * TICK_RATE && s.phase !== 'runOver'; i++) {
        if (s.phase === 'combat') tick(tg.w);
        errs.push(...check(tg, 'tick'));
        if (r.chance(0.06)) {
          const cmd = ultSliders && r.chance(0.15) ? ultSliderCommand(r) : randomCommand(r, s.players.length, groggy ? GROGGY_DEBUG : []);
          tg.game.dispatch(cmd);
          errs.push(...check(tg, `after ${JSON.stringify(cmd)}`));
        }
        if (s.phase === 'reward' && r.chance(0.2)) tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: r.int(0, 2) });
        if (s.phase === 'goedam' && r.chance(0.2)) {
          const pr = s.goedam!.players[0];
          const opts = pr.options.filter(o => !o.hidden);
          tg.game.dispatch({ type: 'goedam', player: 0, option: pr.stage === 'choosing' ? r.pick(opts).id : 'continue' });
          errs.push(...check(tg, 'after goedam pick'));
        }
        const evs = tg.game.drainEvents();
        rooms += evs.filter(e => e.type === 'goedamOpen').length;
        breaks += evs.filter(e => e.type === 'bossGroggy').length;
        ults += evs.filter(e => e.type === 'ultCast').length;
        for (const e of evs) if (e.type === 'statusApplied') controls.add(e.status);
        if (errs.length > 20) break;
      }
      expect(errs.slice(0, 20)).toEqual([]);
      if (groggy) expect(breaks).toBeGreaterThan(0);
      // 기획 14차/15차: per-character gauges really cast ults
      if (ultCasts) expect(ults).toBeGreaterThan(3);
      // the old toggle keys never reach the tunables
      for (const k of ['ultPerCharacter', 'ultChargeTime', 'swapEnergyMode', 'swapEnergyMax']) expect(tg.w.tunables).not.toHaveProperty(k);
      // 기획 13차: the renewed parties really put their control statuses on the field
      if (players) expect([...controls].sort()).toEqual(expect.arrayContaining(['root', 'taunt', 'tether'].filter(id => players.some(p => p.characters.includes(OWNER[id])))));
      if ((t as { goedamRoomsPerZone?: number }).goedamRoomsPerZone) expect(rooms).toBeGreaterThan(0);
    });
  }
});

// ─────────────────────────── 기획 15차 원정 (기획 16차: one floor per stage) ───────────────────────────

/** Expedition-only invariants on top of check(). */
function checkExpedition(tg: TestGame, where: string): string[] {
  const s = tg.w.state;
  const ex = s.expedition!;
  const errs: string[] = [];
  const bad = (m: string) => errs.push(`${where} t=${s.time.toFixed(2)} f${s.floor}: ${m}`);
  if (s.floor !== 1 || s.plan.stage !== ex.stage || s.plan.floor !== 1) bad(`floor ${s.floor} / plan ${s.plan.stage}-${s.plan.floor}`);
  if (s.phase === 'stageClear' && ex.outcome !== 'cleared') bad(`phase ${s.phase} outcome ${ex.outcome}`);
  if (ex.outcome === 'cleared' && ex.boss && s.phase !== 'stageClear') bad(`boss stage cleared but phase ${s.phase}`);
  if (ex.outcome === 'cleared' && !['reward', 'goedam', 'stageClear'].includes(s.phase)) bad(`cleared but phase ${s.phase}`);
  if ((s.phase === 'runOver') !== (ex.outcome === 'failed')) bad(`phase ${s.phase} outcome ${ex.outcome}`);
  if ((s.plan.kind === 'boss') !== (ex.stage % 3 === 0)) bad(`plan ${s.plan.kind} on stage ${ex.stage}`);
  if (ex.boss && s.rewardOffersByPlayer.some(o => o != null)) bad('floor reward on a boss stage');
  if (s.phase === 'reward' && s.rewardOffersByPlayer.some(o => o?.some(x => x.isRelic))) bad('relic offer in an expedition');
  if (s.players.some(p => p.relics.length > 0)) bad('party relic in an expedition');
  ex.loot.forEach((l, i) => {
    if (!ex.humans[i] && l.length) bad(`bot seat ${i} got loot`);
    if (ex.outcome !== 'cleared' && l.length) bad(`loot before the clear`);
    if (ex.outcome === 'cleared' && ex.humans[i] && l.length !== (ex.boss ? EXPEDITION.lootBossBase + 1 : EXPEDITION.lootNormal)) bad(`p${i} loot ${l.length}`);
    for (const g of l) if (gearSpecProblem(g) || g.tier !== ex.stage) bad(`bad loot ${JSON.stringify(g)}`);
  });
  if (s.phase === 'stageClear') ex.humans.forEach((h, i) => h && !stageResultFromState(s, i) && bad(`no result for p${i}`));
  if (s.phase !== 'stageClear' && ex.humans.some((_, i) => stageResultFromState(s, i))) bad('a result before the stage end');
  if (s.goedam && s.goedam.roomId === 'cursed_relic') bad('저주받은 유물 room in an expedition');
  return errs;
}

/** A random legal loadout (loot rolls of earlier stages, relics included) for a party of 3. */
function randomGear(r: Rng, stage: number): GearLoadout[] {
  const party: GearLoadout[] = [{}, {}, {}];
  for (let st = 1; st <= Math.max(1, stage); st++) {
    for (const g of rollStageLoot(r.int(0, 1e6), st, 0, party, r.chance(0.5), r.int(0, 3))) {
      const who = party[r.int(0, 2)];
      if (!who[g.slot] || who[g.slot]!.tier <= g.tier) who[g.slot] = g;
    }
  }
  return party;
}

describe('기획 15차 원정 (16차 one-floor stages): invariants under random commands', () => {
  const EXP_DEBUG: DebugAction[] = [{ kind: 'jumpFloor', floor: 3 }, { kind: 'jumpFloor', floor: 20 }, { kind: 'forceGroggy' }];
  const cases = [
    { seed: 21, stage: 1, t: { reviveTime: 8, fieldEventChance: 1, goedamRoomsPerZone: 3 } },
    { seed: 22, stage: 3, t: { reviveTime: 8, monsterHpMult: 0.4 } },
    { seed: 23, stage: 6, t: { reviveTime: 20, monsterDmgMult: 3, goedamRoomsPerZone: 3 } },
    { seed: 24, stage: 9, t: { reviveTime: 8, fieldEventChance: 1, monsterHpMult: 0.3 } },
    { seed: 25, stage: 12, t: { reviveTime: 8, monsterHpMult: 0.3, goedamRoomsPerZone: 3 } },
    { seed: 26, stage: 11, t: { reviveTime: 30, monsterDmgMult: 2 } },
  ];
  for (const { seed, stage, t } of cases) {
    it(`stage ${stage} seed ${seed} ${JSON.stringify(t)}: geared seats, the stage end, no broken invariant`, () => {
      const r = new Rng(seed * 104729);
      const players: PlayerSetup[] = [
        { ...HUMAN, gear: randomGear(r, stage) },
        { ...BOT1, isBot: false, name: '둘', gear: randomGear(r, stage) },
        BOT2,
      ];
      const tg = makeGame({ seed, players, tunables: t, expedition: { stage, clearedThisRun: [r.int(0, 4)], firstBossClear: [true, false] } });
      const errs: string[] = [];
      const s = tg.w.state;
      let procs = 0;
      for (let i = 0; i < 5 * 60 * TICK_RATE && s.phase !== 'runOver'; i++) {
        if (s.phase === 'combat') tick(tg.w);
        errs.push(...check(tg, 'tick'), ...checkExpedition(tg, 'tick'));
        if (r.chance(0.06)) {
          const cmd: Command = r.chance(0.03)
            ? { type: 'debug', action: s.time > 40 && r.chance(0.3) ? { kind: 'expeditionClearStage' } : r.pick(EXP_DEBUG) }
            : randomCommand(r, s.players.length);
          tg.game.dispatch(cmd);
          errs.push(...check(tg, `after ${JSON.stringify(cmd)}`), ...checkExpedition(tg, `after ${JSON.stringify(cmd)}`));
        }
        if (s.phase === 'reward' && r.chance(0.2)) for (const pi of [0, 1]) tg.game.dispatch({ type: 'chooseReward', player: pi, offerIndex: r.int(0, 2) });
        if (s.phase === 'goedam' && r.chance(0.2)) {
          for (const pi of [0, 1]) {
            const pr = s.goedam?.players[pi];
            if (!pr) continue;
            const opts = pr.options.filter(o => !o.hidden);
            tg.game.dispatch({ type: 'goedam', player: pi, option: pr.stage === 'choosing' ? r.pick(opts).id : 'continue' });
          }
        }
        if (s.phase === 'stageClear') {
          // terminal: nothing changes it any more
          const before = JSON.stringify(s);
          tg.game.step(1);
          tg.game.dispatch({ type: 'quit' });
          tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
          if (JSON.stringify(s) !== before) errs.push('state changed after the stage end');
          errs.push(...checkExpedition(tg, 'stage end'));
          break;
        }
        procs += tg.game.drainEvents().filter(e => e.type === 'gearProc').length;
        if (errs.length > 20) break;
      }
      expect(errs.slice(0, 20)).toEqual([]);
      expect(s.tick).toBeGreaterThan(300); // it really fought before the stage ended (random clears / wipes end some early)
      if (stage >= 6) expect(procs).toBeGreaterThan(0);
    });
  }
});
