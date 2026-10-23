import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { getDb } from "@/lib/db";
import { renderChatImageStyleFidelityContract } from "@/lib/chatImageVisualIdentity";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import {
  officialGenerationReferenceRoleLayout,
  resolveOfficialGenerationReferencePlan,
} from "@/lib/officialSupply/generationReferences";
import { officialReviewCandidateReference } from "@/lib/officialSupply/referencePreparation";
import {
  OFFICIAL_IDENTITY_COPY_FORBIDDEN_CLAUSE,
  buildOfficialAssetPrompts,
} from "@/lib/officialSupply/imagePrompt";
import { officialImageProfileForSlot } from "@/lib/officialSupply/imageProfile";
import {
  HWANG_VOCAB,
  testAppearance,
  testAssetPlan,
  testBatchConfig,
  testDraft,
  testStyleCandidate,
} from "@/lib/officialSupply/officialSupply.fixtures";
import {
  composeOfficialSlotGeneration,
  OfficialImageTransportError,
  moderateOfficialAssetSlot,
  runOfficialAssetSlot,
  type OfficialAssetRunnerDeps,
  type OfficialImageTransport,
} from "@/lib/officialSupply/runner";
import { renderOfficialShotResponsibility, resolveOfficialSlotShot } from "@/lib/officialSupply/shotPlan";
import { OfficialSupplyStore } from "@/lib/officialSupply/store";
import type {
  OfficialAnchorQaReport,
  OfficialAppearanceLock,
  OfficialAssetPlan,
  OfficialAssetSlotPlan,
  OfficialCharacterDraft,
} from "@/lib/officialSupply/types";
import {
  CLUSTER_B_PRIMARY_STYLE_PATH,
  buildClusterBRofanStyleSeed,
} from "@/lib/officialSupply/userOwnedRofanStyleRefs";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";

const F_RELATIVE = "docs/official-supply/reviews/assets/wolfgang-asset-redesign/rep-f-raw.webp";
const F_PATH = path.join(process.cwd(), F_RELATIVE);
const F_SHA = "a95f9aca91a09a4bf1cd2e13bab5c0bd226f8972bb2bf60990a66891150f8032";
const F_REFERENCE = officialReviewCandidateReference(F_RELATIVE, F_SHA);
const PRODUCTION_REP = "https://hav.chat/uploads/official-pilot-rf-v4-02__rep-a1.webp";
const ENV = { NEXTAUTH_URL: "https://example.test" } as NodeJS.ProcessEnv;
const STAGING_USER = { id: 7101, nickname: "identity-style", is_adult: 1 as const };
const PILOT_JSON = path.join(process.cwd(), "src/lib/officialSupply/pilot/characters/pilot-rf-02.json");

const SMILE_SIG4: OfficialAssetSlotPlan = {
  slotKey: "sig4",
  kind: "signature",
  tag: "옅은 미소",
  expression: "긴장을 풀고 상대를 바라보며 입꼬리만 살짝 올린 옅은 미소. 이를 보이지 않는다.",
  pose: "갑옷을 벗지 않은 채 창가 돌벤치에 앉아 상체를 상대(카메라) 쪽으로 돌린다. 양손은 허벅지 위에 올려 두고 소품을 건네지 않는다. 어깨는 살짝 내려가 있고, 얼굴·눈·옅은 미소가 한눈에 보인다. 유저는 그리지 않는다.",
  outfit: "default",
  location: "흑철 요새 집무실 창가",
  situation: "늦은 당직을 마친 뒤 짧은 휴식을 취하며 상대를 바라본다",
  characterPresence: "required",
  depiction: "standard",
  personTag: "미소",
  imageSubjects: { foreground: "solo_character", backgroundExtras: "none" },
};

const PASS = { ok: true };
const ANCHOR_QA: OfficialAnchorQaReport = {
  gender: PASS,
  ageAppearance: PASS,
  face: PASS,
  hair: PASS,
  eyes: PASS,
  body: PASS,
  identifyingFeatures: PASS,
  artStyle: PASS,
  outfit: PASS,
  cardCrop: PASS,
  compositionIndependence: PASS,
};

