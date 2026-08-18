/** Regular icosahedron used for the static action-card D20 token. No raster assets. */

const PHI = (1 + Math.sqrt(5)) / 2;

const VERTICES: ReadonlyArray<readonly [number, number, number]> = [
  [-1, PHI, 0],
  [1, PHI, 0],
  [-1, -PHI, 0],
  [1, -PHI, 0],
  [0, -1, PHI],
  [0, 1, PHI],
  [0, -1, -PHI],
  [0, 1, -PHI],
  [PHI, 0, -1],
  [PHI, 0, 1],
  [-PHI, 0, -1],
  [-PHI, 0, 1],
];

const FACES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
];

export type IcosahedronSvgFace = {
  points: string;
  fill: string;
  stroke: string;
  z: number;
  facing: number;
  cx: number;
  cy: number;
};

function sub(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: readonly [number, number, number], b: readonly [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: readonly [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function rotateX(v: readonly [number, number, number], angle: number): [number, number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

function rotateY(v: readonly [number, number, number], angle: number): [number, number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

function shade(facing: number, body: string, highlight: string, shadow: string): string {
  if (facing > 0.62) return highlight;
  if (facing < 0.12) return shadow;
  return body;
}

export function projectIcosahedronSvgFaces(opts: {
  size?: number;
  body: string;
  highlight: string;
  shadow: string;
  edge: string;
}): IcosahedronSvgFace[] {
  const size = opts.size ?? 80;
  const cx = size / 2;
  const cy = size / 2 + 1;
  const scale = size * 0.3;
  const light = normalize([0.42, 0.78, 0.46]);
  const rotated = VERTICES.map((vertex) => rotateY(rotateX(vertex, 0.72), -0.38));
  const faces = FACES.map((indices) => {
    const a = rotated[indices[0]];
    const b = rotated[indices[1]];
    const c = rotated[indices[2]];
    const normal = normalize(cross(sub(b, a), sub(c, a)));
    const facing = Math.max(0, normal[0] * light[0] + normal[1] * light[1] + normal[2] * light[2]);
    const points = [a, b, c]
      .map((vertex) => `${(cx + vertex[0] * scale).toFixed(2)},${(cy - vertex[1] * scale).toFixed(2)}`)
      .join(" ");
    const centroidZ = (a[2] + b[2] + c[2]) / 3;
    return {
      points,
      fill: shade(facing, opts.body, opts.highlight, opts.shadow),
      stroke: opts.edge,
      z: centroidZ,
      facing,
      cx: cx + ((a[0] + b[0] + c[0]) / 3) * scale,
      cy: cy - ((a[1] + b[1] + c[1]) / 3) * scale,
    };
  });
  return faces.sort((left, right) => left.z - right.z);
}

export function icosahedronFrontFace(faces: readonly IcosahedronSvgFace[]): IcosahedronSvgFace {
  return faces.reduce((best, face) => (face.z > best.z ? face : best), faces[0]);
}
