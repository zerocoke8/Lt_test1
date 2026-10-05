// 프리셋 화면: 캐릭터 15명 중 3명(고른 순서 = 슬롯 1/2/3) + 펫 8마리 중 3마리. 마지막 편성 기억.
// 캐릭터는 역할별 5열 × 3행 카드 (기획 12차: 탱커 / 근접딜러 / 원거리딜러 / 힐러 / 서포터). 카드와 상세 패널에 드래그스킬 형태 미니 도형(모양·방향)을 그림 (3차 1·2).

import type { CharacterDef, PetDef, Role, SkillDef } from '../types';
import { CHARACTERS, PETS, ROLE_LABEL, getCharacter, getPet } from '../data';
import { drawShapeIcon } from '../render/shapeIcon';
import { partsForActions } from '../sim/preview';
import { ROLE_ICON, button, h, replayClass } from './dom';
import { ROLE_GLYPH, basicAttackText } from './format';
import type { PresetSave } from './storage';
import { createToaster } from './toast';
import { ICON_FULLSCREEN } from './dom';
import { toggleFullscreen } from './stage';

export interface PresetScreen {
  readonly el: HTMLElement;
  setVisible(on: boolean): void;
  /** Current (possibly incomplete) selection. */
  value(): PresetSave;
  setDebugNote(text: string): void;
}

export interface PresetScreenOpts {
  initial: PresetSave;
  onStart(p: PresetSave): void;
}

/** Last word's first syllable = the animal ("불꽃 개구리" → "개"). */
export function petGlyph(def: PetDef): string {
  const parts = def.name.split(' ');
  return (parts[parts.length - 1] ?? def.name).charAt(0);
}

export function portrait(def: CharacterDef, cls: string, parent?: HTMLElement | null): HTMLElement {
  const p = h('div', `portrait ${cls}`, parent);
  p.style.setProperty('--c', def.color);
  h('span', 'portrait-glyph', p, ROLE_GLYPH[def.role]);
  return p;
}

export function petIcon(def: PetDef, cls: string, parent?: HTMLElement | null): HTMLElement {
  const p = h('div', `pet-icon ${cls}`, parent);
  p.style.setProperty('--c', def.color);
  h('span', 'pet-glyph', p, petGlyph(def));
  return p;
}

const ROLES: Role[] = ['tank', 'melee', 'ranged', 'healer', 'support'];

/** Mini diagram of a character's drag-skill footprint (shape + fixed direction + drop point). */
export function dragShapeIcon(def: CharacterDef, cls: string, w: number, h: number, parent: HTMLElement, detail = false): HTMLCanvasElement {
  const cv = h_canvas(cls, parent);
  cv.style.width = `${w}px`;
  cv.style.height = `${h}px`;
  drawShapeIcon(cv, partsForActions(def.drag.actions, 1), { width: w, height: h, color: def.color, detail });
  return cv;
}

function h_canvas(cls: string, parent: HTMLElement): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.className = cls;
  parent.appendChild(cv);
  return cv;
}

export function roleTag(def: CharacterDef, parent: HTMLElement): HTMLElement {
  const t = h('span', `role-tag role-${def.role}`, parent);
  const i = h('span', 'role-ico', t);
  i.innerHTML = ROLE_ICON[def.role];
  h('span', '', t, ROLE_LABEL[def.role]);
  return t;
}

