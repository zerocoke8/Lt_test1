// 기획 8차 괴담 bestiary: procedural, chibi "cute-to-creepy" bodies for every monster look (역류하는 빌딩 — everyday
// things gone wrong). Original designs + public Korean urban legends only. Readable silhouettes at small size; the
// role reads by colour: melee = red accents, ranged = blue/cyan, support = green, exploder = yellow-orange,
// tank = pale beige. Monster ids are the binding content contract; MonsterDef.look keys map onto the same art.
// Pure drawing (no state): poses come in through CREATURE_POSE, set by the renderer around each drawBody call.

import { TAU, pathRoundRect } from './shapes';

export type CreatureShape =
  | 'umbrella'
  | 'shadow_child'
  | 'vending'
  | 'phone'
  | 'mannequin'
  | 'office_ghost'
  | 'copy'
  | 'copy_mini'
  | 'patient'
  | 'wheelchair'
  | 'doll'
  | 'paper_doll'
  | 'eye_stalk'
  | 'red_mask'
  | 'giant_mannequin'
  | 'mourner'
  | 'elevator_girl'
  | 'copier'
  | 'head_nurse'
  | 'signal'
  // 기획 12차: 돌발 괴담 units
  | 'lucky_toad'
  | 'event_printer'
  | 'event_patient'
  | 'night_shadow'
  | 'sleepwalker_child';

export type CreatureRole = 'melee' | 'ranged' | 'support' | 'exploder' | 'tank';

export interface CreatureArt {
  /** Contract name (used when the data has no entry yet). */
  name: string;
  color: string;
  shape: CreatureShape;
  /** Body height as a multiple of its width. */
  heightMul: number;
  ranged: boolean;
  role: CreatureRole;
}

export const ROLE_ACCENT: Record<CreatureRole, string> = {
  melee: '#ff4d5e',
  ranged: '#4cc9f0',
  support: '#52d273',
  exploder: '#ffb703',
  tank: '#e9d8b4',
};

/** Art by monster id (content contract, 기획 8차). */
export const CREATURE_ART: Record<string, CreatureArt> = {
  // ── re-themed originals (ids kept) ──
  slime: { name: '외발 우산', color: '#d6455a', shape: 'umbrella', heightMul: 1.15, ranged: false, role: 'melee' },
  goblin: { name: '그림자 아이', color: '#2a2138', shape: 'shadow_child', heightMul: 1.15, ranged: false, role: 'melee' },
  skeleton_archer: { name: '자판기 미믹', color: '#2f6fb0', shape: 'vending', heightMul: 1.4, ranged: true, role: 'ranged' },
  bomb_bug: { name: '울리는 전화', color: '#f2a71b', shape: 'phone', heightMul: 0.95, ranged: false, role: 'exploder' },
  golem: { name: '웃는 마네킹', color: '#d8c3a0', shape: 'mannequin', heightMul: 1.3, ranged: false, role: 'tank' },
  ogre: { name: '거대 마네킹', color: '#e0c9a4', shape: 'giant_mannequin', heightMul: 1.3, ranged: false, role: 'tank' },
  lich: { name: '검은 조문객', color: '#262230', shape: 'mourner', heightMul: 1.45, ranged: true, role: 'support' },
  // ── new normals ──
  overtime_ghost: { name: '야근 유령', color: '#a9e4f0', shape: 'office_ghost', heightMul: 1.25, ranged: true, role: 'ranged' },
  copy_man: { name: '복사 인간', color: '#d7dbe0', shape: 'copy', heightMul: 1.35, ranged: false, role: 'melee' },
  copy_mini: { name: '복사본', color: '#c9ced6', shape: 'copy_mini', heightMul: 1.3, ranged: false, role: 'melee' },
  iv_zombie: { name: '링거 환자', color: '#9fc9a8', shape: 'patient', heightMul: 1.35, ranged: false, role: 'support' },
  wheelchair_rush: { name: '질주 휠체어', color: '#8f98a3', shape: 'wheelchair', heightMul: 1.05, ranged: false, role: 'melee' },
  nurse_doll: { name: '간호 인형', color: '#f4b6c8', shape: 'doll', heightMul: 1.2, ranged: false, role: 'melee' },
  // 기획 12차: 퍼펫티어's decoy (ally summon) — hanji body + ally outline so it never reads as the pink 간호 인형
  paper_doll: { name: '종이 인형', color: '#f3e9d2', shape: 'paper_doll', heightMul: 1.25, ranged: false, role: 'tank' },
  eye_stalk: { name: '눈알 줄기', color: '#7a4ca8', shape: 'eye_stalk', heightMul: 1.6, ranged: true, role: 'ranged' },
  // 기획 8차 리뷰: was a dark coat as small as 그림자 아이 → a saturated red coat and a taller silhouette
  red_mask: { name: '붉은 마스크', color: '#c1121f', shape: 'red_mask', heightMul: 1.85, ranged: false, role: 'melee' },
  // ── new mid bosses ──
  elevator_girl: { name: '엘리베이터 걸', color: '#b3243b', shape: 'elevator_girl', heightMul: 1.45, ranged: false, role: 'melee' },
  copier_beast: { name: '복사기 괴물', color: '#c9ccd1', shape: 'copier', heightMul: 1.05, ranged: true, role: 'ranged' },
  head_nurse: { name: '수간호사', color: '#eef2f3', shape: 'head_nurse', heightMul: 1.55, ranged: false, role: 'support' },
  signal_man: { name: '신호등 인간', color: '#2c2f36', shape: 'signal', heightMul: 1.5, ranged: false, role: 'melee' },
  // ── 기획 12차: 돌발 괴담 (keyed by MonsterDef.look; the fe_* ids are not in CREATURE_ART) ──
  lucky_toad: { name: '금두꺼비', color: '#ffc93c', shape: 'lucky_toad', heightMul: 0.95, ranged: false, role: 'tank' },
  event_printer: { name: '멈추지 않는 프린터', color: '#d9d4c7', shape: 'event_printer', heightMul: 0.85, ranged: false, role: 'support' },
  event_patient: { name: '잠든 환자', color: '#e9f5ee', shape: 'event_patient', heightMul: 0.75, ranged: false, role: 'support' },
  night_shadow: { name: '퇴근 못 한 그림자', color: '#16131f', shape: 'night_shadow', heightMul: 1.35, ranged: false, role: 'melee' },
  sleepwalker_child: { name: '잠든 아이', color: '#ffd23f', shape: 'sleepwalker_child', heightMul: 1.3, ranged: false, role: 'support' },
};

/** Look keys (MonsterDef.look) and loose synonyms → art id. */
const LOOK_ALIAS: [RegExp, string][] = [
  [/umbrella|우산/, 'slime'],
  [/shadow|그림자/, 'goblin'],
  [/vending|자판기/, 'skeleton_archer'],
  [/phone|전화/, 'bomb_bug'],
  [/giant_?mannequin|거대/, 'ogre'],
  [/mannequin|마네킹/, 'golem'],
  [/mourn|조문/, 'lich'],
  [/overtime|ghost|야근/, 'overtime_ghost'],
  [/copy_?mini|복사본/, 'copy_mini'],
  [/copier|복사기/, 'copier_beast'],
  [/copy|복사/, 'copy_man'],
  [/iv|patient|링거|환자/, 'iv_zombie'],
  [/wheel|휠체어/, 'wheelchair_rush'],
  [/head_?nurse|수간호/, 'head_nurse'],
  [/doll|nurse|인형/, 'nurse_doll'],
  [/eye|stalk|눈알/, 'eye_stalk'],
  [/mask|마스크/, 'red_mask'],
  [/elevator|엘리베이터/, 'elevator_girl'],
  [/signal|traffic|신호/, 'signal_man'],
];

/** Art for a monster: by id first (binding), else by its look key. */
export function creatureArtFor(defId: string, look?: string): CreatureArt | null {
  const byId = CREATURE_ART[defId];
  if (byId) return byId;
  if (look) {
    const k = look.toLowerCase();
    if (CREATURE_ART[k]) return CREATURE_ART[k];
    for (const [re, id] of LOOK_ALIAS) if (re.test(k)) return CREATURE_ART[id];
  }
  return null;
}

/**
 * Pose for the next drawCreature call (set by the renderer around drawBody, reset after):
 * act = 0..1 attack/cast strength (mouths open, arms up), moving = walking/rolling, skill = id of the unit's last
 * monster skill cast (신호등 인간: which light is on).
 */
export const CREATURE_POSE = { act: 0, moving: false, skill: '' };

const OUTLINE = '#120c16';

function lw(ctx: CanvasRenderingContext2D, w: number, k = 0.055): void {
  ctx.lineWidth = Math.max(1.6, Math.min(3.2, w * k));
}

/** Two eyes (white + pupil toward s), optional glow colour instead of white. */
function eyePair(ctx: CanvasRenderingContext2D, cx: number, cy: number, gap: number, r: number, s: number, white: string, pupil: string | null, ry = r * 1.15): void {
  ctx.fillStyle = white;
  ctx.beginPath();
  ctx.ellipse(cx - gap, cy, r, ry, 0, 0, TAU);
  ctx.moveTo(cx + gap + r, cy);
  ctx.ellipse(cx + gap, cy, r, ry, 0, 0, TAU);
  ctx.fill();
  if (!pupil) return;
  ctx.fillStyle = pupil;
  const pr = r * 0.55;
  ctx.beginPath();
  ctx.ellipse(cx - gap + s * r * 0.35, cy + r * 0.1, pr, pr * 1.1, 0, 0, TAU);
  ctx.moveTo(cx + gap + s * r * 0.35 + pr, cy + r * 0.1);
  ctx.ellipse(cx + gap + s * r * 0.35, cy + r * 0.1, pr, pr * 1.1, 0, 0, TAU);
  ctx.fill();
}

