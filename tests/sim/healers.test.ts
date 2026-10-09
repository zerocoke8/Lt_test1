// 기획 12차: 힐러 역할 + 새 캐릭터 3명 (docs/new-characters.md) — the new mechanics:
// benchHeal / reviveReduce / benchRegen (메딕), woundedAlly (메딕 응급 주사), 흡혼 표식 drain (퇴마사),
// paper_doll decoys with inherit / inert / burst on death and expiry (퍼펫티어), and RNG identity for old parties.
import { describe, expect, it } from 'vitest';
import { getCharacter, getMonster } from '../../src/data';
import { applyDamage } from '../../src/sim/combat';
import { findWoundedAlly } from '../../src/sim/ctx';
import { effStats } from '../../src/sim/stats';
import { applyStatus } from '../../src/sim/status';
import type { PlayerSetup } from '../../src/types';
import { BOT1, BOT2, HUMAN, active, advance, clearEvents, eventsOf, makeGame, quietFloor, spawnAt, type TestGame, ultOf } from './helpers';

const PETS = ['frog_bomb', 'fairy_heal', 'owl_frost'];
const setup = (name: string, characters: string[]): PlayerSetup => ({ name, isBot: false, characters, pets: PETS });
/** 응급 처치 bench heal fraction (data, so a retune keeps the tests). */
const BENCH = (() => {
  const e = getCharacter('medic').drag.actions.flatMap(a => a.effects).find(x => x.kind === 'benchHeal');
  return e?.kind === 'benchHeal' ? e.amount : NaN;
})();
const ultEffects = () => getCharacter('medic').ult.actions.flatMap(a => a.effects);
const ULT_BENCH = (() => {
  const e = ultEffects().find(x => x.kind === 'benchHeal');
  return e?.kind === 'benchHeal' ? e.amount : NaN;
})();
const ULT_REVIVE = (() => {
  const e = ultEffects().find(x => x.kind === 'reviveReduce');
  return e?.kind === 'reviveReduce' ? e.seconds : NaN;
})();
/** 대역 인형 summon data (기획 13차: 60 % HP, 7 s). */
const DOLL = getCharacter('puppeteer').drag.actions.find(a => a.summon)!.summon!;
/** 대기실 간호 per second. */
const REGEN = getCharacter('medic').passive.benchRegen ?? NaN;
const ALLY = (player: number | null, casterId: number | null = null) => ({ casterId, team: 'ally' as const, player, source: 'basic' as const, isDrag: false });

function swap(tg: TestGame, player: number, idx: number, pos = { x: 8, y: 6 }): void {
  const p = tg.w.state.players[player];
  p.appearLock = 0;
  p.party[idx].swapCooldownRemaining = 0;
  expect(tg.game.dispatch({ type: 'swap', player, partyIndex: idx, pos }).ok).toBe(true);
}

