import * as THREE from "three";
import type { AABBBox, VoxelWorld } from "../world/voxelWorld";
import { sound } from "../audio/sound";
import type { Monster } from "./monsters";

// Hysteretic trigger so doors don't yo-yo on the boundary. Open earlier than
// the player will arrive; close once they're clearly past.
const OPEN_TRIGGER = 4.0;
const CLOSE_TRIGGER = 6.0;
const ANIM_DURATION = 0.22;

export type DoorSide = "north" | "south" | "east" | "west";

/**
 * One emitted by the dungeon for every corridor entry on every room.
 * `hingePos` is the hinge corner in world space. `slabAabb` is the volume the
 * closed slab occupies (used as a collision blocker on the voxel world).
 */
export interface DoorSpec {
  side: DoorSide;
  hingePos: THREE.Vector3;
  /** Center of the doorway opening (used for trigger distance). */
  centerPos: THREE.Vector3;
  slabAabb: AABBBox;
}

type DoorState = "closed" | "opening" | "open" | "closing";

/**
 * A swinging voxel door at a corridor entry. Approach to open, walk away to
 * close. Closed doors register an AABB blocker with the voxel world so
 * AABB-vs-solid collision treats them as solid; open or animating doors are
 * passable.
 */
export class Door {
  readonly mesh = new THREE.Group();
  readonly position: THREE.Vector3;

  private hingePivot = new THREE.Group();
  private spec: DoorSpec;
  private world: VoxelWorld;
  private swingSign: 1 | -1;

  state: DoorState = "closed";
  private animTime = 0;
  private openness = 0; // 0 = closed, 1 = open
  private blockerRegistered = false;

  constructor(spec: DoorSpec, world: VoxelWorld) {
    this.spec = spec;
    this.world = world;
    this.position = spec.centerPos.clone();
    this.swingSign = Door.swingSignFor(spec.side);

    // Outer group: positioned at the hinge corner, oriented to the wall.
    // The slab is built in local +X; baseAngle rotates local +X to align
    // with the wall axis (so the closed slab lies along the wall), and
    // swingSign chooses which direction it pivots so opening goes INTO
    // the room rather than into the corridor.
    this.mesh.position.copy(spec.hingePos);
    this.mesh.rotation.y = Door.baseAngleFor(spec.side);
    this.mesh.add(this.hingePivot);

    this.buildSlab();

    // Doors start closed → register the blocker immediately.
    this.world.addDoorBlocker(this.spec.slabAabb);
    this.blockerRegistered = true;
  }

