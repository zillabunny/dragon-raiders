import * as THREE from "three";
import type { VoxelWorld } from "../world/voxelWorld";
import { Projectile, makeAxeMesh } from "../combat/projectile";
import { HealthBar } from "../ui/healthBar";

const GRAVITY = 24;

export type MonsterKind = "troll" | "knight" | "jiujitsu";

export interface MonsterSpawnSpec {
  kind: MonsterKind;
  position: THREE.Vector3;
  facing?: number;
}

export interface PlayerLike {
  position: THREE.Vector3;
  alive: boolean;
  takeDamage(amount: number): void;
  applyGrapple(seconds: number): void;
  isGrappled(): boolean;
  getForwardFlat(out?: THREE.Vector3): THREE.Vector3;
}

export interface MonsterContext {
  player: PlayerLike;
  world: VoxelWorld;
  fireProjectile(p: Projectile): void;
  emitPuff(at: THREE.Vector3, color: THREE.ColorRepresentation, count?: number): void;
  dropShurikens(at: THREE.Vector3, amount: number): void;
}

export abstract class Monster {
  readonly kind: MonsterKind;
  readonly mesh = new THREE.Group();
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly healthBar: HealthBar;

  hp: number;
  readonly maxHp: number;
  alive = true;

  /** Yaw the monster is facing (radians, around +Y). */
  facing = 0;
  /** AABB half-width (x and z). */
  readonly halfWidth: number;
  /** AABB total height. */
  readonly height: number;
  /** Approximate shoulder height for projectile launch & health bar. */
  readonly eyeHeight: number;
  protected onGround = false;
  protected attackCooldown = 0;

  constructor(kind: MonsterKind, hp: number, halfWidth: number, height: number, label: string, labelColor: string) {
    this.kind = kind;
    this.maxHp = hp;
    this.hp = hp;
    this.halfWidth = halfWidth;
    this.height = height;
    this.eyeHeight = height * 0.85;
    this.healthBar = new HealthBar(1.0, 0.12, label, labelColor);
  }

  spawn(at: THREE.Vector3, facing = 0): void {
    this.position.copy(at);
    this.facing = facing;
    this.velocity.set(0, 0, 0);
    this.hp = this.maxHp;
    this.alive = true;
    this.syncMesh();
  }

  /** Apply damage. `fromBehind` enables monster-specific armor logic. */
  takeDamage(amount: number, fromBehind: boolean, ctx: MonsterContext): void {
    if (!this.alive) return;
    const dealt = this.modifyIncoming(amount, fromBehind);
    this.hp = Math.max(0, this.hp - dealt);
    if (this.hp <= 0) this.die(ctx);
  }

  /** Override to apply damage modifiers (e.g. front armor). */
  protected modifyIncoming(amount: number, _fromBehind: boolean): number {
    return amount;
  }

  protected die(ctx: MonsterContext): void {
    this.alive = false;
    this.mesh.visible = false;
    this.healthBar.setVisible(false);
    const puffAt = this.position.clone().add(new THREE.Vector3(0, this.height * 0.5, 0));
    ctx.emitPuff(puffAt, this.deathColor(), 40);
    const drop = this.shurikensOnDeath();
    if (drop > 0) ctx.dropShurikens(this.position.clone(), drop);
  }

  protected deathColor(): THREE.ColorRepresentation { return 0xffffff; }
  protected shurikensOnDeath(): number { return 0; }

  abstract update(dt: number, ctx: MonsterContext): void;

  /**
   * Move horizontally toward target, respecting voxel collisions and gravity.
   * Returns true if the monster reached "within `stopDistance`" of the target.
   */
  protected stepToward(target: THREE.Vector3, speed: number, dt: number, ctx: MonsterContext, stopDistance: number): boolean {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < stopDistance) {
      this.velocity.x = 0;
      this.velocity.z = 0;
      this.faceToward(target);
    } else {
      const nx = dx / dist;
      const nz = dz / dist;
      this.velocity.x = nx * speed;
      this.velocity.z = nz * speed;
      // Mesh convention: rotation.y = yaw makes local +Z (eyes/face) point to
      // (sin yaw, cos yaw) in world. So to face the target we want
      // atan2(dx, dz), not the camera-style atan2(-dx, -dz).
      this.facing = Math.atan2(nx, nz);
    }

