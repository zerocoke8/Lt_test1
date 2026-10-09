// 기획 15차 원정 장비 화면 (docs/expedition.md 8-3): characters on the left (party first, the other 12 folded), the big doll
// with its 4 slot tiles in the middle, the shared stash on the right (filters, sort, 5-column grid). Tapping an item
// opens the compare drawer (장착 중 vs 선택, stat deltas, effect, source; 장착 · 해제 · 버리기 두 번 탭). Equipping pops the
// changed part on the doll with a band-coloured ring (weapons swing) and plays 'ui.equip' (higher band = higher pitch).
// 기획 16차: while a run exists (bag not claimed) the screen is read-only (5-4): a 「원정 중 · 읽기만」 strip, the action
// buttons dimmed — a tap says why. Looking (filters, the compare drawer, NEW marks) still works.

import { CHARACTERS, getCharacter } from '../data';
import { BAND_COLOR, GEAR_SLOTS, SLOT_NAME_KO, bandOf, maxStartStage, type GearItem, type GearSlot } from '../data/gear';
import {
  autoEquip,
  discard,
  equip,
  equippedItem,
  isNew,
  itemByUid,
  itemScore,
  loadoutOf,
  loadoutsFor,
  markSeen,
  RUN_LOCK_REASON,
  stashLocked,
  unequip,
  wearerOf,
} from '../expedition/stash';
import { sfx } from '../audio';
import { button, h } from './dom';
import type { ExpCtx } from './expeditionCtx';
import { createDoll, itemTile, slotPips, type Doll } from './expeditionDoll';
import { charStats, compareGear, familyOf, gearCaption, gearLines, gearName, gearSource, isUpgrade, lowestTier } from './expeditionFormat';

export type StashFilter = 'all' | GearSlot | 'new';
export type StashSort = 'tier' | 'new';

export interface EquipScreen {
  readonly el: HTMLElement;
  readonly visible: boolean;
  /** Open on a character (null = the party's first) and optionally a slot filter / the NEW filter. */
  show(charId: string | null, filter?: StashFilter): void;
  hide(): void;
  /** 기획 16차: redraw from the current stash (another tab changed it). */
  refresh(): void;
}

const FILTERS: { id: StashFilter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'weapon', label: '무기' },
  { id: 'armor', label: '방어구' },
  { id: 'charm', label: '장신구' },
  { id: 'relic', label: '유물' },
  { id: 'new', label: 'NEW' },
];

/** Items shown in the stash grid for a character (its own worn pieces live in the slot tiles). Pure. */
export function stashView(items: readonly GearItem[], wornByMe: ReadonlySet<string>, filter: StashFilter, sort: StashSort, seen: readonly string[]): GearItem[] {
  const seenSet = new Set(seen);
  const list = items.filter(i => !wornByMe.has(i.uid) && (filter === 'all' || (filter === 'new' ? !seenSet.has(i.uid) : i.slot === filter)));
  const uidN = (u: string) => Number(/^g(\d+)$/.exec(u)?.[1] ?? 0);
  return list.sort((a, b) => (sort === 'new' ? uidN(b.uid) - uidN(a.uid) : itemScore(b) - itemScore(a)));
}

