import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import {
  officialClusterBVariationReferencePair,
  officialGenerationReferenceRoleLayout,
  resolveOfficialClusterBVariationStyleUrl,
  resolveOfficialGenerationReferencePlan,
} from "@/lib/officialSupply/generationReferences";
import {
  OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE,
  OFFICIAL_IDENTITY_THEN_STYLE_IMAGE1_LABEL,
  OFFICIAL_IDENTITY_THEN_STYLE_IMAGE2_LABEL,
  buildOfficialAssetPrompts,
} from "@/lib/officialSupply/imagePrompt";
import {
  OFFICIAL_ASSET_DEFAULT_QUALITY,
  officialImageProfileForSlot,
  resolveOfficialAssetImageModel,
} from "@/lib/officialSupply/imageProfile";
import { resolveOfficialImageSubjects } from "@/lib/officialSupply/imageSubjects";
import { ROFAN_V4_PRODUCTION_BATCH_CONFIG } from "@/lib/officialSupply/pilotProduction";
import { officialSlotGenerationReferences } from "@/lib/officialSupply/runner";
import { resolveOfficialSlotShot } from "@/lib/officialSupply/shotPlan";
import {
  OFFICIAL_STYLE_GENERATION_REF_MAX,
  resolveOfficialStyleGenerationReferences,
} from "@/lib/officialSupply/style";
import type { OfficialAssetPlan, OfficialAssetSlotPlan, StyleReference } from "@/lib/officialSupply/types";
import {
  CLUSTER_B_COMPANION_STYLE_PATHS,
  CLUSTER_B_PRIMARY_GENERATION_PATHS,
  CLUSTER_B_PRIMARY_STYLE_FILE_MARKER,
  CLUSTER_B_PRIMARY_STYLE_PATH,
  buildClusterBRofanStyleSeed,
  buildUserOwnedRofanStyleSeed,
  isOfficialClusterBPrimaryStyleRef,
} from "@/lib/officialSupply/userOwnedRofanStyleRefs";
import { testStyleCandidate } from "@/lib/officialSupply/officialSupply.fixtures";

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot/characters");
const IDENTITY = "/uploads/official-pilot-rf-v4-03__rep-a1.webp";
const LUCIAN_SLOTS = ["sig4", "scene1", "scene2", "scene3"] as const;
const ENV = { NEXTAUTH_URL: "https://example.test" };

function readPilot(draftKey: string): { assetPlan: OfficialAssetPlan } {
  return JSON.parse(fs.readFileSync(path.join(PILOT_DIR, `${draftKey}.json`), "utf8")) as {
    assetPlan: OfficialAssetPlan;
  };
}

function lucianSlot(slotKey: string): OfficialAssetSlotPlan {
  const slot = readPilot("pilot-rf-03").assetPlan.slots.find((item) => item.slotKey === slotKey);
  assert.ok(slot, slotKey);
  return slot;
}

function clusterSeed(): StyleReference {
  return buildClusterBRofanStyleSeed(ENV);
}

function nonClusterSeed(): StyleReference {
  return { url: "/uploads/style.webp", provenance: "platform_owned", note: "owned seed" };
}

