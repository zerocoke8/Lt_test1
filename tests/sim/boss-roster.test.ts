// 기획 19차 보스 레이드: the three boss registries agree — data (src/data/bosses), looks (src/render/bosses), voices
// (src/audio/synth/bossVoices). Holds for whatever is registered: the classic four at first, 20 bosses once every zone
// track has landed (integration adds the "exactly 20" check).
import { describe, expect, it } from 'vitest';
import { ZONES } from '../../src/config';
import { BOSSES, BOSS_IDS, BOSS_UNITS, MONSTERS, NORMAL_MONSTER_IDS, RAID_BOSS_IDS, ZONE_BOSSES, getBoss, getMonster } from '../../src/data';
import { ENRAGE } from '../../src/data/bosses';
import { BOSS_KINDS, BOSS_TIMBRES, BOSS_VOICE, bossSkillKind } from '../../src/audio/synth/bossVoices';
import { BOSS_LOOKS, BOSS_TELE_MOTIF, MINION_LOOKS, bossLook } from '../../src/render/bosses';
import { unitLook } from '../../src/render/look';
import type { FloorTheme } from '../../src/types';
import { allSkills, partsOf } from './bossRaidHelpers';

const KOREAN = /[가-힣]/;
const BASE_BAND: Record<FloorTheme, [number, number]> = { lobby: [90, 135], office: [70, 100], ward: [100, 160], rooftop: [45, 70] };

describe('boss data', () => {
  it('the classic four come first, unchanged in order; every boss belongs to the raid table and its zone', () => {
    expect(BOSSES.slice(0, 4).map(b => b.id)).toEqual(BOSS_IDS);
    expect(ZONES.map(z => z.boss)).toEqual(BOSS_IDS);
    expect(new Set(BOSSES.map(b => b.id)).size).toBe(BOSSES.length);
    expect(BOSSES.length).toBeGreaterThanOrEqual(4);
    expect(BOSSES.length).toBeLessThanOrEqual(RAID_BOSS_IDS.length);
    for (const b of BOSSES) {
      expect(RAID_BOSS_IDS, b.id).toContain(b.id);
      expect(ZONE_BOSSES[b.zone], `${b.id} zone`).toContain(b.id);
      expect(getBoss(b.id)).toBe(b);
      expect(getMonster(b.id)).toBe(b);
    }
  });

  it('every boss: Korean name, a one-line 괴담, groggy, the shared enrage, at least one phase', () => {
    for (const b of BOSSES) {
      expect(b.tier, b.id).toBe('boss');
      expect(KOREAN.test(b.name), `${b.id} name`).toBe(true);
      expect(b.lore.length, `${b.id} lore`).toBeGreaterThan(8);
      expect(KOREAN.test(b.lore), `${b.id} lore`).toBe(true);
      expect(b.lore.length, `${b.id} lore fits the banner`).toBeLessThanOrEqual(80);
      expect(b.groggy?.threshold ?? 0, `${b.id} groggy`).toBeGreaterThan(0);
      expect(b.enrage, `${b.id} enrage`).toEqual(ENRAGE);
      expect(b.stationary).toBe(true);
      expect(b.radius).toBe(3);
      expect(b.skills.length, `${b.id} skills`).toBeGreaterThanOrEqual(2);
      expect((b.phases ?? []).length, `${b.id} phases`).toBeGreaterThanOrEqual(1);
      for (const ph of b.phases ?? []) expect(KOREAN.test(ph.name ?? ''), `${b.id} phase name`).toBe(true);
    }
  });

  it('skill ids are unique across all bosses, named in Korean, and every summon resolves', () => {
    const seen = new Map<string, string>();
    for (const b of BOSSES) {
      for (const sk of allSkills(b)) {
        expect(seen.get(sk.id), `${sk.id} of ${b.id} is also on ${seen.get(sk.id)}`).toBeUndefined();
        seen.set(sk.id, b.id);
        expect(KOREAN.test(sk.name), sk.id).toBe(true);
        if (sk.hint != null) expect(sk.hint.length, `${sk.id} hint`).toBeLessThanOrEqual(46);
        for (const a of partsOf(sk)) if (a.summon) expect(() => getMonster(a.summon!.unitId), `${sk.id} summon`).not.toThrow();
      }
    }
  });

  it('the bosses own summon-only units resolve by id and never enter a wave pool', () => {
    const pool = new Set<string>([...NORMAL_MONSTER_IDS, ...ZONES.flatMap(z => [...z.pool.map(p => p.id), ...z.mids])]);
    const known = new Set(MONSTERS.map(m => m.id));
    expect(new Set(BOSS_UNITS.map(u => u.id)).size).toBe(BOSS_UNITS.length);
    for (const u of BOSS_UNITS) {
      expect(getMonster(u.id)).toBe(u);
      expect(known.has(u.id), `${u.id} is not in MONSTERS`).toBe(false);
      expect(pool.has(u.id), `${u.id} is not in a wave pool`).toBe(false);
      expect(u.tier === 'boss' || u.tier === 'mid', `${u.id} tier`).toBe(false);
      expect(KOREAN.test(u.name), `${u.id} name`).toBe(true);
    }
  });
});

