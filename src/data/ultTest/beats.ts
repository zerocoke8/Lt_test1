// 기획 23차 궁극기 연출 강화 (docs/ult-fx.md 2-1, 4-3): the beats of a character's own 조준 / 드래그 ult, read from its
// data. Every part (action) gets one role — path · opener · build · finisher · twin · after · zone · support — and the
// renderer / sound director dress each role (a role default when a beat has no picture of its own). Exactly one
// finisher per ult: the enemy part of the `finale` stage whose last hit is latest (the climax gets the common finisher
// grammar: hit-stop, zoom, the impact frame …), its stage-mates are twins.
//
// PURE (data → numbers): no Math.random, no Date, no render imports. Cached per def object (a WeakMap), so a test
// fixture put in with setUltAltFixture gets fresh beats.

import type { Affects, AreaShape, SkillAction } from '../../types';
import { ULT_TEST, type UltAltDef } from './types';
import { ultAltBySkill } from './index';

export type UltBeatRole = 'path' | 'opener' | 'build' | 'finisher' | 'twin' | 'after' | 'zone' | 'support';

export interface UltBeat {
  /** −1 for the path beat. */
  actionIndex: number;
  /** '' for a stage-less part. */
  stage: string;
  role: UltBeatRole;
  /** Delay of its first hit (s after the cast). */
  at: number;
  /** Delay of its last hit: at + (hits − 1) · hitInterval. */
  end: number;
  hits: number;
  hitInterval: number;
  /** footprintRadius(area). */
  radius: number;
  affects: Affects;
  center: SkillAction['center'];
  /** Index among the actions sharing its stage, ordered by (at, actionIndex). */
  seq: number;
  /** How many actions share its stage. */
  seqN: number;
}

export interface UltBeats {
  skillId: string;
  charId: string;
  mode: 'aim' | 'drag';
  def: UltAltDef;
  /** Index = actionIndex. */
  beats: readonly UltBeat[];
  /** The drag path (skill id `<id>_path`), role 'path'. */
  path: UltBeat | null;
  /** actionIndex of the finisher. */
  finisher: number;
  finisherKind: 'strike' | 'bless';
  /** The finisher's `end`. */
  finisherAt: number;
  /** Earliest `at` of an action with effects. */
  firstAt: number;
  /** Radius of the earliest enemy beat (lock-on / 착지 컷 hole); 1.5 if none. */
  firstRadius: number;
  /** Some enemy beat has center 'point' (조준 lock-on sits on the aimed point). */
  onPoint: boolean;
}

/** The suffix of a drag path's own skill id (src/sim/players.ts ultMove). */
const PATH_SUFFIX = '_path';
/** The sim's default spacing of repeated hits (src/sim/skills.ts hitGap). */
const DEFAULT_HIT_INTERVAL = 0.2;
/** A beat this much later than the finisher is an encore (워든 해방, 버서커 마무리 일격): role 'after'. */
const AFTER_GAP = 0.5;
/** firstRadius when no part hits enemies. */
const NO_ENEMY_RADIUS = 1.5;

/** circle r · ring outer · cone / fan r · cross length · line / rect length / 2 · single 1. */
export function footprintRadius(a: AreaShape): number {
  switch (a.shape) {
    case 'circle':
      return a.radius;
    case 'ring':
      return a.outer;
    case 'cone':
    case 'fan':
      return a.radius;
    case 'cross':
      return a.length;
    case 'line':
    case 'rect':
      return a.length / 2;
    default:
      return 1;
  }
}

const cache = new WeakMap<UltAltDef, UltBeats>();

/** The beats of an alt ult (`<alt>_path` → the same alt's beats). Null for anything that is not an alt (today's ults, fallbacks). */
export function ultBeats(skillId: string): UltBeats | null {
  const id = skillId.endsWith(PATH_SUFFIX) ? skillId.slice(0, -PATH_SUFFIX.length) : skillId;
  const alt = ultAltBySkill(id);
  if (!alt) return null;
  let b = cache.get(alt.def);
  if (!b) {
    b = computeBeats(alt.def, alt.charId, alt.mode);
    cache.set(alt.def, b);
  }
  return b;
}

/** One beat (`<alt>_path`, any index → the path beat). */
export function ultBeatOf(skillId: string, actionIndex: number): UltBeat | null {
  const b = ultBeats(skillId);
  if (!b) return null;
  if (skillId.endsWith(PATH_SUFFIX)) return b.path;
  return b.beats[actionIndex] ?? null;
}

