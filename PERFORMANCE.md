# Performance & Engineering Notes

A running log of the perf work and the more interesting design decisions in Dragon Raiders. Roughly chronological where it helps the story.

---

## Performance Improvements

### 1. `InstancedMesh` per block type — Phase 1 (foundational)

**File:** `client/src/world/voxelWorld.ts`

Every block of the same type (`stone`, `brick`, `pillar`, `torch`) shares a single `InstancedMesh`. The Phase 4 dungeon has ~10,000+ blocks; without instancing that'd be 10,000 draw calls per frame. With instancing it's 4. None of the later optimizations would have meant anything without this foundation.

### 2. Monster aggro range (16u) — Phase 3

**File:** `client/src/game.ts` (`MONSTER_AGGRO_RANGE`)

Monsters further than 16u from the player skip their AI tick entirely. Otherwise every spawned monster in the dungeon would run pathfinding every frame trying to walk through walls toward the player. The radius is intentionally smaller than the 18-voxel cell size so monsters in different rooms stay put.

### 3. Trickle spawning with active cap — Phase 3 polish

**File:** `client/src/game.ts` (`MAX_ACTIVE_MONSTERS = 3`)

Bounded simultaneous AI cost regardless of how big the dungeon gets. The pool has ~19 monsters in it but at most 3 are alive at once.

### 4. `TorchPool` with 6 fixed lights — Phase 4 perf round 1 (the big one)

**File:** `client/src/world/torchPool.ts`

The single biggest performance win. Before: one `PointLight` per torch block → ~28 active lights in a 5×5 dungeon. Three.js's material shaders loop over every visible light, so 28 lights × every shaded pixel/vertex was murder.

After: a fixed pool of 6 `PointLight`s repositioned each frame to the 6 *nearest* torches to the player, with a distance-based intensity fade (`FADE_START = 14u`, `FADE_END = 28u`). The torch blocks themselves stay glowing via the material's emissive — only the area-light contribution is pooled.

Two important details:
- **Fixed slot count** avoids shader recompilation. If you toggle `light.visible` on/off, Three.js recompiles the lighting shader (different `NUM_POINT_LIGHTS`) which causes a multi-frame stutter. Keeping count constant and just varying intensity (including to zero) avoids that.
- **Sort, don't track**: each frame I just sort all torch positions by distance to the player and assign the top K. The "snap" when a torch leaves the top-K is barely noticeable because it leaves at the *farthest, dimmest* slot.

### 5. Voxel `castShadow = false` — Phase 4 perf round 1

**File:** `client/src/world/voxelWorld.ts`

The voxel mesh still `receiveShadow = true` so the dragon's silhouette still falls on the floor. But ~10,000 instances no longer get rasterized into the shadow map every frame.

### 6. Shadow map 2048² → 1024² + `PCFSoftShadowMap` → `PCFShadowMap` — Phase 4 perf round 1

**File:** `client/src/main.ts`

4× less shadow texture work, and a cheaper filter. The chunky voxel aesthetic doesn't visibly benefit from soft-edged shadows.

### 7. Pixel ratio cap progressively dropped 2.0 → 1.5 → 1.25 — Phase 4 perf rounds 1 & 2

**File:** `client/src/main.ts`

On a 2.0-DPR display, capping at 1.25 means ~40% the pixel count of native. Together with `antialias: false`, this is a fill-rate win on integrated GPUs and Retina laptops without the picture going noticeably crunchy.

### 8. `MeshStandardMaterial` → `MeshLambertMaterial` everywhere — Phase 4 perf round 2 (the second big one)

**Files:** `voxelWorld.ts`, `monsters.ts`, `dragon.ts`, `viewmodel.ts`, `treasurePile.ts`, `projectile.ts`, `fireball.ts`

`MeshStandardMaterial` does per-pixel PBR — metalness, roughness, GGX specular, the works. `MeshLambertMaterial` does per-vertex Gouraud lighting. For voxel cubes, where each face has only 4 vertices, the lighting math runs at vertex shader time and gets interpolated across the face — ~4–5× less ALU per fragment in the dominant voxel pass.

