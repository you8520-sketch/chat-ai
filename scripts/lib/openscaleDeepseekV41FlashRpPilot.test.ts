import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { MAIN_RP_USER_SELECTABLE_OPTIONS } from "@/lib/chatModels";
import {
  HISTORICAL_LIVE_DEPLOYED_ROW_PROOF_COMMIT,
  HISTORICAL_LIVE_DEPLOYED_ROW_PROOF_OWNER,
  RP_QUALITY_PRECALL_FIXTURE_IDS,
  RP_QUALITY_PRECALL_TARGET_SELECTOR,
  type RpQualityPrecallLiveProofInput,
} from "@/lib/rpQualityPrecall";
import {
  MAIN_RP_STYLE_LENGTH_GOLDEN_V1_PUBLIC,
  classifyMainRpProductionParity,
} from "@/lib/rpMainRpStyleLengthFixture";
import { UNIFIED_TIER_AIM_CHARS } from "@/lib/responseLengthConstants";
import {
  adaptOpenScalePilotBody,
  buildOpenScaleB03aDiagnosticAssembly,
  buildOpenScalePilotAssembly,
  defaultOpenScaleStyleEvalProposedFixture,
  estimateOpenScaleUsd,
  evaluateOpenScaleStyleEvalFixtureParity,
  OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY,
  OPENSCALE_B03A_DIAGNOSTIC,
  OPENSCALE_B03A_DIAGNOSTIC_FIXTURE_ID,
  OPENSCALE_CATALOG_RATES,
  OPENSCALE_KEY_ENV,
  OPENSCALE_OFFICIAL_MODEL_ID,
  OPENSCALE_PHASE2_STYLE_EVAL_SCENE_IDS,
  OPENSCALE_PILOT_SCREENING_BUDGET_USD,
  OPENSCALE_VS_CHEAPERINFERENCE_INVENTORY,
  contentFingerprintFromRequestBody,
  describeOpenScaleWireDelta,
  parseOpenScaleFlashCatalog,
  redactSecretText,
  resolveOpenScalePilotKey,
  runOpenScaleModelsPrevalidation,
  runOpenScaleRpPilot,
  screeningEstimateFromAssembly,
} from "./openscaleDeepseekV41FlashRpPilot";

const POLICY_IMPORT = "./src/lib/test/regularTestEgressPolicy.ts";
const TEST_SHA = "ab".repeat(32);
const CURRENT_DEPLOY_SHA = "cd".repeat(20);
const LIVE_PERSONA_ID = 7;

function catalogPayload() {
  return {
    data: [
      {
        id: OPENSCALE_OFFICIAL_MODEL_ID,
        is_ready: true,
        input_modalities: [
          {
            type: "text",
            pricing: [
              { type: "prompt", unit: "token", cost_usd: "0.00000006" },
              { type: "cached_prompt", unit: "token", cost_usd: "0.000000003" },
            ],
          },
        ],
        output_modalities: [
          {
            type: "text",
            streaming: true,
            supported_parameters: {
              reasoning_effort: {
                type: "enum",
                values: ["none", "low"],
              },
            },
            pricing: [{ type: "completion", unit: "token", cost_usd: "0.00000024" }],
          },
        ],
      },
    ],
  };
}

function verifiedLiveProof(
  overrides: Partial<RpQualityPrecallLiveProofInput> = {}
): RpQualityPrecallLiveProofInput {
  return {
    source: "test-injected-evidence",
    generatedAt: "2026-10-09T00:00:00.000Z",
    deployedGitSha: CURRENT_DEPLOY_SHA,
    characterId: RP_QUALITY_PRECALL_TARGET_SELECTOR.characterId,
    characterName: RP_QUALITY_PRECALL_TARGET_SELECTOR.characterName,
    personaName: RP_QUALITY_PRECALL_TARGET_SELECTOR.personaName,
    greetingSha256: TEST_SHA,
    systemPromptSha256: TEST_SHA,
    worldSha256: TEST_SHA,
    settingChunksSha256: TEST_SHA,
    personaPublicSha256: TEST_SHA,
    authoringLevel: "NORMAL",
    contentMode: "SAFE",
    personaId: LIVE_PERSONA_ID,
    ...overrides,
  };
}

