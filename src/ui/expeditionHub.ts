// 기획 15차 원정 허브 (docs/expedition.md 8-2): my party as gear dolls (tap = that character's equip screen), the 4 × 3
// stage map (locked / startable / recommended / selected; boss stages wide with a gold edge) and 「N단계부터 출발」.
// Debug (8-9) opens from DBG: grants, 단계 전부 해금, 보관함 초기화 (두 번 탭), 장비 그림 코드 / 파일.
// 기획 16차: this is the 원정 lobby every stage ends in. With a run in progress (StashData.run, 8-3) the party is locked
// (dolls with a lock and their ult %, 「편성 바꾸기」 refused with the reason, 「버프 N개」 list) and the map gives way to
// the run panel: the 12-stage path, the bag grid (NEW = the stage just cleared), the next-stage card, the red risk line,
// and the two big buttons 「수령」 / 「N단계 매칭」 (a double tap while the bag is at stake). DBG grants / reset are locked.

import { getCharacter, getPet } from '../data';
import { EXPEDITION_STAGES, isBossStage } from '../data/stages';
import { BAND_COLOR, bandOf, type GearSlot } from '../data/gear';
import type { ExpeditionRun } from '../expedition/run';
import {
  RUN_LOCK_REASON,
  canStartAt,
  grantPartySet,
  grantRandom,
  grantRelics,
  grantSet,
  loadoutOf,
  loadoutsFor,
  maxStartStageFor,
  resetStash,
  stashLocked,
} from '../expedition/stash';
import { battleGearFiles, setBattleGearFiles } from '../render/gearArt';
import { sfx } from '../audio';
import { button, h } from './dom';
import type { ExpCtx } from './expeditionCtx';
import { createDoll, slotPips } from './expeditionDoll';
import { buildChipText, buildSummary, renderBuild } from './buildPanel';
import { MAP_LEGEND, bossNameOfStage, buffLines, guardianNameOfStage, nextStageHint, stageLootText, ZONE_NAME_KO } from './expeditionFormat';
import { inspectTiles, type GearInspect } from './expeditionInfo';
import { LootReveal, confirmTap, isArmed, runLobbyView, type RevealView } from './expeditionRun';
import { saveGearArtFiles } from './expeditionStore';
import { petIcon } from './preset';

export interface HubCallbacks {
  onMain(): void;
  onEquip(charId: string | null, slot?: GearSlot): void;
  onPreset(): void;
  onStart(stage: number): void;
  /** 기획 16차: 「수령」 (the bag into the stash, the run ends). */
  onClaim(): void;
  /** 기획 16차: 「N단계 매칭」 (the next stage with the bag at stake). */
  onMatch(): void;
}

export interface Hub {
  readonly el: HTMLElement;
  readonly visible: boolean;
  show(): void;
  hide(): void;
  /** Redraw from the current stash (another tab / a result changed it). */
  refresh(): void;
  /** 기획 16차: the cleared stage's loot flips over the lobby, then pops into the bag grid. */
  reveal(v: RevealView): void;
  /** Stage the start button would use. */
  readonly selected: number;
}

const DEBUG_TIERS = [1, 3, 6, 9, 12];

