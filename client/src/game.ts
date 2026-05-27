import * as THREE from "three";
import type { VoxelWorld } from "./world/voxelWorld";
import type { Player } from "./entities/player";
import { Projectile } from "./combat/projectile";
import { ParticleSystem } from "./combat/particles";
import { Pickup } from "./entities/pickup";
import { katanaTargets, spawnShuriken } from "./combat/weapons";
import {
  Monster,
  MonsterContext,
  MonsterSpawnSpec,
  makeMonster,
} from "./entities/monsters";
import { Hud } from "./ui/hud";
import { sound } from "./audio/sound";
import type { Dragon, DragonContext } from "./entities/dragon";
import { Fireball } from "./entities/fireball";
import { TreasurePile } from "./entities/treasurePile";

const MONSTER_AGGRO_RANGE = 16;

// Trickle-spawn tuning: keep monsters arriving one at a time, near the player,
// with a soft cap so they're never overwhelming.
const SPAWN_INTERVAL_SECONDS = 15;
const SPAWN_RETRY_DELAY = 4;
const MAX_ACTIVE_MONSTERS = 3;
const SPAWN_MIN_RANGE = 8;
const SPAWN_MAX_RANGE = 50;

/** Orchestrates the live game: monsters, projectiles, pickups, particles, HUD. */
export class Game {
  readonly monsters: Monster[] = [];
  readonly projectiles: Projectile[] = [];
  readonly pickups: Pickup[] = [];
  readonly fireballs: Fireball[] = [];
  readonly particles: ParticleSystem;
  readonly hud: Hud;
  dragon: Dragon | null = null;
  private treasure: TreasurePile | null = null;

