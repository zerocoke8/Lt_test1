// Adversarial review: (1) the wire snapshot carries ONLY contract fields (src/types.ts), for every object kind that
// appears in a rich run; (2) the read-only APIs the server / client call every frame (wireJson, cleanState,
// previewParts, canSwap/canUsePet, telemetry) never perturb the deterministic sim.
import { describe, expect, it } from 'vitest';
import { cleanState, wireJson } from '../../server/snapshot';
import { tick } from '../../src/sim/game';
import type { Command, GameState } from '../../src/types';
import { makeGame, type TestGame } from '../sim/helpers';

const KEYS: Record<string, string[]> = {
  state: ['seed', 'tick', 'time', 'phase', 'floor', 'plan', 'floorTime', 'timeRemaining', 'entities', 'players', 'telegraphs', 'zones', 'projectiles', 'bossId', 'bossEnraged', 'wavesRemaining', 'monstersAlive', 'midBossSpawned', 'rewardOffers', 'rewardOffersByPlayer', 'runResult'],
  plan: ['floor', 'kind', 'timeLimit', 'arena', 'statMult', 'waves', 'midBossId', 'bossId'],
  wave: ['at', 'spawns'],
  entity: ['id', 'kind', 'team', 'defId', 'tier', 'pos', 'radius', 'facing', 'hp', 'maxHp', 'shield', 'statuses', 'targetId', 'targetHeldFor', 'ownerPlayer', 'partyIndex', 'anim', 'animTime', 'invulnTime', 'expiresIn', 'enraged'],
  status: ['id', 'remaining', 'total', 'value', 'sourcePlayer'],
  player: ['id', 'name', 'isBot', 'color', 'party', 'activeIndex', 'pets', 'ult', 'out', 'disconnected', 'appearLock', 'relics', 'rewards', 'stats'],
  member: ['defId', 'hp', 'maxHp', 'shield', 'statuses', 'dead', 'reviveRemaining', 'swapCooldownRemaining', 'swapCooldownTotal', 'normalCooldownRemaining', 'entityId'],
  pet: ['defId', 'cooldownRemaining', 'cooldownTotal'],
  ult: ['charge', 'fullSince'],
  stats: ['damageDealt', 'damageToBoss', 'damageTaken', 'healing', 'kills', 'swaps', 'ultsUsed', 'petsUsed', 'damageBySource', 'ultDelayTotal', 'ultDelayCount'],
  telegraph: ['id', 'team', 'center', 'origin', 'area', 'remaining', 'total'],
  zone: ['id', 'team', 'ownerPlayer', 'center', 'radius', 'area', 'remaining', 'total', 'kind'],
  projectile: ['id', 'team', 'pos', 'targetId', 'targetPos', 'speed', 'color'],
  offer: ['rewardId', 'partyIndex', 'name', 'description', 'rarity', 'isRelic'],
  applied: ['rewardId', 'partyIndex'],
};

function extra(kind: string, o: object | null): string[] {
  if (!o) return [];
  return Object.keys(o).filter(k => !KEYS[kind].includes(k)).map(k => `${kind}.${k}`);
}

function audit(s: GameState, seen: Set<string>): string[] {
  const bad: string[] = [...extra('state', s), ...extra('plan', s.plan)];
  for (const w of s.plan.waves) bad.push(...extra('wave', w));
  for (const e of s.entities) {
    seen.add(`entity:${e.kind}`);
    bad.push(...extra('entity', e));
    for (const st of e.statuses) (seen.add('status'), bad.push(...extra('status', st)));
  }
  for (const p of s.players) {
    bad.push(...extra('player', p), ...extra('ult', p.ult), ...extra('stats', p.stats));
    for (const m of p.party) {
      bad.push(...extra('member', m));
      for (const st of m.statuses) bad.push(...extra('status', st));
    }
    for (const pt of p.pets) bad.push(...extra('pet', pt));
    for (const r of p.rewards) (seen.add('reward'), bad.push(...extra('applied', r)));
  }
  for (const t of s.telegraphs) (seen.add('telegraph'), bad.push(...extra('telegraph', t)));
  for (const z of s.zones) (seen.add('zone'), bad.push(...extra('zone', z)));
  for (const pr of s.projectiles) (seen.add('projectile'), bad.push(...extra('projectile', pr)));
  for (const offers of s.rewardOffersByPlayer) for (const o of offers ?? []) (seen.add('offer'), bad.push(...extra('offer', o)));
  return bad;
}

/** A human slot that swaps / uses pets / ults on a fixed schedule; two bots; a disconnect + return in the middle. */
function scripted(seed: number, observe: (tg: TestGame) => void): string {
  const tg = makeGame({
    seed,
    players: [
      { name: '나', isBot: false, characters: ['blade', 'mage', 'cleric'], pets: ['frog_bomb', 'fairy_heal', 'golem_turret'] },
      { name: '봇1', isBot: true, characters: ['gunner', 'warden', 'bard'], pets: ['owl_frost', 'turtle_guard', 'frog_bomb'] },
      { name: '봇2', isBot: true, characters: ['chrono', 'paladin', 'shadow'], pets: ['frog_bomb', 'owl_frost', 'fairy_heal'] },
    ],
    tunables: { invincible: true },
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
    expect([...bad]).toEqual([]);
    // the run really exercised every kind
    for (const k of ['entity:character', 'entity:monster', 'entity:summon', 'status', 'telegraph', 'zone', 'projectile', 'reward']) expect(seen.has(k), k).toBe(true);
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
        }
        g.telemetry(p);
      }
      g.clampToArena({ x: Number.NaN, y: Infinity });
    });
    expect(observed).toBe(plain);
  });
});
