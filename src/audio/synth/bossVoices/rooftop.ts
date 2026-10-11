// 기획 19차 보스 레이드 — 옥상·이계 boss voices (docs/bosses.md 5장). This zone's track owns this file.
// The classic boss row is unchanged (same base / motif as before; kinds = the old director table). Add one row per new
// boss below it: tank_dweller · thunder_antenna · answering_pencil · inverted_moon — base 45–70 Hz, no two alike in the zone,
// a `kinds` entry for EVERY skill id of the boss (the phase skill too). Hear them on the debug 효과음 board.
//   tank_dweller: { base: 65.4, motif: [0, 3, -2], timbre: 'water', kinds: { td_flood: 'water', td_drain: 'gas', td_umbrellas: 'summon', td_flood_up: 'water' } },

import type { BossVoice } from './types';

export const ROOFTOP_BOSS_VOICE: Record<string, BossVoice> = {
  abyss_watcher: {
    base: 55,
    motif: [0, 1, -1, 0],
    timbre: 'abyss',
    kinds: { boss_burst: 'burst', boss_summon: 'summon', boss_rift: 'beam', boss_beams: 'beam', boss_tentacles: 'tentacle', boss_abyss_ring: 'ring' },
  },
  // 물탱크의 주인: a low C, a minor third up then sagging under the root — water sloshing in a steel drum
  tank_dweller: {
    base: 65.4,
    motif: [0, 3, -2],
    timbre: 'water',
    kinds: { td_flood: 'water', td_drain: 'gas', td_umbrellas: 'summon', td_flood_up: 'water' },
  },
  // 천둥 안테나: the lowest root of the zone and an octave jump — hum, a crack, hum again
  thunder_antenna: {
    base: 49,
    motif: [0, 12, 0],
    timbre: 'static',
    kinds: { ta_bolt: 'static', ta_static: 'ring', ta_crackle: 'burst', ta_double_bolt: 'static' },
  },
  // 대답하는 연필: a slow chromatic crawl that slips back under the root — a pencil scratching out a name
  answering_pencil: {
    base: 58.3,
    motif: [0, 1, 2, -1],
    timbre: 'paper',
    kinds: { ap_box: 'blades', ap_pin: 'stamp', ap_stroke: 'slice', ap_name: 'slice' },
  },
  // 거꾸로 뜬 달: up a tone, down a minor third, home — wind over an empty roof
  inverted_moon: {
    base: 61.7,
    motif: [0, 2, -3, 0],
    timbre: 'wind',
    kinds: { im_eclipse: 'beam', im_hands: 'tentacle', im_shadows: 'summon', im_moonbeam: 'beam' },
  },
};
