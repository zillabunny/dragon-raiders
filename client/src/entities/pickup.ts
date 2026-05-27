import * as THREE from "three";
import { makeShurikenMesh } from "../combat/projectile";

export type PickupKind = "shuriken";

export class Pickup {
  readonly kind: PickupKind;
  readonly amount: number;
  readonly position: THREE.Vector3;
  readonly mesh: THREE.Object3D;
  alive = true;
  private spinT = 0;

  constructor(kind: PickupKind, position: THREE.Vector3, amount: number) {
    this.kind = kind;
    this.amount = amount;
    this.position = position.clone();
    this.mesh = makeShurikenMesh();
    this.mesh.scale.setScalar(0.7);
    this.mesh.position.copy(this.position);
  }

  update(dt: number): void {
    this.spinT += dt;
    this.mesh.position.y = this.position.y + Math.sin(this.spinT * 3) * 0.1 + 0.2;
    this.mesh.rotation.y = this.spinT * 2.5;
  }
}
