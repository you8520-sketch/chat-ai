"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { TrpgD20Tone } from "@/lib/trpg/actionCardUi";
import { dicePoseAt, randomStartEuler, randomUnitAxis } from "@/lib/trpg/diceAnim";
import {
  PRODUCTION_D20_THEME,
  TRPG_D20_CAMERA_FOV,
  TRPG_D20_CAMERA_LOOK_AT,
  TRPG_D20_CAMERA_POS,
  TRPG_D20_GEOMETRY_RADIUS,
  TRPG_D20_NAT1_CRIMSON,
  TRPG_D20_NAT20_GOLD,
  TRPG_D20_STAGE_DESKTOP,
  trpgD20ThemeSpec,
  type TrpgD20ThemeId,
  type TrpgD20ThemeSpec,
} from "@/lib/trpg/diceVisual";

const FACE_COUNT = 20;
const NUMERAL_FONT = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';

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

function paintSparseGoldMotes(
  ctx: CanvasRenderingContext2D,
  size: number,
  value: number,
  spec: TrpgD20ThemeSpec
): void {
  const noise = ctx.getImageData(0, 0, size, size);
  const mote = hexToRgb(spec.palette.highlight);
  for (let i = 0; i < noise.data.length; i += 4) {
    const px = i / 4;
    if ((px * 29 + value * 17) % 41 !== 0) continue;
    noise.data[i] = Math.min(255, noise.data[i] + Math.round(mote.r * 0.14));
    noise.data[i + 1] = Math.min(255, noise.data[i + 1] + Math.round(mote.g * 0.1));
    noise.data[i + 2] = Math.min(255, noise.data[i + 2] + Math.round(mote.b * 0.04));
  }
  ctx.putImageData(noise, 0, 0);
}

function paintOxidizedVariation(
  ctx: CanvasRenderingContext2D,
  size: number,
  value: number,
  spec: TrpgD20ThemeSpec
): void {
  const noise = ctx.getImageData(0, 0, size, size);
  const vein = hexToRgb(spec.palette.vein);
  for (let i = 0; i < noise.data.length; i += 4) {
    const px = i / 4;
    if ((px * 23 + value * 11) % 53 !== 0) continue;
    const n = ((px + value * 7) % 5) - 2;
    noise.data[i] = Math.max(0, Math.min(255, noise.data[i] + Math.round(vein.r * 0.08) + n));
    noise.data[i + 1] = Math.max(0, Math.min(255, noise.data[i + 1] + Math.round(vein.g * 0.05) + n));
    noise.data[i + 2] = Math.max(0, Math.min(255, noise.data[i + 2] + n));
  }
  ctx.putImageData(noise, 0, 0);
  ctx.strokeStyle = spec.palette.vein;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.12);
  ctx.lineTo(size * 0.12, size * 0.86);
  ctx.lineTo(size * 0.88, size * 0.86);
  ctx.closePath();
  ctx.stroke();
}

function paintFaceGround(
  ctx: CanvasRenderingContext2D,
  size: number,
  value: number,
  tone: TrpgD20Tone,
  spec: TrpgD20ThemeSpec
): void {
  const warm = tone === "nat20";
  const cold = tone === "nat1";
  const faceShift = ((value * 13) % 7) / 7;
  const inner = warm
    ? mixHex(spec.palette.vein, TRPG_D20_NAT20_GOLD, 0.28)
    : cold
      ? mixHex(spec.palette.body, TRPG_D20_NAT1_CRIMSON, 0.22)
      : mixHex(spec.palette.vein, spec.palette.body, 0.35 + faceShift * 0.2);
  const mid = warm
    ? mixHex(spec.palette.body, "#3a3424", 0.35)
    : cold
      ? mixHex(spec.palette.deepest, "#2c181c", 0.4)
      : spec.palette.body;
  const outer = spec.palette.deepest;
  const gradient = ctx.createRadialGradient(size * 0.42, size * 0.34, 8, size * 0.5, size * 0.5, size * 0.66);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.52, mid);
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  switch (spec.texture) {
    case "sparse-gold-motes":
      paintSparseGoldMotes(ctx, size, value, spec);
      return;
    case "oxidized-bronze":
      paintOxidizedVariation(ctx, size, value, spec);
      return;
    default: {
      const _never: never = spec.texture;
      return _never;
    }
  }
}