export function createHub(parent: HTMLElement, ctx: ExpCtx, cb: HubCallbacks): Hub {
  const el = h('div', 'screen exp-hub exp-screen is-hidden', parent);
  const bar = h('div', 'exp-bar', el);
  button('btn btn-secondary exp-back', '← 메인', bar, () => cb.onMain());
  const title = h('div', 'exp-title', bar, '원정');
  const stashChip = button('exp-chip exp-stash-chip', '', bar, () => cb.onEquip(null));
  h('div', 'exp-bar-gap', bar);
  const dbgBtn = button('icon-btn exp-dbg', 'DBG', bar, () => toggleDebug());
  dbgBtn.setAttribute('aria-label', '디버그');

  const main = h('div', 'exp-hub-main', el);
  const left = h('div', 'exp-panel exp-party', main);
  const partyHead = h('div', 'exp-party-head', left);
  h('div', 'exp-panel-title', partyHead, '내 원정대');
  // 기획 16차: the run's carried buffs (tap = the list)
  const buffChip = button('exp-chip exp-buff-chip is-hidden', '', partyHead, () => buffList.classList.toggle('is-hidden'));
  const dollRow = h('div', 'exp-party-dolls', left);
  const petRow = h('div', 'exp-party-pets', left);
  const partyFoot = h('div', 'exp-party-foot', left);
  const editBtn = button('btn btn-secondary exp-edit-party', '편성 바꾸기', partyFoot, () => {
    if (stashLocked(ctx.stash)) {
      ctx.toast(RUN_LOCK_REASON, 'warn');
      sfx.ui('ui.warn');
      return;
    }
    cb.onPreset();
  });
  const lockLine = h('div', 'exp-lock-line is-hidden', left, '🔒 원정 중에는 장비·편성을 못 바꿔요 · 수령하면 바뀝니다');
  const startInfo = h('div', 'exp-start-info', left);
  const hint = button('exp-hint', '', left, () => {
    const hn = currentHint();
    if (hn) cb.onEquip(hn.charId, hn.slot);
  });
  const buffList = h('div', 'exp-buff-list is-hidden', left);
  buffList.addEventListener('click', () => buffList.classList.add('is-hidden'));

  // ── right: the stage map (no run) ──
  const right = h('div', 'exp-panel exp-map', main);
  const mapHead = h('div', 'exp-map-head', right);
  h('div', 'exp-panel-title', mapHead, '단계 지도');
  h('div', 'exp-map-legend', mapHead, MAP_LEGEND);
  const grid = h('div', 'exp-map-grid', right);
  const startBtn = button('btn btn-primary exp-go', '', right, () => {
    const party = ctx.party().characters;
    if (!canStartAt(ctx.stash, party, selected)) {
      ctx.toast(`${selected}단계는 아직 잠겨 있어요`, 'warn');
      return;
    }
    cb.onStart(selected);
  });

  // ── right: the run panel (기획 16차, run in progress) ──
  const runPanel = h('div', 'exp-panel exp-run is-hidden', main);
  const runTitle = h('div', 'exp-run-title', runPanel);
  const pathRow = h('div', 'exp-run-path', runPanel);
  const bagHead = h('div', 'exp-run-baghead', runPanel);
  const bagGrid = h('div', 'exp-run-bag', runPanel);
  const nextCard = h('div', 'exp-run-next', runPanel);
  const riskLine = h('div', 'exp-run-risk', runPanel);
  const waitLine = h('div', 'exp-run-wait is-hidden', runPanel, '지난 단계 결과를 확인하는 중…');
  const runBtns = h('div', 'exp-run-btns', runPanel);
  const claimBtn = button('exp-choice-btn exp-claim', '', runBtns, () => {
    if (ctx.stash.run?.status === 'inStage') return;
    cb.onClaim();
  });
  claimBtn.dataset.sfx = '';
  const matchBtn = button('exp-choice-btn exp-continue exp-next-match', '', runBtns, () => tapMatch());
  matchBtn.dataset.sfx = '';
  let armedAt: number | null = null;
  let armTimer: ReturnType<typeof setTimeout> | null = null;

  const reveal = new LootReveal(el);

  function tapMatch(): void {
    const run = ctx.stash.run;
    if (!run || run.status === 'inStage') return;
    const r = confirmTap(armedAt, performance.now(), run.bag.length > 0);
    armedAt = r.armedAt;
    if (!r.go) {
      sfx.ui('ui.warn');
      renderRun(run);
      if (armTimer) clearTimeout(armTimer);
      // the guard runs out by itself (back to the normal label)
      armTimer = setTimeout(() => {
        armTimer = null;
        if (!isArmed(armedAt, performance.now())) armedAt = null;
        if (visible && ctx.stash.run) renderRun(ctx.stash.run);
      }, 3100);
      return;
    }
    sfx.ui('ui.start');
    cb.onMatch();
  }

  // ── debug drawer ──
  const dbg = h('div', 'exp-dbg-panel is-hidden', el);
  let dbgChar = 0;
  // null = not armed (performance.now() starts near 0 on load: a 0 here would arm the reset for the first 3 s)
  let resetArmed: number | null = null;
  const resetIsArmed = () => resetArmed != null && performance.now() - resetArmed < 3000;
  function buildDebug(): void {
    dbg.replaceChildren();
    const head = h('div', 'exp-dbg-head', dbg);
    h('span', 'exp-dbg-title', head, '원정 디버그');
    button('dbg-hbtn', '✕', head, () => dbg.classList.add('is-hidden'));
    const party = ctx.party().characters;
    // 기획 16차: grants and the reset are locked while a run exists (8-9)
    const locked = stashLocked(ctx.stash);
    if (locked) h('div', 'exp-dbg-note', dbg, '🔒 원정 중에는 장비 지급·초기화가 잠겨요 (수령하면 풀려요)');
    const who = h('div', 'exp-dbg-row', dbg);
    h('span', 'exp-dbg-label', who, '선택 캐릭터');
    party.forEach((id, i) => {
      const b = button(`dbg-btn${i === dbgChar ? ' is-on' : ''}`, getCharacter(id).name, who, () => {
        dbgChar = i;
        buildDebug();
      });
      b.dataset.char = id;
    });
    const grantBtn = (cls: string, label: string, row: HTMLElement, fn: () => void) => {
      const b = button(`dbg-btn ${cls}${locked ? ' is-locked' : ''}`, label, row, () => {
        if (stashLocked(ctx.stash)) {
          ctx.toast(RUN_LOCK_REASON, 'warn');
          return;
        }
        fn();
      });
      return b;
    };
    const one = h('div', 'exp-dbg-row', dbg);
    h('span', 'exp-dbg-label', one, '모든 칸 지급');
    for (const t of DEBUG_TIERS)
      grantBtn('exp-dbg-grant', `T${t}`, one, () => {
        ctx.update(s => grantSet(s, party[dbgChar], t));
        done(`${getCharacter(party[dbgChar]).name} T${t} 한 벌 지급`);
      }).dataset.tier = String(t);
    const all = h('div', 'exp-dbg-row', dbg);
    h('span', 'exp-dbg-label', all, '원정대 3명');
    for (const t of DEBUG_TIERS)
      grantBtn('exp-dbg-party', `T${t}`, all, () => {
        ctx.update(s => grantPartySet(s, party, t));
        done(`원정대 T${t} 한 벌씩 지급`);
      }).dataset.tier = String(t);
    const misc = h('div', 'exp-dbg-row', dbg);
    grantBtn('exp-dbg-random', '무작위 장비 10개', misc, () => {
      ctx.update(s => grantRandom(s, 10));
      done('무작위 장비 10개 지급');
    });
    grantBtn('exp-dbg-relics', '유물 8종 지급', misc, () => {
      ctx.update(s => grantRelics(s, 3));
      done('유물 8종 지급 (T3)');
    });
    const flags = h('div', 'exp-dbg-row', dbg);
    button(`dbg-btn exp-dbg-unlock${ctx.stash.unlockAll ? ' is-on' : ''}`, `단계 전부 해금 ${ctx.stash.unlockAll ? '켬' : '끔'}`, flags, () => {
      const on = ctx.update(s => (s.unlockAll = !s.unlockAll));
      done(on ? '단계 전부 해금 (규칙 무시)' : '단계 해금 규칙 다시 적용');
    });
    const art = battleGearFiles();
    button(`dbg-btn${art ? ' is-on' : ''}`, `장비 그림: ${art ? '파일' : '코드'}`, flags, () => {
      setBattleGearFiles(!art);
      saveGearArtFiles(!art);
      buildDebug();
      ctx.toast(`전투 무기 그림: ${!art ? '파일 (있을 때)' : '코드'}`, 'info');
    });
    const danger = h('div', 'exp-dbg-row', dbg);
    const armed = resetIsArmed();
    grantBtn('exp-dbg-reset', armed ? '한 번 더 누르면 초기화' : '보관함 초기화', danger, () => {
      if (resetIsArmed()) {
        ctx.replace(resetStash);
        resetArmed = null;
        done('보관함을 비웠어요');
        return;
      }
      resetArmed = performance.now();
      buildDebug();
    });
  }
  function done(text: string): void {
    selected = maxStartStageFor(ctx.stash, ctx.party().characters);
    ctx.toast(`디버그: ${text}`, 'good');
    render();
    buildDebug();
  }
  function toggleDebug(): void {
    const open = dbg.classList.contains('is-hidden');
    if (open) buildDebug();
    dbg.classList.toggle('is-hidden', !open);
  }

  let selected = 1;
  let visible = false;
  /** Bag indices to pop in after the reveal closes. */
  let popFrom: number | null = null;

  function currentHint() {
    const party = ctx.party().characters;
    const max = maxStartStageFor(ctx.stash, party);
    return ctx.stash.unlockAll ? null : nextStageHint(party, loadoutsFor(ctx.stash, party), max + 1);
  }

  /** The party the lobby shows: the run's locked party (with its ult charge) or the expedition preset. */
  function partyNow(run: ExpeditionRun | null): { characters: string[]; pets: string[]; gear: ReturnType<typeof loadoutOf>[]; ult: number[] | null } {
    if (run) return { characters: run.lock.characters, pets: run.lock.pets, gear: run.lock.gear, ult: run.carry?.ult ?? [0, 0, 0] };
    const p = ctx.party();
    return { characters: p.characters, pets: p.pets, gear: loadoutsFor(ctx.stash, p.characters), ult: null };
  }

  function inspectNow(run: ExpeditionRun | null): GearInspect {
    const p = partyNow(run);
    return { party: p.characters, loadouts: p.gear };
  }

  function render(): void {
    const run = ctx.stash.run;
    const party = partyNow(run);
    el.classList.toggle('is-run', !!run);
    title.textContent = run ? '원정 로비' : '원정';
    stashChip.textContent = `보관함 ${ctx.stash.items.length}`;
    dollRow.replaceChildren();
    party.characters.forEach((id, i) => {
      const card = button(`exp-party-card${run ? ' is-locked' : ''}`, '', dollRow, () => cb.onEquip(id));
      card.dataset.char = id;
      const l = party.gear[i];
      createDoll(card, '', 130, 160, id, l);
      h('div', 'exp-party-name', card, getCharacter(id).name);
      slotPips(card, l);
      if (party.ult) {
        h('div', 'exp-party-lock', card, '🔒');
        h('div', 'exp-party-ult', card, `궁 ${Math.round((party.ult[i] ?? 0) * 100)}%`);
      }
    });
    petRow.replaceChildren();
    h('span', 'exp-pets-label', petRow, '펫');
    for (const id of party.pets) {
      const p = h('div', 'exp-pet', petRow);
      petIcon(getPet(id), 'pet-icon-xs', p);
      h('span', '', p, getPet(id).name);
    }
    editBtn.classList.toggle('is-locked', !!run);
    editBtn.textContent = run ? '🔒 편성 바꾸기' : '편성 바꾸기';
    lockLine.classList.toggle('is-hidden', !run);
    startInfo.classList.toggle('is-hidden', !!run);
    hint.classList.toggle('is-hidden', !!run);
    right.classList.toggle('is-hidden', !!run);
    runPanel.classList.toggle('is-hidden', !run);
    // 기획 17차: the carried floor rewards as 「내 빌드」 (tags + grouped lines), then the traces
    const carry = run?.carry ?? null;
    const traceLines = run && carry ? buffLines({ ...carry, rewards: [] }, run.lock.characters) : [];
    const build = buildSummary(carry?.rewards ?? [], [], run?.lock.characters ?? [], carry?.rerolls ?? 1);
    const count = build.total + traceLines.length;
    buffChip.classList.toggle('is-hidden', !run);
    buffChip.textContent = `${buildChipText(build, traceLines.length)} ▾`;
    buffList.replaceChildren();
    h('div', 'exp-buff-title', buffList, count ? '들고 가는 버프 · 수령하면 사라져요' : '들고 가는 버프가 없어요 · 일반 단계를 깨면 층 보상 1장');
    if (build.total) renderBuild(h('div', 'exp-buff-build', buffList), build, { title: '층 보상' });
    for (const t of traceLines) h('div', 'exp-buff-row', buffList, t);
    if (!run) buffList.classList.add('is-hidden');
    if (run) renderRun(run);
    else renderNoRun();
  }

  function renderNoRun(): void {
    const max = maxStartStageFor(ctx.stash, ctx.party().characters);
    if (selected > max || selected < 1) selected = max;
    startInfo.textContent = ctx.stash.unlockAll ? `출발 가능: ${EXPEDITION_STAGES}단계까지 (디버그 해금)` : `출발 가능: ${max}단계까지`;
    const hn = currentHint();
    hint.textContent = hn ? `다음 ▶ ${hn.text}` : max >= EXPEDITION_STAGES ? '모든 단계에서 출발할 수 있어요' : '';
    hint.classList.toggle('is-hidden', !hint.textContent);
    renderMap(max);
    startBtn.textContent = `${selected}단계부터 출발`;
  }

  function renderRun(run: ExpeditionRun): void {
    const v = runLobbyView(run);
    runTitle.textContent = v.title;
    pathRow.replaceChildren();
    for (const p of v.path) {
      const d = h('div', `exp-path-dot is-${p.dot}${p.boss ? ' is-boss' : ''}`, pathRow, p.dot === 'done' ? '✓' : p.boss ? '☠' : String(p.stage));
      d.dataset.stage = String(p.stage);
    }
    bagHead.replaceChildren();
    h('span', 'exp-run-bagcount', bagHead, v.bagHead);
    for (const [tier, n] of v.tiers) {
      const chip = h('span', 'exp-risk-chip', bagHead, `T${tier}×${n}`);
      chip.style.setProperty('--bc', BAND_COLOR[bandOf(tier)]);
    }
    bagGrid.replaceChildren();
    const inspect = inspectNow(run);
    const tiles = inspectTiles(bagGrid, el, run.bag, inspect, i => ({ family: run.lock.characters[0] ?? null, isNew: v.isNew[i], size: 96 }));
    if (popFrom != null) tiles.forEach((t, i) => v.isNew[i] && t.classList.add('is-pop'));
    popFrom = null;
    if (!run.bag.length) h('div', 'exp-run-bag-empty', bagGrid, '아직 비어 있어요 · 단계를 깨면 장비가 들어와요');
    nextCard.replaceChildren();
    nextCard.classList.toggle('is-boss', v.nextBoss);
    nextCard.classList.toggle('is-hidden', v.complete);
    h('div', 'exp-run-next-label', nextCard, '다음');
    h('div', 'exp-run-next-line', nextCard, v.nextLine);
    h('div', 'exp-run-next-loot', nextCard, v.nextLoot);
    riskLine.textContent = v.risk;
    riskLine.classList.toggle('is-hidden', v.complete);
    waitLine.classList.toggle('is-hidden', !v.waiting);
    runBtns.classList.toggle('is-waiting', v.waiting);
    claimBtn.replaceChildren();
    h('div', 'exp-exit-icon', claimBtn);
    const ct = h('div', 'exp-choice-text', claimBtn);
    h('div', 'exp-choice-title', ct, '수령');
    h('div', 'exp-choice-sub', ct, v.claimSub);
    matchBtn.replaceChildren();
    matchBtn.classList.toggle('is-hidden', v.complete);
    const armed = isArmed(armedAt, performance.now());
    matchBtn.classList.toggle('is-armed', armed);
    const mt = h('div', 'exp-choice-text', matchBtn);
    h('div', 'exp-choice-title', mt, v.matchTitle);
    h('div', 'exp-choice-sub', mt, armed ? `한 번 더 누르면 매칭 · 가방 ${v.bagCount}개가 걸려요` : v.matchSub);
  }

  function renderMap(max: number): void {
    grid.replaceChildren();
    for (let z = 0; z < 4; z++) {
      const row = h('div', 'exp-map-row', grid);
      h('div', 'exp-map-zone', row, ZONE_NAME_KO[z]);
      for (let k = 0; k < 3; k++) {
        const s = z * 3 + k + 1;
        const boss = isBossStage(s);
        const locked = s > max;
        const cls = ['exp-stage', boss ? 'is-boss' : '', locked ? 'is-locked' : '', !locked && s === max ? 'is-reco' : '', s === selected ? 'is-selected' : ''];
        const c = button(cls.filter(Boolean).join(' '), '', row, () => {
          if (locked) {
            ctx.toast(`${s}단계: 원정대 3명 무기·방어구·장신구 모두 T${s - 1} 이상 필요`, 'warn');
            return;
          }
          selected = s;
          render();
        });
        c.dataset.stage = String(s);
        h('div', 'exp-stage-num', c, String(s));
        const info = h('div', 'exp-stage-info', c);
        // the gold border marks a boss stage; a normal stage names its 수문장 (기획 16차: one floor, the guardian in it; the legend says so)
        h('div', boss ? 'exp-stage-boss' : 'exp-stage-floor', info, boss ? `☠ ${bossNameOfStage(s)}` : guardianNameOfStage(s));
        h('div', 'exp-stage-loot', info, stageLootText(s));
        if (locked) h('div', 'exp-stage-lock', c, `🔒 전원 T${s - 1} 필요`);
      }
    }
  }

  return {
    el,
    get visible() {
      return visible;
    },
    get selected() {
      return selected;
    },
    show() {
      visible = true;
      selected = maxStartStageFor(ctx.stash, ctx.party().characters);
      armedAt = null;
      reveal.hide();
      el.classList.remove('is-hidden');
      render();
      if (!dbg.classList.contains('is-hidden')) buildDebug();
    },
    hide() {
      visible = false;
      reveal.hide();
      buffList.classList.add('is-hidden');
      el.classList.add('is-hidden');
    },
    refresh() {
      if (!visible) return;
      render();
      if (!dbg.classList.contains('is-hidden')) buildDebug();
    },
    reveal(v) {
      reveal.show({ ...v, inspect: v.inspect ?? inspectNow(ctx.stash.run) }, () => {
        popFrom = 0;
        if (visible) render();
      });
    },
  };
}
