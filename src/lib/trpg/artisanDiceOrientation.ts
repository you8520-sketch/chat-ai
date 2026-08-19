import * as THREE from "three";
import type { ArtisanD20Face } from "./artisanDiceGeometry";

/**
 * Two-axis landing orientation for the artisan D20.
 *
 * Unlike a single-axis setFromUnitVectors(faceNormal, toward), this constrains
 * BOTH the selected face normal (toward the viewer) AND the numeral's local
 * up tangent (toward screen up). The result face fronts the viewer, the
 * numeral is upright, and it does not spin around the view axis.
 */

export type ArtisanOrientationBasis = {
  /** Direction the selected face normal should point (typically toward camera). */
  toward: THREE.Vector3;
  /** Screen/camera up direction the numeral-up should align to. */
  up: THREE.Vector3;
};

/** Build a rotation that maps faceNormal -> toward and faceUp -> projected cameraUp. */
export function artisanLandingQuaternion(face: ArtisanD20Face, basis: ArtisanOrientationBasis): THREE.Quaternion {
  const toward = basis.toward.clone().normalize();
  const camUp = basis.up.clone().normalize();

  // First rotation: face normal -> toward.
  const first = new THREE.Quaternion().setFromUnitVectors(face.normal.clone().normalize(), toward);

  // Apply to the face up tangent to see where it lands.
  const rotatedUp = face.up.clone().applyQuaternion(first).normalize();

  // Resolve the remaining twist around `toward` so rotatedUp aligns to camUp.
  // Project both onto the plane perpendicular to `toward`.
  const planeUp = camUp.clone().sub(toward.clone().multiplyScalar(camUp.dot(toward)));
  if (planeUp.lengthSq() < 1e-8) {
    return first;
  }
  planeUp.normalize();
  const rotatedPlane = rotatedUp.clone().sub(toward.clone().multiplyScalar(rotatedUp.dot(toward)));
  if (rotatedPlane.lengthSq() < 1e-8) {
    return first;
  }
  rotatedPlane.normalize();

  // Signed angle from rotatedPlane to planeUp around `toward`, then half-angle quaternion.
  const cosFull = THREE.MathUtils.clamp(rotatedPlane.dot(planeUp), -1, 1);
  const sinFull = rotatedPlane.cross(planeUp).dot(toward);
  const angle = Math.atan2(sinFull, cosFull);
  const twist = new THREE.Quaternion().setFromAxisAngle(toward, angle);
  return twist.multiply(first);
}

/** Verify a quaternion brings a face normal to within epsilon of a target direction. */
export function artisanFaceNormalMatches(q: THREE.Quaternion, faceNormal: THREE.Vector3, toward: THREE.Vector3, eps = 1e-4): boolean {
  const rotated = faceNormal.clone().applyQuaternion(q).normalize();
  return rotated.dot(toward.clone().normalize()) > 1 - eps;
}

/** Verify the numeral-up tangent lands upright (positive dot with camera up, perpendicular to view). */
export function artisanNumeralUpright(q: THREE.Quaternion, faceUp: THREE.Vector3, toward: THREE.Vector3, camUp: THREE.Vector3, eps = 0.05): boolean {
  const rotated = faceUp.clone().applyQuaternion(q);
  const plane = rotated.sub(toward.clone().multiplyScalar(rotated.dot(toward))).normalize();
  return plane.dot(camUp.clone().normalize()) > 1 - eps;
}
