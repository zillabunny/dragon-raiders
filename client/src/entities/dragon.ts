import * as THREE from "three";
import { HealthBar } from "../ui/healthBar";
import { sound } from "../audio/sound";
import { Fireball } from "./fireball";
import type { ParticleSystem } from "../combat/particles";
import { KATANA_RANGE, KATANA_ARC_RADIANS } from "../combat/weapons";

const SCALE_COLOR = 0x4a1a3a;
const BELLY_COLOR = 0x2a0a1c;
const SCALE_DARK  = 0x301020;
const EYE_COLOR   = 0xff2828;

const MAX_HP = 500;
const BODY_RADIUS = 3.0;       // melee + projectile fudge radius
const DRAGON_HEIGHT = 3.5;
const FLY_OFFSET = 6;
const ORBIT_RADIUS = 3.0;

const ENGAGE_DISTANCE = 12;

// Phase 1 combat tuning
const P1_COOLDOWN = 1.8;
const BITE_RANGE = 4.5;
const BITE_HALF_ANGLE = Math.PI / 4;         // 45°
const TAIL_RANGE = 5.0;
const TAIL_FRONT_SAFE_COS = 0.5;             // player safe in 60° front cone
const ATK_WINDUP = 0.5;
const ATK_ACTIVE = 0.75;
const ATK_RECOVER = 1.3;

// Phase 2
const P2_FIREBALL_COOLDOWN = 3.5;

// Phase 3
const P3_BREATH_COOLDOWN = 3.5;
const BREATH_RANGE = 8.0;
const BREATH_HALF_ANGLE = Math.PI / 5;       // 36°
const BREATH_TELEGRAPH = 0.7;
const BREATH_ACTIVE = 1.5;
const BREATH_RECOVER = 1.2;
const BREATH_TICK_INTERVAL = 0.4;
const BREATH_TICK_DAMAGE = 7;

type DragonState =
  | "idle"
  | "engaging"
  | "phase1"
  | "takeoff"
  | "phase2"
  | "landing"
  | "phase3"
  | "dying"
  | "dead";

type AttackKind = "bite" | "tail" | "firebreath";
type AttackPhase = "windup" | "active" | "recover";

interface ActiveAttack {
  kind: AttackKind;
  phase: AttackPhase;
  timer: number;
  hasHit: boolean;
  breathTickTimer: number;
}

/** Things the dragon needs from the wider game world to perform its attacks. */
export interface DragonContext {
  particles: ParticleSystem;
  damagePlayer(amount: number): void;
  spawnFireball(fb: Fireball): void;
  dropShurikens(at: THREE.Vector3, n: number): void;
  spawnTreasure(at: THREE.Vector3): void;
}

export class Dragon {
  readonly mesh = new THREE.Group();
  readonly position = new THREE.Vector3();
  readonly healthBar = new HealthBar(2.6, 0.2, "DRAGON", "#ff5050");

  readonly maxHp = MAX_HP;
  hp = MAX_HP;
  alive = true;
  state: DragonState = "idle";
  readonly height = DRAGON_HEIGHT;

  /** Fires whenever the dragon enters a new top-level state. */
  onStateChange?: (state: DragonState, prev: DragonState) => void;

  private yaw = 0;
  private groundY = 0;
  private flyY = 0;
  private bossCenterX = 0;
  private bossCenterZ = 0;

  // Combat state
  private cooldown = 0;
  private attack: ActiveAttack | null = null;
  private orbitAngle = 0;
  private transitionTimer = 0;

  // Animated mesh parts
  private bodyMat!: THREE.MeshLambertMaterial;
  private bellyMat!: THREE.MeshLambertMaterial;
  private darkMat!: THREE.MeshLambertMaterial;
  private eyeMat!: THREE.MeshLambertMaterial;
  private mouthGlow!: THREE.Mesh;
  private mouthGlowMat!: THREE.MeshBasicMaterial;
  private mouthLight!: THREE.PointLight;
  private wingPivotL!: THREE.Group;
  private wingPivotR!: THREE.Group;
  private jawPivot!: THREE.Group;

