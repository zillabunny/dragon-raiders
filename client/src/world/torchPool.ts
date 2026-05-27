import * as THREE from "three";

const BASE_INTENSITY = 3.2;
const FADE_START = 14;
const FADE_END = 28;
const LIGHT_RANGE = 18;
const LIGHT_COLOR = 0xffb060;

/**
 * Fixed pool of dynamic point lights that follow the player around the
 * dungeon. Each frame the K nearest torch positions are picked and the K
 * lights are repositioned + intensity-faded by distance. Holding the live
 * light count constant avoids the shader recompiles you'd get from
 * `light.visible = false`, and caps the per-fragment light loop at K, which
 * is essential for indoor scenes that have dozens of torches.
 */
export class TorchPool {
  private lights: THREE.PointLight[] = [];

  constructor(scene: THREE.Scene, slotCount: number) {
    for (let i = 0; i < slotCount; i++) {
      const light = new THREE.PointLight(LIGHT_COLOR, 0, LIGHT_RANGE, 2);
      light.castShadow = false;
      scene.add(light);
      this.lights.push(light);
    }
  }

  update(playerPos: THREE.Vector3, positions: readonly THREE.Vector3[], elapsed: number): void {
    if (positions.length === 0) {
      for (const l of this.lights) l.intensity = 0;
      return;
    }

    // Distance-sort all torches. positions.length is small (a few dozen) so
    // a full sort each frame is well under a microsecond.
    const ranked = positions
      .map((p, i) => ({ d: p.distanceTo(playerPos), i }))
      .sort((a, b) => a.d - b.d);

    for (let k = 0; k < this.lights.length; k++) {
      const light = this.lights[k];
      if (k >= ranked.length) {
        light.intensity = 0;
        continue;
      }
      const { d, i } = ranked[k];
      light.position.copy(positions[i]);

      const fade =
        d >= FADE_END ? 0 :
        d <= FADE_START ? 1 :
        1 - (d - FADE_START) / (FADE_END - FADE_START);

      const wobble = 0.25 * Math.sin(elapsed * 7 + k * 1.7) + 0.15 * Math.sin(elapsed * 13 + k);
      light.intensity = (BASE_INTENSITY + wobble) * fade;
    }
  }
}
