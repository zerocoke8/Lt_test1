// 기획 15차 원정: the expedition controller (docs/expedition.md 2장 흐름). It owns the expedition screens (원정 로비 ·
// 장비 · 매칭 대기 · 실패 · 수령) and drives the run stored in the stash (StashData.run, src/expedition/run.ts).
// 기획 16차: one floor per stage and every stage ends in the 원정 lobby (no in-game choice):
//  - Start: 「N단계부터 출발」 → beginRun(startRun(…)) with the party / gear locked → match. Lobby 「N단계 매칭」 → match.
//  - Solo / artifact / offline: 「혼자 하기 · 봇 2명과 출발」 for 1 s, beginStage (saved first), one local createGame.
//    Phase 'stageClear' → a 1.5 s banner → applyResult (stageResultFromState) → the lobby with the loot reveal.
//  - Online: beginStage (saved first) → expQueue with the run → the stage game arrives through the app as a RemoteGame →
//    the server's one expStageResult is applied the same way (cleared / failed / void).
//  - A wipe / timeout / mid-stage quit = failed: the bag is lost (the run ends, worn gear stays) → the failure screen.
//  - Lobby 「수령」 → claimRun (bag → stash, one save) → 「수령 완료!」. Clearing stage 12 claims by itself → 「원정 완주!」.
//  - reconcile() (boot, welcome, another tab's save, every 2 s on the lobby) settles a stage this page is not playing:
//    online → same server boot: ask (expStatus by run id + stage), another boot: void; solo → the playing tab went
//    silent > 10 s: failed, or cleared when its combat was already won (run.pending.won, saved at the combat clear).
// Every stash change is 「read → change → save」 (ctx.update), so two tabs never undo each other (10-4).

import type { Game, GameSetup, GameState, Tunables } from '../types';
import { getCharacter } from '../data';
import { BOT_PRESETS } from '../config';
import { botLoadout, type GearSlot, type GearSpec } from '../data/gear';
import {
  applyResult,
  beginRun,
  claimRun,
  dropEmptyRun,
  isFirstBossClear,
  loadoutsFor,
  runBuffCount,
  type StashData,
} from '../expedition/stash';
import { beginStage, runComplete, runToJoin, stageGameSetup, startRun, toLobby, type ApplyKind, type ExpeditionRun, type RunLock, type StageResult } from '../expedition/run';
import type { ExpResultReason } from '../net/protocol';
import { stageResultFromState, wonResultFromState } from '../sim';
import { sfx } from '../audio';
import type { Connection } from '../net/connection';
import { ExpeditionNet, type ExpErrorMsg, type ExpQueueMsg, type ExpStageResultMsg } from '../net/expeditionNet';
import type { ExpCtx } from './expeditionCtx';
import { createEquipScreen, type EquipScreen, type StashFilter } from './expeditionEquip';
import { createHub, type Hub } from './expeditionHub';
import {
  ExpeditionPill,
  MATCH_SECONDS,
  MatchScreen,
  RunResultScreen,
  SOLO_MATCH_MS,
  STAGE_END_MS,
  matchSeatsView,
  type ExtractView,
  type FailView,
  type MatchSeat,
  type MatchView,
  type RevealView,
} from './expeditionRun';
import { recommendWearers } from './expeditionFormat';
import type { GearInspect } from './expeditionInfo';
import { TAB_ID, randomRunId, randomSeed, reconcileDecision } from './expeditionStore';
import type { Hud } from './hud';

export interface FlowHost {
  readonly screenLayer: HTMLElement;
  /** Start a stage game (solo, local sim). */
  startGame(setup: GameSetup): void;
  /** Leave the stage game (HUD / canvas away). */
  stopGame(): void;
  hud(): Hud | null;
  showMain(): void;
  /** The preset screen in its expedition variant. */
  showPreset(): void;
  tunables(): Tunables;
  nickname(): string;
  /** The game-server connection (null = solo-only build). Runs go online while it is online. */
  connection(): Connection | null;
  /** This client's player index in the stage game (solo 0). */
  localPlayer(): number;
}

export type FlowPhase = 'expHub' | 'expEquip' | 'expMatch' | 'expPlaying' | 'expResult';

