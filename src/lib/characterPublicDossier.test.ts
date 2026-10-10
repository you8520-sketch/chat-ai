import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  emptyPublicDossierView,
  hasPublicDossierInput,
  parsePublicDossierFromBody,
  publicDossierHasItems,
  publicDossierLines,
  publicDossierRecordLines,
  publicDossierRevealAttrs,
  readPublicDossier,
  readPublicDossierFromCard,
  readPublicDossierStored,
} from "@/lib/characterPublicDossier";

describe("parsePublicDossierFromBody", () => {
  it("defaults missing fields to hidden / empty", () => {
    const parsed = parsePublicDossierFromBody({});
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.data, {
      genderPublic: false,
      heightCm: null,
      weightKg: null,
      worldPublicName: "",
      worldPublic: false,
    });
  });

  it("accepts consented integers and a typed world display name", () => {
    const parsed = parsePublicDossierFromBody({
      gender_public: true,
      height_cm: "183",
      weight_kg: 71,
      world_public_name: "  에테르노스 제국  ",
      world_public: 1,
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.data, {
      genderPublic: true,
      heightCm: 183,
      weightKg: 71,
      worldPublicName: "에테르노스 제국",
      worldPublic: true,
    });
  });

  it("rejects letters, decimals, units, and out-of-range numbers", () => {
    assert.match(
      (parsePublicDossierFromBody({ height_cm: "183cm" }) as { error: string }).error,
      /숫자만/,
    );
    assert.match(
      (parsePublicDossierFromBody({ height_cm: "183.5" }) as { error: string }).error,
      /숫자만/,
    );
    assert.match(
      (parsePublicDossierFromBody({ weight_kg: "칠십" }) as { error: string }).error,
      /숫자만/,
    );
    assert.match(
      (parsePublicDossierFromBody({ height_cm: 0 }) as { error: string }).error,
      /1–300cm/,
    );
    assert.match(
      (parsePublicDossierFromBody({ weight_kg: 900 }) as { error: string }).error,
      /1–500kg/,
    );
  });

  it("treats blank height and weight as hidden, not zero", () => {
    const parsed = parsePublicDossierFromBody({ height_cm: "  ", weight_kg: "" });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.data.heightCm, null);
    assert.equal(parsed.data.weightKg, null);
  });

  it("detects whether a public_profile body is carrying dossier fields", () => {
    assert.equal(hasPublicDossierInput({ tagline: "한 줄" }), false);
    assert.equal(hasPublicDossierInput({ gender_public: false }), true);
    assert.equal(hasPublicDossierInput({ height_cm: "" }), true);
  });

  it("reads stored consent flags without inventing a world name", () => {
    assert.deepEqual(
      readPublicDossierStored({
        gender_public: 1,
        height_cm: 183,
        weight_kg: 71,
        world_public_name: "에테르노스 제국",
        world_public: 0,
      }),
      {
        genderPublic: true,
        heightCm: 183,
        weightKg: 71,
        worldPublicName: "에테르노스 제국",
        worldPublic: false,
      },
    );
  });

  it("never copies worlds.name, world_shares.name, or characters.world", () => {
    const parsed = parsePublicDossierFromBody({
      world: "비밀 세계관 원문",
      world_id: 9,
      world_public: true,
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.data.worldPublicName, "");
    assert.equal(parsed.data.worldPublic, true);
  });
});

describe("readPublicDossier", () => {
  it("treats legacy rows with no new columns as empty", () => {
    assert.deepEqual(readPublicDossier({ gender: "male", world: "북부" }), emptyPublicDossierView());
    assert.equal(publicDossierHasItems(readPublicDossier(undefined)), false);
  });

  it("never exposes private gender or a private world display name", () => {
    const hidden = readPublicDossier({
      gender: "male",
      gender_public: 0,
      world_public_name: "에테르노스 제국",
      world_public: 0,
      height_cm: 183,
      weight_kg: 71,
    });
    assert.equal(hidden.gender, null);
    assert.equal(hidden.world, null);
    assert.equal(hidden.heightCm, 183);
    assert.equal(hidden.weightKg, 71);
    assert.equal("data-character-gender" in publicDossierRevealAttrs(hidden), false);
    assert.equal("data-character-world" in publicDossierRevealAttrs(hidden), false);
  });

  it("returns consented labels only and omits empty items", () => {
    const view = readPublicDossier({
      gender: "female",
      gender_public: 1,
      world_public_name: "에테르노스 제국",
      world_public: 1,
      height_cm: 165,
      weight_kg: null,
    });
    assert.deepEqual(publicDossierLines(view), [
      { key: "world", label: "WORLD", value: "에테르노스 제국" },
      { key: "gender", label: "성별", value: "여성" },
      { key: "height", label: "키", value: "165cm" },
    ]);
    assert.deepEqual(
      publicDossierRecordLines(view).map((line) => line.key),
      ["gender", "height"],
    );
    assert.deepEqual(publicDossierRevealAttrs(view), {
      "data-character-world": "에테르노스 제국",
      "data-character-gender": "여성",
      "data-character-height": "165cm",
    });
  });

  it("does not invent a world name from borrowed or revoked world fields", () => {
    const view = readPublicDossier({
      gender: "male",
      gender_public: 1,
      world_public: 1,
      world_public_name: "",
    });
    assert.equal(view.world, null);
    assert.equal(view.gender, "남성");
  });
});

describe("readPublicDossierFromCard", () => {
  it("reads only the public card attributes", () => {
    const attrs = publicDossierRevealAttrs({
      world: "에테르노스 제국",
      gender: "남성",
      heightCm: 183,
      weightKg: 71,
    });
    const card = {
      getAttribute(name: string) {
        return attrs[name] ?? null;
      },
    };
    assert.deepEqual(readPublicDossierFromCard(card), {
      world: "에테르노스 제국",
      gender: "남성",
      heightCm: 183,
      weightKg: 71,
    });
  });
});