Trade-off: lost subtle metallic specular on the sword/gold/gems. All emissive glow (torches, fireballs, gem highlights, dragon's mouth glow) is preserved because Lambert supports the `emissive` channel.

### 9. `antialias: false` — Phase 4 perf round 2

**File:** `client/src/main.ts`

Dropped MSAA. Voxel edges go from softly anti-aliased to crisp single-pixel boundaries — which is Minecraft-style and arguably better for the aesthetic. 30–50% fill-rate savings on integrated GPUs.

### 10. Particle capacity 600 → 300 — Phase 4 perf round 2

**File:** `client/src/combat/particles.ts`

The system never actually filled 600 in practice. Half the per-frame attribute buffer upload to the GPU.

### 11. Monster `castShadow = false` + dragon casts shadow only from silhouette parts — Phase 4 perf round 2

**Files:** `monsters.ts`, `dragon.ts`

Monsters skip shadow casting entirely. The dragon keeps shadow casting on body, head, four legs, and the first two tail segments — the parts that contribute to a recognizable floor silhouette. Removed casters: eyes, horns, jaw, mouth glow, wings, smallest tail tip. Cut the shadow pass from ~40 caster meshes down to ~8 while keeping the dramatic boss-floor shadow.

### Compounded result

Roughly 5–10× perceived framerate improvement over the un-optimized Phase 4. The two biggest individual wins were **TorchPool** (round 1) and **`Standard → Lambert`** (round 2). The smaller tweaks compounded on top of those.

---

## Other Interesting Technical Things

### Web Audio synthesized SFX — zero asset files

**File:** `client/src/audio/sound.ts`

Every sound effect — sword swings, shuriken whips, monster hits, dragon roars, fire breath, fireball impacts, the C-E-G-C victory chord, the loot coin shower — is generated procedurally from oscillators and a single 0.6s shared white-noise buffer. No `.wav` or `.mp3` files exist in the repo.

The two primitives are:

- **`playNoise(filterStart, filterEnd, duration, gain)`** — a `BufferSourceNode` feeding the noise buffer through a lowpass `BiquadFilter` whose cutoff frequency ramps exponentially over `duration`. Sweeping the cutoff from high to low gives a "whoosh" feel; both directions give "whip" feels.

- **`playThump(startHz, endHz, duration, gain, type)`** — an `OscillatorNode` whose pitch ramps exponentially. Sub-bass thumps for impacts; sawtooth for the dragon's roar.

Per-key throttling (`canPlay(key, minInterval)`) prevents machine-gun audio when monsters take rapid damage.

### Single-bitmap dungeon generation

**File:** `client/src/world/dungeon.ts`

Instead of generating rooms and corridors separately and figuring out where they intersect, the whole layout drives off **one `Uint8Array` "passable" bitmap**. Rooms write 1s into their footprint; corridors carve 1s in 2-wide L-shapes between cell centers. Then a single second pass walks every cell and decides:

- Passable cell → place a floor block, and (if not under the boss room) a sparse lattice ceiling block above.
- Non-passable cell with at least one passable 8-neighbor → place a 5-tall wall column.

This handles room interiors, corridor floors, room walls, corridor walls, and door openings *uniformly* — without ever needing to think about them as different geometry types. Adding "no ceiling above boss room" was a single `if` in the floor branch.

### Two coordinate-system conventions (the infamous facing bug)

**Files:** `entities/monsters.ts`, `entities/dragon.ts`, `world/dungeon.ts`

The player's camera has its default forward along *local `-Z`* (Three.js camera convention). So `Player.getForwardFlat` returns `(-sin yaw, 0, -cos yaw)` and the yaw to face a target is `atan2(-dx, -dz)`.

But the monster and dragon *meshes* are built with eyes / heads / sword tips at *local `+Z`*. Their forward in world is `(sin yaw, 0, cos yaw)` and the yaw to face a target is `atan2(dx, dz)`.

Someone (me, multiple turns earlier) had copied the player formula into the monster code. The result: every monster turned to face *away* from the player. The dragon's mouth ended up at its tail, fireballs spawned from its rump, the fire-breath particles streamed out of its back. It was visible for weeks and nobody noticed until you did. The fix touched ~10 sites across three files; the treasure-drop position happened to be unaffected because the two negations cancelled.

### Dragon: full state machine + animated rigging

**File:** `client/src/entities/dragon.ts`

The dragon is a state machine with nine states: `idle → engaging → phase1 → takeoff → phase2 → landing → phase3 → dying → dead`. Transitions are driven by HP thresholds (66%, 33%, 0%) and timed transition windows.

The mesh has **pivot groups** for animated parts:
- `wingPivotL/R` anchored at the body-side hinge so wings flap around the right pivot point (not around the wing's midpoint).
- `jawPivot` anchored at the back of the head so the jaw rotates open instead of sliding down.

The mouth has its own emissive `MeshBasicMaterial` sphere plus a dedicated `PointLight` whose intensity ramps during the fire-breath telegraph, so the dragon visibly charges before exhaling.

### First-person viewmodel with `depthTest: false`

**File:** `client/src/entities/viewmodel.ts`

The sword and shuriken are parented directly to the camera (`camera.add(this.viewModel.root)`), which is itself in the scene tree so its children render. Every material on the viewmodel has `depthTest: false` and `renderOrder: 9999` — meaning the weapon *always* draws on top of everything, even when its world-space position would technically be inside a wall.

The swing animation is broken into windup (22%), chop (43%), and return (35%) with eased interpolation between three keyframe poses. The original swing math used a single-stage interpolation that I had wrong, and the sword swung *toward* the player before I rewrote it cleanly with explicit phase boundaries.

### Vite file polling for WSL

**File:** `client/vite.config.ts`

Not a runtime perf change — but `server.watch.usePolling: true` saved hours of debugging time. WSL/devcontainer setups don't get reliable filesystem event notifications, so Vite was silently serving stale TypeScript even after I'd saved updates. The first time this happened we wasted a round of "but the code looks right!" before I noticed. Polling at 200ms is invisible to me and 100% reliable.

### Trickle monster spawning

**File:** `client/src/game.ts`

After you said "too many monsters", the spawn model flipped from "place all 19 at game start" to:
- 1 monster pre-spawned within 6–22u of the player at game/restart
- Every 15s, *if* fewer than 3 active *and* an unspawned spec exists in the 8–50u band around the player, spawn the nearest matching one.
- 4s retry on failed attempts so monsters appear shortly after you walk into range.

The player perceives them "drifting in" near them rather than swarming, and the cap means combat is never overwhelming even in dense rooms.

### Health-bar billboards with text labels

**Files:** `client/src/ui/healthBar.ts`, `client/src/entities/monsters.ts`

Each monster's HP bar is a small Three.js `Group` with a dark background plane, a red foreground plane scaled by hp ratio (anchored to its left edge via a vertex translation so it shrinks from the right), and a *Sprite* showing the monster's name on a `CanvasTexture` colored per type (`#88dd55` Troll, `#cdd2e0` Knight, `#ffe5a8` Jiujitsu). Each frame the group's quaternion is copied from the camera so it always faces you. All three planes/sprites have `depthTest: false` so they read clearly even when the monster is partly behind a wall.

### Dragon hit detection vs huge body

**File:** `client/src/entities/dragon.ts`

The katana and shuriken cone tests on monsters use a point-vs-cone check, but the dragon body is much larger than a point. Instead of doing per-mesh-part collision, the dragon exposes two hit tests:
- `isHitByMelee(playerPos, forwardFlat)` — `flatDist <= KATANA_RANGE + bodyRadius (3.0)` and the dragon center is inside the player's front cone, with a vertical clamp `|dy| ≤ height * 0.8` so airborne dragon correctly ignores melee.
- `isHitByProjectile(projPos)` — 2.5u sphere check against the body center + half-height.

Generous enough that the player feels like their swings land on the giant beast; cheap enough that it's two dot products per swing.
