// Strict parsing of client messages (src/net/protocol.ts). Anything malformed → null (ignored by the server).
// Returned objects are rebuilt from scratch: no extra fields, no prototype tricks reach the sim.

import type { ClientMsg, ExpRunInfo, PresetChoice } from '../src/net/protocol';
import { GOEDAM_OPTION_RE } from '../src/net/protocol';
import type { Command, DebugAction, ExpeditionCarry, Vec2 } from '../src/types';
import type { GearLoadout, GearSpec } from '../src/data/gear';
import { CHARACTERS, PETS, isFieldEventId } from '../src/data';
import { EXPEDITION_STAGES } from '../src/data/stages';
import { RUN_ID_RE } from '../src/expedition/runCheck';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);
/** 괴담 option / room id: short snake_case only (the sim checks it against the room). */
const goedamId = (v: unknown): v is string => typeof v === 'string' && GOEDAM_OPTION_RE.test(v);

let charIds: Set<string> | null = null;
let petIds: Set<string> | null = null;

export function parsePreset(v: unknown): PresetChoice | null {
  if (!isObj(v)) return null;
  charIds ??= new Set(CHARACTERS.map(c => c.id));
  petIds ??= new Set(PETS.map(p => p.id));
  const { characters, pets } = v;
  if (!Array.isArray(characters) || characters.length !== 3 || !characters.every(id => typeof id === 'string' && charIds!.has(id))) return null;
  if (!Array.isArray(pets) || pets.length !== 3 || !pets.every(id => typeof id === 'string' && petIds!.has(id))) return null;
  // one party = 3 different characters and 3 different pets (the preset screen enforces it; a modified client must not
  // bypass it). Different players may still pick the same character (기획 3차).
  if (new Set(characters).size !== 3 || new Set(pets).size !== 3) return null;
  return { characters: [...(characters as string[])], pets: [...(pets as string[])] };
}

function parseVec(v: unknown): Vec2 | null {
  if (!isObj(v) || !isNum(v.x) || !isNum(v.y)) return null;
  if (Math.abs(v.x) > 1e4 || Math.abs(v.y) > 1e4) return null;
  return { x: v.x, y: v.y };
}

function parseDebug(v: unknown): DebugAction | null {
  if (!isObj(v)) return null;
  switch (v.kind) {
    case 'chargeUlt':
    case 'resetCooldowns':
      return { kind: v.kind };
    case 'killAll':
    case 'skipFloor':
    case 'forceEnrage':
    case 'expeditionClearStage':
    case 'wipeParty': // 기획 16차
      return { kind: v.kind };
    case 'jumpFloor':
      return isInt(v.floor, 1, 1000) ? { kind: 'jumpFloor', floor: v.floor } : null;
    case 'goedamNext':
      if (v.room === undefined) return { kind: 'goedamNext' };
      return goedamId(v.room) ? { kind: 'goedamNext', room: v.room } : null;
    case 'forceGroggy':
      // 기획 13차: fill the boss groggy gauge (default full)
      if (v.fill === undefined) return { kind: 'forceGroggy' };
      return isNum(v.fill) && v.fill >= 0 && v.fill <= 1 ? { kind: 'forceGroggy', fill: v.fill } : null;
    case 'fieldEventNext':
      // 기획 12차: a known 돌발 괴담 id, or none (any that fits)
      if (v.id === undefined) return { kind: 'fieldEventNext' };
      return isFieldEventId(v.id) ? { kind: 'fieldEventNext', id: v.id } : null;
  }
  return null;
}

