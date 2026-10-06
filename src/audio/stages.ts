// 기획 13차 효과음: renewed drag / ult stages → sounds (docs/sfx.md 3-2; stage names = skill-renewal.md 3장).
// A stage maps to cues, or to null when a sibling stage's sound already covers that moment (e.g. 가디언 aegis lands
// with rally). A stage missing from this table falls back to the role default (drag._role / ult._role).

export interface Cue {
  id: string;
  /**
   * land (default): when the stage lands (skillStage hit 0, deduped per cast) · hit: every hit of the stage, pitch
   * stepping · cast: when the stage is cast (skillCast), e.g. a charge-up between beats · zone: the stage's zone —
   * a timed loop (loop: true) and/or a sound per tick.
   */
  on?: 'land' | 'hit' | 'cast' | 'zone';
  /** Seconds of build-up inside the sound before its impact: scheduled from skillCast so the impact meets the hit. */
  lead?: number;
  /** Semitones per hit (on: 'hit'); random ± when jitter. */
  step?: number;
  jitter?: number;
  /** At most this many hits sound (on: 'hit'). */
  max?: number;
  /** Zone: loop the sound for the zone's duration. */
  loop?: boolean;
  /** Zone: sound per tick. */
  tick?: string;
  /** Zone / loop end: sound when it ends. */
  end?: string;
  /** Duck the effect bus by db for `[db, seconds before impact]` (silence before a big beat, 4-4). */
  duck?: [number, number];
  /** Other players hear this one (their ult: only the final beat, 4-3). */
  fin?: true;
  /** Last hit (index) gets this id instead (바드 마지막 박자). */
  last?: string;
  /** Plain loop of this many seconds (non-zone stages, e.g. 버서커 광란). */
  loopFor?: number;
  /** Extra dB. */
  db?: number;
  /** Special handling in the director. */
  special?: 'stasis' | 'countdown';
}

export type StageCues = Cue | Cue[] | null;

interface CharStages {
  drag: Record<string, StageCues>;
  ult: Record<string, StageCues>;
}

