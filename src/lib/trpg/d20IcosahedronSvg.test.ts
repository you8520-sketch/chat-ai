import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { icosahedronFrontFace, projectIcosahedronSvgFaces } from "./d20IcosahedronSvg";

describe("static D20 icosahedron token", () => {
  it("projects twenty triangular faces instead of a hex badge", () => {
    const faces = projectIcosahedronSvgFaces({
      body: "#1a1d24",
      highlight: "#2c313c",
      shadow: "#0b0c10",
      edge: "#6d7380",
    });
    assert.equal(faces.length, 20);
    for (const face of faces) {
      assert.equal(face.points.split(" ").length, 3);
    }
    const visible = faces.filter((face) => face.z > 0);
    assert.ok(visible.length >= 8);
    const front = icosahedronFrontFace(faces);
    assert.ok(front.z >= Math.max(...faces.map((face) => face.z)) - 1e-9);
    const xs = faces.flatMap((face) => face.points.split(" ").map((pair) => Number(pair.split(",")[0])));
    const uniqueX = new Set(xs.map((value) => value.toFixed(1)));
    assert.ok(uniqueX.size > 6);
  });
});
