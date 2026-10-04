// App shell: stage + screens (프리셋 → 전투(+보상) → 결과) + rAF loop.
// Loop: dt = min(0.1, …); if running: game.step(dt); events = game.drainEvents(); renderer.render(…); hud.update(…).

import './styles.css';
import type { CommandResult, Game, GameSetup, RenderUiState, Tunables, Vec2 } from '../types';
import { BOT_PRESETS, DEFAULT_TUNABLES } from '../config';
import { createGame } from '../sim';
import { createRenderer } from '../render';
import { DebugPanel } from './debug';
import { DragController, LIFT, type DragKind } from './drag';
import { Hud, LOCAL_PLAYER } from './hud';
import { PauseMenu } from './pause';
import { createPresetScreen } from './preset';
import { createResultScreen } from './result';
import { RewardOverlay } from './reward';
import { Stage } from './stage';
import { loadPreset, loadTunableOverrides, saveTunableOverrides, savePreset, type PresetSave } from './storage';

export type AppPhase = 'preset' | 'combat' | 'reward' | 'spectate' | 'result';

/** startRun overrides: any GameSetup field; tunables may be partial (merged over defaults + saved debug tuning). */
export type RunOverrides = Partial<Omit<GameSetup, 'tunables'>> & { tunables?: Partial<Tunables> };

export interface ProtoApi {
  readonly game: Game | null;
  readonly phase: AppPhase;
  readonly paused: boolean;
  startRun(setup?: RunOverrides): void;
  setPaused(on: boolean): void;
  ui: {
    /** Test helper: drop card `index` at a world point (same path as a real drop, minus the pointer gesture). */
    dragTo(kind: DragKind, index: number, world: Vec2): CommandResult;
    /** Test helper: client px of a finger whose drop point (LIFT px above it) lands on `world` (camera of the last frame). */
    fingerFor(world: Vec2): Vec2;
  };
}

declare global {
  interface Window {
    __proto?: ProtoApi;
  }
}

/** Delay between the run ending and the result screen (lets the banner/death play). */
const RESULT_DELAY_MS = 1800;