describe('메딕: bench heal, revive cut, bench regen (기획 12차)', () => {
  it('응급 처치 heals my bench — including the card that just left — and not the medic on the field', () => {
    const tg = makeGame({ players: [setup('a', ['guardian', 'medic', 'blade'])] });
    quietFloor(tg);
    const p = tg.w.state.players[0];
    active(tg).hp = active(tg).maxHp * 0.3; // the guardian is about to be benched
    const leavingHp = active(tg).hp;
    p.party[2].hp = p.party[2].maxHp * 0.5;
    clearEvents(tg);
    swap(tg, 0, 1);
    const g = p.party[0];
    const b = p.party[2];
    // bench max HP (no field passive) × 18 % on top of what it left with
    expect(g.hp).toBeCloseTo(leavingHp + g.maxHp * BENCH, 5);
    expect(b.hp / b.maxHp).toBeCloseTo(0.5 + BENCH, 5);
    const ev = eventsOf(tg, 'benchHeal');
    expect(ev.map(e => e.partyIndex).sort()).toEqual([0, 2]);
    expect(ev.every(e => e.player === 0 && e.amount > 0)).toBe(true);
    expect(p.stats.healing).toBeGreaterThan(0.36 * 400);
  });

  it('a bench heal never overheals and never touches dead members', () => {
    const tg = makeGame({ players: [setup('a', ['guardian', 'medic', 'blade'])] });
    quietFloor(tg);
    const p = tg.w.state.players[0];
    p.party[2].dead = true;
    p.party[2].hp = 0;
    p.party[2].reviveRemaining = 20;
    clearEvents(tg);
    swap(tg, 0, 1);
    expect(p.party[0].hp).toBeLessThanOrEqual(p.party[0].maxHp);
    expect(p.party[2].hp).toBe(0);
    expect(eventsOf(tg, 'benchHeal').filter(e => e.partyIndex === 2)).toHaveLength(0);
  });

  it('총력 응급 heals every non-out player bench, cuts revive waits (min 0 → revived next tick) and skips out players', () => {
    const tg = makeGame({ players: [setup('a', ['medic', 'guardian', 'blade']), setup('b', ['ranger', 'mage', 'bard']), setup('c', ['paladin', 'gunner', 'chrono'])] });
    quietFloor(tg);
    const [p0, p1, p2] = tg.w.state.players;
    p0.party[1].hp = p0.party[1].maxHp * 0.2;
    p0.party[2].dead = true;
    p0.party[2].hp = 0;
    p0.party[2].reviveRemaining = ULT_REVIVE * 0.6; // less than the cut: clamps at 0
    p1.party[1].hp = p1.party[1].maxHp * 0.2;
    p1.party[2].dead = true;
    p1.party[2].hp = 0;
    p1.party[2].reviveRemaining = 25;
    p2.out = true;
    p2.party[1].hp = p2.party[1].maxHp * 0.2;
    p2.party[2].dead = true;
    p2.party[2].reviveRemaining = 5;
    ultOf(p0).charge = 1;
    expect(tg.game.dispatch({ type: 'ult', player: 0 }).ok).toBe(true);
    // 기획 13차: the effects land after the 0.45 s cut-in (tick 14 = 0.467 s)
    advance(tg, 0.4);
    expect(p1.party[1].hp / p1.party[1].maxHp).toBeCloseTo(0.2, 5);
    const r1 = p1.party[2].reviveRemaining;
    clearEvents(tg);
    advance(tg, 2 / 30);
    // (the medic's bench regen adds a hair to its own bench)
    expect(p0.party[1].hp / p0.party[1].maxHp).toBeCloseTo(0.2 + ULT_BENCH, 2);
    expect(p1.party[1].hp / p1.party[1].maxHp).toBeCloseTo(0.2 + ULT_BENCH, 5);
    expect(p2.party[1].hp / p2.party[1].maxHp).toBeCloseTo(0.2, 5);
    expect(p0.party[2].reviveRemaining).toBe(0);
    expect(p1.party[2].reviveRemaining).toBeCloseTo(r1 - 2 / 30 - ULT_REVIVE, 5);
    expect(p2.party[2].reviveRemaining).toBe(5);
    // 기획 13차 'reviveCut' (the HUD rolls the number down): one per cut card, none for the out player
    const cuts = eventsOf(tg, 'reviveCut');
    expect(cuts.map(c => [c.player, c.partyIndex])).toEqual([[0, 2], [1, 2]]);
    expect(cuts[1]).toMatchObject({ seconds: ULT_REVIVE, from: 0 });
    advance(tg, 1 / 30);
    expect(p0.party[2].dead).toBe(false);
    expect(eventsOf(tg, 'revive').some(e => e.player === 0 && e.partyIndex === 2)).toBe(true);
    expect(p1.party[2].dead).toBe(true);
  });

  it('대기실 간호: bench regen only while the medic is on the field', () => {
    const tg = makeGame({ players: [setup('a', ['medic', 'guardian', 'blade'])] });
    quietFloor(tg);
    const p = tg.w.state.players[0];
    for (const i of [1, 2]) p.party[i].hp = p.party[i].maxHp * 0.5;
    advance(tg, 2);
    expect(p.party[1].hp / p.party[1].maxHp).toBeCloseTo(0.5 + 2 * REGEN, 3);
    expect(p.party[2].hp / p.party[2].maxHp).toBeCloseTo(0.5 + 2 * REGEN, 3);
    swap(tg, 0, 1); // the medic is benched now: nobody regenerates
    const before = [p.party[0].hp, p.party[2].hp];
    advance(tg, 3);
    expect([p.party[0].hp, p.party[2].hp]).toEqual(before);
  });
});

