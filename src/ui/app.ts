// App shell: stage + screens (프리셋 → 매칭/방 → 전투(+보상) → 결과) + rAF loop.
// Solo: the local sim (createGame). Multiplayer: RemoteGame (server snapshots, src/net) behind the same Game interface,
// so the renderer, HUD, drag and overlays are shared; the only difference is localPlayer (solo 0, multi = server slot).
// Loop: dt = min(0.1, …); if running: game.step(dt); events = game.drainEvents(); renderer.render(…); hud.update(…).

import './styles.css';
import type { Command, CommandResult, DragPreview, Game, GameSetup, GameState, RenderUiState, Tunables, Vec2 } from '../types';
import { BOT_PRESETS, DEFAULT_TUNABLES } from '../config';
import { createGame } from '../sim';
import { createRenderer } from '../render';
import { TickSmoother } from '../render/smooth';
import { isSoloOnlyBuild, type NetStatus } from '../net/connection';
import { LobbyClient, type StartMsg } from '../net/lobbyClient';
import { RemoteGame } from '../net/remoteGame';
import { DebugPanel } from './debug';
import { h } from './dom';
import { DragController, LIFT, type DragKind } from './drag';
import { Hud, type HudCallbacks } from './hud';
import { LobbyScreen, OFFLINE_TEXT, SOLO_BUILD_TEXT } from './lobby';
import { PauseMenu } from './pause';
import { createPresetScreen } from './preset';
import { createResultScreen } from './result';
import { offersFor, RewardOverlay } from './reward';
import { Stage } from './stage';
import {
  loadNickname,
  loadPreset,
  loadTunableOverrides,
  saveNickname,
  savePreset,
  saveTunableOverrides,
  type PresetSave,
} from './storage';

export type AppPhase = 'preset' | 'lobby' | 'room' | 'starting' | 'combat' | 'reward' | 'spectate' | 'result';
export type RunMode = 'solo' | 'multi';

/** startRun overrides: any GameSetup field; tunables may be partial (merged over defaults + saved debug tuning). */
export type RunOverrides = Partial<Omit<GameSetup, 'tunables'>> & { tunables?: Partial<Tunables> };

export interface NetInfo {
  readonly status: NetStatus;
  readonly roomCode: string | null;
  readonly isHost: boolean;
  readonly sessionId: string | null;
  readonly roomCount: number;
}

export interface ProtoApi {
  readonly game: Game | null;
  readonly phase: AppPhase;
  readonly paused: boolean;
  readonly mode: RunMode;
  /** This client's PlayerState index (solo 0, multi = server slot). */
  readonly localPlayer: number;
  readonly net: NetInfo;
  startRun(setup?: RunOverrides): void;
  setPaused(on: boolean): void;
  ui: {
    /** Test helper: drop card `index` at a world point (same path as a real drop, minus the pointer gesture). */
    dragTo(kind: DragKind, index: number, world: Vec2): CommandResult;
    /** Test helper: client px of a finger whose drop point (LIFT px above it) lands on `world` (camera of the last frame). */
    fingerFor(world: Vec2): Vec2;
    /** Test hook: this client's drag preview while a card is held (null otherwise). Previews are local only. */
    readonly dragPreview: DragPreview | null;
    /** Test hook: the state the renderer drew last frame (solo: positions blended between sim ticks). */
    readonly drawState: GameState | null;
  };
}

declare global {
  interface Window {
    __proto?: ProtoApi;
  }
}

/** Delay between the run ending and the result screen (lets the banner/death play). */
const RESULT_DELAY_MS = 1800;
/** Preset 출발 while the server check is still running: wait at most this long before deciding. */
const PROBE_WAIT_MS = 1500;