export const STAGE_CUES: Record<string, CharStages> = {
  guardian: {
    drag: {
      slam: { id: 'drag.guardian.slam' },
      wave: [{ id: 'drag.guardian.charge', on: 'cast' }, { id: 'drag.guardian.wave', fin: true }],
      wall: { id: 'drag.guardian.wall', on: 'zone', loop: true, end: 'drag.guardian.shatter', db: -9 },
    },
    ult: {
      aegis: null,
      rally: { id: 'ult.guardian.rally' },
      citadel: { id: 'ult.guardian.citadel', fin: true },
      barrier: { id: 'ult.guardian.barrier', on: 'zone', loop: true, end: 'drag.guardian.shatter', db: -10 },
    },
  },
  paladin: {
    drag: {
      brand: { id: 'drag.paladin.brand' },
      blessing: { id: 'drag.paladin.blessing', db: -4 },
      pillar: [{ id: 'drag.paladin.charge', on: 'cast' }, { id: 'drag.paladin.pillar', fin: true }],
      core: null,
    },
    ult: {
      sanctuary: null,
      spear: { id: 'ult.paladin.spear', on: 'hit', step: 1, max: 8, db: -4 },
      tribunal: { id: 'ult.paladin.tribunal', fin: true },
    },
  },
  warden: {
    drag: {
      hook: { id: 'drag.warden.hook' },
      crush: { id: 'drag.warden.crush', fin: true },
      fence: { id: 'drag.warden.fence', on: 'zone', tick: 'drag.warden.fence', end: 'drag.warden.drop', db: -10 },
    },
    ult: {
      chainstorm: null,
      cage: { id: 'ult.warden.cage' },
      prison: { id: 'ult.warden.prison', on: 'zone', loop: true, db: -10 },
      release: { id: 'ult.warden.release', fin: true },
    },
  },
  blade: {
    drag: {
      dash: { id: 'drag.blade.dash' },
      return: { id: 'drag.blade.return' },
      burst: { id: 'drag.blade.burst', fin: true },
    },
    ult: {
      hop: { id: 'ult.blade.hop', on: 'hit', step: 2, max: 5, db: -3 },
      storm: { id: 'ult.blade.storm', on: 'hit', max: 8, db: -5 },
      issen: { id: 'ult.blade.issen', duck: [-12, 0.2], fin: true },
    },
  },
  berserker: {
    drag: {
      slam: { id: 'drag.berserker.slam', lead: 0.12 },
      split: { id: 'drag.berserker.split', lead: 0.15 },
      quake: { id: 'drag.berserker.quake', fin: true },
    },
    ult: {
      roar: { id: 'ult.berserker.roar' },
      frenzy: { id: 'ult.berserker.frenzy', loopFor: 7.2, db: -12 },
      finale: { id: 'ult.berserker.finale', lead: 0.6, fin: true },
    },
  },
  shadow: {
    drag: {
      clone: { id: 'drag.shadow.clone' },
      slide: null,
      execute: { id: 'drag.shadow.execute', lead: 0.25, fin: true },
    },
    ult: {
      vanish: null,
      dance: { id: 'ult.shadow.dance', on: 'hit', step: 1, max: 6, db: -3 },
      moon: { id: 'ult.shadow.moon', lead: 0.35, duck: [-10, 0.35], fin: true },
    },
  },
  ranger: {
    drag: {
      volley: [{ id: 'drag.ranger.draw', on: 'cast' }, { id: 'drag.ranger.volley', on: 'hit', step: 2, max: 3 }],
      pierce: { id: 'drag.ranger.pierce', lead: 0.25, fin: true },
    },
    ult: {
      barrage: { id: 'ult.ranger.barrage', on: 'hit', jitter: 1, max: 12, db: -6 },
      rain: { id: 'ult.ranger.rain', lead: 0.3 },
      skyshot: { id: 'ult.ranger.skyshot', lead: 0.3, fin: true },
    },
  },
  mage: {
    drag: {
      meteor: [{ id: 'drag.mage.sigil', on: 'cast', db: -4 }, { id: 'drag.mage.meteor', on: 'hit', step: -1, max: 6, db: -3 }],
      bigmeteor: { id: 'drag.mage.bigmeteor', lead: 0.75, fin: true },
      lava: { id: 'drag.mage.lava', on: 'zone', loop: true, db: -12 },
    },
    ult: {
      blizzard: { id: 'ult.mage.blizzard', on: 'zone', loop: true, special: 'countdown', db: -8 },
      freeze: { id: 'ult.mage.freeze' },
      shatter: { id: 'ult.mage.shatter', fin: true },
    },
  },
  gunner: {
    drag: {
      blast1: [{ id: 'drag.gunner.pump', on: 'cast' }, { id: 'drag.gunner.blast' }],
      blast2: { id: 'drag.gunner.blast', step: -1 },
      slug: { id: 'drag.gunner.slug', lead: 0.3, fin: true },
    },
    ult: {
      shells: { id: 'ult.gunner.shells', on: 'hit', jitter: 1, max: 10, db: -5 },
      heavy: { id: 'ult.gunner.heavy', lead: 0.46, fin: true },
    },
  },
  cleric: {
    drag: {
      descend: { id: 'drag.cleric.descend' },
      sanctuary: { id: 'drag.cleric.sanctuary', on: 'zone', tick: 'drag.cleric.sanctuary', db: -12 },
      bell: { id: 'drag.cleric.bell', lead: 0.4, fin: true },
    },
    ult: {
      grace: { id: 'ult.cleric.grace' },
      judgement: { id: 'ult.cleric.judgement', on: 'hit', step: -3, max: 3, fin: true },
    },
  },
  medic: {
    drag: {
      firstaid: { id: 'drag.medic.firstaid' },
      syringe: { id: 'drag.medic.syringe', db: -4 },
      defib: { id: 'drag.medic.defib', lead: 0.15, fin: true },
    },
    ult: {
      golden: { id: 'ult.medic.golden', fin: true },
      siren: { id: 'ult.medic.siren', on: 'hit', max: 3, db: -4 },
    },
  },
  exorcist: {
    drag: {
      seal: { id: 'drag.exorcist.seal' },
      destroy: { id: 'drag.exorcist.destroy', lead: 0.15, fin: true },
    },
    ult: {
      greatseal: { id: 'ult.exorcist.greatseal' },
      storm: { id: 'ult.exorcist.storm', on: 'zone', loop: true, db: -10 },
      destroy: { id: 'ult.exorcist.destroy', duck: [-12, 0.15], fin: true },
    },
  },
  bard: {
    drag: {
      beat1: { id: 'drag.bard.beat1' },
      encore: { id: 'drag.bard.encore', db: -4 },
      beat2: { id: 'drag.bard.beat2' },
      forte: { id: 'drag.bard.forte', fin: true },
    },
    ult: {
      choir: { id: 'ult.bard.choir' },
      encore: { id: 'drag.bard.encore', db: -4 },
      beat: { id: 'ult.bard.beat', on: 'hit', max: 3, last: 'ult.bard.beat.last', fin: true },
    },
  },
  chrono: {
    drag: {
      rift: [{ id: 'drag.chrono.rift' }, { id: 'drag.chrono.wind', on: 'cast', db: -6 }],
      rewind: { id: 'drag.chrono.rewind' },
      stop: { id: 'drag.chrono.stop', fin: true },
    },
    ult: {
      stasis: { id: 'ult.chrono.stasis', special: 'stasis', fin: true },
    },
  },
  puppeteer: {
    drag: {
      toss: { id: 'drag.puppeteer.toss', on: 'hit', step: 2, max: 2 },
      thread: { id: 'drag.puppeteer.thread', on: 'zone', tick: 'drag.puppeteer.scratch', fin: true },
    },
    ult: {
      open: { id: 'ult.puppeteer.open' },
      charm: { id: 'ult.puppeteer.charm' },
      dolls: null,
      curtaincall: { id: 'ult.puppeteer.curtaincall', fin: true },
    },
  },
};

/** Cues of a stage: [] = covered by a sibling, undefined = not in the table (role default). */
export function stageCues(charId: string, slot: 'drag' | 'ult', stage: string): Cue[] | undefined {
  const row = STAGE_CUES[charId]?.[slot];
  if (!row || !(stage in row)) return undefined;
  const c = row[stage];
  return c == null ? [] : Array.isArray(c) ? c : [c];
}
