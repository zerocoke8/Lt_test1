// 기획 15차 원정 over the network (server/expedition.ts): the stage queue and the stage results on top of a Connection.
// The stage game itself arrives as a normal 'start' (mode 'expedition') + snapshots and is played through RemoteGame
// like a classic game. 기획 16차: the run lives in the browser (StashData.run); this client sends it with every join
// and applies the one expStageResult each stage game produces (matched by run id + stage, so a second delivery after a
// reconnect / expStatus changes nothing). `bootId` tells whether a stage that was running is still known to the server.

import type { GearLoadout } from '../data/gear';
import type { Connection } from './connection';
import type { ExpRunInfo, PresetChoice, ServerMsg } from './protocol';

export type ExpQueueMsg = Extract<ServerMsg, { t: 'expQueueState' }>;
export type ExpStageResultMsg = Extract<ServerMsg, { t: 'expStageResult' }>;
export type ExpErrorMsg = Extract<ServerMsg, { t: 'error' }>;

export interface ExpeditionNetEvents {
  /** My queue changed (seats, countdown, launching). */
  queue?(msg: ExpQueueMsg): void;
  /** I left the queue (expCancel answered). */
  cancelled?(): void;
  /** A stage game of my run is over for me: apply it (applyResult) — also arrives again after a reconnect. */
  result?(msg: ExpStageResultMsg): void;
  /** expStatus answer: the server knows nothing of that run's stage (it restarted) — treat it as void. */
  noStage?(runId: string): void;
  /** 'bad_gear' / 'stage_locked' / 'bad_run' / 'run_busy' / 'server_busy' / other refusals in the expedition flow. */
  error?(msg: ExpErrorMsg): void;
}

export interface ExpJoin {
  stage: number;
  preset: PresetChoice;
  gear: GearLoadout[];
  /** Boss stages already cleared once (stash record). */
  firstBossClears: number[];
  /** Debug 「단계 전부 해금」. */
  debugUnlock?: boolean;
  /** The run (runToJoin), the first stage too; null only for a server-made run id (tests). */
  run: ExpRunInfo | null;
}

const FLOW_ERRORS = new Set<ExpErrorMsg['code']>(['bad_gear', 'stage_locked', 'bad_run', 'run_busy', 'server_busy']);

export class ExpeditionNet {
  /** The latest queue view (null = not queued). */
  queue: ExpQueueMsg | null = null;
  private readonly conn: Connection;
  private readonly ev: ExpeditionNetEvents;
  private readonly unsub: (() => void)[] = [];
  /** expQueue sent, no answer yet: a refusal ('이미 원정 중이에요' …) belongs to the expedition flow. */
  private joining = false;

  constructor(conn: Connection, ev: ExpeditionNetEvents = {}) {
    this.conn = conn;
    this.ev = ev;
    this.unsub.push(
      conn.on('expQueueState', m => {
        this.joining = false;
        this.queue = m;
        this.ev.queue?.(m);
      }),
      conn.on('expCancelled', () => {
        this.queue = null;
        this.ev.cancelled?.();
      }),
      conn.on('start', m => {
        if (m.mode === 'expedition') this.queue = null;
      }),
      conn.on('expStageResult', m => {
        this.queue = null;
        this.ev.result?.(m);
      }),
      conn.on('expNoStage', m => this.ev.noStage?.(m.runId)),
      conn.on('error', m => {
        if (FLOW_ERRORS.has(m.code) || this.joining || this.queue) this.ev.error?.(m);
        this.joining = false;
      }),
    );
  }

  /** The server process the connection last talked to (welcome.bootId; null before the first welcome). */
  get bootId(): string | null {
    return this.conn.bootId;
  }

  /** Join the queue of `stage` with the run. False = not connected. */
  join(j: ExpJoin): boolean {
    this.joining = true;
    const sent = this.conn.send({
      t: 'expQueue',
      stage: j.stage,
      characters: [...j.preset.characters],
      pets: [...j.preset.pets],
      gear: j.gear,
      firstBossClears: [...j.firstBossClears],
      run: j.run,
      ...(j.debugUnlock ? { debugUnlock: true } : null),
    });
    if (!sent) this.joining = false;
    return sent;
  }

  /** Leave the queue (never claims; the run goes back to the lobby). */
  cancel(): boolean {
    return this.conn.send({ t: 'expCancel' });
  }

  /** 「바로 출발 (빈자리 봇)」. */
  startNow(): boolean {
    return this.conn.send({ t: 'expStartNow' });
  }

  /**
   * Ask for the result of the run's `stage` (answer: expStageResult of that stage, or expNoStage when the server has
   * none and the run is not queued / playing there; nothing while it is).
   */
  status(runId: string, stage: number): boolean {
    return this.conn.send({ t: 'expStatus', runId, stage });
  }

  dispose(): void {
    for (const u of this.unsub.splice(0)) u();
  }
}