describe('메딕 응급 주사: woundedAlly (기획 12차)', () => {
  it('picks the ally with the lowest HP ratio in range (any player), ties → nearer', () => {
    const tg = makeGame({ players: [setup('a', ['medic', 'guardian', 'blade']), setup('b', ['ranger', 'mage', 'bard']), setup('c', ['paladin', 'gunner', 'chrono'])] });
    quietFloor(tg);
    advance(tg, 1); // appear lock over
    const [m, r, pa] = [active(tg, 0), active(tg, 1), active(tg, 2)];
    m.pos = { x: 10, y: 6 };
    r.pos = { x: 12, y: 6 };
    pa.pos = { x: 13, y: 7 };
    m.hp = m.maxHp * 0.8;
    r.hp = r.maxHp * 0.5;
    pa.hp = pa.maxHp * 0.6;
    const p = tg.w.state.players[0];
    p.party[0].normalCooldownRemaining = 0;
    clearEvents(tg);
    advance(tg, 0.1);
    const cast = eventsOf(tg, 'skillCast').find(e => e.skillId === 'medic_n');
    expect(cast).toBeTruthy();
    expect(cast!.center).toEqual(r.pos);
    const heal = getCharacter('medic').normal.actions[0].effects.find(x => x.kind === 'heal');
    expect(eventsOf(tg, 'heal').some(e => e.targetId === r.id && heal?.kind === 'heal' && e.amount >= r.maxHp * heal.amount - 1e-6)).toBe(true);
    expect(tg.w.state.players[0].party[0].normalCooldownRemaining).toBeGreaterThan(0);
  });

  it('equal HP ratios → the nearer ally', () => {
    const tg = makeGame({ players: [setup('a', ['medic', 'guardian', 'blade']), setup('b', ['ranger', 'mage', 'bard']), setup('c', ['paladin', 'gunner', 'chrono'])] });
    quietFloor(tg);
    const [m, r, pa] = [active(tg, 0), active(tg, 1), active(tg, 2)];
    m.pos = { x: 10, y: 6 };
    r.pos = { x: 14, y: 6 };
    pa.pos = { x: 11.5, y: 6 };
    r.hp = r.maxHp * 0.5;
    pa.hp = pa.maxHp * 0.5;
    expect(findWoundedAlly(tg.w, m, 6)?.id).toBe(pa.id);
    pa.pos = { x: 17.5, y: 6 }; // out of range (edge distance > 6)
    expect(findWoundedAlly(tg.w, m, 6)?.id).toBe(r.id);
  });

  it('does not cast while every ally in range is at 90 % or more, and keeps its cooldown', () => {
    const tg = makeGame({ players: [setup('a', ['medic', 'guardian', 'blade']), setup('b', ['ranger', 'mage', 'bard'])] });
    quietFloor(tg);
    const [m, r] = [active(tg, 0), active(tg, 1)];
    m.pos = { x: 10, y: 6 };
    r.pos = { x: 20, y: 6 }; // hurt but out of range (castRange 6)
    r.hp = r.maxHp * 0.3;
    m.hp = m.maxHp * 0.95;
    spawnAt(tg, 'slime', { x: 12, y: 6 });
    advance(tg, 1);
    const p = tg.w.state.players[0];
    p.party[0].normalCooldownRemaining = 0;
    clearEvents(tg);
    m.hp = m.maxHp * 0.95;
    advance(tg, 0.2);
    expect(eventsOf(tg, 'skillCast').some(e => e.skillId === 'medic_n')).toBe(false);
    expect(p.party[0].normalCooldownRemaining).toBe(0);
  });
});