/** Heartbeat / lobby re-check period. */
const TICK_MS = 2000;
/** expStatus at most this often while a result is awaited. */
const STATUS_EVERY_MS = 5000;

/** What a settled stage shows next (when its game leaves the screen, or when the lobby opens). */
type Notice = { kind: 'reveal'; v: RevealView } | { kind: 'fail'; v: FailView } | { kind: 'extract'; v: ExtractView };

const RESULT_REASON: Record<string, ExpResultReason> = { wipe: 'wipe', timeout: 'timeout', quit: 'quit' };

export class ExpeditionFlow {
  private readonly host: FlowHost;
  private readonly ctx: ExpCtx;
  private readonly hub: Hub;
  private readonly equip: EquipScreen;
  private readonly match: MatchScreen;
  private readonly result: RunResultScreen;
  private phaseNow: FlowPhase | null = null;
  private pill: ExpeditionPill | null = null;
  private pillHud: Hud | null = null;
  private matchTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly net: ExpeditionNet | null;
  /** This page joined a stage queue (waiting for the game / a refusal / expCancelled). */
  private queued = false;
  /** The stage game on screen is an online one (RemoteGame). */
  private stageOnline = false;
  /** Solo: the 'stageClear' of the game on screen was applied. */
  private clearSeen = false;
  /** Solo: the won stage's result last saved into run.pending.won (JSON; saved again only when it changes). */
  private wonSaved: string | null = null;
  /** performance.now() when the won stage game leaves the screen (the clear banner first). */
  private leaveAt: number | null = null;
  private notice: Notice | null = null;
  private statusAskedAt = -Infinity;
  /** Online: local Date.now() ms when the queue fills its empty seats with bots. */
  private queueDeadline: number | null = null;
  private queueTicker: ReturnType<typeof setInterval> | null = null;
  private lastQueue: ExpQueueMsg | null = null;

  constructor(host: FlowHost, ctx: ExpCtx) {
    this.host = host;
    this.ctx = ctx;
    const layer = host.screenLayer;
    this.hub = createHub(layer, ctx, {
      onMain: () => {
        this.hideAll();
        host.showMain();
      },
      onEquip: (charId, slot) => this.openEquip(charId, slot),
      onPreset: () => {
        this.hideAll();
        host.showPreset();
      },
      onStart: stage => this.begin(stage),
      onClaim: () => this.claim(),
      onMatch: () => this.startMatch(),
    });
    this.equip = createEquipScreen(layer, ctx, { onBack: () => this.openHub() });
    this.match = new MatchScreen(layer, { onStartNow: () => this.launch(), onCancel: () => this.cancelMatch() });
    this.result = new RunResultScreen(layer, { onHub: () => this.openHub(), onEquipNew: () => this.openEquip(null, 'new') });
    const conn = host.connection();
    this.net = conn
      ? new ExpeditionNet(conn, {
          queue: m => this.onNetQueue(m),
          cancelled: () => this.onNetCancelled(),
          result: m => this.onNetResult(m),
          noStage: id => this.onNetNoStage(id),
          error: m => this.onNetError(m),
        })
      : null;
    conn?.onStatus(s => {
      if (s !== 'online') return;
      if (this.queued) this.recheckQueue();
      this.reconcile();
    });
    if (typeof setInterval !== 'undefined') setInterval(() => this.tick(), TICK_MS);
    this.reconcile();
  }

  /** Which expedition screen is up (null = none: main / preset / classic). */
  get phase(): FlowPhase | null {
    return this.phaseNow;
  }

  /** A stage game of this flow is on screen (the app forwards frames and the run-over). */
  get playing(): boolean {
    return this.phaseNow === 'expPlaying';
  }

  /** The 원정 lobby (with whatever a settled stage still has to show: the reveal, the failure, a claim). */
  openHub(): void {
    this.showLobby();
    this.presentPending();
  }

  openEquip(charId: string | null, slot?: GearSlot | 'new'): void {
    this.hideAll();
    this.phaseNow = 'expEquip';
    this.equip.show(charId, (slot ?? 'all') as StashFilter);
  }

