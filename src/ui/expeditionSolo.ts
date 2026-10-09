// 기획 15차 원정: the expedition controller (docs/expedition.md 2장 흐름). It owns the expedition screens (허브 · 장비 ·
// 매칭 대기 · 단계 클리어 선택 · 실패 · 탈출) and one ExpeditionRun (src/expedition/run.ts).
//  - Solo / artifact / offline: every stage is one local createGame with 2 bots (「혼자 하기 · 봇 2명과 출발」 for 1 s),
//    the carry goes from stage to stage, the bag is held in memory — 수령 puts it into the stash, a failure drops it.
//  - Online (a game server is reachable): the run lives on the server (server/expedition.ts). The flow joins the stage
//    queue (ExpeditionNet), shows the server's seats and countdown, the stage game arrives as a RemoteGame through the
//    app, the bag shown here mirrors expStageClear, and expExtracted puts the items into the stash.
// Worn gear is never touched. The app (app.ts) hosts it: it starts / stops the stage game, shows the main menu / the
// preset and forwards frames.

import type { ExpeditionChoice, Game, GameSetup, GameState, Tunables } from '../types';
import { getCharacter } from '../data';
import { BOT_PRESETS } from '../config';
import { botLoadout, isBossStage, type GearSlot, type GearSpec } from '../data/gear';
import { isFirstBossClear, loadoutsFor, addItems, recordBossClear } from '../expedition/stash';
import {
  continueRun,
  extractRun,
  failRun,
  onStageCleared,
  runComplete,
  stageGameSetup,
  startRun,
  type ExpeditionRun,
} from '../expedition/run';
import { sfx } from '../audio';
import type { Connection } from '../net/connection';
import { ExpeditionNet, type ExpBagLostMsg, type ExpErrorMsg, type ExpExtractedMsg, type ExpQueueMsg, type ExpStageClearMsg } from '../net/expeditionNet';
import type { ExpCtx } from './expeditionCtx';
import { createEquipScreen, type EquipScreen, type StashFilter } from './expeditionEquip';
import { createHub, type Hub } from './expeditionHub';
import { ChoiceScreen, ExpeditionPill, MATCH_SECONDS, MatchScreen, RunResultScreen, SOLO_MATCH_MS, matchSeatsView, type MatchSeat, type MatchView } from './expeditionRun';
import { recommendWearers } from './expeditionFormat';
import type { GearInspect } from './expeditionInfo';
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
  /** Cover the HUD while a full-screen expedition screen is up over the frozen stage game. */
  coverHud(on: boolean): void;
  /** The game-server connection (null = solo-only build). Runs go online while it is online. */
  connection(): Connection | null;
  /** This client's player index in the stage game (solo 0). */
  localPlayer(): number;
}

export type FlowPhase = 'expHub' | 'expEquip' | 'expMatch' | 'expPlaying' | 'expChoice' | 'expResult';

/** The stage-clear banner plays this long before the choice screen opens. */
const CHOICE_DELAY_MS = 1700;

