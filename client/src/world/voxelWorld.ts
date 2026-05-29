import * as THREE from "three";

export type BlockType = "stone" | "brick" | "pillar" | "torch";

interface BlockTypeDef {
  color: number;
  roughness: number;
  metalness: number;
  emissive?: number;
  emissiveIntensity?: number;
  solid: boolean;
}

const BLOCK_TYPES: Record<BlockType, BlockTypeDef> = {
  stone:  { color: 0x6b6f76, roughness: 0.95, metalness: 0.0, solid: true },
  brick:  { color: 0x4a4036, roughness: 0.85, metalness: 0.0, solid: true },
  pillar: { color: 0x2d2a26, roughness: 0.7,  metalness: 0.1, solid: true },
  torch:  { color: 0xffb347, roughness: 0.4,  metalness: 0.0, emissive: 0xff8c1a, emissiveIntensity: 1.4, solid: false },
};

const BLOCK_SIZE = 1;

interface Block {
  type: BlockType;
  x: number;
  y: number;
  z: number;
}

/**
 * A grid-aligned voxel world. Blocks live on integer coordinates; rendering
 * uses one InstancedMesh per BlockType. Collisions are AABB-vs-solid-block.
 */
/** Axis-aligned bounding box. Used by doors to register/unregister blockers. */
export interface AABBBox {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}

export class VoxelWorld {
  readonly scene: THREE.Scene;
  /** Positions of torch blocks. A TorchPool dynamically lights the nearest few. */
  readonly torchPositions: THREE.Vector3[] = [];