describe('퇴마사 흡혼 표식 (drain, 기획 12차)', () => {
  function drainSetup() {
    const tg = makeGame({ players: [setup('a', ['blade', 'exorcist', 'guardian']), setup('b', ['ranger', 'mage', 'bard'])] });
    quietFloor(tg);
    const blade = active(tg, 0);
    blade.hp = blade.maxHp * 0.3;
    const ranger = active(tg, 1);
    ranger.hp = ranger.maxHp * 0.3;
    return { tg, blade, ranger };
  }

  it('a hit on a marked enemy heals the hitter by dealt × value, credited to the marker', () => {
    const { tg, ranger } = drainSetup();
    const e = spawnAt(tg, 'golem', { x: 14, y: 6 });
    applyStatus(e, 'drain', 5, 0.45, 0, 'drag');
    const p0Healing = tg.w.state.players[0].stats.healing;
    clearEvents(tg);
    const hp0 = ranger.hp;
    const dealt = applyDamage(tg.w, ALLY(1, ranger.id), e, 100, false);
    expect(dealt).toBeGreaterThan(0);
    const heal = eventsOf(tg, 'heal').find(h => h.targetId === ranger.id)!;
    expect(heal.amount).toBeCloseTo(dealt * 0.45, 5);
    expect(heal.from).toBe(e.id);
    expect(ranger.hp - hp0).toBeCloseTo(dealt * 0.45, 5);
    expect(tg.w.state.players[0].stats.healing - p0Healing).toBeCloseTo(dealt * 0.45, 5);
  });

  it('pets / zones / DoTs (no hitting character) heal that player’s field character instead', () => {
    const { tg, blade } = drainSetup();
    const e = spawnAt(tg, 'golem', { x: 14, y: 6 });
    applyStatus(e, 'drain', 5, 0.3, 0, 'drag');
    const hp0 = blade.hp;
    const dealt = applyDamage(tg.w, { ...ALLY(0), source: 'pet' as const }, e, 100, false);
    expect(blade.hp - hp0).toBeCloseTo(dealt * 0.3, 5);
  });

  it('is halved on boss / mid-boss targets', () => {
    const { tg, ranger } = drainSetup();
    const mid = spawnAt(tg, 'ogre', { x: 14, y: 6 });
    expect(mid.tier).toBe('mid');
    applyStatus(mid, 'drain', 5, 0.5, 0, 'drag');
    const hp0 = ranger.hp;
    const dealt = applyDamage(tg.w, ALLY(1, ranger.id), mid, 100, false);
    expect(ranger.hp - hp0).toBeCloseTo(dealt * 0.5 * 0.5, 5);
  });

  it('never works the other way (a marked ally hit by a monster heals nobody)', () => {
    const { tg, blade } = drainSetup();
    const e = spawnAt(tg, 'golem', { x: 14, y: 6 });
    e.hp = e.maxHp * 0.5;
    applyStatus(blade, 'drain', 5, 0.5, null);
    clearEvents(tg);
    applyDamage(tg.w, { casterId: e.id, team: 'enemy', player: null, source: 'basic', isDrag: false }, blade, 50, false);
    expect(eventsOf(tg, 'heal')).toHaveLength(0);
  });

  it('봉인진 marks the enemies in its ring for its data time', () => {
    const tg = makeGame({ players: [setup('a', ['guardian', 'exorcist', 'blade'])] });
    quietFloor(tg);
    const e = spawnAt(tg, 'golem', { x: 12, y: 6 });
    swap(tg, 0, 1, { x: 10, y: 6 }); // golem 2 units right of the drop → inside the 0.8–3.5 band
    const mark = e.statuses.find(s => s.id === 'drain');
    const eff = getCharacter('exorcist').drag.actions[0].effects.find(x => x.kind === 'status' && x.status === 'drain');
    expect(eff?.kind === 'status' && mark?.value).toBeCloseTo(eff?.kind === 'status' ? eff.value : -1, 5);
    expect(mark?.remaining).toBeCloseTo(eff?.kind === 'status' ? eff.duration : -1, 5);
  });
});