function syntheticProductionBody(overrides: Record<string, unknown> = {}) {
  return {
    model: "deepseek-v4.1-flash",
    messages: [
      { role: "system", content: "synthetic-system" },
      { role: "user", content: "[채팅 시작]" },
      { role: "assistant", content: "synthetic-greeting" },
      { role: "user", content: "synthetic-turn" },
    ],
    temperature: 0.92,
    top_p: 0.92,
    stream: true,
    thinking: { type: "disabled" },
    reasoning_effort: "none",
    ...overrides,
  };
}

function restoredAbcFixture(
  overrides: Partial<ReturnType<typeof defaultOpenScaleStyleEvalProposedFixture>> = {}
) {
  const productionRequestBody = syntheticProductionBody();
  return {
    characterId: OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.characterId,
    characterName: OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.characterName,
    personaId: LIVE_PERSONA_ID,
    personaName: OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.personaName,
    sceneFamily: "rp_quality_precall_abc" as const,
    fixtureId: "A_relationship_emotion",
    liveProofInput: verifiedLiveProof(),
    expectedDeploySha: CURRENT_DEPLOY_SHA,
    productionRequestBody,
    expectedContentFingerprint: contentFingerprintFromRequestBody(productionRequestBody),
    ...overrides,
  };
}

describe("OpenScale DeepSeek V4.1 Flash isolated RP pilot", () => {
  it("never falls back to CheaperInference or other production keys", () => {
    const blocked = resolveOpenScalePilotKey({
      CHEAPER_INFERENCE_API_KEY: "ci-prod",
      CHEAPER_INFERENCE_BENCHMARK_API_KEY: "ci-bench",
      OPENROUTER_API_KEY: "or-prod",
      OPENAI_API_KEY: "oai-prod",
    });
    assert.equal(blocked.ok, false);
    if (blocked.ok) throw new Error("expected blocked");
    assert.equal(blocked.reason, "openscale_key_missing");
    const ok = resolveOpenScalePilotKey({ [OPENSCALE_KEY_ENV]: "openscale-only" });
    assert.equal(ok.ok, true);
  });

  it("does not add OpenScale to the production model picker", () => {
    assert.ok(
      MAIN_RP_USER_SELECTABLE_OPTIONS.every((option) => option.provider !== ("openscale" as string))
    );
    assert.ok(
      MAIN_RP_USER_SELECTABLE_OPTIONS.some((option) => option.id === "deepseek-v4.1-flash")
    );
  });

  it("parses the official catalog model id and token prices", () => {
    const catalog = parseOpenScaleFlashCatalog(catalogPayload());
    assert.equal(catalog.modelId, OPENSCALE_OFFICIAL_MODEL_ID);
    assert.equal(catalog.inputUsdPerMillion, 0.06);
    assert.equal(catalog.cachedInputUsdPerMillion, 0.003);
    assert.equal(catalog.outputUsdPerMillion, 0.24);
    assert.equal(catalog.streaming, true);
    assert.deepEqual(catalog.reasoningEffortValues, ["none", "low"]);
  });

  it("keeps production sampling and omits a forced max_tokens ceiling on the adapter", () => {
    const remapped = adaptOpenScalePilotBody({
      model: "deepseek-v4.1-flash",
      temperature: 0.92,
      top_p: 0.92,
      stream: true,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: "테스트" }],
    });
    assert.equal(remapped.model, OPENSCALE_OFFICIAL_MODEL_ID);
    assert.equal(remapped.stream, true);
    assert.equal(remapped.max_tokens, undefined);
    assert.equal(remapped.temperature, 0.92);
    assert.equal(remapped.top_p, 0.92);
    assert.equal(remapped.reasoning_effort, "none");
    assert.equal("thinking" in remapped, false);
  });

  it("does not treat a screening estimate as an invoice cap", () => {
    const usd = estimateOpenScaleUsd({
      promptTokens: 10_000,
      cachedTokens: 2_000,
      outputTokens: 4_000,
      rates: OPENSCALE_CATALOG_RATES,
    });
    assert.ok(usd < 0.01);
    assert.match(
      screeningEstimateFromAssembly(1000).note,
      /not an invoice/i
    );
  });

  it("redacts secrets from stored text", () => {
    assert.equal(
      redactSecretText("Bearer secret-key and secret-key", ["secret-key"]),
      "Bearer [REDACTED] and [REDACTED]"
    );
  });

  it("treats GET /v1/models as zero inference POSTs", async () => {
    const result = await runOpenScaleModelsPrevalidation({
      env: { [OPENSCALE_KEY_ENV]: "synthetic-os" },
      fetchImpl: async () =>
        new Response(JSON.stringify(catalogPayload()), { status: 200 }),
    });
    assert.equal(result.status, "PREVALIDATION_ONLY");
    assert.equal(result.providerInferencePosts, 0);
    assert.equal(result.catalog?.modelId, OPENSCALE_OFFICIAL_MODEL_ID);
  });

  it("strips OPENSCALE_KEY in the regular-test egress policy", () => {
    const policy = readFileSync(POLICY_IMPORT, "utf8");
    assert.match(policy, /delete process\.env\.OPENSCALE_KEY/);
    const out = execFileSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "--import",
        POLICY_IMPORT,
        "-e",
        "console.log(JSON.stringify({ os: process.env.OPENSCALE_KEY ?? null, ci: process.env.CHEAPER_INFERENCE_API_KEY ?? null }))",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          OPENSCALE_KEY: "must-be-stripped",
          CHEAPER_INFERENCE_API_KEY: "must-be-stripped",
        },
        encoding: "utf8",
      }
    );
    const seen = JSON.parse(out.trim()) as { os: string | null; ci: string | null };
    assert.equal(seen.os, null);
    assert.equal(seen.ci, null);
  });

  it("preserves production prompt text while remapping only the wire model on the diagnostic assembly", () => {
    const assembly = buildOpenScaleB03aDiagnosticAssembly();
    const remapped = adaptOpenScalePilotBody(assembly.productionRequestBody);
    const original = assembly.productionRequestBody.messages as Array<{
      role: string;
      content: unknown;
    }>;
    const remappedMessages = remapped.messages as Array<{ role: string; content: string }>;
    assert.equal(assembly.fixtureId, OPENSCALE_B03A_DIAGNOSTIC_FIXTURE_ID);
    assert.equal(assembly.comparableToApprovedStyleEval, false);
    assert.equal(remappedMessages.length, original.length);
    assert.equal(remapped.model, OPENSCALE_OFFICIAL_MODEL_ID);
    assert.notEqual(assembly.productionRequestBody.model, OPENSCALE_OFFICIAL_MODEL_ID);
    assert.ok(remappedMessages.some((message) => message.content.includes("한서린")));
    assert.ok(remappedMessages.some((message) => message.content.includes("엘리베이터")));
  });
});