/** One big eye with a slit pupil looking toward s (umbrella, stalk). */
function bigEye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, s: number, iris: string, open = 1, slit = true): void {
  const ry = Math.max(0.6, r * 0.9 * open);
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.ellipse(x, y, r + 1.6, ry + 1.6, 0, 0, TAU);
  ctx.fill();
  if (open < 0.15) return;
  ctx.fillStyle = '#fbf5e6';
  ctx.beginPath();
  ctx.ellipse(x, y, r, ry, 0, 0, TAU);
  ctx.fill();
  const ir = Math.min(r, ry) * 0.62;
  const ix = x + s * r * 0.28;
  ctx.fillStyle = iris;
  ctx.beginPath();
  ctx.arc(ix, y, ir, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  if (slit) ctx.ellipse(ix, y, ir * 0.24, ir * 0.85, 0, 0, TAU);
  else ctx.arc(ix, y, ir * 0.45, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.arc(ix - ir * 0.35, y - ir * 0.38, Math.max(1, ir * 0.2), 0, TAU);
  ctx.fill();
}

function blinkOpen(time: number, phase: number, period = 3.4): number {
  const ph = (time + phase * 1.7) % period;
  return ph < 0.14 ? Math.abs(ph - 0.07) / 0.07 : 1;
}

function fillStroke(ctx: CanvasRenderingContext2D, fill: string, w: number, stroke = OUTLINE): void {
  ctx.fillStyle = fill;
  ctx.fill();
  lw(ctx, w);
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

/**
 * Draws a creature standing on (fx, fy): w = drawn width, h = drawn height (px), s = facing (+1 right).
 * `fill` is the body colour (white-ish when hit-flashing).
 */
export function drawCreature(
  ctx: CanvasRenderingContext2D,
  shape: CreatureShape,
  base: string,
  flash: boolean,
  fx: number,
  fy: number,
  w: number,
  h: number,
  s: number,
  time: number,
  phase: number,
): void {
  const fill = flash ? '#fff4f4' : base;
  const act = CREATURE_POSE.act;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (shape) {
    case 'umbrella':
      umbrella(ctx, fill, flash, fx, fy, w, h, s, time, phase, act);
      break;
    case 'shadow_child':
      shadowChild(ctx, fill, flash, fx, fy, w, h, s, time, phase, act);
      break;
    case 'vending':
      vending(ctx, fill, flash, fx, fy, w, h, s, time, phase, act);
      break;
    case 'phone':
      // small hitbox, busy details: drawn a bit larger than its radius so the dial + handset read on a phone
      phoneBody(ctx, fill, flash, fx, fy, w * 1.25, h * 1.25, s, time, phase);
      break;
    case 'mannequin':
      mannequin(ctx, fill, flash, fx, fy, w, h, s, time, phase, act, false);
      break;
    case 'giant_mannequin':
      mannequin(ctx, fill, flash, fx, fy, w, h, s, time, phase, act, true);
      break;
    case 'office_ghost':
      officeGhost(ctx, fill, flash, fx, fy, w, h, s, time, phase, act);
      break;
    case 'copy':
      copyPerson(ctx, fill, flash, fx, fy, w, h, s, time, phase, act, false);
      break;
    case 'copy_mini':
      copyPerson(ctx, fill, flash, fx, fy, w, h, s, time, phase, act, true);
      break;
    case 'patient':
      patient(ctx, fill, flash, fx, fy, w, h, s, time, phase, act);
      break;
    case 'wheelchair':
      wheelchair(ctx, fill, flash, fx, fy, w, h, s, time, phase);
      break;
    case 'doll':
      // 기획 8차 리뷰: tiny (radius 0.35) and lost in piles → drawn 1.3× its hitbox, like the phone
      doll(ctx, fill, flash, fx, fy, w * 1.3, h * 1.3, s, time, phase, act);
      break;
    case 'paper_doll':
      paperDoll(ctx, fill, fx, fy, w * 1.2, h * 1.2, time, phase);
      break;
    case 'eye_stalk':
      eyeStalk(ctx, fill, flash, fx, fy, w, h, s, time, phase, act);
      break;
    case 'red_mask':
      redMask(ctx, fill, flash, fx, fy, w, h, s, time, phase, act);
      break;
    case 'mourner':
      mourner(ctx, fill, flash, fx, fy, w, h, s, time, phase, act);
      break;
    case 'elevator_girl':
      elevatorGirl(ctx, fill, flash, fx, fy, w, h, s, time, phase, act);
      break;
    case 'copier':
      copier(ctx, fill, flash, fx, fy, w, h, s, time, phase, act);
      break;
    case 'head_nurse':
      headNurse(ctx, fill, flash, fx, fy, w, h, s, time, phase, act);
      break;
    case 'signal':
      signalMan(ctx, fill, flash, fx, fy, w, h, s, time, phase, act);
      break;
    // 기획 12차: 돌발 괴담
    case 'lucky_toad':
      luckyToad(ctx, fill, flash, fx, fy, w * 1.15, h * 1.15, s, time, phase, act);
      break;
    case 'event_printer':
      eventPrinter(ctx, fill, flash, fx, fy, w, h, s, time, phase);
      break;
    case 'event_patient':
      eventPatient(ctx, fill, fx, fy, w * 1.7, h * 1.4, s, time, phase);
      break;
    case 'night_shadow':
      nightShadow(ctx, fill, fx, fy, w * 1.1, h * 1.1, s, time, phase, act);
      break;
    case 'sleepwalker_child':
      sleepwalkerChild(ctx, fill, fx, fy, w * 1.25, h * 1.25, s, time, phase);
      break;
  }
  ctx.lineCap = 'butt';
}

/** Height above the foot of the drawn top (px) for overhead bars, given the body height h. */
export function creatureTop(shape: CreatureShape, h: number, w: number): number {
  switch (shape) {
    case 'umbrella':
      return h * 1.12;
    case 'office_ghost':
      return h * 1.1;
    case 'phone':
      return h * 1.3;
    case 'doll':
      return h * 1.3;
    case 'signal':
      return h * 1.3; // the signal box head + room for the mid-boss crown above its red lamp
    case 'elevator_girl':
      return h * 1.03;
    case 'eye_stalk':
      return h * 1.04;
    case 'patient':
      return h * 1.08;
    default:
      return h;
  }
}

// ─────────────────────────── normals ───────────────────────────

/** 외발 우산: a one-eyed paper umbrella hopping on one leg (geta sandal), tongue out. */
function umbrella(ctx: CanvasRenderingContext2D, fill: string, flash: boolean, fx: number, fy: number, w: number, h: number, s: number, time: number, phase: number, act: number): void {
  const hop = Math.max(0, Math.sin(time * 7 + phase)) * h * 0.16 * (CREATURE_POSE.moving ? 1 : 0.35);
  const by = fy - hop;
  const cw = w * 0.66;
  const top = by - h * 1.05;
  const rim = by - h * 0.45;
  // leg + sandal
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(4, w * 0.15);
  ctx.beginPath();
  ctx.moveTo(fx, rim);
  ctx.lineTo(fx + s * w * 0.03, by - h * 0.08);
  ctx.stroke();
  ctx.strokeStyle = flash ? '#fff' : '#f0cfa8';
  ctx.lineWidth = Math.max(2.4, w * 0.1);
  ctx.stroke();
  ctx.fillStyle = '#6b4226';
  ctx.fillRect(fx - w * 0.18 + s * w * 0.04, by - h * 0.09, w * 0.36, h * 0.07);
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(fx - w * 0.12 + s * w * 0.04, by - h * 0.03, w * 0.06, h * 0.03);
  ctx.fillRect(fx + w * 0.08 + s * w * 0.04, by - h * 0.03, w * 0.06, h * 0.03);
  // canopy with scalloped rim
  ctx.beginPath();
  ctx.moveTo(fx - cw, rim);
  ctx.quadraticCurveTo(fx - cw * 0.95, top + h * 0.05, fx, top);
  ctx.quadraticCurveTo(fx + cw * 0.95, top + h * 0.05, fx + cw, rim);
  const n = 4;
  for (let i = n; i > 0; i--) {
    const x1 = fx - cw + ((2 * cw) * (i - 1)) / n;
    const xm = (x1 + fx - cw + ((2 * cw) * i) / n) / 2;
    ctx.quadraticCurveTo(xm, rim - h * 0.1, x1, rim);
  }
  ctx.closePath();
  fillStroke(ctx, fill, w);
  // panels
  if (!flash) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.moveTo(fx, top);
    ctx.quadraticCurveTo(fx - cw * 0.35, rim - h * 0.2, fx - cw * 0.5, rim - h * 0.04);
    ctx.lineTo(fx - cw * 0.05, rim - h * 0.05);
    ctx.closePath();
    ctx.moveTo(fx, top);
    ctx.quadraticCurveTo(fx + cw * 0.6, rim - h * 0.2, fx + cw * 0.55, rim - h * 0.05);
    ctx.lineTo(fx + cw * 0.95, rim - h * 0.02);
    ctx.quadraticCurveTo(fx + cw * 0.85, top + h * 0.1, fx, top);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.ellipse(fx - cw * 0.45, top + h * 0.2, cw * 0.14, h * 0.07, -0.6, 0, TAU);
    ctx.fill();
  }
  // tip
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(fx, top);
  ctx.lineTo(fx, top - h * 0.1);
  ctx.stroke();
  // big eye + tongue
  bigEye(ctx, fx + s * cw * 0.12, top + h * 0.33, w * 0.17, s, '#ffd23f', blinkOpen(time, phase));
  const wag = Math.sin(time * 9 + phase) * w * 0.05;
  ctx.fillStyle = flash ? '#fff' : '#ff6b9a';
  ctx.beginPath();
  ctx.moveTo(fx + s * cw * 0.05 - w * 0.08, rim - h * 0.04);
  ctx.quadraticCurveTo(fx + s * cw * 0.2 + wag, rim + h * (0.18 + 0.12 * act), fx + s * cw * 0.12 + w * 0.09, rim - h * 0.04);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

/** 그림자 아이: a small hooded child of smoke, two glowing eyes, wisps for feet. */
function shadowChild(ctx: CanvasRenderingContext2D, fill: string, flash: boolean, fx: number, fy: number, w: number, h: number, s: number, time: number, phase: number, act: number): void {
  const lean = s * w * 0.08 * (CREATURE_POSE.moving ? 1 : 0.3);
  const headR = w * 0.36;
  const hx = fx + lean;
  const hy = fy - h + headR;
  // body: a hooded cone that frays into wisps
  ctx.beginPath();
  ctx.moveTo(hx - headR * 0.95, hy);
  ctx.quadraticCurveTo(hx - headR, hy - headR * 1.3, hx, hy - headR * 1.12);
  ctx.quadraticCurveTo(hx + headR, hy - headR * 1.3, hx + headR * 0.95, hy);
  ctx.lineTo(fx + w * 0.42, fy - h * 0.18);
  const n = 5;
  for (let i = 0; i <= n; i++) {
    const x = fx + w * 0.42 - (w * 0.84 * i) / n;
    const y = fy - h * 0.05 - (i % 2) * h * 0.12 + Math.sin(time * 8 + phase + i) * h * 0.04;
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  lw(ctx, w);
  ctx.strokeStyle = flash ? '#ffffff' : '#5b4a7a';
  ctx.stroke();
  // hood rim / face hollow
  ctx.fillStyle = flash ? '#ddd' : '#0b0712';
  ctx.beginPath();
  ctx.ellipse(hx + s * headR * 0.15, hy + headR * 0.05, headR * 0.72, headR * 0.62, 0, 0, TAU);
  ctx.fill();
  // eyes: hot red-white glow (melee)
  const ey = hy + headR * 0.02;
  const r = Math.max(2, w * 0.075);
  ctx.globalAlpha *= 0.35;
  ctx.fillStyle = '#ff4d5e';
  ctx.beginPath();
  ctx.arc(hx + s * headR * 0.15 - headR * 0.3, ey, r * 2.2, 0, TAU);
  ctx.arc(hx + s * headR * 0.15 + headR * 0.3, ey, r * 2.2, 0, TAU);
  ctx.fill();
  ctx.globalAlpha /= 0.35;
  ctx.fillStyle = '#ffe3e6';
  ctx.beginPath();
  ctx.ellipse(hx + s * headR * 0.15 - headR * 0.3, ey, r, r * (act > 0.3 ? 0.6 : 1.2), 0, 0, TAU);
  ctx.ellipse(hx + s * headR * 0.15 + headR * 0.3, ey, r, r * (act > 0.3 ? 0.6 : 1.2), 0, 0, TAU);
  ctx.fill();
  // little reaching hand
  ctx.strokeStyle = fill;
  ctx.lineWidth = Math.max(2.5, w * 0.1);
  ctx.beginPath();
  ctx.moveTo(fx + s * w * 0.25, fy - h * 0.45);
  ctx.lineTo(fx + s * w * (0.55 + 0.25 * act), fy - h * (0.5 + 0.1 * act));
  ctx.stroke();
}

/** 자판기 미믹: a vending machine with a toothy dispenser mouth and angry display eyes; throws cans. */
function vending(ctx: CanvasRenderingContext2D, fill: string, flash: boolean, fx: number, fy: number, w: number, h: number, s: number, time: number, phase: number, act: number): void {
  const bw = w * 0.92;
  const x0 = fx - bw / 2;
  const top = fy - h;
  const waddle = CREATURE_POSE.moving ? Math.sin(time * 9 + phase) * 0.06 : 0;
  ctx.save();
  ctx.translate(fx, fy);
  ctx.rotate(waddle);
  ctx.translate(-fx, -fy);
  // stubby feet
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(x0 + bw * 0.12, fy - h * 0.05, bw * 0.18, h * 0.05);
  ctx.fillRect(x0 + bw * 0.7, fy - h * 0.05, bw * 0.18, h * 0.05);
  // side face (depth) on the facing side
  ctx.fillStyle = flash ? '#ddd' : '#1d4a78';
  ctx.beginPath();
  const sx = s > 0 ? x0 + bw : x0;
  ctx.moveTo(sx, top + 3);
  ctx.lineTo(sx + s * bw * 0.16, top + h * 0.06);
  ctx.lineTo(sx + s * bw * 0.16, fy - h * 0.06);
  ctx.lineTo(sx, fy - h * 0.04);
  ctx.closePath();
  ctx.fill();
  pathRoundRect(ctx, x0, top, bw, h * 0.96, Math.max(3, bw * 0.08));
  fillStroke(ctx, fill, w);
  // lit sign strip
  ctx.fillStyle = flash ? '#fff' : '#9df3ff';
  ctx.fillRect(x0 + bw * 0.1, top + h * 0.05, bw * 0.8, h * 0.08);
  // display window with cans
  const wy = top + h * 0.17;
  const wh = h * 0.36;
  ctx.fillStyle = '#0d2238';
  ctx.fillRect(x0 + bw * 0.1, wy, bw * 0.62, wh);
  const cans = ['#ff4d5e', '#ffd166', '#52d273', '#4cc9f0'];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      ctx.fillStyle = cans[(r * 3 + c + Math.floor(phase * 3)) % 4];
      ctx.fillRect(x0 + bw * (0.15 + c * 0.19), wy + wh * (0.12 + r * 0.46), bw * 0.12, wh * 0.32);
    }
  }
  // angry eyes glowing over the display
  const ey = wy + wh * 0.32;
  ctx.fillStyle = '#e8fbff';
  ctx.beginPath();
  ctx.ellipse(x0 + bw * 0.28 + s * 2, ey, bw * 0.09, bw * 0.07, 0, 0, TAU);
  ctx.ellipse(x0 + bw * 0.56 + s * 2, ey, bw * 0.09, bw * 0.07, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#0b1b2b';
  ctx.beginPath();
  ctx.arc(x0 + bw * 0.28 + s * bw * 0.04, ey + 1, bw * 0.04, 0, TAU);
  ctx.arc(x0 + bw * 0.56 + s * bw * 0.04, ey + 1, bw * 0.04, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#0b1b2b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0 + bw * 0.18, ey - bw * 0.1);
  ctx.lineTo(x0 + bw * 0.36, ey - bw * 0.05);
  ctx.moveTo(x0 + bw * 0.66, ey - bw * 0.1);
  ctx.lineTo(x0 + bw * 0.48, ey - bw * 0.05);
  ctx.stroke();
  // buttons
  for (let i = 0; i < 4; i++) {
    const on = Math.sin(time * 5 + i * 1.3 + phase) > 0.4;
    ctx.fillStyle = on ? '#4cc9f0' : '#174064';
    ctx.fillRect(x0 + bw * 0.78, wy + wh * (0.08 + i * 0.23), bw * 0.1, wh * 0.13);
  }
  // dispenser mouth with teeth (opens on attack)
  const my = top + h * 0.62;
  const mh = h * (0.12 + 0.12 * act);
  ctx.fillStyle = '#05080c';
  ctx.fillRect(x0 + bw * 0.14, my, bw * 0.72, mh);
  ctx.fillStyle = '#f5f1e6';
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const tx = x0 + bw * (0.14 + i * 0.144);
    ctx.moveTo(tx, my);
    ctx.lineTo(tx + bw * 0.072, my + mh * 0.45);
    ctx.lineTo(tx + bw * 0.144, my);
    ctx.moveTo(tx, my + mh);
    ctx.lineTo(tx + bw * 0.072, my + mh * 0.55);
    ctx.lineTo(tx + bw * 0.144, my + mh);
  }
  ctx.fill();
  if (act > 0.2) {
    // a can about to fly
    ctx.fillStyle = '#ff4d5e';
    ctx.fillRect(fx + s * bw * 0.2 - 3, my + mh * 0.3, 7, 9);
  }
  ctx.restore();
}

/** 울리는 전화: a yellow rotary payphone scuttling on wire legs, handset jumping, rings in the air. */
function phoneBody(ctx: CanvasRenderingContext2D, fill: string, flash: boolean, fx: number, fy: number, w: number, h: number, s: number, time: number, phase: number): void {
  const jit = Math.sin(time * 70 + phase) * Math.max(1, w * 0.03);
  const cx = fx + jit;
  const by = fy - h * 0.18;
  // wire legs
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const step = Math.sin(time * 20 + phase) * w * 0.1;
  for (const k of [-1, 1]) {
    ctx.moveTo(cx + k * w * 0.25, by);
    ctx.lineTo(cx + k * w * 0.48, fy - h * 0.08 + k * step * 0.3);
    ctx.lineTo(cx + k * w * 0.42 + step * 0.4, fy);
    ctx.moveTo(cx + k * w * 0.1, by);
    ctx.lineTo(cx + k * w * 0.2 - step * 0.3, fy);
  }
  ctx.stroke();
  // base (rounded trapezoid)
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.5, by);
  ctx.lineTo(cx - w * 0.36, by - h * 0.5);
  ctx.quadraticCurveTo(cx, by - h * 0.62, cx + w * 0.36, by - h * 0.5);
  ctx.lineTo(cx + w * 0.5, by);
  ctx.closePath();
  fillStroke(ctx, fill, w);
  // rotary dial
  const dy = by - h * 0.27;
  const dr = w * 0.2;
  ctx.fillStyle = flash ? '#fff' : '#fff4d6';
  ctx.beginPath();
  ctx.arc(cx + s * w * 0.03, dy, dr, 0, TAU);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.fillStyle = '#3a2a10';
  for (let i = 0; i < 8; i++) {
    const a = time * 3 + (i / 8) * TAU;
    ctx.beginPath();
    ctx.arc(cx + s * w * 0.03 + Math.cos(a) * dr * 0.65, dy + Math.sin(a) * dr * 0.65, Math.max(1, dr * 0.14), 0, TAU);
    ctx.fill();
  }
  // handset bouncing on the cradle
  const jump = Math.abs(Math.sin(time * 18 + phase)) * h * 0.12;
  const hy = by - h * 0.62 - jump;
  ctx.lineWidth = Math.max(4, w * 0.14);
  ctx.strokeStyle = OUTLINE;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.42, hy + h * 0.08);
  ctx.quadraticCurveTo(cx, hy - h * 0.12, cx + w * 0.42, hy + h * 0.08);
  ctx.stroke();
  ctx.lineWidth = Math.max(2.5, w * 0.09);
  ctx.strokeStyle = flash ? '#fff' : '#3a2a10';
  ctx.stroke();
  // ring lines + blinking red lamp (it is going to blow)
  const ring = Math.sin(time * 14 + phase) > 0;
  if (ring) {
    ctx.strokeStyle = '#ffe066';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const k of [-1, 1]) {
      ctx.moveTo(cx + k * w * 0.58, hy - h * 0.05);
      ctx.quadraticCurveTo(cx + k * w * 0.7, hy + h * 0.06, cx + k * w * 0.58, hy + h * 0.17);
      ctx.moveTo(cx + k * w * 0.7, hy - h * 0.12);
      ctx.quadraticCurveTo(cx + k * w * 0.86, hy + h * 0.06, cx + k * w * 0.7, hy + h * 0.24);
    }
    ctx.stroke();
  }
  ctx.fillStyle = Math.sin(time * 16 + phase) > 0 ? '#ff3b3b' : '#5a1010';
  ctx.beginPath();
  ctx.arc(cx - s * w * 0.28, by - h * 0.12, Math.max(2, w * 0.07), 0, TAU);
  ctx.fill();
}

