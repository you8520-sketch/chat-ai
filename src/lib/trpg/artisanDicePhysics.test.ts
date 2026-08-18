import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as CANNON from "cannon-es";
import {
  ARTISAN_D20_PHYSICS_FACE_COUNT,
  ARTISAN_D20_PHYSICS_VERTEX_COUNT,
  buildArtisanD20ConvexShape,
} from "./artisanDicePhysics";

describe("artisan dice physics hull", () => {
  it("builds a 12-vertex / 20-face convex icosahedron collider", () => {
    const shape = buildArtisanD20ConvexShape(1);
    assert.ok(shape instanceof CANNON.ConvexPolyhedron);
    assert.equal(shape.vertices.length, ARTISAN_D20_PHYSICS_VERTEX_COUNT);
    assert.equal(shape.faces.length, ARTISAN_D20_PHYSICS_FACE_COUNT);
    for (const face of shape.faces) {
      assert.equal(face.length, 3);
    }
  });

  it("does not use a sphere approximation", () => {
    const shape = buildArtisanD20ConvexShape(1);
    assert.notEqual(shape.type, CANNON.Shape.types.SPHERE);
  });
});
