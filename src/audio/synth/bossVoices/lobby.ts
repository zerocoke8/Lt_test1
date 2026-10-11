// 기획 19차 보스 레이드 — 로비·상가 boss voices (docs/bosses.md 5장). This zone's track owns this file.
// The classic boss row is unchanged (same base / motif as before; kinds = the old director table). Add one row per new
// boss below it: claw_machine · washer_drum · karaoke_room · reverse_escalator — base 90–135 Hz, no two alike in the zone,
// a `kinds` entry for EVERY skill id of the boss (the phase skill too). Hear them on the debug 효과음 board.
//   claw_machine: { base: 123.5, motif: [0, 4, 7], timbre: 'clatter', kinds: { cm_grab: 'tentacle', cm_coins: 'countdown', cm_prizes: 'summon', cm_jackpot: 'chime' } },
// 기획 20차 (docs/bosses.md 6장): base / motif / timbre are unchanged; only the skill id → kind tables follow the new patterns.

import type { BossVoice } from './types';

export const LOBBY_BOSS_VOICE: Record<string, BossVoice> = {
  elevator_keeper: { base: 98, motif: [0, -4, -1], timbre: 'elevator', kinds: { ek_doors: 'doors', ek_doors_back: 'doors', ek_summon: 'summon', ek_counter: 'countdown' } },
  // 인형 뽑기 기계: a bright major arpeggio (the prize jingle) over rattling plastic
  claw_machine: { base: 123.5, motif: [0, 4, 7], timbre: 'clatter', kinds: { cm_grab: 'tentacle', cm_coins: 'countdown', cm_prizes: 'summon', cm_jackpot: 'chime' } },
  // 혼자 도는 세탁기: the drum's dull double thump, then a step down
  washer_drum: { base: 110, motif: [0, 0, -2], timbre: 'water', kinds: { wd_roll: 'ring', wd_suds: 'water', wd_socks: 'summon', wd_roll_back: 'ring' } },
  // 지하 7번 노래방: the score fanfare of a karaoke machine
  karaoke_room: { base: 130.8, motif: [0, 5, 7, 5], timbre: 'bell', kinds: { kr_mirror: 'beam', kr_beat: 'countdown', kr_high_note: 'chime', kr_mirror_back: 'beam' } },
  // 거꾸로 가는 에스컬레이터: four steps going down
  reverse_escalator: { base: 92.5, motif: [0, -1, -2, -3], timbre: 'steps', kinds: { re_lurch: 'doors', re_stop: 'stamp', re_handrail: 'tentacle', re_lurch_twice: 'doors' } },
};
