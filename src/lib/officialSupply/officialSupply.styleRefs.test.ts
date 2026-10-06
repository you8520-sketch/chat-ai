import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { buildOfficialAssetPrompts } from "@/lib/officialSupply/imagePrompt";
import { testAppearance, testDraft, testStyleCandidate } from "@/lib/officialSupply/officialSupply.fixtures";
import {
  OFFICIAL_STYLE_GENERATION_REF_MAX,
  ROFAN_CLUSTER_B_VISUAL_STYLE_DNA,
  clusterBStyleReferenceUrlsContainLegacyClusterA,
  resolveOfficialAssetStyleDna,
  resolveOfficialStyleGenerationReferences,
  validateClusterBStyleSeedForApproval,
  validateStyleSeedForApproval,
} from "@/lib/officialSupply/style";
import {
  PILOT_STYLE_PROOF_STYLE_KEY,
  PILOT_STYLE_PROOF_SOURCE_STYLE_KEY,
} from "@/lib/officialSupply/pilotStyleProof";
import {
  PILOT_CLUSTER_B_PROOF_DRAFT_KEYS,
  PILOT_CLUSTER_B_PROOF_SOURCE_DRAFT_KEYS,
} from "@/lib/officialSupply/pilotClusterBStyleProof";
import {
  buildClusterBRofanStyleSeed,
  buildUserOwnedRofanStyleSeed,
  CLUSTER_B_HOLDOUT_PATHS,
  CLUSTER_B_PRIMARY_CATALOG_PATHS,
  CLUSTER_B_PRIMARY_GENERATION_PATHS,
  CLUSTER_B_PRIMARY_STYLE_PATH,
  CLUSTER_B_ROFAN_STYLE_PUBLIC_ROOT,
  PILOT_STYLE_PROOF_V3_BATCH_KEY,
  PILOT_STYLE_PROOF_V3_STYLE_KEY,
  PILOT_STYLE_PROOF_V4_BATCH_KEY,
  PILOT_STYLE_PROOF_V4_STYLE_KEY,
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
      imageSubjects: { foreground: "solo_character", backgroundExtras: "none" },
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

const CLUSTER_B_DIR = path.join(
  process.cwd(),
  "public/official-supply/style-seeds/romance-fantasy-cluster-b-v1"
);
const CLUSTER_B_V4_PROOF_SCRIPT = path.join(
  process.cwd(),
  "scripts/official-supply-cluster-b-v4-style-proof.ts"
);

describe("Cluster B graphic rofan STYLE-ONLY references (v4)", () => {
  const repSlot: OfficialAssetSlotPlan = {
    slotKey: "rep",
    kind: "representative",
    tag: "대표",
    expression: "냉정",
    pose: "",
    outfit: "default",
    location: null,
    situation: null,
    characterPresence: "required",
    imageSubjects: { foreground: "solo_character", backgroundExtras: "none" },
    depiction: "standard",
    personTag: null,
  };

  it("hydrates the full 10-character portfolio but keeps paid v4 proof bounded to 3 reps", () => {
    assert.equal(PILOT_CLUSTER_B_PROOF_SOURCE_DRAFT_KEYS.length, 10);
    assert.deepEqual(PILOT_CLUSTER_B_PROOF_SOURCE_DRAFT_KEYS, [
      "pilot-rf-01",
      "pilot-rf-02",
      "pilot-rf-03",
      "pilot-rf-04",
      "pilot-rf-05",
      "pilot-rf-06",
      "pilot-rf-07",
      "pilot-rf-08",
      "pilot-rf-09",
      "pilot-rf-10",
    ]);
    assert.deepEqual(PILOT_CLUSTER_B_PROOF_DRAFT_KEYS, [
      "pilot-rf-v4-01",
      "pilot-rf-v4-02",
      "pilot-rf-v4-09",
    ]);
  });

  it("wires the v4 runtime script to the canonical v4 batch key", () => {
    const source = fs.readFileSync(CLUSTER_B_V4_PROOF_SCRIPT, "utf8");
    assert.match(source, /PILOT_STYLE_PROOF_V4_BATCH_KEY/);
    assert.doesNotMatch(source, /PILOT_CLUSTER_B_PROOF_BATCH_KEY/);
  });

  it("bundles PRIMARY 5 audit paths with deterministic generation order 7→13→5", () => {
    assert.equal(CLUSTER_B_PRIMARY_GENERATION_PATHS.length, 3);
    assert.equal(CLUSTER_B_PRIMARY_CATALOG_PATHS.length, 2);
    assert.equal(CLUSTER_B_HOLDOUT_PATHS.length, 4);
    for (const rel of [
      "primary/b7-black-gold-uniform.webp",
      "primary/b13-black-red-fur.webp",
      "primary/b5-red-dress-female.webp",
      "primary/b3-blue-window-full.webp",
      "primary/b17-sword-flowers.webp",
      "holdout/b6-black-gold-smirk.webp",
      "manifest.json",
    ]) {
      assert.equal(fs.existsSync(path.join(CLUSTER_B_DIR, rel)), true, rel);
    }
    const seed = buildClusterBRofanStyleSeed({ NEXTAUTH_URL: "https://example.test" });
    const urls = resolveOfficialStyleGenerationReferences(seed);
    assert.ok(seed.url.includes(CLUSTER_B_PRIMARY_STYLE_PATH));
    assert.ok(urls[0]!.includes("/b7-black-gold-uniform"));
    assert.ok(urls[1]!.includes("/b13-black-red-fur"));
    assert.ok(urls[2]!.includes("/b5-red-dress-female"));
    const builder = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/userOwnedRofanStyleRefs.ts"), "utf8");
    assert.match(builder, /primaryPath: CLUSTER_B_PRIMARY_STYLE_PATH/);
    assert.doesNotMatch(builder, /CLUSTER_B_PRIMARY_GENERATION_PATHS\[0\]/);
    assert.equal(validateClusterBStyleSeedForApproval(seed), null);
    assert.equal(PILOT_STYLE_PROOF_V4_STYLE_KEY, "romance_fantasy_v4");
    assert.equal(PILOT_STYLE_PROOF_V4_BATCH_KEY, "pilot-romance-fantasy-04-cluster-b");
  });

  it("rejects legacy v3 Cluster A paths from Cluster B generation", () => {
    const legacy = clusterBStyleReferenceUrlsContainLegacyClusterA([
      "https://example.test/official-supply/style-seeds/romance-fantasy-user-owned-v1/primary/p1-face-rendering.webp",
    ]);
    assert.match(legacy ?? "", /Cluster A|legacy/i);
    const seed = buildClusterBRofanStyleSeed({ NEXTAUTH_URL: "https://example.test" });
    seed.url = "https://example.test/official-supply/style-seeds/romance-fantasy-user-owned-v1/primary/p1-face-rendering.webp";
    assert.match(validateClusterBStyleSeedForApproval(seed) ?? "", /cluster B|legacy|cluster-b-v1/i);
  });

  it("requires the structured styleCluster flag; bundle path alone cannot activate Cluster B", () => {
    const rf02 = testStyleCandidate("rf-02").dna;
    const seed = buildClusterBRofanStyleSeed({ NEXTAUTH_URL: "https://example.test" });
    seed.styleCluster = undefined;

    assert.match(
      validateClusterBStyleSeedForApproval(seed) ?? "",
      /styleCluster cluster_b_graphic/i
    );
    assert.deepEqual(resolveOfficialAssetStyleDna(rf02, seed), rf02);
  });

  it("uses stronger graphic DNA and anti-painterly semantics when styleSeed is Cluster B", () => {
    const rf02 = testStyleCandidate("rf-02").dna;
    const clusterSeed = buildClusterBRofanStyleSeed({ NEXTAUTH_URL: "https://example.test" });
    const effective = resolveOfficialAssetStyleDna(rf02, clusterSeed);
    assert.equal(effective.rendering, "cel");
    assert.equal(effective.contrast, "high");
    assert.equal(effective.lightSoftness, "hard");
    assert.notEqual(effective.rendering, rf02.rendering);

    const draft = testDraft({
      draftKey: "v4-style",
      name: "테스트",
      vocabulary: ["방벽", "지휘", "명령", "충성", "심문", "증거", "책임", "귀환"],
      age: 34,
    });
    const withoutCluster = buildOfficialAssetPrompts({
      draft,
      appearance: testAppearance(),
      style: rf02,
      slot: repSlot,
    }).primaryPrompt;
    const withCluster = buildOfficialAssetPrompts({
      draft,
      appearance: testAppearance(),
      style: rf02,
      slot: repSlot,
      styleSeed: clusterSeed,
    }).primaryPrompt;
    assert.match(withCluster, /graphic webtoon|painterly|beige-gold/i);
    assert.doesNotMatch(withoutCluster, /painterly softness/i);
    assert.ok(withCluster.includes(ROFAN_CLUSTER_B_VISUAL_STYLE_DNA.palette));
    assert.ok(withCluster.includes("Appearance Lock의 캐릭터 고유 색상"));
    assert.match(withCluster, /reference colors are examples of color handling/i);
    assert.ok(withCluster.includes("rendering: cel"));
  });
});
