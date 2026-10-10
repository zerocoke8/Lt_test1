// Adversarial review: (1) the wire snapshot carries ONLY contract fields (src/types.ts), for every object kind that
// appears in a rich run; (2) the read-only APIs the server / client call every frame (wireJson, cleanState,
// previewParts, canSwap/canUsePet, telemetry) never perturb the deterministic sim.
import { describe, expect, it } from 'vitest';
import { cleanState, wireJson } from '../../server/snapshot';
import { dropOutcome } from '../../src/sim/fieldEventPreview';
import { tick } from '../../src/sim/game';
import type { Command, GameState, Tunables } from '../../src/types';
import { canSwapState, canUltState } from '../../src/sim/players';
import { fieldUltGauge, ultFillTimes, ultSecondsLeft } from '../../src/sim/ultMode';
import type { GearLoadout } from '../../src/data/gear';
import { BOT1, makeGame, type TestGame } from '../sim/helpers';

const KEYS: Record<string, string[]> = {
  // expedition: 기획 15차 원정 only (absent in the classic tower)
  state: ['seed', 'tick', 'time', 'phase', 'floor', 'plan', 'floorTime', 'timeRemaining', 'entities', 'players', 'telegraphs', 'zones', 'projectiles', 'bossId', 'bossEnraged', 'wavesRemaining', 'monstersAlive', 'midBossSpawned', 'rewardOffers', 'rewardOffersByPlayer', 'goedam', 'fieldEvent', 'bossGroggy', 'runResult', 'expedition'],
  // stage … bossHpMult: 기획 15차 원정 floor plans only (기획 16차: one floor per stage, no stageFloor)
  plan: ['floor', 'kind', 'timeLimit', 'arena', 'statMult', 'waves', 'midBossId', 'maxGap', 'bossId', 'theme', 'stage', 'equivFloor', 'guardian', 'bossHpMult'],
  guardian: ['monsterId', 'hpMult', 'atkMult'],
  expedition: ['stage', 'boss', 'outcome', 'loot', 'humans', 'goedamSeen'],
  gearSpec: ['slot', 'tier', 'rarity', 'optionId', 'relicId'],
  wave: ['at', 'spawns'],
  entity: ['id', 'kind', 'team', 'defId', 'tier', 'pos', 'radius', 'facing', 'hp', 'maxHp', 'shield', 'statuses', 'targetId', 'targetHeldFor', 'ownerPlayer', 'partyIndex', 'anim', 'animTime', 'invulnTime', 'expiresIn', 'enraged', 'eventTag'],
  status: ['id', 'remaining', 'total', 'value', 'sourcePlayer', 'data'], // data: 기획 13차 taunt / tether / root / stasis
  // 기획 15차: no shared 'ult' gauge and no 14차 'energy' pool on the player any more
  // gear: 기획 15차 원정 equipped gear per party index (absent in the classic tower)
  // rerolls / rewardState / rewardPicksLeft: 기획 17차 floor rewards (다시 뽑기, run counters, 욕심쟁이 pick 2)
  player: ['id', 'name', 'isBot', 'color', 'party', 'activeIndex', 'pets', 'out', 'disconnected', 'appearLock', 'relics', 'rewards', 'stats', 'goedamTraces', 'goedamLog', 'gear', 'rerolls', 'rewardState', 'rewardPicksLeft'],
  // ult: 기획 15차 the character's own gauge (the rule)
  // fieldTime / dragCharges: 기획 17차 (지명권 default, 이중 장전)
  member: ['defId', 'hp', 'maxHp', 'shield', 'statuses', 'dead', 'reviveRemaining', 'swapCooldownRemaining', 'swapCooldownTotal', 'normalCooldownRemaining', 'entityId', 'ult', 'fieldTime', 'dragCharges'],
  pet: ['defId', 'cooldownRemaining', 'cooldownTotal'],
  ult: ['charge', 'fullSince'],
  stats: ['damageDealt', 'damageToBoss', 'damageTaken', 'healing', 'kills', 'swaps', 'ultsUsed', 'petsUsed', 'damageBySource', 'ultDelayTotal', 'ultDelayCount', 'fieldEvents', 'groggyPoints', 'groggyBreaks', 'groggyDamage', 'justSwaps', 'justDodged'],
  telegraph: ['id', 'team', 'center', 'origin', 'area', 'remaining', 'total'],
  zone: ['id', 'team', 'ownerPlayer', 'center', 'radius', 'area', 'remaining', 'total', 'kind'],
  projectile: ['id', 'team', 'pos', 'targetId', 'targetPos', 'speed', 'color'],
  // family … rarityBumped: 기획 17차 (tags, 지명권 member / role, curse · coop · economy flag, 대가 text, 상자 bump)
  offer: ['rewardId', 'partyIndex', 'name', 'description', 'rarity', 'isRelic', 'family', 'tags', 'target', 'member', 'role', 'flag', 'cost', 'rarityBumped'],
  applied: ['rewardId', 'partyIndex'],
  goedam: ['roomId', 'floor', 'label', 'players'],
  goedamProgress: ['stage', 'options', 'params', 'choice', 'outcome'],
  goedamParams: ['relicId', 'copy', 'anomaly'],
  goedamOutcome: ['id', 'reward', 'relicId', 'traces', 'revived'],
  goedamTrace: ['id', 'floorsLeft'],
  goedamLog: ['floor', 'label', 'roomId', 'optionId', 'outcome', 'auto'],
  // 기획 12차 돌발 괴담
  fieldEvent: ['id', 'stage', 'warnRemaining', 'remaining', 'total', 'pos', 'entityIds', 'marks', 'progress', 'goal', 'creditPlayer', 'startled', 'printIn', 'printed'],
  fieldEventMark: ['pos', 'radius', 'doneBy'],
  // 기획 13차 보스 그로기
  bossGroggy: ['fill', 'left', 'total', 'lock', 'lockTotal', 'count', 'near', 'breaker'],
};