  constructor() {
    this.buildMesh();
    this.healthBar.setVisible(false);
  }

  // ─── Mesh ──────────────────────────────────────────────────────────────

  private buildMesh(): void {
    this.bodyMat = new THREE.MeshLambertMaterial({ color: SCALE_COLOR });
    this.bellyMat = new THREE.MeshLambertMaterial({ color: BELLY_COLOR });
    this.darkMat = new THREE.MeshLambertMaterial({ color: SCALE_DARK });
    this.eyeMat = new THREE.MeshLambertMaterial({
      color: EYE_COLOR, emissive: EYE_COLOR, emissiveIntensity: 2.6,
    });
    const wingMat = new THREE.MeshLambertMaterial({ color: 0x2a0a1c, side: THREE.DoubleSide });

    // Default castShadow false; we re-enable on the body silhouette parts
    // below so the dragon still drops a shadow without paying for every horn,
    // jaw, eye, etc.
    const box = (w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.castShadow = false;
      m.receiveShadow = true;
      return m;
    };

    const body = box(2.6, 1.8, 4.6, this.bodyMat); body.position.y = 1.5;
    const belly = box(1.9, 0.5, 3.6, this.bellyMat); belly.position.y = 0.85;

    const neck = box(1.1, 1.0, 1.6, this.bodyMat);
    neck.position.set(0, 2.2, 2.6);
    neck.rotation.x = -0.4;

    const head = box(1.4, 1.2, 2.0, this.bodyMat); head.position.set(0, 2.7, 3.8);
    const eyeL = box(0.18, 0.18, 0.12, this.eyeMat); eyeL.position.set(-0.42, 2.95, 4.45);
    const eyeR = box(0.18, 0.18, 0.12, this.eyeMat); eyeR.position.set( 0.42, 2.95, 4.45);

    const hornL = box(0.18, 0.6, 0.18, this.darkMat);
    hornL.position.set(-0.45, 3.45, 3.5);
    hornL.rotation.set(-0.3, 0, 0.2);
    const hornR = hornL.clone();
    hornR.position.x = 0.45;
    hornR.rotation.z = -0.2;

    // Jaw on a pivot so it can drop open when attacking.
    this.jawPivot = new THREE.Group();
    this.jawPivot.position.set(0, 2.45, 3.4);
    const jaw = box(1.2, 0.35, 1.5, this.darkMat);
    jaw.position.set(0, -0.18, 0.7);
    this.jawPivot.add(jaw);

    // Mouth glow: hidden by default, intensifies during fire breath telegraph.
    this.mouthGlowMat = new THREE.MeshBasicMaterial({
      color: 0xff6020, transparent: true, opacity: 0.0, depthWrite: false,
    });
    this.mouthGlow = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 8), this.mouthGlowMat);
    this.mouthGlow.position.set(0, 2.55, 4.6);
    this.mouthGlow.renderOrder = 5;

    this.mouthLight = new THREE.PointLight(0xff5020, 0.0, 10, 2);
    this.mouthLight.position.set(0, 2.55, 4.6);

    // Wings on pivot groups anchored at the body-side hinge.
    this.wingPivotL = new THREE.Group();
    this.wingPivotL.position.set(-1.2, 2.7, -0.2);
    const wingL = box(3.0, 0.12, 2.2, wingMat);
    wingL.position.set(-1.5, 0, 0); // extend left from pivot
    this.wingPivotL.add(wingL);
    this.wingPivotL.rotation.z = 0.45;

    this.wingPivotR = new THREE.Group();
    this.wingPivotR.position.set(1.2, 2.7, -0.2);
    const wingR = box(3.0, 0.12, 2.2, wingMat);
    wingR.position.set(1.5, 0, 0);
    this.wingPivotR.add(wingR);
    this.wingPivotR.rotation.z = -0.45;

    const leg = (x: number, z: number): THREE.Mesh => {
      const m = box(0.55, 1.3, 0.55, this.darkMat);
      m.position.set(x, 0.65, z);
      return m;
    };

    const tail1 = box(0.9, 0.9, 1.6, this.bodyMat); tail1.position.set(0, 1.4, -2.9);
    const tail2 = box(0.65, 0.65, 1.4, this.bodyMat); tail2.position.set(0, 1.3, -4.1);
    const tail3 = box(0.4, 0.4, 1.0, this.bodyMat); tail3.position.set(0, 1.2, -5.0);

    const legFL = leg(-1.0,  1.6);
    const legFR = leg( 1.0,  1.6);
    const legBL = leg(-1.0, -1.4);
    const legBR = leg( 1.0, -1.4);

    // Only the silhouette parts cast shadow — keeps the dragon's floor
    // shadow recognizable without paying for horns/eyes/jaw.
    for (const m of [body, head, legFL, legFR, legBL, legBR, tail1, tail2]) {
      m.castShadow = true;
    }

    this.mesh.add(
      body, belly, neck, head, eyeL, eyeR, hornL, hornR,
      this.jawPivot, this.mouthGlow, this.mouthLight,
      this.wingPivotL, this.wingPivotR,
      legFL, legFR, legBL, legBR,
      tail1, tail2, tail3,
    );
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────

  spawn(at: THREE.Vector3, yaw = 0): void {
    this.position.copy(at);
    this.groundY = at.y;
    this.flyY = at.y + FLY_OFFSET;
    this.bossCenterX = at.x;
    this.bossCenterZ = at.z;
    this.yaw = yaw;
    this.hp = this.maxHp;
    this.alive = true;
    this.cooldown = 0;
    this.attack = null;
    this.orbitAngle = 0;
    this.transitionTimer = 0;
    this.setState("idle");
    this.healthBar.setVisible(false);
    this.healthBar.setRatio(1);
    this.resetVisualBuffs();
    this.mesh.position.copy(at);
    this.mesh.rotation.y = yaw;
  }

  private resetVisualBuffs(): void {
    this.bodyMat.emissive.setHex(0x000000);
    this.bodyMat.emissiveIntensity = 0;
    this.eyeMat.emissiveIntensity = 2.6;
    this.mouthGlowMat.opacity = 0;
    this.mouthLight.intensity = 0;
    this.jawPivot.rotation.x = 0;
  }

  private setState(state: DragonState): void {
    const prev = this.state;
    this.state = state;
    this.onStateChange?.(state, prev);
  }

  /** Engage the boss fight (called by Game when player is close or first hit lands). */
  engage(): void {
    if (this.state !== "idle") return;
    this.setState("engaging");
    this.transitionTimer = 1.4;
    sound.dragonRoar();
  }

  takeDamage(amount: number, ctx: DragonContext): void {
    if (this.state === "idle") this.engage();
    if (this.state === "dying" || this.state === "dead" || this.state === "engaging") return;
    if (this.state === "takeoff" || this.state === "landing") return; // invulnerable mid-transition

    this.hp = Math.max(0, this.hp - amount);
    sound.dragonHit();
    if (this.hp <= 0) {
      this.startDying(ctx);
    } else if (this.state === "phase1" && this.hp <= this.maxHp * 0.66) {
      this.startTakeoff(ctx);
    } else if (this.state === "phase2" && this.hp <= this.maxHp * 0.33) {
      this.startLanding(ctx);
    }
  }

  /** Reset visible attack telegraphs so we don't freeze the jaw mid-bite. */
  private resetAttackVisuals(): void {
    this.jawPivot.rotation.x = 0;
    this.mouthGlowMat.opacity = 0;
    this.mouthLight.intensity = 0;
  }

  private startTakeoff(ctx: DragonContext): void {
    this.setState("takeoff");
    this.transitionTimer = 2.0;
    this.attack = null;
    this.cooldown = 1.5;
    this.resetAttackVisuals();
    sound.dragonRoar();
    // Help the player out: drop 10 stars so phase 2 is actually fightable.
    ctx.dropShurikens(this.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 10);
  }

  private startLanding(ctx: DragonContext): void {
    this.setState("landing");
    this.transitionTimer = 1.4;
    this.attack = null;
    this.cooldown = 1.2;
    this.resetAttackVisuals();
    sound.dragonRoar();
    // Another small drop entering P3.
    ctx.dropShurikens(this.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 6);
  }

  private startDying(ctx: DragonContext): void {
    this.setState("dying");
    this.transitionTimer = 3.0;
    this.attack = null;
    this.alive = false;
    this.cooldown = 0;
    this.resetAttackVisuals();
    sound.dragonDeath();
    ctx.particles.emitPuff(
      this.position.clone().add(new THREE.Vector3(0, this.height * 0.6, 0)),
      0xff6030, 80, 7,
    );
  }

  // ─── Update ────────────────────────────────────────────────────────────

  update(dt: number, playerPos: THREE.Vector3, ctx: DragonContext): void {
    // Idle proximity engagement.
    if (this.state === "idle") {
      const dx = playerPos.x - this.position.x;
      const dz = playerPos.z - this.position.z;
      if (dx * dx + dz * dz < ENGAGE_DISTANCE * ENGAGE_DISTANCE) this.engage();
    }

    switch (this.state) {
      case "idle": this.updateIdleBob(); break;
      case "engaging": this.updateEngaging(dt, playerPos); break;
      case "phase1": this.updatePhase1(dt, playerPos, ctx); break;
      case "takeoff": this.updateTakeoff(dt, ctx); break;
      case "phase2": this.updatePhase2(dt, playerPos, ctx); break;
      case "landing": this.updateLanding(dt, ctx); break;
      case "phase3": this.updatePhase3(dt, playerPos, ctx); break;
      case "dying": this.updateDying(dt, ctx); break;
      case "dead": break;
    }

    this.updateWings();
    this.updateHealthBar();
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.yaw;
  }

  private updateIdleBob(): void {
    const t = performance.now() / 1000;
    this.mesh.position.y = this.groundY + Math.sin(t * 0.7) * 0.06;
  }

  private updateEngaging(dt: number, playerPos: THREE.Vector3): void {
    this.transitionTimer -= dt;
    this.faceTowardSmooth(playerPos, dt, 2.0);
    // Small rear-up: lift body a bit.
    this.position.y = this.groundY + (1.4 - this.transitionTimer) * 0.15;
    if (this.transitionTimer <= 0) {
      this.position.y = this.groundY;
      this.setState("phase1");
      this.cooldown = 1.0;
    }
  }

  private updatePhase1(dt: number, playerPos: THREE.Vector3, ctx: DragonContext): void {
    this.position.y = this.groundY;
    this.faceTowardSmooth(playerPos, dt, 1.2);

    if (this.attack) {
      this.tickAttack(dt, playerPos, ctx);
      return;
    }

    this.cooldown -= dt;
    if (this.cooldown > 0) return;

    // Choose attack based on player position.
    const dx = playerPos.x - this.position.x;
    const dz = playerPos.z - this.position.z;
    const flat = Math.hypot(dx, dz);
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const frontDot = flat > 0 ? (dx / flat) * fx + (dz / flat) * fz : 1;

    if (flat < BITE_RANGE && frontDot > 0.5) {
      this.attack = { kind: "bite", phase: "windup", timer: 0, hasHit: false, breathTickTimer: 0 };
    } else if (flat < TAIL_RANGE + 1) {
      this.attack = { kind: "tail", phase: "windup", timer: 0, hasHit: false, breathTickTimer: 0 };
    } else {
      // Out of melee range: shuffle toward the player.
      const speed = 1.8;
      this.position.x += (dx / flat) * speed * dt;
      this.position.z += (dz / flat) * speed * dt;
      this.cooldown = 0.3;
    }
  }

  private tickAttack(dt: number, playerPos: THREE.Vector3, ctx: DragonContext): void {
    const atk = this.attack!;
    atk.timer += dt;

    if (atk.kind === "bite") {
      if (atk.timer < ATK_WINDUP) {
        // Telegraph: open jaw progressively.
        this.jawPivot.rotation.x = (atk.timer / ATK_WINDUP) * 0.5;
      } else if (atk.timer < ATK_ACTIVE) {
        this.jawPivot.rotation.x = 0.5;
        if (!atk.hasHit && this.biteHits(playerPos)) {
          ctx.damagePlayer(25);
          atk.hasHit = true;
        }
      } else if (atk.timer < ATK_RECOVER) {
        const r = (atk.timer - ATK_ACTIVE) / (ATK_RECOVER - ATK_ACTIVE);
        this.jawPivot.rotation.x = 0.5 * (1 - r);
      } else {
        this.jawPivot.rotation.x = 0;
        this.attack = null;
        this.cooldown = P1_COOLDOWN;
      }
    } else if (atk.kind === "tail") {
      if (atk.timer < ATK_WINDUP) {
        // Telegraph: nothing dramatic visually yet; ramp emissive a tick.
      } else if (atk.timer < ATK_ACTIVE) {
        if (!atk.hasHit && this.tailHits(playerPos)) {
          ctx.damagePlayer(20);
          atk.hasHit = true;
          ctx.particles.emitPuff(
            playerPos.clone().add(new THREE.Vector3(0, 0.7, 0)),
            0xaa6040, 18, 3,
          );
        }
      } else if (atk.timer >= ATK_RECOVER) {
        this.attack = null;
        this.cooldown = P1_COOLDOWN;
      }
    } else if (atk.kind === "firebreath") {
      this.tickFireBreath(atk, dt, playerPos, ctx);
    }
  }

  private tickFireBreath(atk: ActiveAttack, dt: number, playerPos: THREE.Vector3, ctx: DragonContext): void {
    const tg = BREATH_TELEGRAPH;
    const ac = tg + BREATH_ACTIVE;
    const rc = ac + BREATH_RECOVER;
    const prev = atk.timer - dt;

    if (atk.timer < tg) {
      const t = atk.timer / tg;
      this.mouthGlowMat.opacity = t * 0.9;
      this.mouthLight.intensity = t * 4;
      this.jawPivot.rotation.x = t * 0.55;
    } else if (atk.timer < ac) {
      if (prev < tg) sound.fireBreath();
      this.mouthGlowMat.opacity = 1.0;
      this.mouthLight.intensity = 5;
      this.jawPivot.rotation.x = 0.55;
      this.emitBreathParticles(ctx);
      atk.breathTickTimer += dt;
      if (atk.breathTickTimer >= BREATH_TICK_INTERVAL) {
        atk.breathTickTimer = 0;
        if (this.fireBreathHits(playerPos)) ctx.damagePlayer(BREATH_TICK_DAMAGE);
      }
    } else if (atk.timer < rc) {
      const r = (atk.timer - ac) / (rc - ac);
      this.mouthGlowMat.opacity = 0.9 * (1 - r);
      this.mouthLight.intensity = 4 * (1 - r);
      this.jawPivot.rotation.x = 0.55 * (1 - r);
    } else {
      this.mouthGlowMat.opacity = 0;
      this.mouthLight.intensity = 0;
      this.jawPivot.rotation.x = 0;
      this.attack = null;
      this.cooldown = P3_BREATH_COOLDOWN;
    }
  }

  private emitBreathParticles(ctx: DragonContext): void {
    // Spawn a small puff at a random point inside the cone in front of the dragon.
    const len = 1.5 + Math.random() * (BREATH_RANGE - 1.5);
    const ang = (Math.random() - 0.5) * 2 * BREATH_HALF_ANGLE;
    // Mesh forward in world is (sin yaw, 0, cos yaw); fire comes out the head.
    const fx = Math.sin(this.yaw + ang);
    const fz = Math.cos(this.yaw + ang);
    const x = this.position.x + fx * len;
    const z = this.position.z + fz * len;
    const y = this.position.y + 2.5 + (Math.random() - 0.5) * 0.4;
    ctx.particles.emitPuff(new THREE.Vector3(x, y, z), 0xff7820, 4, 2);
  }

  private updateTakeoff(dt: number, ctx: DragonContext): void {
    this.transitionTimer -= dt;
    const t = 1 - this.transitionTimer / 2.0; // 0→1
    this.position.x = this.bossCenterX;
    this.position.z = this.bossCenterZ;
    this.position.y = this.groundY + (this.flyY - this.groundY) * easeOutCubic(t);
    if (t > 0.5 && t < 0.55) {
      ctx.particles.emitPuff(this.position.clone(), 0x886040, 40, 5);
    }
    if (this.transitionTimer <= 0) {
      this.position.y = this.flyY;
      this.setState("phase2");
      this.cooldown = 1.5;
    }
  }

  private updatePhase2(dt: number, playerPos: THREE.Vector3, ctx: DragonContext): void {
    // Slow orbit around the boss room center.
    this.orbitAngle += dt * 0.35;
    this.position.x = this.bossCenterX + Math.cos(this.orbitAngle) * ORBIT_RADIUS;
    this.position.z = this.bossCenterZ + Math.sin(this.orbitAngle) * ORBIT_RADIUS;
    this.position.y = this.flyY + Math.sin(performance.now() / 1000 * 1.4) * 0.35;
    this.faceTowardSmooth(playerPos, dt, 1.2);

    this.cooldown -= dt;
    if (this.cooldown > 0) return;

    // Lob a fireball at the player's current spot.
    const mouth = this.mouthWorldPos();
    const target = new THREE.Vector3(playerPos.x, this.groundY, playerPos.z);
    ctx.spawnFireball(new Fireball(mouth, target));
    this.cooldown = P2_FIREBALL_COOLDOWN;
  }

  private updateLanding(dt: number, ctx: DragonContext): void {
    this.transitionTimer -= dt;
    const t = 1 - this.transitionTimer / 1.4;
    this.position.y = this.flyY + (this.groundY - this.flyY) * easeInCubic(t);
    this.position.x = this.bossCenterX;
    this.position.z = this.bossCenterZ;
    if (this.transitionTimer <= 0) {
      this.position.y = this.groundY;
      this.setState("phase3");
      this.cooldown = 1.5;
      // Impact dust.
      ctx.particles.emitPuff(this.position.clone(), 0x886040, 80, 7);
      // P3 visual: glow red.
      this.bodyMat.emissive.setHex(0x801020);
      this.bodyMat.emissiveIntensity = 0.45;
      this.eyeMat.emissiveIntensity = 3.8;
    }
  }

  private updatePhase3(dt: number, playerPos: THREE.Vector3, ctx: DragonContext): void {
    this.position.y = this.groundY;
    this.faceTowardSmooth(playerPos, dt, 1.4);

    if (this.attack) {
      this.tickAttack(dt, playerPos, ctx);
      return;
    }

    this.cooldown -= dt;
    if (this.cooldown > 0) return;

    this.attack = { kind: "firebreath", phase: "windup", timer: 0, hasHit: false, breathTickTimer: 0 };
  }

  private updateDying(dt: number, ctx: DragonContext): void {
    this.transitionTimer -= dt;
    const t = 1 - this.transitionTimer / 3.0;
    // Slump: rotate forward and sink.
    this.mesh.rotation.x = -0.6 * t;
    this.position.y = this.groundY + (-0.4) * t;
    // Periodic puffs.
    if (Math.random() < 0.4) {
      const off = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        Math.random() * 3,
        (Math.random() - 0.5) * 2,
      );
      ctx.particles.emitPuff(this.position.clone().add(off), 0xff5020, 12, 4);
    }
    // Fade glow out.
    this.bodyMat.emissiveIntensity = 0.45 * (1 - t);
    this.eyeMat.emissiveIntensity = 3.8 * (1 - t);

    if (this.transitionTimer <= 0) {
      this.setState("dead");
      this.healthBar.setVisible(false);
      // Drop the treasure pile in front of the dragon (mesh +Z direction) so
      // the player walks into it as they approach the corpse.
      const fx = Math.sin(this.yaw);
      const fz = Math.cos(this.yaw);
      const drop = new THREE.Vector3(
        this.bossCenterX + fx * 3.5,
        this.groundY,
        this.bossCenterZ + fz * 3.5,
      );
      ctx.spawnTreasure(drop);
    }
  }

  private updateWings(): void {
    const t = performance.now() / 1000;
    let flap = 0;
    if (this.state === "takeoff") flap = Math.sin(t * 14) * 0.7;
    else if (this.state === "phase2") flap = Math.sin(t * 7) * 0.45;
    else if (this.state === "landing") flap = Math.sin(t * 12) * 0.5;
    else flap = Math.sin(t * 0.6) * 0.05; // idle breathing
    this.wingPivotL.rotation.z = 0.45 + flap;
    this.wingPivotR.rotation.z = -0.45 - flap;
  }

  private updateHealthBar(): void {
    this.healthBar.setRatio(this.hp / this.maxHp);
    this.healthBar.setPosition(
      this.position.clone().add(new THREE.Vector3(0, this.height + 0.4, 0)),
    );
  }

  // ─── Hit tests (callable from Game) ────────────────────────────────────

  /** Returns true if the dragon body is in the player's melee cone. */
  isHitByMelee(playerPos: THREE.Vector3, forwardFlat: THREE.Vector3): boolean {
    if (this.state === "dying" || this.state === "dead") return false;
    const dx = this.position.x - playerPos.x;
    const dz = this.position.z - playerPos.z;
    const flat = Math.hypot(dx, dz);
    if (flat - BODY_RADIUS > KATANA_RANGE) return false;
    // Vertical reach: airborne dragon ignores melee.
    const dy = this.position.y - playerPos.y;
    if (Math.abs(dy) > this.height * 0.8) return false;
    if (flat === 0) return true;
    const nx = dx / flat;
    const nz = dz / flat;
    const cos = nx * forwardFlat.x + nz * forwardFlat.z;
    return cos >= Math.cos(KATANA_ARC_RADIANS / 2);
  }

  /** Returns true if a projectile's current position is inside the body sphere. */
  isHitByProjectile(projPos: THREE.Vector3): boolean {
    if (this.state === "dying" || this.state === "dead") return false;
    const dx = projPos.x - this.position.x;
    const dy = projPos.y - (this.position.y + this.height / 2);
    const dz = projPos.z - this.position.z;
    return dx * dx + dy * dy + dz * dz < BODY_RADIUS * BODY_RADIUS;
  }

  // ─── Internal helpers ──────────────────────────────────────────────────

  private faceTowardSmooth(target: THREE.Vector3, dt: number, rateRadPerSec: number): void {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    // Mesh convention: +Z is forward (head/eyes), so yaw = atan2(dx, dz).
    const want = Math.atan2(dx, dz);
    let diff = want - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const step = Math.sign(diff) * Math.min(Math.abs(diff), rateRadPerSec * dt);
    this.yaw += step;
  }

  private biteHits(playerPos: THREE.Vector3): boolean {
    const dx = playerPos.x - this.position.x;
    const dz = playerPos.z - this.position.z;
    const flat = Math.hypot(dx, dz);
    if (flat > BITE_RANGE || flat === 0) return false;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    return (dx / flat) * fx + (dz / flat) * fz > Math.cos(BITE_HALF_ANGLE);
  }

  private tailHits(playerPos: THREE.Vector3): boolean {
    const dx = playerPos.x - this.position.x;
    const dz = playerPos.z - this.position.z;
    const flat = Math.hypot(dx, dz);
    if (flat > TAIL_RANGE || flat === 0) return false;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const frontDot = (dx / flat) * fx + (dz / flat) * fz;
    return frontDot < TAIL_FRONT_SAFE_COS;
  }

  private fireBreathHits(playerPos: THREE.Vector3): boolean {
    const dx = playerPos.x - this.position.x;
    const dz = playerPos.z - this.position.z;
    const flat = Math.hypot(dx, dz);
    if (flat > BREATH_RANGE || flat === 0) return false;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    return (dx / flat) * fx + (dz / flat) * fz > Math.cos(BREATH_HALF_ANGLE);
  }

  /** World position of the dragon's mouth (fireball launch / fire breath origin). */
  private mouthWorldPos(): THREE.Vector3 {
    // Head is offset +z in local space, so the world mouth position is
    // (sin yaw, cos yaw) * distance from body center.
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    return new THREE.Vector3(
      this.position.x + fx * 4.6,
      this.position.y + 2.55,
      this.position.z + fz * 4.6,
    );
  }
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t: number): number {
  return t * t * t;
}
