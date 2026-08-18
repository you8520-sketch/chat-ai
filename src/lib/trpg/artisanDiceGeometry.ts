import * as THREE from "three";

/**
 * Artisan D20 geometry builder.
 *
 * Single welded mesh: emerald recessed faces + thin aged-gold chamfered
 * bevels along the icosahedron edges. No cage, no rivets, no sphere caps,
 * no separate edge bars. Reads as a small beveled stone relic.
 */

export const ARTISAN_D20_FACE_COUNT = 20;
export const ARTISAN_D20_INSET_SCALE = 0.84;
export const ARTISAN_D20_RECESS_DEPTH_RATIO = 0.06;
export const ARTISAN_D20_BEVEL_GOLD = 0xb89a58;

export type ArtisanD20Face = {
  index: number;
  value: number;
  normal: THREE.Vector3;
  center: THREE.Vector3;
  up: THREE.Vector3;
  right: THREE.Vector3;
  corners: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
};

export type ArtisanD20Build = {
  geometry: THREE.BufferGeometry;
  faces: ArtisanD20Face[];
};

function faceCorners(geometry: THREE.BufferGeometry, faceIndex: number): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  const pos = geometry.getAttribute("position");
  return [
    new THREE.Vector3().fromBufferAttribute(pos, faceIndex * 3),
    new THREE.Vector3().fromBufferAttribute(pos, faceIndex * 3 + 1),
    new THREE.Vector3().fromBufferAttribute(pos, faceIndex * 3 + 2),
  ];
}

function faceNormalOf(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): THREE.Vector3 {
  return new THREE.Triangle(a, b, c).getNormal(new THREE.Vector3()).normalize();
}

/** Pair opposite faces so values sum to 21 (1..20). */
export function assignOppositeSumValues(normals: THREE.Vector3[]): number[] {
  const used = new Set<number>();
  const values = new Array<number>(normals.length).fill(0);
  let nextLow = 1;
  for (let i = 0; i < normals.length; i += 1) {
    if (used.has(i)) continue;
    let best = -1;
    let bestDot = 2;
    for (let j = 0; j < normals.length; j += 1) {
      if (i === j || used.has(j)) continue;
      const dot = normals[i].dot(normals[j]);
      if (dot < bestDot) {
        bestDot = dot;
        best = j;
      }
    }
    values[i] = nextLow;
    if (best >= 0) {
      values[best] = 21 - nextLow;
      used.add(best);
    }
    used.add(i);
    nextLow += 1;
  }
  return values;
}

function pushTri(positions: number[], normals: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, n: THREE.Vector3): void {
  positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i < 3; i += 1) normals.push(n.x, n.y, n.z);
}

function pushQuad(positions: number[], normals: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, n: THREE.Vector3): void {
  positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  for (let i = 0; i < 6; i += 1) normals.push(n.x, n.y, n.z);
}

/** In-face altitude direction from apex C toward edge AB midpoint, projected to the face plane. */
export function faceUpTangent(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, normal: THREE.Vector3): THREE.Vector3 {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const up = mid.clone().sub(c);
  const inPlane = up.clone().sub(normal.clone().multiplyScalar(up.dot(normal)));
  const len = inPlane.length();
  return len > 1e-6 ? inPlane.normalize() : new THREE.Vector3(0, 1, 0);
}

export function buildArtisanD20Geometry(radius: number, insetScale = ARTISAN_D20_INSET_SCALE, recessRatio = ARTISAN_D20_RECESS_DEPTH_RATIO): ArtisanD20Build {
  const source = new THREE.IcosahedronGeometry(radius, 0).toNonIndexed();
  const normalsList: THREE.Vector3[] = [];
  for (let face = 0; face < ARTISAN_D20_FACE_COUNT; face += 1) {
    const [a, b, c] = faceCorners(source, face);
    normalsList.push(faceNormalOf(a, b, c).normalize());
  }
  const values = assignOppositeSumValues(normalsList);
  const recess = radius * recessRatio;

  const positions: number[] = [];
  const normals: number[] = [];
  const faces: ArtisanD20Face[] = [];

  for (let face = 0; face < ARTISAN_D20_FACE_COUNT; face += 1) {
    const [a, b, c] = faceCorners(source, face);
    const normal = normalsList[face];
    const centroid = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    const insetCorner = (v: THREE.Vector3) =>
      centroid.clone().add(v.clone().sub(centroid).multiplyScalar(insetScale)).add(normal.clone().multiplyScalar(-recess));
    const ai = insetCorner(a);
    const bi = insetCorner(b);
    const ci = insetCorner(c);

    // Recessed emerald face (the numeral pocket).
    pushTri(positions, normals, ai, bi, ci, normal.clone().multiplyScalar(-1));

    // Three chamfered bevel quads from each original edge down to the recessed inset edge.
    const bevelNormal = (e0: THREE.Vector3, e1: THREE.Vector3, i0: THREE.Vector3, i1: THREE.Vector3) => {
      const edge = e1.clone().sub(e0).normalize();
      const wallNormal = normal.clone().cross(edge).normalize();
      pushQuad(positions, normals, e0, e1, i1, i0, wallNormal);
    };
    bevelNormal(a, b, ai, bi);
    bevelNormal(b, c, bi, ci);
    bevelNormal(c, a, ci, ai);

    const up = faceUpTangent(a, b, c, normal);
    const right = new THREE.Vector3().crossVectors(normal, up).normalize();
    faces.push({
      index: face,
      value: values[face],
      normal: normal.clone(),
      center: centroid.clone().add(normal.clone().multiplyScalar(-recess)),
      up,
      right,
      corners: [a.clone(), b.clone(), c.clone()],
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
  source.dispose();
  return { geometry, faces };
}
