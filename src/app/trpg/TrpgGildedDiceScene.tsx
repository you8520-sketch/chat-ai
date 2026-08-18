"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { TrpgD20Tone } from "@/lib/trpg/actionCardUi";
import { dicePoseAt, randomStartEuler, randomUnitAxis } from "@/lib/trpg/diceAnim";
import {
  TRPG_D20_CAMERA_FOV,
  TRPG_D20_CAMERA_LOOK_AT,
  TRPG_D20_CAMERA_POS,
  TRPG_D20_FRAME_WIDTH_RATIO,
  TRPG_D20_GEM_INSET_DEPTH,
  TRPG_D20_GEM_SCALE,
  TRPG_D20_GEOMETRY_RADIUS,
  TRPG_D20_GOLD_BASE,
  TRPG_D20_GOLD_HIGHLIGHT,
  TRPG_D20_GOLD_SHADOW,
  TRPG_D20_NAT1_CRIMSON,
  TRPG_D20_NAT20_GOLD,
  TRPG_D20_NUMERAL_INLAY_HEIGHT_RATIO,
  TRPG_D20_NUMERAL_INLAY_LIFT,
  TRPG_D20_OXIDATION,
  TRPG_D20_STAGE_DESKTOP,
  TRPG_D20_VERTEX_CAP_RADIUS_RATIO,
  trpgD20ThemeSpec,
} from "@/lib/trpg/diceVisual";

const FACE_COUNT = 20;
const NUMERAL_FONT = '"Cormorant Garamond", "EB Garamond", "Iowan Old Style", Georgia, serif';

type FaceCorner = [number, number, number];

function faceCorners(geometry: THREE.BufferGeometry, faceIndex: number): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  const pos = geometry.getAttribute("position");
  return [
    new THREE.Vector3().fromBufferAttribute(pos, faceIndex * 3),
    new THREE.Vector3().fromBufferAttribute(pos, faceIndex * 3 + 1),
    new THREE.Vector3().fromBufferAttribute(pos, faceIndex * 3 + 2),
  ];
}

function faceNormal(geometry: THREE.BufferGeometry, faceIndex: number): THREE.Vector3 {
  const [a, b, c] = faceCorners(geometry, faceIndex);
  return new THREE.Triangle(a, b, c).getNormal(new THREE.Vector3());
}

