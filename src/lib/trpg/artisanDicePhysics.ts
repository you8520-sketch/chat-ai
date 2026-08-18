import * as THREE from "three";
import * as CANNON from "cannon-es";

export const ARTISAN_D20_PHYSICS_VERTEX_COUNT = 12;
export const ARTISAN_D20_PHYSICS_FACE_COUNT = 20;

function vertexKey(x: number, y: number, z: number): string {
  return `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
}

/**
 * Low-cost icosahedron collision hull for presentation-only Cannon physics.
 * Separate from the beveled render mesh — no inset/bevel geometry.
 */
export function buildArtisanD20ConvexShape(radius: number): CANNON.ConvexPolyhedron {
  const source = new THREE.IcosahedronGeometry(radius, 0);
  const pos = source.getAttribute("position");
  const index = source.getIndex();
  const vertexMap = new Map<string, number>();
  const vertices: CANNON.Vec3[] = [];
  const faces: number[][] = [];

  const getOrAdd = (x: number, y: number, z: number): number => {
    const key = vertexKey(x, y, z);
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;
    const next = vertices.length;
    vertices.push(new CANNON.Vec3(x, y, z));
    vertexMap.set(key, next);
    return next;
  };

  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const ai = index.getX(i);
      const bi = index.getX(i + 1);
      const ci = index.getX(i + 2);
      faces.push([
        getOrAdd(pos.getX(ai), pos.getY(ai), pos.getZ(ai)),
        getOrAdd(pos.getX(bi), pos.getY(bi), pos.getZ(bi)),
        getOrAdd(pos.getX(ci), pos.getY(ci), pos.getZ(ci)),
      ]);
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      faces.push([
        getOrAdd(pos.getX(i), pos.getY(i), pos.getZ(i)),
        getOrAdd(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)),
        getOrAdd(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2)),
      ]);
    }
  }

  source.dispose();

  if (vertices.length !== ARTISAN_D20_PHYSICS_VERTEX_COUNT) {
    throw new Error(`Artisan D20 physics hull expected ${ARTISAN_D20_PHYSICS_VERTEX_COUNT} vertices, got ${vertices.length}`);
  }
  if (faces.length !== ARTISAN_D20_PHYSICS_FACE_COUNT) {
    throw new Error(`Artisan D20 physics hull expected ${ARTISAN_D20_PHYSICS_FACE_COUNT} faces, got ${faces.length}`);
  }

  return new CANNON.ConvexPolyhedron({ vertices, faces });
}
