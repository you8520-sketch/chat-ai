import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import {
  ARTISAN_D20_FACE_COUNT,
  assignOppositeSumValues,
  buildArtisanD20Geometry,
  faceUpTangent,
} from "./artisanDiceGeometry";
import {
  artisanFaceNormalMatches,
  artisanLandingQuaternion,
  artisanNumeralUpright,
} from "./artisanDiceOrientation";

describe("artisan D20 geometry", () => {
  it("builds a single welded mesh with 20 faces and opposite-sum values", () => {
    const { geometry, faces } = buildArtisanD20Geometry(0.78);
    assert.equal(faces.length, ARTISAN_D20_FACE_COUNT);
    const values = faces.map((f) => f.value).sort((a, b) => a - b);
    assert.deepEqual(values, Array.from({ length: 20 }, (_, i) => i + 1));
    // Opposite faces sum to 21.
    for (let i = 0; i < faces.length; i += 1) {
      let best = -1;
      let bestDot = 2;
      for (let j = 0; j < faces.length; j += 1) {
        if (i === j) continue;
        const dot = faces[i].normal.dot(faces[j].normal);
        if (dot < bestDot) { bestDot = dot; best = j; }
      }
      assert.equal(faces[i].value + faces[best].value, 21);
    }
    // Single welded mesh: one position attribute, no separate edge/cap primitives.
    assert.ok(geometry.getAttribute("position") instanceof THREE.BufferAttribute);
    assert.ok(geometry.getAttribute("normal") instanceof THREE.BufferAttribute);
    geometry.dispose();
  });

  it("per-face up tangent is in the face plane and unit length", () => {
    const { faces } = buildArtisanD20Geometry(0.78);
    for (const face of faces) {
      assert.ok(Math.abs(face.up.length() - 1) < 1e-5, `up not unit for face ${face.index}`);
      assert.ok(Math.abs(face.up.dot(face.normal)) < 1e-5, `up not in plane for face ${face.index}`);
      assert.ok(Math.abs(face.right.dot(face.normal)) < 1e-5, `right not in plane for face ${face.index}`);
      assert.ok(Math.abs(face.up.dot(face.right)) < 1e-5, `up/right not orthogonal for face ${face.index}`);
    }
  });

  it("assignOppositeSumValues pairs all 20 faces", () => {
    const normals = Array.from({ length: 20 }, (_, i) => new THREE.Vector3(Math.sin(i), Math.cos(i * 1.3), Math.sin(i * 0.7)).normalize());
    const values = assignOppositeSumValues(normals);
    const used = new Set(values);
    assert.equal(used.size, 20);
    assert.equal(Math.min(...values), 1);
    assert.equal(Math.max(...values), 20);
  });

  it("faceUpTangent falls back when the altitude degenerates", () => {
    const a = new THREE.Vector3(1, 0, 0);
    const b = new THREE.Vector3(-1, 0, 0);
    const c = new THREE.Vector3(0, 0, 1);
    const n = new THREE.Vector3(0, 1, 0);
    const up = faceUpTangent(a, b, c, n);
    assert.ok(up.length() > 0);
  });
});

describe("artisan two-axis landing orientation", () => {
  it("brings the selected face normal toward the viewer and the numeral upright", () => {
    const { faces } = buildArtisanD20Geometry(0.78);
    const face = faces.find((f) => f.value === 12) ?? faces[0];
    const toward = new THREE.Vector3(0, 0.2, 1).normalize();
    const camUp = new THREE.Vector3(0, 1, 0);
    const q = artisanLandingQuaternion(face, { toward, up: camUp });
    assert.ok(artisanFaceNormalMatches(q, face.normal, toward), "face normal not toward viewer");
    assert.ok(artisanNumeralUpright(q, face.up, toward, camUp), "numeral not upright");
  });

  it("keeps every face readable from the hero angle", () => {
    const { faces } = buildArtisanD20Geometry(0.78);
    const toward = new THREE.Vector3(0, 0.18, 1).normalize();
    const camUp = new THREE.Vector3(0, 1, 0);
    for (const face of faces) {
      const q = artisanLandingQuaternion(face, { toward, up: camUp });
      assert.ok(artisanFaceNormalMatches(q, face.normal, toward), `face ${face.value} normal miss`);
      assert.ok(artisanNumeralUpright(q, face.up, toward, camUp), `face ${face.value} not upright`);
    }
  });
});