  /** Hide every expedition screen (the app is showing something else). */
  hideAll(): void {
    this.hub.hide();
    this.equip.hide();
    this.match.hide();
    this.result.hide();
    if (this.matchTimer) clearTimeout(this.matchTimer);
    this.matchTimer = null;
    this.stopQueueTicker();
    if (!this.playing) this.phaseNow = null;
  }

  /** 기획 16차: another tab saved the stash (the app already re-read it): settle / redraw. */
  onStashChanged(): void {
    if (this.playing) return;
    if (this.phaseNow === 'expMatch' && !this.queued && !this.ctx.stash.run) {
      // the solo match's run was claimed / dropped in another tab
      this.openHub();
      return;
    }
    this.reconcile();
    this.hub.refresh();
    this.equip.refresh();
  }

  // ─────────────────────────── run start / match ───────────────────────────

  private lockNow(): RunLock {
    const party = this.ctx.party();
    return { characters: [...party.characters], pets: [...party.pets], gear: loadoutsFor(this.ctx.stash, party.characters) };
  }

  /** 「N단계부터 출발」: a new run (party and gear locked from now on), then its first match. */
  private begin(stage: number): void {
    const run = startRun(stage, this.lockNow(), randomRunId(), randomSeed());
    const r = this.ctx.update(s => beginRun(s, run));
    if (!r.ok) {
      this.ctx.toast(r.reason ?? '이미 진행 중인 원정이 있어요', 'warn');
      this.hub.refresh();
      return;
    }
    this.startMatch();
  }

  /** Match the run's next stage: online when the game server is there, else solo with 2 bots. */
  private startMatch(): void {
    const run = this.ctx.stash.run;
    if (!run || run.status === 'inStage' || runComplete(run)) return;
    if (this.net && this.host.connection()?.online) this.joinQueue();
    else this.soloMatch();
  }

  /** The match wait, solo: 「혼자 하기 · 봇 2명과 출발」 with the bots already seated, then the stage starts. */
  private soloMatch(): void {
    const run = this.ctx.update(s => {
      if (s.run && s.run.status !== 'inStage') s.run.status = 'matching';
      return s.run;
    });
    if (!run) return this.openHub();
    this.leaveGame();
    this.hideAll();
    this.phaseNow = 'expMatch';
    const me = this.mySeat(run);
    const seats: MatchSeat[] = matchSeatsView(1, 3, true).map((k, i) => {
      if (i === 0) return me;
      const b = BOT_PRESETS[(i - 1) % BOT_PRESETS.length];
      return { name: b.name, characters: b.characters, gear: b.characters.map(() => botLoadout(run.stage)), kind: k };
    });
    this.match.show({ stage: run.stage, seats, secondsLeft: null, solo: true, continuing: run.cleared > 0, buffs: runBuffCount(run) });
    this.matchTimer = setTimeout(() => this.launch(), SOLO_MATCH_MS);
  }

  private mySeat(run: ExpeditionRun): MatchSeat {
    return { name: this.host.nickname() || '나', characters: run.lock.characters, gear: run.lock.gear, kind: 'human', me: true };
  }

  /** Solo: the stage game starts (beginStage saved first). Online: 「바로 출발 (빈자리 봇)」. */
  private launch(): void {
    if (this.phaseNow !== 'expMatch') return;
    if (this.queued) {
      this.net?.startNow();
      return;
    }
    if (this.matchTimer) clearTimeout(this.matchTimer);
    this.matchTimer = null;
    const run = this.ctx.update(s => {
      if (s.run && s.run.status !== 'inStage') beginStage(s.run, { stage: s.run.stage, online: false, bootId: null, tabId: TAB_ID, aliveAt: Date.now() });
      return s.run;
    });
    if (!run || run.pending?.tabId !== TAB_ID) return this.openHub();
    const setup = stageGameSetup([{ name: this.host.nickname() || '나', run, firstBossClear: this.firstBossClear(run) }], this.host.tunables());
    this.match.hide();
    this.startPlaying(false);
    this.host.startGame(setup);
  }

