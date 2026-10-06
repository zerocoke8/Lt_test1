// 기획 13차 Impact 표 (docs/skill-renewal.md 2-2, 2-7): the one place that says how hard each `skillId:stage` of the
// renewed drag skills and ults hits the screen — hit-stop (ms at the default 75 ms setting), camera shake (logical px),
// an area flash inside the footprint, and (ults only) a full-screen flash. Only MY casts kick; other players' / bots'
// big beats get the area flash at k = 0.55 and half the screen flash, never a stop or a shake.

export interface ImpactSpec {
  /** Hit-stop ms at the default setting (scaled by JuiceSettings.hitStopMs / 75). 0 = none. */
  stop: number;
  /** Camera shake, logical px (before the shake setting / phone boost). */
  shake: number;
  /** Area flash strength inside the footprint (0 = none). Big beats ~0.9, others ~0.5. */
  flash: number;
  /** Full-screen flash alpha (ult finales only, 0.35–0.4). */
  screen?: number;
  /** Screen flash colour (default white). */
  screenColor?: string;
  /**
   * Which hit carries the stop / big shake: 'last' = only the last hit of a multi-hit stage (the others get `minor`),
   * a number = only that actionIndex of a stage shared by several actions (judgement ×3, toss ×2).
   */
  only?: 'last' | number;
  /** Shake of the other hits when `only` is set. */
  minor?: number;
}

const NONE: ImpactSpec = { stop: 0, shake: 0, flash: 0 };
const big = (stop: number, shake: number, rest: Partial<ImpactSpec> = {}): ImpactSpec => ({ stop, shake, flash: 0.9, ...rest });
const small = (shake: number, flash = 0.5): ImpactSpec => ({ stop: 0, shake, flash });
const finale = (stop: number, shake: number, screen = 0.38, rest: Partial<ImpactSpec> = {}): ImpactSpec => ({ stop, shake, flash: 1, screen, ...rest });

