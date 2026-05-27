import * as THREE from "three";
import type { ParticleSystem } from "../combat/particles";
import { sound } from "../audio/sound";

const TELEGRAPH_TIME = 0.6;
const FLIGHT_TIME = 0.85;
const AOE_RADIUS = 2.5;
const DIRECT_DAMAGE = 30;
const EDGE_DAMAGE = 15;

/**
 * Boss fireball: spawns a ground-marker telegraph, then arcs a glowing orb
 * from the dragon's mouth to the marked spot. AoE on impact.
 */
export class Fireball {
  readonly position = new THREE.Vector3();
  readonly target = new THREE.Vector3();
  readonly start = new THREE.Vector3();

  readonly group = new THREE.Group();
  readonly light: THREE.PointLight;
  private orb: THREE.Mesh;
  private marker: THREE.Mesh;
  private markerMat: THREE.MeshBasicMaterial;

  private state: "telegraph" | "flying" | "exploded" = "telegraph";
  private timer = 0;

  alive = true;

  constructor(from: THREE.Vector3, to: THREE.Vector3) {
    this.start.copy(from);
    this.target.copy(to);
    this.position.copy(from);

    const orbMat = new THREE.MeshLambertMaterial({
      color: 0xff7022,
      emissive: 0xff5010,
      emissiveIntensity: 3.0,
    });
    this.orb = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), orbMat);
    this.orb.position.copy(from);
    this.orb.visible = false;

    this.light = new THREE.PointLight(0xff6020, 4.0, 12, 2);
    this.light.position.copy(from);
    this.light.visible = false;

    // Ground telegraph: flat ring with two-stop pulsing alpha.
    const ringGeom = new THREE.RingGeometry(AOE_RADIUS * 0.85, AOE_RADIUS, 32);
    ringGeom.rotateX(-Math.PI / 2);
    this.markerMat = new THREE.MeshBasicMaterial({
      color: 0xff4020,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.marker = new THREE.Mesh(ringGeom, this.markerMat);
    this.marker.position.set(to.x, to.y + 0.55, to.z);
    this.marker.renderOrder = 998;

    this.group.add(this.orb, this.light, this.marker);
    sound.fireball();
  }

  /** Returns false when the fireball should be removed from the scene. */
  update(dt: number, particles: ParticleSystem, playerPos: THREE.Vector3, applyDamage: (amount: number) => void): boolean {
    this.timer += dt;

    if (this.state === "telegraph") {
      // Marker pulses red as the warning ramps up.
      const t = this.timer / TELEGRAPH_TIME;
      this.markerMat.opacity = 0.4 + 0.4 * Math.sin(t * Math.PI * 6);
      if (this.timer >= TELEGRAPH_TIME) {
        this.state = "flying";
        this.timer = 0;
        this.orb.visible = true;
        this.light.visible = true;
      }
    } else if (this.state === "flying") {
      const t = Math.min(1, this.timer / FLIGHT_TIME);
      // Parabolic arc with a hump above the straight line.
      this.position.lerpVectors(this.start, this.target, t);
      const hump = Math.sin(t * Math.PI) * 1.2;
      this.position.y += hump;
      this.orb.position.copy(this.position);
      this.light.position.copy(this.position);
      this.markerMat.opacity = 0.55 + 0.35 * Math.sin(this.timer * 20);

      // Trail
      if (Math.random() < 0.7) {
        particles.emitPuff(this.position.clone(), 0xff7820, 4, 1.5);
      }

      if (t >= 1) this.explode(particles, playerPos, applyDamage);
    } else {
      this.alive = false;
      return false;
    }

    return true;
  }

  private explode(particles: ParticleSystem, playerPos: THREE.Vector3, applyDamage: (amount: number) => void): void {
    this.state = "exploded";
    this.orb.visible = false;
    this.light.visible = false;
    this.markerMat.opacity = 0;

    sound.fireballImpact();

    const dx = playerPos.x - this.target.x;
    const dz = playerPos.z - this.target.z;
    const flatDist = Math.hypot(dx, dz);
    if (flatDist < AOE_RADIUS) {
      const t = flatDist / AOE_RADIUS;
      const dmg = Math.round(DIRECT_DAMAGE * (1 - t) + EDGE_DAMAGE * t);
      applyDamage(dmg);
    }

    particles.emitPuff(
      this.target.clone().add(new THREE.Vector3(0, 0.4, 0)),
      0xff6020,
      80,
      9,
    );
    particles.emitPuff(
      this.target.clone().add(new THREE.Vector3(0, 0.1, 0)),
      0x803020,
      40,
      3.5,
    );
    this.alive = false;
  }
}
