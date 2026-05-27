import * as THREE from "three";
import type { ParticleSystem } from "../combat/particles";

/**
 * Looted at the end of the boss fight. Stacked gold cuboids with three glowing
 * gems on top, a warm point light, and the occasional sparkle puff. Touch
 * within `LOOT_RANGE` to claim the treasure.
 */
export class TreasurePile {
  static readonly LOOT_RANGE = 2.0;

  readonly mesh = new THREE.Group();
  readonly position = new THREE.Vector3();
  readonly light: THREE.PointLight;
  alive = true;
  /** Set to true once the player has looted the pile. */
  looted = false;

  private spinT = 0;
  private gems: THREE.Mesh[] = [];
  private sparkleCooldown = 0;

  constructor(at: THREE.Vector3) {
    this.position.copy(at);

    const goldMat = new THREE.MeshLambertMaterial({
      color: 0xffd966,
      emissive: 0xffb030,
      emissiveIntensity: 0.55,
    });
    const darkGoldMat = new THREE.MeshLambertMaterial({
      color: 0xb88828,
      emissive: 0x553010,
      emissiveIntensity: 0.25,
    });

    // Stacked pile of gold bars at three "layers" of decreasing footprint.
    type Block = [number, number, number, number, number, number, THREE.Material, number];
    const layers: Block[] = [
      // y,    x,    z,    w,    h,   d,    mat,         yaw
      [0.20,  0.0,  0.0, 1.8, 0.40, 1.8, goldMat,     0.10],
      [0.55, -0.32, 0.22, 1.15, 0.30, 1.15, darkGoldMat, -0.12],
      [0.55,  0.45, -0.28, 0.70, 0.30, 0.70, goldMat,     0.25],
      [0.85, -0.05, 0.10, 0.85, 0.25, 0.85, goldMat,     -0.05],
      [1.05,  0.20, -0.10, 0.45, 0.22, 0.45, darkGoldMat,  0.40],
    ];
    for (const [y, x, z, w, h, d, mat, yaw] of layers) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.rotation.y = yaw;
      m.castShadow = true;
      m.receiveShadow = true;
      this.mesh.add(m);
    }

    // Loose coins (small flat boxes) scattered around the base.
    const coinPositions: Array<[number, number, number]> = [
      [-0.85,  0.06,  0.55],
      [ 0.95,  0.06, -0.5],
      [ 0.6,   0.06,  0.95],
      [-0.6,   0.06, -0.85],
      [ 0.0,   0.06,  1.05],
    ];
    for (const [x, y, z] of coinPositions) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.22), goldMat);
      m.position.set(x, y, z);
      m.rotation.y = Math.random() * Math.PI;
      this.mesh.add(m);
    }

    // Three glowing gems on top.
    const gemConfigs: Array<[number, number, number, number]> = [
      [-0.30, 1.32,  0.10, 0xff3050], // ruby
      [ 0.35, 1.32, -0.20, 0x40ff70], // emerald
      [ 0.00, 1.42,  0.30, 0x5070ff], // sapphire
    ];
    for (const [x, y, z, color] of gemConfigs) {
      const gemMat = new THREE.MeshLambertMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.3,
      });
      const gem = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), gemMat);
      gem.position.set(x, y, z);
      gem.rotation.set(Math.PI / 8, Math.PI / 4, 0);
      gem.castShadow = true;
      this.mesh.add(gem);
      this.gems.push(gem);
    }

    this.mesh.position.copy(at);

    this.light = new THREE.PointLight(0xffc870, 3.5, 10, 2);
    this.light.position.copy(at);
    this.light.position.y += 1.6;
  }

  update(dt: number, particles?: ParticleSystem): void {
    if (!this.alive) return;
    this.spinT += dt;

    // Gem bob: each gem floats slightly and rotates on its own phase.
    for (let i = 0; i < this.gems.length; i++) {
      const gem = this.gems[i];
      const phase = this.spinT * 1.4 + i * 1.7;
      gem.rotation.y = phase;
      gem.position.y += Math.sin(phase * 1.3) * 0.0008;
    }

    // Sparkles emit from random points on the pile.
    this.sparkleCooldown -= dt;
    if (particles && this.sparkleCooldown <= 0) {
      this.sparkleCooldown = 0.18 + Math.random() * 0.25;
      const off = new THREE.Vector3(
        (Math.random() - 0.5) * 1.6,
        Math.random() * 1.2 + 0.4,
        (Math.random() - 0.5) * 1.6,
      );
      particles.emitPuff(this.position.clone().add(off), 0xffe080, 2, 0.6);
    }
  }

  /** Returns true if the player (feet at `playerPos`) is within loot range. */
  inRange(playerPos: THREE.Vector3): boolean {
    const dx = playerPos.x - this.position.x;
    const dz = playerPos.z - this.position.z;
    return dx * dx + dz * dz < TreasurePile.LOOT_RANGE * TreasurePile.LOOT_RANGE;
  }

  /** Trigger the loot animation: burst sparkles + sink the pile. */
  loot(particles: ParticleSystem): void {
    if (this.looted) return;
    this.looted = true;
    for (let i = 0; i < 6; i++) {
      particles.emitPuff(
        this.position.clone().add(new THREE.Vector3(0, 0.5 + i * 0.15, 0)),
        i % 2 ? 0xffd060 : 0xffe890,
        30,
        6,
      );
    }
    this.light.intensity = 0;
    this.mesh.visible = false;
  }
}