/** 웃는 마네킹 (and the giant one): smooth jointed body, no eyes, a painted grin. */
function mannequin(ctx: CanvasRenderingContext2D, fill: string, flash: boolean, fx: number, fy: number, w: number, h: number, s: number, time: number, phase: number, act: number, giant: boolean): void {
  const dark = flash ? '#e8e0d0' : giant ? '#b49b74' : '#a8916c';
  const stiff = CREATURE_POSE.moving ? Math.sin(time * 5 + phase) : 0;
  // legs (stiff columns)
  ctx.fillStyle = dark;
  ctx.strokeStyle = OUTLINE;
  lw(ctx, w);
  for (const k of [-1, 1]) {
    pathRoundRect(ctx, fx + k * w * 0.18 - w * 0.11, fy - h * 0.36 + (k * stiff * h * 0.03), w * 0.22, h * 0.36 - (k * stiff * h * 0.03), w * 0.08);
    ctx.fill();
    ctx.stroke();
  }
  // torso
  const tt = fy - h * 0.8;
  ctx.beginPath();
  ctx.moveTo(fx - w * 0.46, tt + h * 0.06);
  ctx.quadraticCurveTo(fx, tt - h * 0.04, fx + w * 0.46, tt + h * 0.06);
  ctx.lineTo(fx + w * 0.3, fy - h * 0.34);
  ctx.quadraticCurveTo(fx, fy - h * 0.28, fx - w * 0.3, fy - h * 0.34);
  ctx.closePath();
  fillStroke(ctx, fill, w);
  // waist joint
  ctx.strokeStyle = dark;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(fx - w * 0.3, fy - h * 0.46);
  ctx.quadraticCurveTo(fx, fy - h * 0.42, fx + w * 0.3, fy - h * 0.46);
  ctx.stroke();
  // arms: one hangs, the other lifts on attack (slam)
  ctx.lineWidth = Math.max(4, w * 0.15);
  ctx.strokeStyle = OUTLINE;
  const ax = fx + s * w * 0.48;
  const lift = act;
  ctx.beginPath();
  ctx.moveTo(fx - s * w * 0.46, tt + h * 0.1);
  ctx.lineTo(fx - s * w * 0.56, fy - h * 0.38);
  ctx.moveTo(ax, tt + h * 0.1);
  ctx.lineTo(ax + s * w * (0.12 + 0.1 * lift), tt + h * (0.42 - 0.55 * lift));
  ctx.stroke();
  ctx.lineWidth = Math.max(2.5, w * 0.1);
  ctx.strokeStyle = fill;
  ctx.stroke();
  // neck + head (egg, no eyes, grin)
  const hr = w * (giant ? 0.27 : 0.3);
  const hy = tt - hr * 0.95;
  ctx.fillStyle = dark;
  ctx.fillRect(fx - w * 0.06, tt - hr * 0.2, w * 0.12, hr * 0.4);
  ctx.beginPath();
  ctx.ellipse(fx + s * w * 0.02, hy, hr * 0.86, hr, 0, 0, TAU);
  fillStroke(ctx, fill, w);
  // faint eye dents
  ctx.fillStyle = 'rgba(80,60,40,0.35)';
  ctx.beginPath();
  ctx.ellipse(fx + s * hr * 0.15 - hr * 0.32, hy - hr * 0.2, hr * 0.13, hr * 0.08, 0, 0, TAU);
  ctx.ellipse(fx + s * hr * 0.15 + hr * 0.32, hy - hr * 0.2, hr * 0.13, hr * 0.08, 0, 0, TAU);
  ctx.fill();
  // the grin
  const gw = hr * (0.62 + 0.12 * act);
  ctx.fillStyle = flash ? '#fff' : giant ? '#c81d3a' : '#7a1a24';
  ctx.beginPath();
  ctx.moveTo(fx + s * hr * 0.12 - gw, hy + hr * 0.12);
  ctx.quadraticCurveTo(fx + s * hr * 0.12, hy + hr * (0.75 + 0.2 * act), fx + s * hr * 0.12 + gw, hy + hr * 0.12);
  ctx.quadraticCurveTo(fx + s * hr * 0.12, hy + hr * 0.35, fx + s * hr * 0.12 - gw, hy + hr * 0.12);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 5; i++) {
    const tx = fx + s * hr * 0.12 - gw + (2 * gw * i) / 5;
    ctx.moveTo(tx, hy + hr * 0.2);
    ctx.lineTo(tx, hy + hr * 0.42);
  }
  ctx.stroke();
  if (giant) {
    // black bob wig + cracks + a price tag: the window-display mannequin
    ctx.fillStyle = flash ? '#ccc' : '#17131c';
    ctx.beginPath();
    ctx.moveTo(fx - hr * 1.0, hy + hr * 0.25);
    ctx.quadraticCurveTo(fx - hr * 1.15, hy - hr * 1.25, fx, hy - hr * 1.12);
    ctx.quadraticCurveTo(fx + hr * 1.15, hy - hr * 1.25, fx + hr * 1.0, hy + hr * 0.25);
    ctx.lineTo(fx + hr * 0.7, hy - hr * 0.45);
    ctx.quadraticCurveTo(fx, hy - hr * 0.7, fx - hr * 0.7, hy - hr * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,30,20,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(fx - w * 0.2, tt + h * 0.12);
    ctx.lineTo(fx - w * 0.08, tt + h * 0.22);
    ctx.lineTo(fx - w * 0.16, tt + h * 0.3);
    ctx.moveTo(fx + w * 0.15, fy - h * 0.4);
    ctx.lineTo(fx + w * 0.22, fy - h * 0.5);
    ctx.stroke();
    ctx.fillStyle = '#fff4d6';
    ctx.fillRect(fx - s * w * 0.42, tt + h * 0.16, w * 0.16, h * 0.08);
    ctx.fillStyle = '#c81d3a';
    ctx.font = `900 ${Math.max(7, Math.round(w * 0.08))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SALE', fx - s * w * 0.34, tt + h * 0.2);
  }
}

/** 야근 유령: a floating sheet-ghost in a shirt and tie, eye bags, mug of cold coffee. */
function officeGhost(ctx: CanvasRenderingContext2D, fill: string, flash: boolean, fx: number, fy: number, w: number, h: number, s: number, time: number, phase: number, act: number): void {
  const bob = Math.sin(time * 2.4 + phase) * h * 0.06;
  const by = fy - h * 0.12 + bob;
  const top = by - h * 0.95;
  const r = w * 0.48;
  ctx.beginPath();
  ctx.moveTo(fx - r, top + r);
  ctx.arc(fx, top + r, r, Math.PI, 0);
  ctx.lineTo(fx + r * 1.02, by - h * 0.1);
  for (let i = 0; i <= 4; i++) {
    const x = fx + r - (2 * r * i) / 4;
    ctx.quadraticCurveTo(x + r * 0.25, by + h * 0.05 + Math.sin(time * 6 + i + phase) * h * 0.04, x, by - h * 0.06);
  }
  ctx.closePath();
  fillStroke(ctx, fill, w, '#2b5866');
  // shirt collar + tie
  const ny = top + r * 1.35;
  ctx.fillStyle = flash ? '#fff' : '#ffffff';
  ctx.beginPath();
  ctx.moveTo(fx - r * 0.45, ny);
  ctx.lineTo(fx, ny + r * 0.32);
  ctx.lineTo(fx + r * 0.45, ny);
  ctx.lineTo(fx + r * 0.3, ny + r * 0.75);
  ctx.lineTo(fx - r * 0.3, ny + r * 0.75);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = flash ? '#fff' : '#2f6fb0';
  ctx.beginPath();
  ctx.moveTo(fx - r * 0.1, ny + r * 0.25);
  ctx.lineTo(fx + r * 0.1, ny + r * 0.25);
  ctx.lineTo(fx + r * 0.14 + Math.sin(time * 3 + phase) * 2, ny + r * 0.95);
  ctx.lineTo(fx - r * 0.02 + Math.sin(time * 3 + phase) * 2, ny + r * 1.05);
  ctx.closePath();
  ctx.fill();
  // tired eyes with bags (cyan glow when casting)
  const ey = top + r * 0.85;
  ctx.fillStyle = '#6b4a8a';
  ctx.beginPath();
  ctx.ellipse(fx + s * r * 0.15 - r * 0.36, ey + r * 0.16, r * 0.2, r * 0.1, 0, 0, TAU);
  ctx.ellipse(fx + s * r * 0.15 + r * 0.36, ey + r * 0.16, r * 0.2, r * 0.1, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = act > 0.2 ? '#4cc9f0' : '#14232b';
  ctx.beginPath();
  ctx.ellipse(fx + s * r * 0.15 - r * 0.36, ey, r * 0.16, r * (act > 0.2 ? 0.14 : 0.06), 0, 0, TAU);
  ctx.ellipse(fx + s * r * 0.15 + r * 0.36, ey, r * 0.16, r * (act > 0.2 ? 0.14 : 0.06), 0, 0, TAU);
  ctx.fill();
  // mug in a wispy hand
  const mx = fx + s * r * 1.05;
  const my = top + r * 1.6 - act * r * 0.4;
  ctx.fillStyle = flash ? '#fff' : '#f2efe8';
  ctx.fillRect(mx - r * 0.2, my - r * 0.22, r * 0.4, r * 0.42);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(mx - r * 0.2, my - r * 0.22, r * 0.4, r * 0.42);
  ctx.beginPath();
  ctx.arc(mx + s * r * 0.24, my, r * 0.1, -1.2, 1.2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(220,240,255,0.6)';
  ctx.beginPath();
  ctx.moveTo(mx, my - r * 0.3);
  ctx.quadraticCurveTo(mx + Math.sin(time * 4) * 4, my - r * 0.55, mx, my - r * 0.8);
  ctx.stroke();
}

/** 복사 인간 / 복사본: a photocopied person — grey paper body with cyan/magenta misregistration and scan lines. */
function copyPerson(ctx: CanvasRenderingContext2D, fill: string, flash: boolean, fx: number, fy: number, w: number, h: number, s: number, time: number, phase: number, act: number, mini: boolean): void {
  const jerk = Math.sin(time * (mini ? 13 : 9) + phase) > 0.85 ? w * 0.06 : 0;
  const body = (dx: number) => {
    const x = fx + dx + jerk;
    const hr = w * 0.27;
    ctx.beginPath();
    ctx.arc(x, fy - h + hr, hr, 0, TAU);
    ctx.moveTo(x - w * 0.36, fy - h * 0.12);
    ctx.lineTo(x - w * 0.4, fy - h + hr * 2.3);
    ctx.quadraticCurveTo(x, fy - h + hr * 1.9, x + w * 0.4, fy - h + hr * 2.3);
    ctx.lineTo(x + w * 0.36, fy - h * 0.12);
    ctx.lineTo(x + w * 0.14, fy - h * 0.12);
    ctx.lineTo(x + w * 0.1, fy);
    ctx.lineTo(x - w * 0.1, fy);
    ctx.lineTo(x - w * 0.14, fy - h * 0.12);
    ctx.closePath();
  };
  const a0 = ctx.globalAlpha;
  if (mini) ctx.globalAlpha = a0 * 0.85;
  if (!flash) {
    ctx.globalAlpha = a0 * (mini ? 0.45 : 0.6);
    body(-w * 0.07);
    ctx.fillStyle = '#00e5ff';
    ctx.fill();
    body(w * 0.07);
    ctx.fillStyle = '#ff2bd6';
    ctx.fill();
    ctx.globalAlpha = a0 * (mini ? 0.85 : 1);
  }
  body(0);
  fillStroke(ctx, fill, w, '#3a3f47');
  // scan lines + toner smear
  ctx.save();
  body(0);
  ctx.clip();
  ctx.fillStyle = 'rgba(40,44,52,0.22)';
  const off = (time * 30 + phase * 10) % 6;
  for (let y = fy - h + off; y < fy; y += 6) ctx.fillRect(fx - w, y, w * 2, 1.5);
  ctx.fillStyle = 'rgba(20,20,24,0.25)';
  ctx.fillRect(fx - w * 0.5, fy - h * (0.55 + 0.1 * Math.sin(phase)), w, h * 0.06);
  ctx.restore();
  // printed face: two dots and a flat line (a bad copy), mouth opens on attack
  const hy = fy - h + w * 0.27;
  ctx.fillStyle = '#16181c';
  ctx.beginPath();
  ctx.arc(fx + jerk + s * w * 0.06 - w * 0.09, hy - w * 0.02, Math.max(1.3, w * 0.04), 0, TAU);
  ctx.arc(fx + jerk + s * w * 0.06 + w * 0.09, hy - w * 0.02, Math.max(1.3, w * 0.04), 0, TAU);
  ctx.fill();
  ctx.fillRect(fx + jerk + s * w * 0.06 - w * 0.08, hy + w * 0.08, w * 0.16, Math.max(1.3, w * (0.025 + 0.06 * act)));
  if (mini) {
    // folded corner: a copy of a copy
    ctx.fillStyle = '#9aa1ab';
    ctx.beginPath();
    ctx.moveTo(fx + jerk + w * 0.36, fy - h * 0.12);
    ctx.lineTo(fx + jerk + w * 0.36, fy - h * 0.3);
    ctx.lineTo(fx + jerk + w * 0.2, fy - h * 0.12);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = a0;
}

/** 링거 환자: a shambling patient in a gown dragging a glowing IV stand (heals the others). */
function patient(ctx: CanvasRenderingContext2D, fill: string, flash: boolean, fx: number, fy: number, w: number, h: number, s: number, time: number, phase: number, act: number): void {
  const sway = Math.sin(time * 3 + phase) * w * 0.05;
  // IV stand (behind)
  const px = fx - s * w * 0.48;
  ctx.strokeStyle = '#9aa7a0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px, fy);
  ctx.lineTo(px, fy - h * 1.08);
  ctx.moveTo(px - w * 0.14, fy);
  ctx.lineTo(px + w * 0.14, fy);
  ctx.moveTo(px - w * 0.1, fy - h * 1.06);
  ctx.lineTo(px + w * 0.1, fy - h * 1.06);
  ctx.stroke();
  const glow = 0.55 + 0.45 * Math.sin(time * 4 + phase) + act * 0.5;
  ctx.globalAlpha *= 0.3 * Math.min(1, glow);
  ctx.fillStyle = '#52d273';
  ctx.beginPath();
  ctx.arc(px, fy - h * 0.92, w * 0.3, 0, TAU);
  ctx.fill();
  ctx.globalAlpha /= 0.3 * Math.min(1, glow) || 1;
  pathRoundRect(ctx, px - w * 0.12, fy - h * 1.04, w * 0.24, h * 0.24, 3);
  ctx.fillStyle = flash ? '#fff' : '#7dffb3';
  ctx.fill();
  ctx.strokeStyle = '#1d5a3a';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // gown body
  ctx.beginPath();
  ctx.moveTo(fx - w * 0.36 + sway, fy - h * 0.72);
  ctx.lineTo(fx - w * 0.44, fy - h * 0.1);
  ctx.lineTo(fx + w * 0.44, fy - h * 0.1);
  ctx.lineTo(fx + w * 0.36 + sway, fy - h * 0.72);
  ctx.closePath();
  fillStroke(ctx, fill, w, '#2b4434');
  if (!flash) {
    ctx.fillStyle = 'rgba(40,80,60,0.35)';
    for (let i = 0; i < 6; i++) ctx.fillRect(fx - w * 0.3 + (i % 3) * w * 0.22 + sway * 0.5, fy - h * (0.6 - Math.floor(i / 3) * 0.22), w * 0.06, w * 0.06);
  }
  // legs + slippers
  ctx.fillStyle = '#b8c7bc';
  ctx.fillRect(fx - w * 0.22, fy - h * 0.1, w * 0.12, h * 0.1);
  ctx.fillRect(fx + w * 0.1, fy - h * 0.1, w * 0.12, h * 0.1);
  // tube to the arm
  ctx.strokeStyle = 'rgba(160,240,190,0.7)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(px, fy - h * 0.8);
  ctx.quadraticCurveTo(fx - s * w * 0.2, fy - h * 0.35, fx - s * w * 0.32 + sway, fy - h * 0.48);
  ctx.stroke();
  // reaching arm
  ctx.strokeStyle = '#a8b8a8';
  ctx.lineWidth = Math.max(3, w * 0.12);
  ctx.beginPath();
  ctx.moveTo(fx + s * w * 0.3 + sway, fy - h * 0.66);
  ctx.lineTo(fx + s * w * (0.7 + 0.15 * act), fy - h * (0.62 + 0.08 * act));
  ctx.stroke();
  // head: grey-green, bandage, sunken eyes
  const hr = w * 0.27;
  const hx = fx + sway * 1.4 + s * w * 0.04;
  const hy = fy - h * 0.72 - hr * 0.85;
  ctx.beginPath();
  ctx.arc(hx, hy, hr, 0, TAU);
  fillStroke(ctx, flash ? '#fff' : '#b5c4b1', w, '#2b4434');
  ctx.fillStyle = flash ? '#fff' : '#f2f2ea';
  ctx.fillRect(hx - hr, hy - hr * 0.55, hr * 2, hr * 0.35);
  ctx.fillStyle = '#1d2a22';
  ctx.beginPath();
  ctx.ellipse(hx + s * hr * 0.2 - hr * 0.35, hy + hr * 0.1, hr * 0.17, hr * 0.22, 0, 0, TAU);
  ctx.ellipse(hx + s * hr * 0.2 + hr * 0.35, hy + hr * 0.1, hr * 0.17, hr * 0.22, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#c8ffd9';
  ctx.fillRect(hx + s * hr * 0.2 - hr * 0.38, hy + hr * 0.08, 1.6, 1.6);
  ctx.fillRect(hx + s * hr * 0.2 + hr * 0.32, hy + hr * 0.08, 1.6, 1.6);
}

/** 질주 휠체어: an empty wheelchair that rolls by itself (a faint someone in the seat), spokes spinning. */
function wheelchair(ctx: CanvasRenderingContext2D, fill: string, flash: boolean, fx: number, fy: number, w: number, h: number, s: number, time: number, phase: number): void {
  const spin = time * (CREATURE_POSE.moving ? 14 : 3) * s + phase;
  const wr = h * 0.36;
  const wx = fx - s * w * 0.12;
  const wy = fy - wr;
  // frame
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(3.5, w * 0.1);
  const seatY = fy - h * 0.5;
  const draw = () => {
    ctx.beginPath();
    ctx.moveTo(fx - s * w * 0.42, fy - h * 0.98);
    ctx.lineTo(fx - s * w * 0.3, seatY);
    ctx.lineTo(fx + s * w * 0.38, seatY);
    ctx.lineTo(fx + s * w * 0.42, fy - h * 0.16);
    ctx.moveTo(fx + s * w * 0.3, seatY);
    ctx.lineTo(fx + s * w * 0.48, fy - h * 0.3);
    ctx.stroke();
  };
  draw();
  ctx.strokeStyle = flash ? '#fff' : fill;
  ctx.lineWidth = Math.max(2, w * 0.055);
  draw();
  // seat + backrest (red)
  ctx.fillStyle = flash ? '#fff' : '#c0392b';
  pathRoundRect(ctx, fx - s * w * 0.3 - (s > 0 ? 0 : w * 0.66), seatY - h * 0.08, w * 0.66, h * 0.09, 3);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(fx - s * w * 0.42, fy - h * 0.94);
  ctx.lineTo(fx - s * w * 0.32, seatY - h * 0.06);
  ctx.lineTo(fx - s * w * 0.2, seatY - h * 0.06);
  ctx.lineTo(fx - s * w * 0.3, fy - h * 0.94);
  ctx.closePath();
  ctx.fill();
  // the faint passenger
  ctx.globalAlpha *= 0.28;
  ctx.fillStyle = '#d9f2ff';
  ctx.beginPath();
  ctx.ellipse(fx - s * w * 0.08, seatY - h * 0.28, w * 0.18, h * 0.24, 0, 0, TAU);
  ctx.arc(fx - s * w * 0.12, seatY - h * 0.6, w * 0.14, 0, TAU);
  ctx.fill();
  ctx.globalAlpha /= 0.28;
  ctx.fillStyle = '#ff4d5e';
  ctx.fillRect(fx - s * w * 0.12 + s * 2, seatY - h * 0.62, 2, 2);
  ctx.fillRect(fx - s * w * 0.12 + s * 6, seatY - h * 0.62, 2, 2);
  // big wheel with spinning spokes + small caster
  ctx.beginPath();
  ctx.arc(wx, wy, wr, 0, TAU);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(3.5, w * 0.1);
  ctx.stroke();
  ctx.strokeStyle = flash ? '#fff' : '#cfd6dd';
  ctx.lineWidth = Math.max(2, w * 0.05);
  ctx.stroke();
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = spin + (i / 6) * TAU;
    ctx.moveTo(wx, wy);
    ctx.lineTo(wx + Math.cos(a) * wr, wy + Math.sin(a) * wr);
  }
  ctx.stroke();
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.arc(fx + s * w * 0.44, fy - h * 0.08, h * 0.08, 0, TAU);
  ctx.fill();
}

/** 간호 인형: a cracked porcelain nurse doll, button eyes, head tilted, a big syringe. */
/**
 * 기획 12차 종이 인형 (ally decoy): a flat hanji cut-out — round head, button eyes, red cheeks, arms out — with a
 * green ally outline. Sways a little on its paper stand; never attacks.
 */
function paperDoll(ctx: CanvasRenderingContext2D, fill: string, fx: number, fy: number, w: number, h: number, time: number, phase: number): void {
  const sway = Math.sin(time * 2.2 + phase) * 0.06;
  ctx.save();
  ctx.translate(fx, fy);
  ctx.rotate(sway);
  const hr = w * 0.3;
  const top = -h + hr;
  // body: a paper cut-out "person" (arms out, two legs)
  ctx.beginPath();
  ctx.moveTo(-w * 0.12, top + hr * 0.8);
  ctx.lineTo(-w * 0.5, top + hr * 1.35);
  ctx.lineTo(-w * 0.44, top + hr * 1.75);
  ctx.lineTo(-w * 0.16, top + hr * 1.5);
  ctx.lineTo(-w * 0.26, -h * 0.02);
  ctx.lineTo(-w * 0.04, -h * 0.02);
  ctx.lineTo(0, -h * 0.3);
  ctx.lineTo(w * 0.04, -h * 0.02);
  ctx.lineTo(w * 0.26, -h * 0.02);
  ctx.lineTo(w * 0.16, top + hr * 1.5);
  ctx.lineTo(w * 0.44, top + hr * 1.75);
  ctx.lineTo(w * 0.5, top + hr * 1.35);
  ctx.lineTo(w * 0.12, top + hr * 0.8);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  lw(ctx, w, 0.05);
  ctx.strokeStyle = PAPER_ALLY_OUTLINE;
  ctx.stroke();
  // head
  ctx.beginPath();
  ctx.arc(0, top, hr, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();
  // button eyes + red cheeks + a red string knot
  ctx.fillStyle = '#2b2118';
  ctx.beginPath();
  ctx.arc(-hr * 0.38, top - hr * 0.05, Math.max(1.2, hr * 0.13), 0, TAU);
  ctx.arc(hr * 0.38, top - hr * 0.05, Math.max(1.2, hr * 0.13), 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(230, 57, 70, 0.75)';
  ctx.beginPath();
  ctx.ellipse(-hr * 0.55, top + hr * 0.35, hr * 0.2, hr * 0.13, 0, 0, TAU);
  ctx.ellipse(hr * 0.55, top + hr * 0.35, hr * 0.2, hr * 0.13, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#ff5fa2';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-w * 0.1, top + hr * 1.2);
  ctx.lineTo(w * 0.1, top + hr * 1.35);
  ctx.stroke();
  ctx.restore();
}

const PAPER_ALLY_OUTLINE = '#3ddc84';

function doll(ctx: CanvasRenderingContext2D, fill: string, flash: boolean, fx: number, fy: number, w: number, h: number, s: number, time: number, phase: number, act: number): void {
  const tilt = 0.25 * Math.sin(time * 0.8 + phase) + 0.15;
  // dress (pink) + apron
  ctx.beginPath();
  ctx.moveTo(fx - w * 0.16, fy - h * 0.55);
  ctx.lineTo(fx - w * 0.42, fy - h * 0.08);
  ctx.quadraticCurveTo(fx, fy - h * 0.02, fx + w * 0.42, fy - h * 0.08);
  ctx.lineTo(fx + w * 0.16, fy - h * 0.55);
  ctx.closePath();
  fillStroke(ctx, fill, w, '#5a2a3a');
  ctx.fillStyle = flash ? '#fff' : '#ffffff';
  ctx.beginPath();
  ctx.moveTo(fx - w * 0.1, fy - h * 0.48);
  ctx.lineTo(fx - w * 0.22, fy - h * 0.14);
  ctx.lineTo(fx + w * 0.22, fy - h * 0.14);
  ctx.lineTo(fx + w * 0.1, fy - h * 0.48);
  ctx.closePath();
  ctx.fill();
  // stubby legs
  ctx.fillStyle = '#f7e9e4';
  ctx.fillRect(fx - w * 0.18, fy - h * 0.08, w * 0.1, h * 0.08);
  ctx.fillRect(fx + w * 0.08, fy - h * 0.08, w * 0.1, h * 0.08);
  // syringe (raised to stab on attack)
  const sx = fx + s * w * 0.42;
  const sy = fy - h * 0.48;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(s * (-0.6 + 1.6 * act));
  ctx.fillStyle = '#e9eef5';
  ctx.fillRect(-w * 0.06, -h * 0.42, w * 0.12, h * 0.3);
  ctx.fillStyle = '#4cc9f0';
  ctx.fillRect(-w * 0.04, -h * 0.34, w * 0.08, h * 0.2);
  ctx.strokeStyle = '#9aa5b1';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.42);
  ctx.lineTo(0, -h * 0.58);
  ctx.moveTo(-w * 0.08, -h * 0.12);
  ctx.lineTo(w * 0.08, -h * 0.12);
  ctx.stroke();
  ctx.restore();
  // big head, tilted
  const hr = w * 0.33;
  const hx = fx;
  const hy = fy - h + hr;
  ctx.save();
  ctx.translate(hx, hy + hr * 0.6);
  ctx.rotate(tilt * s);
  ctx.translate(-hx, -(hy + hr * 0.6));
  ctx.beginPath();
  ctx.arc(hx, hy, hr, 0, TAU);
  fillStroke(ctx, flash ? '#fff' : '#f7e9e4', w, '#5a2a3a');
  // hair curls
  ctx.fillStyle = '#e8c070';
  ctx.beginPath();
  ctx.arc(hx - hr * 0.85, hy + hr * 0.1, hr * 0.32, 0, TAU);
  ctx.arc(hx + hr * 0.85, hy + hr * 0.1, hr * 0.32, 0, TAU);
  ctx.fill();
  // nurse cap with a cross
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(hx - hr * 0.7, hy - hr * 0.62);
  ctx.lineTo(hx - hr * 0.5, hy - hr * 1.15);
  ctx.lineTo(hx + hr * 0.5, hy - hr * 1.15);
  ctx.lineTo(hx + hr * 0.7, hy - hr * 0.62);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#5a2a3a';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = '#ff4d5e';
  ctx.fillRect(hx - hr * 0.06, hy - hr * 1.05, hr * 0.12, hr * 0.32);
  ctx.fillRect(hx - hr * 0.16, hy - hr * 0.95, hr * 0.32, hr * 0.12);
  // button eyes (one hanging by a thread), crack, blush
  ctx.fillStyle = '#15121a';
  ctx.beginPath();
  ctx.arc(hx + s * hr * 0.12 - hr * 0.36, hy, hr * 0.17, 0, TAU);
  ctx.arc(hx + s * hr * 0.12 + hr * 0.38, hy + hr * 0.28, hr * 0.15, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#15121a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hx + s * hr * 0.12 + hr * 0.36, hy - hr * 0.02);
  ctx.lineTo(hx + s * hr * 0.12 + hr * 0.38, hy + hr * 0.14);
  ctx.moveTo(hx + hr * 0.15, hy - hr * 0.9);
  ctx.lineTo(hx + hr * 0.02, hy - hr * 0.55);
  ctx.lineTo(hx + hr * 0.2, hy - hr * 0.3);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,120,150,0.5)';
  ctx.beginPath();
  ctx.arc(hx - hr * 0.55, hy + hr * 0.35, hr * 0.14, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * 눈알 줄기: an eye on a swaying fleshy stalk growing out of a crack; it sprays from its pupil.
 * (기획 8차 리뷰: it creeps now — 이동 0.6 — dragging its crack along on wriggling roots.)
 */
function eyeStalk(ctx: CanvasRenderingContext2D, fill: string, flash: boolean, fx: number, fy: number, w: number, h: number, s: number, time: number, phase: number, act: number): void {
  const crawl = CREATURE_POSE.moving ? 1 : 0;
  // roots + crack
  ctx.fillStyle = '#120c16';
  ctx.beginPath();
  ctx.ellipse(fx, fy - 1, w * (0.48 + 0.06 * crawl), w * 0.14, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = fill;
  ctx.lineWidth = Math.max(2, w * 0.08);
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI + 0.3 + Math.sin(time * (2 + 9 * crawl) + i * 1.7 + phase) * (0.1 + 0.32 * crawl);
    ctx.moveTo(fx, fy - 3);
    ctx.quadraticCurveTo(fx + Math.cos(a) * w * 0.3, fy - 6, fx + Math.cos(a) * w * 0.55, fy + Math.sin(a) * 2);
  }
  ctx.stroke();
  // stalk: a tapered curve that sways
  const sway = Math.sin(time * 1.8 + phase) * w * 0.18;
  const ex = fx + sway + s * w * 0.08;
  const er = w * 0.36;
  const ey = fy - h + er;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(6, w * 0.3);
  ctx.beginPath();
  ctx.moveTo(fx, fy - 2);
  ctx.quadraticCurveTo(fx - sway * 0.8, fy - h * 0.5, ex, ey + er * 0.6);
  ctx.stroke();
  ctx.strokeStyle = flash ? '#fff' : fill;
  ctx.lineWidth = Math.max(4, w * 0.22);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,170,220,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let k = 0.2; k < 0.9; k += 0.18) {
    const x = fx + (-sway * 0.8 - 0) * 2 * k * (1 - k) + (ex - fx) * k * k;
    const y = fy - 2 + (fy - h * 0.5 - fy) * 2 * k * (1 - k) + (ey + er * 0.6 - fy) * k * k;
    ctx.moveTo(x - w * 0.08, y);
    ctx.lineTo(x + w * 0.08, y + 2);
  }
  ctx.stroke();
  // the eye (cyan iris = ranged), lids, veins
  ctx.fillStyle = flash ? '#fff' : fill;
  ctx.beginPath();
  ctx.ellipse(ex, ey, er * 1.12, er * 1.02, 0, 0, TAU);
  ctx.fill();
  const open = Math.max(blinkOpen(time, phase, 4.2), act);
  bigEye(ctx, ex, ey, er * 0.92, s, '#4cc9f0', open, false);
  if (open > 0.3) {
    ctx.strokeStyle = 'rgba(220,60,90,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ex - er * 0.85, ey - er * 0.1);
    ctx.lineTo(ex - er * 0.55, ey - er * 0.2);
    ctx.lineTo(ex - er * 0.45, ey - er * 0.05);
    ctx.moveTo(ex - er * 0.8, ey + er * 0.35);
    ctx.lineTo(ex - er * 0.5, ey + er * 0.3);
    ctx.stroke();
  }
  if (act > 0.2) {
    ctx.globalAlpha *= 0.4 * act;
    ctx.fillStyle = '#4cc9f0';
    ctx.beginPath();
    ctx.arc(ex + s * er * 0.3, ey, er * 0.9, 0, TAU);
    ctx.fill();
    ctx.globalAlpha /= 0.4 * act;
  }
}

/** 붉은 마스크: a tall woman in a long red coat, black hair, a red-white mask over her mouth, giant scissors. */
function redMask(ctx: CanvasRenderingContext2D, fill: string, flash: boolean, fx: number, fy: number, w: number, h: number, s: number, time: number, phase: number, act: number): void {
  const lean = s * w * 0.1 * (CREATURE_POSE.moving ? 1 : 0.4);
  // coat
  ctx.beginPath();
  ctx.moveTo(fx - w * 0.22 + lean, fy - h * 0.78);
  ctx.lineTo(fx - w * 0.4, fy - h * 0.04);
  ctx.lineTo(fx + w * 0.4, fy - h * 0.04);
  ctx.lineTo(fx + w * 0.22 + lean, fy - h * 0.78);
  ctx.closePath();
  fillStroke(ctx, fill, w, '#0b090e');
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(fx + lean * 0.6, fy - h * 0.74);
  ctx.lineTo(fx + w * 0.02, fy - h * 0.06);
  ctx.moveTo(fx - w * 0.3, fy - h * 0.42);
  ctx.lineTo(fx + w * 0.3, fy - h * 0.42);
  ctx.stroke();
  // legs
  ctx.fillStyle = '#16131b';
  ctx.fillRect(fx - w * 0.16, fy - h * 0.06, w * 0.1, h * 0.06);
  ctx.fillRect(fx + w * 0.06, fy - h * 0.06, w * 0.1, h * 0.06);
  // scissors (open on attack)
  const sx = fx + s * w * 0.42;
  const sy = fy - h * 0.45;
  const open = 0.15 + 0.45 * act;
  ctx.strokeStyle = flash ? '#fff' : '#dfe6ee';
  ctx.lineWidth = Math.max(2.5, w * 0.08);
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + s * w * 0.5 * Math.cos(-open), sy + w * 0.5 * Math.sin(-open) - h * 0.1);
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + s * w * 0.5 * Math.cos(open), sy + w * 0.5 * Math.sin(open) - h * 0.1);
  ctx.stroke();
  ctx.strokeStyle = '#ff4d5e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(sx - s * w * 0.04, sy + w * 0.05, w * 0.06, 0, TAU);
  ctx.arc(sx - s * w * 0.1, sy - w * 0.02, w * 0.06, 0, TAU);
  ctx.stroke();
  // head with long black hair
  const hr = w * 0.26;
  const hx = fx + lean * 1.3;
  const hy = fy - h + hr * 1.1;
  ctx.fillStyle = flash ? '#ccc' : '#0d0b10';
  ctx.beginPath();
  ctx.moveTo(hx - hr * 1.15, hy + hr * 2.4);
  ctx.quadraticCurveTo(hx - hr * 1.4, hy - hr * 1.3, hx, hy - hr * 1.15);
  ctx.quadraticCurveTo(hx + hr * 1.4, hy - hr * 1.3, hx + hr * 1.15, hy + hr * 2.4);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(hx + s * hr * 0.12, hy + hr * 0.1, hr * 0.72, hr * 0.92, 0, 0, TAU);
  ctx.fillStyle = flash ? '#fff' : '#efe6e2';
  ctx.fill();
  // the red mask
  ctx.fillStyle = flash ? '#fff' : '#e5384b';
  pathRoundRect(ctx, hx + s * hr * 0.12 - hr * 0.62, hy + hr * 0.12, hr * 1.24, hr * 0.68, hr * 0.25);
  ctx.fill();
  ctx.strokeStyle = '#7a0f1c';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hx + s * hr * 0.12 - hr * 0.5, hy + hr * 0.36);
  ctx.lineTo(hx + s * hr * 0.12 + hr * 0.5, hy + hr * 0.36);
  ctx.moveTo(hx + s * hr * 0.12 - hr * 0.5, hy + hr * 0.56);
  ctx.lineTo(hx + s * hr * 0.12 + hr * 0.5, hy + hr * 0.56);
  ctx.stroke();
  // sharp eyes
  ctx.fillStyle = act > 0.2 ? '#ff2a3d' : '#1a0a0e';
  ctx.beginPath();
  for (const k of [-1, 1]) {
    const ex = hx + s * hr * 0.2 + k * hr * 0.3;
    ctx.moveTo(ex - hr * 0.2, hy - hr * 0.12);
    ctx.lineTo(ex + hr * 0.2, hy - hr * 0.2 + (k === s ? 0 : 0.04 * hr));
    ctx.lineTo(ex + hr * 0.1, hy - hr * 0.02);
    ctx.closePath();
  }
  ctx.fill();
}

// ─────────────────────────── mid bosses ───────────────────────────

/** 검은 조문객: a veiled mourner in black holding white chrysanthemums. */
function mourner(ctx: CanvasRenderingContext2D, fill: string, flash: boolean, fx: number, fy: number, w: number, h: number, s: number, time: number, phase: number, act: number): void {
  const drift = Math.sin(time * 1.5 + phase) * h * 0.02;
  // long dress
  ctx.beginPath();
  ctx.moveTo(fx - w * 0.2, fy - h * 0.72 + drift);
  ctx.quadraticCurveTo(fx - w * 0.5, fy - h * 0.3, fx - w * 0.56, fy);
  for (let i = 0; i <= 6; i++) ctx.lineTo(fx - w * 0.56 + (w * 1.12 * i) / 6, fy - (i % 2) * h * 0.05 + Math.sin(time * 3 + i) * 1.5);
  ctx.quadraticCurveTo(fx + w * 0.5, fy - h * 0.3, fx + w * 0.2, fy - h * 0.72 + drift);
  ctx.closePath();
  fillStroke(ctx, fill, w, '#000');
  ctx.strokeStyle = 'rgba(150,120,200,0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let k = -2; k <= 2; k++) {
    ctx.moveTo(fx + k * w * 0.08, fy - h * 0.66);
    ctx.lineTo(fx + k * w * 0.18, fy - h * 0.04);
  }
  ctx.stroke();
  // chrysanthemums (white) held in front
  const bx = fx + s * w * 0.22;
  const by = fy - h * 0.52 + drift - act * h * 0.06;
  ctx.strokeStyle = '#3d6b3a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(bx, by + h * 0.2);
  ctx.lineTo(bx - s * w * 0.06, by);
  ctx.moveTo(bx, by + h * 0.2);
  ctx.lineTo(bx + s * w * 0.1, by - h * 0.02);
  ctx.stroke();
  for (const [ox, oy] of [[-0.06, 0], [0.1, -0.02], [0.02, -0.08]]) {
    const cx = bx + s * w * ox;
    const cy = by + h * oy;
    ctx.fillStyle = flash ? '#fff' : '#f4f4ee';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      ctx.moveTo(cx, cy);
      ctx.ellipse(cx + Math.cos(a) * w * 0.05, cy + Math.sin(a) * w * 0.05, w * 0.05, w * 0.018, a, 0, TAU);
    }
    ctx.fill();
    ctx.fillStyle = '#e8d27a';
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.025, 0, TAU);
    ctx.fill();
  }
  // head: wide-brim hat + veil with two pale eyes behind
  const hr = w * 0.22;
  const hx = fx;
  const hy = fy - h * 0.72 - hr + drift;
  ctx.beginPath();
  ctx.arc(hx, hy, hr, 0, TAU);
  ctx.fillStyle = flash ? '#fff' : '#d8d2dc';
  ctx.fill();
  ctx.fillStyle = flash ? '#eee' : '#0b090f';
  ctx.beginPath();
  ctx.ellipse(hx, hy - hr * 0.7, hr * 2.1, hr * 0.42, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(hx, hy - hr * 1.05, hr * 1.0, hr * 0.7, 0, Math.PI, TAU);
  ctx.fill();
  ctx.globalAlpha *= 0.72;
  ctx.beginPath();
  ctx.moveTo(hx - hr * 1.6, hy - hr * 0.6);
  ctx.lineTo(hx + hr * 1.6, hy - hr * 0.6);
  ctx.lineTo(hx + hr * 1.2, hy + hr * 1.5);
  ctx.lineTo(hx - hr * 1.2, hy + hr * 1.5);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha /= 0.72;
  const glow = act > 0.2 ? '#c77dff' : '#e8e0ff';
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(hx + s * hr * 0.2 - hr * 0.35, hy, Math.max(1.6, hr * 0.13), 0, TAU);
  ctx.arc(hx + s * hr * 0.2 + hr * 0.35, hy, Math.max(1.6, hr * 0.13), 0, TAU);
  ctx.fill();
  // black ribbon
  ctx.fillStyle = '#000';
  ctx.fillRect(hx - hr * 0.2 + s * w * 0.25, fy - h * 0.66 + drift, w * 0.08, w * 0.12);
}

/** 엘리베이터 걸: uniform, pillbox hat, gloved hand pointing, no face under the hair; a floor display over her head. */
function elevatorGirl(ctx: CanvasRenderingContext2D, fill: string, flash: boolean, fx: number, fy: number, w: number, h: number, s: number, time: number, phase: number, act: number): void {
  // skirt + legs
  ctx.fillStyle = '#e8d6cc';
  ctx.fillRect(fx - w * 0.14, fy - h * 0.18, w * 0.1, h * 0.18);
  ctx.fillRect(fx + w * 0.04, fy - h * 0.18, w * 0.1, h * 0.18);
  ctx.fillStyle = '#16131b';
  ctx.fillRect(fx - w * 0.16, fy - h * 0.04, w * 0.13, h * 0.04);
  ctx.fillRect(fx + w * 0.03, fy - h * 0.04, w * 0.13, h * 0.04);
  ctx.beginPath();
  ctx.moveTo(fx - w * 0.26, fy - h * 0.5);
  ctx.lineTo(fx - w * 0.3, fy - h * 0.17);
  ctx.lineTo(fx + w * 0.3, fy - h * 0.17);
  ctx.lineTo(fx + w * 0.26, fy - h * 0.5);
  ctx.closePath();
  fillStroke(ctx, flash ? '#fff' : '#7a1426', w, '#2a0610');
  // jacket
  ctx.beginPath();
  ctx.moveTo(fx - w * 0.3, fy - h * 0.78);
  ctx.lineTo(fx - w * 0.28, fy - h * 0.46);
  ctx.lineTo(fx + w * 0.28, fy - h * 0.46);
  ctx.lineTo(fx + w * 0.3, fy - h * 0.78);
  ctx.closePath();
  fillStroke(ctx, fill, w, '#2a0610');
  ctx.fillStyle = '#ffd166';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(fx, fy - h * (0.72 - i * 0.09), Math.max(1.4, w * 0.025), 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(fx - w * 0.3, fy - h * 0.78, w * 0.6, h * 0.02);
  // arms: one at her side, the gloved one points up (or sweeps on attack: "문이 닫힙니다")
  ctx.strokeStyle = fill;
  ctx.lineWidth = Math.max(3.5, w * 0.1);
  ctx.beginPath();
  ctx.moveTo(fx - s * w * 0.3, fy - h * 0.74);
  ctx.lineTo(fx - s * w * 0.36, fy - h * 0.5);
  const ang = -1.2 + act * 1.6;
  const ax = fx + s * w * 0.3;
  const ay = fy - h * 0.74;
  const ex = ax + s * Math.cos(ang) * w * 0.42;
  const ey = ay + Math.sin(ang) * w * 0.42;
  ctx.moveTo(ax, ay);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(ex, ey, Math.max(2.5, w * 0.06), 0, TAU);
  ctx.arc(fx - s * w * 0.36, fy - h * 0.5, Math.max(2.5, w * 0.06), 0, TAU);
  ctx.fill();
  // head: hair falling over a blank face, pillbox hat
  const hr = w * 0.22;
  const hx = fx + s * w * 0.02;
  const hy = fy - h * 0.78 - hr * 0.95;
  ctx.fillStyle = flash ? '#ccc' : '#0d0b10';
  ctx.beginPath();
  ctx.moveTo(hx - hr * 1.1, hy + hr * 1.5);
  ctx.quadraticCurveTo(hx - hr * 1.3, hy - hr * 1.2, hx, hy - hr * 1.1);
  ctx.quadraticCurveTo(hx + hr * 1.3, hy - hr * 1.2, hx + hr * 1.1, hy + hr * 1.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = flash ? '#fff' : '#eadfda';
  ctx.beginPath();
  ctx.ellipse(hx + s * hr * 0.25, hy + hr * 0.15, hr * 0.32, hr * 0.7, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#7a1426';
  ctx.beginPath();
  ctx.arc(hx + s * hr * 0.25, hy + hr * 0.62, hr * 0.12, 0, TAU);
  ctx.fill();
  ctx.fillStyle = fill;
  pathRoundRect(ctx, hx - hr * 0.6, hy - hr * 1.45, hr * 1.2, hr * 0.5, hr * 0.15);
  ctx.fill();
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(hx - hr * 0.6, hy - hr * 1.05, hr * 1.2, hr * 0.1);
  // floor display floating beside her head, away from the pointing hand (counts down)
  const fl = 13 - (Math.floor(time * 1.3 + phase) % 17);
  const label = fl > 0 ? `▼${fl}` : `B${1 - fl}`;
  const dx = fx - s * w * 0.62;
  const dy = hy - hr * 0.6 + Math.sin(time * 2 + phase) * 2;
  pathRoundRect(ctx, dx - w * 0.26, dy - w * 0.11, w * 0.52, w * 0.22, 3);
  ctx.fillStyle = '#0b0b0e';
  ctx.fill();
  ctx.strokeStyle = '#6f7680';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#ff5d4d';
  ctx.font = `800 ${Math.max(8, Math.round(w * 0.16))}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, dx, dy + 0.5);
}

