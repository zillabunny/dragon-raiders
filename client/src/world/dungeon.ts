import * as THREE from "three";
import type { VoxelWorld } from "./voxelWorld";
import type { MonsterKind, MonsterSpawnSpec } from "../entities/monsters";
import type { DoorSpec, DoorSide } from "../entities/door";

const GRID = 5;            // NxN grid of room cells
const CELL_SIZE = 18;      // each grid cell is CELL_SIZE x CELL_SIZE voxels
const PERIM = 2;           // padding around the dungeon
const CEILING = 5;         // walls/ceiling height
const CENTER = (GRID - 1) / 2; // boss-room cell coordinates

export interface DungeonResult {
  playerSpawn: THREE.Vector3;
  playerYaw: number;
  bossSpawn: THREE.Vector3;
  bossYaw: number;
  monsterSpawns: MonsterSpawnSpec[];
  doors: DoorSpec[];
  /** World-space center of the dungeon footprint, for shadow camera aiming. */
  center: THREE.Vector3;
}

const DOOR_BOTTOM = 0.5;
const DOOR_TOP = 5.0;
const DOOR_SLAB_HALF_THICKNESS = 0.1;

interface RoomCell {
  gx: number;
  gz: number;
  x0: number; z0: number; x1: number; z1: number;
  rank: number;       // Manhattan distance from center cell (boss = 0)
  isBoss: boolean;
  isEntrance: boolean;
}

/**
 * Procedurally builds a multi-room dungeon into the voxel world. Returns
 * player + boss spawn points and monster placements ranked by distance from
 * the boss room.
 */