function faceTexture(value: number, tone: TrpgD20Tone, spec: TrpgD20ThemeSpec): THREE.CanvasTexture {
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

  paintFaceGround(ctx, size, value, tone, spec);

  const warm = tone === "nat20";
  const cold = tone === "nat1";
  const numeral = warm ? "#ffe7a3" : cold ? "#ffd4d6" : spec.numeralColor;
  const faceHeight = size * 0.74;
  const px = Math.round(
    faceHeight * (value >= 10 ? spec.numeralFaceRatio.double : spec.numeralFaceRatio.single)
  );
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${spec.numeralWeight} ${px}px ${NUMERAL_FONT}`;
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.strokeStyle = cold ? "#4a1820" : spec.numeralStroke;
  ctx.lineWidth = 1.75;
  ctx.strokeText(String(value), size / 2, size / 2 + 6);
  ctx.fillStyle = numeral;
  ctx.fillText(String(value), size / 2, size / 2 + 6);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function faceNormal(geometry: THREE.BufferGeometry, faceIndex: number): THREE.Vector3 {
  const pos = geometry.getAttribute("position");
  const a = new THREE.Vector3().fromBufferAttribute(pos, faceIndex * 3);
  const b = new THREE.Vector3().fromBufferAttribute(pos, faceIndex * 3 + 1);
  const c = new THREE.Vector3().fromBufferAttribute(pos, faceIndex * 3 + 2);
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

function buildDie(
  tone: TrpgD20Tone,
  spec: TrpgD20ThemeSpec
): { mesh: THREE.Mesh; faceValues: number[] } {
  const geometry = new THREE.IcosahedronGeometry(TRPG_D20_GEOMETRY_RADIUS, 0).toNonIndexed();
  const uv = new Float32Array(FACE_COUNT * 3 * 2);
  for (let face = 0; face < FACE_COUNT; face += 1) {
    geometry.addGroup(face * 3, 3, face);
    const o = face * 6;
    uv[o] = 0.5;
    uv[o + 1] = 0.88;
    uv[o + 2] = 0.12;
    uv[o + 3] = 0.14;
    uv[o + 4] = 0.88;
    uv[o + 5] = 0.14;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  const faceValues = assignOppositeSumValues(geometry);
  const materials = faceValues.map((faceValue) => {
    const faceShift = ((faceValue * 13) % 7) - 3;
    const metalness =
      spec.id === "ancient-reliquary"
        ? spec.material.metalness + faceShift * 0.012
        : spec.material.metalness;
    const roughness =
      spec.id === "ancient-reliquary"
        ? spec.material.roughness + faceShift * 0.01
        : spec.material.roughness;
    return new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: tone === "nat20" ? metalness + 0.04 : tone === "nat1" ? Math.max(0.08, metalness - 0.04) : metalness,
      roughness: tone === "nat20" ? Math.max(0.18, roughness - 0.04) : tone === "nat1" ? roughness + 0.06 : roughness,
      clearcoat: spec.material.clearcoat,
      clearcoatRoughness: spec.material.clearcoatRoughness,
      transmission: spec.material.transmission,
      ior: spec.material.ior,
      thickness: spec.material.thickness,
      attenuationColor: new THREE.Color(spec.palette.body),
      attenuationDistance: spec.material.transmission > 0 ? 1.15 : 0,
      transparent: spec.material.transmission > 0,
      envMapIntensity: spec.material.envMapIntensity,
      map: faceTexture(faceValue, tone, spec),
    });
  });
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, faceValues };
}

function landingQuaternion(
  mesh: THREE.Mesh,
  faceValues: number[],
  value: number,
  toward: THREE.Vector3
): THREE.Quaternion {
  const face = Math.max(
    0,
    faceValues.findIndex((entry) => entry === value)
  );
  const normal = faceNormal(mesh.geometry as THREE.BufferGeometry, face).normalize();
  return new THREE.Quaternion().setFromUnitVectors(normal, toward.clone().normalize());
}

function applySize(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, width: number, height: number) {
  renderer.setSize(width, height);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
}

export default function TrpgDiceScene({
  value,
  tone,
  durationMs,
  reducedQuality,
  onSettled,
  theme = PRODUCTION_D20_THEME,
}: {
  value: number;
  tone: TrpgD20Tone;
  durationMs: number;
  reducedQuality: boolean;
  onSettled: () => void;
  theme?: TrpgD20ThemeId;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    settledRef.current = false;
    const spec = trpgD20ThemeSpec(theme);

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
    const envKey = new THREE.DirectionalLight(0xf0ead8, 0.55);
    envKey.position.set(-1.1, 2.1, 1.2);
    envScene.add(envKey);
    const envFill = new THREE.DirectionalLight(0x6a8a78, 0.32);
    envFill.position.set(1.5, 0.5, -1.1);
    envScene.add(envFill);
    const envTarget = pmrem.fromScene(envScene, 0.08);
    scene.environment = envTarget.texture;

    const key = new THREE.DirectionalLight(0xe8eee4, reducedQuality ? spec.lighting.key * 0.78 : spec.lighting.key);
    key.position.set(-1.6, 2.4, 1.8);
    key.castShadow = !reducedQuality;
    if (!reducedQuality) {
      key.shadow.mapSize.set(512, 512);
      key.shadow.camera.near = 0.4;
      key.shadow.camera.far = 10;
    }
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x6a8a78, spec.lighting.fill);
    fill.position.set(1.8, 0.8, 1.1);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(
      tone === "nat20" ? 0xe8c56a : tone === "nat1" ? 0x8a2430 : 0xcbb991,
      tone === "nat20" || tone === "nat1" ? spec.lighting.rim + 0.16 : spec.lighting.rim
    );
    rim.position.set(0.3, 1.2, -1.8);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0x24382c, spec.lighting.ambient));

    const contact = new THREE.Mesh(
      new THREE.CircleGeometry(spec.shadow.radius, 32),
      new THREE.ShadowMaterial({ opacity: reducedQuality ? spec.shadow.opacity * 0.7 : spec.shadow.opacity })
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = -TRPG_D20_GEOMETRY_RADIUS - 0.04;
    contact.receiveShadow = true;
    scene.add(contact);

    const { mesh: die, faceValues } = buildDie(tone, spec);
    scene.add(die);

    const toward = camera.position.clone().normalize().lerp(new THREE.Vector3(0, 1, 0), 0.28).normalize();
    const end = landingQuaternion(die, faceValues, value, toward);
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
      die.geometry.dispose();
      contact.geometry.dispose();
      (contact.material as THREE.Material).dispose();
      const mats = Array.isArray(die.material) ? die.material : [die.material];
      for (const material of mats) {
        const mapped = (material as THREE.MeshPhysicalMaterial).map;
        mapped?.dispose();
        material.dispose();
      }
      renderer.domElement.remove();
    };
  }, [durationMs, onSettled, reducedQuality, theme, tone, value]);

  return <div ref={hostRef} className="h-full w-full" data-trpg-dice-canvas="3d" data-trpg-dice-proto="custom" />;
}