export function startApp(root: HTMLElement): void {
  root.replaceChildren();
  const stage = new Stage(root);
  const renderer = createRenderer(stage.canvas);

  let game: Game | null = null;
  let hud: Hud | null = null;
  let screen: 'preset' | 'combat' | 'result' = 'preset';
  let paused = false;
  let quitWhileOut = false;
  let resultAt: number | null = null;
  const uiState: RenderUiState = { localPlayer: LOCAL_PLAYER, dragPreview: null, freezeCamera: false };

  const drag = new DragController({ stage, game: () => game, renderer: () => renderer, hud: () => hud });
  const reward = new RewardOverlay(stage.screenLayer, i => {
    const r = game?.dispatch({ type: 'chooseReward', player: LOCAL_PLAYER, offerIndex: i });
    if (r && !r.ok) hud?.toast(r.reason ?? '선택할 수 없어요', 'warn');
  });
  const debug = new DebugPanel(stage.screenLayer, {
    game: () => game,
    onTunablesChanged: t => saveTunableOverrides(t),
    toast: (text, kind) => hud?.toast(text, kind),
  });
  const pause = new PauseMenu(stage.screenLayer, {
    onResume: () => setPaused(false),
    onDebug: () => {
      setPaused(false);
      debug.open();
    },
    onQuit: () => {
      setPaused(false);
      quit(false);
    },
  });
  const result = createResultScreen(stage.screenLayer, {
    onRetry: () => startRun(),
    onPreset: () => toPreset(),
  });
  const preset = createPresetScreen(stage.screenLayer, {
    initial: loadPreset(),
    onStart: p => {
      savePreset(p);
      startRun();
    },
  });

  function refreshDebugNote(): void {
    const n = Object.keys(loadTunableOverrides()).length;
    preset.setDebugNote(n > 0 ? `디버그 튜닝 ${n}개 적용 중` : '');
  }

  function currentPreset(): PresetSave {
    const v = preset.value();
    return v.characters.length === 3 && v.pets.length === 3 ? v : loadPreset();
  }

  function setPaused(on: boolean): void {
    if (on && (!game || screen !== 'combat')) return;
    paused = on;
    if (on) {
      drag.cancel();
      pause.show(game?.state ?? null);
    } else pause.hide();
  }

  function startRun(setup: RunOverrides = {}): void {
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
    game = createGame(full);
    hud = new Hud(stage.hudLayer, game, {
      onCardDown: (kind, index, ev, el) => drag.begin(kind, index, ev, el),
      onUlt: () => useUlt(),
      onPause: () => setPaused(true),
      onDebug: () => debug.toggle(),
      onShowResult: () => quit(true),
    });
    screen = 'combat';
    paused = false;
    quitWhileOut = false;
    resultAt = null;
    pause.hide();
    result.hide();
    preset.setVisible(false);
    stage.canvas.classList.remove('is-hidden');
    if (debug.isOpen) debug.sync();
  }

  function useUlt(): void {
    if (!game || screen !== 'combat' || paused) return;
    const r = game.dispatch({ type: 'ult', player: LOCAL_PLAYER });
    if (r.ok) return;
    const me = game.state.players[LOCAL_PLAYER];
    const text =
      r.reason === '게이지 부족'
        ? `궁극기 충전 중 · ${Math.floor(me.ult.charge * 100)}%`
        : r.reason === '필드에 캐릭터 없음'
          ? '필드에 캐릭터가 없어요 · 카드를 먼저 끌어 놓으세요'
          : r.reason === '관전 중'
            ? '사망 — 관전 중이에요'
            : '지금은 쓸 수 없어요';
    hud?.toast(text, 'warn');
  }

  /** 포기 / 관전 중 결과 보기: end the run now and show the result without the delay. */
  function quit(fromSpectate: boolean): void {
    if (!game || screen !== 'combat') return;
    quitWhileOut = fromSpectate || game.state.players[LOCAL_PLAYER].out;
    if (game.state.phase !== 'runOver') game.dispatch({ type: 'quit' });
    resultAt = performance.now();
  }

  function showResult(): void {
    if (!game) return;
    screen = 'result';
    resultAt = null;
    drag.cancel();
    debug.close();
    pause.hide();
    reward.update(game.state);
    result.show(game, quitWhileOut);
  }

  function toPreset(): void {
    drag.cancel();
    hud?.destroy();
    hud = null;
    game = null;
    screen = 'preset';
    paused = false;
    result.hide();
    pause.hide();
    debug.close();
    refreshDebugNote();
    preset.setVisible(true);
  }

  function appPhase(): AppPhase {
    if (screen !== 'combat' || !game) return screen === 'combat' ? 'preset' : screen;
    if (game.state.phase === 'reward' && game.state.rewardOffers) return 'reward';
    if (game.state.players[LOCAL_PLAYER]?.out) return 'spectate';
    return 'combat';
  }

  // ── input niceties ──
  root.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('keydown', e => {
    if (screen !== 'combat') return;
    if (e.code === 'Space') {
      e.preventDefault();
      useUlt();
    } else if (e.code === 'Escape') setPaused(!paused);
    else if (e.code === 'Backquote') debug.toggle();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === 'combat' && game?.state.phase === 'combat' && !paused) setPaused(true);
  });

  // ── loop ──
  let last = performance.now();
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (!game || screen !== 'combat') return;
    const running = !paused && !stage.portrait;
    if (running) game.step(dt);
    const events = game.drainEvents();
    drag.frame();
    uiState.dragPreview = drag.dragPreview;
    uiState.freezeCamera = drag.active;
    renderer.render(game.state, events, running ? dt : 0, uiState);
    hud?.update(game.state, events);
    reward.update(game.state);
    hud?.setCovered(reward.visible || paused);
    if (game.state.phase === 'runOver' && resultAt == null) resultAt = now + RESULT_DELAY_MS;
    if (resultAt != null && now >= resultAt) showResult();
  };
  requestAnimationFrame(frame);

  refreshDebugNote();
  preset.setVisible(true);

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
    startRun,
    setPaused,
    ui: {
      dragTo(kind, index, world) {
        if (!game) return { ok: false, reason: '전투 중이 아님' };
        const pos = game.clampToArena(world);
        const r =
          kind === 'swap'
            ? game.dispatch({ type: 'swap', player: LOCAL_PLAYER, partyIndex: index, pos })
            : game.dispatch({ type: 'pet', player: LOCAL_PLAYER, petIndex: index, pos });
        if (!r.ok) hud?.refuse(kind, index, r);
        return r;
      },
      fingerFor(world) {
        const l = renderer.worldToScreen(world);
        return stage.toClient({ x: l.x, y: l.y + LIFT });
      },
    },
  };
}