/** 복사기 괴물: a photocopier whose lid is a jaw — green scan light inside, a paper tongue, panel-LED eyes. */
function copier(ctx: CanvasRenderingContext2D, fill: string, flash: boolean, fx: number, fy: number, w: number, h: number, s: number, time: number, phase: number, act: number): void {
  const bw = w * 1.0;
  const x0 = fx - bw / 2;
  const bodyTop = fy - h * 0.62;
  // wheels
  ctx.fillStyle = OUTLINE;
  for (const k of [0.15, 0.85]) {
    ctx.beginPath();
    ctx.arc(x0 + bw * k, fy - h * 0.04, h * 0.05, 0, TAU);
    ctx.fill();
  }
  // paper tray arms
  ctx.fillStyle = flash ? '#fff' : '#a8adb5';
  ctx.fillRect(fx - s * bw * 0.68, fy - h * 0.44, bw * 0.2, h * 0.06);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(fx - s * bw * 0.66, fy - h * 0.47, bw * 0.16, h * 0.04);
  // cabinet
  pathRoundRect(ctx, x0, bodyTop, bw, h * 0.58, 5);
  fillStroke(ctx, fill, w);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1.5;
  for (let i = 1; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(x0 + 4, bodyTop + h * 0.19 * i);
    ctx.lineTo(x0 + bw - 4, bodyTop + h * 0.19 * i);
    ctx.stroke();
  }
  // mouth: open lid (jaw) + dark glass with a sweeping green scan bar + teeth
  const open = 0.25 + 0.45 * act + 0.08 * Math.sin(time * 3 + phase);
  const mx = x0 + bw * 0.08;
  const mw = bw * 0.84;
  const my = bodyTop;
  ctx.fillStyle = '#05070a';
  ctx.beginPath();
  ctx.moveTo(mx, my);
  ctx.lineTo(mx + mw, my);
  ctx.lineTo(mx + mw - s * 0, my - h * 0.36 * open);
  ctx.lineTo(mx, my - h * 0.36 * open - h * 0.05);
  ctx.closePath();
  ctx.fill();
  const scan = mx + ((time * 0.9 + phase) % 1) * mw;
  ctx.globalAlpha *= 0.85;
  ctx.fillStyle = '#7dffb3';
  ctx.fillRect(scan - 2, my - h * 0.3 * open, 4, h * 0.3 * open);
  ctx.globalAlpha /= 0.85;
  // lid
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(-open * 0.9);
  pathRoundRect(ctx, 0, -h * 0.1, mw + 4, h * 0.1, 3);
  ctx.fillStyle = flash ? '#fff' : '#b4b9c1';
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  lw(ctx, w);
  ctx.stroke();
  ctx.fillStyle = '#f5f1e6';
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const tx = 4 + (mw / 6) * i;
    ctx.moveTo(tx, 0);
    ctx.lineTo(tx + mw / 12, h * 0.06);
    ctx.lineTo(tx + mw / 6, 0);
  }
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#f5f1e6';
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const tx = mx + (mw / 6) * i;
    ctx.moveTo(tx, my);
    ctx.lineTo(tx + mw / 12, my - h * 0.05);
    ctx.lineTo(tx + mw / 6, my);
  }
  ctx.fill();
  // paper tongue sliding out the front
  const tl = h * (0.12 + 0.18 * act + 0.04 * Math.sin(time * 5 + phase));
  ctx.fillStyle = flash ? '#fff' : '#fbfbf6';
  ctx.beginPath();
  ctx.moveTo(fx + s * bw * 0.1, my - 2);
  ctx.lineTo(fx + s * bw * 0.1 + s * tl, my + tl * 0.6);
  ctx.lineTo(fx + s * bw * 0.32 + s * tl, my + tl * 0.6 - 4);
  ctx.lineTo(fx + s * bw * 0.32, my - 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#9aa1ab';
  ctx.lineWidth = 1;
  ctx.stroke();
  // control panel eyes (green LEDs) + display
  const py = bodyTop + h * 0.08;
  ctx.fillStyle = '#1b2a22';
  ctx.fillRect(fx + s * bw * 0.06 - bw * 0.18, py, bw * 0.36, h * 0.1);
  const blink = blinkOpen(time, phase, 2.7);
  ctx.fillStyle = act > 0.2 ? '#ff5d73' : '#52ff9a';
  ctx.fillRect(fx + s * bw * 0.06 - bw * 0.13, py + h * 0.02, bw * 0.08, h * 0.06 * blink);
  ctx.fillRect(fx + s * bw * 0.06 + bw * 0.05, py + h * 0.02, bw * 0.08, h * 0.06 * blink);
}

