// 기획 19차 보스 레이드: the boss sound registry's shapes (docs/bosses.md 5장, docs/sfx.md 3-7). One row per boss:
// root pitch + motif (boss.intro / boss.phase / boss.death), a timbre token (the layers on top of the motif) and one
// wind-up / impact kind per skill id (boss.windup.<kind> → boss.impact.<kind>).

/** boss.windup.<kind> / boss.impact.<kind>. The first 12 are the classic ones; water · static · chime are 기획 19차. */
export const BOSS_KINDS = ['doors', 'countdown', 'papers', 'stamp', 'summon', 'blades', 'gas', 'slice', 'burst', 'beam', 'tentacle', 'ring', 'water', 'static', 'chime'] as const;
export type BossKind = (typeof BOSS_KINDS)[number];

/**
 * What a boss sounds like on top of its motif. elevator · office · surgery · abyss are the classic four (unchanged);
 * the other eight are shared by the new bosses.
 */
export const BOSS_TIMBRES = ['elevator', 'office', 'surgery', 'abyss', 'bell', 'hum', 'water', 'static', 'paper', 'steps', 'wind', 'clatter'] as const;
export type BossTimbre = (typeof BOSS_TIMBRES)[number];

export interface BossVoice {
  /** Root pitch (Hz). Zone bands: 로비 90–135 · 사무실 70–100 · 병동 100–160 · 옥상 45–70; unique inside a zone. */
  base: number;
  /** Short motif in semitones from the root. */
  motif: number[];
  timbre: BossTimbre;
  /** Skill id → kind, for every skill of the boss (phase skills too). A skill without a row sounds like 'burst'. */
  kinds: Record<string, BossKind>;
}