function extra(kind: string, o: object | null): string[] {
  if (!o) return [];
  return Object.keys(o).filter(k => !KEYS[kind].includes(k)).map(k => `${kind}.${k}`);
}

function audit(s: GameState, seen: Set<string>): string[] {
  const bad: string[] = [...extra('state', s), ...extra('plan', s.plan), ...extra('guardian', s.plan.guardian ?? null)];
  if (s.expedition) {
    seen.add(`expedition:${s.phase}`);
    bad.push(...extra('expedition', s.expedition));
    for (const l of s.expedition.loot) for (const g of l) (seen.add('loot'), bad.push(...extra('gearSpec', g)));
  }
  for (const p of s.players) for (const l of p.gear ?? []) for (const g of Object.values(l)) (seen.add('gear'), bad.push(...extra('gearSpec', g)));
  for (const w of s.plan.waves) bad.push(...extra('wave', w));
  for (const e of s.entities) {
    seen.add(`entity:${e.kind}`);
    bad.push(...extra('entity', e));
    for (const st of e.statuses) (seen.add('status'), bad.push(...extra('status', st)));
  }
  for (const p of s.players) {
    bad.push(...extra('player', p), ...extra('stats', p.stats));
    for (const m of p.party) {
      bad.push(...extra('member', m));
      if (m.ult) (seen.add('memberUlt'), bad.push(...extra('ult', m.ult)));
      for (const st of m.statuses) bad.push(...extra('status', st));
    }
    for (const pt of p.pets) bad.push(...extra('pet', pt));
    for (const r of p.rewards) (seen.add('reward'), bad.push(...extra('applied', r)));
    for (const t of p.goedamTraces) (seen.add('goedamTrace'), bad.push(...extra('goedamTrace', t)));
    for (const e of p.goedamLog) (seen.add('goedamLog'), bad.push(...extra('goedamLog', e), ...extra('goedamOutcome', e.outcome)));
  }
  if (s.goedam) {
    seen.add('goedam');
    bad.push(...extra('goedam', s.goedam));
    for (const pr of s.goedam.players) bad.push(...extra('goedamProgress', pr), ...extra('goedamParams', pr.params), ...extra('goedamOutcome', pr.outcome));
  }
  if (s.fieldEvent) {
    seen.add('fieldEvent');
    bad.push(...extra('fieldEvent', s.fieldEvent));
    for (const m of s.fieldEvent.marks) bad.push(...extra('fieldEventMark', m));
  }
  if (s.bossGroggy) {
    seen.add(s.bossGroggy.left > 0 ? 'bossGroggy:down' : 'bossGroggy');
    bad.push(...extra('bossGroggy', s.bossGroggy));
  }
  for (const e of s.entities) if (e.eventTag) seen.add('entity:event');
  for (const t of s.telegraphs) (seen.add('telegraph'), bad.push(...extra('telegraph', t)));
  for (const z of s.zones) (seen.add('zone'), bad.push(...extra('zone', z)));
  for (const pr of s.projectiles) (seen.add('projectile'), bad.push(...extra('projectile', pr)));
  for (const offers of s.rewardOffersByPlayer) for (const o of offers ?? []) (seen.add('offer'), bad.push(...extra('offer', o)));
  return bad;
}