export function startApp(root: HTMLElement): void {
  root.replaceChildren();
  const stage = new Stage(root);
  const renderer = createRenderer(stage.canvas);
  /** Solo: positions blended between sim ticks (30 Hz sim, 60 Hz screen). Multiplayer interpolates in RemoteGame. */
  const smoother = new TickSmoother();

  let game: Game | null = null;
  let hud: Hud | null = null;
  let screen: 'preset' | 'lobby' | 'combat' | 'result' = 'preset';
  let mode: RunMode = 'solo';
  let localPlayer = 0;
  /** Multiplayer game on screen (=== game in multi). */
  let remote: RemoteGame | null = null;
  /** Server said start (or we reconnected): waiting for its first snapshot. */
  let pendingRemote: RemoteGame | null = null;
  /** Solo pause. Multiplayer never pauses (R35); its menu is `menuOpen`. */
  let paused = false;
  let menuOpen = false;
  let quitWhileOut = false;
  /** Host pressed 나가기: show the result as soon as the runOver snapshot arrives. */
  let quitRequested = false;
  let resultAt: number | null = null;
  let lobbyStarting = false;
  let lobbyStartTimer: ReturnType<typeof setTimeout> | null = null;
  let nickname = loadNickname();
  const uiState: RenderUiState = { localPlayer: 0, dragPreview: null, freezeCamera: false };

  // ─────────────────────────── network ───────────────────────────

  const lobby = new LobbyClient(() => nickname, {
    onChange: () => {
      refreshNetNote();
      if (lobbyScreen.visible) refreshLobby();
    },
    onStart: msg => beginMulti(msg),
    onError: err => {
      setStarting(false);
      if (lobbyScreen.visible) lobbyScreen.toast(err.message, 'warn');
      else hud?.toast(err.message, 'warn');
    },
    onLeftRoom: () => {
      if (mode === 'multi' && screen === 'combat') {
        teardownMulti();
        showLobby();
        lobbyScreen.toast('방에서 나왔어요', 'info');
      } else if (lobbyScreen.visible) refreshLobby();
    },
    // R34: the same session was opened in another tab (it has the seat now); this one stops until "여기서 계속"
    onReplaced: () => {
      if (mode === 'multi' || pendingRemote) {
        teardownMulti();
        showLobby();
        lobbyScreen.toast('다른 탭에서 접속해서 이 탭은 멈췄어요', 'warn');
      } else if (lobbyScreen.visible) refreshLobby();
    },
  });

  // ─────────────────────────── screens ───────────────────────────

  const drag = new DragController({ stage, game: () => game, renderer: () => renderer, hud: () => hud, localPlayer: () => localPlayer });
  const reward = new RewardOverlay(stage.screenLayer, i => {
    const r = game?.dispatch({ type: 'chooseReward', player: localPlayer, offerIndex: i });
    if (r && !r.ok) hud?.toast(r.reason ?? '선택할 수 없어요', 'warn');
  });
  const debug = new DebugPanel(stage.screenLayer, {
    game: () => game,
    // multiplayer tuning belongs to the room (sent to the server), not to this device's solo overrides
    onTunablesChanged: t => {
      if (mode === 'solo') saveTunableOverrides(t);
    },
    toast: (text, kind) => hud?.toast(text, kind),
  });
  const pause = new PauseMenu(stage.screenLayer, {
    onResume: () => closeMenu(),
    onDebug: () => {
      closeMenu();
      if (canDebug()) debug.open();
    },
    onQuit: () => {
      closeMenu();
      if (mode === 'multi') leaveMulti();
      else quit(false);
    },
  });
  const result = createResultScreen(stage.screenLayer, {
    onRetry: () => startRun(),
    onPreset: () => toPreset(),
    onRoom: () => {
      teardownMulti();
      showLobby();
    },
    onLeaveRoom: () => {
      lobby.leaveRoom();
      teardownMulti();
      showLobby();
    },
  });
  const preset = createPresetScreen(stage.screenLayer, {
    initial: loadPreset(),
    onStart: p => {
      savePreset(p);
      if (lobby.room) {
        // 프리셋 변경 from the room: back to the room with the new picks
        lobby.setPreset(p);
        showLobby();
        return;
      }
      void goMatching();
    },
  });
  const soloBuild = isSoloOnlyBuild();
  const netNote = h('div', `ps-net-note is-hidden${soloBuild ? ' is-solo' : ''}`, preset.el, soloBuild ? SOLO_BUILD_TEXT : OFFLINE_TEXT);
  const lobbyScreen = new LobbyScreen(stage.screenLayer, {
    onSolo: () => startRun(),
    onPreset: () => toPreset(),
    onCreate: () => {
      lobby.createRoom(currentPreset());
    },
    onJoin: code => {
      lobby.joinRoom(code, currentPreset());
    },
    onLeave: () => {
      lobby.leaveRoom();
      refreshLobby();
    },
    onStart: () => {
      setStarting(true);
      if (!lobby.startGame()) {
        setStarting(false);
        lobbyScreen.toast('서버와 연결이 끊겼어요', 'warn');
      }
    },
    onNameChange: name => {
      nickname = name;
      saveNickname(name);
      if (name) lobby.setName(name);
      refreshLobby();
    },
    onRetry: () => lobby.retry(),
    onRefresh: () => lobby.listRooms(),
  });

  const hudCallbacks: HudCallbacks = {
    onCardDown: (kind, index, ev, el) => drag.begin(kind, index, ev, el),
    onUlt: () => useUlt(),
    onPause: () => openMenu(),
    onDebug: () => {
      if (canDebug()) debug.toggle();
    },
    onShowResult: () => {
      if (mode === 'multi') leaveMulti();
      else quit(true);
    },
  };

  function refreshDebugNote(): void {
    const n = Object.keys(loadTunableOverrides()).length;
    preset.setDebugNote(n > 0 ? `디버그 튜닝 ${n}개 적용 중` : '');
  }

  function refreshNetNote(): void {
    netNote.classList.toggle('is-hidden', lobby.status !== 'offline');
  }

  function currentPreset(): PresetSave {
    const v = preset.value();
    return v.characters.length === 3 && v.pets.length === 3 ? v : loadPreset();
  }

  function refreshLobby(): void {
    lobbyScreen.update({
      status: lobby.status,
      latencyMs: lobby.conn.latencyMs,
      name: nickname || lobby.conn.name,
      rooms: lobby.rooms,
      room: lobby.room,
      myId: lobby.sessionId,
      preset: currentPreset(),
      starting: lobbyStarting || !!pendingRemote,
    });
  }

  function setStarting(on: boolean): void {
    lobbyStarting = on;
    if (lobbyStartTimer) clearTimeout(lobbyStartTimer);
    lobbyStartTimer = on ? setTimeout(() => setStarting(false), 8000) : null;
    if (lobbyScreen.visible) refreshLobby();
  }

  function canDebug(): boolean {
    return mode === 'solo' || !!remote?.isHost;
  }

  /**
   * Preset 출발: the 매칭 screen when a game server is (or may be) there; straight into solo only when this host has no
   * game server at all (static host / solo build). An unreachable server (sleeping free plan) opens the 매칭 screen,
   * which probes again and offers 혼자 하기 meanwhile.
   */
  async function goMatching(): Promise<void> {
    if (lobby.status === 'idle' || lobby.status === 'probing') {
      await new Promise<void>(resolve => {
        const t = setTimeout(done, PROBE_WAIT_MS);
        const off = lobby.conn.onStatus(s => {
          if (s !== 'idle' && s !== 'probing') done();
        });
        function done() {
          clearTimeout(t);
          off();
          resolve();
        }
      });
    }
    if (screen !== 'preset') return;
    if (lobby.status === 'offline' && lobby.conn.offlineReason !== 'unreachable') startRun();
    else showLobby();
  }

  function showLobby(): void {
    drag.cancel();
    screen = 'lobby';
    preset.setVisible(false);
    result.hide();
    pause.hide();
    debug.close();
    lobbyScreen.setVisible(true);
    if (!game) stage.canvas.classList.add('is-hidden');
    refreshLobby();
    if (lobby.status === 'offline') lobby.retry();
    else if (lobby.online && !lobby.room) lobby.listRooms();
  }

  function hideLobby(): void {
    lobbyScreen.setVisible(false);
    setStarting(false);
  }

  // ─────────────────────────── solo ───────────────────────────

  function setPaused(on: boolean): void {
    if (mode === 'multi') {
      if (on) openMenu();
      else closeMenu();
      return;
    }
    if (on && (!game || screen !== 'combat')) return;
    paused = on;
    if (on) {
      drag.cancel();
      pause.show(game?.state ?? null, { multi: false, isHost: true });
    } else pause.hide();
  }

  function openMenu(): void {
    if (!game || screen !== 'combat') return;
    if (mode === 'solo') {
      setPaused(true);
      return;
    }
    menuOpen = true;
    drag.cancel();
    pause.show(game.state, { multi: true, isHost: !!remote?.isHost });
  }

  function closeMenu(): void {
    if (mode === 'solo') {
      setPaused(false);
      return;
    }
    menuOpen = false;
    pause.hide();
  }

  function newHud(g: Game): Hud {
    hud?.destroy();
    const hd = new Hud(stage.hudLayer, g, hudCallbacks, { localPlayer, multi: mode === 'multi' });
    hd.setDebugAllowed(canDebug());
    hd.setSpectateAction(mode === 'solo' ? '결과 보기' : remote?.isHost ? null : '나가기');
    return hd;
  }

  function startRun(setup: RunOverrides = {}): void {
    if (mode === 'multi' || pendingRemote) teardownMulti();
    const p = currentPreset();
    const base: GameSetup = {
      seed: Date.now() >>> 0,
      players: [
        { name: '나', isBot: false, characters: [...p.characters], pets: [...p.pets] },
        ...BOT_PRESETS.slice(0, 2).map(b => ({ name: b.name, isBot: true, characters: [...b.characters], pets: [...b.pets] })),
      ],
      tunables: { ...DEFAULT_TUNABLES, ...loadTunableOverrides() },
    };
    const full: GameSetup = { ...base, ...setup, tunables: { ...base.tunables, ...(setup.tunables ?? {}) } };
    drag.cancel();
    hud?.destroy();
    hud = null;
    mode = 'solo';
    localPlayer = 0;
    uiState.localPlayer = 0;
    game = createGame(full);
    smoother.reset();
    hud = newHud(game);
    screen = 'combat';
    paused = false;
    menuOpen = false;
    quitWhileOut = false;
    quitRequested = false;
    resultAt = null;
    pause.hide();
    result.hide();
    preset.setVisible(false);
    hideLobby();
    stage.canvas.classList.remove('is-hidden');
    if (debug.isOpen) debug.sync();
  }

  function useUlt(): void {
    // multiplayer menu open (R35: no pause, but the HUD is covered): no ult from the keyboard either
    if (!game || screen !== 'combat' || paused || menuOpen) return;
    const r = game.dispatch({ type: 'ult', player: localPlayer });
    if (r.ok) return;
    const me = game.state.players[localPlayer];
    const text =
      r.reason === '게이지 부족'
        ? `궁극기 충전 중 · ${Math.floor((me?.ult.charge ?? 0) * 100)}%`
        : r.reason === '필드에 캐릭터 없음'
          ? '필드에 캐릭터가 없어요 · 카드를 먼저 끌어 놓으세요'
          : r.reason === '관전 중'
            ? '사망 — 관전 중이에요'
            : r.reason === '서버와 연결이 끊겼어요' || r.reason === '연결이 불안정해요'
              ? r.reason
              : '지금은 쓸 수 없어요';
    hud?.toast(text, 'warn');
  }

  /** 포기 / 관전 중 결과 보기 (solo): end the run now and show the result without the delay. */
  function quit(fromSpectate: boolean): void {
    if (!game || screen !== 'combat') return;
    quitWhileOut = fromSpectate || !!game.state.players[localPlayer]?.out;
    if (game.state.phase !== 'runOver') game.dispatch({ type: 'quit' });
    resultAt = performance.now();
  }

  // ─────────────────────────── multiplayer ───────────────────────────

  function beginMulti(msg: StartMsg): void {
    pendingRemote?.dispose();
    pendingRemote = new RemoteGame(lobby.conn, msg, { onRejected: (cmd, reason) => onRejected(cmd, reason) });
    if (lobbyScreen.visible) refreshLobby();
  }

  function enterMulti(rg: RemoteGame): void {
    pendingRemote = null;
    drag.cancel();
    if (remote && remote !== rg) remote.dispose();
    remote = rg;
    game = rg;
    mode = 'multi';
    localPlayer = rg.localPlayer;
    uiState.localPlayer = localPlayer;
    hud = newHud(rg);
    screen = 'combat';
    paused = false;
    menuOpen = false;
    quitWhileOut = false;
    quitRequested = false;
    resultAt = null;
    pause.hide();
    result.hide();
    debug.close();
    preset.setVisible(false);
    hideLobby();
    stage.canvas.classList.remove('is-hidden');
  }

  function teardownMulti(): void {
    drag.cancel();
    pendingRemote?.dispose();
    pendingRemote = null;
    if (mode === 'multi') {
      hud?.destroy();
      hud = null;
      game = null;
    }
    remote?.dispose();
    remote = null;
    mode = 'solo';
    localPlayer = 0;
    uiState.localPlayer = 0;
    menuOpen = false;
    paused = false;
    quitRequested = false;
    resultAt = null;
    pause.hide();
    debug.close();
    result.hide();
  }

  /** 나가기: a member leaves (their slot → bot); the host ends the run for everyone (R35). */
  function leaveMulti(): void {
    const rg = remote;
    if (!rg) return;
    if (rg.isHost && rg.state.phase !== 'runOver') {
      const r = rg.dispatch({ type: 'quit' });
      if (r.ok) {
        quitRequested = true;
        quitWhileOut = !!rg.state.players[localPlayer]?.out;
        return;
      }
    } else if (!rg.isHost && rg.dispatch({ type: 'quit' }).ok) lobby.markLeft();
    else lobby.leaveRoom();
    teardownMulti();
    showLobby();
  }

  function onRejected(cmd: Command, reason: string): void {
    if (!hud) return;
    if (cmd.type === 'swap') hud.refuse('swap', cmd.partyIndex, { ok: false, reason });
    else if (cmd.type === 'pet') hud.refuse('pet', cmd.petIndex, { ok: false, reason });
    else if (cmd.type !== 'quit') hud.toast(`서버가 거절했어요 · ${reason}`, 'warn');
  }

  // ─────────────────────────── shared ───────────────────────────

  function showResult(): void {
    if (!game) return;
    screen = 'result';
    resultAt = null;
    quitRequested = false;
    drag.cancel();
    debug.close();
    pause.hide();
    menuOpen = false;
    // HUD toasts/banners stack above the screen layer: hide them under the result screen
    hud?.setCovered(true);
    reward.update(game.state, { localPlayer, multi: mode === 'multi', deadline: null });
    result.show(game, quitWhileOut, { localPlayer, multi: mode === 'multi', isHost: !!remote?.isHost });
  }

  function toPreset(): void {
    if (mode === 'multi' || pendingRemote) teardownMulti();
    drag.cancel();
    hud?.destroy();
    hud = null;
    game = null;
    screen = 'preset';
    paused = false;
    result.hide();
    pause.hide();
    debug.close();
    hideLobby();
    refreshDebugNote();
    refreshNetNote();
    preset.setVisible(true);
  }

  function appPhase(): AppPhase {
    if (screen === 'lobby') return pendingRemote || lobbyStarting ? 'starting' : lobby.room ? 'room' : 'lobby';
    if (screen !== 'combat' || !game) return screen === 'combat' ? 'preset' : screen;
    const s = game.state;
    const me = s.players[localPlayer];
    if (s.phase === 'reward' && me && !me.out && (mode === 'multi' || offersFor(s, localPlayer))) return 'reward';
    if (me?.out) return 'spectate';
    return 'combat';
  }

  // ── input niceties ──
  root.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('keydown', e => {
    if (screen !== 'combat') return;
    if (e.code === 'Space') {
      e.preventDefault();
      useUlt();
    } else if (e.code === 'Escape') {
      if (mode === 'multi') {
        if (menuOpen) closeMenu();
        else openMenu();
      } else setPaused(!paused);
    } else if (e.code === 'Backquote' && canDebug()) debug.toggle();
  });
  document.addEventListener('visibilitychange', () => {
    if (mode === 'solo' && document.hidden && screen === 'combat' && game?.state.phase === 'combat' && !paused) setPaused(true);
  });

  // ── loop ──
  let last = performance.now();
  let lastLobbyRefresh = 0;
  let lastDrawState: GameState | null = null;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (pendingRemote?.ready) enterMulti(pendingRemote);
    if (lobbyScreen.visible && now - lastLobbyRefresh > 1000) {
      lastLobbyRefresh = now;
      refreshLobby(); // latency pill
    }
    if (!game || screen !== 'combat') return;
    // multiplayer: the game ended while we were away (abandoned / reconnected after the end) → back to the room
    if (mode === 'multi' && remote && game.state.phase !== 'runOver' && (remote.ended || lobby.room?.status === 'waiting') && !pendingRemote) {
      teardownMulti();
      showLobby();
      lobbyScreen.toast('게임이 끝났어요', 'info');
      return;
    }
    const running = !stage.portrait && (mode === 'multi' || !paused);
    if (running) game.step(dt);
    const events = game.drainEvents();
    drag.frame();
    uiState.dragPreview = drag.dragPreview;
    uiState.freezeCamera = drag.active;
    const drawState = mode === 'solo' ? smoother.view(game.state, now, game.tunables.gameSpeed) : game.state;
    lastDrawState = drawState;
    renderer.render(drawState, events, running ? dt : 0, uiState);
    hud?.update(game.state, events);
    if (mode === 'multi' && remote && hud) {
      hud.setNetStatus(
        !remote.connected ? '서버와 연결이 끊겼어요 · 다시 연결하는 중…' : remote.stalled ? '연결이 불안정해요 · 다시 연결하는 중…' : null,
      );
      hud.setDebugAllowed(remote.isHost);
      hud.setSpectateAction(remote.isHost ? null : '나가기');
      if (!remote.isHost && debug.isOpen) debug.close();
    }
    reward.update(game.state, { localPlayer, multi: mode === 'multi', deadline: remote?.rewardDeadline ?? null });
    hud?.setCovered(reward.visible || paused || menuOpen);
    if (game.state.phase === 'runOver' && resultAt == null) resultAt = now + (quitRequested ? 0 : RESULT_DELAY_MS);
    if (resultAt != null && now >= resultAt) showResult();
  };
  requestAnimationFrame(frame);

  refreshDebugNote();
  preset.setVisible(true);
  lobby.start();

  window.__proto = {
    get game() {
      return game;
    },
    get phase() {
      return appPhase();
    },
    get paused() {
      return paused;
    },
    get mode() {
      return mode;
    },
    get localPlayer() {
      return localPlayer;
    },
    net: {
      get status() {
        return lobby.status;
      },
      get roomCode() {
        return lobby.room?.code ?? null;
      },
      get isHost() {
        return lobby.isHost;
      },
      get sessionId() {
        return lobby.sessionId;
      },
      get roomCount() {
        return lobby.rooms.length;
      },
    },
    startRun,
    setPaused,
    ui: {
      dragTo(kind, index, world) {
        if (!game) return { ok: false, reason: '전투 중이 아님' };
        const pos = game.clampToArena(world);
        const r =
          kind === 'swap'
            ? game.dispatch({ type: 'swap', player: localPlayer, partyIndex: index, pos })
            : game.dispatch({ type: 'pet', player: localPlayer, petIndex: index, pos });
        if (!r.ok) hud?.refuse(kind, index, r);
        return r;
      },
      fingerFor(world) {
        const l = renderer.worldToScreen(world);
        return stage.toClient({ x: l.x, y: l.y + LIFT });
      },
      get dragPreview() {
        return drag.dragPreview;
      },
      get drawState() {
        return game && screen === 'combat' ? lastDrawState : null;
      },
    },
  };
}