describe("official generation reference plan owner", () => {
  it("keeps Cluster B representative on style-only refs with max 3 and no identity anchor", () => {
    const seed = clusterSeed();
    const resolved = resolveOfficialGenerationReferencePlan({
      kind: "representative",
      styleSeed: seed,
      representativeUrl: IDENTITY,
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.plan.mode, "representative_style_only");
    assert.equal(resolved.plan.referenceRoleLayout, "slot_default");
    assert.equal(resolved.plan.references.length, OFFICIAL_STYLE_GENERATION_REF_MAX);
    assert.deepEqual(resolved.plan.references, resolveOfficialStyleGenerationReferences(seed));
    assert.equal(resolved.plan.references.includes(IDENTITY), false);
    assert.ok(resolved.plan.references[0]!.includes("b7-black-gold-uniform"));
    assert.ok(resolved.plan.references.some((url) => url.includes("b13-black-red-fur")));
    assert.ok(resolved.plan.references.some((url) => url.includes("b5-red-dress-female")));
  });

  it("sends Cluster B variations as exactly identity + styleSeed.url and excludes companions", () => {
    const seed = clusterSeed();
    const resolved = resolveOfficialGenerationReferencePlan({
      kind: "signature",
      styleSeed: seed,
      representativeUrl: IDENTITY,
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.plan.mode, "variation_identity_then_style");
    assert.equal(resolved.plan.referenceRoleLayout, "identity_then_style");
    assert.equal(officialGenerationReferenceRoleLayout(resolved.plan), "identity_then_style");
    assert.deepEqual(resolved.plan.references, [IDENTITY, seed.url]);
    assert.equal(resolved.plan.references.length, 2);
    assert.equal(resolved.plan.references[0], IDENTITY);
    assert.equal(resolved.plan.references[1], seed.url);
    assert.ok(seed.url.includes(CLUSTER_B_PRIMARY_STYLE_PATH));
    for (const companion of CLUSTER_B_COMPANION_STYLE_PATHS) {
      assert.equal(resolved.plan.references.some((url) => url.includes(companion)), false);
    }
    assert.deepEqual(
      officialSlotGenerationReferences({
        kind: "scene",
        styleSeed: seed,
        representativeUrl: IDENTITY,
      }),
      [IDENTITY, seed.url]
    );
  });

  it("keeps non-Cluster-B variations on the existing one-ref slot_default path", () => {
    const resolved = resolveOfficialGenerationReferencePlan({
      kind: "signature",
      styleSeed: nonClusterSeed(),
      representativeUrl: IDENTITY,
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.plan.mode, "variation_identity_anchor");
    assert.equal(resolved.plan.referenceRoleLayout, "slot_default");
    assert.deepEqual(resolved.plan.references, [IDENTITY]);
    assert.deepEqual(
      officialSlotGenerationReferences({
        kind: "signature",
        styleSeed: nonClusterSeed(),
        representativeUrl: IDENTITY,
      }),
      [IDENTITY]
    );
  });

  it("uses the same Cluster B pair and identity_then_style role for prompt fallback", () => {
    const lucian = loadCompiledOfficialCharacterSource("pilot-rf-03");
    const slot = lucianSlot("sig4");
    const seed = clusterSeed();
    const resolved = resolveOfficialGenerationReferencePlan({
      kind: slot.kind,
      styleSeed: seed,
      representativeUrl: IDENTITY,
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    const prompts = buildOfficialAssetPrompts({
      draft: lucian.draft,
      appearance: lucian.appearanceLock,
      style: testStyleCandidate("rf-02").dna,
      slot,
      styleSeed: seed,
      referenceRoleLayout: resolved.plan.referenceRoleLayout,
    });
    assert.equal(resolved.plan.references.length, 2);
    assert.equal(prompts.primaryPrompt.includes(OFFICIAL_IDENTITY_THEN_STYLE_IMAGE1_LABEL), true);
    assert.equal(prompts.strictFallbackPrompt.includes(OFFICIAL_IDENTITY_THEN_STYLE_IMAGE1_LABEL), true);
    assert.equal(prompts.primaryPrompt.includes(OFFICIAL_IDENTITY_THEN_STYLE_IMAGE2_LABEL), true);
    assert.equal(prompts.strictFallbackPrompt.includes(OFFICIAL_IDENTITY_THEN_STYLE_IMAGE2_LABEL), true);
    assert.equal(prompts.primaryPrompt.includes(OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE), false);
    assert.equal(prompts.strictFallbackPrompt.includes(OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE), false);
    assert.equal(prompts.primaryPrompt.includes("rendering: cel"), true);
    assert.equal(prompts.strictFallbackPrompt.includes("rendering: cel"), false);
  });

  it("rebuilds the same canonical plan on retry", () => {
    const seed = clusterSeed();
    const first = resolveOfficialGenerationReferencePlan({
      kind: "emotion",
      styleSeed: seed,
      representativeUrl: IDENTITY,
    });
    const second = resolveOfficialGenerationReferencePlan({
      kind: "emotion",
      styleSeed: seed,
      representativeUrl: IDENTITY,
    });
    assert.deepEqual(first, second);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.deepEqual(first.plan.references, [IDENTITY, seed.url]);
  });

  it("fails closed on Cluster B missing or unsafe style root and missing identity", () => {
    const seed = clusterSeed();
    const missingIdentity = resolveOfficialGenerationReferencePlan({
      kind: "signature",
      styleSeed: seed,
      representativeUrl: "",
    });
    assert.equal(missingIdentity.ok, false);
    if (missingIdentity.ok) return;
    assert.equal(missingIdentity.code, "missing_identity");
    assert.deepEqual(
      officialSlotGenerationReferences({
        kind: "signature",
        styleSeed: seed,
        representativeUrl: "",
      }),
      []
    );

    const missingRoot = resolveOfficialClusterBVariationStyleUrl({
      ...seed,
      url: "",
    });
    assert.equal(missingRoot.ok, false);
    if (missingRoot.ok) return;
    assert.equal(missingRoot.code, "missing_style_root");

    const unsafe = resolveOfficialGenerationReferencePlan({
      kind: "signature",
      styleSeed: {
        ...seed,
        provenance: "external_public_observation",
      },
      representativeUrl: IDENTITY,
    });
    assert.equal(unsafe.ok, false);
    if (unsafe.ok) return;
    assert.ok(unsafe.code === "unsafe_style_root" || unsafe.code === "invalid_cluster_b_seed");
    assert.deepEqual(
      officialSlotGenerationReferences({
        kind: "signature",
        styleSeed: { ...seed, provenance: "external_public_observation" },
        representativeUrl: IDENTITY,
      }),
      []
    );

    const companionAsRoot = resolveOfficialGenerationReferencePlan({
      kind: "signature",
      styleSeed: { ...seed, url: seed.styleOnlyVisualReferences?.[0]?.url ?? "" },
      representativeUrl: IDENTITY,
    });
    assert.equal(companionAsRoot.ok, false);
    if (companionAsRoot.ok) return;
    assert.notEqual(companionAsRoot.ok && companionAsRoot.plan.references[0], IDENTITY);
  });

  it("does not silently downgrade a Cluster B variation to one identity reference", () => {
    const seed = clusterSeed();
    const failed = resolveOfficialGenerationReferencePlan({
      kind: "scene",
      styleSeed: { ...seed, url: "https://example.test/not-the-primary.webp", styleCluster: "cluster_b_graphic" },
      representativeUrl: IDENTITY,
    });
    assert.equal(failed.ok, false);
    if (failed.ok) return;
    assert.notDeepEqual(officialSlotGenerationReferences({
      kind: "scene",
      styleSeed: { ...seed, url: "https://example.test/not-the-primary.webp" },
      representativeUrl: IDENTITY,
    }), [IDENTITY]);
  });

  it("keeps production reserve, budget, model, quality, and size owners unchanged", () => {
    assert.equal(ROFAN_V4_PRODUCTION_BATCH_CONFIG.reservePerImageUsd, 0.12);
    assert.equal(ROFAN_V4_PRODUCTION_BATCH_CONFIG.budgetUsd.perCharacter, 2.5);
    assert.equal(ROFAN_V4_PRODUCTION_BATCH_CONFIG.budgetUsd.batch, 20);
    assert.equal(ROFAN_V4_PRODUCTION_BATCH_CONFIG.budgetUsd.perGenre, 20);
    assert.equal(ROFAN_V4_PRODUCTION_BATCH_CONFIG.budgetUsd.perWorld, 20);
    assert.equal(ROFAN_V4_PRODUCTION_BATCH_CONFIG.quality, "medium");
    assert.equal(OFFICIAL_ASSET_DEFAULT_QUALITY, "medium");
    assert.equal(officialImageProfileForSlot("signature").size, "1536x1024");
    assert.equal(officialImageProfileForSlot("scene").size, "1536x1024");
    assert.equal(resolveOfficialAssetImageModel({ OPENAI_IMAGE_MODEL: "gpt-image-2.5-sunburst" }), "gpt-image-2.5-sunburst");
    const billing = fs.readFileSync(path.join(process.cwd(), "src/lib/openAiImageEdit.ts"), "utf8");
    assert.match(billing, /imageInputTokens \* 0\.000008/);
    assert.match(billing, /form\.append\("image\[\]"/);
  });

  it("matches only the exact canonical Cluster B primary STYLE resource", () => {
    const httpsCanonical = `https://example.test${CLUSTER_B_PRIMARY_STYLE_PATH}`;
    assert.equal(isOfficialClusterBPrimaryStyleRef(httpsCanonical), true);
    assert.equal(isOfficialClusterBPrimaryStyleRef(CLUSTER_B_PRIMARY_STYLE_PATH), true);
    assert.equal(isOfficialClusterBPrimaryStyleRef(`https://example.test${CLUSTER_B_COMPANION_STYLE_PATHS[0]}`), false);
    assert.equal(isOfficialClusterBPrimaryStyleRef(`https://example.test${CLUSTER_B_COMPANION_STYLE_PATHS[1]}`), false);
    assert.equal(isOfficialClusterBPrimaryStyleRef(`${httpsCanonical}.evil`), false);
    assert.equal(isOfficialClusterBPrimaryStyleRef(`${httpsCanonical}/extra`), false);
    assert.equal(
      isOfficialClusterBPrimaryStyleRef(`/tmp/${CLUSTER_B_PRIMARY_STYLE_FILE_MARKER}.webp`),
      false
    );
    assert.equal(
      isOfficialClusterBPrimaryStyleRef(`https://example.test/other.webp?q=${CLUSTER_B_PRIMARY_STYLE_FILE_MARKER}`),
      false
    );
    assert.equal(
      isOfficialClusterBPrimaryStyleRef(`https://example.test/other.webp#${CLUSTER_B_PRIMARY_STYLE_FILE_MARKER}`),
      false
    );
    assert.equal(
      isOfficialClusterBPrimaryStyleRef(
        "https://example.test/official-supply/style-seeds/romance-fantasy-cluster-b-v1/primary/b7-black-gold-uniform-copy.webp"
      ),
      false
    );
    const refs = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/userOwnedRofanStyleRefs.ts"), "utf8");
    assert.doesNotMatch(refs, /includes\(CLUSTER_B_PRIMARY_STYLE_FILE_MARKER\)/);

    const spoofed = resolveOfficialGenerationReferencePlan({
      kind: "signature",
      styleSeed: {
        ...clusterSeed(),
        url: `https://example.test/other.webp?q=${CLUSTER_B_PRIMARY_STYLE_FILE_MARKER}`,
      },
      representativeUrl: IDENTITY,
    });
    assert.equal(spoofed.ok, false);
    assert.deepEqual(
      officialSlotGenerationReferences({
        kind: "signature",
        styleSeed: {
          ...clusterSeed(),
          url: `${httpsCanonical}.evil`,
        },
        representativeUrl: IDENTITY,
      }),
      []
    );
  });

  it("owns the Cluster B primary style path explicitly instead of array index 0", () => {
    const refs = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/userOwnedRofanStyleRefs.ts"), "utf8");
    const plan = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/generationReferences.ts"), "utf8");
    const runner = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/runner.ts"), "utf8");
    assert.match(refs, /CLUSTER_B_PRIMARY_STYLE_PATH/);
    assert.match(refs, /primaryPath: CLUSTER_B_PRIMARY_STYLE_PATH/);
    assert.match(refs, /companionPaths: CLUSTER_B_COMPANION_STYLE_PATHS/);
    assert.doesNotMatch(refs, /CLUSTER_B_PRIMARY_GENERATION_PATHS\[0\]/);
    assert.doesNotMatch(plan, /CLUSTER_B_PRIMARY_GENERATION_PATHS\[0\]/);
    assert.match(runner, /resolveOfficialGenerationReferencePlan/);
    assert.equal(CLUSTER_B_PRIMARY_GENERATION_PATHS[0], CLUSTER_B_PRIMARY_STYLE_PATH);
    assert.deepEqual(CLUSTER_B_PRIMARY_GENERATION_PATHS.slice(1), [...CLUSTER_B_COMPANION_STYLE_PATHS]);
    const seed = clusterSeed();
    assert.ok(seed.url.includes(CLUSTER_B_PRIMARY_STYLE_PATH));
    assert.equal(resolveOfficialClusterBVariationStyleUrl(seed).ok, true);
    const pair = officialClusterBVariationReferencePair(IDENTITY, seed.url);
    assert.equal(pair.ok, true);
    if (!pair.ok) return;
    assert.deepEqual(pair.references, [IDENTITY, seed.url]);
  });

  it("preserves v3 primary and companion pixels without changing generation order", () => {
    const seed = buildUserOwnedRofanStyleSeed(ENV);
    const urls = resolveOfficialStyleGenerationReferences(seed);
    assert.equal(urls.length, 3);
    assert.ok(urls[0]!.includes("/primary/p1-"));
    assert.ok(urls[1]!.includes("/primary/p2-"));
    assert.ok(urls[2]!.includes("/primary/p3-"));
  });

  it("assembles Lucian final production plans as the approved QA dual-ref semantics", () => {
    const lucian = loadCompiledOfficialCharacterSource("pilot-rf-03");
    const seed = clusterSeed();
    const expectedSubjects = {
      sig4: { foreground: "solo_character", backgroundExtras: "none" },
      scene1: {
        foreground: "character_plus_required_partner",
        partnerRole: "user",
        backgroundExtras: "optional_unnamed",
      },
      scene2: { foreground: "solo_character", backgroundExtras: "optional_unnamed" },
      scene3: {
        foreground: "character_plus_required_partner",
        partnerRole: "user",
        backgroundExtras: "optional_unnamed",
      },
    } as const;
    const expectedShot = {
      sig4: { faceDirection: "profile", cameraAngle: "high_angle", distance: "close_up" },
      scene1: { faceDirection: "right_three_quarter", cameraAngle: "high_angle", distance: "knee_or_full" },
      scene2: { faceDirection: "profile", cameraAngle: "low_angle", distance: "knee_or_full" },
      scene3: { faceDirection: "left_three_quarter", cameraAngle: "eye_level", distance: "medium" },
    } as const;

    for (const slotKey of LUCIAN_SLOTS) {
      const slot = lucianSlot(slotKey);
      const resolved = resolveOfficialGenerationReferencePlan({
        kind: slot.kind,
        styleSeed: seed,
        representativeUrl: IDENTITY,
      });
      assert.equal(resolved.ok, true, slotKey);
      if (!resolved.ok) continue;
      assert.equal(resolved.plan.references.length, 2, slotKey);
      assert.equal(resolved.plan.references[0], IDENTITY, slotKey);
      assert.equal(resolved.plan.references[1], seed.url, slotKey);
      assert.equal(resolved.plan.referenceRoleLayout, "identity_then_style", slotKey);
      const shot = resolveOfficialSlotShot(slot, lucian.draft.draftKey);
      assert.equal(shot.faceDirection, expectedShot[slotKey].faceDirection, slotKey);
      assert.equal(shot.cameraAngle, expectedShot[slotKey].cameraAngle, slotKey);
      assert.equal(shot.distance, expectedShot[slotKey].distance, slotKey);
      assert.deepEqual(resolveOfficialImageSubjects(slot), expectedSubjects[slotKey], slotKey);
      const prompts = buildOfficialAssetPrompts({
        draft: lucian.draft,
        appearance: lucian.appearanceLock,
        style: testStyleCandidate("rf-02").dna,
        slot,
        styleSeed: seed,
        referenceRoleLayout: resolved.plan.referenceRoleLayout,
      });
      assert.equal(prompts.primaryPrompt.includes(OFFICIAL_IDENTITY_THEN_STYLE_IMAGE1_LABEL), true, slotKey);
      assert.equal(prompts.strictFallbackPrompt.includes(OFFICIAL_IDENTITY_THEN_STYLE_IMAGE1_LABEL), true, slotKey);
    }
  });
});