/** 수간호사: a tall head nurse — big cap, surgical mask, shadowed eyes, a giant green-filled syringe, clipboard. */
function headNurse(ctx: CanvasRenderingContext2D, fill: string, flash: boolean, fx: number, fy: number, w: number, h: number, s: number, time: number, phase: number, act: number): void {
  const lean = s * w * 0.06 * act;
  // uniform dress
  ctx.beginPath();
  ctx.moveTo(fx - w * 0.24 + lean, fy - h * 0.8);
  ctx.lineTo(fx - w * 0.38, fy - h * 0.08);
  ctx.lineTo(fx + w * 0.38, fy - h * 0.08);
  ctx.lineTo(fx + w * 0.24 + lean, fy - h * 0.8);
  ctx.closePath();
  fillStroke(ctx, fill, w, '#3a4a46');
  ctx.strokeStyle = '#52d273';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(fx - w * 0.36, fy - h * 0.16);
  ctx.lineTo(fx + w * 0.36, fy - h * 0.16);
  ctx.stroke();
  ctx.fillStyle = '#d7dedb';
  ctx.fillRect(fx - w * 0.15, fy - h * 0.08, w * 0.1, h * 0.08);
  ctx.fillRect(fx + w * 0.05, fy - h * 0.08, w * 0.1, h * 0.08);
  // clipboard
  ctx.fillStyle = '#8a6a44';
  ctx.fillRect(fx - s * w * 0.42, fy - h * 0.6, w * 0.18, w * 0.24);
  ctx.fillStyle = '#fbfbf6';
  ctx.fillRect(fx - s * w * 0.42 + 2, fy - h * 0.6 + 4, w * 0.18 - 4, w * 0.24 - 6);
  // giant syringe
  const sx = fx + s * w * 0.36;
  const sy = fy - h * 0.62;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(s * (0.5 + 0.9 * act));
  ctx.fillStyle = flash ? '#fff' : '#e9eef5';
  ctx.fillRect(-w * 0.08, -h * 0.05, w * 0.16, h * 0.42);
  ctx.fillStyle = '#52d273';
  ctx.fillRect(-w * 0.06, h * 0.05, w * 0.12, h * 0.28);
  ctx.strokeStyle = '#3a4a46';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-w * 0.08, -h * 0.05, w * 0.16, h * 0.42);
  ctx.beginPath();
  ctx.moveTo(0, h * 0.37);
  ctx.lineTo(0, h * 0.55);
  ctx.moveTo(-w * 0.12, -h * 0.05);
  ctx.lineTo(w * 0.12, -h * 0.05);
  ctx.moveTo(0, -h * 0.05);
  ctx.lineTo(0, -h * 0.14);
  ctx.stroke();
  ctx.restore();
  // head: cap, mask, shadowed eyes
  const hr = w * 0.21;
  const hx = fx + lean * 1.4;
  const hy = fy - h * 0.8 - hr * 0.9;
  ctx.beginPath();
  ctx.arc(hx, hy, hr, 0, TAU);
  fillStroke(ctx, flash ? '#fff' : '#efe3dc', w, '#3a4a46');
  ctx.fillStyle = '#1a1416';
  ctx.beginPath();
  ctx.ellipse(hx, hy - hr * 0.55, hr * 1.05, hr * 0.55, 0, Math.PI, TAU);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(hx - hr * 1.1, hy - hr * 0.7);
  ctx.lineTo(hx - hr * 0.8, hy - hr * 1.6);
  ctx.lineTo(hx + hr * 0.8, hy - hr * 1.6);
  ctx.lineTo(hx + hr * 1.1, hy - hr * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#3a4a46';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = '#ff4d5e';
  ctx.fillRect(hx - hr * 0.08, hy - hr * 1.45, hr * 0.16, hr * 0.5);
  ctx.fillRect(hx - hr * 0.25, hy - hr * 1.28, hr * 0.5, hr * 0.16);
  ctx.fillStyle = flash ? '#fff' : '#cfe9e0';
  pathRoundRect(ctx, hx + s * hr * 0.1 - hr * 0.7, hy + hr * 0.05, hr * 1.4, hr * 0.75, hr * 0.25);
  ctx.fill();
  ctx.fillStyle = '#2a1e28';
  ctx.beginPath();
  ctx.ellipse(hx + s * hr * 0.15 - hr * 0.35, hy - hr * 0.2, hr * 0.24, hr * 0.15, 0, 0, TAU);
  ctx.ellipse(hx + s * hr * 0.15 + hr * 0.35, hy - hr * 0.2, hr * 0.24, hr * 0.15, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = act > 0.2 ? '#7dffb3' : '#f2f2f2';
  ctx.fillRect(hx + s * hr * 0.2 - hr * 0.38, hy - hr * 0.22, 2, 2);
  ctx.fillRect(hx + s * hr * 0.2 + hr * 0.32, hy - hr * 0.22, 2, 2);
}

/**
 * 신호등 인간: a man whose head is a pedestrian signal box — red lamp with a standing figure (빨간불 = '+' slam) or
 * green lamp with a walking figure (초록불 = 'X' slam), switched by the pattern it is winding up (CREATURE_POSE.skill).
 * 기획 8차 리뷰: the old yellow-black striped body read as a construction barrier → a dark coat with a crosswalk sash.
 */
function signalMan(ctx: CanvasRenderingContext2D, fill: string, flash: boolean, fx: number, fy: number, w: number, h: number, s: number, time: number, phase: number, act: number): void {
  const green = CREATURE_POSE.skill === 'signal_green';
  const lampColor = green ? '#2ee86f' : '#ff3b3b';
  // legs (walking stride when moving, like the green man)
  const stride = CREATURE_POSE.moving ? Math.sin(time * 8 + phase) * w * 0.08 : 0;
  ctx.fillStyle = '#16131b';
  ctx.fillRect(fx - w * 0.2 + stride, fy - h * 0.3, w * 0.14, h * 0.3);
  ctx.fillRect(fx + w * 0.06 - stride, fy - h * 0.3, w * 0.14, h * 0.3);
  // torso: a dark coat with a zebra-crossing sash
  const tx = fx - w * 0.3;
  const ty = fy - h * 0.7;
  const tw = w * 0.6;
  const th = h * 0.42;
  pathRoundRect(ctx, tx, ty, tw, th, 5);
  ctx.fillStyle = flash ? '#fff' : fill;
  ctx.fill();
  ctx.save();
  pathRoundRect(ctx, tx, ty, tw, th, 5);
  ctx.clip();
  ctx.fillStyle = flash ? '#fff' : '#f2f2f2';
  for (let k = 0; k < 5; k++) ctx.fillRect(tx + tw * (0.06 + k * 0.19), ty + th * 0.56, tw * 0.11, th * 0.26);
  ctx.restore();
  pathRoundRect(ctx, tx, ty, tw, th, 5);
  ctx.strokeStyle = OUTLINE;
  lw(ctx, w);
  ctx.stroke();
  // the push-button box on its chest (보행자 작동 신호기), lit in the current colour
  pathRoundRect(ctx, fx - w * 0.09, ty + th * 0.12, w * 0.18, th * 0.3, 3);
  ctx.fillStyle = '#ffd23f';
  ctx.fill();
  ctx.fillStyle = lampColor;
  ctx.beginPath();
  ctx.arc(fx, ty + th * 0.27, w * 0.045, 0, TAU);
  ctx.fill();
  // arms raised for the slam
  const up = act;
  const ay = ty + th * (0.8 - 1.2 * up);
  ctx.lineWidth = Math.max(3.5, w * 0.1);
  ctx.strokeStyle = flash ? '#fff' : fill;
  ctx.beginPath();
  ctx.moveTo(tx, ty + 6);
  ctx.lineTo(tx - w * 0.16, ay);
  ctx.moveTo(tx + tw, ty + 6);
  ctx.lineTo(tx + tw + w * 0.16, ay);
  ctx.stroke();
  ctx.fillStyle = '#f2f2f2';
  ctx.beginPath();
  ctx.arc(tx - w * 0.16, ay, w * 0.06, 0, TAU);
  ctx.arc(tx + tw + w * 0.16, ay, w * 0.06, 0, TAU);
  ctx.fill();
  // neck pole + the pedestrian signal box head: two lamps, the live one shows its figure
  ctx.fillStyle = '#3a3d45';
  ctx.fillRect(fx - w * 0.04, ty - h * 0.05, w * 0.08, h * 0.06);
  const hw = w * 0.42;
  const hh = h * 0.46;
  const hx = fx - hw / 2;
  const hy = ty - hh - h * 0.04;
  pathRoundRect(ctx, hx, hy, hw, hh, 5);
  fillStroke(ctx, flash ? '#ddd' : '#25272d', w);
  // visor lip over each lamp
  ctx.fillStyle = '#17181c';
  ctx.fillRect(hx - 2, hy + hh * 0.04, hw + 4, 3);
  ctx.fillRect(hx - 2, hy + hh * 0.52, hw + 4, 3);
  const lr = Math.min(hw * 0.4, hh * 0.22);
  for (const [i, on] of [[0, !green], [1, green]] as [number, boolean][]) {
    const ly = hy + hh * (0.27 + i * 0.47);
    const c = i === 0 ? '#ff3b3b' : '#2ee86f';
    if (on) {
      ctx.globalAlpha *= 0.3 + 0.15 * act;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(fx, ly, lr * 2.1, 0, TAU);
      ctx.fill();
      ctx.globalAlpha /= 0.3 + 0.15 * act;
    }
    pathRoundRect(ctx, fx - lr, ly - lr, lr * 2, lr * 2, 3);
    ctx.fillStyle = on ? '#0d0f12' : '#1d1f24';
    ctx.fill();
    if (on) pictogram(ctx, fx, ly, lr, c, i === 1, time + phase, s);
    else {
      ctx.globalAlpha *= 0.35;
      pictogram(ctx, fx, ly, lr, i === 0 ? '#5a2a2a' : '#24502f', i === 1, 0, s);
      ctx.globalAlpha /= 0.35;
    }
  }
}

/** A pedestrian-signal figure inside a lamp of half-size r: standing (red) or mid-stride (green). */
function pictogram(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, walking: boolean, time: number, s: number): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x + (walking ? s * r * 0.1 : 0), y - r * 0.6, r * 0.2, 0, TAU);
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.28);
  ctx.beginPath();
  if (!walking) {
    ctx.moveTo(x, y - r * 0.32);
    ctx.lineTo(x, y + r * 0.25);
    ctx.moveTo(x - r * 0.12, y + r * 0.25);
    ctx.lineTo(x - r * 0.14, y + r * 0.78);
    ctx.moveTo(x + r * 0.12, y + r * 0.25);
    ctx.lineTo(x + r * 0.14, y + r * 0.78);
    ctx.moveTo(x - r * 0.24, y - r * 0.24);
    ctx.lineTo(x - r * 0.3, y + r * 0.22);
    ctx.moveTo(x + r * 0.24, y - r * 0.24);
    ctx.lineTo(x + r * 0.3, y + r * 0.22);
  } else {
    const k = Math.sin(time * 6) * 0.15;
    ctx.moveTo(x + s * r * 0.06, y - r * 0.32);
    ctx.lineTo(x - s * r * 0.04, y + r * 0.2);
    ctx.moveTo(x - s * r * 0.04, y + r * 0.2);
    ctx.lineTo(x + s * r * (0.36 + k), y + r * 0.78);
    ctx.moveTo(x - s * r * 0.04, y + r * 0.2);
    ctx.lineTo(x - s * r * (0.38 + k), y + r * 0.74);
    ctx.moveTo(x + s * r * 0.04, y - r * 0.22);
    ctx.lineTo(x + s * r * 0.42, y + r * 0.06);
    ctx.moveTo(x + s * r * 0.04, y - r * 0.22);
    ctx.lineTo(x - s * r * 0.36, y + r * 0.02);
  }
  ctx.stroke();
}

