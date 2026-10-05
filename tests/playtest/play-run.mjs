// Real-input playtest of a full run. Usage: node tests/playtest/play-run.mjs [phone|desktop] [fastSpeed=3] [seed]
// Floor 1 at gameSpeed 1 (pacing), then floors 2+ at fastSpeed set through the debug panel's real buttons.
// Swaps every ~4 s by dragging a ready card onto the densest enemy cluster, pets when a cluster is worth it, ult when full.
// 기획 10차: 괴담 rooms are passed with real taps by GOEDAM=off|leave|random|first|forced:<room>:<opt> (default leave).

import fs from 'node:fs';
import {
  BASE, afterReward, armGoedam, center, clusterFinger, closePanel, frameStats, goedamPolicy, hudBoxes, launch, now, pickReward,
  readyCard, readyPet, realPet, realSwap, setSpeedViaPanel, sleep, snap, tapUlt, waitPhase,
} from './lib.mjs';

const profile = process.argv[2] ?? 'phone';
const fastSpeed = Number(process.argv[3] ?? 2); // debug panel buttons: 0.5 / 1 / 2 / 4
const seedArg = process.argv[4] ? Number(process.argv[4]) : null;
const tag = `${profile}-run${seedArg ?? ''}`;
const pt = await launch(profile, { tag });
const { page, input } = pt;
const log = [];
const L = (...a) => {
  const line = a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  log.push(line);
  console.log(line);
};
const gdPol = goedamPolicy();
const report = { profile, fastSpeed, goedam: gdPol.name, floors: [], swaps: [], targetChecks: [], fps: [], rooms: [], shots: pt.shots, errors: pt.errors, log };