  private spawnSpecs: MonsterSpawnSpec[] = [];
  private spawnQueue: MonsterSpawnSpec[] = [];
  private spawnTimer = 0;
  private gameOverShown = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: VoxelWorld,
    private readonly player: Player,
    private readonly camera: THREE.Camera,
  ) {
    this.particles = new ParticleSystem();
    this.scene.add(this.particles.object);
    this.hud = new Hud(() => this.restart());
  }

  setMonsterSpawns(specs: MonsterSpawnSpec[]): void {
    this.spawnSpecs = specs;
  }

  setDragon(dragon: Dragon): void {
    this.dragon = dragon;
    this.scene.add(dragon.mesh);
    this.scene.add(dragon.healthBar.group);
    dragon.onStateChange = (state) => this.onDragonStateChange(state);
  }

  private onDragonStateChange(state: Dragon["state"]): void {
    if (state === "engaging" || state === "phase1") {
      this.hud.setBossBarVisible(true, "DRAGON");
    } else if (state === "idle" || state === "dead") {
      this.hud.setBossBarVisible(false);
    }
  }

  private dragonCtx(): DragonContext {
    return {
      particles: this.particles,
      damagePlayer: (n) => this.player.takeDamage(n),
      spawnFireball: (fb) => {
        this.fireballs.push(fb);
        this.scene.add(fb.group);
      },
      dropShurikens: (at, amount) => {
        const pickup = new Pickup("shuriken", at, amount);
        this.pickups.push(pickup);
        this.scene.add(pickup.mesh);
      },
      spawnTreasure: (at) => this.spawnTreasure(at),
    };
  }

  private spawnTreasure(at: THREE.Vector3): void {
    this.clearTreasure();
    this.treasure = new TreasurePile(at);
    this.scene.add(this.treasure.mesh);
    this.scene.add(this.treasure.light);
  }

  private clearTreasure(): void {
    if (this.treasure) {
      this.scene.remove(this.treasure.mesh);
      this.scene.remove(this.treasure.light);
      this.treasure = null;
    }
  }

  private clearFireballs(): void {
    for (const fb of this.fireballs) this.scene.remove(fb.group);
    this.fireballs.length = 0;
  }

  private clearMonsters(): void {
    for (const m of this.monsters) {
      this.scene.remove(m.mesh);
      this.scene.remove(m.healthBar.group);
    }
    this.monsters.length = 0;
  }

  /** Spawn one monster from the queue + a small materialization puff. */
  private spawnFromSpec(spec: MonsterSpawnSpec): void {
    const m = makeMonster(spec.kind);
    m.spawn(spec.position, spec.facing ?? 0);
    this.monsters.push(m);
    this.scene.add(m.mesh);
    this.scene.add(m.healthBar.group);
    this.particles.emitPuff(
      spec.position.clone().add(new THREE.Vector3(0, m.height * 0.5, 0)),
      0x70a0e0,
      28,
      4,
    );
  }

  /**
   * Pick the queued spec nearest the player that falls in the spawn-range
   * band, splice it out and spawn it. Returns true on success.
   */
  private trySpawnNearPlayer(minRange: number, maxRange: number): boolean {
    if (this.spawnQueue.length === 0) return false;
    const pp = this.player.position;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.spawnQueue.length; i++) {
      const spec = this.spawnQueue[i];
      const dx = spec.position.x - pp.x;
      const dz = spec.position.z - pp.z;
      const dist = Math.hypot(dx, dz);
      if (dist < minRange || dist > maxRange) continue;
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    if (bestIdx === -1) return false;
    const [spec] = this.spawnQueue.splice(bestIdx, 1);
    this.spawnFromSpec(spec);
    return true;
  }

  private resetSpawnQueue(): void {
    this.spawnQueue = this.spawnSpecs.map(s => ({
      kind: s.kind,
      position: s.position.clone(),
      facing: s.facing,
    }));
    this.spawnTimer = 0;
    // Seed one monster nearby so the player has something to fight right away.
    this.trySpawnNearPlayer(6, 22);
  }

  start(): void {
    this.hud.setVisible(true);
    this.clearMonsters();
    this.resetSpawnQueue();
    this.updateHud();
  }

  restart(): void {
    // Clear projectiles, pickups, fireballs, relic.
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles.length = 0;
    for (const p of this.pickups) this.scene.remove(p.mesh);
    this.pickups.length = 0;
    this.clearFireballs();
    this.clearTreasure();

    this.player.spawn(
      this.playerSpawn ?? this.player.position.clone(),
      this.playerSpawnYaw,
    );

    // Reset dragon to idle, full HP.
    if (this.dragon && this.playerSpawn) {
      const d = this.dragon;
      // We need the dragon's original spawn point — stash it on first set.
      d.spawn(this.dragonSpawn ?? d.position.clone(), this.dragonSpawnYaw);
    }
    this.hud.setBossBarVisible(false);

    this.clearMonsters();
    this.resetSpawnQueue();
    this.gameOverShown = false;
    this.hud.hideGameOver();
    this.hud.hideVictory();
    this.updateHud();
    // Re-acquire pointer lock since the restart click/key may have released it.
    this.player.requestPointerLock();
  }

  private dragonSpawn: THREE.Vector3 | null = null;
  private dragonSpawnYaw = 0;
  setDragonSpawn(at: THREE.Vector3, yaw = 0): void {
    this.dragonSpawn = at.clone();
    this.dragonSpawnYaw = yaw;
  }

  private playerSpawn: THREE.Vector3 | null = null;
  private playerSpawnYaw = 0;
  setPlayerSpawn(at: THREE.Vector3, yaw = 0): void {
    this.playerSpawn = at.clone();
    this.playerSpawnYaw = yaw;
  }

  update(dt: number): void {
    this.player.update(dt);

    const dragonCtx = this.dragonCtx();

    // Resolve the player's queued attack (if any).
    const attack = this.player.consumeAttackRequest();
    if (attack) {
      if (attack.weapon === "katana") {
        sound.swing();
        const hit = katanaTargets(attack.origin, attack.forwardFlat, this.monsters);
        for (const m of hit) {
          const fromBehind = m.isHitFromBehind(this.player.position);
          const wasAlive = m.alive;
          m.takeDamage(25, fromBehind, this.monsterCtx());
          this.particles.emitPuff(
            m.position.clone().add(new THREE.Vector3(0, m.height * 0.6, 0)),
            fromBehind ? 0xffd060 : 0xff7060,
            10,
            3,
          );
          if (wasAlive && !m.alive) sound.monsterDeath();
          else sound.monsterHit();
        }
        // Katana vs dragon
        if (this.dragon && this.dragon.isHitByMelee(this.player.position, attack.forwardFlat)) {
          this.dragon.takeDamage(25, dragonCtx);
          this.particles.emitPuff(
            this.dragon.position.clone().add(new THREE.Vector3(0, this.dragon.height * 0.5, 0)),
            0xff8050, 12, 4,
          );
        }
      } else {
        sound.throwStar();
        const proj = spawnShuriken(attack.origin, attack.direction);
        this.projectiles.push(proj);
        this.scene.add(proj.mesh);
      }
    }

    const ctx = this.monsterCtx();
    const aggroSq = MONSTER_AGGRO_RANGE * MONSTER_AGGRO_RANGE;
    let activeCount = 0;
    for (const m of this.monsters) {
      if (m.alive) {
        activeCount++;
        const dx = this.player.position.x - m.position.x;
        const dz = this.player.position.z - m.position.z;
        if (dx * dx + dz * dz <= aggroSq) m.update(dt, ctx);
      }
      m.healthBar.billboard(this.camera);
    }

    // Trickle spawn — paused while the dragon is engaged so the boss fight
    // isn't drowned in mooks.
    const bossEngaged = this.dragon && this.dragon.state !== "idle" && this.dragon.state !== "dead";
    if (!bossEngaged) {
      this.spawnTimer += dt;
      if (this.spawnTimer >= SPAWN_INTERVAL_SECONDS && activeCount < MAX_ACTIVE_MONSTERS) {
        const spawned = this.trySpawnNearPlayer(SPAWN_MIN_RANGE, SPAWN_MAX_RANGE);
        this.spawnTimer = spawned ? 0 : SPAWN_INTERVAL_SECONDS - SPAWN_RETRY_DELAY;
      }
    }

    if (this.dragon) {
      this.dragon.update(dt, this.player.position, dragonCtx);
    }

    // Update projectiles + hit-test.
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      const alive = proj.update(dt, this.world);
      if (!alive) {
        this.scene.remove(proj.mesh);
        this.projectiles.splice(i, 1);
        continue;
      }
      if (proj.team === "player") {
        let consumed = false;
        for (const m of this.monsters) {
          if (!m.alive) continue;
          if (this.projectileHitsMonster(proj, m)) {
            const fromBehind = m.isHitFromBehind(proj.position);
            const wasAlive = m.alive;
            m.takeDamage(proj.damage, fromBehind, ctx);
            this.particles.emitPuff(proj.position.clone(), 0xff8060, 8, 3);
            this.scene.remove(proj.mesh);
            this.projectiles.splice(i, 1);
            if (wasAlive && !m.alive) sound.monsterDeath();
            else sound.monsterHit();
            consumed = true;
            break;
          }
        }
        if (!consumed && this.dragon && this.dragon.isHitByProjectile(proj.position)) {
          this.dragon.takeDamage(proj.damage, dragonCtx);
          this.particles.emitPuff(proj.position.clone(), 0xff7040, 12, 4);
          this.scene.remove(proj.mesh);
          this.projectiles.splice(i, 1);
        }
      } else {
        // monster projectile vs player
        if (this.projectileHitsPlayer(proj)) {
          this.player.takeDamage(proj.damage);
          this.particles.emitPuff(proj.position.clone(), 0xc04020, 8, 3);
          this.scene.remove(proj.mesh);
          this.projectiles.splice(i, 1);
        }
      }
    }

    // Fireballs (dragon Phase 2)
    for (let i = this.fireballs.length - 1; i >= 0; i--) {
      const fb = this.fireballs[i];
      const stillAlive = fb.update(dt, this.particles, this.player.position, (n) => this.player.takeDamage(n));
      if (!stillAlive) {
        this.scene.remove(fb.group);
        this.fireballs.splice(i, 1);
      }
    }

    // Pickups
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pickup = this.pickups[i];
      pickup.update(dt);
      const dx = pickup.position.x - this.player.position.x;
      const dy = pickup.position.y - (this.player.position.y + 0.9);
      const dz = pickup.position.z - this.player.position.z;
      if (dx * dx + dy * dy + dz * dz < 1.4 * 1.4) {
        this.player.addShurikens(pickup.amount);
        this.scene.remove(pickup.mesh);
        this.pickups.splice(i, 1);
      }
    }

    // Treasure pile: spawned next to the dragon's corpse; loot on contact.
    if (this.treasure) {
      this.treasure.update(dt, this.particles);
      if (!this.treasure.looted && this.treasure.inRange(this.player.position)) {
        this.treasure.loot(this.particles);
        sound.loot();
        sound.victory();
        this.hud.showVictory();
      }
    }

    this.particles.update(dt);
    this.updateHud();

    if (!this.player.alive && !this.gameOverShown) {
      this.gameOverShown = true;
      this.hud.showGameOver();
    }
  }

  private updateHud(): void {
    this.hud.setHp(this.player.hp, this.player.maxHp);
    this.hud.setShurikens(this.player.shurikens);
    this.hud.setWeapon(this.player.currentWeapon);
    this.hud.setHitFlash(this.player.hitFlash / 0.35);
    if (this.dragon) this.hud.setBossHp(this.dragon.hp, this.dragon.maxHp);
  }

  private projectileHitsMonster(proj: Projectile, m: Monster): boolean {
    // Quick AABB-ish overlap against monster's voxel AABB.
    const dx = Math.abs(proj.position.x - m.position.x);
    const dz = Math.abs(proj.position.z - m.position.z);
    if (dx > m.halfWidth + 0.25 || dz > m.halfWidth + 0.25) return false;
    if (proj.position.y < m.position.y || proj.position.y > m.position.y + m.height) return false;
    return true;
  }

  private projectileHitsPlayer(proj: Projectile): boolean {
    const pHalf = 0.4;
    const pHeight = 1.8;
    const dx = Math.abs(proj.position.x - this.player.position.x);
    const dz = Math.abs(proj.position.z - this.player.position.z);
    if (dx > pHalf + 0.2 || dz > pHalf + 0.2) return false;
    if (proj.position.y < this.player.position.y || proj.position.y > this.player.position.y + pHeight) return false;
    return true;
  }

  private monsterCtx(): MonsterContext {
    return {
      player: this.player,
      world: this.world,
      fireProjectile: (p) => { this.projectiles.push(p); this.scene.add(p.mesh); },
      emitPuff: (at, color, count) => this.particles.emitPuff(at, color, count ?? 24),
      dropShurikens: (at, amount) => {
        const pickup = new Pickup("shuriken", at, amount);
        this.pickups.push(pickup);
        this.scene.add(pickup.mesh);
      },
    };
  }
}