describe("OpenScale A/B/C PRECALL fixture parity gate", () => {
  it("binds the current baseline to 라이크 18 / 렌 / A/B/C, not Q1-Q9", () => {
    assert.equal(OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.characterId, 18);
    assert.equal(OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.characterName, "라이크");
    assert.equal(OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.personaName, "렌");
    assert.equal(OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.personaIdOwner, "verified_live_proof_only");
    assert.equal(OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.sceneFamily, "rp_quality_precall_abc");
    assert.equal(OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.distinctFromPhase2Q1Q9, true);
    assert.equal(
      OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.productionParityOwner,
      "src/lib/rpMainRpStyleLengthFixture.classifyMainRpProductionParity"
    );
    assert.equal(OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.softAimChars, UNIFIED_TIER_AIM_CHARS);
    assert.equal(OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.lengthOwner, "UNIFIED_TIER_AIM_CHARS");
    assert.deepEqual(
      [...OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.fixtureIds],
      [...RP_QUALITY_PRECALL_FIXTURE_IDS]
    );
    assert.notDeepEqual(
      [...OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.fixtureIds],
      [...OPENSCALE_PHASE2_STYLE_EVAL_SCENE_IDS]
    );
    assert.equal(OPENSCALE_B03A_DIAGNOSTIC.comparableToApprovedStyleEval, false);
  });

  it("fails closed on the default runner because live assembly is not restored", async () => {
    let posts = 0;
    const result = await runOpenScaleRpPilot({
      env: { [OPENSCALE_KEY_ENV]: "synthetic-os", OPENSCALE_RP_PILOT: "1" },
      allowLivePost: true,
      fetchImpl: async (_url, init) => {
        if (String(init?.method ?? "GET").toUpperCase() === "POST") posts += 1;
        return new Response(JSON.stringify(catalogPayload()), { status: 200 });
      },
    });
    assert.equal(result.status, "FIXTURE_PARITY_FAIL");
    assert.equal(result.precallReady, false);
    assert.equal(result.providerInferencePosts, 0);
    assert.equal(result.cheaperInferencePosts, 0);
    assert.equal(posts, 0);
    const parity = result.parity as ReturnType<typeof evaluateOpenScaleStyleEvalFixtureParity>;
    assert.ok(parity.reasons.includes("live_proof_not_provided"));
    assert.ok(parity.reasons.includes("assembly_not_provided"));
    assert.ok(parity.reasons.includes("expected_content_fingerprint_missing"));
    assert.ok(parity.reasons.includes("sceneId_missing"));
    assert.equal(parity.proposed.sceneFamily, "rp_quality_precall_abc");
    assert.equal(parity.productionParity.status, "NOT_COMPARABLE");
    assert.equal(parity.qualityScoreEligible, false);
    assert.equal(result.qualityScoreEligible, false);
    assert.equal(result.productionParityStatus, "NOT_COMPARABLE");
  });

  it("fails closed when the proposed characterId is wrong", () => {
    const parity = evaluateOpenScaleStyleEvalFixtureParity(restoredAbcFixture({ characterId: 99 }));
    assert.equal(parity.status, "FIXTURE_PARITY_FAIL");
    assert.ok(parity.reasons.includes("characterId_mismatch"));
  });

  it("fails closed when the proposed personaId disagrees with live proof", () => {
    const parity = evaluateOpenScaleStyleEvalFixtureParity(restoredAbcFixture({ personaId: 99 }));
    assert.equal(parity.status, "FIXTURE_PARITY_FAIL");
    assert.ok(parity.reasons.includes("personaId_mismatch"));
    assert.equal(parity.confirmedPersonaId, LIVE_PERSONA_ID);
  });

  it("fails closed when B03a is selected", () => {
    const b03a = evaluateOpenScaleStyleEvalFixtureParity(
      restoredAbcFixture({
        sceneId: OPENSCALE_B03A_DIAGNOSTIC_FIXTURE_ID,
        fixtureId: OPENSCALE_B03A_DIAGNOSTIC_FIXTURE_ID,
        sceneFamily: "scene_policy_benchmark",
        characterName: "한서린",
        personaName: "민",
      })
    );
    assert.equal(b03a.status, "FIXTURE_PARITY_FAIL");
    assert.ok(b03a.reasons.includes("b03a_not_comparable"));
  });

  it("fails closed when Q1-Q9 is mixed into the A/B/C baseline", () => {
    const q = evaluateOpenScaleStyleEvalFixtureParity(
      restoredAbcFixture({
        sceneFamily: "phase2_q1_q9",
        fixtureId: "Q1-quiet",
        sceneId: "Q1-quiet",
      })
    );
    assert.equal(q.status, "FIXTURE_PARITY_FAIL");
    assert.ok(q.reasons.includes("q1_q9_is_not_abc_baseline"));
  });

  it("fails closed on an empty expected fingerprint", () => {
    const parity = evaluateOpenScaleStyleEvalFixtureParity(
      restoredAbcFixture({ expectedContentFingerprint: "" })
    );
    assert.equal(parity.status, "FIXTURE_PARITY_FAIL");
    assert.ok(parity.reasons.includes("expected_content_fingerprint_missing"));
  });

  it("ignores caller-supplied fingerprints and boolean restore flags", () => {
    const parity = evaluateOpenScaleStyleEvalFixtureParity(
      restoredAbcFixture({
        promptFingerprint: TEST_SHA,
        expectedPromptFingerprint: TEST_SHA,
        originalFixtureJsonRestored: true,
        currentSettingsRestored: true,
      })
    );
    assert.equal(parity.status, "FIXTURE_PARITY_FAIL");
    assert.ok(parity.reasons.includes("caller_fingerprint_ignored"));
    assert.ok(parity.reasons.includes("boolean_restore_flag_ignored"));
  });

  it("fails closed on a stale historical Railway proof", () => {
    const historical = evaluateOpenScaleStyleEvalFixtureParity(
      restoredAbcFixture({
        liveProofInput: verifiedLiveProof({
          source: HISTORICAL_LIVE_DEPLOYED_ROW_PROOF_OWNER,
          deployedGitSha: HISTORICAL_LIVE_DEPLOYED_ROW_PROOF_COMMIT,
        }),
        expectedDeploySha: HISTORICAL_LIVE_DEPLOYED_ROW_PROOF_COMMIT,
      })
    );
    assert.equal(historical.status, "FIXTURE_PARITY_FAIL");
    assert.ok(historical.reasons.includes("live_proof_not_verified"));
    assert.ok(
      historical.liveProofReasons.includes("historical_LIVE_DEPLOYED_ROW_PROOF_cannot_auto_satisfy")
    );
  });

  it("fails closed when the expected content fingerprint does not match assembled messages", () => {
    const parity = evaluateOpenScaleStyleEvalFixtureParity(
      restoredAbcFixture({ expectedContentFingerprint: TEST_SHA })
    );
    assert.equal(parity.status, "FIXTURE_PARITY_FAIL");
    assert.ok(parity.reasons.includes("content_fingerprint_mismatch"));
  });

  it("fails closed when max_tokens is introduced", () => {
    const body = syntheticProductionBody({ max_tokens: 800 });
    const parity = evaluateOpenScaleStyleEvalFixtureParity(
      restoredAbcFixture({
        productionRequestBody: body,
        expectedContentFingerprint: contentFingerprintFromRequestBody(body),
      })
    );
    assert.equal(parity.status, "FIXTURE_PARITY_FAIL");
    assert.ok(parity.reasons.includes("max_tokens_present"));
  });

  it("rejects provider-wire changes outside the allowlist", () => {
    const production = syntheticProductionBody();
    const candidate = adaptOpenScalePilotBody(production);
    candidate.temperature = 0.1;
    const delta = describeOpenScaleWireDelta(production, candidate);
    assert.equal(delta.samplingMatch, false);
    assert.ok(delta.unauthorized.includes("temperature"));
  });

  it("passes only when live proof, A/B/C assembly, and computed fingerprints match", () => {
    const parity = evaluateOpenScaleStyleEvalFixtureParity(restoredAbcFixture());
    assert.equal(parity.status, "FIXTURE_PARITY_PASS");
    assert.equal(parity.precallReady, true);
    assert.equal(parity.classification, "PRECALL_READY");
    assert.equal(parity.confirmedPersonaId, LIVE_PERSONA_ID);
    assert.deepEqual(parity.reasons, []);
    assert.equal(parity.productionParity.status, "NOT_COMPARABLE");
    assert.equal(parity.qualityScoreEligible, false);
    assert.ok(parity.productionParity.reasons.includes("synthetic_not_quality_score"));
    assert.equal(parity.productionParity.softAimChars, UNIFIED_TIER_AIM_CHARS);
  });

  it("never POSTs even when A/B/C parity is synthetically restored", async () => {
    let posts = 0;
    const result = await runOpenScaleRpPilot({
      env: { [OPENSCALE_KEY_ENV]: "synthetic-os", OPENSCALE_RP_PILOT: "1" },
      allowLivePost: true,
      proposedFixture: restoredAbcFixture(),
      fetchImpl: async (_url, init) => {
        if (String(init?.method ?? "GET").toUpperCase() === "POST") posts += 1;
        return new Response(JSON.stringify(catalogPayload()), { status: 200 });
      },
    });
    assert.equal(result.status, "FIXTURE_PARITY_PASS");
    assert.equal(result.precallReady, true);
    assert.equal(result.providerInferencePosts, 0);
    assert.equal(result.stopReason, "PRECALL_READY_inference_not_authorized_this_turn");
    assert.equal(result.qualityScoreEligible, false);
    assert.equal(result.productionParityStatus, "NOT_COMPARABLE");
    assert.equal(posts, 0);
  });

  it("keeps B03a on the diagnostic path only", () => {
    assert.throws(() => buildOpenScalePilotAssembly(), /FIXTURE_PARITY_FAIL/);
    const diagnostic = buildOpenScaleB03aDiagnosticAssembly();
    const defaultProposed = defaultOpenScaleStyleEvalProposedFixture();
    assert.equal(diagnostic.fixtureId, OPENSCALE_B03A_DIAGNOSTIC_FIXTURE_ID);
    assert.equal(diagnostic.comparableToApprovedStyleEval, false);
    assert.equal(defaultProposed.sceneFamily, "rp_quality_precall_abc");
    assert.notEqual(defaultProposed.characterName, diagnostic.characterName);
  });
});