    this.velocity.y -= GRAVITY * dt;

    this.moveAxis("x", this.velocity.x * dt, ctx.world);
    this.moveAxis("z", this.velocity.z * dt, ctx.world);
    const yMoved = this.moveAxis("y", this.velocity.y * dt, ctx.world);
    if (this.velocity.y < 0 && yMoved === 0) {
      this.velocity.y = 0;
      this.onGround = true;
    } else if (this.velocity.y > 0 && yMoved === 0) {
      this.velocity.y = 0;
    } else {
      this.onGround = false;
    }
    return dist < stopDistance;
  }

  private moveAxis(axis: "x" | "y" | "z", delta: number, world: VoxelWorld): number {
    if (delta === 0) return 0;
    const before = this.position[axis];
    this.position[axis] += delta;
    if (world.aabbCollidesSolid(this.position, this.halfWidth, this.height)) {
      this.position[axis] = before;
      return 0;
    }
    return delta;
  }

  protected faceToward(target: THREE.Vector3): void {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    if (dx * dx + dz * dz < 1e-6) return;
    // Mesh's local +Z is the front (eyes, sword tip), so facing = atan2(dx, dz).
    this.facing = Math.atan2(dx, dz);
  }

  /** Returns true if `attackerPos` is behind the monster (relative to its facing). */
  isHitFromBehind(attackerPos: THREE.Vector3): boolean {
    const dx = attackerPos.x - this.position.x;
    const dz = attackerPos.z - this.position.z;
    // Monster's world forward is (sin facing, 0, cos facing). Attacker is
    // "behind" if their offset projects negatively onto that forward.
    const fx = Math.sin(this.facing);
    const fz = Math.cos(this.facing);
    return dx * fx + dz * fz < 0;
  }

  syncMesh(): void {
    this.mesh.position.set(this.position.x, this.position.y, this.position.z);
    this.mesh.rotation.y = this.facing;
    this.healthBar.setPosition(
      this.position.clone().add(new THREE.Vector3(0, this.height + 0.35, 0)),
    );
    this.healthBar.setRatio(this.hp / this.maxHp);
  }
}

// ─── helpers to build chunky humanoids ──────────────────────────────────────

function box(w: number, h: number, d: number, color: number, opts?: { emissive?: number; emissiveIntensity?: number }): THREE.Mesh {
  const geom = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshLambertMaterial({
    color,
    emissive: opts?.emissive ?? 0x000000,
    emissiveIntensity: opts?.emissiveIntensity ?? 0,
  });
  const m = new THREE.Mesh(geom, mat);
  // Monsters skip shadow casting (only the dragon casts) — saves the shadow
  // pass from rasterizing dozens of small humanoid parts every frame.
  m.castShadow = false;
  m.receiveShadow = true;
  return m;
}

// ─── Troll ──────────────────────────────────────────────────────────────────

const TROLL_THROW_RANGE = 7.0;
const TROLL_MELEE_RANGE = 2.0;
const TROLL_SPEED = 2.2;
const TROLL_THROW_COOLDOWN = 2.0;
const TROLL_WINDUP = 0.6;
const TROLL_MELEE_COOLDOWN = 1.0;

export class Troll extends Monster {
  private windup = 0; // > 0 means charging an axe throw

  constructor() {
    super("troll", 60, 0.55, 2.4, "TROLL", "#88dd55");
    this.buildMesh();
  }

