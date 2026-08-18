"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import type { Font } from "three/examples/jsm/loaders/FontLoader.js";
import type { TrpgD20Tone } from "@/lib/trpg/actionCardUi";
import { preloadArtisanDiceFont } from "@/lib/trpg/artisanDiceFont";
import { buildArtisanD20ConvexShape } from "@/lib/trpg/artisanDicePhysics";
import {
  TRPG_D20_CAMERA_FOV,
  TRPG_D20_CAMERA_LOOK_AT,
  TRPG_D20_CAMERA_POS,
  TRPG_D20_GEOMETRY_RADIUS,
  TRPG_D20_STAGE_DESKTOP,
  trpgD20ThemeSpec,
} from "@/lib/trpg/diceVisual";
import {
  buildArtisanD20Geometry,
  type ArtisanD20Build,
  type ArtisanD20Face,
} from "@/lib/trpg/artisanDiceGeometry";
import { artisanLandingQuaternion } from "@/lib/trpg/artisanDiceOrientation";

const TUMBLE_PHASE = 0.7; // fraction of duration spent in real physics tumble
const HERO_HOLD_MS = 720; // single owner: scene holds hero face before overlay dismiss
const CAMERA_SETTLE_MS = 200; // last ~200ms subtle hero camera move
const FLOOR_Y = -TRPG_D20_GEOMETRY_RADIUS - 0.02;

function applySize(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, width: number, height: number) {
  renderer.setSize(width, height);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
}

function buildNumeral(
  font: Font,
  value: number,
  face: ArtisanD20Face,
  radius: number
): { mesh: THREE.Mesh; dispose: () => void } {
  const size = radius * 0.42 * (value >= 10 ? 0.82 : 1);
  const geo = new TextGeometry(String(value), {
    font,
    size,
    depth: radius * 0.05,
    curveSegments: 4,
    bevelEnabled: true,
    bevelThickness: radius * 0.012,
    bevelSize: radius * 0.012,
    bevelSegments: 2,
  });
  geo.computeVertexNormals();
  const q = new THREE.Quaternion().setFromUnitVectors(face.normal.clone().normalize(), new THREE.Vector3(0, 0, 1));
  const upQ = (() => {
    const rotatedUp = face.up.clone().applyQuaternion(q).normalize();
    const targetUp = new THREE.Vector3(0, 1, 0);
    const cam = new THREE.Vector3(0, 0, 1);
    const plane = rotatedUp.clone().sub(cam.multiplyScalar(rotatedUp.z));
    if (plane.lengthSq() < 1e-6) return new THREE.Quaternion();
    plane.normalize();
    const cosFull = THREE.MathUtils.clamp(plane.dot(targetUp), -1, 1);
    const sinFull = plane.cross(targetUp).dot(cam);
    return new THREE.Quaternion().setFromAxisAngle(cam, Math.atan2(sinFull, cosFull));
  })();
  const full = upQ.multiply(q);
  geo.applyQuaternion(full);
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const center = new THREE.Vector3();
  box.getCenter(center);
  geo.translate(-center.x, -center.y, -center.z);
  const lift = face.center.clone().add(face.normal.clone().multiplyScalar(radius * 0.005));
  geo.translate(lift.x, lift.y, lift.z);
  return {
    mesh: new THREE.Mesh(geo),
    dispose: () => geo.dispose(),
  };
}

