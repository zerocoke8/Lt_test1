// Server-side message parsing, names, codes and snapshot cleaning (server/validate.ts, util.ts, snapshot.ts).
import { describe, expect, it } from 'vitest';
import { cleanState, round2, wireJson } from '../../server/snapshot';
import { normalizeRoomCode, randomRoomCode, sanitizeName } from '../../server/util';
import { parseClientMsg, parseCommand, parsePreset } from '../../server/validate';
import { PROTOCOL_VERSION, ROOM_CODE_ALPHABET } from '../../src/net/protocol';
import { makeGame } from '../sim/helpers';
import { PRESET_A } from './helpers';

describe('parseClientMsg', () => {
  it('accepts well-formed messages and rebuilds them', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'a', token: 'ab'.repeat(16), extra: 1 }))).toEqual({
      t: 'hello',
      v: PROTOCOL_VERSION,
      name: 'a',
      token: 'ab'.repeat(16),
    });
    // a malformed token is ignored (fresh session), not an error
    expect(parseClientMsg(JSON.stringify({ t: 'hello', v: 1, name: 'a', token: '../../x' }))).toEqual({ t: 'hello', v: 1, name: 'a' });
    expect(parseClientMsg(JSON.stringify({ t: 'createRoom', preset: PRESET_A, roomName: '우리 방' }))).toEqual({ t: 'createRoom', preset: PRESET_A, roomName: '우리 방' });
    expect(parseClientMsg(JSON.stringify({ t: 'cmd', seq: 3, cmd: { type: 'swap', player: 2, partyIndex: 1, pos: { x: 1, y: 2 }, hack: true } }))).toEqual({
      t: 'cmd',
      seq: 3,
      cmd: { type: 'swap', player: 0, partyIndex: 1, pos: { x: 1, y: 2 } },
    });
    expect(parseClientMsg('{"t":"ping","at":5}')).toEqual({ t: 'ping', at: 5 });
  });

  it('rejects junk', () => {
    for (const raw of [
      'x',
      'null',
      '[]',
      '{"t":5}',
      '{"t":"hello"}',
      '{"t":"cmd","seq":1.5,"cmd":{"type":"ult"}}',
      '{"t":"cmd","seq":1,"cmd":{"type":"swap","partyIndex":1,"pos":{"x":"1","y":2}}}',
      '{"t":"cmd","seq":1,"cmd":{"type":"swap","partyIndex":1,"pos":{"x":1e9,"y":2}}}',
      '{"t":"cmd","seq":1,"cmd":{"type":"debug","action":{"kind":"jumpFloor","floor":-3}}}',
      '{"t":"cmd","seq":1,"cmd":{"type":"tunables","patch":[1]}}',
      '{"t":"joinRoom","code":"ABCD","preset":{"characters":["blade","blade"],"pets":["frog_bomb","frog_bomb","frog_bomb"]}}',
      '{"t":"setName","name":' + JSON.stringify('x'.repeat(500)) + '}',
      '{"t":"ping"}',
    ]) {
      expect(parseClientMsg(raw), raw).toBeNull();
    }
  });

  it('commands and presets', () => {
    expect(parseCommand({ type: 'debug', action: { kind: 'chargeUlt', player: 2 } })).toEqual({ type: 'debug', action: { kind: 'chargeUlt' } });
    expect(parseCommand({ type: 'tunables', patch: { gameSpeed: 2, nope: 'x', invincible: true } })).toEqual({ type: 'tunables', patch: { gameSpeed: 2, invincible: true } });
    expect(parseCommand({ type: 'quit', player: 1 })).toEqual({ type: 'quit' });
    expect(parseCommand({ type: 'teleport' })).toBeNull();
    // 기획 10차: 괴담 option ids (player is a placeholder the room overwrites); bounded, snake_case only
    expect(parseCommand({ type: 'goedam', player: 2, option: 'leave', x: 1 })).toEqual({ type: 'goedam', player: 0, option: 'leave' });
    expect(parseCommand({ type: 'goedam', option: 'continue' })).toEqual({ type: 'goedam', player: 0, option: 'continue' });
    for (const option of [undefined, 3, '', 'x'.repeat(33), 'Leave', 'le ave', '__proto__!', ['leave']]) {
      expect(parseCommand({ type: 'goedam', option }), String(option)).toBeNull();
    }
    expect(parseCommand({ type: 'debug', action: { kind: 'goedamNext' } })).toEqual({ type: 'debug', action: { kind: 'goedamNext' } });
    expect(parseCommand({ type: 'debug', action: { kind: 'goedamNext', room: 'copier' } })).toEqual({ type: 'debug', action: { kind: 'goedamNext', room: 'copier' } });
    expect(parseCommand({ type: 'debug', action: { kind: 'goedamNext', room: '<script>' } })).toBeNull();
    expect(parseCommand({ type: 'debug', action: { kind: 'goedamNext', room: null } })).toBeNull();
    expect(parsePreset({ characters: ['blade', 'mage', 'nobody'], pets: PRESET_A.pets })).toBeNull();
    // the same character twice across players is allowed; within a preset the client prevents it
    expect(parsePreset(PRESET_A)).toEqual(PRESET_A);
  });
});

describe('names and codes', () => {
  it('sanitizeName: 1–12 code points, no control chars, collapsed spaces', () => {
    expect(sanitizeName('  가   나 ')).toBe('가 나');
    expect(sanitizeName('a\u0007b‍c')).toBe('abc');
    expect(sanitizeName('<b>굵게</b>')).toBe('b굵게/b');
    expect(sanitizeName('😀'.repeat(20))).toBe('😀'.repeat(12));
    expect(sanitizeName(42)).toBe('');
    expect(sanitizeName('   ')).toBe('');
  });

  it('room codes: alphabet only, unique', () => {
    expect(normalizeRoomCode(' ab-c d ')).toBe('ABCD');
    expect(normalizeRoomCode('o0i1')).toBe(''); // excluded look-alikes
    const taken = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = randomRoomCode(x => taken.has(x));
      expect(c).toHaveLength(4);
      for (const ch of c) expect(ROOM_CODE_ALPHABET).toContain(ch);
      expect(taken.has(c)).toBe(false);
      taken.add(c);
    }
  });
});

describe('snapshot cleaning', () => {
  it('drops sim-internal fields, rounds floats, keeps the contract shape', () => {
    const tg = makeGame();
    for (let i = 0; i < 40; i++) tg.game.step(1 / 30);
    const s = cleanState(tg.game.state);
    const raw = JSON.stringify(s);
    expect(raw).not.toContain('"rt"');
    expect(raw).not.toMatch(/\d\.\d{3,}/);
    expect(Object.keys(s).sort()).toEqual(Object.keys(tg.game.state).sort());
    expect(s.players[0].party[0].defId).toBe(tg.game.state.players[0].party[0].defId);
    expect(s.entities.length).toBe(tg.game.state.entities.length);
    expect(round2(1.005)).toBeCloseTo(1, 2);
    expect(round2(-0.001)).toBe(0);
    expect(round2(Number.NaN)).toBe(0);
    expect(wireJson({ a: 1 / 3, rt: { x: 1 }, src: 'basic', b: [0.123456] })).toBe('{"a":0.33,"b":[0.12]}');
  });
});