export function createPresetScreen(parent: HTMLElement, opts: PresetScreenOpts): PresetScreen {
  let chars = [...opts.initial.characters];
  let pets = [...opts.initial.pets];
  let focus: { kind: 'char' | 'pet'; id: string } = { kind: 'char', id: chars[0] ?? CHARACTERS[0].id };

  const el = h('div', 'screen preset is-hidden', parent);
  const toaster = createToaster(el, 'toasts-preset');

  // header
  const head = h('div', 'ps-head', el);
  const titles = h('div', 'ps-titles', head);
  h('div', 'ps-title', titles, '스왑 타워');
  h('div', 'ps-sub', titles, '출발 전 편성 · 캐릭터 3명과 펫 3마리를 골라 주세요');
  const fs = button('icon-btn', '', head, () => void toggleFullscreen());
  fs.innerHTML = ICON_FULLSCREEN;
  fs.setAttribute('aria-label', '전체 화면');

  const main = h('div', 'ps-main', el);
  const left = h('div', 'ps-left', main);
  const secC = h('div', 'ps-sec', left);
  h('span', 'ps-sec-title', secC, '캐릭터');
  h('span', 'ps-sec-hint', secC, '고른 순서 = 슬롯 · 1번이 먼저 출전 · 도형 = 드래그스킬 범위 · 초 = 재등장 쿨');
  const charGrid = h('div', 'ps-grid ps-grid-chars', left);
  const roleCols = new Map<Role, HTMLElement>();
  for (const role of ROLES) {
    const col = h('div', `ps-col ps-col-${role}`, charGrid);
    const head = h('div', `ps-role-head role-${role}`, col);
    const ic = h('span', 'role-ico', head);
    ic.innerHTML = ROLE_ICON[role];
    h('span', '', head, ROLE_LABEL[role]);
    roleCols.set(role, col);
  }
  const secP = h('div', 'ps-sec', left);
  h('span', 'ps-sec-title', secP, '펫');
  h('span', 'ps-sec-hint', secP, '8마리 중 3마리 · 필드로 끌어 놓으면 발동');
  const petGrid = h('div', 'ps-grid ps-grid-pets', left);
  const detail = h('div', 'ps-detail', main);

  // footer
  const foot = h('div', 'ps-foot', el);
  const slotsBox = h('div', 'ps-slots', foot);
  h('div', 'ps-slots-label', slotsBox, '내 파티');
  const charSlots = h('div', 'ps-slot-row', slotsBox);
  const petSlots = h('div', 'ps-slot-row', slotsBox);
  const footRight = h('div', 'ps-foot-right', foot);
  const debugNote = h('div', 'ps-debug-note', footRight);
  const startBtn = button('btn btn-primary btn-start', '출발', footRight, () => {
    if (chars.length === 3 && pets.length === 3) opts.onStart({ characters: [...chars], pets: [...pets] });
    else {
      toaster.show(chars.length < 3 ? `캐릭터를 ${3 - chars.length}명 더 골라 주세요` : `펫을 ${3 - pets.length}마리 더 골라 주세요`, 'warn');
      replayClass(startBtn, 'shake');
    }
  });

  const charCards = new Map<string, HTMLElement>();
  for (const def of CHARACTERS) {
    const c = button('ps-card ps-char', '', roleCols.get(def.role) ?? charGrid, () => toggleChar(def.id, c));
    c.style.setProperty('--c', def.color);
    c.setAttribute('aria-label', `${def.name} · ${ROLE_LABEL[def.role]} · ${def.drag.name}`);
    portrait(def, 'portrait-sm', c);
    const info = h('div', 'ps-card-info', c);
    h('div', 'ps-card-name', info, def.name);
    const row = h('div', 'ps-card-drag', info);
    dragShapeIcon(def, 'ps-shape', 50, 26, row);
    h('span', 'ps-card-meta', row, `${def.swapCooldown}초`);
    h('div', 'ps-badge', c);
    charCards.set(def.id, c);
  }
  const petCards = new Map<string, HTMLElement>();
  for (const def of PETS) {
    const c = button('ps-card ps-pet', '', petGrid, () => togglePet(def.id, c));
    c.style.setProperty('--c', def.color);
    petIcon(def, 'pet-icon-md', c);
    const info = h('div', 'ps-card-info', c);
    h('div', 'ps-card-name', info, def.name);
    h('div', 'ps-card-meta', info, `쿨 ${def.cooldown}초`);
    h('div', 'ps-badge', c);
    petCards.set(def.id, c);
  }

  function toggleChar(id: string, card: HTMLElement): void {
    focus = { kind: 'char', id };
    const i = chars.indexOf(id);
    if (i >= 0) chars.splice(i, 1);
    else if (chars.length < 3) chars.push(id);
    else {
      toaster.show('캐릭터는 3명까지 · 아래 슬롯을 눌러 빼 주세요', 'warn');
      replayClass(card, 'shake');
    }
    refresh();
  }

  function togglePet(id: string, card: HTMLElement): void {
    focus = { kind: 'pet', id };
    const i = pets.indexOf(id);
    if (i >= 0) pets.splice(i, 1);
    else if (pets.length < 3) pets.push(id);
    else {
      toaster.show('펫은 3마리까지 · 아래 슬롯을 눌러 빼 주세요', 'warn');
      replayClass(card, 'shake');
    }
    refresh();
  }

  function skillRow(parentEl: HTMLElement, slotLabel: string, slotCls: string, name: string, desc: string, meta?: string): HTMLElement {
    const row = h('div', `sk-row sk-${slotCls}`, parentEl);
    const top = h('div', 'sk-top', row);
    h('span', 'sk-slot', top, slotLabel);
    h('span', 'sk-name', top, name);
    if (meta) h('span', 'sk-meta', top, meta);
    h('div', 'sk-desc', row, desc);
    return row;
  }

  function renderDetail(): void {
    detail.replaceChildren();
    if (focus.kind === 'char') {
      const def = getCharacter(focus.id);
      const hd = h('div', 'dt-head', detail);
      portrait(def, 'portrait-lg', hd);
      const t = h('div', 'dt-titles', hd);
      const nm = h('div', 'dt-name', t, def.name);
      nm.style.color = def.color;
      roleTag(def, t);
      const s = def.stats;
      h('div', 'dt-stats', t, `HP ${s.maxHp} · 공격력 ${s.atk} · 사거리 ${s.range}`);
      const list = h('div', 'dt-skills', detail);
      // 드래그스킬 first: it is what the swap game is about (shape + direction diagram)
      const drag = skillRow(list, '드래그스킬', 'drag', def.drag.name, def.drag.description, `나가면 재등장 쿨 ${def.swapCooldown}초`);
      const body = h('div', 'sk-shape-row', drag);
      const fig = h('div', 'sk-shape', body);
      dragShapeIcon(def, 'sk-shape-cv', 132, 74, fig, true);
      h('div', 'sk-shape-cap', fig, '● 놓는 지점');
      body.appendChild(drag.querySelector('.sk-desc')!);
      skillRow(list, '기본평타', 'basic', def.basic.kind === 'melee' ? '근접 공격' : '원거리 공격', basicAttackText(def.basic), `초당 ${s.atkSpeed}회`);
      skillRow(list, '패시브', 'passive', def.passive.name, def.passive.description, '필드에서만');
      const n: SkillDef = def.normal;
      skillRow(list, '일반스킬', 'normal', n.name, n.description, `자동 · 쿨 ${n.cooldown ?? 0}초`);
      skillRow(list, '궁극기', 'ult', def.ult.name, def.ult.description, '게이지 탭');
    } else {
      const def = getPet(focus.id);
      const hd = h('div', 'dt-head', detail);
      petIcon(def, 'pet-icon-lg', hd);
      const t = h('div', 'dt-titles', hd);
      const nm = h('div', 'dt-name', t, def.name);
      nm.style.color = def.color;
      h('div', 'dt-stats', t, `펫 · 쿨타임 ${def.cooldown}초`);
      const list = h('div', 'dt-skills', detail);
      skillRow(list, '펫 기능', 'pet', def.name, def.description, `쿨 ${def.cooldown}초`);
      h('div', 'dt-note', detail, '펫 카드를 필드로 끌어 놓으면 놓은 지점에서 바로 발동해요. 교체가 아니라서 필드 캐릭터는 그대로 있어요.');
    }
  }

  function renderSlots(): void {
    charSlots.replaceChildren();
    for (let i = 0; i < 3; i++) {
      const id = chars[i];
      if (!id) {
        h('div', 'slot-chip is-empty', charSlots, `${i + 1} · 비어 있음`);
        continue;
      }
      const def = getCharacter(id);
      const chip = button('slot-chip', '', charSlots, () => {
        chars = chars.filter(x => x !== id);
        focus = { kind: 'char', id };
        refresh();
      });
      chip.style.setProperty('--c', def.color);
      h('span', 'slot-num', chip, String(i + 1));
      h('span', 'slot-name', chip, def.name);
      if (i === 0) h('span', 'slot-tag', chip, '선발');
    }
    petSlots.replaceChildren();
    for (let i = 0; i < 3; i++) {
      const id = pets[i];
      if (!id) {
        h('div', 'slot-chip is-empty', petSlots, '펫 · 비어 있음');
        continue;
      }
      const def = getPet(id);
      const chip = button('slot-chip slot-pet', '', petSlots, () => {
        pets = pets.filter(x => x !== id);
        focus = { kind: 'pet', id };
        refresh();
      });
      chip.style.setProperty('--c', def.color);
      petIcon(def, 'pet-icon-xs', chip);
      h('span', 'slot-name', chip, def.name);
    }
  }

  function refresh(): void {
    for (const [id, c] of charCards) {
      const i = chars.indexOf(id);
      c.classList.toggle('is-picked', i >= 0);
      c.classList.toggle('is-focus', focus.kind === 'char' && focus.id === id);
      (c.querySelector('.ps-badge') as HTMLElement).textContent = i >= 0 ? String(i + 1) : '';
    }
    for (const [id, c] of petCards) {
      const i = pets.indexOf(id);
      c.classList.toggle('is-picked', i >= 0);
      c.classList.toggle('is-focus', focus.kind === 'pet' && focus.id === id);
      (c.querySelector('.ps-badge') as HTMLElement).textContent = i >= 0 ? '✓' : '';
    }
    renderDetail();
    renderSlots();
    startBtn.classList.toggle('is-disabled', !(chars.length === 3 && pets.length === 3));
  }

  refresh();

  return {
    el,
    setVisible(on) {
      el.classList.toggle('is-hidden', !on);
    },
    value: () => ({ characters: [...chars], pets: [...pets] }),
    setDebugNote(text) {
      debugNote.textContent = text;
      debugNote.classList.toggle('is-hidden', !text);
    },
  };
}
