// 결과 화면 (R22): outcome/reason/floor/duration, per-player contribution, tuning log from game.telemetry().

import type { DamageSource, Game, PlayerState, RunResult } from '../types';
import { getCharacter } from '../data';
import { button, h } from './dom';
import { SOURCE_COLOR, SOURCE_LABEL, formatClock, formatNumber, resultReason, resultTitle } from './format';
import { LOCAL_PLAYER } from './hud';

export interface ResultCallbacks {
  onRetry(): void;
  onPreset(): void;
}

type Col = { label: string; get: (p: PlayerState) => number; fmt?: (n: number) => string };

const COLS: Col[] = [
  { label: '딜량', get: p => p.stats.damageDealt },
  { label: '보스 피해', get: p => p.stats.damageToBoss },
  { label: '받은 피해', get: p => p.stats.damageTaken },
  { label: '처치', get: p => p.stats.kills },
  { label: '회복', get: p => p.stats.healing },
  { label: '교체', get: p => p.stats.swaps },
  { label: '궁극기', get: p => p.stats.ultsUsed },
  { label: '펫', get: p => p.stats.petsUsed },
];

export function createResultScreen(parent: HTMLElement, cb: ResultCallbacks): { el: HTMLElement; show(game: Game, quitWhileOut: boolean): void; hide(): void } {
  const el = h('div', 'screen result is-hidden', parent);

  function render(game: Game, quitWhileOut: boolean): void {
    el.replaceChildren();
    const s = game.state;
    const r: RunResult = s.runResult ?? { outcome: 'defeat', reason: 'quit', floorReached: s.floor, duration: s.time };
    el.classList.toggle('is-victory', r.outcome === 'victory');

    const head = h('div', 'rs-head', el);
    h('div', 'rs-title', head, resultTitle(r));
    h('div', 'rs-reason', head, resultReason(r, quitWhileOut, s.plan.kind === 'boss'));
    const facts = h('div', 'rs-facts', head);
    const fact = (k: string, v: string) => {
      const f = h('div', 'rs-fact', facts);
      h('div', 'rs-fact-v', f, v);
      h('div', 'rs-fact-k', f, k);
    };
    fact('도달 층', `${r.floorReached}층`);
    fact('플레이 시간', formatClock(r.duration));
    const me = s.players[LOCAL_PLAYER];
    if (me) fact('보유 유물', `${me.relics.length}개`);

    const body = h('div', 'rs-body', el);

    // contribution
    const left = h('div', 'rs-panel rs-contrib', body);
    h('div', 'rs-panel-title', left, '기여도');
    const table = h('table', 'rs-table', left);
    const thead = h('thead', '', table);
    const hr = h('tr', '', thead);
    h('th', '', hr, '플레이어');
    for (const c of COLS) h('th', '', hr, c.label);
    const tbody = h('tbody', '', table);
    const maxBy = COLS.map(c => Math.max(0, ...s.players.map(c.get)));
    for (const p of s.players) {
      const tr = h('tr', p.id === LOCAL_PLAYER ? 'is-me' : '', tbody);
      const nameCell = h('td', 'rs-pname', tr);
      const dot = h('span', 'rs-dot', nameCell);
      dot.style.background = p.color;
      h('span', '', nameCell, p.id === LOCAL_PLAYER ? '나' : p.name);
      if (p.out) h('span', 'rs-out', nameCell, '사망');
      const party = h('div', 'rs-party', nameCell);
      party.textContent = p.party.map(m => getCharacter(m.defId).name).join(' · ');
      COLS.forEach((c, i) => {
        const v = c.get(p);
        const td = h('td', v > 0 && v === maxBy[i] && c.label !== '받은 피해' ? 'is-best' : '', tr, formatNumber(v));
        if (c.label === '받은 피해' && v > 0 && v === maxBy[i]) td.classList.add('is-most-hit');
      });
    }

    // tuning log
    const t = game.telemetry();
    const right = h('div', 'rs-panel rs-tuning', body);
    h('div', 'rs-panel-title', right, '튜닝 로그 (나)');
    const kv = h('div', 'rs-kv', right);
    const kvRow = (k: string, v: string) => {
      const row = h('div', 'rs-kv-row', kv);
      h('span', 'rs-k', row, k);
      h('span', 'rs-v', row, v);
    };
    kvRow('분당 교체', `${t.swapsPerMinute.toFixed(1)}회`);
    kvRow('궁극기 대기 평균', me && me.stats.ultDelayCount > 0 ? `${t.avgUltDelay.toFixed(1)}초` : '사용 안 함');
    h('div', 'rs-sub', right, '스킬별 피해 비중');
    const bars = h('div', 'rs-bars', right);
    const shares = (Object.keys(t.damageShareBySource) as DamageSource[])
      .map(k => ({ k, v: t.damageShareBySource[k] }))
      .filter(x => x.v > 0.0005)
      .sort((a, b) => b.v - a.v);
    if (!shares.length) h('div', 'rs-empty', bars, '피해 기록 없음');
    for (const { k, v } of shares) {
      const row = h('div', 'rs-bar-row', bars);
      h('span', 'rs-bar-k', row, SOURCE_LABEL[k]);
      const track = h('div', 'rs-bar-track', row);
      const fill = h('div', 'rs-bar-fill', track);
      fill.style.width = `${Math.max(1, v * 100).toFixed(1)}%`;
      fill.style.background = SOURCE_COLOR[k];
      h('span', 'rs-bar-v', row, `${(v * 100).toFixed(1)}%`);
    }
    h('div', 'rs-sub', right, '층별 시간');
    const floors = h('div', 'rs-floors', right);
    const list = [...t.floorTimes];
    if (r.reason === 'quit' && !list.some(f => f.floor === r.floorReached)) list.push({ floor: r.floorReached, seconds: s.floorTime, outcome: 'fail' });
    if (!list.length) h('div', 'rs-empty', floors, '기록 없음');
    for (const f of list) {
      const chip = h('div', `rs-floor ${f.outcome === 'clear' ? 'is-clear' : 'is-fail'}`, floors);
      h('span', 'rs-floor-n', chip, `${f.floor}층`);
      h('span', 'rs-floor-t', chip, `${f.seconds.toFixed(1)}초`);
    }

    const foot = h('div', 'rs-foot', el);
    button('btn btn-secondary', '프리셋으로', foot, () => cb.onPreset());
    button('btn btn-primary', '다시 하기', foot, () => cb.onRetry());
  }

  return {
    el,
    show(game, quitWhileOut) {
      render(game, quitWhileOut);
      el.classList.remove('is-hidden');
    },
    hide() {
      el.classList.add('is-hidden');
      el.replaceChildren();
    },
  };
}