  private blocks: Block[] = [];
  private solidSet = new Set<string>();
  private meshes = new Map<BlockType, THREE.InstancedMesh>();
  /** Closed doors register their slab AABB here so collision counts them as solid. */
  private doorBlockers: AABBBox[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  private static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  setBlock(x: number, y: number, z: number, type: BlockType): void {
    this.blocks.push({ x, y, z, type });
    if (BLOCK_TYPES[type].solid) {
      this.solidSet.add(VoxelWorld.key(x, y, z));
    }
  }

  isSolid(x: number, y: number, z: number): boolean {
    return this.solidSet.has(VoxelWorld.key(x, y, z));
  }

  /**
   * Does an AABB anchored at `feet` (bottom-center) with `halfWidth` and
   * `height` overlap any solid block or any closed door blocker?
   */
  aabbCollidesSolid(feet: { x: number; y: number; z: number }, halfWidth: number, height: number): boolean {
    const minX = Math.floor(feet.x - halfWidth + 0.5);
    const maxX = Math.floor(feet.x + halfWidth + 0.5);
    const minY = Math.floor(feet.y + 0.5);
    const maxY = Math.floor(feet.y + height - 0.5 + 0.5);
    const minZ = Math.floor(feet.z - halfWidth + 0.5);
    const maxZ = Math.floor(feet.z + halfWidth + 0.5);

    for (let bx = minX; bx <= maxX; bx++) {
      for (let by = minY; by <= maxY; by++) {
        for (let bz = minZ; bz <= maxZ; bz++) {
          if (!this.solidSet.has(VoxelWorld.key(bx, by, bz))) continue;
          const dx = Math.abs(feet.x - bx);
          const dz = Math.abs(feet.z - bz);
          if (dx >= 0.5 + halfWidth) continue;
          if (dz >= 0.5 + halfWidth) continue;
          const playerTop = feet.y + height;
          const blockTop = by + 0.5;
          const blockBottom = by - 0.5;
          if (feet.y >= blockTop) continue;
          if (playerTop <= blockBottom) continue;
          return true;
        }
      }
    }

    // AABB-vs-AABB against any closed door slabs.
    if (this.doorBlockers.length > 0) {
      const playerMinX = feet.x - halfWidth;
      const playerMaxX = feet.x + halfWidth;
      const playerMinY = feet.y;
      const playerMaxY = feet.y + height;
      const playerMinZ = feet.z - halfWidth;
      const playerMaxZ = feet.z + halfWidth;
      for (const d of this.doorBlockers) {
        if (playerMaxX <= d.minX || playerMinX >= d.maxX) continue;
        if (playerMaxY <= d.minY || playerMinY >= d.maxY) continue;
        if (playerMaxZ <= d.minZ || playerMinZ >= d.maxZ) continue;
        return true;
      }
    }

    return false;
  }

  /** Register a closed-door blocker. Doors call this on close. */
  addDoorBlocker(aabb: AABBBox): void {
    if (!this.doorBlockers.includes(aabb)) this.doorBlockers.push(aabb);
  }

  /** Unregister a closed-door blocker. Doors call this when opening. */
  removeDoorBlocker(aabb: AABBBox): void {
    const i = this.doorBlockers.indexOf(aabb);
    if (i >= 0) this.doorBlockers.splice(i, 1);
  }

  /** Build the meshes once all blocks are placed. */
  build(): void {
    const geometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);

    const grouped = new Map<BlockType, Block[]>();
    for (const block of this.blocks) {
      const list = grouped.get(block.type) ?? [];
      list.push(block);
      grouped.set(block.type, list);
    }

    const matrix = new THREE.Matrix4();
    for (const [type, list] of grouped) {
      const def = BLOCK_TYPES[type];
      // Lambert (per-vertex lighting) instead of Standard (per-pixel PBR).
      // For the voxel pass this is the dominant cost, and the chunky look
      // doesn't need metallic/roughness — emissive is enough for torches.
      const material = new THREE.MeshLambertMaterial({
        color: def.color,
        emissive: def.emissive ?? 0x000000,
        emissiveIntensity: def.emissiveIntensity ?? 0,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      // Voxel walls/floors don't cast shadows — the dungeon is a closed
      // brick box, so the moonlight shadows would mostly fight the
      // emissive torch glow. Receiving (so the dragon can cast onto the
      // floor) is what actually matters.
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      list.forEach((block, i) => {
        matrix.setPosition(block.x, block.y, block.z);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
      this.meshes.set(type, mesh);

      if (type === "torch") {
        for (const block of list) {
          this.torchPositions.push(new THREE.Vector3(block.x, block.y + 0.2, block.z));
        }
      }
    }
  }
}

/**
 * Build a single dungeon room: stone floor, brick walls, a few pillars,
 * and torches on the walls for atmosphere.
 */
export function buildStarterRoom(world: VoxelWorld): { spawn: THREE.Vector3 } {
  const width = 20;
  const depth = 20;
  const height = 5;

  // Floor at y = 0.
  for (let x = 0; x < width; x++) {
    for (let z = 0; z < depth; z++) {
      world.setBlock(x, 0, z, "stone");
    }
  }

  // Walls around the perimeter, height high.
  for (let y = 1; y <= height; y++) {
    for (let x = 0; x < width; x++) {
      world.setBlock(x, y, 0, "brick");
      world.setBlock(x, y, depth - 1, "brick");
    }
    for (let z = 0; z < depth; z++) {
      world.setBlock(0, y, z, "brick");
      world.setBlock(width - 1, y, z, "brick");
    }
  }

  // Ceiling (open lattice — every other block) so torches still cast light up.
  for (let x = 0; x < width; x++) {
    for (let z = 0; z < depth; z++) {
      if ((x + z) % 3 !== 0) {
        world.setBlock(x, height + 1, z, "brick");
      }
    }
  }

  // Pillars: 4 internal columns.
  const pillarPositions: Array<[number, number]> = [
    [5, 5],
    [width - 6, 5],
    [5, depth - 6],
    [width - 6, depth - 6],
  ];
  for (const [px, pz] of pillarPositions) {
    for (let y = 1; y <= height; y++) {
      world.setBlock(px, y, pz, "pillar");
    }
  }

  // Torches on the walls.
  const torchY = 3;
  const torchSpots: Array<[number, number, number]> = [
    [width / 2, torchY, 1],
    [width / 2, torchY, depth - 2],
    [1, torchY, depth / 2],
    [width - 2, torchY, depth / 2],
  ];
  for (const [tx, ty, tz] of torchSpots) {
    world.setBlock(Math.floor(tx), ty, Math.floor(tz), "torch");
  }

  return { spawn: new THREE.Vector3(width / 2, 2, depth / 2) };
}