function assignOppositeSumValues(geometry: THREE.BufferGeometry): number[] {
  const normals = Array.from({ length: FACE_COUNT }, (_, index) => faceNormal(geometry, index).normalize());
  const used = new Set<number>();
  const values = new Array<number>(FACE_COUNT).fill(0);
  let nextLow = 1;
  for (let i = 0; i < FACE_COUNT; i += 1) {
    if (used.has(i)) continue;
    let best = -1;
    let bestDot = 2;
    for (let j = 0; j < FACE_COUNT; j += 1) {
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

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function mixHex(a: string, b: string, t: number): string {
  const left = hexToRgb(a);
  const right = hexToRgb(b);
  const u = Math.max(0, Math.min(1, t));
  const r = Math.round(left.r + (right.r - left.r) * u);
  const g = Math.round(left.g + (right.g - left.g) * u);
  const bl = Math.round(left.b + (right.b - left.b) * u);
  return `#${[r, g, bl].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function paintMineralCloud(ctx: CanvasRenderingContext2D, size: number, value: number): void {
  const noise = ctx.getImageData(0, 0, size, size);
  const seed = value * 31 + 7;
  for (let i = 0; i < noise.data.length; i += 4) {
    const px = i / 4;
    const x = px % size;
    const y = Math.floor(px / size);
    const wave = Math.sin((x + seed * 3) * 0.045) + Math.cos((y - seed * 5) * 0.05) + Math.sin((x + y + seed) * 0.03);
    const n = Math.round(wave * 2.2);
    noise.data[i] = Math.max(0, Math.min(255, noise.data[i] + n));
    noise.data[i + 1] = Math.max(0, Math.min(255, noise.data[i + 1] + Math.round(n * 1.3)));
    noise.data[i + 2] = Math.max(0, Math.min(255, noise.data[i + 2] + Math.round(n * 0.7)));
  }
  ctx.putImageData(noise, 0, 0);
}

function paintBotanicalTrace(ctx: CanvasRenderingContext2D, size: number, value: number): void {
  if (value % 3 !== 0) return;
  ctx.save();
  ctx.strokeStyle = "rgba(63, 106, 74, 0.14)";
  ctx.lineWidth = 1.1;
  ctx.lineCap = "round";
  const sway = (value % 5) * 0.06;
  ctx.beginPath();
  ctx.moveTo(size * (0.24 + sway), size * 0.78);
  ctx.bezierCurveTo(size * 0.36, size * 0.58, size * 0.3, size * 0.42, size * (0.52 - sway), size * 0.28);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(size * 0.4, size * 0.56);
  ctx.quadraticCurveTo(size * 0.5, size * 0.5, size * 0.56, size * 0.56);
  ctx.stroke();
  ctx.restore();
}

function gemFaceTexture(value: number, tone: TrpgD20Tone): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const fallback = new THREE.CanvasTexture(canvas);
    fallback.needsUpdate = true;
    return fallback;
  }
  const spec = trpgD20ThemeSpec("gilded-verdant-relic");
  const warm = tone === "nat20";
  const cold = tone === "nat1";
  const density = ((value * 13) % 9) / 9;
  const inner = warm
    ? mixHex(spec.palette.vein, TRPG_D20_NAT20_GOLD, 0.24)
    : cold
      ? mixHex(spec.palette.body, TRPG_D20_NAT1_CRIMSON, 0.2)
      : mixHex(spec.palette.vein, spec.palette.body, 0.28 + density * 0.3);
  const mid = warm ? mixHex(spec.palette.body, "#2f2a18", 0.3) : cold ? mixHex(spec.palette.deepest, "#241016", 0.35) : spec.palette.body;
  const outer = spec.palette.deepest;
  const gradient = ctx.createRadialGradient(size * 0.4, size * 0.3, 10, size * 0.5, size * 0.52, size * 0.68);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.5, mid);
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  paintMineralCloud(ctx, size, value);
  paintBotanicalTrace(ctx, size, value);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function numeralTexture(value: number, tone: TrpgD20Tone): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const fallback = new THREE.CanvasTexture(canvas);
    fallback.needsUpdate = true;
    return fallback;
  }
  const warm = tone === "nat20";
  const cold = tone === "nat1";
  const px = Math.round(size * TRPG_D20_NUMERAL_INLAY_HEIGHT_RATIO * (value >= 10 ? 0.9 : 1));
  const cx = size / 2;
  const cy = size / 2 + 4;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${px}px ${NUMERAL_FONT}`;
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 2;
  ctx.strokeStyle = cold ? "#3a1218" : TRPG_D20_GOLD_SHADOW;
  ctx.lineWidth = 2.4;
  ctx.strokeText(String(value), cx, cy);
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  const fill = ctx.createLinearGradient(0, cy - px / 2, 0, cy + px / 2);
  if (warm) {
    fill.addColorStop(0, "#ffe9ad");
    fill.addColorStop(0.55, "#e8c56a");
    fill.addColorStop(1, "#8a6424");
  } else if (cold) {
    fill.addColorStop(0, "#ffd4d6");
    fill.addColorStop(0.55, "#c98a8e");
    fill.addColorStop(1, "#4b1d24");
  } else {
    fill.addColorStop(0, TRPG_D20_GOLD_HIGHLIGHT);
    fill.addColorStop(0.55, TRPG_D20_GOLD_BASE);
    fill.addColorStop(1, TRPG_D20_GOLD_SHADOW);
  }
  ctx.fillStyle = fill;
  ctx.fillText(String(value), cx, cy);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function edgeFrameGeometry(a: THREE.Vector3, b: THREE.Vector3, width: number, depth: number): THREE.BufferGeometry {
  const dir = b.clone().sub(a);
  const length = dir.length();
  if (length <= 0) return new THREE.BufferGeometry();
  const geometry = new THREE.BoxGeometry(length, width, depth);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize());
  geometry.applyQuaternion(quat);
  geometry.translate(mid.x, mid.y, mid.z);
  return geometry;
}

function triangleGeometry(corners: FaceCorner[], scale: number, inset: number): THREE.BufferGeometry {
  const [a, b, c] = corners.map((corner) => new THREE.Vector3(...corner));
  const normal = new THREE.Triangle(a, b, c).getNormal(new THREE.Vector3());
  const centroid = a.clone().add(b).add(c).multiplyScalar(1 / 3);
  const shrink = (v: THREE.Vector3) => centroid.clone().add(v.clone().sub(centroid).multiplyScalar(scale)).add(normal.clone().multiplyScalar(-inset));
  const p0 = shrink(a);
  const p1 = shrink(b);
  const p2 = shrink(c);
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z]);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0.5, 0.86, 0.14, 0.16, 0.86, 0.16]), 2));
  const normals = new Float32Array([
    normal.x, normal.y, normal.z,
    normal.x, normal.y, normal.z,
    normal.x, normal.y, normal.z,
  ]);
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return geometry;
}