export class ExpeditionFlow {
  private readonly host: FlowHost;
  private readonly ctx: ExpCtx;
  private readonly hub: Hub;
  private readonly equip: EquipScreen;
  private readonly match: MatchScreen;
  private readonly choice: ChoiceScreen;
  private readonly result: RunResultScreen;
  private phaseNow: FlowPhase | null = null;
  private run: ExpeditionRun | null = null;
  private pill: ExpeditionPill | null = null;
  private pillHud: Hud | null = null;
  private clearHandled = false;
  private choiceAt: number | null = null;
  private matchTimer: ReturnType<typeof setTimeout> | null = null;
  private playTime = 0;
  private lastLoot: GearSpec[] = [];
  /** Online runs: the server holds the run; `run` is only a mirror (stage, bag) for the screens. */
  private readonly net: ExpeditionNet | null;
  private online = false;
  /** Online: floor-reward buffs carried (from the queue seat). */
  private netBuffs = 0;
  /** Online: local Date.now() ms when the queue fills its empty seats with bots. */
  private queueDeadline: number | null = null;
  private queueTicker: ReturnType<typeof setInterval> | null = null;
  private lastQueue: ExpQueueMsg | null = null;
  /** Online: the expStageClear of this stage (null until it arrives). */
  private netClear: ExpStageClearMsg | null = null;
  /** Online: the choice was sent; waiting for expExtracted / the next queue. */
  private netChosen = false;
  /** Online: the run ended with stage 12 (expExtracted reason 'complete'). */
  private netComplete = false;

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
    });
    this.equip = createEquipScreen(layer, ctx, { onBack: () => this.openHub() });
    this.match = new MatchScreen(layer, { onStartNow: () => this.launch(), onCancel: () => this.cancelMatch() });
    this.choice = new ChoiceScreen(layer, { onExtract: () => this.decide('extract'), onContinue: () => this.decide('continue') });
    this.result = new RunResultScreen(layer, { onHub: () => this.openHub(), onEquipNew: () => this.openEquip(null, 'new') });
    const conn = host.connection();
    this.net = conn
      ? new ExpeditionNet(conn, {
          onQueue: m => this.onNetQueue(m),
          onCancelled: () => this.onNetCancelled(),
          onStageClear: m => this.onNetStageClear(m),
          onExtracted: m => this.onNetExtracted(m),
          onBagLost: m => this.onNetBagLost(m),
          onError: m => this.onNetError(m),
        })
      : null;
  }

  /** This run is played on the game server (the stage game is a RemoteGame). */
  get netRun(): boolean {
    return this.online && !!this.run;
  }

  /** Which expedition screen is up (null = none: main / preset / classic). */
  get phase(): FlowPhase | null {
    return this.phaseNow;
  }

  /** A stage game of this flow is running (the app forwards frames and the run-over). */
  get playing(): boolean {
    return this.phaseNow === 'expPlaying' || this.phaseNow === 'expChoice';
  }

  get currentRun(): ExpeditionRun | null {
    return this.run;
  }

  openHub(): void {
    this.leaveGame();
    this.hideAll();
    this.phaseNow = 'expHub';
    this.hub.show();
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
    this.choice.hide();
    this.result.hide();
    if (this.matchTimer) clearTimeout(this.matchTimer);
    this.matchTimer = null;
    this.stopQueueTicker();
    if (!this.playing) this.phaseNow = null;
  }

  // ─────────────────────────── run ───────────────────────────

  private begin(stage: number): void {
    this.run = startRun(stage, Date.now() >>> 0);
    this.playTime = 0;
    this.online = !!this.net && !!this.host.connection()?.online;
    if (this.online) this.joinQueue(stage);
    else this.showMatch(false);
  }

  /** The match wait: solo shows 「혼자 하기 · 봇 2명과 출발」 with the bots already seated, then starts. */
  private showMatch(continuing: boolean): void {
    const run = this.run!;
    this.leaveGame();
    this.hideAll();
    this.phaseNow = 'expMatch';
    const party = this.ctx.party();
    const me: MatchSeat = { name: this.host.nickname() || '나', characters: party.characters, gear: loadoutsFor(this.ctx.stash, party.characters), kind: 'human', me: true };
    const kinds = matchSeatsView(1, 3, true);
    const seats: MatchSeat[] = kinds.map((k, i) =>
      i === 0 ? me : { name: BOT_PRESETS[(i - 1) % BOT_PRESETS.length].name, characters: BOT_PRESETS[(i - 1) % BOT_PRESETS.length].characters, gear: BOT_PRESETS[0].characters.map(() => botLoadout(run.stage)), kind: k },
    );
    this.match.show({ stage: run.stage, seats, secondsLeft: null, solo: true, continuing, buffs: this.buffsNow() });
    this.matchTimer = setTimeout(() => this.launch(), SOLO_MATCH_MS);
  }

  private cancelMatch(): void {
    if (this.netRun) {
      // the server answers: expCancelled (fresh run) or expExtracted (a continuing run claims its bag)
      if (!this.net!.cancel()) this.dropNetRun('서버와 연결이 끊겼어요');
      return;
    }
    if (this.run && this.run.cleared > 0) {
      // 「그만두고 수령하기」: out of combat → the same as extracting
      this.finishExtract();
      return;
    }
    this.run = null;
    this.openHub();
  }

  private launch(): void {
    if (this.phaseNow !== 'expMatch' || !this.run) return;
    if (this.netRun) {
      this.net!.startNow();
      return;
    }
    if (this.matchTimer) clearTimeout(this.matchTimer);
    this.matchTimer = null;
    const party = this.ctx.party();
    const setup = stageGameSetup(
      [
        {
          name: this.host.nickname() || '나',
          characters: party.characters,
          pets: party.pets,
          gear: loadoutsFor(this.ctx.stash, party.characters),
          run: this.run,
          firstBossClear: isFirstBossClear(this.ctx.stash, this.run.stage),
        },
      ],
      this.host.tunables(),
    );
    this.match.hide();
    this.clearHandled = false;
    this.choiceAt = null;
    this.phaseNow = 'expPlaying';
    this.host.startGame(setup);
  }

  /** Per frame while a stage game runs (app loop): pill, the stage clear, the choice countdown. */
  frame(game: Game, now: number): void {
    if (!this.playing || !this.run) return;
    const hud = this.host.hud();
    if (hud && hud !== this.pillHud) {
      this.pill?.destroy();
      this.pill = new ExpeditionPill(hud.topCenter);
      this.pillHud = hud;
      this.pill.setBag(this.run.bag, this.family(), this.inspect());
    }
    const s = game.state;
    this.pill?.update(s);
    if (this.netRun) {
      if (this.netClear && !this.clearHandled) this.onNetClearShown(s, now);
    } else if (s.phase === 'stageClear' && !this.clearHandled) this.onStageClear(s, now);
    if (this.choiceAt != null && now >= this.choiceAt) {
      this.choiceAt = null;
      this.openChoice();
    }
    if (this.choice.visible) this.choice.tick();
  }

  private onStageClear(s: GameState, now: number): void {
    const run = this.run!;
    this.clearHandled = true;
    this.playTime += s.time;
    this.lastLoot = onStageCleared(run, s, 0);
    if (isBossStage(run.stage)) recordBossClear(this.ctx.stash, run.stage);
    this.ctx.save();
    this.pill?.setBag(run.bag, this.family(), this.inspect());
    this.choiceAt = now + CHOICE_DELAY_MS;
  }

  private openChoice(): void {
    const run = this.run!;
    this.phaseNow = 'expChoice';
    this.host.coverHud(true);
    this.choice.show({
      stage: run.stage,
      loot: this.lastLoot,
      bag: run.bag,
      buffs: this.buffsNow(),
      complete: this.netRun ? this.netClear?.nextStage == null : runComplete(run),
      deadline: this.netRun ? this.netChoiceDeadline() : null,
      family: this.family(),
      inspect: this.inspect(),
    });
  }

  private decide(c: 'extract' | 'continue'): void {
    const run = this.run;
    if (!run) return;
    if (this.netRun) {
      this.netDecide(c);
      return;
    }
    if (c === 'continue' && continueRun(run)) {
      this.showMatch(true);
      return;
    }
    this.finishExtract();
  }

  private finishExtract(): void {
    const run = this.run!;
    const buffs = this.buffsNow();
    const complete = this.netRun ? this.netComplete : runComplete(run);
    this.online = false;
    const items = extractRun(run);
    const added = items.map(g => addItems(this.ctx.stash, [g], g.tier)[0]).filter(Boolean);
    this.ctx.save();
    // one pick per character · slot (the weakest slot first), so 3 armors are not all 'for' the same character
    const inspect = this.inspect();
    const recommend = recommendWearers(added, inspect.party, inspect.loadouts).map(who => (who ? `▲ ${getCharacter(who).name} 장착 추천` : ''));
    this.run = null;
    this.leaveGame();
    this.hideAll();
    this.phaseNow = 'expResult';
    sfx.ui('exp.extract');
    this.result.showExtract({ items: added, recommend, buffsLost: buffs, complete, family: this.family(), inspect });
  }

  /** The stage game ended without a clear (wipe / timeout / quit): the bag is lost, worn gear stays. */
  onRunOver(game: Game): void {
    const run = this.run;
    if (!run) return;
    if (this.netRun) this.online = false; // the server settles the bag (expBagLost); the screen is the same
    const s = game.state;
    this.playTime += s.time;
    const lost = [...run.bag];
    failRun(run);
    this.run = null;
    const party = this.ctx.party().characters;
    const me = s.players[this.host.localPlayer()];
    const details = me
      ? [
          { label: '딜량', value: me.stats.damageDealt },
          { label: '처치', value: me.stats.kills },
          { label: '받은 피해', value: me.stats.damageTaken },
          { label: '교체', value: me.stats.swaps },
          { label: '궁극기', value: me.stats.ultsUsed },
        ]
      : [];
    const view = {
      reason: s.runResult?.reason ?? 'wipe',
      stage: run.stage,
      floor: s.floor,
      lost,
      party,
      gear: loadoutsFor(this.ctx.stash, party),
      playTime: this.playTime,
      family: this.family(),
      details,
    } as const;
    this.leaveGame();
    this.hideAll();
    this.phaseNow = 'expResult';
    this.result.showFail({ ...view, details: [...view.details] });
  }

  /** Online 나가기 mid-stage (the quit is a personal leave): the bag is lost, the failure screen right away. */
  onNetQuit(game: Game): void {
    if (!this.netRun) return;
    const at = game.state.phase;
    if (at === 'stageClear') {
      // leaving at the choice = 수령 (전투 밖): expExtracted follows
      this.netDecide('extract');
      return;
    }
    this.onRunOver(game);
  }

  /** The app entered a stage game (start mode 'expedition'): an online run's stage is on now. */
  onNetGameStart(game: Game): void {
    this.stopQueueTicker();
    if (!this.run) {
      // reconnected into a stage game (page reload): rebuild the mirror from the state
      this.run = startRun(game.state.expedition?.stage ?? 1, 0);
      this.playTime = 0;
    }
    this.online = true;
    if (game.state.expedition) this.run.stage = game.state.expedition.stage;
    this.match.hide();
    this.choice.hide();
    this.result.hide();
    this.hub.hide();
    this.equip.hide();
    this.clearHandled = false;
    this.choiceAt = null;
    this.netClear = null;
    this.netChosen = false;
    this.phaseNow = 'expPlaying';
  }

  // ─────────────────────────── online (server-held run) ───────────────────────────

  private joinQueue(stage: number): void {
    const party = this.ctx.party();
    const stash = this.ctx.stash;
    this.netBuffs = 0;
    this.lastQueue = null;
    const ok = this.net!.join({
      stage,
      preset: { characters: [...party.characters], pets: [...party.pets] },
      gear: loadoutsFor(stash, party.characters),
      firstBossClears: [...stash.bossFirstClears],
      debugUnlock: stash.unlockAll,
    });
    if (!ok) {
      // the link dropped between the check and the send: play solo instead
      this.online = false;
      this.showMatch(false);
      return;
    }
    this.leaveGame();
    this.hideAll();
    this.phaseNow = 'expMatch';
    this.queueDeadline = Date.now() + MATCH_SECONDS * 1000;
    this.match.show(this.netMatchView(null));
    this.startQueueTicker();
  }

  private netMatchView(m: ExpQueueMsg | null): MatchView {
    const party = this.ctx.party();
    const me: MatchSeat = { name: this.host.nickname() || '나', characters: party.characters, gear: loadoutsFor(this.ctx.stash, party.characters), kind: 'human', me: true };
    const left = this.queueDeadline == null ? MATCH_SECONDS : Math.max(0, Math.ceil((this.queueDeadline - Date.now()) / 1000));
    if (!m) {
      const kinds = matchSeatsView(1, 3, false);
      return { stage: this.run!.stage, seats: kinds.map((k, i) => (i === 0 ? me : { name: '', characters: [], gear: [], kind: k })), secondsLeft: left, solo: false, continuing: false, buffs: 0 };
    }
    const seats: MatchSeat[] = m.seats.map((x, i) => ({ name: x.name, characters: x.characters, gear: x.gear, kind: x.isBot ? 'bot' : 'human', me: i === m.you }));
    while (seats.length < 3) seats.push({ name: '', characters: [], gear: [], kind: 'empty' });
    return { stage: m.stage, seats, secondsLeft: m.launching ? 0 : left, solo: false, continuing: m.continuing, buffs: m.seats[m.you]?.buffs ?? 0 };
  }

  private onNetQueue(m: ExpQueueMsg): void {
    if (!this.run) {
      // a queue we did not start from this page (reconnect after a reload)
      this.run = startRun(m.stage, 0);
      this.playTime = 0;
    }
    this.online = true;
    this.run.stage = m.stage;
    this.netBuffs = m.seats[m.you]?.buffs ?? this.netBuffs;
    this.lastQueue = m;
    this.queueDeadline = Date.now() + m.secondsLeft * 1000;
    if (this.phaseNow !== 'expMatch') {
      // 「다음 단계 도전」 → the next stage's queue: the finished stage game goes away
      this.leaveGame();
      this.hideAll();
      this.phaseNow = 'expMatch';
      this.match.show(this.netMatchView(m));
      this.startQueueTicker();
      return;
    }
    this.match.update(this.netMatchView(m));
  }

  private startQueueTicker(): void {
    this.stopQueueTicker();
    this.queueTicker = setInterval(() => {
      if (this.phaseNow === 'expMatch' && this.netRun) this.match.update(this.netMatchView(this.lastQueue));
    }, 250);
  }

  private stopQueueTicker(): void {
    if (this.queueTicker) clearInterval(this.queueTicker);
    this.queueTicker = null;
  }

  private onNetCancelled(): void {
    if (!this.netRun) return;
    this.run = null;
    this.online = false;
    this.openHub();
  }

  private onNetStageClear(m: ExpStageClearMsg): void {
    if (!this.run) return;
    this.netClear = m;
    this.run.bag = [...m.bag];
    this.run.cleared += 1;
    if (isBossStage(m.stage)) recordBossClear(this.ctx.stash, m.stage);
    this.ctx.save();
    this.pill?.setBag(this.run.bag, this.family(), this.inspect());
  }

  /** The stage-clear banner plays first, then the choice screen (same timing as solo). */
  private onNetClearShown(s: GameState, now: number): void {
    this.clearHandled = true;
    this.playTime += s.time;
    // the server holds the carry (extractCarry: every floor reward picked this run is carried)
    this.netBuffs = s.players[this.host.localPlayer()]?.rewards.length ?? this.netBuffs;
    this.lastLoot = [...this.netClear!.loot];
    this.choiceAt = now + CHOICE_DELAY_MS;
  }

  private netChoiceDeadline(): number | null {
    const m = this.netClear;
    const conn = this.host.connection();
    return m && conn ? m.deadline - conn.serverOffsetMs : null;
  }

  private netDecide(c: ExpeditionChoice): void {
    if (this.netChosen) return;
    this.netChosen = true;
    if (!this.net!.choose(c)) {
      this.netChosen = false;
      this.ctx.toast('서버와 연결이 끊겼어요 · 다시 연결되면 골라 주세요', 'warn');
    }
  }

  private onNetExtracted(m: ExpExtractedMsg): void {
    const run = this.run;
    const items = m.items;
    // a boss clear while offline never reached onNetStageClear: record it here (no second sure relic)
    for (const st of m.bossClears ?? []) recordBossClear(this.ctx.stash, st);
    if (m.bossClears?.length) this.ctx.save();
    if (!run || !this.online) {
      // a claim settled while this page was away (reconnect): straight into the stash
      if (items.length) {
        for (const g of items) addItems(this.ctx.stash, [g], g.tier);
        this.ctx.save();
        this.ctx.toast(`원정 장비 ${items.length}개를 보관함에 넣었어요`, 'info');
      }
      return;
    }
    run.bag = [...items];
    this.netComplete = m.reason === 'complete';
    this.finishExtract();
  }

  private onNetBagLost(m: ExpBagLostMsg): void {
    const run = this.run;
    if (!run || !this.online) return;
    if (this.playing) return; // the stage game shows the wipe; the app's run-over calls onRunOver
    // lost while queued / between games (abandoned room): the failure screen with what we knew
    this.online = false;
    const lost = [...run.bag];
    failRun(run);
    this.run = null;
    const party = this.ctx.party().characters;
    this.leaveGame();
    this.hideAll();
    this.phaseNow = 'expResult';
    this.result.showFail({ reason: m.reason === 'timeout' ? 'timeout' : m.reason === 'quit' ? 'quit' : 'wipe', stage: m.stage, floor: 3, lost, party, gear: loadoutsFor(this.ctx.stash, party), playTime: this.playTime, family: this.family(), details: [] });
  }

  private onNetError(m: ExpErrorMsg): void {
    if (m.code === 'server_busy') {
      this.ctx.toast(m.message, 'warn');
      return;
    }
    this.ctx.toast(m.message, 'warn');
    if (this.netRun && this.phaseNow === 'expMatch' && !this.lastQueue) this.dropNetRun(null);
  }

  /** The queue join was refused / the link is gone before anything was at stake: back to the hub. */
  private dropNetRun(msg: string | null): void {
    this.run = null;
    this.online = false;
    if (msg) this.ctx.toast(msg, 'warn');
    this.openHub();
  }

  private leaveGame(): void {
    if (this.phaseNow === 'expPlaying' || this.phaseNow === 'expChoice') {
      this.phaseNow = null;
      this.host.stopGame();
    }
    this.pill?.destroy();
    this.pill = null;
    this.pillHud = null;
    this.choiceAt = null;
  }

  /** Floor-reward buffs the run carries (solo: the carry; online: counted from the stage state / the queue seat). */
  private buffsNow(): number {
    return this.netRun ? this.netBuffs : (this.run?.carry?.rewards.length ?? 0);
  }

  /** The party and what it wears now (the run screens compare loot against it). */
  private inspect(): GearInspect {
    const party = this.ctx.party().characters;
    return { party, loadouts: loadoutsFor(this.ctx.stash, party) };
  }

  /** Weapon look of the run's tiles: a character id (TileOpts.family), the party's first. */
  private family(): string | null {
    return this.ctx.party().characters[0] ?? null;
  }
}
