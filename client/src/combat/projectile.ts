import * as THREE from "three";
import type { VoxelWorld } from "../world/voxelWorld";

export type ProjectileTeam = "player" | "monster";

export interface ProjectileSpec {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  team: ProjectileTeam;
  damage: number;
  /** Visual mesh attached to the projectile. */
  mesh: THREE.Object3D;
  /** Seconds before the projectile auto-expires. */
  lifetime?: number;
  /** Spin axis for visual flair (e.g. spinning shuriken). */
  spinAxis?: THREE.Vector3;
  spinSpeed?: number;
}

export class Projectile {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly team: ProjectileTeam;
  readonly damage: number;
  readonly mesh: THREE.Object3D;
  private life: number;
  private spinAxis?: THREE.Vector3;
  private spinSpeed: number;
  alive = true;

  constructor(spec: ProjectileSpec) {
    this.position = spec.position.clone();
    this.velocity = spec.velocity.clone();
    this.team = spec.team;
    this.damage = spec.damage;
    this.mesh = spec.mesh;
    this.life = spec.lifetime ?? 3;
    this.spinAxis = spec.spinAxis?.clone().normalize();
    this.spinSpeed = spec.spinSpeed ?? 0;
    this.mesh.position.copy(this.position);
  }

  /** Step the projectile; returns false if it should be removed. */
  update(dt: number, world: VoxelWorld): boolean {
    this.life -= dt;
    if (this.life <= 0) return (this.alive = false);

    this.position.addScaledVector(this.velocity, dt);

    // Voxel collision: if center is inside any solid block, kill it.
    const bx = Math.round(this.position.x);
    const by = Math.round(this.position.y);
    const bz = Math.round(this.position.z);
    if (world.isSolid(bx, by, bz)) return (this.alive = false);

    if (this.spinAxis && this.spinSpeed !== 0) {
      this.mesh.rotateOnAxis(this.spinAxis, this.spinSpeed * dt);
    }
    this.mesh.position.copy(this.position);
    return true;
  }
}

/** Build a flat 4-pointed shuriken sprite from box geometry. */
export function makeShurikenMesh(): THREE.Object3D {
  const group = new THREE.Group();
  const geom = new THREE.BoxGeometry(0.5, 0.04, 0.12);
  const mat = new THREE.MeshLambertMaterial({ color: 0xb0b6c0 });
  const a = new THREE.Mesh(geom, mat);
  const b = new THREE.Mesh(geom, mat);
  b.rotation.y = Math.PI / 2;
  group.add(a, b);
  return group;
}

/** Build a chunky thrown axe from a couple of boxes. */
export function makeAxeMesh(): THREE.Object3D {
  const group = new THREE.Group();
  const handle = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.6, 0.1),
    new THREE.MeshLambertMaterial({ color: 0x5a3a1a }),
  );
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.3, 0.12),
    new THREE.MeshLambertMaterial({ color: 0x7a7a82 }),
  );
  head.position.y = 0.25;
  group.add(handle, head);
  return group;
}
