# 🥷 Dragon Raiders — Game Design Document

> A 3D voxel-style dungeon crawler where ninjas raid a monster-infested dungeon, take down a boss dragon, and escape — with a twist: die, and you come back as a ghost who haunts the living.

---

## 🎯 The Vision (Full Game)

A multiplayer 3D blocky-world game (Minecraft-style aesthetic) where 1–8 **ninjas** spawn at the entrance of a procedurally generated dungeon. Armed with throwing stars and katanas, they fight their way through waves of monsters toward the center, where a **Boss Dragon** awaits. After defeating the dragon, they must escape the collapsing dungeon back to the surface before time runs out.

**The Ghost Twist:** When a ninja dies, they don't just lose — they respawn as a ghost. Ghosts can fly through walls, attack living ninjas (PvP), and try to sabotage the run. This creates emergent tension: the longer the dungeon takes, the more ghosts there are.

---

## 🛠️ Tech Stack (Recommended for Claude Code)

| Layer | Tool | Why |
|---|---|---|
| Engine | **Three.js** (browser, WebGL) | No installs, runs anywhere, Claude knows it well |
| Language | **TypeScript** | Catches bugs, better than vanilla JS for a game this size |
| Physics | **Cannon-es** or **Rapier** | Voxel collisions, projectiles |
| Multiplayer | **Colyseus** (Node.js) | Easiest authoritative game server framework |
| Assets | **Kenney.nl voxel packs** (free, CC0) | No art skills required |
| Build | **Vite** | Fast dev server |
| Hosting (later) | Fly.io / Railway for the server, Vercel for the client | Free tiers exist |

---

## 📦 Build in Phases (IMPORTANT)

Don't try to build the whole thing at once. Each phase should be **playable** before moving to the next.

### Phase 1 — Voxel World + Movement (single player)
- Block-based world (chunks of cubes, like Minecraft)
- First-person or third-person camera
- WASD movement, jump, mouse-look
- Simple lighting and skybox
- **Goal:** Walk around a blocky dungeon room.

### Phase 2 — Combat + Monsters
- Ninja has two weapons:
  - **Katana** (melee): close-range sword swing
  - **Throwing stars** (ranged): tap to throw, limited supply, pick more up from dropped enemies
- 3 monster types with distinct behaviors (see Monster Roster below)
- Monster health bars, death animations (particle puff is fine)
- **Goal:** Fight monsters in a room using both weapons and not die.

### Phase 3 — Dungeon Generation
- Procedurally generated dungeon: rooms connected by corridors
- Monsters spawn per room, difficulty scales toward the center
- Center room contains the Boss Dragon (just a placeholder model at first)
- **Goal:** Walk through a dungeon fighting monsters until you reach the dragon room.

### Phase 4 — Boss Dragon Fight
- Big dragon model in the center arena
- Multi-phase fight: flying, ground stomp, fire breath
- Visible health bar at top of screen
- Drops a key/relic on defeat
- **Goal:** A real boss fight that feels climactic.

### Phase 5 — The Escape
- After dragon dies, dungeon starts "collapsing" (timer + visual effect)
- Player must retrace their way to the exit
- Optional: extra monsters spawn during escape
- **Goal:** Win the game by escaping.

### Phase 6 — Multiplayer (the hard part)
- Spin up a Colyseus server
- Sync player positions, monster state, dragon state
- 1–8 players join via room code
- **Goal:** Two browser tabs can play together.

### Phase 7 — Ghost Mode
- On death, player becomes a ghost (translucent model, can fly, passes through walls)
- Ghosts can attack living players (small damage)
- Ghosts cannot attack monsters or the dragon
- Optional win condition for ghosts: kill all living players before they escape
- **Goal:** Death isn't game over — it's a role change.

---

## 🎮 Core Mechanics Spec

### The Ninja (Player Character)
- **Health:** 100 HP, regenerates slowly out of combat
- **Weapons:**
  - **Katana** — fast melee, 25 damage per swing, infinite use
  - **Throwing Stars (shuriken)** — ranged, 15 damage, start with 20, pick up more from defeated enemies
