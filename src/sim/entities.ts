// Entity construction / removal.

import type { MonsterDef, Team, Vec2 } from '../types';
import { getCharacter } from '../data';
import { ARENA_MARGIN, CHAR_RADIUS, SKILL_START_JITTER } from './constants';
import { benchMaxHp, effStats } from './stats';
import type { Rng } from './rng';
import { addEntity, arena, clamp, copy, newId, type SimEntity, type SimPlayer, type World } from './world';

const FAR = 1e9;

export function createUnit(
  w: World,
  def: MonsterDef,
  pos: Vec2,
  team: Team,
  opts: { kind: 'monster' | 'summon'; ownerPlayer: number | null; expiresIn: number | null; hpMult: number; atkMult: number; rng?: Rng },
): SimEntity {
  const base = { ...def.stats, maxHp: def.stats.maxHp * opts.hpMult, atk: def.stats.atk * opts.atkMult };
  // 기획 12차: 돌발 괴담 units roll on the event's own stream (opts.rng) so the run rng keeps its order
  const rng = opts.rng ?? w.rng;
  const attackCd = rng.range(0.2, 0.8);
  // 기획 8차 리뷰: normal monsters that spawn together (a wave group, a summon) would cast in lockstep forever (two
  // eye-stalk fans with identical timers → one red blob). Their first cast comes up to SKILL_START_JITTER later.
  const skillCds = (def.skills ?? []).map(s => s.initialDelay ?? s.cooldown);
  if (def.tier === 'normal') {
    for (let i = 0; i < skillCds.length; i++) skillCds[i] += rng.range(0, Math.min(SKILL_START_JITTER, 0.35 * def.skills![i].cooldown));
  }
  const e: SimEntity = {
    id: newId(w),
    kind: opts.kind,
    team,
    defId: def.id,
    tier: def.tier,
    pos: copy(pos),
    radius: def.radius,
    facing: team === 'enemy' ? Math.PI / 2 : 0,
    hp: base.maxHp,
    maxHp: base.maxHp,
    shield: 0,
    statuses: [],
    targetId: null,
    targetHeldFor: 0,
    ownerPlayer: opts.ownerPlayer,
    partyIndex: null,
    anim: 'idle',
    animTime: 0,
    invulnTime: 0,
    expiresIn: opts.expiresIn,
    enraged: false,
    rt: {
      charDef: null,
      monDef: def,
      base,
      gone: false,
      attackCd,
      skills: (def.skills ?? []).slice(),
      skillCds,
      skillGap: 0,
      lockTime: 0,
      shieldTime: 0,
      sinceAppear: FAR,
      pulseTimer: 0,
      stationary: !!def.stationary,
      petPowered: team === 'ally' && def.tier === 'summon' && def.stats.atk === 0,
      windup: [],
      phase: 0,
      phaseAtkSpeedMult: 1,
      phaseCdMult: 1,
    },
  };
  addEntity(w, e);
  return e;
}

/** Put party member `idx` on the field (no drag skill, no appear effects — callers add those). */
export function createCharacterEntity(w: World, p: SimPlayer, idx: number, pos: Vec2): SimEntity {
  const m = p.party[idx];
  const def = getCharacter(m.defId);
  const e: SimEntity = {
    id: newId(w),
    kind: 'character',
    team: 'ally',
    defId: def.id,
    tier: 'character',
    pos: copy(pos),
    radius: CHAR_RADIUS,
    facing: 0,
    hp: m.hp,
    maxHp: m.maxHp,
    shield: m.shield,
    statuses: m.statuses,
    targetId: null,
    targetHeldFor: 0,
    ownerPlayer: p.id,
    partyIndex: idx,
    anim: 'idle',
    animTime: 0,
    invulnTime: 0,
    expiresIn: null,
    enraged: false,
    rt: {
      charDef: def,
      monDef: null,
      base: { ...def.stats },
      gone: false,
      attackCd: 0,
      skills: [],
      skillCds: [],
      skillGap: 0,
      lockTime: 0,
      shieldTime: m.rt.shieldTime,
      sinceAppear: FAR,
      appearedAt: w.state.time,
      pulseTimer: 0,
      stationary: false,
      petPowered: false,
      windup: [],
      phase: 0,
      phaseAtkSpeedMult: 1,
      phaseCdMult: 1,
    },
  };
  addEntity(w, e);
  m.entityId = e.id;
  p.activeIndex = idx;
  // Passive hp bonus applies while on field: keep current hp, raise the cap.
  e.maxHp = effStats(w, e).maxHp;
  e.hp = Math.min(e.hp, e.maxHp);
  return e;
}

/** Take the active character off the field, saving hp/shield/statuses on the member. */
export function benchActive(w: World, p: SimPlayer): SimEntity | null {
  if (p.activeIndex == null) return null;
  const idx = p.activeIndex;
  const m = p.party[idx];
  const e = m.entityId != null ? w.byId.get(m.entityId) ?? null : null;
  p.activeIndex = null;
  m.entityId = null;
  if (!e || e.rt.gone) return null;
  m.maxHp = benchMaxHp(p, idx);
  m.hp = Math.min(e.hp, m.maxHp);
  m.shield = e.shield;
  m.rt.shieldTime = e.rt.shieldTime;
  m.statuses = e.statuses;
  e.rt.gone = true;
  return e;
}

export function clampUnit(w: World, e: SimEntity): void {
  if (e.rt.stationary) return;
  const a = arena(w);
  const mg = Math.max(ARENA_MARGIN, Math.min(e.radius, 1));
  e.pos.x = clamp(e.pos.x, mg, a.width - mg);
  e.pos.y = clamp(e.pos.y, mg, a.height - mg);
}