type Sent = {
  model: string;
  primaryPrompt: string;
  strictFallbackPrompt: string;
  references: string[];
  size: string;
  quality: string;
  outputCompression: number;
  templateId: string;
};

const originalFetch = globalThis.fetch;
const egressAttempts: string[] = [];
let store: OfficialSupplyStore;

function smilePlan(base: OfficialAssetPlan): OfficialAssetPlan {
  return {
    slots: base.slots.map((slot) => (slot.slotKey === "sig4" ? SMILE_SIG4 : slot)),
  };
}

function assertIdentityStylePrompt(prompt: string, draftKey: string): void {
  const shot = resolveOfficialSlotShot(SMILE_SIG4, draftKey);
  assert.match(prompt, /both the identity source and the style source/);
  assert.match(prompt, /STYLE FIDELITY/);
  assert.ok(prompt.includes(OFFICIAL_IDENTITY_COPY_FORBIDDEN_CLAUSE));
  assert.ok(prompt.includes(renderOfficialShotResponsibility(shot)));
  assert.match(prompt, /IDENTITY LOCK/);
  assert.match(prompt, /왼쪽 턱 아래에 가늘게 남은 흉터/);
  assert.match(prompt, /MATURE MALE VISUAL AGE LOCK/);
  assert.match(prompt, /Expression: 긴장을 풀고 상대를 바라보며 입꼬리만 살짝 올린 옅은 미소/);
  assert.match(prompt, /Pose: 갑옷을 벗지 않은 채 창가 돌벤치에 앉아/);
  assert.match(prompt, /Do not move a hidden scar or possession into view/);
  assert.equal(
    prompt.includes(renderChatImageStyleFidelityContract({ hasTemplate: false, subjectCount: 1 })),
    true
  );
  assert.doesNotMatch(prompt, /STYLE ONLY/);
  assert.doesNotMatch(prompt, /IDENTITY ONLY/);
  assert.doesNotMatch(prompt, /IDENTITY ANCHOR ONLY/);
  assert.doesNotMatch(prompt, /ART STYLE \(structured attributes/);
  assert.doesNotMatch(prompt, /ART STYLE describes/);
  assert.doesNotMatch(prompt, /b7-black-gold-uniform/);
  assert.doesNotMatch(prompt, /b13-black-red-fur/);
  assert.doesNotMatch(prompt, /b5-red-dress-female/);
  assert.doesNotMatch(prompt, /수프/);
  assert.equal(prompt.includes(PRODUCTION_REP), false);
}

before(() => {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    egressAttempts.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    throw new Error("network egress is not allowed");
  }) as typeof fetch;
  installIsolatedTestDatabase();
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO users (id, email, nickname, pw_hash, points, is_adult) VALUES (?,?,?,?,1000,1)")
    .run(STAGING_USER.id, "identity-style@test.local", STAGING_USER.nickname, "hash");
  store = new OfficialSupplyStore(db);
});

after(() => {
  globalThis.fetch = originalFetch;
  uninstallIsolatedTestDatabase();
  assert.deepEqual(egressAttempts, []);
});

