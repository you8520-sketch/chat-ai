"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { TrpgD20Tone } from "@/lib/trpg/actionCardUi";

const FACE_COUNT = 20;

function numberTexture(value: number, ivory: string): THREE.CanvasTexture {
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
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = ivory;
  ctx.font = `800 ${value >= 10 ? 92 : 108}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 8;
  ctx.fillText(String(value), size / 2, size / 2 + 6);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function buildDie(tone: TrpgD20Tone): THREE.Mesh {
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

  const ivory = tone === "nat20" ? "#fff4c2" : tone === "nat1" ? "#ffd6d6" : "#f4efe6";
  const body = tone === "nat20" ? 0x2a2414 : tone === "nat1" ? 0x241014 : 0x12141a;
  const materials = Array.from({ length: FACE_COUNT }, (_, index) => {
    return new THREE.MeshStandardMaterial({
      color: body,
      metalness: 0.88,
      roughness: tone === "nat1" ? 0.48 : 0.32,
      emissive: tone === "nat20" ? 0x3a2a08 : tone === "nat1" ? 0x2a0508 : 0x07080c,
      emissiveIntensity: tone === "nat20" ? 0.35 : tone === "nat1" ? 0.22 : 0.08,
      map: numberTexture(index + 1, ivory),
    });
  });
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 1),
    new THREE.LineBasicMaterial({
      color: tone === "nat20" ? 0xe8d48a : tone === "nat1" ? 0xc07070 : 0xc5cdd8,
      transparent: true,
      opacity: 0.72,
    })
  );
  mesh.add(edges);
  return mesh;
}

function faceNormal(mesh: THREE.Mesh, faceIndex: number): THREE.Vector3 {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const pos = geometry.getAttribute("position");
  const a = new THREE.Vector3().fromBufferAttribute(pos, faceIndex * 3);
  const b = new THREE.Vector3().fromBufferAttribute(pos, faceIndex * 3 + 1);
  const c = new THREE.Vector3().fromBufferAttribute(pos, faceIndex * 3 + 2);
  return new THREE.Triangle(a, b, c).getNormal(new THREE.Vector3());
}

function landingQuaternion(mesh: THREE.Mesh, value: number, toward: THREE.Vector3): THREE.Quaternion {
  const face = Math.max(1, Math.min(20, value)) - 1;
  const normal = faceNormal(mesh, face).normalize();
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
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 40);
    camera.position.set(0, 1.55, 3.35);
    camera.lookAt(0, 0, 0);

    const key = new THREE.DirectionalLight(0xf4f1ea, reducedQuality ? 1.1 : 1.55);
    key.position.set(-2.2, 4.2, 3.4);
    key.castShadow = !reducedQuality;
    scene.add(key);
    scene.add(new THREE.AmbientLight(0x6b7288, 0.38));
    const rim = new THREE.PointLight(tone === "nat20" ? 0xf5d76e : tone === "nat1" ? 0x9b1c1c : 0x9aa4b5, 0.7, 12);
    rim.position.set(1.6, 0.4, 2.2);
    scene.add(rim);

    const table = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 48),
      new THREE.MeshStandardMaterial({
        color: 0x0b0d12,
        metalness: 0.15,
        roughness: 0.82,
      })
    );
    table.rotation.x = -Math.PI / 2;
    table.position.y = -1.15;
    table.receiveShadow = true;
    scene.add(table);

    const die = buildDie(tone);
    scene.add(die);

    const toward = camera.position.clone().normalize();
    const end = landingQuaternion(die, value, toward);
    const start = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
    );
    die.quaternion.copy(start);
    die.position.set(0, 0.85, 0);

    const started = performance.now();
    const duration = Math.max(720, durationMs);
    let frame = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      const bounce = Math.sin(t * Math.PI) * (1 - t) * 0.9;
      die.position.y = -0.05 + Math.abs(bounce) * 1.15 + (1 - t) * 0.35;
      die.position.x = Math.sin(t * 9.2) * (1 - t) * 0.42;
      die.position.z = Math.cos(t * 7.4) * (1 - t) * 0.28;
      const spin = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(t * 14.2, t * 11.6, t * 8.4)
      );
      const tumbled = start.clone().multiply(spin);
      die.quaternion.slerpQuaternions(tumbled, end, t * t * (3 - 2 * t));
      if (tone === "nat20") rim.intensity = 0.55 + Math.sin(now / 70) * 0.45;
      if (tone === "nat1") rim.intensity = 0.35 + Math.sin(now / 90) * 0.35;
      renderer.render(scene, camera);
      if (t < 1) {
        frame = requestAnimationFrame(tick);
        return;
      }
      die.quaternion.copy(end);
      die.position.set(0, -0.05, 0);
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
      const mats = Array.isArray(die.material) ? die.material : [die.material];
      for (const material of mats) {
        const mapped = (material as THREE.MeshStandardMaterial).map;
        mapped?.dispose();
        material.dispose();
      }
      renderer.domElement.remove();
    };
  }, [durationMs, onSettled, reducedQuality, tone, value]);

  return <div ref={hostRef} className="h-full w-full" data-trpg-dice-canvas="3d" />;
}
