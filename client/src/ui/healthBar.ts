import * as THREE from "three";

/**
 * A floating HP bar attached above a monster. The group is meant to be
 * billboarded by the game (quaternion copied from camera each frame).
 */
export class HealthBar {
  readonly group = new THREE.Group();
  private fg: THREE.Mesh;
  private bgWidth = 1.0;

  constructor(width = 1.0, height = 0.12, label?: string, labelColor = "#ffffff") {
    this.bgWidth = width;

    const bgMat = new THREE.MeshBasicMaterial({ color: 0x101010, transparent: true, opacity: 0.85, depthTest: false });
    const fgMat = new THREE.MeshBasicMaterial({ color: 0xe04040, transparent: true, opacity: 0.95, depthTest: false });

    const bgGeom = new THREE.PlaneGeometry(width, height);
    const bg = new THREE.Mesh(bgGeom, bgMat);
    bg.renderOrder = 999;

    // FG is anchored at its LEFT edge by translating geometry so x=0 is the left.
    const innerW = width * 0.94;
    const innerH = height * 0.65;
    const fgGeom = new THREE.PlaneGeometry(innerW, innerH);
    fgGeom.translate(innerW / 2, 0, 0.001);
    this.fg = new THREE.Mesh(fgGeom, fgMat);
    this.fg.position.x = -innerW / 2;
    this.fg.renderOrder = 1000;

    this.group.add(bg, this.fg);

    if (label) {
      const sprite = makeLabelSprite(label, labelColor);
      sprite.position.set(0, height * 1.6 + 0.05, 0);
      this.group.add(sprite);
    }
  }

  setRatio(ratio: number): void {
    const r = Math.max(0, Math.min(1, ratio));
    this.fg.scale.x = r;
    const c = this.fg.material as THREE.MeshBasicMaterial;
    c.color.setHSL(0.0 + r * 0.33, 0.7, 0.5); // red → green
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  /** Set the world position of the bar (typically above the monster). */
  setPosition(p: THREE.Vector3): void {
    this.group.position.copy(p);
  }

  /** Make the bar face the given camera. */
  billboard(camera: THREE.Camera): void {
    this.group.quaternion.copy(camera.quaternion);
  }

  get width(): number {
    return this.bgWidth;
  }
}

function makeLabelSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 52px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,0.95)";
  ctx.lineWidth = 10;
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.4, 0.35, 1);
  sprite.renderOrder = 1001;
  return sprite;
}