describe('퍼펫티어 종이 인형 (기획 12차)', () => {
  function dollSetup() {
    const tg = makeGame({ players: [setup('a', ['guardian', 'puppeteer', 'blade'])] });
    quietFloor(tg);
    clearEvents(tg);
    swap(tg, 0, 1, { x: 12, y: 6 });
    advance(tg, 0.3); // the second doll lands 0.15 s later
    const dolls = tg.w.state.entities.filter(e => e.defId === 'paper_doll' && !e.rt.gone);
    return { tg, dolls, pup: active(tg) };
  }

  it('two dolls land left and right, inheriting the data share of the caster max HP and its attack', () => {
    const { dolls, pup, tg } = dollSetup();
    expect(dolls).toHaveLength(2);
    expect(dolls.map(d => d.pos.x).sort((a, b) => a - b)).toEqual([9.5, 14.5]);
    const st = effStats(tg.w, pup);
    for (const d of dolls) {
      expect(d.team).toBe('ally');
      expect(d.kind).toBe('summon');
      expect(d.maxHp).toBeCloseTo(st.maxHp * DOLL.inherit!.hp, 5);
      expect(d.rt.base.atk).toBeCloseTo(st.atk, 5);
      expect(d.rt.petPowered).toBe(false);
      expect(d.rt.summonSlot).toBe('drag');
      expect(d.expiresIn).toBeGreaterThan(5.5);
    }
  });

  it('never moves or attacks, and a monster picking a new target takes the nearer doll', () => {
    const { tg, dolls } = dollSetup();
    const left = dolls.find(d => d.pos.x < 12)!;
    const m = spawnAt(tg, 'slime', { x: 7, y: 6 });
    const at = { ...left.pos };
    clearEvents(tg);
    advance(tg, 2);
    expect(m.targetId).toBe(left.id);
    expect(left.pos).toEqual(at);
    expect(eventsOf(tg, 'attack').some(e => dolls.some(d => d.id === e.sourceId))).toBe(false);
    expect(dolls.every(d => d.targetId === null)).toBe(true);
  });

  it('bursts on death: damage + attack down to enemies around it (data numbers)', () => {
    const { tg, dolls } = dollSetup();
    const d = dolls[0];
    const m = spawnAt(tg, 'golem', { x: d.pos.x + 1, y: d.pos.y });
    clearEvents(tg);
    applyDamage(tg.w, { casterId: m.id, team: 'enemy', player: null, source: 'basic', isDrag: false }, d, 1e6, false);
    expect(eventsOf(tg, 'skillCast').some(e => e.skillId === 'paper_doll_death')).toBe(true);
    expect(eventsOf(tg, 'damage').some(e => e.targetId === m.id)).toBe(true);
    const down = getMonster('paper_doll').onDeath!.action!.effects.find(x => x.kind === 'status');
    expect(m.statuses.find(s => s.id === 'atkDown')?.value).toBeCloseTo(down?.kind === 'status' ? down.value : -1, 5);
  });

  it('bursts on expiry too', () => {
    const { tg } = dollSetup();
    const m = spawnAt(tg, 'golem', { x: 20, y: 2 });
    m.rt.stationary = true;
    clearEvents(tg);
    advance(tg, DOLL.duration + 0.2);
    expect(eventsOf(tg, 'skillCast').filter(e => e.skillId === 'paper_doll_death')).toHaveLength(2);
    expect(tg.w.state.entities.some(e => e.defId === 'paper_doll' && !e.rt.gone)).toBe(false);
  });

  it('paper_doll is an inert ally summon kept out of every wave pool', () => {
    const def = getMonster('paper_doll');
    expect(def.inert).toBe(true);
    expect(def.tier).toBe('summon');
    expect(def.stats.atk).toBeGreaterThan(0);
    expect(getCharacter('puppeteer').drag.actions.filter(a => a.summon).every(a => a.summon?.unitId === 'paper_doll')).toBe(true);
    // 기획 13차: the ult's big doll is the same decoy with a bigger burst
    const grand = getMonster('paper_doll_grand');
    expect(grand.inert && grand.tier === 'summon' && grand.stationary).toBe(true);
    expect(getCharacter('puppeteer').ult.actions.filter(a => a.summon).every(a => a.summon?.unitId === 'paper_doll_grand')).toBe(true);
  });
});

