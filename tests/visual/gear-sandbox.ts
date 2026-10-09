// 기획 15차 원정 gear looks (fixture 'gear-bands'): the same 블레이드 with no gear and bands 1–4 at battle size and at
// menu-doll size, the 9 weapon families at band 4, and a row of item icons. 1280×720 logical, fitted to the window.
// Serve: npx vite --port 5192 → http://localhost:5192/tests/visual/gear-sandbox.html [?t=seconds]
// Shoot: node tests/visual/shoot-gear.mjs → docs/screenshots/gear-bands.png (844×390 @3x)

import type { GearBand, GearBands, WeaponFamily } from '../../src/data/gear';
import { BAND_COLOR, BAND_NAME_KO, WEAPON_FAMILY_BY_CHAR } from '../../src/data/gear';
import { RELICS } from '../../src/data/relics';
import { drawHeroDoll, gearIcon } from '../../src/render/gearArt';
import { boldFont } from '../../src/render/look';
import { LOGICAL_H, LOGICAL_W } from '../../src/types';

const params = new URLSearchParams(location.search);
const T = Number(params.get('t') ?? '0.7');
const cv = document.getElementById('c') as HTMLCanvasElement;
const dpr = Math.min(3, window.devicePixelRatio || 1);
const fit = Math.min(window.innerWidth / LOGICAL_W, window.innerHeight / LOGICAL_H);
cv.style.width = `${LOGICAL_W * fit}px`;
cv.style.height = `${LOGICAL_H * fit}px`;
cv.width = Math.round(LOGICAL_W * fit * dpr);
cv.height = Math.round(LOGICAL_H * fit * dpr);
const ctx = cv.getContext('2d')!;
ctx.scale(fit * dpr, fit * dpr);

const full = (b: GearBand, relic = 0): GearBands | null => (b === 0 ? null : { w: b, a: b, c: b, r: relic, rb: b });
const label = (text: string, x: number, y: number, color = '#c9d1e0', px = 17) => {
  ctx.font = boldFont(px);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
};

ctx.fillStyle = '#0b0d14';
ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
label('장비 묶음 (블레이드) · 전투 크기 / 메뉴 인형', 330, 22, '#ffffff', 19);
label('묶음 4 · 무기 모양 9가지', 960, 22, '#ffffff', 19);

// left: blade B0..B4 — battle size row and doll row
for (let b = 0; b <= 4; b++) {
  const x = 70 + b * 130;
  drawHeroDoll(ctx, 'blade', full(b as GearBand, b >= 3 ? 1 + b : 0), x, 150, 42, T, { breathe: 0 });
  drawHeroDoll(ctx, 'blade', full(b as GearBand, b >= 2 ? b + 3 : 0), x, 420, 92, T, { breathe: 0 });
  label(b === 0 ? '장비 없음' : `${b} ${BAND_NAME_KO[b]}`, x, 455, b === 0 ? '#9aa4b8' : BAND_COLOR[b]);
}

// right: 9 families at band 4 (one character per family)
const famChar: Partial<Record<WeaponFamily, string>> = {};
for (const [id, f] of Object.entries(WEAPON_FAMILY_BY_CHAR)) famChar[f] ??= id;
const FAMILY_KO: Record<WeaponFamily, string> = { shield: '방패', sword: '검', axe: '도끼', bow: '활', orb: '오브', staff: '지팡이', hammer: '망치', gun: '총', lute: '류트' };
const fams = Object.keys(famChar) as WeaponFamily[];
fams.forEach((f, i) => {
  const x = 720 + (i % 5) * 112;
  const y = i < 5 ? 190 : 400;
  drawHeroDoll(ctx, famChar[f]!, full(4, 1 + (i % 8)), x, y, 64, T + i * 0.3, { breathe: 0 });
  label(FAMILY_KO[f], x, y + 28, '#ffd166', 15);
});

// bottom: icons (weapon b1..b4, armor b1..b4, charm b1..b4, 8 relics)
const icons: { url: string; band: number }[] = [];
for (let b = 1; b <= 4; b++) icons.push({ url: gearIcon('weapon', 'sword', b as GearBand, undefined, 96), band: b });
for (let b = 1; b <= 4; b++) icons.push({ url: gearIcon('armor', null, b as GearBand, undefined, 96), band: b });
for (let b = 1; b <= 4; b++) icons.push({ url: gearIcon('charm', null, b as GearBand, undefined, 96), band: b });
RELICS.forEach((r, i) => icons.push({ url: gearIcon('relic', null, ((i % 4) + 1) as GearBand, r.id, 96), band: (i % 4) + 1 }));
let pending = icons.length;
icons.forEach((ic, i) => {
  const img = new Image();
  img.onload = () => {
    const x = 18 + i * 62;
    const y = 560;
    ctx.fillStyle = '#141824';
    ctx.fillRect(x, y, 56, 56);
    ctx.strokeStyle = BAND_COLOR[ic.band];
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, 53, 53);
    ctx.drawImage(img, x + 2, y + 2, 52, 52);
    if (--pending === 0) (window as unknown as { __gear: boolean }).__gear = true;
  };
  img.src = ic.url;
});
label('아이템 아이콘 (무기 · 방어구 · 장신구 묶음 1~4, 유물 8종)', 640, 640, '#9aa4b8', 16);
