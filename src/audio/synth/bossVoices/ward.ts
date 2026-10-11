// 기획 19차 보스 레이드 — 폐병동 boss voices (docs/bosses.md 5장). This zone's track owns this file.
// The classic boss row is unchanged (same base / motif as before; kinds = the old director table). Add one row per new
// boss below it: morgue_drawers · xray_machine · defibrillator · empty_beds — base 100–160 Hz, no two alike in the zone,
// a `kinds` entry for EVERY skill id of the boss (the phase skill too). Hear them on the debug 효과음 board.
//   morgue_drawers: { base: 116.5, motif: [0, -1, -1], timbre: 'wind', kinds: { md_drawers: 'doors', md_frost: 'gas', md_wake: 'summon', md_drawers_right: 'doors' } },

import type { BossVoice } from './types';

export const WARD_BOSS_VOICE: Record<string, BossVoice> = {
  surgeon_director: { base: 110, motif: [0, 6, 5], timbre: 'surgery', kinds: { sd_scalpels: 'blades', sd_scalpel_storm: 'blades', sd_summon: 'summon', sd_gas: 'gas', sd_incision: 'slice' } },
  // 번호 없는 서랍: a cold draught that sinks a half step and stays there; drawers slam like doors
  morgue_drawers: { base: 116.5, motif: [0, -1, -1], timbre: 'wind', kinds: { md_drawers: 'doors', md_frost: 'gas', md_wake: 'summon', md_drawers_right: 'doors' } },
  // 투시 촬영기: a machine hum that jumps a fifth and falls back (charge → flash)
  xray_machine: { base: 146.8, motif: [0, 7, 0], timbre: 'hum', kinds: { xr_scan: 'beam', xr_develop: 'burst', xr_dolls: 'summon', xr_sweep: 'beam' } },
  // 멈추지 않는 제세동기: two flat beeps, then the octave whine of the charge
  defibrillator: { base: 123.5, motif: [0, 0, 12], timbre: 'static', kinds: { df_shock: 'static', df_revive: 'countdown', df_jolt: 'burst', df_double: 'static' } },
  // 빈 병상 행렬: rattling wheels rolling downhill
  empty_beds: { base: 103.8, motif: [0, -2, -5], timbre: 'clatter', kinds: { eb_lineup: 'tentacle', eb_sheet: 'papers', eb_disinfect: 'gas', eb_double: 'papers' } },
};
