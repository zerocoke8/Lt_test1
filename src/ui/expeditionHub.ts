// 기획 15차 원정 허브 (docs/expedition.md 8-2): my party as gear dolls (tap = that character's equip screen), the 4 × 3
// stage map (locked / startable / recommended / selected; boss stages wide with a gold edge) and 「N단계부터 출발」.
// Debug (8-9) opens from DBG: grants, 단계 전부 해금, 보관함 초기화 (두 번 탭), 장비 그림 코드 / 파일.

import { getCharacter, getPet } from '../data';
import { EXPEDITION_STAGES, isBossStage } from '../data/stages';
import type { GearSlot } from '../data/gear';
import {
  canStartAt,
  grantPartySet,
  grantRandom,
  grantRelics,
  grantSet,
  loadoutOf,
  loadoutsFor,
  maxStartStageFor,
  resetStash,
} from '../expedition/stash';
import { battleGearFiles, setBattleGearFiles } from '../render/gearArt';
import { button, h } from './dom';
import type { ExpCtx } from './expeditionCtx';
import { createDoll, slotPips, type Doll } from './expeditionDoll';
import { bossNameOfStage, guardianNameOfStage, nextStageHint, stageLootText, ZONE_NAME_KO } from './expeditionFormat';
import { saveGearArtFiles } from './expeditionStore';
import { petIcon } from './preset';

export interface HubCallbacks {
  onMain(): void;
  onEquip(charId: string | null, slot?: GearSlot): void;
  onPreset(): void;
  onStart(stage: number): void;
}

export interface Hub {
  readonly el: HTMLElement;
  readonly visible: boolean;
  show(): void;
  hide(): void;
  /** Stage the start button would use. */
  readonly selected: number;
}

const DEBUG_TIERS = [1, 3, 6, 9, 12];

