# 🐉 Dragon Raiders

A 3D voxel-style dungeon crawler where a ninja raids a monster-infested dungeon, slays a boss dragon, loots its hoard, and escapes the collapse. Built in the browser with Three.js — no installs, just a link.

**▶ Play: https://dragonraiders.goblingames.gg/**

> Click the screen to start (this also unlocks audio). Press **R** to restart after a win or death.

---

## Controls

| Action | Key |
|---|---|
| Move | **W A S D** |
| Jump | **Space** |
| Sprint | **Shift** |
| Look | **Mouse** |
| Attack | **Left click** |
| Katana | **1** |
| Throwing stars | **2** |
| Swap weapon | **Q** |

## How to play

1. Fight your way through the dungeon — Trolls throw axes, Statue Knights ambush you (hit them from behind!), and Jiujitsu Masters grapple you, so keep them at range with stars.
2. Find the **dragon** at the center of the maze (follow the open-air arena).
3. Survive the three-phase boss fight: ground attacks → airborne fireballs → enraged fire breath.
4. Loot the treasure pile it drops — but grabbing it **collapses the dungeon**.
5. **Race back to the exit** before the timer runs out. Follow the green beacon and the on-screen chevron.

## Tech

- **Three.js** (WebGL) + **TypeScript**, bundled with **Vite**
- 100% procedural: voxel dungeon generation, all sound effects synthesized via the Web Audio API, no external art or audio assets
- Single static bundle (~142 KB gzipped), deployed to GitHub Pages

## Built in phases

This was built incrementally, each phase playable before the next:

1. **Voxel world + movement** — first-person controller, blocky dungeon room
2. **Combat + monsters** — katana & throwing stars vs. three distinct enemy types
3. **Procedural dungeon** — a 5×5 grid of rooms and corridors, difficulty scaling toward the center
4. **Boss dragon fight** — multi-phase fight with a screen-top health bar
5. **The escape** — collapse timer, retrace to the exit to win

(Phase 6 — multiplayer — is the planned next step.)

See [`PERFORMANCE.md`](./PERFORMANCE.md) for the optimization log and engineering notes.

## Local development

```bash
cd client
npm install
npm run dev      # http://localhost:5173
npm run build    # production build into client/dist
```

---

Made with [Claude Code](https://claude.com/claude-code).