describe("OpenScale consumes the shared production parity owner", () => {
  it("does not invent a second length owner or eval-only style prompt", () => {
    assert.equal(OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.softAimChars, UNIFIED_TIER_AIM_CHARS);
    assert.ok(
      OPENSCALE_VS_CHEAPERINFERENCE_INVENTORY.fields.some(
        (field) => field.field === "thinking" && field.classification === "semantic_unconfirmed"
      )
    );
    assert.ok(
      OPENSCALE_VS_CHEAPERINFERENCE_INVENTORY.fields.some(
        (field) => field.field === "reasoning_effort" && field.classification === "semantic_unconfirmed"
      )
    );
  });

  it("keeps golden v1 stale against current origin/main SUCCESS and never scores it", () => {
    const parity = evaluateOpenScaleStyleEvalFixtureParity(
      restoredAbcFixture({
        useGoldenV1Expected: true,
        capturedDeploySha: MAIN_RP_STYLE_LENGTH_GOLDEN_V1_PUBLIC.deployedGitSha,
        currentProductionSuccessSha: "4d83c100666878cca747408ae72a18f3360310ac",
      })
    );
    assert.equal(parity.status, "FIXTURE_PARITY_PASS");
    assert.equal(parity.precallReady, true);
    assert.equal(parity.productionParity.status, "STALE_PRODUCTION_SNAPSHOT");
    assert.equal(parity.qualityScoreEligible, false);
    assert.equal(parity.goldenV1Stale, true);
  });

  it("does not accept forged CURRENT_LIVE plus copied hash pairs as VERIFIED", () => {
    const parity = evaluateOpenScaleStyleEvalFixtureParity(
      restoredAbcFixture({
        currentLiveVerified: true,
        currentProductionSuccessSha: TEST_SHA.slice(0, 40),
        assemblySourceSha: TEST_SHA.slice(0, 40),
        capturedDeploySha: TEST_SHA.slice(0, 40),
        thinkingSemanticEquivalent: true,
        reasoningSemanticEquivalent: true,
        identityHashes: {
          greetingSha256: TEST_SHA,
          systemPromptSha256: TEST_SHA,
          worldSha256: TEST_SHA,
          settingChunksSha256: TEST_SHA,
          personaPublicSha256: TEST_SHA,
        },
        expectedIdentityHashes: {
          greetingSha256: TEST_SHA,
          systemPromptSha256: TEST_SHA,
          worldSha256: TEST_SHA,
          settingChunksSha256: TEST_SHA,
          personaPublicSha256: TEST_SHA,
        },
        finalWireFingerprint: TEST_SHA,
        expectedFinalWireFingerprint: TEST_SHA,
        requestBodyFingerprint: TEST_SHA,
        expectedRequestBodyFingerprint: TEST_SHA,
      })
    );
    assert.notEqual(parity.productionParity.status, "PRODUCTION_PARITY_VERIFIED");
    assert.equal(parity.qualityScoreEligible, false);
    assert.ok(parity.productionParity.reasons.includes("current_live_verified_boolean_ignored"));
  });

  it("routes max_tokens through the shared classifier without scoring", () => {
    const body = syntheticProductionBody({ max_tokens: 800 });
    const maxTokens = evaluateOpenScaleStyleEvalFixtureParity(
      restoredAbcFixture({
        productionRequestBody: body,
        expectedContentFingerprint: contentFingerprintFromRequestBody(body),
      })
    );
    assert.equal(maxTokens.status, "FIXTURE_PARITY_FAIL");
    assert.ok(maxTokens.reasons.includes("max_tokens_present"));
    assert.ok(maxTokens.productionParity.reasons.includes("max_tokens_present"));
    assert.equal(maxTokens.qualityScoreEligible, false);
    const shared = classifyMainRpProductionParity({
      evidenceKind: "CURRENT_LIVE",
      currentLiveVerified: true,
      characterId: 18,
      characterName: "라이크",
      personaId: LIVE_PERSONA_ID,
      personaName: "렌",
      fixtureId: "A_relationship_emotion",
      identityHashes: {
        greetingSha256: TEST_SHA,
        systemPromptSha256: TEST_SHA,
        worldSha256: TEST_SHA,
        settingChunksSha256: TEST_SHA,
        personaPublicSha256: TEST_SHA,
      },
      expectedIdentityHashes: {
        greetingSha256: TEST_SHA,
        systemPromptSha256: TEST_SHA,
        worldSha256: TEST_SHA,
        settingChunksSha256: TEST_SHA,
        personaPublicSha256: TEST_SHA,
      },
      thinkingSemanticEquivalent: true,
      reasoningSemanticEquivalent: true,
    });
    assert.notEqual(shared.status, "PRODUCTION_PARITY_VERIFIED");
    assert.equal(shared.qualityScoreEligible, false);
  });
});