  private startPlaying(online: boolean): void {
    this.stageOnline = online;
    this.clearSeen = false;
    this.wonSaved = null;
    this.leaveAt = null;
    this.notice = null;
    this.phaseNow = 'expPlaying';
  }

  /** 「취소」: back to the lobby, the bag kept (a run that cleared nothing simply goes away). */
  private cancelMatch(): void {
    if (this.queued) {
      // the server answers expCancelled (it never claims anything)
      if (this.net?.cancel()) return;
      this.queued = false;
    }
    this.backToLobbyRun();
    this.openHub();
  }

  /** The run's stage did not start (cancel / refusal): status 'lobby' again, or no run when it cleared nothing. */
  private backToLobbyRun(): void {
    this.ctx.update(s => {
      if (!s.run) return;
      toLobby(s.run);
      dropEmptyRun(s);
    });
  }

  // ─────────────────────────── the stage game ───────────────────────────

  /** Per frame while a stage game runs (app loop): pill, the solo stage clear, leaving after the clear banner. */
  frame(game: Game, now: number): void {
    if (!this.playing) return;
    const hud = this.host.hud();
    if (hud && hud !== this.pillHud) {
      this.pill?.destroy();
      this.pill = new ExpeditionPill(hud.topRight);
      this.pillHud = hud;
      this.pill.setBag(this.ctx.stash.run?.bag ?? [], this.family(), this.inspect());
    }
    const s = game.state;
    this.pill?.update(s);
    if (!this.stageOnline && !this.clearSeen && s.expedition?.outcome === 'cleared') this.saveWon(s);
    if (!this.stageOnline && s.phase === 'stageClear' && !this.clearSeen) this.onSoloClear(s, now);
    if (this.leaveAt != null && now >= this.leaveAt) {
      this.leaveAt = null;
      this.leaveGame();
      this.presentPending();
    }
  }

  /**
   * Solo, the combat is won (floor reward / 괴담 room still open): save what the stage gives into run.pending.won, so a
   * reload / tab kill from here on settles as a clear (5-3), like a drop online. Saved again when the pick changes it.
   */
  private saveWon(s: GameState): void {
    const won = wonResultFromState(s, this.host.localPlayer());
    if (!won) return;
    const key = JSON.stringify(won);
    if (key === this.wonSaved) return;
    this.wonSaved = key;
    this.ctx.update(st => {
      const p = st.run?.status === 'inStage' ? st.run.pending : null;
      if (p && p.tabId === TAB_ID && !p.online && p.stage === st.run!.stage) p.won = won;
    });
  }

  /** Solo: the stage is won (its reward / room done): apply it, the banner, then the lobby. */
  private onSoloClear(s: GameState, now: number): void {
    this.clearSeen = true;
    const run = this.ctx.stash.run;
    const res = stageResultFromState(s, this.host.localPlayer());
    if (!run || !res) {
      this.leaveAt = now + STAGE_END_MS;
      return;
    }
    const kind = this.settle({ runId: run.id, stage: run.stage, outcome: 'cleared', ...res });
    if (kind === 'ignored') this.ctx.toast('다른 창에서 이미 처리했어요', 'warn');
    // a boss stage already shows its clear banner (the clear and the stage end are the same moment)
    if (!res.bossClear) this.host.hud()?.stageEndBanner(`${run.stage}단계 클리어`, `가방 +${res.loot.length} · 원정 로비로 돌아가요`);
    this.leaveAt = now + STAGE_END_MS;
  }

  /**
   * The stage game ended without the clear on screen (solo: wipe / timeout / quit after the result delay; online: the
   * game stopped under us). Solo after the combat was won: keep going (the bots pick the reward and pass the room).
   */
  onRunOver(game: Game): void {
    if (!this.playing) return;
    const s = game.state;
    if (!this.stageOnline) {
      if (s.expedition?.outcome === 'cleared') {
        if (s.phase === 'stageClear' && !this.clearSeen) this.onSoloClear(s, performance.now());
        return;
      }
      const run = this.ctx.stash.run;
      if (run?.status === 'inStage' && run.pending?.tabId === TAB_ID) {
        const reason = RESULT_REASON[s.runResult?.reason ?? 'wipe'] ?? 'wipe';
        this.settle({ runId: run.id, stage: run.stage, outcome: 'failed', reason, loot: [], carry: null, bossClear: false }, game);
      }
      this.leaveGame();
      this.presentPending();
      return;
    }
    if (this.notice?.kind === 'fail') this.addDetails(this.notice.v, game);
    this.leaveGame();
    if (this.notice) this.presentPending();
    else {
      // the result has not arrived yet: the lobby waits for it (and asks — showLobby reconciles)
      this.statusAskedAt = -Infinity;
      this.showLobby();
    }
  }