describe("same-person identity and style reference plan", () => {
  const seed = buildClusterBRofanStyleSeed(ENV);
  const local = F_REFERENCE;

  it("keeps representative STYLE ONLY and Cluster B identity-then-style when no local image is supplied", () => {
    const representative = resolveOfficialGenerationReferencePlan({
      kind: "representative",
      styleSeed: seed,
      representativeUrl: PRODUCTION_REP,
    });
    assert.equal(representative.ok, true);
    if (!representative.ok) return;
    assert.equal(representative.plan.mode, "representative_style_only");
    assert.equal(representative.plan.references.includes(local), false);
    assert.ok(representative.plan.references.some((url) => url.includes("b7-black-gold-uniform")));

    const variation = resolveOfficialGenerationReferencePlan({
      kind: "signature",
      styleSeed: seed,
      representativeUrl: PRODUCTION_REP,
    });
    assert.equal(variation.ok, true);
    if (!variation.ok) return;
    assert.equal(variation.plan.mode, "variation_identity_then_style");
    assert.deepEqual(variation.plan.references, [PRODUCTION_REP, seed.url]);
    assert.equal(officialGenerationReferenceRoleLayout(variation.plan), "identity_then_style");
  });

  it("rejects role conflicts before a reference list is mixed", () => {
    const onRepresentative = resolveOfficialGenerationReferencePlan({
      kind: "representative",
      styleSeed: seed,
      representativeUrl: PRODUCTION_REP,
      samePersonIdentityStyleUrl: local,
    });
    assert.equal(onRepresentative.ok, false);
    if (onRepresentative.ok) return;
    assert.equal(onRepresentative.code, "role_conflict");

    const styleRoot = resolveOfficialGenerationReferencePlan({
      kind: "signature",
      styleSeed: seed,
      representativeUrl: PRODUCTION_REP,
      samePersonIdentityStyleUrl: seed.url,
    });
    assert.equal(styleRoot.ok, false);
    if (styleRoot.ok) return;
    assert.equal(styleRoot.code, "role_conflict");

    const stylePath = resolveOfficialGenerationReferencePlan({
      kind: "emotion",
      styleSeed: seed,
      representativeUrl: PRODUCTION_REP,
      samePersonIdentityStyleUrl: CLUSTER_B_PRIMARY_STYLE_PATH,
    });
    assert.equal(stylePath.ok, false);
    if (stylePath.ok) return;
    assert.equal(stylePath.code, "role_conflict");

    const liveAnchor = resolveOfficialGenerationReferencePlan({
      kind: "scene",
      styleSeed: seed,
      representativeUrl: PRODUCTION_REP,
      samePersonIdentityStyleUrl: PRODUCTION_REP,
    });
    assert.equal(liveAnchor.ok, false);
    if (liveAnchor.ok) return;
    assert.equal(liveAnchor.code, "role_conflict");
  });

  it("sends one local image and does not reattach STYLE references", () => {
    const resolved = resolveOfficialGenerationReferencePlan({
      kind: "signature",
      styleSeed: seed,
      representativeUrl: PRODUCTION_REP,
      samePersonIdentityStyleUrl: local,
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.plan.mode, "variation_identity_and_style");
    assert.deepEqual(resolved.plan.references, [local]);
    assert.equal(officialGenerationReferenceRoleLayout(resolved.plan), "identity_and_style");
    assert.equal(resolved.plan.references.includes(seed.url), false);
    assert.equal(resolved.plan.references.includes(PRODUCTION_REP), false);
  });
});

describe("same-person identity and style prompt", () => {
  it("keeps Wolfgang lock, age, shot, and the approved sig4 lines without style DNA", () => {
    const compiled = loadCompiledOfficialCharacterSource("pilot-rf-02");
    const file = JSON.parse(fs.readFileSync(PILOT_JSON, "utf8")) as { assetPlan: OfficialAssetPlan };
    assert.match(JSON.stringify(file.assetPlan), /수프/);
    assert.equal(file.assetPlan.slots.find((slot) => slot.slotKey === "sig4")?.tag, "절제된 온기");
    const slot = SMILE_SIG4;
    const seed = buildClusterBRofanStyleSeed(ENV);
    const prompts = buildOfficialAssetPrompts({
      draft: compiled.draft,
      appearance: compiled.appearanceLock,
      style: testStyleCandidate("c2").dna,
      slot,
      styleSeed: seed,
      referenceRoleLayout: "identity_and_style",
    });
    assertIdentityStylePrompt(prompts.primaryPrompt, compiled.draft.draftKey);
    assertIdentityStylePrompt(prompts.strictFallbackPrompt, compiled.draft.draftKey);
    assert.match(prompts.primaryPrompt, /볼프강/);
    assert.match(prompts.primaryPrompt, /age 34/);

    const untouched = buildOfficialAssetPrompts({
      draft: compiled.draft,
      appearance: compiled.appearanceLock,
      style: testStyleCandidate("c2").dna,
      slot,
      styleSeed: seed,
      referenceRoleLayout: "identity_then_style",
    });
    assert.match(untouched.primaryPrompt, /Image 2 STYLE ONLY/);
    assert.match(untouched.primaryPrompt, /ART STYLE \(structured attributes/);
  });
});

describe("runner pre-send input for the local F candidate", () => {
  const compiled = loadCompiledOfficialCharacterSource("pilot-rf-02");
  const seed = buildClusterBRofanStyleSeed(ENV);
  const calls: Sent[] = [];

  function deps(extra: Partial<OfficialAssetRunnerDeps> = {}): OfficialAssetRunnerDeps {
    const transport: OfficialImageTransport = {
      generate: async (input) => {
        calls.push({
          model: input.model,
          primaryPrompt: input.primaryPrompt,
          strictFallbackPrompt: input.strictFallbackPrompt,
          references: input.references,
          size: input.size,
          quality: input.quality,
          outputCompression: input.outputCompression,
          templateId: input.templateId,
        });
        const profile = officialImageProfileForSlot(input.size === "1024x1536" ? "representative" : "signature");
        return {
          buffer: Buffer.from(`${profile.width}x${profile.height}`),
          costUsd: 0,
          hasUnknownAttemptCost: false,
          providerRequestId: null,
        };
      },
    };
    return {
      store,
      transport,
      imageOps: {
        inspect: async (buffer) => {
          const match = /^(\d+)x(\d+)$/.exec(buffer.toString());
          return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
        },
      },
      storage: {
        store: async (filename) => ({ url: `/uploads/${filename}` }),
      },
      spool: {
        save: async () => undefined,
        load: async () => null,
        remove: async () => undefined,
      },
      workerId: "identity-style",
      now: () => 1_700_000_000_000,
      env: { OPENAI_IMAGE_MODEL: "gpt-image-2.5-sunburst" },
      ...extra,
    };
  }

  function lockDraft(
    draft: OfficialCharacterDraft,
    plan: OfficialAssetPlan,
    appearance: OfficialAppearanceLock,
    isStyleProof = false
  ): void {
    store.addCharacterDraft("identity-style-batch", draft, { isStyleProof });
    const text = store.lockText(draft.draftKey, { stagingUser: STAGING_USER });
    assert.deepEqual(text.errors, [], text.errors.map((issue) => issue.message).join("\n"));
    assert.equal(store.lockAppearance(draft.draftKey, appearance).ok, true);
    const locked = store.lockAssetPlan(draft.draftKey, plan);
    assert.deepEqual(locked.errors, [], locked.errors.map((issue) => issue.message).join("\n"));
  }

  it("assembles the real runner payload from F without a provider call", async () => {
    const fBytes = fs.readFileSync(F_PATH);
    assert.equal(createHash("sha256").update(fBytes).digest("hex"), F_SHA);

    store.createBatch("identity-style-batch", testBatchConfig({ budgetUsd: { batch: 100 } }));
    store.proposeStyle({
      styleKey: compiled.draft.styleKey,
      genre: "로맨스 판타지",
      candidates: ["c1", "c2", "c3"].map(testStyleCandidate),
    });
    store.approveStyleCandidate(compiled.draft.styleKey, "c2", seed, "owner");

    const proofKey = "identity-style-proof";
    lockDraft(
      testDraft({
        draftKey: proofKey,
        name: "레온하르트",
        vocabulary: HWANG_VOCAB,
        styleKey: compiled.draft.styleKey,
        worldKey: "identity-style-proof-world",
      }),
      testAssetPlan(),
      testAppearance(),
      true
    );
    assert.equal((await runOfficialAssetSlot(deps(), proofKey, "rep")).status, "generated");
    store.decideStyleProof(compiled.draft.styleKey, "approve", "owner");

    const file = JSON.parse(fs.readFileSync(PILOT_JSON, "utf8")) as { assetPlan: OfficialAssetPlan };
    const plan = smilePlan(file.assetPlan);
    lockDraft(compiled.draft, plan, compiled.appearanceLock);

    const beforeFlag = composeOfficialSlotGeneration({
      character: store.getCharacter(compiled.draft.draftKey),
      style: store.getStyle(compiled.draft.styleKey),
      slotKey: "sig4",
      representativeUrl: PRODUCTION_REP,
      env: ENV,
    });
    assert.equal(beforeFlag.ok, true);
    if (!beforeFlag.ok) return;
    assert.equal(beforeFlag.referenceRoleLayout, "identity_then_style");
    assert.equal(beforeFlag.references.length, 2);
    assert.match(beforeFlag.primaryPrompt, /Image 2 STYLE ONLY/);

    const repCalls = calls.length;
    assert.equal((await runOfficialAssetSlot(deps(), compiled.draft.draftKey, "rep")).status, "generated");
    await moderateOfficialAssetSlot(
      { store, moderator: { moderate: async () => ({ status: "checked", adultFlagged: false, moderationReject: false, reason: "" }) } },
      compiled.draft.draftKey,
      "rep"
    );
    assert.equal(store.reviewAnchor(compiled.draft.draftKey, ANCHOR_QA, "owner").approved, true);

    const conflictKey = "identity-style-conflict";
    lockDraft(
      testDraft({
        draftKey: conflictKey,
        name: "이안",
        vocabulary: HWANG_VOCAB,
        styleKey: compiled.draft.styleKey,
        worldKey: "identity-style-conflict-world",
        age: 31,
      }),
      testAssetPlan(),
      testAppearance()
    );
    const conflictCalls = calls.length;
    const conflict = await runOfficialAssetSlot(
      deps({ samePersonIdentityStyleUrl: F_REFERENCE }),
      conflictKey,
      "rep"
    );
    assert.equal(conflict.status, "failed");
    if (conflict.status === "failed") assert.match(conflict.error, /STYLE ONLY/);
    assert.equal(calls.length, conflictCalls);

    const liveRep = store.representativeAsset(compiled.draft.draftKey).resultUrl ?? "";
    const composed = composeOfficialSlotGeneration({
      character: store.getCharacter(compiled.draft.draftKey),
      style: store.getStyle(compiled.draft.styleKey),
      slotKey: "sig4",
      representativeUrl: liveRep,
      env: { OPENAI_IMAGE_MODEL: "gpt-image-2.5-sunburst" },
      samePersonIdentityStyleUrl: F_REFERENCE,
    });
    assert.equal(composed.ok, true);
    if (!composed.ok) return;

    const sent = await runOfficialAssetSlot(
      deps({ samePersonIdentityStyleUrl: F_REFERENCE }),
      compiled.draft.draftKey,
      "sig4"
    );
    assert.equal(sent.status, "generated");
    const payload = calls.at(-1);
    assert.ok(payload);
    assert.deepEqual(payload.references, [F_REFERENCE]);
    assert.equal(payload.references.includes(liveRep), false);
    assert.equal(payload.references.includes(seed.url), false);
    assert.equal(payload.primaryPrompt, composed.primaryPrompt);
    assert.equal(payload.strictFallbackPrompt, composed.strictFallbackPrompt);
    assert.equal(payload.size, "1536x1024");
    assert.equal(payload.quality, "medium");
    assert.equal(payload.model, "gpt-image-2.5-sunburst");
    assertIdentityStylePrompt(payload.primaryPrompt, compiled.draft.draftKey);
    assertIdentityStylePrompt(payload.strictFallbackPrompt, compiled.draft.draftKey);
    assert.equal(calls.length, repCalls + 2);
    assert.equal(egressAttempts.length, 0);

    const stopped = deps({ samePersonIdentityStyleUrl: F_REFERENCE });
    stopped.transport = {
      generate: async () => {
        throw new OfficialImageTransportError("provider must not be called twice", 0, false, false);
      },
    };
    const second = await runOfficialAssetSlot(stopped, compiled.draft.draftKey, "sig4");
    assert.equal(second.status, "already_generated");
  });
});