export function generateDungeon(world: VoxelWorld, rng: () => number = Math.random): DungeonResult {
  const W = GRID * CELL_SIZE + 2 * PERIM;
  const D = GRID * CELL_SIZE + 2 * PERIM;
  const passable = new Uint8Array(W * D);
  const idx = (x: number, z: number) => z * W + x;
  const setPass = (x: number, z: number) => {
    if (x >= 0 && x < W && z >= 0 && z < D) passable[idx(x, z)] = 1;
  };
  const isPass = (x: number, z: number): boolean => {
    if (x < 0 || x >= W || z < 0 || z >= D) return false;
    return passable[idx(x, z)] === 1;
  };

  // --- 1. Lay out rooms in the grid ---------------------------------------
  const rooms: RoomCell[] = [];
  for (let gz = 0; gz < GRID; gz++) {
    for (let gx = 0; gx < GRID; gx++) {
      const isBoss = gx === CENTER && gz === CENTER;
      const isEntrance = gx === 0 && gz === 0;
      const minSize = isBoss ? 16 : 8;
      const maxSize = isBoss ? 18 : 12;
      const w = Math.floor(rng() * (maxSize - minSize + 1)) + minSize;
      const d = Math.floor(rng() * (maxSize - minSize + 1)) + minSize;
      const cellX0 = PERIM + gx * CELL_SIZE;
      const cellZ0 = PERIM + gz * CELL_SIZE;
      const padX = Math.floor((CELL_SIZE - w) / 2);
      const padZ = Math.floor((CELL_SIZE - d) / 2);
      const x0 = cellX0 + padX;
      const z0 = cellZ0 + padZ;
      const x1 = x0 + w - 1;
      const z1 = z0 + d - 1;

      rooms.push({
        gx, gz, x0, z0, x1, z1,
        rank: Math.abs(gx - CENTER) + Math.abs(gz - CENTER),
        isBoss,
        isEntrance,
      });

      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) setPass(x, z);
      }
    }
  }

  const bossRoom = rooms.find(r => r.isBoss)!;
  /** True if (x,z) sits inside the boss room's footprint — used to skip the ceiling. */
  const isInsideBoss = (x: number, z: number): boolean =>
    x >= bossRoom.x0 && x <= bossRoom.x1 && z >= bossRoom.z0 && z <= bossRoom.z1;

  // --- 2. Carve L-shaped 2-wide corridors between adjacent rooms -----------
  function carveCorridor(a: RoomCell, b: RoomCell): void {
    const ax = Math.floor((a.x0 + a.x1) / 2);
    const az = Math.floor((a.z0 + a.z1) / 2);
    const bx = Math.floor((b.x0 + b.x1) / 2);
    const bz = Math.floor((b.z0 + b.z1) / 2);
    const dx = Math.sign(bx - ax);
    const dz = Math.sign(bz - az);

    let x = ax, z = az;
    while (x !== bx) {
      setPass(x, z);
      setPass(x, z + 1);
      x += dx;
    }
    while (z !== bz) {
      setPass(x, z);
      setPass(x + 1, z);
      z += dz;
    }
    // Ensure the L corner is fully 2x2 passable.
    setPass(bx, bz);
    setPass(bx + 1, bz);
    setPass(bx, bz + 1);
    setPass(bx + 1, bz + 1);
  }

  const roomAt = (gx: number, gz: number) => rooms.find(r => r.gx === gx && r.gz === gz);
  for (const r of rooms) {
    const east = roomAt(r.gx + 1, r.gz);
    if (east) carveCorridor(r, east);
    const south = roomAt(r.gx, r.gz + 1);
    if (south) carveCorridor(r, south);
  }

  // --- 3. Translate passable map into voxels (floors, walls, ceiling) ------
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      if (isPass(x, z)) {
        world.setBlock(x, 0, z, "stone");
        // Sparse lattice ceiling everywhere except the boss arena, which is
        // left open to the sky so the dragon has airspace to fly in.
        if (!isInsideBoss(x, z) && (x + z) % 3 !== 0) {
          world.setBlock(x, CEILING + 1, z, "brick");
        }
      } else {
        // Wall only when adjacent (8-neighborhood) to passable space.
        let adjacent = false;
        for (let oz = -1; oz <= 1 && !adjacent; oz++) {
          for (let ox = -1; ox <= 1 && !adjacent; ox++) {
            if (ox === 0 && oz === 0) continue;
            if (isPass(x + ox, z + oz)) adjacent = true;
          }
        }
        if (adjacent) {
          for (let y = 1; y <= CEILING; y++) world.setBlock(x, y, z, "brick");
        }
      }
    }
  }

  // --- 4. Decorate the boss room with pillars ------------------------------
  {
    const pillars: Array<[number, number]> = [
      [bossRoom.x0 + 2, bossRoom.z0 + 2],
      [bossRoom.x1 - 2, bossRoom.z0 + 2],
      [bossRoom.x0 + 2, bossRoom.z1 - 2],
      [bossRoom.x1 - 2, bossRoom.z1 - 2],
    ];
    for (const [px, pz] of pillars) {
      for (let y = 1; y <= CEILING; y++) world.setBlock(px, y, pz, "pillar");
    }
  }

  // --- 5. Torches: one per room corner; boss room gets a full set ----------
  for (const r of rooms) {
    world.setBlock(r.x0 + 1, 3, r.z0 + 1, "torch");
    if (r.isBoss) {
      world.setBlock(r.x1 - 1, 3, r.z0 + 1, "torch");
      world.setBlock(r.x0 + 1, 3, r.z1 - 1, "torch");
      world.setBlock(r.x1 - 1, 3, r.z1 - 1, "torch");
    }
  }

  // --- 6. Player spawn at entrance, facing the boss room ------------------
  const entrance = rooms.find(r => r.isEntrance)!;
  const playerSpawn = new THREE.Vector3(
    (entrance.x0 + entrance.x1) / 2,
    1.0,
    (entrance.z0 + entrance.z1) / 2,
  );
  const bossCx = (bossRoom.x0 + bossRoom.x1) / 2;
  const bossCz = (bossRoom.z0 + bossRoom.z1) / 2;
  // Player.getForwardFlat returns (-sin(yaw), 0, -cos(yaw)). Solving for yaw
  // pointing the player toward the boss:
  const dirX = bossCx - playerSpawn.x;
  const dirZ = bossCz - playerSpawn.z;
  const playerYaw = Math.atan2(-dirX, -dirZ);

  // --- 7. Boss spawn at boss-room center ----------------------------------
  const bossSpawn = new THREE.Vector3(bossCx, 0.5, bossCz);
  // Dragon faces back toward the entrance for maximum drama. Mesh convention:
  // local +Z is the head, so yaw = atan2(dx, dz) of (entrance - boss).
  const bossYaw = Math.atan2(playerSpawn.x - bossCx, playerSpawn.z - bossCz);

  // --- 8. Monster spawns by rank ------------------------------------------
  const monsterSpawns: MonsterSpawnSpec[] = [];
  function pickKind(weights: Record<MonsterKind, number>): MonsterKind {
    const total = weights.troll + weights.knight + weights.jiujitsu;
    let r = rng() * total;
    if ((r -= weights.troll) < 0) return "troll";
    if ((r -= weights.knight) < 0) return "knight";
    return "jiujitsu";
  }

  for (const room of rooms) {
    if (room.isBoss || room.isEntrance) continue;
    let count: number;
    let weights: Record<MonsterKind, number>;
    if (room.rank === 1) {
      count = 1 + Math.floor(rng() * 2);  // 1–2, hard mix
      weights = { troll: 1, knight: 2, jiujitsu: 3 };
    } else if (room.rank === 2) {
      count = 1;                          // medium mix
      weights = { troll: 2, knight: 2, jiujitsu: 2 };
    } else if (room.rank === 3) {
      count = rng() < 0.6 ? 1 : 0;        // sparse
      weights = { troll: 3, knight: 1, jiujitsu: 1 };
    } else {
      count = 0;                          // corners stay empty
      weights = { troll: 1, knight: 1, jiujitsu: 1 };
    }
    const used = new Set<string>();
    for (let i = 0; i < count; i++) {
      // Try up to 8 times to find an unoccupied interior tile.
      let sx = 0, sz = 0;
      for (let attempt = 0; attempt < 8; attempt++) {
        sx = room.x0 + 2 + Math.floor(rng() * Math.max(1, room.x1 - room.x0 - 3));
        sz = room.z0 + 2 + Math.floor(rng() * Math.max(1, room.z1 - room.z0 - 3));
        const key = `${sx},${sz}`;
        if (!used.has(key)) { used.add(key); break; }
      }
      monsterSpawns.push({
        kind: pickKind(weights),
        position: new THREE.Vector3(sx, 0.5, sz),
        facing: rng() * Math.PI * 2,
      });
    }
  }

  // --- 9. Detect doorways and emit DoorSpecs ------------------------------
  const doors: DoorSpec[] = [];
  for (const room of rooms) {
    collectDoorsOnSide(room, "north", isPass, doors);
    collectDoorsOnSide(room, "south", isPass, doors);
    collectDoorsOnSide(room, "east",  isPass, doors);
    collectDoorsOnSide(room, "west",  isPass, doors);
  }

  const center = new THREE.Vector3(W / 2, 0, D / 2);
  return { playerSpawn, playerYaw, bossSpawn, bossYaw, monsterSpawns, doors, center };
}