  /** Online 나가기 (a personal leave): the server answers with this stage's result (failed mid-combat, cleared after). */
  onNetQuit(game: Game): void {
    if (!this.playing) return;
    if (this.notice?.kind === 'fail') this.addDetails(this.notice.v, game);
    this.leaveGame();
    if (this.notice) this.presentPending();
    else this.showLobby();
  }

  /** The app entered a stage game (start mode 'expedition'): an online stage of the run is on now. */
  onNetGameStart(_game: Game): void {
    this.stopQueueTicker();
    this.queued = false;
    this.lastQueue = null;
    this.hub.hide();
    this.equip.hide();
    this.match.hide();
    this.result.hide();
    this.startPlaying(true);
    this.ctx.update(s => {
      if (s.run?.status === 'inStage' && s.run.pending?.online) s.run.pending.aliveAt = Date.now();
    });
  }

  // ─────────────────────────── results ───────────────────────────

  /**
   * Apply one stage result to the stored run (once: run id + stage must match) and line up what to show next. A clear
   * of stage 12 is claimed right away (원정 완주). Returns what applying did.
   */
  private settle(r: StageResult, game?: Game): ApplyKind {
    let lost: GearSpec[] = [];
    const out = this.ctx.update(s => {
      lost = s.run && s.run.id === r.runId ? s.run.bag.map(g => ({ ...g })) : [];
      return applyResult(s, r);
    });
    if (out.kind === 'ignored') return out.kind;
    if (out.kind === 'cleared') {
      const run = this.ctx.stash.run;
      if (run && runComplete(run)) this.notice = this.claimNotice(run.id, true);
      else this.notice = { kind: 'reveal', v: { stage: r.stage, loot: out.loot ?? [], bagCount: run?.bag.length ?? 0, family: this.family(), inspect: null } };
    } else if (out.kind === 'failed') {
      const party = this.ctx.party().characters;
      const v: FailView = { reason: r.reason === 'timeout' ? 'timeout' : r.reason === 'quit' || r.reason === 'abandon' ? 'quit' : 'wipe', stage: r.stage, lost, party, gear: loadoutsFor(this.ctx.stash, party), playTime: 0, family: this.family(), details: [] };
      if (game) this.addDetails(v, game);
      this.notice = { kind: 'fail', v };
    } else {
      this.notice = null;
      this.ctx.toast('서버 점검으로 단계가 취소됐어요 · 가방은 그대로예요', 'warn');
    }
    this.hub.refresh();
    this.equip.refresh();
    return out.kind;
  }

  private addDetails(v: FailView, game: Game): void {
    const s = game.state;
    const me = s.players[this.host.localPlayer()];
    v.playTime = s.time;
    v.details = me
      ? [
          { label: '딜량', value: me.stats.damageDealt },
          { label: '처치', value: me.stats.kills },
          { label: '받은 피해', value: me.stats.damageTaken },
          { label: '교체', value: me.stats.swaps },
          { label: '궁극기', value: me.stats.ultsUsed },
        ]
      : [];
  }

  /** 「수령」 now: the bag into the stash in one save. The extract screen's view, or null (refused — told why). */
  private claimNotice(runId: string, complete: boolean): Notice | null {
    const buffs = runBuffCount(this.ctx.stash.run);
    const r = this.ctx.update(s => claimRun(s, runId));
    if (!r.ok) {
      this.ctx.toast(r.reason, 'warn');
      this.hub.refresh();
      return null;
    }
    const inspect = this.inspect();
    // one pick per character · slot (the weakest slot first), so 3 armors are not all 'for' the same character
    const recommend = recommendWearers(r.items, inspect.party, inspect.loadouts).map(who => (who ? `▲ ${getCharacter(who).name} 장착 추천` : ''));
    return { kind: 'extract', v: { items: r.items, recommend, buffsLost: buffs || r.buffs, complete, family: this.family(), inspect } };
  }