- **Movement:** Walk, sprint, jump, **double-jump** (ninjas!), crouch
- **Optional flair:** dash/dodge roll on a short cooldown

### Monster Roster (Phase 2)

| Monster | HP | Damage | Behavior |
|---|---|---|---|
| **Axe-Throwing Troll** | 60 | 20 | Lumbers toward you but stops at range to chuck axes. Dodge the axe, then close the distance. |
| **Statue Knight** | 80 | 15 | Looks like a harmless statue — stays frozen until you get close, then springs to life with a sword. Surprise factor. Heavily armored from the front; hit them from behind for extra damage. |
| **Jiujitsu Master** | 50 | 25 | Fast, unarmed. Tries to grapple you — if he gets in close, he locks you in a hold for 2 seconds (you take damage and can't move). Keep him at range with throwing stars. |
| **Shadow Slime** *(optional)* | 20 | 5 | Filler enemy. Hops toward player, splits in two when killed. Good for early levels. |

**Design note:** Each monster pushes the ninja toward a different playstyle — the troll teaches dodging, the statue teaches awareness/positioning, the jiujitsu guy teaches ranged play. Together they're a fun rock-paper-scissors.

### Boss Dragon (Phase 4)
- **HP:** 1000 (scales with player count)
- **Phase 1 (100%–66%):** Ground attacks, tail swipe
- **Phase 2 (66%–33%):** Takes flight, drops fireballs
- **Phase 3 (33%–0%):** Enraged, fire breath cone attack

### Ghost Rules (Phase 7)
- Half speed of living ninjas, but can fly and phase through walls
- Cannot pick up items or throwing stars
- Ghost damage: 3 HP per "haunt" attack
- Living ninjas can see ghosts but can't damage them
- Ghosts win if all living ninjas die before reaching the exit

---

## 📁 Suggested Project Structure

```
dragon-raiders/
├── client/
│   ├── src/
│   │   ├── world/        # voxel world, chunks
│   │   ├── entities/     # player, monsters, dragon, ghosts
│   │   ├── combat/       # weapons, damage, hitboxes
│   │   ├── ui/           # health bar, menus
│   │   ├── net/          # multiplayer client
│   │   └── main.ts
│   └── index.html
├── server/               # (added in Phase 6)
│   └── src/
│       └── rooms/        # Colyseus game rooms
├── assets/               # models, textures (Kenney packs)
└── README.md
```

---

## 🚀 How to Use This Doc with Claude Code

1. Open Claude Code in this folder.
2. Start with: **"Read DRAGON_RAIDERS.md and let's begin Phase 1. Set up the Vite + Three.js + TypeScript project."**
3. After each phase, **playtest with your daughter.** Note what's fun, what's broken.
4. Begin the next phase with: **"Phase 1 works. Let's start Phase 2."**
5. Don't try to skip ahead — each phase builds on the previous.

---

## ⚠️ Realistic Expectations

- **Phases 1–5** (single-player game with dragon boss): a focused weekend or two of work with Claude Code. Very achievable.
- **Phase 6** (multiplayer): expect debugging. Networked games are hard. Budget a week.
- **Phase 7** (ghosts/PvP): the fun finale, but only attempt after Phase 6 is solid.
- **Art:** You're using free voxel asset packs, not custom art. The game will look "Kenney-style," not custom Minecraft. That's fine and looks great.
- **Sound:** Free SFX from freesound.org or Kenney audio packs.

---

## 💡 Ideas for Later (Don't Build Yet)

- Different ninja clans with unique abilities (smoke bombs, grappling hook, invisibility)
- More monsters: samurai ghosts, giant spiders, sumo wrestlers, fire-breathing imps
- Multiple dungeon themes (ice temple, lava cave, bamboo forest)
- Loot drops and inventory (rare katanas, poison-tipped stars)
- Pet companion (a shadow fox?)
- Daily seeded dungeons (everyone plays the same map that day)

---

**Have fun building this together. Ship Phase 1 first.** 🎮
