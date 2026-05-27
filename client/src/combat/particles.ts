import * as THREE from "three";

interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  color: THREE.Color;
  size: number;
}

/**
 * Simple GPU-points particle system. Spawn puffs/sparks; they fall under
 * mild gravity and fade out. Lives in a single Points object for cheap render.
 */
export class ParticleSystem {
  readonly object: THREE.Points;
  private particles: Particle[] = [];
  private geometry: THREE.BufferGeometry;
  private positions: Float32Array;
  private colors: Float32Array;
  private capacity: number;

  constructor(capacity = 300) {
    this.capacity = capacity;
    this.geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.18,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.object = new THREE.Points(this.geometry, material);
    this.object.frustumCulled = false;
  }

  /** Emit a poof of `count` particles centered on `at` with the given base color. */
  emitPuff(at: THREE.Vector3, color: THREE.ColorRepresentation, count = 24, speed = 4): void {
    const base = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.capacity) break;
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() * 0.8 + 0.2,
        Math.random() - 0.5,
      ).normalize();
      this.particles.push({
        position: at.clone(),
        velocity: dir.multiplyScalar(speed * (0.5 + Math.random() * 0.8)),
        life: 0.6 + Math.random() * 0.6,
        maxLife: 1.2,
        color: base.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.15),
        size: 0.15,
      });
    }
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.velocity.y -= 8 * dt;
      p.position.addScaledVector(p.velocity, dt);
    }

    const n = Math.min(this.particles.length, this.capacity);
    for (let i = 0; i < n; i++) {
      const p = this.particles[i];
      const fade = Math.max(0, p.life / p.maxLife);
      this.positions[i * 3 + 0] = p.position.x;
      this.positions[i * 3 + 1] = p.position.y;
      this.positions[i * 3 + 2] = p.position.z;
      this.colors[i * 3 + 0] = p.color.r * fade;
      this.colors[i * 3 + 1] = p.color.g * fade;
      this.colors[i * 3 + 2] = p.color.b * fade;
    }
    this.geometry.setDrawRange(0, n);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }
}