/** A human slot that swaps / uses pets / ults on a fixed schedule; two bots; a disconnect + return in the middle. */
function scripted(seed: number, observe: (tg: TestGame) => void, extra: Partial<Tunables> = {}): string {
  const tg = makeGame({
    seed,
    players: [
      { name: '나', isBot: false, characters: ['blade', 'mage', 'cleric'], pets: ['frog_bomb', 'fairy_heal', 'golem_turret'] },
      { name: '봇1', isBot: true, characters: ['gunner', 'warden', 'bard'], pets: ['owl_frost', 'turtle_guard', 'frog_bomb'] },
      { name: '봇2', isBot: true, characters: ['chrono', 'paladin', 'shadow'], pets: ['frog_bomb', 'owl_frost', 'fairy_heal'] },
    ],
    tunables: { invincible: true, goedamRoomsPerZone: 2, fieldEventChance: 1, ...extra },
  });
  const s = tg.w.state;
  s.players[0].relics.push('echo_seal');
  const plan: Record<number, Command> = {};
  for (let k = 0; k < 40; k++) {
    plan[150 + k * 180] = { type: 'swap', player: 0, partyIndex: (k % 2) + 1, pos: { x: 6 + ((k * 7) % 24), y: 2 + (k % 8) } };
    plan[240 + k * 180] = { type: 'pet', player: 0, petIndex: k % 3, pos: { x: 10 + (k % 12), y: 6 } };
    plan[260 + k * 180] = { type: 'ult', player: 0 };
  }
  for (let t = 0; t < 30 * 240; t++) {
    if (s.phase === 'reward') {
      tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: t % 3 });
      continue;
    }
    if (s.phase === 'goedam') {
      const pr = s.goedam!.players[0];
      const opts = pr.options.filter(o => !o.hidden);
      tg.game.dispatch({ type: 'goedam', player: 0, option: pr.stage === 'choosing' ? opts[t % opts.length].id : 'continue' });
      observe(tg);
      continue;
    }
    if (s.phase !== 'combat') break;
    const cmd = plan[t];
    if (cmd) tg.game.dispatch(cmd);
    if (t === 2000) tg.game.setPlayerBot(0, true);
    if (t === 2600) tg.game.setPlayerBot(0, false);
    tick(tg.w);
    observe(tg);
  }
  tg.game.drainEvents();
  return JSON.stringify(s, (k, v) => (k === 'rt' ? undefined : v));
}

describe('wire snapshot = contract only', () => {
  it('no sim-internal key on any object kind over a rich 4-minute run (zones, projectiles, telegraphs, statuses, offers)', () => {
    const seen = new Set<string>();
    const bad = new Set<string>();
    scripted(77, tg => {
      if (tg.w.state.tick % 15 !== 0 && tg.w.state.phase === 'combat') return;
      for (const b of audit(cleanState(tg.w.state), seen)) bad.add(b);
      const ev = JSON.parse(wireJson(tg.game.drainEvents())) as unknown[];
      expect(JSON.stringify(ev)).not.toMatch(/"(rt|src)":/);
    });
    // 기획 13차: a boss floor with the groggy gauge filling, down (countdown) and locked
    const boss = makeGame({ seed: 5, players: [{ name: '나', isBot: false, characters: ['guardian', 'paladin', 'chrono'], pets: ['owl_frost', 'cat_void', 'frog_bomb'] }], tunables: { invincible: true }, startFloor: 5 });
    for (let t = 0; t < 30 * 40 && boss.w.state.phase === 'combat'; t++) {
      if (t === 60) boss.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } });
      tick(boss.w);
      if (t % 15 === 0) for (const b of audit(cleanState(boss.w.state), seen)) bad.add(b);
    }
    expect([...bad]).toEqual([]);
    // 기획 15차: the per-character gauges are contract (every member carries one)
    for (const k of ['bossGroggy', 'bossGroggy:down', 'memberUlt']) expect(seen.has(k), k).toBe(true);
    // the run really exercised every kind
    for (const k of ['entity:character', 'entity:monster', 'entity:summon', 'status', 'telegraph', 'zone', 'projectile', 'reward', 'goedam', 'goedamLog', 'fieldEvent', 'entity:event']) expect(seen.has(k), k).toBe(true);
  });
});

