import * as THREE from "three";

/**
 * A tall green pillar of light marking the dungeon exit during the escape.
 * The column rises well above the walls so it's visible across open sightlines
 * (within fog); a point light at the base lights the immediate area.
 */
export class ExitBeacon {
  readonly group = new THREE.Group();
  readonly light: THREE.PointLight;
  private columnMat: THREE.MeshBasicMaterial;
  private t = 0;

  constructor(at: THREE.Vector3) {
    const COLUMN_HEIGHT = 44;
    this.columnMat = new THREE.MeshBasicMaterial({
      color: 0x60ff90,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.9, COLUMN_HEIGHT, 14, 1, true),
      this.columnMat,
    );
    column.position.set(at.x, COLUMN_HEIGHT / 2, at.z);

    // A brighter inner core column for definition.
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xb8ffd0,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, COLUMN_HEIGHT, 8, 1, true),
      coreMat,
    );
    core.position.set(at.x, COLUMN_HEIGHT / 2, at.z);

    this.light = new THREE.PointLight(0x60ff90, 4, 22, 2);
    this.light.position.set(at.x, 3, at.z);

    this.group.add(column, core, this.light);
  }

  update(dt: number): void {
    this.t += dt;
    const pulse = 0.22 + 0.12 * (0.5 + 0.5 * Math.sin(this.t * 4));
    this.columnMat.opacity = pulse;
    this.light.intensity = 3.5 + 1.5 * Math.sin(this.t * 4);
  }
}
