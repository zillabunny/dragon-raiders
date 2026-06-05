# Phase 6 Pre-flight Handoff

> Written before a system restart so the next session can resume Phase 6 (multiplayer) without re-deriving the context. Single source of truth for "where we are, where we decided to go, and what we already chewed through."

---

## State of the world

- **Live game:** https://dragonraiders.goblingames.gg/
- **Repo:** https://github.com/zillabunny/dragon-raiders
- **Latest commit at handoff:** `b053d2b` (custom domain fix)
- **Working tree:** clean. Local `main` is in sync with `origin/main`.
- **Phases done:** 1 through 5 + doors feature + perf pass. Game is end-to-end playable single-player.
- **Hosting:** static via GitHub Pages, auto-deploy on push to `main` via `.github/workflows/deploy.yml`.
- **Custom domain:** `dragonraiders.goblingames.gg` (CNAME at `client/public/CNAME`, also set on Pages config). DNS is already propagated, HTTPS is active.
- **Analytics:** GA4 wired with Measurement ID `G-D5Z1BRT10J`. Custom events: `game_start`, `game_restart`, `player_death`, `dragon_defeated`, `treasure_looted`, `escape_success` (param: `time_left`), `escape_failure` (param: `distance_to_exit`). Treat numbers as ~80% sample because ~20% of visitors run ad blockers.

## Direction picked for Phase 6

**Phase 6 *MVP first*, not full Phase 6.**

The full Phase 6 (server-authoritative simulation of all entities, client-side prediction + reconciliation for everything) is the doc's "budget a week" warning. We're starting smaller and using the MVP as a decision point:

> Build the absolute minimum slice — two browser tabs see each other walking around the same dungeon — and use the experience to decide whether to keep investing in the full sync layer.

This MVP forces every architectural decision (server framework, hosting, room codes, simulation loop, client interpolation, repo restructure) while keeping rollback cheap if multiplayer doesn't feel good enough on a free-tier server.

### MVP scope (exact)

- Lobby UI: host creates a room → 4-char code shown. Friend enters code → joins same room.
- Server is authoritative. Runs at ~20–30 Hz.
- Sync only: each player's `position`, `yaw`, `pitch`. Plus connect/disconnect.
- Both clients render a remote-controlled ninja for the other player. **Interpolate** remote positions; **predict** local player movement.
- **No** monsters, dragon, doors-state-sync, projectiles, escape timer, treasure pile, combat, voice. Single-player simulation keeps running on the client for those during MVP — they're just non-shared.
- Decision point at the end: *"Does this feel good enough?"* If yes, sync monsters next, then dragon, doors, projectiles. If no, revert and pursue daily seeded dungeons or polish.

### Three off-ramps we considered and skipped (record for future re-evaluation)

1. **Full Phase 6 now** — too big to commit to without first feeling the latency.
2. **Daily seeded dungeons** — make the dungeon seed = today's date so everyone gets the same map. Zero server. ~1 turn of work. Surprisingly social ("did you beat today's?").
3. **Single-player polish** — dash/dodge roll, shadow slime monster, harder boss, balance pass. Small turns each.

If MVP fails or the user changes direction, go to #2 first (cheapest), then #3.

## Hosting situation (Fly.io is dead)

Fly.io effectively killed its free tier (~$5/mo minimum now). Re-eval at decision time, but the current landscape:

| Option | Cost | Catch |
|---|---|---|
| **Cloudflare Workers + Durable Objects** | Free (100k DO req/day) | Requires writing for the DO API, not Colyseus directly |
| **PartyKit** (Cloudflare DO under the hood, game-specific API) | Free tier solid | Modern API, closest thing to "Colyseus but free." Strong candidate. |
| **Render free tier** | Free | Spins down after 15 min idle → ~30s cold start. Bad first-impression UX |
| **Oracle Cloud Free Tier** | Genuinely free forever | Enterprise UX, known for reclaiming "idle" VMs |
| **Render / DigitalOcean / Fly.io paid** | ~$5–7/mo | Reliable, no surprises |
| **Self-host** (Pi / old laptop) | $0 | Open ports, home network reliability |

**Probable answer:** PartyKit on Cloudflare DOs if free hosting matters; ~$5/mo Render/Fly otherwise. Lock the choice with the framework choice (see Decisions below).

## Decisions to lock before coding