  /** Lobby 「수령」. */
  private claim(): void {
    const run = this.ctx.stash.run;
    if (!run) return this.hub.refresh();
    const n = this.claimNotice(run.id, runComplete(run));
    if (!n) return;
    this.notice = n;
    this.presentPending();
  }

  /** Show what a settled stage left (or the lobby). */
  private presentPending(): void {
    let n = this.notice;
    this.notice = null;
    const run = this.ctx.stash.run;
    if (!n && run && run.status === 'lobby' && runComplete(run)) n = this.claimNotice(run.id, true); // a leftover 완주
    if (!n) {
      if (this.phaseNow !== 'expHub') this.showLobby();
      return;
    }
    if (n.kind === 'reveal') {
      this.showLobby();
      this.hub.reveal(n.v);
      return;
    }
    this.leaveGame();
    this.hideAll();
    this.phaseNow = 'expResult';
    if (n.kind === 'fail') this.result.showFail(n.v);
    else {
      sfx.ui('exp.extract');
      this.result.showExtract(n.v);
    }
  }

  private showLobby(): void {
    this.leaveGame();
    this.hideAll();
    this.phaseNow = 'expHub';
    this.hub.show();
    this.reconcile();
  }

  // ─────────────────────────── reconcile (10-4) ───────────────────────────

  /** Settle a run whose stage this page is not playing (see the header). Redraws the lobby when something changed. */
  private reconcile(): void {
    const run = this.ctx.stash.run;
    const online = !!this.net && !!this.host.connection()?.online;
    const what = reconcileDecision(run, {
      now: Date.now(),
      tabId: TAB_ID,
      busy: this.playing || this.queued,
      matching: this.phaseNow === 'expMatch',
      bootId: online ? (this.net?.bootId ?? null) : null,
    });
    if (!run || what === 'none' || what === 'wait') return;
    const none = { loot: [], carry: null, bossClear: false };
    switch (what) {
      case 'toLobby':
        this.backToLobbyRun();
        this.hub.refresh();
        return;
      case 'void':
        // the server restarted under that stage: void (the bag is kept, the same stage again)
        return this.settleAndShow({ runId: run.id, stage: run.stage, outcome: 'void', reason: 'server', ...none });
      case 'status':
        return this.askStatus(false);
      case 'won':
        // a solo stage whose tab closed / reloaded after the combat was won = a clear (5-3; its open reward picked)
        return this.settleAndShow({ runId: run.id, stage: run.stage, outcome: 'cleared', ...run.pending!.won! });
      case 'fail':
        // a solo stage whose tab closed / reloaded mid-stage = a failure (5-3)
        this.settleAndShow({ runId: run.id, stage: run.stage, outcome: 'failed', reason: 'quit', ...none });
        if (this.notice?.kind === 'fail') this.notice.v.reasonText = '단계 도중에 창을 닫았어요';
        return;
    }
  }

  /** Settle now; show it at once when the lobby is up (else when it opens). */
  private settleAndShow(r: StageResult): void {
    if (this.settle(r) === 'ignored') return;
    if (this.phaseNow === 'expHub' || this.phaseNow === 'expEquip') {
      // let the caller finish (e.g. reconcile's reason text) before the screen is drawn
      queueMicrotask(() => this.presentPending());
    }
  }

  private askStatus(force: boolean): void {
    const run = this.ctx.stash.run;
    if (!this.net || !run || run.status !== 'inStage') return;
    const now = performance.now();
    if (!force && now - this.statusAskedAt < STATUS_EVERY_MS) return;
    this.statusAskedAt = now;
    this.net.status(run.id, run.stage);
  }

