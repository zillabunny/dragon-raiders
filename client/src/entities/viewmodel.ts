import * as THREE from "three";
import type { WeaponId } from "../combat/weapons";

/**
 * First-person weapon viewmodel: a sword and a shuriken parented to the camera.
 * Always renders on top (depthTest off + high renderOrder) so it never clips
 * through walls. Plays a quick swing/throw animation on each attack.
 */
export class ViewModel {
  readonly root = new THREE.Group();
  private sword = new THREE.Group();
  private shuriken = new THREE.Group();

  private current: WeaponId = "katana";
  private animTime = 0;
  private animDuration = 0;
  private animKind: "swing" | "throw" | null = null;

  // Rest poses
  private swordRestPos = new THREE.Vector3(0.35, -0.3, -0.6);
  private swordRestRot = new THREE.Euler(-0.15, -0.4, 0.2);
  private shurikenRestPos = new THREE.Vector3(0.28, -0.28, -0.45);
  private shurikenRestRot = new THREE.Euler(0.0, 0.0, 0.0);

  constructor() {
    this.buildSword();
    this.buildShuriken();
    this.root.add(this.sword, this.shuriken);
    this.shuriken.visible = false;
    this.applyRest();
  }

  private buildSword(): void {
    const overlayMat = (color: number, opts?: { emissive?: number; emissiveIntensity?: number }) => {
      const m = new THREE.MeshLambertMaterial({
        color,
        emissive: opts?.emissive ?? 0x000000,
        emissiveIntensity: opts?.emissiveIntensity ?? 0,
      });
      m.depthTest = false;
      return m;
    };

    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.08), overlayMat(0x3a1f12));
    handle.position.set(0, 0, 0);

    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.1), overlayMat(0x8a6a2a));
    guard.position.set(0, 0.18, 0);

    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), overlayMat(0xdfe4ec, { emissive: 0x223344, emissiveIntensity: 0.25 }));
    blade.position.set(0, 0.72, 0);

    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.04), overlayMat(0xeef2f8));
    tip.position.set(0, 1.28, 0);

    for (const m of [handle, guard, blade, tip]) {
      m.renderOrder = 9999;
      m.frustumCulled = false;
    }
    this.sword.add(handle, guard, blade, tip);
  }

  private buildShuriken(): void {
    const mat = new THREE.MeshLambertMaterial({ color: 0xb0b6c0 });
    mat.depthTest = false;
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 0.08), mat);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 0.08), mat);
    b.rotation.y = Math.PI / 2;
    for (const m of [a, b]) {
      m.renderOrder = 9999;
      m.frustumCulled = false;
    }
    this.shuriken.add(a, b);
  }

  setWeapon(weapon: WeaponId): void {
    if (this.current === weapon) return;
    this.current = weapon;
    this.sword.visible = weapon === "katana";
    this.shuriken.visible = weapon === "shuriken";
    this.animTime = 0;
    this.animDuration = 0;
    this.animKind = null;
    this.applyRest();
  }

  playSwing(): void {
    this.animKind = "swing";
    this.animDuration = 0.32;
    this.animTime = 0;
  }

  playThrow(): void {
    this.animKind = "throw";
    this.animDuration = 0.28;
    this.animTime = 0;
  }

  update(dt: number): void {
    // Always passively spin shuriken when it's the active weapon.
    if (this.current === "shuriken" && !this.animKind) {
      this.shuriken.rotation.z += dt * 1.5;
    }

    if (!this.animKind) {
      this.applyRest();
      return;
    }

    this.animTime += dt;
    const t = Math.min(1, this.animTime / this.animDuration);

    if (this.current === "katana" && this.animKind === "swing") {
      // Camera-local axes: +X right, +Y up, +Z toward the viewer (so -Z is into
      // the scene). Positive rotation.x rotates +Y toward +Z, i.e. tip BACK
      // toward the viewer; negative rotation.x rotates the tip INTO the scene.
      const WINDUP_END = 0.22;
      const CHOP_END = 0.65;
      let dx = 0, dy = 0, dz = 0, drx = 0, drz = 0;

      if (t < WINDUP_END) {
        const w = t / WINDUP_END;
        const e = w * w;
        dy  = +0.18 * e;       // lift up
        dz  = +0.10 * e;       // back toward shoulder (closer to camera)
        drx = +0.65 * e;       // tip rotates back over the shoulder
        drz = +0.35 * e;       // edge tilts to the right for the chop
      } else if (t < CHOP_END) {
        const c = (t - WINDUP_END) / (CHOP_END - WINDUP_END);
        const e = 1 - Math.pow(1 - c, 2);
        // From windup peak to chop terminus.
        dx  = -0.18 * e;
        dy  = +0.18 + (-0.28 - 0.18) * e;
        dz  = +0.10 + (-0.15 - 0.10) * e;       // push the blade forward into scene
        drx = +0.65 + (-1.55 - 0.65) * e;       // tip arcs DOWN-FORWARD into scene
        drz = +0.35 + (-0.70 - 0.35) * e;
      } else {
        const r = (t - CHOP_END) / (1 - CHOP_END);
        const e = 1 - Math.pow(1 - r, 3);
        const k = 1 - e; // 1 at chop terminus → 0 at rest
        dx  = -0.18 * k;
        dy  = -0.28 * k;
        dz  = -0.15 * k;
        drx = -1.55 * k;
        drz = -0.70 * k;
      }

      this.sword.position.set(
        this.swordRestPos.x + dx,
        this.swordRestPos.y + dy,
        this.swordRestPos.z + dz,
      );
      this.sword.rotation.set(
        this.swordRestRot.x + drx,
        this.swordRestRot.y,
        this.swordRestRot.z + drz,
      );
    } else if (this.current === "shuriken" && this.animKind === "throw") {
      // Throw: push the shuriken forward fast, then snap back.
      const out = Math.min(1, t / 0.4);
      const back = Math.max(0, (t - 0.4) / 0.6);
      const forward = out * (1 - back);
      const restPos = this.shurikenRestPos;
      this.shuriken.position.set(
        restPos.x - 0.1 * forward,
        restPos.y + 0.05 * forward,
        restPos.z - 0.5 * forward,
      );
      this.shuriken.rotation.z += dt * 30 * (1 - back);
    }

    if (t >= 1) {
      this.animKind = null;
      this.animTime = 0;
      this.animDuration = 0;
      this.applyRest();
    }
  }

  private applyRest(): void {
    this.sword.position.copy(this.swordRestPos);
    this.sword.rotation.copy(this.swordRestRot);
    this.shuriken.position.copy(this.shurikenRestPos);
    if (this.current !== "shuriken") this.shuriken.rotation.copy(this.shurikenRestRot);
  }
}
