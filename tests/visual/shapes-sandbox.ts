// Shapes sandbox (3차 2: 12 drag-skill footprints). Drives the REAL sim (createGameWithWorld) + renderer per cell.
// Open via render-sandbox.html?scene=shapes … (see run() params). Screenshots: node tests/visual/shoot-shapes.mjs
//   grid=1            4×3 grid, one cell per character (roster order)            default
//   char=<id>         one character full screen (phone legibility checks)
//   mode=preview      drag preview (DragPreview.parts) at the drop point          default
//   mode=cast         the drag skill actually cast: telegraphs, flashes, dash streak, zones
//   valid=0           invalid (red) preview
//   t=<s>             seconds rendered before the shot (cast mode: sim time after the drop)

import { createRenderer } from '../../src/render';
import { DEFAULT_TUNABLES } from '../../src/config';
import { CHARACTERS, getCharacter, getMonster } from '../../src/data';
import { createUnit } from '../../src/sim/entities';
import { createGameWithWorld } from '../../src/sim/game';
import type { DragPreview, Game, GameEvent, RenderUiState } from '../../src/types';
import { LOGICAL_H, LOGICAL_W } from '../../src/types';

type Mode = 'preview' | 'cast';

/** Drop point per character so the whole footprint (and its direction) sits on screen. */
function dropFor(id: string): { x: number; y: number } {
  switch (id) {
    case 'ranger':
    case 'blade':
    case 'shadow':
      return { x: 9.5, y: 6 };
    case 'berserker':
      return { x: 10.5, y: 6 };
    case 'gunner':
      return { x: 16.5, y: 6 };
    case 'bard':
      return { x: 12.5, y: 6 };
    default:
      return { x: 12.5, y: 6 };
  }
}

/** A fixed crowd: a cluster around the drop point plus stragglers, all frozen in place. */
const CROWD: [string, number, number][] = [
  ['slime', 13.6, 5.3], ['goblin', 14.6, 6.4], ['slime', 15.8, 5.7], ['golem', 17.2, 6.6], ['goblin', 18.6, 5.2],
  ['slime', 11.2, 4.4], ['skeleton_archer', 12.4, 8.6], ['slime', 10.2, 7.8], ['goblin', 8.4, 6.4], ['bomb_bug', 12.6, 2.6],
  ['slime', 20.4, 7.4], ['goblin', 6.6, 5.0], ['slime', 15.2, 9.6], ['skeleton_archer', 19.8, 3.4],
];

interface Cell {
  game: Game;
  render: (dt: number, events: GameEvent[]) => void;
  ui: RenderUiState;
}

function makeCell(canvas: HTMLCanvasElement, id: string, mode: Mode, valid: boolean): Cell {
  const { game, world: w } = createGameWithWorld({
    seed: 11,
    players: [{ name: '나', isBot: false, characters: [id === 'guardian' ? 'cleric' : 'guardian', id, 'mage'], pets: ['frog_bomb', 'owl_frost', 'cat_void'] }],
    tunables: { ...DEFAULT_TUNABLES },
  });
  // quiet floor: no waves / mid boss, no starting monsters
  const s = w.state;
  w.spawner.nextWave = s.plan.waves.length;
  w.spawner.pending = [];
  w.spawner.midTriggered = true;
  for (const e of s.entities) if (e.team === 'enemy') e.rt.gone = true;
  const drop = dropFor(id);
  for (const [mid, x, y] of CROWD) {
    const m = createUnit(w, getMonster(mid), { x, y }, 'enemy', { kind: 'monster', ownerPlayer: null, expiresIn: null, hpMult: 50, atkMult: 0 });
    m.rt.base.moveSpeed = 0;
    m.facing = Math.PI;
  }
  // field character a little left-below of the drop point (the camera follows it)
  const me = s.entities.find(e => e.kind === 'character')!;
  me.pos = { x: drop.x - 1.5, y: 9.2 };
  me.rt.base.moveSpeed = 0;
  game.drainEvents();
  const renderer = createRenderer(canvas);
  const ui: RenderUiState = { localPlayer: 0, dragPreview: null, freezeCamera: false };
  if (mode === 'preview') {
    const parts = game.previewParts(0, 'swap', 1);
    const dp: DragPreview = { kind: 'swap', pos: drop, area: parts[0].area, parts, valid, color: getCharacter(id).color };
    ui.dragPreview = dp;
    ui.freezeCamera = true;
  } else {
    game.tunables.invincible = true;
    game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: drop });
    for (const e of s.entities) if (e.kind === 'character') e.rt.base.moveSpeed = 0;
  }
  return {
    game,
    ui,
    render(dt, extra) {
      renderer.render(game.state, extra.concat(game.drainEvents()), dt, ui);
    },
  };
}

export function run(params: URLSearchParams): void {
  const mode = (params.get('mode') ?? 'preview') as Mode;
  const valid = params.get('valid') !== '0';
  const t = Number(params.get('t') ?? (mode === 'cast' ? '0.2' : '0.6'));
  const only = params.get('char');
  const ids = only ? [only] : CHARACTERS.map(c => c.id);
  const stage = document.getElementById('stage')!;
  stage.innerHTML = '';
  const grid = document.createElement('div');
  const cols = only ? 1 : 4;
  const rows = only ? 1 : 3;
  const k = Math.min(window.innerWidth / LOGICAL_W, window.innerHeight / LOGICAL_H);
  const cw = Math.floor((LOGICAL_W * k) / cols);
  const ch = Math.floor((LOGICAL_H * k) / rows);
  grid.style.cssText = `display:grid;grid-template-columns:repeat(${cols},${cw}px);grid-template-rows:repeat(${rows},${ch}px);gap:0`;
  stage.appendChild(grid);
  const cells: Cell[] = [];
  for (const id of ids) {
    const box = document.createElement('div');
    box.style.cssText = `position:relative;width:${cw}px;height:${ch}px;overflow:hidden;outline:1px solid #222`;
    const cv = document.createElement('canvas');
    cv.style.cssText = `display:block;width:${cw}px;height:${ch}px`;
    box.appendChild(cv);
    const def = getCharacter(id);
    const label = document.createElement('div');
    const f = only ? 16 : 12;
    label.style.cssText = `position:absolute;left:6px;top:4px;font:800 ${f}px system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000,0 0 2px #000;pointer-events:none`;
    label.innerHTML = `<span style="color:${def.color}">${def.name}</span> · ${def.drag.name}`;
    box.appendChild(label);
    grid.appendChild(box);
    cells.push(makeCell(cv, id, mode, valid));
  }
  const DT = 1 / 60;
  const frames = Math.max(1, Math.round(t / DT));
  for (let i = 0; i < frames; i++) {
    for (const c of cells) {
      if (mode === 'cast') c.game.step(DT);
      c.render(DT, []);
    }
  }
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = '';
  (window as unknown as { __sandbox: unknown }).__sandbox = { ready: true, avgMs: 0, frameMs: [] };
}
