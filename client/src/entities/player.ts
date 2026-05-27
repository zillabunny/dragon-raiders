import * as THREE from "three";
import type { VoxelWorld } from "../world/voxelWorld";
import { KATANA, SHURIKEN, type WeaponId } from "../combat/weapons";
import { sound } from "../audio/sound";
import { ViewModel } from "./viewmodel";

const PLAYER_HALF_WIDTH = 0.35;
const PLAYER_HEIGHT = 1.8;
const EYE_HEIGHT = 1.6;

const WALK_SPEED = 5.5;
const SPRINT_MULT = 1.7;
const JUMP_SPEED = 8.5;
const GRAVITY = 24;
const MOUSE_SENSITIVITY = 0.0022;

const MAX_HP = 100;
const REGEN_PER_SEC = 6;
const REGEN_DELAY = 4; // seconds out-of-combat before regen kicks in
const HIT_FLASH_SECONDS = 0.35;

export interface AttackRequest {
  weapon: WeaponId;
  origin: THREE.Vector3;
  /** Aim direction (normalized, includes pitch). */
  direction: THREE.Vector3;
  /** Flat horizontal forward (for cone hit). */
  forwardFlat: THREE.Vector3;
}

interface KeyState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
}

/**
 * First-person player with pointer-lock mouse look, AABB-vs-voxel collision,
 * HP, weapons (katana/shuriken), and grapple state.
 */
export class Player {
  readonly camera: THREE.PerspectiveCamera;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();

  hp = MAX_HP;
  readonly maxHp = MAX_HP;
  alive = true;
  shurikens = 20;
  currentWeapon: WeaponId = "katana";

  /** Wall-clock seconds the player remains grappled. While > 0, movement is suppressed. */
  grappleRemaining = 0;
  /** Seconds since the player last took damage. Tracks "out of combat" for regen. */
  private secondsSinceHit = REGEN_DELAY;
  /** Seconds remaining on a visual hit flash. */
  hitFlash = 0;

  private yaw = 0;
  private pitch = 0;
  private onGround = false;
  private keys: KeyState = {
    forward: false, back: false, left: false, right: false,
    jump: false, sprint: false,
  };
  private pointerLocked = false;
  private attackHeld = false;
  private cooldownRemaining = 0;
  private pendingAttack: AttackRequest | null = null;
  readonly viewModel = new ViewModel();

  constructor(
    camera: THREE.PerspectiveCamera,
    private readonly world: VoxelWorld,
    private readonly domElement: HTMLElement,
  ) {
    this.camera = camera;
    this.camera.add(this.viewModel.root);
    this.bindInput();
  }

  spawn(at: THREE.Vector3, yawRadians = 0): void {
    this.position.copy(at);
    this.velocity.set(0, 0, 0);
    this.yaw = yawRadians;
    this.pitch = 0;
    this.hp = this.maxHp;
    this.alive = true;
    this.shurikens = 20;
    this.currentWeapon = "katana";
    this.grappleRemaining = 0;
    this.secondsSinceHit = REGEN_DELAY;
    this.cooldownRemaining = 0;
    this.pendingAttack = null;
    this.attackHeld = false;
    this.syncCamera();
  }