1. **Server framework** — Colyseus (doc's choice, well-documented but needs paid hosting) vs PartyKit (free on Cloudflare, modern API) vs raw WebSocket + bespoke room code. **Lean: PartyKit.**
2. **Hosting target** — couples to (1).
3. **Repo layout** — currently just `client/`. Need a `server/`, possibly a `shared/`:
   - Option A: sibling dirs `client/` and `server/`, no formal sharing. Copy-paste types for MVP.
   - Option B: npm workspaces with `client/`, `server/`, `shared/` (types + later, simulation code).
   - **Lean: A for MVP, refactor to B if it grows.** MVP doesn't need shared simulation — server only handles position broadcast.
4. **Server tick rate** — start at 20 Hz, bump to 30 if it feels sluggish.
5. **Authoritative model** — server source of truth; client predicts its own movement and reconciles on server snapshot. For MVP that's just "don't snap the local player to server's echo of their own position; do snap remote players."
6. **Lobby/UX** — overlay form on the start screen: `[Host New Game]` `[Join with code: ____]`. Show 4-char code after host. Copy-link button later.

## Important existing conventions (don't relearn)

- **Mesh forward = local +Z** for monsters/dragon (heads, eyes, sword tips at +Z). **Player camera forward = local -Z** (Three.js camera default). When facing a target: `atan2(dx, dz)` for mesh yaw, `atan2(-dx, -dz)` for camera yaw. *We got bit by this once — every monster faced away from the player. See commits ~early June.*
- **WSL/devcontainer Vite needs polling.** `vite.config.ts` has `usePolling: true, interval: 200`. Without it the dev server silently serves stale TypeScript. Don't remove.
- **Pointer-lock + focus loss = stuck keys.** `Player.releaseAllInputs()` is wired to `blur`, `visibilitychange`, and `pointerlockchange→unlocked`. Don't break this when refactoring input.
- **Mouse delta clamp:** `MOUSE_DELTA_CAP = 200` px/event in `player.ts` prevents view-snap from browser-coalesced movement events.
- **Lambert everywhere** (voxels, monsters, dragon, viewmodel, treasure, projectiles, fireball). Standard was 4–5× slower. Don't undo.
- **TorchPool of 6 lights**, not one per torch. Bounded fragment shader cost regardless of dungeon size.
- **Voxel `castShadow = false`**, dragon body parts still cast. Monster shadows off.
- **Vite `base: "./"` for prod**, normal `/` for dev. Works at both the GitHub Pages subpath URL and the custom domain root. Don't change.

## File map for resuming

| Path | Purpose |
|---|---|
| `DRAGON_RAIDERS.md` | Original design doc + phase plan + monster specs |
| `PERFORMANCE.md` | Perf history + engineering notes |
| `README.md` | Public-facing; play link, controls, build story |
| `PHASE6PRE.md` | **This file** |
| `client/src/main.ts` | Boot + scene/renderer/lights setup |
| `client/src/game.ts` | Orchestrator (~629 lines, biggest besides dragon) |
| `client/src/entities/player.ts` | Player class — all input handling, mouse + keys + pointer lock |
| `client/src/entities/dragon.ts` | ~709 lines, full state machine + attacks + animated mesh |
| `client/src/entities/monsters.ts` | Base + Troll/Knight/Jiujitsu (~504 lines) |
| `client/src/world/voxelWorld.ts` | InstancedMesh blocks + collision API |
| `client/src/world/dungeon.ts` | Procgen, door specs, monster spawn specs |
| `client/src/analytics.ts` | GA4 wrapper |
| `.github/workflows/deploy.yml` | Pages auto-deploy on push to `main` |
| `client/public/CNAME` | `dragonraiders.goblingames.gg` |
| `client/vite.config.ts` | Polling watch + `base: "./"` for production |

Totals: **4,474 lines of TypeScript** across 21 files. Phase 5 + doors + analytics + custom domain are all in.

## Open workflow gotchas

- **Node 20 actions deprecation:** every Actions run warns about this. Forced switch to Node 24 on **2026-06-16**, fully removed **2026-09-16**. `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4` need their next major versions when convenient. Non-urgent but on the clock.
- **Analytics undercount:** uBlock Origin + similar block ~20% of sessions. Trust ratios, not raw counts.
- **`gh` CLI auth** in this terminal was at `/home/node/.config/gh/hosts.yml` and persisted from `gh auth login` earlier this session. May or may not survive the restart depending on whether the devcontainer is rebuilt. If `gh auth status` shows logged out after restart, run `gh auth login` again.

## Quick-start commands when resuming

```bash
cd /workspaces/dragon-raiders
git pull origin main                       # sync (likely already clean)
cd client && npm install                   # if node_modules got nuked
npm run dev                                # confirm single-player still works at localhost:5173
cd ..
gh auth status                             # confirm auth persisted; if not: gh auth login
```

## A suggested opening prompt for the next session

> Resume Phase 6 MVP. Read PHASE6PRE.md for context. Recommend: PartyKit (free Cloudflare hosting) or Colyseus (doc's choice but needs paid hosting)? Pick one, then propose the repo restructure (server/ and shared/?) and the first 3–4 file scaffolding turn. MVP scope is two browser tabs sharing player position only — no monsters, dragon, doors, or combat sync.

## Memory note

Project memory at `/home/node/.claude/projects/-workspaces-dragon-raiders/memory/` persists across sessions independently of this file. The `phase1_state.md` there has been kept current through every phase and is another way to recover context if this file gets stale.