try {
  await page.goto(BASE);
  await waitPhase(page, 'preset');
  await sleep(400);
  await pt.shot('preset', 'preset screen');
  report.presetBoxes = await page.evaluate(() => {
    const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
    return { start: r('.btn-start'), card: r('.ps-card'), petCard: r('.ps-pet') };
  });
  await input.tap(await center(page, '.btn-start'));
  await waitPhase(page, 'combat');
  if (seedArg != null) {
    await page.evaluate(s => window.__proto.startRun({ seed: s }), seedArg);
    await waitPhase(page, 'combat');
  }
  report.seed = await page.evaluate(() => window.__proto.game.state.seed);
  await armGoedam(page, gdPol);
  await sleep(250);
  await pt.shot('floor1-start', 'floor 1 banner');
  report.hud = await hudBoxes(page);

  let lastSwapReal = 0;
  let swapShots = 0;
  let petShots = 0;
  let ultShots = 0;
  let periodic = 0;
  let prevFloor = 1;
  let floorRealStart = Date.now();
  let floorPerfStart = await now(page);
  let floorDeaths = 0;
  let prevDead = [false, false, false];
  let lastEmptyShot = 0;
  let enrageShot = false;
  let bossShots = 0;
  let emptySince = null;
  let emptyTotal = 0;
  const startWall = Date.now();
  let curSpeed = 1;

  while (Date.now() - startWall < 9 * 60_000) {
    const s = await snap(page);
    if (!s) break;
    if (s.app === 'result' || s.phase === 'runOver') {
      L('RUN OVER', s.runResult);
      report.result = s.runResult;
      await sleep(400);
      await pt.shot(`runover-f${s.floor}`, 'run over banner');
      break;
    }
    if (s.app === 'reward') {
      const fs1 = await frameStats(page, floorPerfStart, await now(page));
      const tel = await page.evaluate(() => window.__proto.game.telemetry());
      const ft = tel.floorTimes[tel.floorTimes.length - 1];
      const rec = { floor: s.floor, kind: s.kind, simSeconds: ft?.seconds, realSeconds: (Date.now() - floorRealStart) / 1000, speed: curSpeed, myDeaths: floorDeaths, bots: s.bots, me: s.me.stats, fps: fs1, emptyFieldSec: +emptyTotal.toFixed(1) };
      report.floors.push(rec);
      L('FLOOR CLEAR', rec);
      await sleep(500);
      await pt.shot(`reward-f${s.floor}`, s.kind === 'boss' ? 'relic offers' : 'reward offers');
      const offer = await pickReward(pt, 0);
      L('picked', offer?.name, offer?.rarity, offer?.isRelic ? 'relic' : '');
      const room = await afterReward(pt, gdPol, { shot: report.rooms.length === 0 ? `goedam-f${s.floor}` : null });
      if (room) {
        report.rooms.push(room);
        L('goedam', room.roomId, room.optionId, '→', room.outcome.id);
      }
      await waitPhase(page, 'combat', 15000).catch(() => {});
      floorRealStart = Date.now();
      floorPerfStart = await now(page);
      floorDeaths = 0;
      emptyTotal = 0;
      emptySince = null;
      await sleep(200);
      const s2 = await snap(page);
      if (s2 && s2.floor !== prevFloor) {
        prevFloor = s2.floor;
        await pt.shot(`floor${s2.floor}-start`, `${s2.kind} floor start`);
        if (s2.floor >= 2 && curSpeed !== fastSpeed) {
          curSpeed = await setSpeedViaPanel(pt, fastSpeed);
          await pt.shot('debug-panel', 'debug panel open');
          await closePanel(pt);
          L('speed', curSpeed);
        }
      }
      if (s2 && s2.floor > 6) break;
      continue;
    }
    if (s.app === 'spectate') {
      L('SPECTATE at floor', s.floor, s.floorTime);
      await pt.shot(`spectate-f${s.floor}`, 'spectating');
      report.spectate = { floor: s.floor, t: s.floorTime };
      // let bots play on for a bit at high speed, then show result
      await setSpeedViaPanel(pt, 4);
      await closePanel(pt);
      await sleep(15000);
      const s3 = await snap(page);
      L('after spectate', s3?.floor, s3?.runResult);
      break;
    }

    // deaths
    s.me.party.forEach((m, i) => {
      if (m.dead && !prevDead[i]) {
        floorDeaths++;
        L(`death: ${m.id} floor ${s.floor} t=${s.floorTime}`);
      }
      prevDead[i] = m.dead;
    });
    // empty field
    if (s.me.active == null && !s.me.out) {
      if (emptySince == null) emptySince = s.floorTime;
      if (Date.now() - lastEmptyShot > 20000) {
        lastEmptyShot = Date.now();
        await pt.shot(`empty-f${s.floor}`, 'my field empty');
      }
    } else if (emptySince != null) {
      emptyTotal += s.floorTime - emptySince;
      emptySince = null;
    }

    // boss floor observation shots
    if (s.kind === 'boss') {
      const tele = await page.evaluate(() => window.__proto.game.state.telegraphs.filter(t => t.team === 'enemy').length);
      if (tele > 0 && bossShots < 4) {
        bossShots++;
        await pt.shot(`boss-telegraph-${bossShots}`, `boss telegraph t=${s.floorTime}`);
      }
      if (s.enraged && !enrageShot) {
        enrageShot = true;
        await pt.shot('boss-enrage', `enrage hp=${s.boss?.hp}/${s.boss?.max}`);
        report.enrage = { floorTime: s.floorTime, boss: s.boss };
        L('ENRAGE', s.boss);
      }
    }

    // ult
    if (s.me.ult >= 1 && s.me.active != null) {
      const ok = await tapUlt(pt);
      if (ok && ultShots < 2) {
        ultShots++;
        await sleep(150);
        await pt.shot(`ult-${ultShots}`, 'ult cut-in');
      }
      L('ult', ok, 'floor', s.floor, 't', s.floorTime);
    }

    // swap every ~4 s (sim time at speed 1 ≈ real; at higher speed keep ~4 s of sim time)
    const swapGapReal = 4000 / curSpeed;
    const needSwap = Date.now() - lastSwapReal >= swapGapReal || s.me.active == null;
    if (needSwap) {
      const order = [0, 1, 2].filter(i => i !== s.me.active);
      const i = await readyCard(page, order);
      const foes = await page.evaluate(() => window.__proto.game.state.entities.filter(e => e.team === 'enemy' && e.hp > 0).length);
      if (i >= 0 && (foes > 0 || s.me.active == null)) {
        const shotsNow = swapShots < 2 && s.floor === 1;
        const label = shotsNow ? `swap${swapShots + 1}` : '';
        const r = await realSwap(pt, i, {
          holdShot: shotsNow ? `${label}-hold` : undefined,
          landShots: shotsNow ? [[`${label}-land-60ms`, 60], [`${label}-land-300ms`, 300], [`${label}-land-900ms`, 900]] : [],
          opts: { radius: 2.5, includeBoss: s.kind === 'boss' },
        });
        if (shotsNow) swapShots++;
        lastSwapReal = Date.now();
        report.swaps.push({ floor: s.floor, t: s.floorTime, idx: i, ok: r.ok, n: r.n, hold: r.holdInfo });
        if (!r.ok) L('swap failed', r);
        // target check: shortly after landing, is the new character targeting the enemy nearest to the drop point?
        if (r.ok) {
          // appear lock is 0.5 s of sim time: sample right after it
          await sleep(Math.max(60, 650 / curSpeed - (shotsNow ? 900 : 0)));
          const tc = await page.evaluate(w => {
            const g = window.__proto.game;
            const s = g.state;
            const me = s.players[0];
            const e = s.entities.find(x => x.id === me.party[me.activeIndex].entityId);
            if (!e) return null;
            const foes = s.entities.filter(x => x.team === 'enemy' && x.hp > 0);
            let best = null;
            for (const f of foes) {
              const d = Math.hypot(f.pos.x - e.pos.x, f.pos.y - e.pos.y) - f.radius;
              if (!best || d < best.d) best = { id: f.id, d, tier: f.tier };
            }
            const t = foes.find(x => x.id === e.targetId);
            return { drop: w, pos: e.pos, targetId: e.targetId, targetTier: t?.tier ?? null, targetDist: t ? Math.hypot(t.pos.x - e.pos.x, t.pos.y - e.pos.y) - t.radius : null, nearest: best };
          }, r.world);
          if (tc) report.targetChecks.push({ floor: s.floor, ...tc });
        }
      }
    }

    // pets: when a decent cluster is around
    const pi = await readyPet(page);
    if (pi >= 0) {
      const c = await clusterFinger(page, { radius: 3 });
      if (c && c.n >= 3) {
        const r = await realPet(pt, pi, { shotName: petShots < 1 ? 'pet-hold' : undefined });
        if (petShots < 1) {
          petShots++;
          await sleep(250);
          await pt.shot('pet-land', 'pet effect');
        }
        L('pet', pi, r.ok, 'n', r.n);
      }
    }

    // periodic shots
    if (Date.now() - periodic > (curSpeed > 1 ? 7000 : 12000)) {
      periodic = Date.now();
      await pt.shot(`f${s.floor}-t${Math.round(s.floorTime)}`, `alive=${s.alive} waves=${s.waves}`);
    }
    await sleep(200);
  }

  report.final = await snap(page);
  report.telemetry = await page.evaluate(() => window.__proto.game?.telemetry());
  // result screen
  await page.waitForFunction(() => window.__proto.phase === 'result', undefined, { timeout: 8000 }).catch(() => {});
  if ((await page.evaluate(() => window.__proto.phase)) === 'result') {
    await sleep(500);
    await pt.shot('result', 'result screen');
  }
} catch (e) {
  L('ERROR', String(e?.stack ?? e));
  await pt.shot('error').catch(() => {});
} finally {
  fs.writeFileSync(`/tmp/playtest-${tag}-report.json`, JSON.stringify(report, null, 1));
  console.log('errors:', pt.errors);
  await pt.browser.close();
}
