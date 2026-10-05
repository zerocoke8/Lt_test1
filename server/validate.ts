// Strict parsing of client messages (src/net/protocol.ts). Anything malformed → null (ignored by the server).
// Returned objects are rebuilt from scratch: no extra fields, no prototype tricks reach the sim.

import type { ClientMsg, PresetChoice } from '../src/net/protocol';
import { GOEDAM_OPTION_RE } from '../src/net/protocol';
import type { Command, DebugAction, Vec2 } from '../src/types';
import { CHARACTERS, PETS } from '../src/data';

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
      return { kind: v.kind };
    case 'jumpFloor':
      return isInt(v.floor, 1, 1000) ? { kind: 'jumpFloor', floor: v.floor } : null;
    case 'goedamNext':
      if (v.room === undefined) return { kind: 'goedamNext' };
      return goedamId(v.room) ? { kind: 'goedamNext', room: v.room } : null;
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
  }
  return null;
}