  /** Every 2 s: the playing tab's heartbeat; the lobby re-checks a stage it is waiting for. */
  private tick(): void {
    const run = this.ctx.stash.run;
    if (this.playing && run?.status === 'inStage' && run.pending?.tabId === TAB_ID) {
      this.ctx.update(s => {
        if (s.run?.pending?.tabId === TAB_ID) s.run.pending.aliveAt = Date.now();
      });
      return;
    }
    if (this.phaseNow === 'expHub' && run?.status === 'inStage') {
      this.reconcile();
      this.hub.refresh();
    }
  }

  // ─────────────────────────── online ───────────────────────────

  private joinQueue(): void {
    const net = this.net!;
    const run = this.ctx.update(s => {
      // saved BEFORE the join: if this page dies, the run knows a stage may be running (its result comes by run id)
      if (s.run && s.run.status !== 'inStage') beginStage(s.run, { stage: s.run.stage, online: true, bootId: net.bootId, tabId: TAB_ID, aliveAt: Date.now() });
      return s.run;
    });
    if (!run || run.pending?.tabId !== TAB_ID) return this.openHub();
    const stash: StashData = this.ctx.stash;
    const ok = net.join({
      stage: run.stage,
      preset: { characters: [...run.lock.characters], pets: [...run.lock.pets] },
      gear: run.lock.gear.map(l => ({ ...l })),
      firstBossClears: [...stash.bossFirstClears],
      debugUnlock: stash.unlockAll,
      run: runToJoin(run),
    });
    if (!ok) {
      // the link dropped between the check and the send: play solo instead
      this.ctx.update(s => s.run && toLobby(s.run));
      this.soloMatch();
      return;
    }
    this.queued = true;
    this.lastQueue = null;
    this.leaveGame();
    this.hideAll();
    this.phaseNow = 'expMatch';
    this.queueDeadline = Date.now() + MATCH_SECONDS * 1000;
    this.match.show(this.netMatchView(null));
    this.startQueueTicker();
  }

  private netMatchView(m: ExpQueueMsg | null): MatchView {
    const run = this.ctx.stash.run;
    const stage = m?.stage ?? run?.stage ?? 1;
    const me: MatchSeat = run ? this.mySeat(run) : { name: this.host.nickname() || '나', characters: [], gear: [], kind: 'human', me: true };
    const left = this.queueDeadline == null ? MATCH_SECONDS : Math.max(0, Math.ceil((this.queueDeadline - Date.now()) / 1000));
    const buffs = run ? runBuffCount(run) : 0;
    const continuing = (run?.cleared ?? 0) > 0;
    if (!m) {
      const kinds = matchSeatsView(1, 3, false);
      return { stage, seats: kinds.map((k, i) => (i === 0 ? me : { name: '', characters: [], gear: [], kind: k })), secondsLeft: left, solo: false, continuing, buffs };
    }
    const seats: MatchSeat[] = m.seats.map((x, i) => ({ name: x.name, characters: x.characters, gear: x.gear, kind: x.isBot ? 'bot' : 'human', me: i === m.you, buffs: x.buffs }));
    while (seats.length < 3) seats.push({ name: '', characters: [], gear: [], kind: 'empty' });
    return { stage, seats, secondsLeft: m.launching ? 0 : left, solo: false, continuing, buffs };
  }

  private onNetQueue(m: ExpQueueMsg): void {
    if (!this.queued) {
      // a queue this page did not join (reconnect after a reload): take it over if the stored run is waiting for it
      const run = this.ctx.stash.run;
      if (this.playing || !run || run.status !== 'inStage' || !run.pending?.online || run.stage !== m.stage) {
        this.net?.cancel();
        return;
      }
      this.queued = true;
      this.leaveGame();
      this.hideAll();
      this.phaseNow = 'expMatch';
      this.queueDeadline = Date.now() + m.secondsLeft * 1000;
      this.lastQueue = m;
      this.match.show(this.netMatchView(m));
      this.startQueueTicker();
      return;
    }
    this.lastQueue = m;
    this.queueDeadline = Date.now() + m.secondsLeft * 1000;
    if (this.phaseNow === 'expMatch') this.match.update(this.netMatchView(m));
  }

  private startQueueTicker(): void {
    this.stopQueueTicker();
    this.queueTicker = setInterval(() => {
      if (this.phaseNow === 'expMatch' && this.queued) this.match.update(this.netMatchView(this.lastQueue));
    }, 250);
  }