describe('bots with the new characters (기획 12차 8장)', () => {
  it('emergency swap (field < 30 %) picks a ready medic over the healthiest card', () => {
    const tg = makeGame({ players: [{ name: 'bot', isBot: true, characters: ['guardian', 'blade', 'medic'], pets: PETS }] });
    quietFloor(tg);
    spawnAt(tg, 'slime', { x: 20, y: 6 });
    const p = tg.w.state.players[0];
    p.party[1].hp = p.party[1].maxHp; // the healthiest card would be the blade
    p.party[2].hp = p.party[2].maxHp * 0.6;
    advance(tg, 1);
    active(tg).hp = active(tg).maxHp * 0.2;
    clearEvents(tg);
    advance(tg, 1);
    expect(eventsOf(tg, 'appear')[0]?.partyIndex).toBe(2);
  });
});

describe('기획 12차: parties without the new characters keep their runs (RNG identity)', () => {
  // Captured before any 12차 sim change (pets already ×0.8): w.rng state, positions, HP after 150 s.
  // 기획 13차: recaptured after the skill renewal (every drag / ult changed on purpose), and again after the round's
  // balance pass (drag / ult numbers of 11 characters, docs/balance.md 12장). 기획 15차: recaptured for per-character ult
  // as the rule (identical to the round-14 code with ultPerCharacter on); a regression guard from here on.
  const GOLDEN: Record<number, { tick: number; floor: number; draw: number; kills: number; pl: string; ents: number }> = {
    11: { tick: 4500, floor: 4, draw: 927898060, kills: 10, pl: '990.00,600.00,450.00;900.00,480.00,520.00;660.00,495.00,825.00', ents: 746491476 },
    22: { tick: 4500, floor: 4, draw: 175756307, kills: 6, pl: '990.00,600.00,450.00;1080.00,576.00,620.46;600.00,450.00,712.87', ents: 3110372441 },
    33: { tick: 4500, floor: 4, draw: 1736404743, kills: 17, pl: '900.00,600.00,450.00;900.00,480.00,520.00;600.00,450.00,750.00', ents: 3040352796 },
  };

  const hash = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
    return h;
  };
  for (const seed of [11, 22, 33]) {
    it(`seed ${seed}: identical to the pre-change golden`, () => {
      const tg = makeGame({ seed, players: [{ ...HUMAN, isBot: true }, BOT1, BOT2] });
      advance(tg, 150);
      const w = tg.w;
      const ents = w.state.entities.map(e => `${e.id}:${e.pos.x.toFixed(3)},${e.pos.y.toFixed(3)}:${e.hp.toFixed(2)}`).join('|');
      const pl = w.state.players.map(p => p.party.map(m => m.hp.toFixed(2)).join(',')).join(';');
      const draw = (w.rng as unknown as { s: number }).s;
      expect({ tick: w.state.tick, floor: w.state.floor, draw, kills: w.spawner.kills, pl, ents: hash(ents) }).toEqual(GOLDEN[seed]);
    });
  }
});