  private buildMesh(): void {
    const skin = 0x4a7d3f;
    const cloth = 0x402a1a;
    const body = box(1.0, 1.2, 0.7, skin);
    body.position.y = 0.6 + 0.7; // feet=0; legs section ~0.7 tall

    const head = box(0.7, 0.6, 0.7, skin);
    head.position.y = 0.7 + 1.2 + 0.3;

    const legL = box(0.35, 0.7, 0.35, cloth); legL.position.set(-0.25, 0.35, 0);
    const legR = box(0.35, 0.7, 0.35, cloth); legR.position.set( 0.25, 0.35, 0);
    const armL = box(0.3, 1.1, 0.3, skin);    armL.position.set(-0.7, 1.45, 0);
    const armR = box(0.3, 1.1, 0.3, skin);    armR.position.set( 0.7, 1.45, 0);
    // Axe in right hand
    const axe = makeAxeMesh();
    axe.position.set(0.7, 0.9, 0.0);
    axe.rotation.z = -Math.PI / 8;
    this.mesh.add(body, head, legL, legR, armL, armR, axe);
  }

  update(dt: number, ctx: MonsterContext): void {
    if (!this.alive) return;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    const target = ctx.player.position;
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const dist = Math.hypot(dx, dz);

    if (this.windup > 0) {
      this.windup -= dt;
      this.faceToward(target);
      // Stand still during windup, but still apply gravity.
      this.velocity.x = 0;
      this.velocity.z = 0;
      this.velocity.y -= GRAVITY * dt;
      const yMoved = this.moveAxisPublic("y", this.velocity.y * dt, ctx.world);
      if (this.velocity.y < 0 && yMoved === 0) { this.velocity.y = 0; this.onGround = true; }
      if (this.windup <= 0) this.throwAxe(ctx);
    } else if (dist > TROLL_THROW_RANGE) {
      this.stepToward(target, TROLL_SPEED, dt, ctx, 0.2);
    } else if (dist > TROLL_MELEE_RANGE) {
      // In range: stop and charge axe if cooldown ready, otherwise hold position.
      if (this.attackCooldown <= 0) {
        this.windup = TROLL_WINDUP;
      } else {
        this.stepToward(target, TROLL_SPEED * 0.5, dt, ctx, dist); // creep forward slowly
      }
    } else {
      // Melee: bonk player.
      this.stepToward(target, TROLL_SPEED, dt, ctx, TROLL_MELEE_RANGE - 0.2);
      if (this.attackCooldown <= 0) {
        ctx.player.takeDamage(20);
        this.attackCooldown = TROLL_MELEE_COOLDOWN;
      }
    }
    this.syncMesh();
  }

  private throwAxe(ctx: MonsterContext): void {
    const launchAt = this.position.clone();
    launchAt.y += this.eyeHeight;
    const aim = new THREE.Vector3(
      ctx.player.position.x - launchAt.x,
      ctx.player.position.y + 1.0 - launchAt.y,
      ctx.player.position.z - launchAt.z,
    ).normalize();
    const proj = new Projectile({
      position: launchAt,
      velocity: aim.multiplyScalar(14),
      team: "monster",
      damage: 20,
      mesh: makeAxeMesh(),
      lifetime: 3,
      spinAxis: new THREE.Vector3(1, 0, 0),
      spinSpeed: 18,
    });
    ctx.fireProjectile(proj);
    this.attackCooldown = TROLL_THROW_COOLDOWN;
  }

  private moveAxisPublic(axis: "x" | "y" | "z", delta: number, world: VoxelWorld): number {
    if (delta === 0) return 0;
    const before = this.position[axis];
    this.position[axis] += delta;
    if (world.aabbCollidesSolid(this.position, this.halfWidth, this.height)) {
      this.position[axis] = before;
      return 0;
    }
    return delta;
  }

  protected override deathColor(): THREE.ColorRepresentation { return 0x4a7d3f; }
  protected override shurikensOnDeath(): number { return 4; }
}

// ─── Statue Knight ──────────────────────────────────────────────────────────

const KNIGHT_WAKE_DISTANCE = 5.5;
const KNIGHT_WAKE_TIME = 0.6;
const KNIGHT_SPEED = 3.6;
const KNIGHT_MELEE_RANGE = 2.0;
const KNIGHT_MELEE_COOLDOWN = 1.1;

type KnightState = "dormant" | "waking" | "active";

