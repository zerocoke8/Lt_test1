# Swap Tower prototype — working notes for Claude sessions

## The person
- A Korean game designer (not a programmer). **Always reply in Korean**, in plain language, short sentences, no code jargon.
- When a decision is needed: numbered questions, each with a recommended default marked (추천). They often answer "추천대로" or by number.
- They test on a phone (844×390 landscape) through the Fly URL; show screenshots (SendUserFile) of what changed.
- Decisions are recorded per round ("기획 N차") in `docs/game-design.md` (one `## N. N차 결정` section per round; §28 = 15차).

## Links
- Multiplayer game (Fly, app `swap-tower-zerocoke8`): https://swap-tower-zerocoke8.fly.dev — `.github/workflows/fly-deploy.yml` deploys on every push to `claude/design-notes-v0` or `main` that touches src/server/build files (docs-only pushes do not deploy).
- Solo-only build (claude.ai artifact): https://claude.ai/artifact/XERwnQ1oMjV743egXytiFk — after a round: `npm run build:artifact`, then publish `dist-artifact/index.html` to that same URL.

## Code map
- `src/sim` deterministic 30 Hz sim (seeded Rng; never Math.random/Date), `src/data` content, `src/render` Canvas 2D drawing, `src/ui` DOM HUD/screens, `src/audio` WebAudio synth SFX (file override `src/audio/files/<id>.mp3`), `src/net` client, `server` Node ws server (server-authoritative; runs the same sim).
- Docs: `docs/game-design.md` (decision log), `docs/balance.md` (benches, tables), `docs/prototype-architecture.md`, `docs/multiplayer.md`, feature specs (`goedam-rooms.md`, `combat-events.md`, `new-characters.md`, `boss-groggy.md`, `skill-renewal.md`, `sfx.md`, `expedition.md`), `docs/roguelike-choices.pdf`.
- Benches: `tests/review/critic-20f.ts` (20-floor clear rates, 240/960 runs on matched seeds), `tests/playtest/drag-bench.ts` / `drag-value.ts` / `ult-bench.ts`.

## Checks (run all before any commit to the deploy branch)
```
npx tsc --noEmit && npm run typecheck:server && npx vitest run
npm run build:all && npm run build:artifact
npx playwright test            # phone, desktop, multi projects; ~10 min
```
- Chromium is preinstalled at /opt/pw-browsers/chromium — never run `playwright install`.
- Parallel agents: build to their own outDir and set `E2E_OUT`, `E2E_PORT`, `E2E_RESULTS` so Playwright runs don't collide.
- New rules behind a toggle must keep default runs bit-identical (golden/determinism tests).

## How rounds are run
- Substantive work goes through a Workflow: design (2+ angles) → spec doc → build tracks → balance bench → integrate (full suite, e2e incl. 3-player multi, screenshots read by eye) → independent review lenses → fix pass.
- Subagents never commit. The main session verifies (checks above), then commits + pushes (this deploys), republishes the artifact, and reports in Korean with screenshots.
- While background agents are still editing, do NOT commit to `claude/design-notes-v0` (it would deploy half-done work). If the stop hook asks for a commit, push a snapshot to a non-deploying branch instead:
  ```
  TMPIDX=$(mktemp); export GIT_INDEX_FILE=$TMPIDX; git read-tree HEAD; git add -A -- . ':!dist-*'
  C=$(git commit-tree $(git write-tree) -p HEAD -m "WIP snapshot, not for deploy"); unset GIT_INDEX_FILE; rm -f $TMPIDX
  git push -f origin $C:refs/heads/wip/<round>
  ```
- Commit messages end with the Co-Authored-By / Claude-Session lines given in the session's system reminder. No model names in commits/PRs.

## Environment quirks
- OpenAI hosts (auth.openai.com, api.openai.com, chatgpt.com) are blocked by the environment network policy; the designer must allow them (environment settings → Network access) before Codex image generation can be used.
- Deleting remote branches via git push is blocked by the proxy — ask the designer to delete `wip/*` branches on GitHub.
- For Korean PDFs: Google Fonts (Noto Sans KR woff2 subsets) download fine; render HTML with Playwright Chromium `page.pdf()`.

## Current rules worth knowing (details in docs/game-design.md)
- Swap = drag a card onto the field; the new character appears there and casts its drag skill; the re-appear cooldown starts when a character LEAVES the field (6차). Stun pauses attack timers and cancels wind-ups (4차).
- Ult gauge is per character (15차): field character fills in 30 s, bench at 1/3 (debug sliders).
- 15 characters / 5 roles (탱커, 근접딜러, 원거리딜러, 힐러, 서포터); pets ×0.8 cooldowns; boss groggy; 괴담 rooms; 돌발 괴담; renewed multi-stage skills + ult cut-in; placeholder synth SFX.
- Modes: 클래식 탑 (20 floors) and 원정 (15차, 12 stages × 3 floors, gear 무기/방어구/장신구/유물, extract-or-continue).
- Next planned after testing 원정: move rendering to PixiJS on a new branch (sim/server/UI stay); write a consolidated current-rules spec + migration plan first.