/**
 * Scan a single side of the room for contiguous 2-wide passable runs in the
 * exterior boundary row (= corridor openings) and emit a DoorSpec for each.
 * Wider/different-sized openings (rare; would come from an L-corner landing
 * right at a room edge) are skipped — better to leave an arch than try to
 * place an off-spec door.
 */
function collectDoorsOnSide(
  room: RoomCell,
  side: DoorSide,
  isPass: (x: number, z: number) => boolean,
  out: DoorSpec[],
): void {
  // Walk the exterior boundary line, find consecutive passable cells.
  const runs: Array<{ a: number; b: number }> = [];
  if (side === "north" || side === "south") {
    const zExt = side === "north" ? room.z0 - 1 : room.z1 + 1;
    let runStart = -1;
    for (let x = room.x0; x <= room.x1 + 1; x++) {
      const passable = x <= room.x1 ? isPass(x, zExt) : false;
      if (passable && runStart < 0) runStart = x;
      else if (!passable && runStart >= 0) {
        runs.push({ a: runStart, b: x - 1 });
        runStart = -1;
      }
    }
  } else {
    const xExt = side === "east" ? room.x1 + 1 : room.x0 - 1;
    let runStart = -1;
    for (let z = room.z0; z <= room.z1 + 1; z++) {
      const passable = z <= room.z1 ? isPass(xExt, z) : false;
      if (passable && runStart < 0) runStart = z;
      else if (!passable && runStart >= 0) {
        runs.push({ a: runStart, b: z - 1 });
        runStart = -1;
      }
    }
  }

  for (const run of runs) {
    if (run.b - run.a !== 1) continue; // only handle clean 2-wide openings

    // Wall plane is at the boundary between the exterior row and the
    // room's first interior row.
    if (side === "north") {
      const wallZ = room.z0 - 0.5;
      const hingeX = run.a - 0.5;
      out.push({
        side,
        hingePos: new THREE.Vector3(hingeX, 0, wallZ),
        centerPos: new THREE.Vector3(run.a + 0.5, 0, wallZ),
        slabAabb: {
          minX: hingeX, maxX: hingeX + 2,
          minY: DOOR_BOTTOM, maxY: DOOR_TOP,
          minZ: wallZ - DOOR_SLAB_HALF_THICKNESS,
          maxZ: wallZ + DOOR_SLAB_HALF_THICKNESS,
        },
      });
    } else if (side === "south") {
      const wallZ = room.z1 + 0.5;
      // For south side our orientation rotates by π, so the "local +X"
      // direction in world is -X. Place the hinge at the higher-X end so
      // the slab still extends in the local +X direction after rotation.
      const hingeX = run.b + 0.5;
      out.push({
        side,
        hingePos: new THREE.Vector3(hingeX, 0, wallZ),
        centerPos: new THREE.Vector3(run.a + 0.5, 0, wallZ),
        slabAabb: {
          minX: hingeX - 2, maxX: hingeX,
          minY: DOOR_BOTTOM, maxY: DOOR_TOP,
          minZ: wallZ - DOOR_SLAB_HALF_THICKNESS,
          maxZ: wallZ + DOOR_SLAB_HALF_THICKNESS,
        },
      });
    } else if (side === "east") {
      const wallX = room.x1 + 0.5;
      // East side rotates by -π/2, so local +X aligns with world -Z.
      // Hinge at the higher-Z end so the slab extends toward lower Z.
      const hingeZ = run.b + 0.5;
      out.push({
        side,
        hingePos: new THREE.Vector3(wallX, 0, hingeZ),
        centerPos: new THREE.Vector3(wallX, 0, run.a + 0.5),
        slabAabb: {
          minX: wallX - DOOR_SLAB_HALF_THICKNESS,
          maxX: wallX + DOOR_SLAB_HALF_THICKNESS,
          minY: DOOR_BOTTOM, maxY: DOOR_TOP,
          minZ: hingeZ - 2, maxZ: hingeZ,
        },
      });
    } else { // west
      const wallX = room.x0 - 0.5;
      // West side rotates by +π/2 → local +X aligns with world +Z.
      // Hinge at the lower-Z end so the slab extends toward higher Z.
      const hingeZ = run.a - 0.5;
      out.push({
        side,
        hingePos: new THREE.Vector3(wallX, 0, hingeZ),
        centerPos: new THREE.Vector3(wallX, 0, run.a + 0.5),
        slabAabb: {
          minX: wallX - DOOR_SLAB_HALF_THICKNESS,
          maxX: wallX + DOOR_SLAB_HALF_THICKNESS,
          minY: DOOR_BOTTOM, maxY: DOOR_TOP,
          minZ: hingeZ, maxZ: hingeZ + 2,
        },
      });
    }
  }
}