export class Knight extends Monster {
  private state: KnightState = "dormant";
  private wakeTimer = 0;
  private bodyMat!: THREE.MeshLambertMaterial;
  private eyeMat!: THREE.MeshLambertMaterial;

  constructor() {
    super("knight", 80, 0.4, 2.0, "STATUE KNIGHT", "#cdd2e0");
    this.buildMesh();
    this.healthBar.setVisible(false); // hidden until awake
  }

  private buildMesh(): void {
    const stone = 0x6f6f78;
    this.bodyMat = new THREE.MeshLambertMaterial({ color: stone });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.5), this.bodyMat);
    torso.position.y = 0.6 + 0.5;
    const head  = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), this.bodyMat);
    head.position.y  = 0.6 + 1.0 + 0.25;
    const legL  = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 0.3), this.bodyMat); legL.position.set(-0.2, 0.3, 0);
    const legR  = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 0.3), this.bodyMat); legR.position.set( 0.2, 0.3, 0);
    const armL  = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.0, 0.25), this.bodyMat); armL.position.set(-0.6, 1.1, 0);
    const armR  = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.0, 0.25), this.bodyMat); armR.position.set( 0.6, 1.1, 0);

    // Sword in right hand
    const sword = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 1.1, 0.18),
      new THREE.MeshLambertMaterial({ color: 0xcfd2d8 }),
    );
    sword.position.set(0.6, 0.6, 0.3);

    // Eyes — start dark, glow when active
    this.eyeMat = new THREE.MeshLambertMaterial({ color: 0x222222, emissive: 0x000000, emissiveIntensity: 0 });
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.04), this.eyeMat); eyeL.position.set(-0.1, 1.85, 0.26);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.04), this.eyeMat); eyeR.position.set( 0.1, 1.85, 0.26);

    for (const m of [torso, head, legL, legR, armL, armR, sword]) {
      m.castShadow = false;
      m.receiveShadow = true;
    }
    this.mesh.add(torso, head, legL, legR, armL, armR, sword, eyeL, eyeR);
  }

  update(dt: number, ctx: MonsterContext): void {
    if (!this.alive) return;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    const target = ctx.player.position;
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const dist = Math.hypot(dx, dz);

    if (this.state === "dormant") {
      this.velocity.set(0, 0, 0);
      if (dist < KNIGHT_WAKE_DISTANCE) {
        this.state = "waking";
        this.wakeTimer = KNIGHT_WAKE_TIME;
        this.healthBar.setVisible(true);
        this.bodyMat.color.setHex(0x9a9aa4);
        this.eyeMat.color.setHex(0xff3030);
        this.eyeMat.emissive.setHex(0xff3030);
        this.eyeMat.emissiveIntensity = 1.5;
      }
    } else if (this.state === "waking") {
      this.wakeTimer -= dt;
      this.faceToward(target);
      if (this.wakeTimer <= 0) this.state = "active";
    } else {
      this.stepToward(target, KNIGHT_SPEED, dt, ctx, KNIGHT_MELEE_RANGE - 0.2);
      if (dist < KNIGHT_MELEE_RANGE && this.attackCooldown <= 0) {
        ctx.player.takeDamage(15);
        this.attackCooldown = KNIGHT_MELEE_COOLDOWN;
      }
    }
    this.syncMesh();
  }

  protected override modifyIncoming(amount: number, fromBehind: boolean): number {
    if (this.state === "dormant") return amount; // stone defenseless until woken
    return fromBehind ? amount * 2 : amount * 0.5;
  }

  protected override deathColor(): THREE.ColorRepresentation { return 0x9a9aa4; }
  protected override shurikensOnDeath(): number { return 3; }
}

// ─── Jiujitsu Master ────────────────────────────────────────────────────────

const JIU_SPEED = 6.0;
const JIU_GRAPPLE_RANGE = 1.6;
const JIU_GRAPPLE_DURATION = 2.0;
const JIU_GRAPPLE_DAMAGE_PER_SEC = 12;
const JIU_GRAPPLE_COOLDOWN = 1.6;