describe('boss voices', () => {
  it('every boss has a voice row with a known timbre and one known kind for each of its skills — no stray skill ids', () => {
    for (const b of BOSSES) {
      const v = BOSS_VOICE[b.id];
      expect(v, `${b.id} voice row`).toBeDefined();
      expect(BOSS_TIMBRES).toContain(v.timbre);
      expect(v.base).toBeGreaterThan(30);
      expect(v.motif.length).toBeGreaterThanOrEqual(2);
      const ids = allSkills(b).map(sk => sk.id);
      expect(Object.keys(v.kinds).sort(), `${b.id} kinds`).toEqual([...ids].sort());
      for (const id of ids) {
        expect(BOSS_KINDS).toContain(v.kinds[id]);
        expect(bossSkillKind(id)).toBe(v.kinds[id]);
      }
    }
    for (const id of Object.keys(BOSS_VOICE)) expect(BOSSES.some(b => b.id === id), `voice row ${id} has a boss`).toBe(true);
    expect(bossSkillKind('no_such_skill')).toBe('burst');
  });

  it('new bosses: the root pitch sits in the zone band and no two bosses of a zone share one', () => {
    for (const zone of Object.keys(ZONE_BOSSES) as FloorTheme[]) {
      const rows = BOSSES.filter(b => b.zone === zone).map(b => ({ id: b.id, base: BOSS_VOICE[b.id]?.base }));
      expect(new Set(rows.map(r => r.base)).size, `${zone} bases are unique`).toBe(rows.length);
      for (const r of rows) {
        if (BOSS_IDS.includes(r.id)) continue;
        expect(r.base, `${r.id} base`).toBeGreaterThanOrEqual(BASE_BAND[zone][0]);
        expect(r.base, `${r.id} base`).toBeLessThanOrEqual(BASE_BAND[zone][1]);
      }
    }
  });
});

describe('boss looks', () => {
  it('a registered look draws, names a colour and belongs to a boss; the classic four keep their own art', () => {
    for (const id of BOSS_IDS) expect(bossLook(id), `${id} is drawn by the classic code`).toBeUndefined();
    expect(bossLook('toString')).toBeUndefined();
    for (const [id, look] of Object.entries(BOSS_LOOKS)) {
      expect(RAID_BOSS_IDS, `look ${id}`).toContain(id);
      expect(typeof look.draw).toBe('function');
      expect(look.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // a boss with data shows its look colour on flashes / labels (or the old fallback while its art is missing)
    for (const b of BOSSES) {
      const look = bossLook(b.id);
      if (look) expect(unitLook('monster', b.id).color).toBe(look.color);
      expect(unitLook('monster', b.id).name).toBe(b.name);
    }
  });

  it('warning motifs point at real boss skills; summon looks cover the bosses own units', () => {
    const skills = new Set(BOSSES.flatMap(b => allSkills(b).map(sk => sk.id)));
    const planned = /^(cm|wd|kr|re|sh|cf|dm|em|md|xr|df|eb|td|ta|ap|im)_/;
    for (const [id, motif] of Object.entries(BOSS_TELE_MOTIF)) {
      expect(['pull', 'push', 'linger', 'spawn']).toContain(motif);
      expect(planned.test(id), `${id}: only new bosses have motifs`).toBe(true);
      // the look may land before the data: a motif row must match a skill once its boss exists
      const owner = BOSSES.find(b => allSkills(b).some(sk => sk.id.split('_')[0] === id.split('_')[0]));
      if (owner) expect(skills.has(id), `motif ${id}`).toBe(true);
    }
    for (const u of BOSS_UNITS) {
      expect(u.look, `${u.id} look key`).toBeDefined();
      expect(typeof MINION_LOOKS[u.look!], `${u.id} has a body in MINION_LOOKS`).toBe('function');
      expect(unitLook('monster', u.id).name).toBe(u.name);
    }
  });
});
