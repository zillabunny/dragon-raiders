import * as THREE from "three";
import { VoxelWorld } from "./world/voxelWorld";
import { generateDungeon } from "./world/dungeon";
import { TorchPool } from "./world/torchPool";
import { Player } from "./entities/player";
import { Game } from "./game";
import { sound } from "./audio/sound";
import { Dragon } from "./entities/dragon";

const appEl = document.getElementById("app") as HTMLDivElement;
const startOverlay = document.getElementById("start-overlay") as HTMLDivElement;
const crosshair = document.getElementById("crosshair") as HTMLDivElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const fpsEl = document.getElementById("fps") as HTMLSpanElement;

const renderer = new THREE.WebGLRenderer({ antialias: false });
// DPR 1.25 keeps Retina output reasonably crisp at ~40% the pixel cost of
// full 2.0. Combined with antialias:false (Minecraft-style sharp edges) the
// fill-rate budget drops noticeably on integrated GPUs.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
// PCF (vs PCFSoft) is a much cheaper filter. The voxel aesthetic doesn't
// benefit much from soft-edged shadows anyway.
renderer.shadowMap.type = THREE.PCFShadowMap;
appEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const skyColor = new THREE.Color(0x0a0d18);
scene.background = skyColor;
scene.fog = new THREE.Fog(skyColor.getHex(), 10, 32);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  500,
);
// Camera must be in the scene graph so its children (the weapon viewmodel) render.
scene.add(camera);

// --- Lighting: warm torchlight + a hint of moon ------------------------------
// The dungeon is indoors so torches do most of the lifting; the directional
// light just adds a cool tint where it leaks through the lattice ceiling.

const ambient = new THREE.AmbientLight(0x405068, 0.45);
scene.add(ambient);

const hemi = new THREE.HemisphereLight(0x607090, 0x2a2014, 0.65);
scene.add(hemi);

const moon = new THREE.DirectionalLight(0xb8c4e6, 0.45);
moon.castShadow = true;
moon.shadow.mapSize.set(1024, 1024);
moon.shadow.camera.left = -55;
moon.shadow.camera.right = 55;
moon.shadow.camera.top = 55;
moon.shadow.camera.bottom = -55;
moon.shadow.camera.near = 1;
moon.shadow.camera.far = 180;
scene.add(moon);
scene.add(moon.target);

// --- World (procedural dungeon) ---------------------------------------------

const world = new VoxelWorld(scene);
const dungeon = generateDungeon(world);
world.build();

// Aim the moon (and its shadow camera) at the dungeon's center so the whole
// footprint sits inside the shadow frustum.
moon.position.set(dungeon.center.x + 30, 80, dungeon.center.z + 20);
moon.target.position.set(dungeon.center.x, 0, dungeon.center.z);
moon.target.updateMatrixWorld();

// --- Player + Game ----------------------------------------------------------

const player = new Player(camera, world, renderer.domElement);
player.spawn(dungeon.playerSpawn, dungeon.playerYaw);

const game = new Game(scene, world, player, camera);
game.setPlayerSpawn(dungeon.playerSpawn, dungeon.playerYaw);
game.setMonsterSpawns(dungeon.monsterSpawns);
game.setDoors(dungeon.doors);

const dragon = new Dragon();
dragon.spawn(dungeon.bossSpawn, dungeon.bossYaw);
game.setDragon(dragon);
game.setDragonSpawn(dungeon.bossSpawn, dungeon.bossYaw);

game.start();

// --- Start / pointer lock ---------------------------------------------------

function showPlaying(playing: boolean): void {
  startOverlay.classList.toggle("hidden", playing);
  crosshair.classList.toggle("hidden", !playing);
  hud.classList.toggle("hidden", !playing);
  game.hud.setVisible(playing);
}

startOverlay.addEventListener("click", () => {
  sound.init();
  player.requestPointerLock();
});

document.addEventListener("pointerlockchange", () => {
  showPlaying(document.pointerLockElement === renderer.domElement);
});

// --- Torches: pooled lights that follow the player -------------------------
// One PointLight per torch block doesn't scale (25-room dungeons end up with
// ~28 point lights, and Three.js material shaders loop over every visible
// light per fragment/vertex). The TorchPool keeps the visible light count
// fixed at 6 and re-positions them to the nearest torches every frame, with
// distance-faded intensity for atmosphere.
const torchPool = new TorchPool(scene, 6);

// --- Resize -----------------------------------------------------------------

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// --- Loop -------------------------------------------------------------------

const clock = new THREE.Clock();
let fpsAccum = 0;
let fpsFrames = 0;

function loop(): void {
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  game.update(dt);
  torchPool.update(player.position, world.torchPositions, elapsed);

  renderer.render(scene, camera);

  fpsAccum += dt;
  fpsFrames++;
  if (fpsAccum >= 0.5) {
    fpsEl.textContent = String(Math.round(fpsFrames / fpsAccum));
    fpsAccum = 0;
    fpsFrames = 0;
  }
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