  private buildSlab(): void {
    const wood = new THREE.MeshLambertMaterial({ color: 0x5a3a1a });
    const metal = new THREE.MeshLambertMaterial({ color: 0x6c6c76 });
    const knob = new THREE.MeshLambertMaterial({ color: 0xaaa28a });

    // Slab extends from hinge along local +X by 2 units, height 4.5.
    const slab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 4.5, 0.2), wood);
    slab.position.set(1.0, 2.75, 0);

    // Two metal bands across the slab.
    const band1 = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.24, 0.26), metal);
    band1.position.set(1.0, 1.4, 0);
    const band2 = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.24, 0.26), metal);
    band2.position.set(1.0, 4.0, 0);

    // Knob near the free edge.
    const knobMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), knob);
    knobMesh.position.set(1.7, 2.7, 0.18);

    this.hingePivot.add(slab, band1, band2, knobMesh);
  }

  /**
   * The outer group's Y rotation per side. After this rotation, the slab's
   * local +X axis points along the wall in the direction the closed slab
   * should extend from the hinge.
   *
   * Derived by solving `R_y(θ) * (1,0,0) = wall_direction` for each side:
   * - north:  wall direction is world +X  → θ = 0
   * - south:  wall direction is world -X  → θ = π
   * - east:   wall direction is world -Z  → θ = +π/2
   * - west:   wall direction is world +Z  → θ = -π/2
   */
  private static baseAngleFor(side: DoorSide): number {
    switch (side) {
      case "north": return 0;
      case "south": return Math.PI;
      case "east":  return Math.PI / 2;
      case "west":  return -Math.PI / 2;
    }
  }

  /**
   * Direction the door pivots when opening, chosen so the slab ends up
   * inside the room (not the corridor). Worked out per side by composing
   * the hingePivot rotation with the mesh's baseAngle and checking which
   * sign makes the world-space slab direction match "into-room."
   */
  private static swingSignFor(side: DoorSide): 1 | -1 {
    switch (side) {
      case "north": return -1;
      case "south": return -1;
      case "east":  return 1;
      case "west":  return 1;
    }
  }

  /** Distance from a world point to the doorway center, in the XZ plane. */
  private flatDistTo(p: THREE.Vector3): number {
    const dx = p.x - this.position.x;
    const dz = p.z - this.position.z;
    return Math.hypot(dx, dz);
  }

  /** Anyone within trigger radius keeps the door open. */
  private shouldBeOpen(playerPos: THREE.Vector3, monsters: readonly Monster[]): boolean {
    if (this.state === "open" || this.state === "opening") {
      // Hysteresis: stay open until everyone is further than CLOSE_TRIGGER.
      if (this.flatDistTo(playerPos) <= CLOSE_TRIGGER) return true;
      for (const m of monsters) {
        if (!m.alive) continue;
        if (this.flatDistTo(m.position) <= CLOSE_TRIGGER) return true;
      }
      return false;
    }
    // closed/closing → opens at the tighter OPEN_TRIGGER.
    if (this.flatDistTo(playerPos) <= OPEN_TRIGGER) return true;
    for (const m of monsters) {
      if (!m.alive) continue;
      if (this.flatDistTo(m.position) <= OPEN_TRIGGER) return true;
    }
    return false;
  }

  update(dt: number, playerPos: THREE.Vector3, monsters: readonly Monster[]): void {
    const wantOpen = this.shouldBeOpen(playerPos, monsters);

    if (wantOpen && (this.state === "closed" || this.state === "closing")) {
      this.beginOpening();
    } else if (!wantOpen && (this.state === "open" || this.state === "opening")) {
      this.beginClosing();
    }

    if (this.state === "opening") {
      this.animTime += dt;
      this.openness = Math.min(1, this.animTime / ANIM_DURATION);
      if (this.openness >= 1) this.state = "open";
    } else if (this.state === "closing") {
      this.animTime += dt;
      this.openness = Math.max(0, 1 - this.animTime / ANIM_DURATION);
      if (this.openness <= 0) {
        this.state = "closed";
        this.openness = 0;
        if (!this.blockerRegistered) {
          this.world.addDoorBlocker(this.spec.slabAabb);
          this.blockerRegistered = true;
        }
      }
    }

    // Smoothstep so the swing eases in and out a touch.
    const t = this.openness;
    const eased = t * t * (3 - 2 * t);
    this.hingePivot.rotation.y = eased * (Math.PI / 2) * this.swingSign;
  }

  private beginOpening(): void {
    if (this.state === "opening" || this.state === "open") return;
    // Pick up wherever the close-animation left off so we don't snap.
    this.animTime = this.openness * ANIM_DURATION;
    this.state = "opening";
    if (this.blockerRegistered) {
      this.world.removeDoorBlocker(this.spec.slabAabb);
      this.blockerRegistered = false;
    }
    sound.doorOpen();
  }

  private beginClosing(): void {
    if (this.state === "closing" || this.state === "closed") return;
    this.animTime = (1 - this.openness) * ANIM_DURATION;
    this.state = "closing";
    sound.doorClose();
  }

  /** Force this door back to the closed-and-blocking state (used on restart). */
  reset(): void {
    this.state = "closed";
    this.openness = 0;
    this.animTime = 0;
    this.hingePivot.rotation.y = 0; // value × swingSign; 0 is sign-agnostic
    if (!this.blockerRegistered) {
      this.world.addDoorBlocker(this.spec.slabAabb);
      this.blockerRegistered = true;
    }
  }
}