export function createHub(parent: HTMLElement, ctx: ExpCtx, cb: HubCallbacks): Hub {
  const el = h('div', 'screen exp-hub exp-screen is-hidden', parent);
  const bar = h('div', 'exp-bar', el);
  button('btn btn-secondary exp-back', '← 메인', bar, () => cb.onMain());
  h('div', 'exp-title', bar, '원정');
  const stashChip = button('exp-chip exp-stash-chip', '', bar, () => cb.onEquip(null));
  h('div', 'exp-bar-gap', bar);
  const dbgBtn = button('icon-btn exp-dbg', 'DBG', bar, () => toggleDebug());
  dbgBtn.setAttribute('aria-label', '디버그');

  const main = h('div', 'exp-hub-main', el);
  const left = h('div', 'exp-panel exp-party', main);
  h('div', 'exp-panel-title', left, '내 원정대');
  const dollRow = h('div', 'exp-party-dolls', left);
  const petRow = h('div', 'exp-party-pets', left);
  const partyFoot = h('div', 'exp-party-foot', left);
  button('btn btn-secondary exp-edit-party', '편성 바꾸기', partyFoot, () => cb.onPreset());
  const startInfo = h('div', 'exp-start-info', left);
  const hint = button('exp-hint', '', left, () => {
    const hn = currentHint();
    if (hn) cb.onEquip(hn.charId, hn.slot);
  });

  const right = h('div', 'exp-panel exp-map', main);
  const mapHead = h('div', 'exp-map-head', right);
  h('div', 'exp-panel-title', mapHead, '단계 지도');
  h('div', 'exp-map-legend', mapHead, '단계 = 3층 · 금 테두리 = 보스 단계 (유물 확률)');
  const grid = h('div', 'exp-map-grid', right);
  const startBtn = button('btn btn-primary exp-go', '', right, () => {
    const party = ctx.party().characters;
    if (!canStartAt(ctx.stash, party, selected)) {
      ctx.toast(`${selected}단계는 아직 잠겨 있어요`, 'warn');
      return;
    }
    cb.onStart(selected);
  });

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
    const who = h('div', 'exp-dbg-row', dbg);
    h('span', 'exp-dbg-label', who, '선택 캐릭터');
    party.forEach((id, i) => {
      const b = button(`dbg-btn${i === dbgChar ? ' is-on' : ''}`, getCharacter(id).name, who, () => {
        dbgChar = i;
        buildDebug();
      });
      b.dataset.char = id;
    });
    const one = h('div', 'exp-dbg-row', dbg);
    h('span', 'exp-dbg-label', one, '모든 칸 지급');
    for (const t of DEBUG_TIERS)
      button('dbg-btn exp-dbg-grant', `T${t}`, one, () => {
        grantSet(ctx.stash, party[dbgChar], t);
        done(`${getCharacter(party[dbgChar]).name} T${t} 한 벌 지급`);
      }).dataset.tier = String(t);
    const all = h('div', 'exp-dbg-row', dbg);
    h('span', 'exp-dbg-label', all, '원정대 3명');
    for (const t of DEBUG_TIERS)
      button('dbg-btn exp-dbg-party', `T${t}`, all, () => {
        grantPartySet(ctx.stash, party, t);
        done(`원정대 T${t} 한 벌씩 지급`);
      }).dataset.tier = String(t);
    const misc = h('div', 'exp-dbg-row', dbg);
    button('dbg-btn', '무작위 장비 10개', misc, () => {
      grantRandom(ctx.stash, 10);
      done('무작위 장비 10개 지급');
    });
    button('dbg-btn', '유물 8종 지급', misc, () => {
      grantRelics(ctx.stash, 3);
      done('유물 8종 지급 (T3)');
    });
    const flags = h('div', 'exp-dbg-row', dbg);
    button(`dbg-btn exp-dbg-unlock${ctx.stash.unlockAll ? ' is-on' : ''}`, `단계 전부 해금 ${ctx.stash.unlockAll ? '켬' : '끔'}`, flags, () => {
      ctx.stash.unlockAll = !ctx.stash.unlockAll;
      done(ctx.stash.unlockAll ? '단계 전부 해금 (규칙 무시)' : '단계 해금 규칙 다시 적용');
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
    button('dbg-btn exp-dbg-reset', armed ? '한 번 더 누르면 초기화' : '보관함 초기화', danger, () => {
      if (resetIsArmed()) {
        ctx.replace(resetStash(ctx.stash));
        resetArmed = null;
        done('보관함을 비웠어요');
        return;
      }
      resetArmed = performance.now();
      buildDebug();
    });
  }
  function done(text: string): void {
    ctx.save();
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
  let dolls: Doll[] = [];

  function currentHint() {
    const party = ctx.party().characters;
    const max = maxStartStageFor(ctx.stash, party);
    return ctx.stash.unlockAll ? null : nextStageHint(party, loadoutsFor(ctx.stash, party), max + 1);
  }

  function render(): void {
    const party = ctx.party();
    const max = maxStartStageFor(ctx.stash, party.characters);
    if (selected > max || selected < 1) selected = max;
    stashChip.textContent = `보관함 ${ctx.stash.items.length}`;
    dollRow.replaceChildren();
    dolls = party.characters.map(id => {
      const card = button('exp-party-card', '', dollRow, () => cb.onEquip(id));
      card.dataset.char = id;
      const l = loadoutOf(ctx.stash, id);
      const d = createDoll(card, '', 130, 160, id, l);
      h('div', 'exp-party-name', card, getCharacter(id).name);
      slotPips(card, l);
      return d;
    });
    petRow.replaceChildren();
    h('span', 'exp-pets-label', petRow, '펫');
    for (const id of party.pets) {
      const p = h('div', 'exp-pet', petRow);
      petIcon(getPet(id), 'pet-icon-xs', p);
      h('span', '', p, getPet(id).name);
    }
    startInfo.textContent = ctx.stash.unlockAll ? `출발 가능: ${EXPEDITION_STAGES}단계까지 (디버그 해금)` : `출발 가능: ${max}단계까지`;
    const hn = currentHint();
    hint.textContent = hn ? `다음 ▶ ${hn.text}` : max >= EXPEDITION_STAGES ? '모든 단계에서 출발할 수 있어요' : '';
    hint.classList.toggle('is-hidden', !hint.textContent);
    renderMap(max);
    startBtn.textContent = `${selected}단계부터 출발`;
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
        // the gold border marks a boss stage; the name line says who waits on floor 3
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
      el.classList.remove('is-hidden');
      render();
      if (!dbg.classList.contains('is-hidden')) buildDebug();
    },
    hide() {
      visible = false;
      el.classList.add('is-hidden');
      void dolls;
    },
  };
}
