import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { buildOfficialAssetPrompts } from "@/lib/officialSupply/imagePrompt";
import { testAppearance, testDraft, testStyleCandidate } from "@/lib/officialSupply/officialSupply.fixtures";
import {
  OFFICIAL_STYLE_GENERATION_REF_MAX,
  resolveOfficialStyleGenerationReferences,
  validateStyleSeedForApproval,
} from "@/lib/officialSupply/style";
import {
  PILOT_STYLE_PROOF_STYLE_KEY,
  PILOT_STYLE_PROOF_SOURCE_STYLE_KEY,
} from "@/lib/officialSupply/pilotStyleProof";
import {
  buildUserOwnedRofanStyleSeed,
  PILOT_STYLE_PROOF_V3_BATCH_KEY,
  PILOT_STYLE_PROOF_V3_STYLE_KEY,
  USER_OWNED_ROFAN_HOLDOUT_PATHS,
  USER_OWNED_ROFAN_PRIMARY_GENERATION_PATHS,
  USER_OWNED_ROFAN_STYLE_PUBLIC_ROOT,
} from "@/lib/officialSupply/userOwnedRofanStyleRefs";
import type { OfficialAssetSlotPlan } from "@/lib/officialSupply/types";

const SEED_DIR = path.join(
  process.cwd(),
  "public/official-supply/style-seeds/romance-fantasy-user-owned-v1"
);

describe("user-owned rofan STYLE-ONLY references", () => {
  it("keeps primary generation set at 3 and holdouts off the generation path", () => {
    assert.equal(USER_OWNED_ROFAN_PRIMARY_GENERATION_PATHS.length, OFFICIAL_STYLE_GENERATION_REF_MAX);
    assert.equal(USER_OWNED_ROFAN_HOLDOUT_PATHS.length, 3);
    for (const rel of [
      "primary/p1-face-rendering.webp",
      "primary/p2-costume-material-female.webp",
      "primary/p3-lighting-composition.webp",
      "holdout/h1-overhead-pov.webp",
      "holdout/h2-side-profile.webp",
      "holdout/h3-event-situation.webp",
      "manifest.json",
    ]) {
      assert.equal(fs.existsSync(path.join(SEED_DIR, rel)), true, rel);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(SEED_DIR, "manifest.json"), "utf8")) as {
      generationPolicy: { maxStyleReferencesPerRepresentativeCall: number; defaultGenerationSet: string[] };
      holdout: unknown[];
      primary: unknown[];
    };
    assert.equal(manifest.generationPolicy.maxStyleReferencesPerRepresentativeCall, 3);
    assert.equal(manifest.generationPolicy.defaultGenerationSet.length, 3);
    assert.equal(manifest.primary.length, 5);
    assert.equal(manifest.holdout.length, 3);
  });

  it("builds a generation-safe seed with exactly 3 style-only URLs and no holdouts", () => {
    const seed = buildUserOwnedRofanStyleSeed({ NEXTAUTH_URL: "https://example.test" });
    assert.equal(validateStyleSeedForApproval(seed), null);
    const urls = resolveOfficialStyleGenerationReferences(seed);
    assert.equal(urls.length, 3);
    assert.ok(urls.every((u) => u.startsWith("https://example.test" + USER_OWNED_ROFAN_STYLE_PUBLIC_ROOT)));
    assert.ok(urls[0]!.includes("/primary/p1-"));
    assert.ok(urls.some((u) => u.includes("/primary/p2-")));
    assert.ok(urls.some((u) => u.includes("/primary/p3-")));
    assert.ok(!urls.some((u) => u.includes("/holdout/")));
    assert.equal(PILOT_STYLE_PROOF_V3_STYLE_KEY, "romance_fantasy_v3");
  });

  it("rejects unsafe or oversized companion refs without mutating appearance", () => {
    const bad = buildUserOwnedRofanStyleSeed({ NEXTAUTH_URL: "https://example.test" });
    bad.styleOnlyVisualReferences = [
      ...(bad.styleOnlyVisualReferences ?? []),
      {
        url: "https://example.test/extra.webp",
        provenance: "external_public_observation",
        note: "nope",
      },
    ];
    assert.match(validateStyleSeedForApproval(bad) ?? "", /companion|platform-owned|licensed|max/i);

    const draft = testDraft({
      draftKey: "style-ref-id",
      name: "테스트",
      vocabulary: ["방벽", "지휘", "명령", "충성", "심문", "증거", "책임", "귀환"],
      age: 34,
    });
    const appearance = testAppearance();
    const before = JSON.stringify(appearance);
    const rep: OfficialAssetSlotPlan = {
      slotKey: "rep",
      kind: "representative",
      tag: "대표",
      expression: "냉정",
      pose: "",
      outfit: "default",
      location: null,
      situation: null,
      characterPresence: "required",
      depiction: "standard",
      personTag: null,
    };
    const { primaryPrompt } = buildOfficialAssetPrompts({
      draft,
      appearance,
      style: testStyleCandidate("rf-02").dna,
      slot: rep,
    });
    assert.match(primaryPrompt, /STYLE ONLY/i);
    assert.match(primaryPrompt, /IDENTITY LOCK/);
    assert.match(primaryPrompt, /Do not copy any reference person's face identity/i);
    assert.equal(JSON.stringify(appearance), before);
  });

  it("does not mutate frozen v1/v2 style keys; user-owned refs use a new v3 identity", () => {
    assert.equal(PILOT_STYLE_PROOF_SOURCE_STYLE_KEY, "romance_fantasy_v1");
    assert.equal(PILOT_STYLE_PROOF_STYLE_KEY, "romance_fantasy_v2");
    assert.equal(PILOT_STYLE_PROOF_V3_STYLE_KEY, "romance_fantasy_v3");
    assert.equal(PILOT_STYLE_PROOF_V3_BATCH_KEY, "pilot-romance-fantasy-03-style-refs");
    assert.notEqual(PILOT_STYLE_PROOF_V3_STYLE_KEY, PILOT_STYLE_PROOF_STYLE_KEY);
    assert.notEqual(PILOT_STYLE_PROOF_V3_STYLE_KEY, PILOT_STYLE_PROOF_SOURCE_STYLE_KEY);
  });

  it("caps resolved generation refs at OFFICIAL_STYLE_GENERATION_REF_MAX even if companions overflow", () => {
    const seed = buildUserOwnedRofanStyleSeed({ NEXTAUTH_URL: "https://example.test" });
    seed.styleOnlyVisualReferences = [
      ...(seed.styleOnlyVisualReferences ?? []),
      {
        url: "https://example.test/overflow.webp",
        provenance: "platform_owned",
        note: "overflow",
      },
    ];
    assert.match(validateStyleSeedForApproval(seed) ?? "", /at most|max/i);
    const truncated = resolveOfficialStyleGenerationReferences({
      ...seed,
      styleOnlyVisualReferences: seed.styleOnlyVisualReferences.slice(0, 2),
    });
    assert.equal(truncated.length, OFFICIAL_STYLE_GENERATION_REF_MAX);
  });
});