/** In-game command. `player` fields are placeholders (the server overwrites them with the sender's slot). */
export function parseCommand(v: unknown): Command | null {
  if (!isObj(v)) return null;
  switch (v.type) {
    case 'swap': {
      const pos = parseVec(v.pos);
      return pos && isInt(v.partyIndex, 0, 9) ? { type: 'swap', player: 0, partyIndex: v.partyIndex, pos } : null;
    }
    case 'pet': {
      const pos = parseVec(v.pos);
      return pos && isInt(v.petIndex, 0, 9) ? { type: 'pet', player: 0, petIndex: v.petIndex, pos } : null;
    }
    case 'ult':
      return { type: 'ult', player: 0 };
    case 'chooseReward':
      return isInt(v.offerIndex, 0, 9) ? { type: 'chooseReward', player: 0, offerIndex: v.offerIndex } : null;
    case 'goedam':
      // 기획 10차: an option id or 'continue'; the room decides whether it is valid for this slot
      return goedamId(v.option) ? { type: 'goedam', player: 0, option: v.option } : null;
    case 'quit':
      return { type: 'quit' };
    case 'debug': {
      const action = parseDebug(v.action);
      return action ? { type: 'debug', action } : null;
    }
    case 'tunables': {
      if (!isObj(v.patch)) return null;
      // values are validated by the sim (sanitizeTunablesPatch); here only a flat copy of primitive fields
      const patch: Obj = {};
      for (const [k, x] of Object.entries(v.patch)) if (typeof x === 'number' || typeof x === 'boolean') patch[k] = x;
      return { type: 'tunables', patch };
    }
  }
  return null;
}

/** 기획 16차: size bounds of a run sent with expQueue (beyond them the message is junk). */
export const RUN_LIMITS = { bag: 64, rewards: 48, traces: 16, seen: 64 } as const;

const arr = (v: unknown, max: number): unknown[] | null => (Array.isArray(v) && v.length <= max ? v : null);
const pick = (v: unknown, keys: readonly string[]): Obj => {
  const o: Obj = {};
  if (isObj(v)) for (const k of keys) if (k in v) o[k] = v[k];
  return o;
};

function parseCarry(v: unknown): ExpeditionCarry | null | undefined {
  if (v === null) return null;
  if (!isObj(v)) return undefined;
  const rewards = arr(v.rewards, RUN_LIMITS.rewards);
  const traces = arr(v.goedamTraces, RUN_LIMITS.traces);
  const ult = arr(v.ult, 3);
  const seen = v.goedamSeen === undefined ? [] : arr(v.goedamSeen, RUN_LIMITS.seen);
  if (!rewards || !traces || !ult || !seen) return undefined;
  return {
    rewards: rewards.map(r => pick(r, ['rewardId', 'partyIndex'])) as unknown as ExpeditionCarry['rewards'],
    goedamTraces: traces.map(t => pick(t, ['id', 'floorsLeft'])) as unknown as ExpeditionCarry['goedamTraces'],
    ult: ult as number[],
    goedamSeen: seen as string[],
  };
}

/**
 * 기획 16차: the continuing run of an expQueue — shape and sizes only, rebuilt from known fields. Whether it is a run
 * that can exist (tiers, counts, ids) is the lobby's runJoinProblem ('bad_run'). undefined = malformed.
 */
export function parseExpRun(v: unknown): ExpRunInfo | null | undefined {
  if (v === undefined || v === null) return null;
  if (!isObj(v) || typeof v.id !== 'string' || !RUN_ID_RE.test(v.id)) return undefined;
  if (!isInt(v.startStage, 1, EXPEDITION_STAGES) || !isInt(v.cleared, 0, EXPEDITION_STAGES)) return undefined;
  const bag = arr(v.bag, RUN_LIMITS.bag);
  const boss = arr(v.bossClears, EXPEDITION_STAGES);
  const carry = parseCarry(v.carry);
  if (!bag || !boss || carry === undefined) return undefined;
  return {
    id: v.id,
    startStage: v.startStage,
    cleared: v.cleared,
    bag: bag.map(g => pick(g, ['slot', 'tier', 'rarity', 'optionId', 'relicId'])) as unknown as GearSpec[],
    carry,
    bossClears: boss as number[],
  };
}

