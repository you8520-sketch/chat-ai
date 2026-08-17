"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { TrpgD20Tone } from "@/lib/trpg/actionCardUi";
import { TRPG_D20_NUMERAL, TRPG_D20_NUMERAL_EDGE } from "@/lib/trpg/diceVisual";

const FACE_COUNT = 20;
const NUMERAL_FONT = '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';

function faceTexture(value: number, tone: TrpgD20Tone): THREE.CanvasTexture {
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
  const inner = warm ? "#3a3424" : cold ? "#2c181c" : "#2a2e38";
  const mid = warm ? "#1c1810" : cold ? "#160c10" : "#14161c";
  const outer = warm ? "#0c0a08" : cold ? "#0a0608" : "#0a0b10";
  const gradient = ctx.createRadialGradient(108, 88, 8, 128, 128, 170);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.48, mid);
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const noise = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < noise.data.length; i += 4) {
    const n = ((i * 17 + value * 53) % 23) - 11;
    noise.data[i] = Math.max(0, Math.min(255, noise.data[i] + n));
    noise.data[i + 1] = Math.max(0, Math.min(255, noise.data[i + 1] + n));
    noise.data[i + 2] = Math.max(0, Math.min(255, noise.data[i + 2] + n));
  }
  ctx.putImageData(noise, 0, 0);

  const numeral = warm ? "#ffe7a3" : cold ? "#ffd4d6" : TRPG_D20_NUMERAL;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${value >= 10 ? 86 : 104}px ${NUMERAL_FONT}`;
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.strokeStyle = cold ? "#4a1820" : TRPG_D20_NUMERAL_EDGE;
  ctx.lineWidth = 5;
  ctx.strokeText(String(value), size / 2, size / 2 + 8);
  ctx.fillStyle = numeral;
  ctx.fillText(String(value), size / 2, size / 2 + 8);

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

function buildDie(tone: TrpgD20Tone): { mesh: THREE.Mesh; faceValues: number[] } {
  const geometry = new THREE.IcosahedronGeometry(1, 0).toNonIndexed();
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
    return new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: tone === "nat1" ? 0.28 : 0.4,
      roughness: tone === "nat1" ? 0.38 : 0.22,
      clearcoat: 0.72,
      clearcoatRoughness: 0.16,
      envMapIntensity: 0.7,
      map: faceTexture(faceValue, tone),
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

export default function TrpgDiceScene({
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

    const width = host.clientWidth || 320;
    const height = host.clientHeight || 240;
    const renderer = new THREE.WebGLRenderer({
      antialias: !reducedQuality,
      alpha: true,
      powerPreference: reducedQuality ? "low-power" : "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, reducedQuality ? 1.25 : 1.75));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = !reducedQuality;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 40);
    camera.position.set(0, 1.12, 2.48);
    camera.lookAt(0, 0.08, 0);

    const key = new THREE.DirectionalLight(0xf3efe6, reducedQuality ? 1.15 : 1.7);
    key.position.set(-2.4, 3.4, 2.6);
    key.castShadow = !reducedQuality;
    if (!reducedQuality) {
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.near = 0.4;
      key.shadow.camera.far = 12;
    }
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x8b93a7, 0.36);
    fill.position.set(2.6, 1.1, 1.5);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(
      tone === "nat20" ? 0xe8c56a : tone === "nat1" ? 0x8a2430 : 0xc5cdd8,
      tone === "nat20" || tone === "nat1" ? 0.62 : 0.42
    );
    rim.position.set(0.4, 1.6, -2.5);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0x3a3f4c, 0.2));

    const contact = new THREE.Mesh(
      new THREE.CircleGeometry(1.2, 48),
      new THREE.ShadowMaterial({ opacity: reducedQuality ? 0.26 : 0.4 })
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = -1.02;
    contact.receiveShadow = true;
    scene.add(contact);

    const { mesh: die, faceValues } = buildDie(tone);
    scene.add(die);

    const toward = new THREE.Vector3(0, 1, 0);
    const end = landingQuaternion(die, faceValues, value, toward);
    const start = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
    );
    die.quaternion.copy(start);
    die.position.set(1.15, 1.35, -0.35);

    const started = performance.now();
    const duration = Math.max(720, durationMs);
    let frame = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      const ease = t * t * (3 - 2 * t);
      const bounce = Math.abs(Math.sin(t * Math.PI * 2.2)) * (1 - t) * (1 - t) * 1.28;
      die.position.y = -0.02 + bounce + (1 - ease) * 0.85;
      die.position.x = THREE.MathUtils.lerp(1.15, 0, ease) + Math.sin(t * 7.4) * (1 - t) * 0.18;
      die.position.z = THREE.MathUtils.lerp(-0.35, 0, ease);
      const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler(t * 16.4, t * 12.8, t * 9.1));
      const tumbled = start.clone().multiply(spin);
      die.quaternion.slerpQuaternions(tumbled, end, ease);
      if (tone === "nat20") rim.intensity = 0.48 + Math.sin(now / 70) * 0.28;
      if (tone === "nat1") rim.intensity = 0.32 + Math.sin(now / 90) * 0.22;
      renderer.render(scene, camera);
      if (t < 1) {
        frame = requestAnimationFrame(tick);
        return;
      }
      die.quaternion.copy(end);
      die.position.set(0, -0.02, 0);
      renderer.render(scene, camera);
      if (!settledRef.current) {
        settledRef.current = true;
        onSettled();
      }
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      renderer.dispose();
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
  }, [durationMs, onSettled, reducedQuality, tone, value]);

  return <div ref={hostRef} className="h-full w-full" data-trpg-dice-canvas="3d" data-trpg-dice-proto="custom" />;
}