  private bindInput(): void {
    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === this.domElement;
    });

    document.addEventListener("mousemove", (e) => {
      if (!this.pointerLocked) return;
      this.yaw -= e.movementX * MOUSE_SENSITIVITY;
      this.pitch -= e.movementY * MOUSE_SENSITIVITY;
      const limit = Math.PI / 2 - 0.001;
      if (this.pitch > limit) this.pitch = limit;
      if (this.pitch < -limit) this.pitch = -limit;
    });

    this.domElement.addEventListener("mousedown", (e) => {
      if (!this.pointerLocked || !this.alive) return;
      if (e.button === 0) this.attackHeld = true;
    });
    this.domElement.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.attackHeld = false;
    });
    this.domElement.addEventListener("contextmenu", (e) => e.preventDefault());

    window.addEventListener("keydown", (e) => this.onKey(e, true));
    window.addEventListener("keyup", (e) => this.onKey(e, false));
  }

  requestPointerLock(): void {
    this.domElement.requestPointerLock();
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    switch (e.code) {
      case "KeyW": case "ArrowUp":    this.keys.forward = down; break;
      case "KeyS": case "ArrowDown":  this.keys.back = down; break;
      case "KeyA": case "ArrowLeft":  this.keys.left = down; break;
      case "KeyD": case "ArrowRight": this.keys.right = down; break;
      case "Space":                   this.keys.jump = down; break;
      case "ShiftLeft": case "ShiftRight": this.keys.sprint = down; break;
      case "Digit1": if (down) this.setWeapon("katana"); break;
      case "Digit2": if (down) this.setWeapon("shuriken"); break;
      case "KeyQ":   if (down) this.setWeapon(this.currentWeapon === "katana" ? "shuriken" : "katana"); break;
    }
  }

  update(dt: number): void {
    if (!this.alive) {
      this.velocity.set(0, 0, 0);
      this.syncCamera();
      return;
    }

    this.secondsSinceHit += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
    this.grappleRemaining = Math.max(0, this.grappleRemaining - dt);

    const grappled = this.grappleRemaining > 0;

    // Horizontal input → velocity (suppressed while grappled).
    if (!grappled) {
      const forward = (this.keys.forward ? 1 : 0) - (this.keys.back ? 1 : 0);
      const strafe  = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
      const sinY = Math.sin(this.yaw);
      const cosY = Math.cos(this.yaw);
      let wishX = -sinY * forward + cosY * strafe;
      let wishZ = -cosY * forward - sinY * strafe;
      const wishLen = Math.hypot(wishX, wishZ);
      if (wishLen > 0) { wishX /= wishLen; wishZ /= wishLen; }
      const speed = WALK_SPEED * (this.keys.sprint ? SPRINT_MULT : 1);
      this.velocity.x = wishX * speed;
      this.velocity.z = wishZ * speed;
    } else {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }

    // Gravity always applies (so a grappled player still rests on the floor).
    this.velocity.y -= GRAVITY * dt;

    if (!grappled && this.keys.jump && this.onGround) {
      this.velocity.y = JUMP_SPEED;
      this.onGround = false;
    }

    this.moveAxis("x", this.velocity.x * dt);
    this.moveAxis("z", this.velocity.z * dt);
    const yMoved = this.moveAxis("y", this.velocity.y * dt);
    if (this.velocity.y < 0 && yMoved === 0) {
      this.onGround = true;
      this.velocity.y = 0;
    } else if (this.velocity.y > 0 && yMoved === 0) {
      this.velocity.y = 0;
    } else {
      this.onGround = false;
    }

    // Regen out of combat.
    if (this.secondsSinceHit >= REGEN_DELAY && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + REGEN_PER_SEC * dt);
    }

    // Attempt to fire weapon if held and cooldown ready.
    if (this.attackHeld && this.cooldownRemaining <= 0) {
      this.tryFireAttack();
    }

    this.viewModel.update(dt);
    this.syncCamera();
  }

  private tryFireAttack(): void {
    if (this.currentWeapon === "shuriken" && this.shurikens <= 0) return;

    const weaponDef = this.currentWeapon === "katana" ? KATANA : SHURIKEN;
    this.cooldownRemaining = weaponDef.cooldown;

    if (this.currentWeapon === "shuriken") this.shurikens -= 1;

    if (this.currentWeapon === "katana") this.viewModel.playSwing();
    else this.viewModel.playThrow();

    const origin = this.camera.position.clone();
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    const forwardFlat = new THREE.Vector3(direction.x, 0, direction.z).normalize();

    this.pendingAttack = {
      weapon: this.currentWeapon,
      origin,
      direction,
      forwardFlat,
    };
  }

  private setWeapon(weapon: WeaponId): void {
    if (this.currentWeapon === weapon) return;
    this.currentWeapon = weapon;
    this.viewModel.setWeapon(weapon);
  }

  /** Game polls this each frame to dispatch the actual attack effect. */
  consumeAttackRequest(): AttackRequest | null {
    const req = this.pendingAttack;
    this.pendingAttack = null;
    return req;
  }

  takeDamage(amount: number): void {
    if (!this.alive || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.secondsSinceHit = 0;
    this.hitFlash = HIT_FLASH_SECONDS;
    sound.playerHit();
    if (this.hp <= 0) this.alive = false;
  }

  addShurikens(n: number): void {
    this.shurikens += n;
  }

  applyGrapple(seconds: number): void {
    if (!this.alive) return;
    if (this.grappleRemaining < seconds) this.grappleRemaining = seconds;
  }

  isGrappled(): boolean {
    return this.grappleRemaining > 0;
  }

  /** Flat forward (no pitch). Useful for facing checks. */
  getForwardFlat(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
  }

  private moveAxis(axis: "x" | "y" | "z", delta: number): number {
    if (delta === 0) return 0;
    const before = this.position[axis];
    this.position[axis] += delta;
    if (this.isCollidingWithSolid()) {
      this.position[axis] = before;
      return 0;
    }
    return delta;
  }

  private isCollidingWithSolid(): boolean {
    return this.world.aabbCollidesSolid(this.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT);
  }

  private syncCamera(): void {
    this.camera.position.set(this.position.x, this.position.y + EYE_HEIGHT, this.position.z);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = 0;
  }
}