export default function TrpgArtisanDiceScene({
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
    let cancelled = false;
    let frame = 0;
    let cleanup: (() => void) | null = null;

    preloadArtisanDiceFont().then((font) => {
      if (cancelled || !hostRef.current) return;

      const spec = trpgD20ThemeSpec("emerald-relic");
      const radius = TRPG_D20_GEOMETRY_RADIUS;
      const numeralGeometryReady = true;

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
      const tabletopPos = new THREE.Vector3(TRPG_D20_CAMERA_POS.x, TRPG_D20_CAMERA_POS.y, TRPG_D20_CAMERA_POS.z);
      const heroPos = new THREE.Vector3(0.04, 0.82, 3.32);
      camera.position.copy(tabletopPos);
      camera.lookAt(TRPG_D20_CAMERA_LOOK_AT.x, TRPG_D20_CAMERA_LOOK_AT.y, TRPG_D20_CAMERA_LOOK_AT.z);
      applySize(renderer, camera, width, height);

      const pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      envScene.background = new THREE.Color(0x9a8a6a);
      const envKey = new THREE.DirectionalLight(0xf0ead8, 1.1);
      envKey.position.set(-1.1, 2.1, 1.2);
      envScene.add(envKey);
      const envFill = new THREE.DirectionalLight(0x7a9a82, 0.5);
      envFill.position.set(1.5, 0.5, -1.1);
      envScene.add(envFill);
      const envTarget = pmrem.fromScene(envScene, 0.08);
      scene.environment = envTarget.texture;

      const key = new THREE.DirectionalLight(0xece6d4, reducedQuality ? spec.lighting.key * 0.9 : spec.lighting.key * 1.1);
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
      contact.position.y = FLOOR_Y;
      contact.receiveShadow = true;
      scene.add(contact);

      const build: ArtisanD20Build = buildArtisanD20Geometry(radius);
      const emeraldMat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(spec.palette.body),
        metalness: spec.material.metalness,
        roughness: spec.material.roughness,
        clearcoat: spec.material.clearcoat,
        clearcoatRoughness: spec.material.clearcoatRoughness,
        transmission: spec.material.transmission,
        ior: spec.material.ior,
        thickness: spec.material.thickness,
        envMapIntensity: spec.material.envMapIntensity * 1.25,
        transparent: spec.material.transmission > 0,
      });
      const goldMat = new THREE.MeshPhysicalMaterial({
        color: 0xb89a58,
        metalness: 0.92,
        roughness: 0.34,
        clearcoat: 0.16,
        clearcoatRoughness: 0.36,
        envMapIntensity: 1.1,
      });
      const numeralMat = new THREE.MeshPhysicalMaterial({
        color: 0xe1cf9a,
        metalness: 0.9,
        roughness: 0.28,
        clearcoat: 0.14,
        clearcoatRoughness: 0.38,
        envMapIntensity: 1.15,
      });
      const die = new THREE.Mesh(build.geometry, [emeraldMat, goldMat]);
      die.castShadow = true;
      die.receiveShadow = true;
      scene.add(die);

      const disposables: { dispose: () => void }[] = [
        build.geometry,
        emeraldMat,
        goldMat,
        numeralMat,
        contact.geometry,
        contact.material as THREE.Material,
      ];

      if (font) {
        for (const face of build.faces) {
          const { mesh, dispose } = buildNumeral(font, face.value, face, radius);
          mesh.material = numeralMat;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          die.add(mesh);
          disposables.push({ dispose });
        }
      }

      const targetFace = build.faces.find((f) => f.value === value) ?? build.faces[0];
      const toward = camera.position.clone().normalize().lerp(new THREE.Vector3(0, 1, 0), 0.18).normalize();
      const camUp = new THREE.Vector3(0, 1, 0);
      const endQuat = artisanLandingQuaternion(targetFace, { toward, up: camUp });

      const world = new CANNON.World();
      world.gravity.set(0, -9.82, 0);
      const floorBody = new CANNON.Body({ mass: 0 });
      floorBody.addShape(new CANNON.Plane());
      floorBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
      world.addBody(floorBody);

      const dieBody = new CANNON.Body({ mass: 1, type: CANNON.Body.DYNAMIC });
      dieBody.addShape(buildArtisanD20ConvexShape(radius));
      dieBody.position.set(0.26, radius + 0.36, 0.14);
      dieBody.angularVelocity.set(
        (Math.random() - 0.5) * 16,
        (Math.random() - 0.5) * 16,
        (Math.random() - 0.5) * 16
      );
      dieBody.velocity.set(-0.6, 0, -0.3);
      dieBody.material = new CANNON.Material({ friction: 0.42, restitution: 0.28 });
      floorBody.material = new CANNON.Material({ friction: 0.52, restitution: 0.26 });
      const contactMat = new CANNON.ContactMaterial(dieBody.material, floorBody.material, {
        friction: 0.48,
        restitution: 0.3,
      });
      world.addContactMaterial(contactMat);
      world.addBody(dieBody);

      const started = performance.now();
      const duration = Math.max(1200, Math.min(1700, durationMs));
      const fixedStep = 1 / 60;
      let lastQuat = new THREE.Quaternion();
      let heroStartedAt = 0;

      const tick = (now: number) => {
        const t = Math.min(1, (now - started) / duration);
        const tumbleEnd = TUMBLE_PHASE;
        if (t < tumbleEnd) {
          world.step(fixedStep);
          die.position.set(dieBody.position.x, dieBody.position.y - radius, dieBody.position.z);
          lastQuat.copy(die.quaternion).set(
            dieBody.quaternion.x, dieBody.quaternion.y, dieBody.quaternion.z, dieBody.quaternion.w
          );
          die.quaternion.copy(lastQuat);
        } else {
          const converge = THREE.MathUtils.smoothstep(t, tumbleEnd, 1);
          die.quaternion.slerpQuaternions(lastQuat, endQuat, converge);
          const restY = FLOOR_Y + radius;
          die.position.y = THREE.MathUtils.lerp(die.position.y, restY, converge);
          die.position.x = THREE.MathUtils.lerp(die.position.x, 0, converge);
          die.position.z = THREE.MathUtils.lerp(die.position.z, 0, converge);
          if (heroStartedAt === 0) heroStartedAt = now;
        }

        const remaining = duration - (now - started);
        if (remaining > 0 && remaining < CAMERA_SETTLE_MS) {
          const k = 1 - remaining / CAMERA_SETTLE_MS;
          camera.position.lerpVectors(tabletopPos, heroPos, THREE.MathUtils.clamp(k, 0, 1));
          camera.lookAt(0, 0, 0);
        }

        if (tone === "nat20") rim.intensity = spec.lighting.rim + 0.08 + Math.sin(now / 70) * 0.12;
        if (tone === "nat1") rim.intensity = spec.lighting.rim + Math.sin(now / 90) * 0.1;
        renderer.render(scene, camera);

        if (t < 1) {
          frame = requestAnimationFrame(tick);
          return;
        }
        die.quaternion.copy(endQuat);
        die.position.set(0, FLOOR_Y + radius, 0);
        camera.position.copy(heroPos);
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
        if (!settledRef.current) {
          settledRef.current = true;
          window.setTimeout(onSettled, HERO_HOLD_MS);
        }
      };

      if (numeralGeometryReady) {
        frame = requestAnimationFrame(tick);
      }

      const onResize = () => {
        const nextW = host.clientWidth || TRPG_D20_STAGE_DESKTOP.width;
        const nextH = host.clientHeight || TRPG_D20_STAGE_DESKTOP.height;
        applySize(renderer, camera, nextW, nextH);
      };
      const observer = new ResizeObserver(onResize);
      observer.observe(host);

      cleanup = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        renderer.dispose();
        pmrem.dispose();
        envTarget.dispose();
        for (const item of disposables) item.dispose();
        renderer.domElement.remove();
      };
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [durationMs, onSettled, reducedQuality, tone, value]);

  return (
    <div
      ref={hostRef}
      className="h-full w-full"
      data-trpg-dice-canvas="3d"
      data-trpg-dice-proto="artisan"
      data-trpg-dice-geometry="emerald-relic"
      data-trpg-dice-physics-collider="convex_d20"
    />
  );
}
