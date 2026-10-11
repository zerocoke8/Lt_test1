// 기획 19차 보스 레이드 — 사무실 boss voices (docs/bosses.md 6장). This zone's track owns this file.
// The classic boss row is unchanged (same base / motif as before; kinds = the old director table). One row per new
// boss below it: shredder_maw · coffee_machine · dead_monitor · endless_meeting — base 70–100 Hz, no two alike in the zone,
// a `kinds` entry for EVERY skill id of the boss (the phase skill too). Hear them on the debug 효과음 board.
// 기획 20차: root, motif and timbre are the 기획 19차 values; only the skill → kind tables follow the new patterns.
// (A summon's own skill — 가짜 창 fm_crash — has no row: an unknown id sounds like 'burst', which is what 6장 asks.)

import type { BossVoice } from './types';

export const OFFICE_BOSS_VOICE: Record<string, BossVoice> = {
  overtime_lord: { base: 82.4, motif: [0, 1, 0, -5], timbre: 'office', kinds: { ol_paperstorm: 'papers', ol_summon: 'summon', ol_stamp: 'stamp', ol_stamp_combo: 'stamp' } },
  // 기획 19차: the four new bosses (docs/bosses.md 6장 table)
  // 문서 파쇄기: a falling fourth and back — the motor biting down, paper rustle on top
  shredder_maw: { base: 87.3, motif: [0, -5, 0], timbre: 'paper', kinds: { sh_bite: 'blades', sh_lunge: 'slice', sh_scraps: 'papers', sh_whirl: 'blades' } },
  // 식지 않는 커피 머신: the lowest of the zone, a pump hum that rises a tone and settles
  coffee_machine: { base: 73.4, motif: [0, 2, 0], timbre: 'hum', kinds: { cf_steam: 'gas', cf_capsules: 'countdown', cf_pour: 'water', cf_overflow: 'water' } },
  // 퇴근 못 한 모니터: a CRT whine — the octave jump of a degauss, static on top
  dead_monitor: { base: 98, motif: [0, 12, 0], timbre: 'static', kinds: { dm_alt_tab: 'static', dm_cursor: 'beam', dm_bluescreen: 'static', dm_close: 'burst' } },
  // 끝나지 않는 회의: the 야근의 군주 motif a semitone lower, on a meeting-room bell
  endless_meeting: { base: 77.8, motif: [0, 1, 0, -5], timbre: 'bell', kinds: { em_call: 'stamp', em_move: 'papers', em_agenda: 'papers', em_laser: 'beam' } },
};