describe('기획 15차 원정: wire snapshot = contract only', () => {
  it('a geared guardian stage (through its floor reward) and a boss stage up to the stage end carry only contract keys', () => {
    const seen = new Set<string>();
    const bad = new Set<string>();
    const gear = [
      { weapon: { slot: 'weapon', tier: 8, rarity: 'rare', optionId: 'w_scorch' }, relic: { slot: 'relic', tier: 6, rarity: 'rare', relicId: 'relay_flag' } },
      { armor: { slot: 'armor', tier: 8, rarity: 'epic', optionId: 'a_heal_echo' } },
      { charm: { slot: 'charm', tier: 8, rarity: 'common' } },
    ] as GearLoadout[];
    for (const stage of [8, 9]) {
      const tg = makeGame({
        seed: stage,
        players: [{ name: '나', isBot: false, characters: ['blade', 'mage', 'cleric'], pets: ['frog_bomb', 'fairy_heal', 'golem_turret'], gear }, { ...BOT1 }],
        tunables: { invincible: true },
        expedition: { stage },
      });
      for (let t = 0; t < 30 * 40 && tg.w.state.phase === 'combat'; t++) {
        if (t % 90 === 30) tg.game.dispatch({ type: 'swap', player: 0, partyIndex: ((t / 90) | 0) % 3, pos: { x: 6 + (t % 11), y: 6 } });
        tick(tg.w);
        if (t % 15 === 0) for (const b of audit(cleanState(tg.w.state), seen)) bad.add(b);
      }
      tg.game.dispatch({ type: 'debug', action: { kind: 'expeditionClearStage' } });
      for (const b of audit(cleanState(tg.w.state), seen)) bad.add(b);
      // 기획 16차: a normal stage ends after its floor reward
      if (tg.w.state.phase === 'reward') tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
      expect(tg.w.state.phase).toBe('stageClear');
      for (const b of audit(cleanState(tg.w.state), seen)) bad.add(b);
      expect(JSON.stringify(JSON.parse(wireJson(tg.game.drainEvents())))).not.toMatch(/"(rt|src)":/);
    }
    expect([...bad]).toEqual([]);
    for (const k of ['expedition:combat', 'expedition:reward', 'expedition:stageClear', 'loot', 'gear']) expect(seen.has(k), k).toBe(true);
  });
});

describe('determinism with observers', () => {
  it('server/client read-only calls every tick (wireJson, cleanState, previewParts, can*, telemetry) leave the run bit-identical', () => {
    const plain = scripted(4242, () => {});
    const observed = scripted(4242, tg => {
      const g = tg.game;
      wireJson(g.state);
      cleanState(g.state);
      for (let p = 0; p < 3; p++) {
        for (let i = 0; i < 3; i++) {
          g.previewParts(p, 'swap', i);
          g.previewParts(p, 'pet', i);
          g.previewArea(p, 'swap', i);
          g.canSwap(p, i);
          g.canUsePet(p, i);
          // 기획 12차: the dragger's 돌발 괴담 highlight (client, every frame of a drag) is pure too
          dropOutcome(g.state, p, 'swap', i, { x: 6 + i * 9, y: 6 });
          dropOutcome(g.state, p, 'pet', i, { x: 12, y: 3 + i * 3 });
        }
        g.telemetry(p);
      }
      g.clampToArena({ x: Number.NaN, y: Infinity });
    });
    expect(observed).toBe(plain);
  }, 60_000);

  it('기획 15차: the per-character ult read-only calls (fieldUltGauge, ultSecondsLeft, ultFillTimes, canUltState) leave it bit-identical too', () => {
    const plain = scripted(4343, () => {});
    const observed = scripted(4343, tg => {
      const g = tg.game;
      const snap = cleanState(g.state);
      for (let p = 0; p < 3; p++) {
        const pl = g.state.players[p];
        fieldUltGauge(pl);
        ultFillTimes(g.tunables, pl);
        for (let i = 0; i < 3; i++) {
          ultSecondsLeft(g.tunables, pl, i);
          canSwapState(snap, p, i);
        }
        canUltState(snap, p);
      }
      wireJson(g.state);
    });
    expect(observed).toBe(plain);
    expect(plain).not.toBe(scripted(4343, () => {}, { ultBenchRatio: 0.5 }));
  }, 60_000);
});
