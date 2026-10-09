// 기획 15차 원정 over the network (server/expedition.ts): the stage queue, the stage-clear choice and the run results
// on top of a Connection. The stage game itself arrives as a normal 'start' (mode 'expedition') + snapshots and is
// played through RemoteGame like a classic game. The run (bag, carry) is held by the server; this client only shows it
// and puts `expExtracted.items` into the local stash.

import type { ExpeditionChoice } from '../types';
import type { GearLoadout } from '../data/gear';
import type { Connection } from './connection';
import type { PresetChoice, ServerMsg } from './protocol';

export type ExpQueueMsg = Extract<ServerMsg, { t: 'expQueueState' }>;
export type ExpStageClearMsg = Extract<ServerMsg, { t: 'expStageClear' }>;
export type ExpExtractedMsg = Extract<ServerMsg, { t: 'expExtracted' }>;
export type ExpBagLostMsg = Extract<ServerMsg, { t: 'expBagLost' }>;
export type ExpErrorMsg = Extract<ServerMsg, { t: 'error' }>;

export interface ExpeditionNetEvents {
  /** My queue changed (seats, countdown, launching). */
  onQueue?(msg: ExpQueueMsg): void;
  /** Left a queue of a run with nothing to claim. */
  onCancelled?(): void;
  onStageClear?(msg: ExpStageClearMsg): void;
  /** Put `items` into the stash (also arrives after a reconnect when the claim happened offline). */
  onExtracted?(msg: ExpExtractedMsg): void;
  onBagLost?(msg: ExpBagLostMsg): void;
  /** 'bad_gear' / 'stage_locked' / 'server_busy' / other refusals while in the expedition flow. */
  onError?(msg: ExpErrorMsg): void;
}

export interface ExpJoin {
  stage: number;
  preset: PresetChoice;
  gear: GearLoadout[];
  /** Boss stages already cleared once (stash record). */
  firstBossClears: number[];
  /** Debug 「단계 전부 해금」. */
  debugUnlock?: boolean;
}

export class ExpeditionNet {
  /** The latest queue view (null = not queued). */
  queue: ExpQueueMsg | null = null;
  /** The latest stage clear (null after the choice is settled). */
  clear: ExpStageClearMsg | null = null;
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
        this.ev.onQueue?.(m);
      }),
      conn.on('expCancelled', () => {
        this.queue = null;
        this.ev.onCancelled?.();
      }),
      conn.on('start', m => {
        if (m.mode === 'expedition') this.queue = null;
      }),
      conn.on('expStageClear', m => {
        this.clear = m;
        this.ev.onStageClear?.(m);
      }),
      conn.on('expExtracted', m => {
        this.queue = null;
        this.clear = null;
        this.ev.onExtracted?.(m);
      }),
      conn.on('expBagLost', m => {
        this.queue = null;
        this.clear = null;
        this.ev.onBagLost?.(m);
      }),
      conn.on('error', m => {
        if (m.code === 'bad_gear' || m.code === 'stage_locked' || m.code === 'server_busy' || this.joining || this.queue || this.clear) this.ev.onError?.(m);
        this.joining = false;
      }),
    );
  }

  /** Start a run at `stage` (its queue). False = not connected. */
  join(j: ExpJoin): boolean {
    this.joining = true;
    const sent = this.conn.send({
      t: 'expQueue',
      stage: j.stage,
      characters: [...j.preset.characters],
      pets: [...j.preset.pets],
      gear: j.gear,
      firstBossClears: [...j.firstBossClears],
      ...(j.debugUnlock ? { debugUnlock: true } : null),
    });
    if (!sent) this.joining = false;
    return sent;
  }

  /** Leave the queue (a continuing run claims its bag). */
  cancel(): boolean {
    return this.conn.send({ t: 'expCancel' });
  }

  /** 「바로 출발 (빈자리 봇)」. */
  startNow(): boolean {
    return this.conn.send({ t: 'expStartNow' });
  }

  /** 「장비 수령하고 나가기」 / 「다음 단계 도전」. */
  choose(choice: ExpeditionChoice): boolean {
    const ok = this.conn.send({ t: 'expChoice', choice });
    if (ok) this.clear = null;
    return ok;
  }

  dispose(): void {
    for (const u of this.unsub.splice(0)) u();
  }
}
