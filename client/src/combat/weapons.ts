import * as THREE from "three";
import { Projectile, makeShurikenMesh } from "./projectile";

export type WeaponId = "katana" | "shuriken";

export interface WeaponDef {
  id: WeaponId;
  label: string;
  cooldown: number;
  damage: number;
}

export const KATANA: WeaponDef = {
  id: "katana",
  label: "Katana",
  cooldown: 0.4,
  damage: 25,
};

export const SHURIKEN: WeaponDef = {
  id: "shuriken",
  label: "Throwing Stars",
  cooldown: 0.28,
  damage: 15,
};

export const KATANA_RANGE = 2.4;
export const KATANA_ARC_RADIANS = (90 * Math.PI) / 180; // total cone width
export const SHURIKEN_SPEED = 22;

/**
 * Result of a katana swing: which monsters were hit and where (for sparks).
 * The caller is responsible for applying damage and spawning particles.
 */
export interface KatanaHit {
  hitPoints: THREE.Vector3[];
}

/**
 * For every candidate in `targets`, returns those whose center lies inside the
 * katana's forward cone. Caller handles damage application.
 */
export function katanaTargets<T extends { position: THREE.Vector3; alive: boolean }>(
  origin: THREE.Vector3,
  forward: THREE.Vector3,
  targets: readonly T[],
): T[] {
  const hits: T[] = [];
  const halfCos = Math.cos(KATANA_ARC_RADIANS / 2);
  const flatForward = new THREE.Vector3(forward.x, 0, forward.z).normalize();
  const toTarget = new THREE.Vector3();
  for (const t of targets) {
    if (!t.alive) continue;
    toTarget.subVectors(t.position, origin);
    toTarget.y = 0;
    const dist = toTarget.length();
    if (dist === 0 || dist > KATANA_RANGE) continue;
    toTarget.normalize();
    if (toTarget.dot(flatForward) >= halfCos) hits.push(t);
  }
  return hits;
}

export function spawnShuriken(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
): Projectile {
  const dir = direction.clone().normalize();
  const mesh = makeShurikenMesh();
  return new Projectile({
    position: origin.clone().addScaledVector(dir, 0.5),
    velocity: dir.multiplyScalar(SHURIKEN_SPEED),
    team: "player",
    damage: SHURIKEN.damage,
    mesh,
    lifetime: 3,
    spinAxis: new THREE.Vector3(0, 1, 0),
    spinSpeed: 25,
  });
}