export function createEquipScreen(parent: HTMLElement, ctx: ExpCtx, cb: { onBack(): void }): EquipScreen {
  const el = h('div', 'screen exp-equip exp-screen is-hidden', parent);
  const bar = h('div', 'exp-bar', el);
  button('btn btn-secondary exp-back', '← 로비', bar, () => cb.onBack());
  h('div', 'exp-title', bar, '장비');
  const countChip = h('div', 'exp-chip', bar);
  // 기획 16차: run in progress → read-only
  const lockStrip = h('div', 'exp-chip exp-readonly is-hidden', bar, '🔒 원정 중 · 읽기만');
  h('div', 'exp-bar-gap', bar);
  const autoBtn = button('btn btn-secondary exp-auto', '최고 등급 자동 장착', bar, () => {
    if (refuseLocked()) return;
    const changed = ctx.update(s => autoEquip(s, ctx.party().characters));
    if (changed.length === 0) ctx.toast('더 좋은 장비가 없어요', 'info');
    else {
      ctx.toast(`${changed.length}개 장착했어요`, 'good');
      const mine = changed.map(u => itemByUid(ctx.stash, u)).filter((i): i is GearItem => !!i && wearerOf(ctx.stash, i.uid) === cur);
      const top = mine.sort((a, b) => b.tier - a.tier)[0];
      if (top) celebrate(top);
    }
    render();
  });

  const main = h('div', 'exp-equip-main', el);
  const list = h('div', 'exp-panel exp-chars', main);
  const center = h('div', 'exp-panel exp-paper', main);
  const stash = h('div', 'exp-panel exp-stash', main);

  // center: doll + 4 slot tiles (armor top-left, weapon top-right, charm bottom-left, relic bottom-right)
  const charName = h('div', 'exp-paper-name', center);
  const dollBox = h('div', 'exp-paper-doll', center);
  const doll: Doll = createDoll(dollBox, 'exp-big-doll', 240, 300, 'blade');
  const slotEls = new Map<GearSlot, HTMLElement>();
  for (const slot of ['armor', 'weapon', 'charm', 'relic'] as GearSlot[]) {
    const s = button(`exp-slot slot-${slot}`, '', dollBox, () => {
      filter = slot;
      const it = equippedItem(ctx.stash, cur, slot);
      pick = it ? it.uid : null;
      if (it) ctx.update(s => markSeen(s, [it.uid]));
      render();
    });
    s.dataset.slot = slot;
    slotEls.set(slot, s);
  }
  const statLine = h('div', 'exp-paper-stats', center);
  const startLine = h('div', 'exp-paper-start', center);

  // right: filters, sort, grid
  const tools = h('div', 'exp-stash-tools', stash);
  const filterRow = h('div', 'exp-filters', tools);
  const sortBtn = button('exp-sort', '', tools, () => {
    sort = sort === 'tier' ? 'new' : 'tier';
    render();
  });
  const grid = h('div', 'exp-grid', stash);
  const empty = h('div', 'exp-empty is-hidden', stash, '보관함이 비었어요 · 원정에서 장비를 가져오세요');

  // compare drawer
  const drawer = h('div', 'exp-drawer is-hidden', el);

  let cur = 'blade';
  let filter: StashFilter = 'all';
  let sort: StashSort = 'tier';
  let pick: string | null = null;
  let discardArmed: { uid: string; at: number } | null = null;
  let othersOpen = false;
  let visible = false;

  /** 기획 16차: a gear action while a run exists → the reason, nothing changes. */
  function refuseLocked(): boolean {
    if (!stashLocked(ctx.stash)) return false;
    ctx.toast(RUN_LOCK_REASON, 'warn');
    sfx.ui('ui.warn');
    return true;
  }

  function celebrate(it: GearItem): void {
    const band = bandOf(it.tier);
    doll.pop(it.slot, band);
    const tile = slotEls.get(it.slot);
    if (tile) {
      tile.classList.remove('is-flash');
      void tile.offsetWidth;
      tile.classList.add('is-flash');
    }
    sfx.ui('ui.equip', { rate: Math.pow(2, (band - 1) / 6) });
  }

  function charRow(id: string, party: boolean): void {
    const l = loadoutOf(ctx.stash, id);
    const def = getCharacter(id);
    const row = button(`exp-char${id === cur ? ' is-current' : ''}${party ? ' is-party' : ''}`, '', list, () => {
      cur = id;
      pick = null;
      render();
    });
    row.dataset.char = id;
    row.style.setProperty('--c', def.color);
    if (party) createDoll(row, 'exp-mini-doll', 64, 80, id, l);
    const info = h('div', 'exp-char-info', row);
    h('div', 'exp-char-name', info, def.name);
    slotPips(info, l);
  }

  function renderList(): void {
    list.replaceChildren();
    const party = ctx.party().characters;
    h('div', 'exp-list-head', list, '원정대');
    for (const id of party) charRow(id, true);
    const others = CHARACTERS.filter(c => !party.includes(c.id));
    button('exp-list-head exp-others-toggle', `다른 캐릭터 ${others.length}명 ${othersOpen ? '▲' : '▼'}`, list, () => {
      othersOpen = !othersOpen;
      renderList();
    });
    if (othersOpen) for (const c of others) charRow(c.id, false);
  }

  function renderPaper(): void {
    const def = getCharacter(cur);
    charName.textContent = def.name;
    charName.style.color = def.color;
    const l = loadoutOf(ctx.stash, cur);
    doll.set(cur, l);
    for (const [slot, s] of slotEls) {
      s.replaceChildren();
      const it = equippedItem(ctx.stash, cur, slot);
      s.classList.toggle('is-empty', !it);
      s.classList.toggle('is-filter', filter === slot);
      if (it) {
        s.style.setProperty('--bc', BAND_COLOR[bandOf(it.tier)]);
        itemTile(s, it, { family: cur, isNew: isNew(ctx.stash, it.uid), size: 92 });
      } else {
        s.style.removeProperty('--bc');
        h('span', 'exp-slot-empty', s, SLOT_NAME_KO[slot]);
      }
    }
    const base = charStats(cur, null);
    const now = charStats(cur, l);
    statLine.textContent = `HP ${base.hp} → ${now.hp} · 공격력 ${base.atk} → ${now.atk}`;
    const party = ctx.party().characters;
    const low = Math.min(...party.map(id => lowestTier(loadoutOf(ctx.stash, id))));
    const max = maxStartStage(loadoutsFor(ctx.stash, party));
    startLine.textContent = stashLocked(ctx.stash)
      ? '원정 중 · 가방 장비는 수령한 뒤에 낄 수 있어요'
      : party.includes(cur)
        ? `원정대 최저 장비 T${low} → ${max}단계부터 출발`
        : '원정대 밖 캐릭터 · 편성에 넣으면 이 장비로 싸워요';
  }

  function renderStash(): void {
    filterRow.replaceChildren();
    const newCount = ctx.stash.items.filter(i => isNew(ctx.stash, i.uid)).length;
    for (const f of FILTERS) {
      if (f.id === 'new' && newCount === 0 && filter !== 'new') continue;
      const b = button(`exp-filter${filter === f.id ? ' is-on' : ''}`, f.label, filterRow, () => {
        filter = f.id;
        render();
      });
      // the count is a badge, so a 2-digit NEW never widens the tab row (labels stay on one line)
      if (f.id === 'new') h('span', 'exp-filter-badge', b, String(newCount));
      b.dataset.filter = f.id;
    }
    sortBtn.textContent = sort === 'tier' ? '등급순' : '새것순';
    countChip.textContent = `보관함 ${ctx.stash.items.length}`;
    const worn = new Set(GEAR_SLOTS.map(s => ctx.stash.equipped[cur]?.[s]).filter((u): u is string => !!u));
    const items = stashView(ctx.stash.items, worn, filter, sort, ctx.stash.seen);
    grid.replaceChildren();
    empty.classList.toggle('is-hidden', items.length > 0);
    for (const it of items) {
      const wornNow = equippedItem(ctx.stash, cur, it.slot);
      itemTile(grid, it, {
        family: cur,
        isNew: isNew(ctx.stash, it.uid),
        upgrade: isUpgrade(it, wornNow),
        wearer: wearerOf(ctx.stash, it.uid),
        selected: pick === it.uid,
        onClick: () => {
          pick = it.uid;
          ctx.update(s => markSeen(s, [it.uid]));
          render();
        },
      });
    }
  }

  function renderDrawer(): void {
    const it = pick ? itemByUid(ctx.stash, pick) : undefined;
    drawer.classList.toggle('is-hidden', !it);
    drawer.replaceChildren();
    if (!it) return;
    const wearer = wearerOf(ctx.stash, it.uid);
    const mine = wearer === cur;
    const worn = mine ? undefined : equippedItem(ctx.stash, cur, it.slot);
    const fam = familyOf(cur);
    const cols = h('div', 'exp-drawer-cols', drawer);
    const card = (title: string, g: GearItem | undefined, cls: string) => {
      const c = h('div', `exp-cmp ${cls}`, cols);
      h('div', 'exp-cmp-title', c, title);
      if (!g) {
        h('div', 'exp-cmp-none', c, '비어 있음');
        return c;
      }
      const top = h('div', 'exp-cmp-top', c);
      itemTile(top, g, { family: cur, size: 84 });
      const t = h('div', 'exp-cmp-names', top);
      const nm = h('div', 'exp-cmp-name', t, gearName(g, fam));
      nm.style.color = BAND_COLOR[bandOf(g.tier)];
      h('div', 'exp-cmp-cap', t, gearCaption(g));
      h('div', 'exp-cmp-src', t, `출처 ${gearSource(g.fromStage)}`);
      const lines = h('div', 'exp-cmp-lines', c);
      for (const line of gearLines(g)) h('div', line.startsWith('✦') ? 'exp-cmp-opt' : 'exp-cmp-line', lines, line);
      return c;
    };
    if (!mine) card('장착 중', worn, 'is-worn');
    const sel = card(mine ? '장착 중' : '선택', it, 'is-pick');
    if (!mine) {
      const deltas = compareGear(it, worn);
      if (deltas.length) {
        const d = h('div', 'exp-cmp-delta', sel);
        for (const x of deltas) h('span', x.diff > 0 ? 'is-up' : 'is-down', d, x.text);
      }
    }
    const btns = h('div', 'exp-drawer-btns', drawer);
    const locked = stashLocked(ctx.stash);
    btns.classList.toggle('is-locked', locked);
    if (locked) h('div', 'exp-drawer-note exp-lock-note', btns, '🔒 수령하면 바꿀 수 있어요');
    else if (wearer && !mine) h('div', 'exp-drawer-note', btns, `${getCharacter(wearer).name}이(가) 끼고 있어요 · 장착하면 옮겨 와요`);
    if (mine)
      button('btn btn-secondary exp-unequip', '해제', btns, () => {
        if (refuseLocked()) return;
        ctx.update(s => unequip(s, cur, it.slot));
        pick = null;
        sfx.ui('ui.back');
        render();
      }).dataset.sfx = '';
    else
      button('btn btn-primary exp-equip-btn', '장착', btns, () => {
        if (refuseLocked()) return;
        const r = ctx.update(s => {
          const res = equip(s, cur, it.uid);
          if (res.ok) markSeen(s, [it.uid]);
          return res;
        });
        if (!r.ok) {
          ctx.toast(r.reason ?? '장착할 수 없어요', 'warn');
          render();
          return;
        }
        pick = null;
        render();
        celebrate(it);
      }).dataset.sfx = '';
    const armed = !locked && discardArmed && discardArmed.uid === it.uid && performance.now() - discardArmed.at < 3000;
    button('btn btn-danger exp-discard', armed ? '한 번 더 누르면 버려요' : '버리기', btns, () => {
      if (refuseLocked()) return;
      if (discardArmed && discardArmed.uid === it.uid && performance.now() - discardArmed.at < 3000) {
        ctx.update(s => discard(s, it.uid));
        discardArmed = null;
        pick = null;
        ctx.toast('버렸어요', 'info');
        render();
        return;
      }
      discardArmed = { uid: it.uid, at: performance.now() };
      renderDrawer();
    });
    button('btn btn-secondary exp-drawer-close', '닫기', btns, () => {
      pick = null;
      render();
    });
  }

  function render(): void {
    const locked = stashLocked(ctx.stash);
    lockStrip.classList.toggle('is-hidden', !locked);
    autoBtn.classList.toggle('is-locked', locked);
    el.classList.toggle('is-readonly', locked);
    renderList();
    renderPaper();
    renderStash();
    renderDrawer();
  }

  return {
    el,
    get visible() {
      return visible;
    },
    show(charId, f) {
      visible = true;
      cur = charId ?? ctx.party().characters[0];
      filter = f ?? 'all';
      pick = null;
      othersOpen = !ctx.party().characters.includes(cur);
      el.classList.remove('is-hidden');
      render();
    },
    hide() {
      visible = false;
      el.classList.add('is-hidden');
    },
    refresh() {
      if (visible) render();
    },
  };
}