/**
 * 기획 15차 원정 expQueue: stage, party (same rules as a preset), gear (any JSON shape; the expedition lobby checks it
 * with cleanPartyGear and answers 'bad_gear' instead of silently ignoring it), the boss stages already cleared once and
 * (기획 16차) the continuing run (parseExpRun; null = fresh).
 */
function parseExpQueue(v: Obj): ClientMsg | null {
  if (!isInt(v.stage, 1, EXPEDITION_STAGES)) return null;
  const preset = parsePreset({ characters: v.characters, pets: v.pets });
  if (!preset) return null;
  const fbc = v.firstBossClears === undefined ? [] : v.firstBossClears;
  if (!Array.isArray(fbc) || fbc.length > EXPEDITION_STAGES || !fbc.every(x => isInt(x, 1, EXPEDITION_STAGES))) return null;
  const run = parseExpRun(v.run);
  if (run === undefined) return null;
  const gear = Array.isArray(v.gear) ? (v.gear as GearLoadout[]) : ([] as GearLoadout[]);
  const msg: ClientMsg = { t: 'expQueue', stage: v.stage, ...preset, gear, firstBossClears: [...new Set(fbc as number[])], run };
  return v.debugUnlock === true ? { ...msg, debugUnlock: true } : msg;
}

/** Parse one raw text frame. */
export function parseClientMsg(raw: string): ClientMsg | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v) || typeof v.t !== 'string') return null;
  switch (v.t) {
    case 'hello': {
      if (!isNum(v.v)) return null;
      const name = v.name === undefined ? '' : str(v.name, 200);
      if (name == null) return null;
      if (v.token !== undefined && (typeof v.token !== 'string' || !/^[0-9a-f]{16,64}$/.test(v.token))) return { t: 'hello', v: v.v, name };
      return v.token !== undefined ? { t: 'hello', v: v.v, name, token: v.token as string } : { t: 'hello', v: v.v, name };
    }
    case 'setName': {
      const name = str(v.name, 200);
      return name == null ? null : { t: 'setName', name };
    }
    case 'listRooms':
      return { t: 'listRooms' };
    case 'createRoom': {
      const preset = parsePreset(v.preset);
      if (!preset) return null;
      const roomName = v.roomName === undefined ? undefined : str(v.roomName, 200);
      if (roomName === null) return null;
      return roomName === undefined ? { t: 'createRoom', preset } : { t: 'createRoom', preset, roomName };
    }
    case 'joinRoom': {
      const preset = parsePreset(v.preset);
      const code = str(v.code, 16);
      return preset && code != null ? { t: 'joinRoom', code, preset } : null;
    }
    case 'setPreset': {
      const preset = parsePreset(v.preset);
      return preset ? { t: 'setPreset', preset } : null;
    }
    case 'leaveRoom':
      return { t: 'leaveRoom' };
    case 'start':
      return { t: 'start' };
    case 'cmd': {
      if (!isInt(v.seq, 0, Number.MAX_SAFE_INTEGER)) return null;
      const cmd = parseCommand(v.cmd);
      if (!cmd) return null;
      // atTick is optional (older clients); a malformed one is dropped, not trusted
      return isInt(v.atTick, 0, Number.MAX_SAFE_INTEGER) ? { t: 'cmd', seq: v.seq, cmd, atTick: v.atTick } : { t: 'cmd', seq: v.seq, cmd };
    }
    case 'ping':
      return isNum(v.at) ? { t: 'ping', at: v.at } : null;
    case 'expQueue':
      return parseExpQueue(v);
    case 'expCancel':
      return { t: 'expCancel' };
    case 'expStartNow':
      return { t: 'expStartNow' };
    case 'expStatus':
      // 기획 16차: the result of a run's stage (optional `stage`: only a result of that stage answers)
      if (typeof v.runId !== 'string' || !RUN_ID_RE.test(v.runId)) return null;
      if (v.stage === undefined) return { t: 'expStatus', runId: v.runId };
      return isInt(v.stage, 1, EXPEDITION_STAGES) ? { t: 'expStatus', runId: v.runId, stage: v.stage } : null;
  }
  return null;
}