/** Ground aura under a mid boss (drawn on the ground layer by the renderer). */
export function midAura(ctx: CanvasRenderingContext2D, sx: number, sy: number, rx: number, ry: number, time: number, phase: number): void {
  const p = 0.5 + 0.5 * Math.sin(time * 3 + phase);
  ctx.globalAlpha = 0.22 + 0.1 * p;
  ctx.fillStyle = '#8a1030';
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx * 1.45, ry * 1.45, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 0.55 + 0.25 * p;
  ctx.strokeStyle = '#ff4d6d';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.lineDashOffset = -time * 20;
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx * (1.55 + 0.08 * p), ry * (1.55 + 0.08 * p), 0, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  ctx.globalAlpha = 1;
}

// ─────────────────────────── 기획 12차: 돌발 괴담 ───────────────────────────
// Event units: the gold dashed ring / '!' diamond come from render/fieldEvents.ts; these are just the bodies.

/** 금두꺼비: a squat gold toad with a coin in its mouth; crouches (act) before a hop. */
function luckyToad(ctx: CanvasRenderingContext2D, fill: string, flash: boolean, fx: number, fy: number, w: number, h: number, s: number, time: number, phase: number, act: number): void {
  const squash = 1 - 0.28 * act;
  const hop = CREATURE_POSE.moving ? Math.abs(Math.sin(time * 9 + phase)) * h * 0.12 : 0;
  const cy = fy - h * 0.4 * squash - hop;
  const rx = w * 0.56 * (1 + 0.12 * act);
  const ry = h * 0.4 * squash;
  // hind legs
  ctx.beginPath();
  ctx.ellipse(fx - w * 0.36, fy - h * 0.1 - hop, w * 0.2, h * 0.12, 0, 0, TAU);
  ctx.ellipse(fx + w * 0.36, fy - h * 0.1 - hop, w * 0.2, h * 0.12, 0, 0, TAU);
  fillStroke(ctx, flash ? fill : '#e0a91f', w);
  // body
  ctx.beginPath();
  ctx.ellipse(fx, cy, rx, ry, 0, 0, TAU);
  fillStroke(ctx, fill, w);
  // belly + back spots
  ctx.fillStyle = flash ? '#fff' : '#fff1b8';
  ctx.beginPath();
  ctx.ellipse(fx + s * rx * 0.25, cy + ry * 0.3, rx * 0.5, ry * 0.5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#d18f12';
  ctx.beginPath();
  for (const [dx, dy, r] of [[-0.35, -0.35, 0.09], [-0.05, -0.55, 0.07], [-0.55, 0.0, 0.07]]) {
    ctx.moveTo(fx - s * rx * dx * -1 + r * w, cy + ry * dy);
    ctx.arc(fx + s * rx * dx, cy + ry * dy, r * w, 0, TAU);
  }
  ctx.fill();
  // bulging eyes on top
  const ey = cy - ry * 0.85;
  for (const k of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(fx + s * rx * 0.2 + k * rx * 0.36, ey, w * 0.16, 0, TAU);
    fillStroke(ctx, fill, w);
  }
  eyePair(ctx, fx + s * rx * 0.2, ey, rx * 0.36, w * 0.1, s, '#fffdf0', '#2b1a00');
  // grin + coin
  ctx.strokeStyle = OUTLINE;
  lw(ctx, w, 0.04);
  ctx.beginPath();
  ctx.moveTo(fx + s * rx * 0.05, cy - ry * 0.15);
  ctx.quadraticCurveTo(fx + s * rx * 0.55, cy + ry * 0.12, fx + s * rx * 0.92, cy - ry * 0.25);
  ctx.stroke();
  const cx = fx + s * rx * 0.88;
  const coinY = cy - ry * 0.05;
  const cr = w * 0.15;
  ctx.beginPath();
  ctx.arc(cx, coinY, cr, 0, TAU);
  fillStroke(ctx, flash ? '#fff' : '#ffe066', w);
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(cx - cr * 0.3, coinY - cr * 0.3, cr * 0.6, cr * 0.6);
  // glint
  const g = (time * 0.7 + phase * 0.31) % 1;
  if (g < 0.18) {
    ctx.globalAlpha *= 1 - g / 0.18;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(fx - s * rx * 0.3, cy - ry * 0.45, w * 0.06, 0, TAU);
    ctx.fill();
    ctx.globalAlpha /= Math.max(0.01, 1 - g / 0.18);
  }
}

/** 멈추지 않는 프린터: a beige office printer with red panel eyes, a sheet sliding out of the tray. */
function eventPrinter(ctx: CanvasRenderingContext2D, fill: string, flash: boolean, fx: number, fy: number, w: number, h: number, s: number, time: number, phase: number): void {
  const bw = w * 1.15;
  const bh = h * 0.78;
  const x0 = fx - bw / 2;
  const y0 = fy - bh;
  // body
  pathRoundRect(ctx, x0, y0, bw, bh, Math.max(3, bw * 0.08));
  fillStroke(ctx, fill, w);
  // lid
  pathRoundRect(ctx, x0 + bw * 0.06, y0 - bh * 0.14, bw * 0.88, bh * 0.2, Math.max(2, bw * 0.05));
  fillStroke(ctx, flash ? fill : '#b9b2a2', w);
  // output slot
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(x0 + bw * 0.14, y0 + bh * 0.42, bw * 0.72, bh * 0.08);
  // the sheet coming out (loops), with "names" on it
  const k = ((time * 0.45 + phase * 0.13) % 1) ** 0.7;
  const sh = bh * 0.55 * k;
  ctx.fillStyle = '#fffdf6';
  ctx.fillRect(x0 + bw * 0.2, y0 + bh * 0.48, bw * 0.6, sh);
  ctx.strokeStyle = OUTLINE;
  lw(ctx, w, 0.03);
  ctx.strokeRect(x0 + bw * 0.2, y0 + bh * 0.48, bw * 0.6, sh);
  ctx.strokeStyle = '#c1121f';
  ctx.beginPath();
  for (let i = 1; i <= 3; i++) {
    const ly = y0 + bh * 0.48 + sh - i * bh * 0.1;
    if (ly < y0 + bh * 0.5) break;
    ctx.moveTo(x0 + bw * 0.28, ly);
    ctx.lineTo(x0 + bw * (0.5 + 0.18 * ((i * 7) % 3) / 2), ly);
  }
  ctx.stroke();
  // panel with two red "eyes"
  const px = fx + s * bw * 0.28;
  const py = y0 + bh * 0.2;
  const blink = blinkOpen(time, phase, 2.6);
  ctx.globalAlpha *= 0.45;
  ctx.fillStyle = '#ff2d3c';
  ctx.beginPath();
  ctx.arc(px - bw * 0.07, py, w * 0.1, 0, TAU);
  ctx.arc(px + bw * 0.07, py, w * 0.1, 0, TAU);
  ctx.fill();
  ctx.globalAlpha /= 0.45;
  ctx.fillStyle = '#ffd6d9';
  ctx.beginPath();
  ctx.ellipse(px - bw * 0.07, py, w * 0.045, w * 0.05 * blink, 0, 0, TAU);
  ctx.ellipse(px + bw * 0.07, py, w * 0.045, w * 0.05 * blink, 0, 0, TAU);
  ctx.fill();
}

/** 잠든 환자: a hospital bed with a sleeper under the sheet and an IV stand (ally side, never fights). */
function eventPatient(ctx: CanvasRenderingContext2D, fill: string, fx: number, fy: number, w: number, h: number, s: number, time: number, phase: number): void {
  const bw = w;
  const bh = h * 0.45;
  const x0 = fx - bw / 2;
  const y0 = fy - bh - h * 0.12;
  // legs + frame
  ctx.strokeStyle = '#6c757d';
  lw(ctx, w, 0.05);
  ctx.beginPath();
  ctx.moveTo(x0 + bw * 0.08, fy);
  ctx.lineTo(x0 + bw * 0.08, y0 + bh);
  ctx.moveTo(x0 + bw * 0.92, fy);
  ctx.lineTo(x0 + bw * 0.92, y0 + bh);
  ctx.stroke();
  pathRoundRect(ctx, x0, y0, bw, bh, Math.max(3, bh * 0.25));
  fillStroke(ctx, '#cfd8dc', w);
  // sheet (breathing)
  const breathe = Math.sin(time * 1.6 + phase) * bh * 0.05;
  ctx.beginPath();
  ctx.moveTo(x0 + bw * 0.3, y0 + bh * 0.1);
  ctx.quadraticCurveTo(fx + bw * 0.1, y0 - bh * 0.35 - breathe, x0 + bw * 0.95, y0 + bh * 0.15);
  ctx.lineTo(x0 + bw * 0.95, y0 + bh * 0.6);
  ctx.lineTo(x0 + bw * 0.3, y0 + bh * 0.6);
  ctx.closePath();
  fillStroke(ctx, fill, w);
  // pillow + head with closed eyes
  const hx = x0 + bw * 0.18;
  const hy = y0 - bh * 0.05;
  ctx.beginPath();
  ctx.ellipse(hx, y0 + bh * 0.15, bw * 0.13, bh * 0.28, 0, 0, TAU);
  fillStroke(ctx, '#ffffff', w);
  ctx.beginPath();
  ctx.arc(hx, hy, bh * 0.42, 0, TAU);
  fillStroke(ctx, '#f1d3b8', w);
  ctx.strokeStyle = OUTLINE;
  lw(ctx, w, 0.03);
  ctx.beginPath();
  ctx.arc(hx - bh * 0.15, hy, bh * 0.1, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.moveTo(hx + bh * 0.25, hy);
  ctx.arc(hx + bh * 0.15, hy, bh * 0.1, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  // IV stand with the bag
  const ix = x0 - bw * 0.06;
  ctx.strokeStyle = '#8d99ae';
  lw(ctx, w, 0.035);
  ctx.beginPath();
  ctx.moveTo(ix, fy);
  ctx.lineTo(ix, y0 - h * 0.75);
  ctx.stroke();
  pathRoundRect(ctx, ix - bw * 0.07, y0 - h * 0.75, bw * 0.14, h * 0.28, 3);
  fillStroke(ctx, 'rgba(210,240,255,0.9)', w);
  void s;
}

/** 퇴근 못 한 그림자: a hunched office-worker silhouette, see-through, white eyes (not the red-eyed 그림자 아이). */
function nightShadow(ctx: CanvasRenderingContext2D, fill: string, fx: number, fy: number, w: number, h: number, s: number, time: number, phase: number, act: number): void {
  const a = ctx.globalAlpha;
  ctx.globalAlpha = a * 0.82;
  const lean = s * w * (CREATURE_POSE.moving ? 0.12 : 0.05);
  const headR = w * 0.24;
  const hx = fx + lean + s * w * 0.06;
  const hy = fy - h + headR;
  ctx.beginPath();
  ctx.moveTo(hx - headR * 1.6, hy + headR * 1.2);
  ctx.quadraticCurveTo(hx - headR * 0.5, hy + headR * 0.4, hx + headR * 1.4, hy + headR * 1.3);
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const x = fx + w * 0.45 - (w * 0.9 * i) / n;
    const y = fy - (i % 2) * h * 0.1 + Math.sin(time * 7 + phase + i) * h * 0.03;
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(hx, hy, headR, 0, TAU);
  ctx.fill();
  // loose tie
  ctx.strokeStyle = '#3d3552';
  lw(ctx, w, 0.06);
  ctx.beginPath();
  ctx.moveTo(hx, hy + headR * 1.3);
  ctx.lineTo(hx + s * w * 0.06, hy + headR * 2.6);
  ctx.stroke();
  ctx.globalAlpha = a;
  const r = Math.max(1.6, w * 0.06) * (act > 0.3 ? 1.3 : 1);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(hx + s * headR * 0.2 - headR * 0.32, hy, r, 0, TAU);
  ctx.arc(hx + s * headR * 0.2 + headR * 0.32, hy, r, 0, TAU);
  ctx.fill();
}

/** 잠든 아이: a small child in a yellow raincoat, eyes shut, arms out in front (sleepwalking). */
function sleepwalkerChild(ctx: CanvasRenderingContext2D, fill: string, fx: number, fy: number, w: number, h: number, s: number, time: number, phase: number): void {
  const step = CREATURE_POSE.moving ? Math.sin(time * 6 + phase) : 0;
  const headR = w * 0.3;
  const hx = fx + s * w * 0.04;
  const hy = fy - h + headR;
  // legs
  ctx.strokeStyle = '#3a3a3a';
  lw(ctx, w, 0.09);
  ctx.beginPath();
  ctx.moveTo(fx - w * 0.12, fy - h * 0.25);
  ctx.lineTo(fx - w * 0.12 + step * w * 0.08, fy);
  ctx.moveTo(fx + w * 0.12, fy - h * 0.25);
  ctx.lineTo(fx + w * 0.12 - step * w * 0.08, fy);
  ctx.stroke();
  // raincoat (a bell)
  ctx.beginPath();
  ctx.moveTo(hx - headR * 0.8, hy + headR * 0.6);
  ctx.lineTo(fx - w * 0.42, fy - h * 0.2);
  ctx.quadraticCurveTo(fx, fy - h * 0.12, fx + w * 0.42, fy - h * 0.2);
  ctx.lineTo(hx + headR * 0.8, hy + headR * 0.6);
  ctx.closePath();
  fillStroke(ctx, fill, w);
  // arms held out forward
  ctx.strokeStyle = fill;
  lw(ctx, w, 0.12);
  ctx.beginPath();
  ctx.moveTo(fx + s * w * 0.1, fy - h * 0.55);
  ctx.lineTo(fx + s * w * 0.55, fy - h * 0.58 + Math.sin(time * 2 + phase) * h * 0.02);
  ctx.stroke();
  // face + hood
  ctx.beginPath();
  ctx.arc(hx, hy, headR, 0, TAU);
  fillStroke(ctx, '#f6d7bd', w);
  ctx.beginPath();
  ctx.arc(hx, hy, headR * 1.12, Math.PI * 1.05, Math.PI * 1.95);
  ctx.lineTo(hx + headR * 1.12, hy + headR * 0.3);
  ctx.lineTo(hx + headR * 0.9, hy + headR * 0.3);
  ctx.arc(hx, hy, headR * 0.9, Math.PI * 1.95, Math.PI * 1.05, true);
  ctx.lineTo(hx - headR * 1.12, hy + headR * 0.3);
  ctx.closePath();
  fillStroke(ctx, fill, w);
  // closed eyes
  ctx.strokeStyle = OUTLINE;
  lw(ctx, w, 0.035);
  ctx.beginPath();
  ctx.arc(hx - headR * 0.35 + s * headR * 0.1, hy + headR * 0.05, headR * 0.18, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.moveTo(hx + headR * 0.53 + s * headR * 0.1, hy + headR * 0.05);
  ctx.arc(hx + headR * 0.35 + s * headR * 0.1, hy + headR * 0.05, headR * 0.18, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
}
