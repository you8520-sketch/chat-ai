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
    personaId: OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.personaId,
    ...overrides,
  };
}

function restoredStyleEvalFixture(
  overrides: Partial<ReturnType<typeof defaultOpenScaleStyleEvalProposedFixture>> = {}
) {
  return {
    characterId: OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.characterId,
    characterName: OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.characterName,
    personaId: OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.personaId,
    personaName: OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.personaName,
    sceneFamily: "phase2_q1_q9" as const,
    sceneId: "Q1-quiet",
    originalFixtureJsonRestored: true,
    currentSettingsRestored: true,
    liveProofInput: verifiedLiveProof(),
    expectedDeploySha: CURRENT_DEPLOY_SHA,
    promptFingerprint: TEST_SHA,
    expectedPromptFingerprint: TEST_SHA,
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

describe("OpenScale style-eval fixture parity gate", () => {
  it("binds the approved identity to 라이크 18 / 렌 1 and Q1-Q9", () => {
    assert.equal(OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.characterId, 18);
    assert.equal(OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.characterName, "라이크");
    assert.equal(OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.personaId, 1);
    assert.equal(OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.personaName, "렌");
    assert.equal(OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.personaGender, "male");
    assert.deepEqual(
      [...OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.originalSceneIds],
      [...OPENSCALE_PHASE2_STYLE_EVAL_SCENE_IDS]
    );
    assert.deepEqual(
      [...OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.currentMainPrecallFixtureIds],
      [...RP_QUALITY_PRECALL_FIXTURE_IDS]
    );
    assert.equal(OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.originalFixtureJsonInThisTree, false);
    assert.equal(OPENSCALE_B03A_DIAGNOSTIC.comparableToApprovedStyleEval, false);
    assert.equal(OPENSCALE_B03A_DIAGNOSTIC.outputChars, 945);
  });

  it("fails closed on the default runner because Q1-Q9 and live settings are unrestored", async () => {
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
    assert.equal(result.providerInferencePosts, 0);
    assert.equal(result.cheaperInferencePosts, 0);
    assert.equal(posts, 0);
    const parity = result.parity as ReturnType<typeof evaluateOpenScaleStyleEvalFixtureParity>;
    assert.ok(parity.reasons.includes("original_q1_q9_fixture_json_unrestored"));
    assert.ok(parity.reasons.includes("current_settings_unrestored"));
    assert.ok(parity.reasons.includes("live_proof_not_provided"));
    assert.ok(parity.reasons.includes("sceneId_missing"));
    assert.ok(parity.reasons.includes("replacement_data_forbidden"));
    assert.notEqual(parity.proposed.sceneId, OPENSCALE_B03A_DIAGNOSTIC_FIXTURE_ID);
  });

  it("fails closed when the proposed characterId is wrong", () => {
    const parity = evaluateOpenScaleStyleEvalFixtureParity(
      restoredStyleEvalFixture({ characterId: 99 })
    );
    assert.equal(parity.status, "FIXTURE_PARITY_FAIL");
    assert.ok(parity.reasons.includes("characterId_mismatch"));
    assert.equal(parity.comparisons.characterId, false);
  });

  it("fails closed when the proposed personaId is wrong", () => {
    const parity = evaluateOpenScaleStyleEvalFixtureParity(
      restoredStyleEvalFixture({ personaId: 99 })
    );
    assert.equal(parity.status, "FIXTURE_PARITY_FAIL");
    assert.ok(parity.reasons.includes("personaId_mismatch"));
    assert.equal(parity.comparisons.personaId, false);
  });

  it("fails closed when B03a or another unapproved sceneId is selected", () => {
    const b03a = evaluateOpenScaleStyleEvalFixtureParity(
      restoredStyleEvalFixture({
        sceneId: OPENSCALE_B03A_DIAGNOSTIC_FIXTURE_ID,
        sceneFamily: "scene_policy_benchmark",
        characterName: "한서린",
        personaName: "민",
      })
    );
    assert.equal(b03a.status, "FIXTURE_PARITY_FAIL");
    assert.ok(b03a.reasons.includes("b03a_not_comparable"));
    assert.ok(b03a.reasons.includes("sceneId_rejected"));

    const unknown = evaluateOpenScaleStyleEvalFixtureParity(
      restoredStyleEvalFixture({ sceneId: "synthetic-wrong-scene" })
    );
    assert.equal(unknown.status, "FIXTURE_PARITY_FAIL");
    assert.ok(unknown.reasons.includes("sceneId_not_in_phase2_q1_q9"));
  });

  it("fails closed when the prompt fingerprint does not match", () => {
    const parity = evaluateOpenScaleStyleEvalFixtureParity(
      restoredStyleEvalFixture({
        promptFingerprint: "ff".repeat(32),
        expectedPromptFingerprint: TEST_SHA,
      })
    );
    assert.equal(parity.status, "FIXTURE_PARITY_FAIL");
    assert.ok(parity.reasons.includes("prompt_fingerprint_mismatch"));
    assert.equal(parity.comparisons.promptFingerprint, false);
  });

  it("does not treat A/B/C or the historical dump as the original Q1-Q9 fixture", () => {
    const abc = evaluateOpenScaleStyleEvalFixtureParity(
      restoredStyleEvalFixture({
        sceneFamily: "rp_quality_precall_abc",
        sceneId: "A_relationship_emotion",
      })
    );
    assert.equal(abc.status, "FIXTURE_PARITY_FAIL");
    assert.ok(abc.reasons.includes("requested_family_is_not_original_style_eval"));

    const historical = evaluateOpenScaleStyleEvalFixtureParity(
      restoredStyleEvalFixture({
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

  it("passes the predicate only when Q1-Q9 plus live proof plus fingerprint are restored", () => {
    const parity = evaluateOpenScaleStyleEvalFixtureParity(restoredStyleEvalFixture());
    assert.equal(parity.status, "FIXTURE_PARITY_PASS");
    assert.deepEqual(parity.reasons, []);
  });

  it("never POSTs even when the predicate is synthetically restored", async () => {
    let posts = 0;
    const result = await runOpenScaleRpPilot({
      env: { [OPENSCALE_KEY_ENV]: "synthetic-os", OPENSCALE_RP_PILOT: "1" },
      allowLivePost: true,
      proposedFixture: restoredStyleEvalFixture(),
      fetchImpl: async (_url, init) => {
        if (String(init?.method ?? "GET").toUpperCase() === "POST") posts += 1;
        return new Response(JSON.stringify(catalogPayload()), { status: 200 });
      },
    });
    assert.equal(result.status, "FIXTURE_PARITY_PASS");
    assert.equal(result.providerInferencePosts, 0);
    assert.equal(result.stopReason, "parity_pass_inference_not_authorized_this_turn");
    assert.equal(posts, 0);
  });

  it("refuses the old default assembly helper so B03a cannot be selected silently", () => {
    assert.throws(() => buildOpenScalePilotAssembly(), /FIXTURE_PARITY_FAIL/);
    const diagnostic = buildOpenScaleB03aDiagnosticAssembly();
    const defaultProposed = defaultOpenScaleStyleEvalProposedFixture();
    assert.equal(diagnostic.fixtureId, OPENSCALE_B03A_DIAGNOSTIC_FIXTURE_ID);
    assert.notEqual(defaultProposed.sceneId, diagnostic.fixtureId);
    assert.notEqual(defaultProposed.characterName, diagnostic.characterName);
    assert.notEqual(defaultProposed.personaName, diagnostic.personaName);
  });
});