function numeralPlaneGeometry(corners: FaceCorner[], scale: number, lift: number): THREE.BufferGeometry {
  const [a, b, c] = corners.map((corner) => new THREE.Vector3(...corner));
  const normal = new THREE.Triangle(a, b, c).getNormal(new THREE.Vector3());
  const centroid = a.clone().add(b).add(c).multiplyScalar(1 / 3).add(normal.clone().multiplyScalar(lift));
  const tangent = b.clone().sub(a).normalize();
  const bitangent = normal.clone().cross(tangent).normalize();
  const edge = a.distanceTo(b);
  const faceHeight = (Math.sqrt(3) / 2) * edge;
  const h = faceHeight * TRPG_D20_NUMERAL_INLAY_HEIGHT_RATIO * scale;
  const w = h * 0.82;
  const positions: number[] = [];
  const uvs: number[] = [];
  const cornerAt = (sx: number, sy: number) =>
    centroid.clone().add(tangent.clone().multiplyScalar(sx * w)).add(bitangent.clone().multiplyScalar(sy * h));
  const quad = [cornerAt(-0.5, -0.5), cornerAt(0.5, -0.5), cornerAt(0.5, 0.5), cornerAt(-0.5, 0.5)];
  const order = [0, 1, 2, 0, 2, 3];
  const uvQuad: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  for (const index of order) {
    const p = quad[index];
    positions.push(p.x, p.y, p.z);
    uvs.push(uvQuad[index][0], uvQuad[index][1]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geometry.computeVertexNormals();
  return geometry;
}

function collectUniqueVertices(geometry: THREE.BufferGeometry): THREE.Vector3[] {
  const pos = geometry.getAttribute("position");
  const seen = new Map<string, THREE.Vector3>();
  for (let i = 0; i < pos.count; i += 1) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(4)}:${v.y.toFixed(4)}:${v.z.toFixed(4)}`;
    if (!seen.has(key)) seen.set(key, v);
  }
  return [...seen.values()];
}

function collectUniqueEdges(geometry: THREE.BufferGeometry): [THREE.Vector3, THREE.Vector3][] {
  const edges: [THREE.Vector3, THREE.Vector3][] = [];
  const seen = new Set<string>();
  for (let face = 0; face < FACE_COUNT; face += 1) {
    const [a, b, c] = faceCorners(geometry, face);
    const corners = [a, b, c];
    for (let i = 0; i < 3; i += 1) {
      const p = corners[i];
      const q = corners[(i + 1) % 3];
      const key = [p, q]
        .map((v) => `${v.x.toFixed(4)}:${v.y.toFixed(4)}:${v.z.toFixed(4)}`)
        .sort()
        .join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([p.clone(), q.clone()]);
    }
  }
  return edges;
}

function buildGildedDie(tone: TrpgD20Tone): { group: THREE.Group; faceValues: number[]; disposables: { dispose: () => void }[] } {
  const radius = TRPG_D20_GEOMETRY_RADIUS;
  const source = new THREE.IcosahedronGeometry(radius, 0).toNonIndexed();
  const faceValues = assignOppositeSumValues(source);
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [source];

  const frameWidth = radius * 2 * TRPG_D20_FRAME_WIDTH_RATIO;
  const frameDepth = frameWidth * 1.6;
  const frameMaterial = new THREE.MeshPhysicalMaterial({
    color: TRPG_D20_GOLD_BASE,
    metalness: 0.88,
    roughness: 0.42,
    clearcoat: 0.12,
    clearcoatRoughness: 0.4,
    envMapIntensity: 0.9,
    flatShading: false,
  });
  const capMaterial = new THREE.MeshPhysicalMaterial({
    color: TRPG_D20_GOLD_HIGHLIGHT,
    metalness: 0.92,
    roughness: 0.34,
    clearcoat: 0.16,
    clearcoatRoughness: 0.36,
    envMapIntensity: 1,
  });
  const oxidationMaterial = new THREE.MeshPhysicalMaterial({
    color: TRPG_D20_OXIDATION,
    metalness: 0.55,
    roughness: 0.6,
    envMapIntensity: 0.35,
  });
  disposables.push(frameMaterial, capMaterial, oxidationMaterial);

  for (const [a, b] of collectUniqueEdges(source)) {
    const frame = new THREE.Mesh(edgeFrameGeometry(a, b, frameWidth, frameDepth), frameMaterial);
    frame.castShadow = true;
    frame.receiveShadow = true;
    group.add(frame);
    disposables.push(frame.geometry);
  }

  const capRadius = radius * 2 * TRPG_D20_VERTEX_CAP_RADIUS_RATIO;
  const capGeometry = new THREE.SphereGeometry(capRadius, 10, 8);
  const rivetGeometry = new THREE.SphereGeometry(capRadius * 0.42, 8, 6);
  disposables.push(capGeometry, rivetGeometry);
  for (const vertex of collectUniqueVertices(source)) {
    const cap = new THREE.Mesh(capGeometry, capMaterial);
    cap.position.copy(vertex.clone().multiplyScalar(1.002));
    cap.castShadow = true;
    group.add(cap);
    const rivet = new THREE.Mesh(rivetGeometry, oxidationMaterial);
    rivet.position.copy(vertex.clone().multiplyScalar(1.006));
    group.add(rivet);
  }

  const numeralMaterials: THREE.MeshPhysicalMaterial[] = [];
  for (let face = 0; face < FACE_COUNT; face += 1) {
    const corners = faceCorners(source, face).map((v) => [v.x, v.y, v.z] as FaceCorner);
    const value = faceValues[face];
    const gemMap = gemFaceTexture(value, tone);
    const gemMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: gemMap,
      side: THREE.DoubleSide,
    });
    gemMaterial.name = `gem-${value}`;
    const gem = new THREE.Mesh(triangleGeometry(corners, TRPG_D20_GEM_SCALE, TRPG_D20_GEM_INSET_DEPTH), gemMaterial);
    gem.receiveShadow = true;
    gem.castShadow = true;
    gem.renderOrder = 1;
    gem.frustumCulled = false;
    group.add(gem);
    disposables.push(gem.geometry, gemMaterial, gemMap);

    const numeralMap = numeralTexture(value, tone);
    const numeralMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.82,
      roughness: 0.38,
      clearcoat: 0.1,
      clearcoatRoughness: 0.42,
      envMapIntensity: 1.05,
      map: numeralMap,
      transparent: true,
      alphaTest: 0.08,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    numeralMaterials.push(numeralMaterial);
    const numeral = new THREE.Mesh(
      numeralPlaneGeometry(corners, TRPG_D20_GEM_SCALE, TRPG_D20_NUMERAL_INLAY_LIFT),
      numeralMaterial
    );
    numeral.renderOrder = 2;
    group.add(numeral);
    disposables.push(numeral.geometry, numeralMaterial, numeralMap);
  }

  return { group, faceValues, disposables };
}

function landingQuaternion(
  geometry: THREE.BufferGeometry,
  faceValues: number[],
  value: number,
  toward: THREE.Vector3
): THREE.Quaternion {
  const face = Math.max(
    0,
    faceValues.findIndex((entry) => entry === value)
  );
  const normal = faceNormal(geometry, face).normalize();
  return new THREE.Quaternion().setFromUnitVectors(normal, toward.clone().normalize());
}

function applySize(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, width: number, height: number) {
  renderer.setSize(width, height);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
}

export default function TrpgGildedDiceScene({
  value,
  tone,
  durationMs,
  reducedQuality,
  onSettled,
}: {
  value: number;
  tone: TrpgD20Tone;
  durationMs: number;
  reducedQuality: boolean;
  onSettled: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    settledRef.current = false;
    const spec = trpgD20ThemeSpec("gilded-verdant-relic");

    const width = host.clientWidth || TRPG_D20_STAGE_DESKTOP.width;
    const height = host.clientHeight || TRPG_D20_STAGE_DESKTOP.height;
    const renderer = new THREE.WebGLRenderer({
      antialias: !reducedQuality,
      alpha: true,
      powerPreference: reducedQuality ? "low-power" : "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, reducedQuality ? 1.25 : 1.75));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = !reducedQuality;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(TRPG_D20_CAMERA_FOV, width / height, 0.1, 40);
    camera.position.set(TRPG_D20_CAMERA_POS.x, TRPG_D20_CAMERA_POS.y, TRPG_D20_CAMERA_POS.z);
    camera.lookAt(TRPG_D20_CAMERA_LOOK_AT.x, TRPG_D20_CAMERA_LOOK_AT.y, TRPG_D20_CAMERA_LOOK_AT.z);
    applySize(renderer, camera, width, height);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(spec.palette.body);
    const envKey = new THREE.DirectionalLight(0xf0ead8, 0.6);
    envKey.position.set(-1.1, 2.1, 1.2);
    envScene.add(envKey);
    const envFill = new THREE.DirectionalLight(0x7a9a82, 0.36);
    envFill.position.set(1.5, 0.5, -1.1);
    envScene.add(envFill);
    const envTarget = pmrem.fromScene(envScene, 0.08);
    scene.environment = envTarget.texture;

    const key = new THREE.DirectionalLight(0xece6d4, reducedQuality ? spec.lighting.key * 0.78 : spec.lighting.key);
    key.position.set(-1.6, 2.4, 1.8);
    key.castShadow = !reducedQuality;
    if (!reducedQuality) {
      key.shadow.mapSize.set(512, 512);
      key.shadow.camera.near = 0.4;
      key.shadow.camera.far = 10;
    }
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x7a9a82, spec.lighting.fill);
    fill.position.set(1.8, 0.8, 1.1);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(
      tone === "nat20" ? 0xe8c56a : tone === "nat1" ? 0x8a2430 : 0xd6c7a1,
      tone === "nat20" || tone === "nat1" ? spec.lighting.rim + 0.16 : spec.lighting.rim
    );
    rim.position.set(0.3, 1.2, -1.8);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0x2a3a2e, spec.lighting.ambient));

    const contact = new THREE.Mesh(
      new THREE.CircleGeometry(spec.shadow.radius, 32),
      new THREE.ShadowMaterial({ opacity: reducedQuality ? spec.shadow.opacity * 0.7 : spec.shadow.opacity })
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = -TRPG_D20_GEOMETRY_RADIUS - 0.04;
    contact.receiveShadow = true;
    scene.add(contact);

    const { group: die, faceValues, disposables } = buildGildedDie(tone);
    scene.add(die);

    const referenceGeometry = new THREE.IcosahedronGeometry(TRPG_D20_GEOMETRY_RADIUS, 0).toNonIndexed();
    disposables.push(referenceGeometry);
    const toward = camera.position.clone().normalize().lerp(new THREE.Vector3(0, 1, 0), 0.28).normalize();
    const end = landingQuaternion(referenceGeometry, faceValues, value, toward);
    const startEuler = randomStartEuler(Math.random);
    const start = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(startEuler.x, startEuler.y, startEuler.z)
    );
    const axis = randomUnitAxis(Math.random);
    const tumbleAxis = new THREE.Vector3(axis.x, axis.y, axis.z);
    die.quaternion.copy(start);
    const first = dicePoseAt(0);
    die.position.set(first.x, first.y, first.z);

    const started = performance.now();
    const duration = Math.max(1100, Math.min(1600, durationMs));
    let frame = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      const pose = dicePoseAt(t);
      die.position.set(pose.x, pose.y, pose.z);
      if (t >= 1) {
        die.quaternion.copy(end);
      } else {
        const spin = new THREE.Quaternion().setFromAxisAngle(tumbleAxis, pose.tumbleAngle);
        const tumbled = start.clone().multiply(spin);
        die.quaternion.slerpQuaternions(tumbled, end, pose.settle);
      }
      if (tone === "nat20") rim.intensity = spec.lighting.rim + 0.08 + Math.sin(now / 70) * 0.12;
      if (tone === "nat1") rim.intensity = spec.lighting.rim + Math.sin(now / 90) * 0.1;
      renderer.render(scene, camera);
      if (t < 1) {
        frame = requestAnimationFrame(tick);
        return;
      }
      die.quaternion.copy(end);
      die.position.set(0, pose.y, 0);
      renderer.render(scene, camera);
      if (!settledRef.current) {
        settledRef.current = true;
        onSettled();
      }
    };
    frame = requestAnimationFrame(tick);

    const onResize = () => {
      const nextW = host.clientWidth || TRPG_D20_STAGE_DESKTOP.width;
      const nextH = host.clientHeight || TRPG_D20_STAGE_DESKTOP.height;
      applySize(renderer, camera, nextW, nextH);
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(host);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.dispose();
      pmrem.dispose();
      envTarget.dispose();
      contact.geometry.dispose();
      (contact.material as THREE.Material).dispose();
      for (const item of disposables) item.dispose();
      renderer.domElement.remove();
    };
  }, [durationMs, onSettled, reducedQuality, tone, value]);

  return (
    <div
      ref={hostRef}
      className="h-full w-full"
      data-trpg-dice-canvas="3d"
      data-trpg-dice-proto="gilded"
      data-trpg-dice-geometry="gilded-verdant-relic"
    />
  );
}