function computeBeats(def: UltAltDef, charId: string, mode: 'aim' | 'drag'): UltBeats {
  const acts = def.actions;
  const beats: UltBeat[] = acts.map((a, i) => {
    const hits = Math.max(1, a.hits ?? 1);
    const hitInterval = a.hitInterval ?? DEFAULT_HIT_INTERVAL;
    const at = a.delay ?? 0;
    return {
      actionIndex: i,
      stage: a.stage ?? '',
      role: 'build' as UltBeatRole,
      at,
      end: at + (hits - 1) * hitInterval,
      hits,
      hitInterval,
      radius: footprintRadius(a.area),
      affects: a.affects,
      center: a.center,
      seq: 0,
      seqN: 1,
    };
  });
  // seq / seqN: order among the parts of one stage by (at, index)
  const byStage = new Map<string, UltBeat[]>();
  for (const b of beats) {
    const list = byStage.get(b.stage);
    if (list) list.push(b);
    else byStage.set(b.stage, [b]);
  }
  for (const list of byStage.values()) {
    list.sort((p, q) => p.at - q.at || p.actionIndex - q.actionIndex);
    list.forEach((b, i) => {
      b.seq = i;
      b.seqN = list.length;
    });
  }

  // the finisher: the latest-landing enemy part of the finale stage (ties: bigger footprint, then lower index)
  const later = (p: UltBeat, q: UltBeat) => (q.end !== p.end ? q.end > p.end : q.radius !== p.radius ? q.radius > p.radius : q.actionIndex < p.actionIndex);
  // a lingering field (a zone) is never the climax while a strike is there: its picture is the decor, not a burst
  const pick = (ok: (b: UltBeat) => boolean): UltBeat | null => {
    let best: UltBeat | null = null;
    for (const b of beats) if (!acts[b.actionIndex].zone && ok(b) && (!best || later(best, b))) best = b;
    if (best) return best;
    for (const b of beats) if (ok(b) && (!best || later(best, b))) best = b;
    return best;
  };
  let kind: 'strike' | 'bless' = 'strike';
  let fin: UltBeat | null = null;
  if (def.finale) {
    fin = pick(b => b.stage === def.finale && b.affects === 'enemies');
    if (!fin) {
      fin = pick(b => b.stage === def.finale);
      if (fin) kind = 'bless';
    }
  }
  if (!fin) {
    fin = pick(b => b.affects === 'enemies');
    if (!fin) {
      fin = pick(() => true);
      kind = 'bless';
    }
  }
  const finisherAt = fin ? fin.end : 0;

  // roles, first match wins (path is separate)
  let opener: UltBeat | null = null;
  for (const b of beats) {
    const a = acts[b.actionIndex];
    if (b === fin) b.role = 'finisher';
    else if (fin && b.stage !== '' && b.stage === fin.stage) b.role = 'twin';
    else if (a.zone) b.role = 'zone';
    else if (b.affects !== 'enemies') b.role = 'support';
    else if (b.at > finisherAt + AFTER_GAP) b.role = 'after';
    else {
      b.role = 'build';
      if (!opener || b.at < opener.at) opener = b;
    }
  }
  if (opener) opener.role = 'opener';

  let firstAt = Infinity;
  let firstEnemy: UltBeat | null = null;
  let onPoint = false;
  for (const b of beats) {
    if (acts[b.actionIndex].effects.length > 0 || acts[b.actionIndex].summon) firstAt = Math.min(firstAt, b.at);
    if (b.affects !== 'enemies') continue;
    if (!firstEnemy || b.at < firstEnemy.at) firstEnemy = b;
    if (b.center === 'point') onPoint = true;
  }

  let path: UltBeat | null = null;
  const mp = mode === 'drag' ? def.move?.path : undefined;
  if (mp) {
    const at = mp.delay ?? ULT_TEST.firstHit;
    path = {
      actionIndex: -1,
      stage: mp.stage ?? 'path',
      role: 'path',
      at,
      end: at,
      hits: 1,
      hitInterval: DEFAULT_HIT_INTERVAL,
      // the line runs from where the character stood to where it lands: at most the move's range
      radius: (def.move?.maxRange ?? ULT_TEST.dragRange) / 2,
      affects: mp.affects,
      center: 'point',
      seq: 0,
      seqN: 1,
    };
  }

  return {
    skillId: def.id,
    charId,
    mode,
    def,
    beats,
    path,
    finisher: fin ? fin.actionIndex : -1,
    finisherKind: kind,
    finisherAt,
    firstAt: Number.isFinite(firstAt) ? firstAt : ULT_TEST.firstHit,
    firstRadius: firstEnemy ? firstEnemy.radius : NO_ENEMY_RADIUS,
    onPoint,
  };
}
