// 기획 8차 MonsterDef.onDeath: a dying monster splits into children (복사 인간 → 복사본 ×2) and/or fires a last
// action at the spot it died (e.g. a burst). Children are ordinary enemies: they count toward the floor clear (R16) and
// obey the alive cap (R15) — what does not fit waits in spawner.deferred and comes out as soon as there is room.

import { getMonster } from '../data';
import { SUMMON_SPREAD } from './constants';
import { unitCtx } from './ctx';
import { createUnit } from './entities';
import { startAction } from './skills';
import { clampToArena, copy, countEnemies, emit, queuedEnemies, type SimEntity, type World } from './world';

/** Display name of an onDeath action (skillCast label, e.g. 눈알 줄기 bursting). */
export const DEATH_ACTION_NAME = '파열';

export function onMonsterDeath(w: World, e: SimEntity): void {
  const od = e.rt.monDef?.onDeath;
  if (!od || e.kind === 'character' || w.state.phase !== 'combat') return;
  if (od.action) startAction(w, unitCtx(w, e, `${e.defId}_death`, DEATH_ACTION_NAME), od.action);
  if (od.summon && od.summon.count > 0) splitInto(w, e, od.summon.unitId, od.summon.count);
}

function splitInto(w: World, e: SimEntity, unitId: string, count: number): void {
  const def = getMonster(unitId);
  const team = e.team;
  const enemy = team === 'enemy';
  const room = enemy ? Math.max(0, Math.floor(w.tunables.maxAliveMonsters - countEnemies(w) - queuedEnemies(w))) : count;
  const spread = Math.min(SUMMON_SPREAD, 0.4 + e.radius);
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + w.rng.range(0, 0.6);
    const pos = clampToArena(w, { x: e.pos.x + Math.cos(ang) * spread, y: e.pos.y + Math.sin(ang) * spread });
    if (enemy && i >= room) {
      w.spawner.deferred.push({ monsterId: unitId, pos });
      continue;
    }
    const s = w.state;
    const c = createUnit(w, def, pos, team, {
      kind: e.kind === 'summon' && !enemy ? 'summon' : 'monster',
      ownerPlayer: enemy ? null : e.ownerPlayer,
      expiresIn: null,
      hpMult: enemy ? s.plan.statMult * w.tunables.monsterHpMult : 1,
      atkMult: enemy ? s.plan.statMult : 1,
    });
    c.facing = e.facing;
    emit(w, { type: 'spawn', entityId: c.id, pos: copy(c.pos), tier: c.tier as Exclude<typeof c.tier, 'character'> });
  }
}