export class Jiujitsu extends Monster {
  private grappleTimer = 0;
  private grappleDamageBuffer = 0;

  constructor() {
    super("jiujitsu", 50, 0.35, 1.85, "JIUJITSU", "#ffe5a8");
    this.buildMesh();
  }

  private buildMesh(): void {
    const gi = 0xf2efe6;
    const belt = 0x222222;
    const skin = 0xc99a72;
    const torso = box(0.6, 0.8, 0.4, gi);
    torso.position.y = 0.55 + 0.4;
    const beltMesh = box(0.62, 0.1, 0.42, belt);
    beltMesh.position.y = 0.55 + 0.05;
    const head = box(0.45, 0.45, 0.45, skin);
    head.position.y = 0.55 + 0.8 + 0.25;
    const legL = box(0.25, 0.55, 0.25, gi); legL.position.set(-0.15, 0.275, 0);
    const legR = box(0.25, 0.55, 0.25, gi); legR.position.set( 0.15, 0.275, 0);
    const armL = box(0.2, 0.8, 0.2, gi);    armL.position.set(-0.4, 1.0, 0);
    const armR = box(0.2, 0.8, 0.2, gi);    armR.position.set( 0.4, 1.0, 0);
    this.mesh.add(torso, beltMesh, head, legL, legR, armL, armR);
  }

  update(dt: number, ctx: MonsterContext): void {
    if (!this.alive) return;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    if (this.grappleTimer > 0) {
      this.grappleTimer -= dt;
      this.grappleDamageBuffer += JIU_GRAPPLE_DAMAGE_PER_SEC * dt;
      while (this.grappleDamageBuffer >= 1) {
        ctx.player.takeDamage(1);
        this.grappleDamageBuffer -= 1;
      }
      this.faceToward(ctx.player.position);
      // Stick to the player's side during the hold.
      const dx = ctx.player.position.x - this.position.x;
      const dz = ctx.player.position.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d > JIU_GRAPPLE_RANGE * 0.6) {
        this.velocity.x = (dx / d) * JIU_SPEED;
        this.velocity.z = (dz / d) * JIU_SPEED;
      } else {
        this.velocity.x = 0;
        this.velocity.z = 0;
      }
      this.velocity.y -= GRAVITY * dt;
      this.applyVelocity(dt, ctx);
      if (this.grappleTimer <= 0) this.attackCooldown = JIU_GRAPPLE_COOLDOWN;
    } else {
      const reached = this.stepToward(ctx.player.position, JIU_SPEED, dt, ctx, JIU_GRAPPLE_RANGE * 0.7);
      if (reached && this.attackCooldown <= 0 && !ctx.player.isGrappled()) {
        this.grappleTimer = JIU_GRAPPLE_DURATION;
        this.grappleDamageBuffer = 0;
        ctx.player.applyGrapple(JIU_GRAPPLE_DURATION);
      }
    }
    this.syncMesh();
  }

  private applyVelocity(dt: number, ctx: MonsterContext): void {
    const before = this.position.clone();
    this.position.x += this.velocity.x * dt;
    if (ctx.world.aabbCollidesSolid(this.position, this.halfWidth, this.height)) this.position.x = before.x;
    this.position.z += this.velocity.z * dt;
    if (ctx.world.aabbCollidesSolid(this.position, this.halfWidth, this.height)) this.position.z = before.z;
    this.position.y += this.velocity.y * dt;
    if (ctx.world.aabbCollidesSolid(this.position, this.halfWidth, this.height)) {
      this.position.y = before.y;
      if (this.velocity.y < 0) { this.velocity.y = 0; this.onGround = true; }
    } else {
      this.onGround = false;
    }
  }

  protected override deathColor(): THREE.ColorRepresentation { return 0xf2efe6; }
  protected override shurikensOnDeath(): number { return 6; }
}

export function makeMonster(kind: MonsterKind): Monster {
  switch (kind) {
    case "troll": return new Troll();
    case "knight": return new Knight();
    case "jiujitsu": return new Jiujitsu();
  }
}
