import { describe, expect, it } from 'vitest';
import { CHARACTERS, getCharacter } from '../../src/data';
import type { AreaShape, Role, SkillAction } from '../../src/types';
import { hitsArea, scaleArea } from '../../src/sim/geometry';
import { advance, makeGame, quietFloor, spawnAt } from './helpers';

const OLD = ['guardian', 'blade', 'berserker', 'ranger', 'mage', 'cleric'];
const NEW = ['paladin', 'warden', 'shadow', 'gunner', 'bard', 'chrono'];
const HANGUL = /[가-힣]/;

function enemyActions(a: readonly SkillAction[]): SkillAction[] {
  return a.filter(x => x.affects === 'enemies');
}

describe('R25 roster: 12 characters, 3 per role (기획 3차 1)', () => {
  it('exactly the 12 ids, unique, 3 per role, ordered by role', () => {
    expect(CHARACTERS).toHaveLength(12);
    const ids = CHARACTERS.map(c => c.id);
    expect(new Set(ids).size).toBe(12);
    expect([...ids].sort()).toEqual([...OLD, ...NEW].sort());
    const per: Record<Role, number> = { tank: 0, melee: 0, ranged: 0, support: 0 };
    for (const c of CHARACTERS) per[c.role]++;
    expect(per).toEqual({ tank: 3, melee: 3, ranged: 3, support: 3 });
    const order: Role[] = ['tank', 'melee', 'ranged', 'support'];
    const roles = CHARACTERS.map(c => order.indexOf(c.role));
    expect(roles).toEqual([...roles].sort((a, b) => a - b));
  });

  it('every character is complete: Korean texts, 5 skill slots, swap cooldown 8–12, unique colours', () => {
    const colors = new Set<string>();
    for (const c of CHARACTERS) {
      expect(c.name).toMatch(HANGUL);
      expect(c.swapCooldown).toBeGreaterThanOrEqual(8);
      expect(c.swapCooldown).toBeLessThanOrEqual(12);
      expect(c.passive.name).toMatch(HANGUL);
      expect(c.passive.description).toMatch(HANGUL);
      for (const sk of [c.normal, c.drag, c.ult]) {
        expect(sk.name).toMatch(HANGUL);
        expect(sk.description).toMatch(HANGUL);
        expect(sk.actions.length).toBeGreaterThan(0);
        expect(sk.id.startsWith(c.id + '_')).toBe(true);
      }
      expect(c.normal.slot).toBe('normal');
      expect(c.drag.slot).toBe('drag');
      expect(c.ult.slot).toBe('ult');
      expect(c.normal.cooldown).toBeGreaterThan(0);
      expect(c.stats.maxHp).toBeGreaterThan(0);
      expect(c.color).toMatch(/^#[0-9a-f]{6}$/i);
      colors.add(c.color.toLowerCase());
      for (const a of c.drag.actions) expect(['point', 'self']).toContain(a.center);
    }
    expect(colors.size).toBe(12);
  });

  it('every drag skill has a non-circle shape, except cleric (circle heal zone) and mage (multi-circle meteors)', () => {
    for (const c of CHARACTERS) {
      const shapes = c.drag.actions.filter(a => a.affects !== 'self').map(a => a.area.shape);
      if (c.id === 'cleric') {
        expect(shapes.every(s => s === 'circle')).toBe(true);
        expect(c.drag.actions.some(a => a.zone)).toBe(true);
      } else if (c.id === 'mage' || c.id === 'shadow') {
        // several circles at fixed offsets / delays
        const offs = c.drag.actions.map(a => `${a.offset?.x ?? 0},${a.offset?.y ?? 0}`);
        expect(new Set(offs).size).toBe(c.drag.actions.length);
        expect(new Set(c.drag.actions.map(a => a.delay ?? 0)).size).toBe(c.drag.actions.length);
      } else {
        expect(shapes[0]).not.toBe('circle');
        expect(['rect', 'cone', 'ring', 'cross']).toContain(shapes[0]);
      }
    }
  });

  it('warden ring (playtest 3차): dropped on a pack it hits the pack — only a unit dead center is spared, also after range rewards', () => {
    const ring = enemyActions(getCharacter('warden').drag.actions)[0].area;
    const c = { x: 10, y: 6 };
    const pack = [
      [0.3, 0],
      [0.6, 0],
      [-0.6, 0.2],
      [0, 0.7],
      [0.5, -0.5],
      [-1.1, -0.4],
    ];
    for (const area of [ring, scaleArea(ring, 2)]) {
      for (const [dx, dy] of pack) expect(hitsArea(area, c, c, { x: c.x + dx, y: c.y + dy }, 0.35), `${dx},${dy}`).toBe(true);
      expect(hitsArea(area, c, c, c, 0.35)).toBe(false);
    }
  });

  it('drag shapes match the 3차 table (shape, fixed direction, numbers)', () => {
    const first = (id: string): AreaShape => enemyActions(getCharacter(id).drag.actions)[0]?.area ?? getCharacter(id).drag.actions[0].area;
    expect(first('guardian')).toEqual({ shape: 'rect', dir: 'right', anchor: 'center', length: 7, width: 2 });
    expect(first('paladin')).toEqual({ shape: 'cross', length: 3.5, width: 1.3 });
    expect(first('warden')).toEqual({ shape: 'ring', inner: 0.6, outer: 4 });
    expect(first('blade')).toEqual({ shape: 'rect', dir: 'right', anchor: 'start', length: 6, width: 1.4 });
    expect(getCharacter('blade').drag.actions[0].dash).toEqual({ dir: 'right', distance: 6 });
    expect(first('berserker')).toEqual({ shape: 'cone', dir: 'right', radius: 4.5, angle: 100 });
    expect(getCharacter('shadow').drag.actions.map(a => a.offset ?? { x: 0, y: 0 })).toEqual([{ x: 0, y: 0 }, { x: 2.2, y: 0 }, { x: 4.4, y: 0 }]);
    expect(first('ranger')).toEqual({ shape: 'rect', dir: 'right', anchor: 'start', length: 12, width: 1.2 });
    expect(getCharacter('mage').drag.actions).toHaveLength(5);
    expect(first('gunner')).toEqual({ shape: 'cone', dir: 'left', radius: 5, angle: 70 });
    expect(getCharacter('gunner').drag.actions[0].effects).toContainEqual({ kind: 'knockback', distance: 2, dir: 'left' });
    expect(first('bard')).toEqual({ shape: 'rect', dir: 'down', anchor: 'center', length: 12, width: 2.6 });
    expect(first('chrono')).toEqual({ shape: 'cross', diagonal: true, length: 3.5, width: 1.3 });
    expect(getCharacter('chrono').drag.actions.some(a => a.effects.some(e => e.kind === 'swapCooldownReduce' && e.seconds === 2))).toBe(true);
    const cds = Object.fromEntries(CHARACTERS.map(c => [c.id, c.swapCooldown]));
    expect(cds).toEqual({ guardian: 12, paladin: 12, warden: 11, blade: 10, berserker: 11, shadow: 9, ranger: 10, mage: 12, gunner: 10, cleric: 8, bard: 9, chrono: 10 });
  });

  it('directional drag descriptions name their direction', () => {
    const word: Record<string, RegExp> = {
      guardian: /가로|좌우/,
      blade: /오른쪽/,
      berserker: /오른쪽/,
      shadow: /오른쪽/,
      ranger: /오른쪽/,
      gunner: /왼쪽/,
      bard: /세로|위아래/,
      paladin: /십자|\+/,
      chrono: /X자|대각선/,
      warden: /고리/,
      mage: /다섯/,
    };
    for (const [id, re] of Object.entries(word)) expect(getCharacter(id).drag.description).toMatch(re);
  });

  it('every character plays: drag, auto normal skill and ult all resolve without exceptions', () => {
    const ids = CHARACTERS.map(c => c.id);
    const tg = makeGame({
      seed: 77,
      players: [0, 1, 2, 3].map(i => ({ name: `P${i}`, isBot: false, characters: ids.slice(i * 3, i * 3 + 3), pets: ['frog_bomb', 'owl_frost', 'fairy_heal'] })),
      tunables: { invincible: true },
    });
    quietFloor(tg);
    const refill = () => {
      if (tg.w.state.entities.filter(e => e.team === 'enemy' && e.hp > 0).length >= 8) return;
      for (let i = 0; i < 8; i++) spawnAt(tg, i % 4 === 0 ? 'golem' : 'slime', { x: 8 + i * 2.5, y: 2 + (i % 4) * 2.5 });
    };
    refill();
    const ps = tg.w.state.players;
    for (const order of [[1, 2, 0], [2, 0, 1]]) {
      for (const idx of order) {
        for (const p of ps) {
          p.appearLock = 0;
          p.party[idx].swapCooldownRemaining = 0;
          const target = tg.w.state.entities.find(e => e.team === 'enemy' && e.hp > 0)!;
          expect(tg.game.dispatch({ type: 'swap', player: p.id, partyIndex: idx, pos: { x: target.pos.x - 1, y: target.pos.y } }).ok).toBe(true);
          p.ult.charge = 1;
        }
        advance(tg, 0.6);
        for (const p of ps) expect(tg.game.dispatch({ type: 'ult', player: p.id }).ok).toBe(true);
        advance(tg, 4);
        refill();
      }
    }
    const casts = tg.events.filter(e => e.type === 'skillCast') as Extract<(typeof tg.events)[number], { type: 'skillCast' }>[];
    for (const c of CHARACTERS) {
      expect(casts.some(e => e.skillId === c.drag.id), `${c.id} drag`).toBe(true);
      expect(casts.some(e => e.skillId === c.ult.id), `${c.id} ult`).toBe(true);
    }
    // auto normal skills of the ones that fight (castRange reached within 4 s on field)
    const normals = new Set(casts.filter(e => e.slot === 'normal').map(e => e.skillId));
    expect(normals.size).toBeGreaterThanOrEqual(8);
  });
});