/** Every stage of the 15 renewed drags / ults (tests/render/stagefx.test.ts fails on a missing one). */
export const IMPACT: Readonly<Record<string, ImpactSpec>> = {
  // ── tanks ──
  'guardian_d:slam': small(3),
  'guardian_d:wave': big(80, 6),
  'guardian_d:wall': NONE,
  'guardian_u:aegis': NONE,
  'guardian_u:rally': small(2),
  'guardian_u:citadel': finale(90, 9),
  'guardian_u:barrier': NONE,
  'paladin_d:brand': small(2),
  'paladin_d:blessing': NONE,
  'paladin_d:pillar': big(80, 6),
  'paladin_d:core': small(0, 0.7),
  'paladin_u:sanctuary': NONE,
  'paladin_u:spear': small(1.5),
  'paladin_u:tribunal': finale(100, 10, 0.4, { screenColor: '#fff3b0' }),
  'warden_d:hook': small(2),
  'warden_d:crush': big(75, 6),
  'warden_d:fence': NONE,
  'warden_u:chainstorm': small(2),
  'warden_u:cage': finale(100, 10),
  'warden_u:prison': NONE,
  'warden_u:release': small(4, 0.7),
  // ── melee ──
  'blade_d:dash': small(3),
  'blade_d:return': small(3),
  'blade_d:burst': big(80, 6),
  'blade_u:hop': small(1.5),
  'blade_u:storm': small(1.5, 0.35),
  'blade_u:issen': finale(100, 9),
  'berserker_d:slam': big(70, 7),
  'berserker_d:split': small(3),
  'berserker_d:quake': small(3),
  'berserker_u:roar': small(8, 0.6),
  'berserker_u:frenzy': NONE,
  'berserker_u:finale': finale(100, 10, 0.38, { screenColor: '#ffd0c2' }),
  'shadow_d:clone': small(1.5),
  'shadow_d:slide': NONE,
  'shadow_d:execute': big(80, 5),
  'shadow_u:vanish': NONE,
  'shadow_u:dance': small(1.5, 0.4),
  'shadow_u:moon': finale(110, 8, 0.38, { screenColor: '#e6dcff' }),
  // ── ranged ──
  'ranger_d:volley': small(1, 0.35),
  'ranger_d:pierce': big(75, 6),
  'ranger_u:barrage': small(0.8, 0.25),
  'ranger_u:rain': small(1.5, 0.35),
  'ranger_u:skyshot': finale(90, 8, 0.36, { screenColor: '#fff6d0' }),
  'mage_d:meteor': small(0, 0.5),
  // the doc's "흔들림 9" for the big meteor is over the drag budget (4–7): capped at 7
  'mage_d:bigmeteor': big(90, 7),
  'mage_d:lava': NONE,
  'mage_u:blizzard': NONE,
  'mage_u:freeze': small(4, 0.7),
  'mage_u:shatter': finale(100, 10, 0.38, { screenColor: '#e0f7ff' }),
  'gunner_d:blast1': small(3),
  'gunner_d:blast2': small(3),
  'gunner_d:slug': big(75, 7),
  'gunner_u:shells': small(1.2, 0.35),
  'gunner_u:heavy': finale(110, 10, 0.4, { screenColor: '#ffe2b8' }),
  // ── healers ──
  'cleric_d:descend': NONE,
  'cleric_d:sanctuary': NONE,
  'cleric_d:bell': big(50, 3),
  'cleric_u:grace': { stop: 0, shake: 0, flash: 0, screen: 0.35, screenColor: '#fffbe6' },
  'cleric_u:judgement': { stop: 70, shake: 5, flash: 0.8, only: 3, minor: 2 },
  'medic_d:firstaid': NONE,
  'medic_d:syringe': NONE,
  'medic_d:defib': big(50, 3),
  'medic_u:golden': NONE,
  'medic_u:siren': NONE,
  'exorcist_d:seal': small(2),
  'exorcist_d:destroy': big(60, 4),
  'exorcist_u:greatseal': small(2),
  'exorcist_u:storm': NONE,
  'exorcist_u:destroy': finale(80, 6, 0.38, { screenColor: '#ffd6d6' }),
  // ── supports ──
  'bard_d:beat1': small(1, 0.4),
  'bard_d:encore': NONE,
  'bard_d:beat2': small(1.5, 0.4),
  'bard_d:forte': big(75, 3),
  'bard_u:choir': NONE,
  'bard_u:encore': NONE,
  'bard_u:beat': { stop: 0, shake: 4, flash: 0.6, screen: 0.3, screenColor: '#ffe6ff', only: 'last', minor: 2 },
  'chrono_d:rift': small(2),
  'chrono_d:rewind': NONE,
  'chrono_d:stop': big(75, 4),
  'chrono_u:stasis': { stop: 0, shake: 3, flash: 0.5, screen: 0.3, screenColor: '#eef0ff' },
  'puppeteer_d:toss': { stop: 75, shake: 2, flash: 0.6, only: 1, minor: 1 },
  'puppeteer_d:thread': NONE,
  'puppeteer_u:open': NONE,
  'puppeteer_u:charm': NONE,
  'puppeteer_u:dolls': NONE,
  'puppeteer_u:curtaincall': finale(80, 5, 0.38, { screenColor: '#ffd6ea' }),
  // the paper dolls' death burst (a summon: never kicks, only flashes)
  'paper_doll_death:burst': small(0, 0.5),
  'paper_doll_grand_death:burst': small(0, 0.6),
};

/** The kick of one landed hit (hit `hit` of `hits`, the stage's `actionIndex`): null when this hit is a quiet one. */
export function impactOf(key: string, hit: number, hits: number, actionIndex: number, out: ImpactSpec): ImpactSpec | null {
  const spec = IMPACT[key];
  if (!spec) return null;
  out.stop = spec.stop;
  out.shake = spec.shake;
  out.flash = spec.flash;
  out.screen = spec.screen ?? 0;
  out.screenColor = spec.screenColor ?? '#ffffff';
  const main = spec.only === undefined || (spec.only === 'last' ? hit >= hits - 1 : spec.only === actionIndex);
  if (!main) {
    out.stop = 0;
    out.shake = spec.minor ?? 0;
    out.screen = 0;
    out.flash = Math.min(out.flash, 0.5);
  }
  return out.stop > 0 || out.shake > 0 || out.flash > 0 || (out.screen ?? 0) > 0 ? out : null;
}
