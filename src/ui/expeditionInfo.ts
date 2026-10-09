// 기획 15차 원정: the read-only item sheet of the run screens (choice reveal + bag, HUD bag preview, fail / extract
// results). Tap a tile → name, slot · tier · stars, stats and effect, and the compare against the party member who
// would wear it (recommendWearers: the weakest slot first). Tap anywhere to close. The equip screen has its own drawer.

import { getCharacter } from '../data';
import { BAND_COLOR, bandOf, type GearLoadout, type GearSpec } from '../data/gear';
import { h } from './dom';
import { itemTile, type TileOpts } from './expeditionDoll';
import { compareGear, familyOf, gearCaption, gearLines, gearName, recommendWearers } from './expeditionFormat';

/** The party a run screen compares its loot against (what each one wears now). */
export interface GearInspect {
  party: readonly string[];
  loadouts: readonly (GearLoadout | null | undefined)[];
}

/** Open the sheet over `host` (absolutely positioned; the host must be a positioned screen). */
export function openGearInfo(host: HTMLElement, g: GearSpec, wearer: string | null, inspect: GearInspect | null): HTMLElement {
  host.querySelector(':scope > .exp-info')?.remove();
  const el = h('div', 'exp-info', host);
  el.addEventListener('click', ev => {
    ev.stopPropagation();
    el.remove();
  });
  const card = h('div', 'exp-info-card', el);
  const top = h('div', 'exp-cmp-top', card);
  const who = wearer ?? inspect?.party[0] ?? null;
  itemTile(top, g, { family: who, size: 110 });
  const names = h('div', 'exp-cmp-names', top);
  const nm = h('div', 'exp-cmp-name', names, gearName(g, familyOf(who)));
  nm.style.color = BAND_COLOR[bandOf(g.tier)];
  h('div', 'exp-cmp-cap', names, gearCaption(g));
  const lines = h('div', 'exp-cmp-lines', card);
  for (const line of gearLines(g)) h('div', line.startsWith('✦') ? 'exp-cmp-opt' : 'exp-cmp-line', lines, line);
  if (inspect) {
    const cmp = h('div', 'exp-info-cmp', card);
    if (wearer) {
      const k = inspect.party.indexOf(wearer);
      const worn = inspect.loadouts[k]?.[g.slot];
      h('div', 'exp-info-reco', cmp, `▲ ${getCharacter(wearer).name}에게 업그레이드`);
      h('div', 'exp-info-now', cmp, `지금 ${worn ? `${gearName(worn, familyOf(wearer))} (T${worn.tier})` : '비어 있음'}`);
      const deltas = compareGear(g, worn);
      if (deltas.length) {
        const d = h('div', 'exp-cmp-delta', cmp);
        for (const x of deltas) h('span', x.diff > 0 ? 'is-up' : 'is-down', d, x.text);
      }
    } else h('div', 'exp-info-now', cmp, '원정대가 낀 장비보다 좋지 않아요');
  }
  h('div', 'exp-info-close', card, '탭해서 닫기');
  return el;
}

/**
 * Item tiles that open the sheet: one call per tile list, so every tile shares one recommendation pass (greedy, one
 * item per character · slot). `opts(i)` adds the per-tile options; ▲ marks an upgrade.
 */
export function inspectTiles(
  parent: HTMLElement,
  host: HTMLElement,
  items: readonly GearSpec[],
  inspect: GearInspect | null,
  opts: (i: number) => TileOpts,
  /** Already chosen wearers (a pass over a longer list whose tiles sit in different parents). */
  given?: readonly (string | null)[],
): HTMLElement[] {
  const wearers = given ?? (inspect ? recommendWearers(items, inspect.party, inspect.loadouts) : items.map(() => null));
  return items.map((g, i) => {
    const o = opts(i);
    // a weapon looks like (and is named for) the one who would wear it, like the sheet and the reveal caption
    const family = wearers[i] ?? o.family;
    return itemTile(parent, g, { ...o, family, upgrade: o.upgrade ?? !!wearers[i], onClick: () => openGearInfo(host, g, wearers[i], inspect) });
  });
}