  private stopQueueTicker(): void {
    if (this.queueTicker) clearInterval(this.queueTicker);
    this.queueTicker = null;
  }

  private onNetCancelled(): void {
    if (!this.queued) return;
    this.queued = false;
    this.lastQueue = null;
    this.stopQueueTicker();
    this.backToLobbyRun();
    if (this.phaseNow === 'expMatch') this.openHub();
  }

  /**
   * Back online while queued: another server boot = that queue is gone (back to the lobby, the bag kept); the same boot
   * = ask by run id + stage (the queue view comes back by itself; a queue dropped while away answers expCancelled /
   * expNoStage; a stage that ran while away answers its result).
   */
  private recheckQueue(): void {
    const run = this.ctx.stash.run;
    const boot = this.net?.bootId ?? null;
    if (run?.pending?.online && run.pending.bootId && boot && boot !== run.pending.bootId) {
      this.ctx.toast('서버가 다시 시작돼서 매칭이 취소됐어요 · 가방은 그대로예요', 'warn');
      this.onNetCancelled();
      return;
    }
    if (run?.status === 'inStage') this.net?.status(run.id, run.stage);
  }

  /** 기획 16차: my stage game's one result (applied once: run id + stage must match). */
  private onNetResult(m: ExpStageResultMsg): void {
    const kind = this.settle(m);
    if (kind === 'ignored') return;
    if (this.queued) {
      // the stage ran while this page was away (its 'start' never came here): not queued any more
      this.queued = false;
      this.lastQueue = null;
      this.stopQueueTicker();
    }
    if (this.playing && this.stageOnline) {
      // cleared: the clear banner first; failed: the stage game shows the wipe, then the app's run-over brings it
      if (kind === 'cleared') this.leaveAt = performance.now() + STAGE_END_MS;
      else if (kind === 'void') {
        this.leaveGame();
        this.showLobby();
      }
      return;
    }
    if (this.phaseNow === 'expHub' || this.phaseNow === 'expEquip' || this.phaseNow === 'expMatch') this.presentPending();
  }

  /**
   * expStatus: the server has nothing for that run's stage and does not hold the run (it restarted, or a queue was
   * dropped while this page was away) → void. While queued here: the queue is gone → back to the lobby.
   */
  private onNetNoStage(runId: string): void {
    const run = this.ctx.stash.run;
    if (!run || run.id !== runId || run.status !== 'inStage' || this.playing) return;
    if (this.queued) return this.onNetCancelled();
    this.settleAndShow({ runId, stage: run.stage, outcome: 'void', reason: 'server', loot: [], carry: null, bossClear: false });
  }

  private onNetError(m: ExpErrorMsg): void {
    this.ctx.toast(m.message, 'warn');
    if (m.code === 'server_busy') return;
    if (this.queued && !this.lastQueue) {
      // the join was refused before anything was at stake: back to the lobby (the bag stays)
      this.queued = false;
      this.backToLobbyRun();
      this.openHub();
    }
  }

  // ─────────────────────────── helpers ───────────────────────────

  private leaveGame(): void {
    if (this.phaseNow === 'expPlaying') {
      this.phaseNow = null;
      this.host.stopGame();
    }
    this.pill?.destroy();
    this.pill = null;
    this.pillHud = null;
    this.leaveAt = null;
  }

  private firstBossClear(run: ExpeditionRun): boolean {
    return isFirstBossClear(this.ctx.stash, run.stage) && !run.bossClears.includes(run.stage);
  }

  /** The party and what it wears (the run's lock while a run exists): the run screens compare loot against it. */
  private inspect(): GearInspect {
    const run = this.ctx.stash.run;
    if (run) return { party: run.lock.characters, loadouts: run.lock.gear };
    const party = this.ctx.party().characters;
    return { party, loadouts: loadoutsFor(this.ctx.stash, party) };
  }

  /** Weapon look of the run's tiles: a character id (TileOpts.family), the party's first. */
  private family(): string | null {
    return this.ctx.stash.run?.lock.characters[0] ?? this.ctx.party().characters[0] ?? null;
  }
}
