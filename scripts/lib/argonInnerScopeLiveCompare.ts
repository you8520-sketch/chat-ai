/**
 * Isolated Argon NORMAL inner-boundary compare.
 * Reuses the PRECALL production row loader and assemblePrecallFinalWire.
 * One OpenRouter POST per process. No retry. Argon is not added to the benchmark roster.
 *
 * Stimulus is the approved A canon (quiet_window_safe), not chat 801's typo input.
 */
import "./server-only-mock";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { applyOverseasCardFee } from "@/lib/billingFxPolicy";
import {
  GEMINI_4_ARGON_MODEL,
  OPENROUTER_GEMINI_4_ARGON_MODEL,
  selectedAIProvider,
} from "@/lib/chatModels";
import {
  buildOpenRouterHeaders,
  OPENROUTER_CHAT_COMPLETIONS_URL,
  resolveMainRpPrimaryWireModelId,
} from "@/lib/openRouterConfig";
import {
  createOpenAiCompatibleSseEvidence,
  decodeOpenAiCompatibleSseResponse,
} from "@/lib/openAiCompatibleSseDecoder";
import { parseOpenRouterUsage } from "@/lib/openRouterUsage";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";
import { estimateTokensFromCharCount } from "@/lib/tokenEstimate";
import { experimentSecretUsesProductionKey } from "@/lib/rpQualityPaidRunner";
import {
  RP_QUALITY_PAID_OPENROUTER_KEY_ENV,
  readPaidRunnerLiveInferenceKeys,
} from "@/lib/rpQualityPaidRunnerLiveTransport";
import {
  rpQualityPrecallBenchmarkModels,
  type RpQualityPrecallModelPlan,
} from "@/lib/rpQualityPrecall";
import { COMMON_PROSE_BODY_CUE_REVIEW_SCENE_SEEDS } from "./rpModelQualificationFixture";
import { loadPrecallProductionRows } from "./rpQualityPrecallProductionRows";
import { assemblePrecallFinalWireWithSealedRequests } from "./rpQualityPrecallFinalWire";

const REQUIRED_USER = `OOC: 임무가 끝난 밤. 둘만 태형의 본부 숙소 창가에 있다. 다른 인물은 없다. 둘 다 성인이다. 여기서부터 장면 계속.

렌은 창틀에서 한 걸음 떨어져 유리 너머의 불빛만 본다. "오늘은 그냥 이렇게 있자."`;

const SHARED_INNER =
  "[B]의 비공개 속마음·내면 독백·숨은 욕망을 객관적 사실로 쓰지 않는다.";
const ARGON_INNER =
  "[B]의 비공개 속마음·내면 독백·감정·호불호·의도·욕망을 서술자가 객관적 사실로 확정하지 않는다. 표정·시선·행동에서 그 속뜻을 해석할 때는 [A]의 관찰·추측임을 구분한다.";
const IRREVERSIBLE =
  "[B]의 사망·영구 상실·정체성·장기 관계·소속 같은 불가역 정본 변경도 대신 확정하지 않는다.";
const DIALOGUE_PERMISSION =
  "[B]의 직접 대사와 외부에서 관찰 가능한 중요한 행동을 페르소나에 맞게 공동 서술할 수 있다.";
const OWNER_TITLE = "[USER AUTHORING — EFFECTIVE COAUTHOR POLICY]";
const INNER_PLACEHOLDER = "[[INNER_PROHIBITION]]";
const CHAT_801_TYPO_MARKERS = ["임가 끝난", "이게 있자", "창가 있다"];

const COST_CEILING_KRW = 1000;
const OUTPUT_TOKEN_ASSUMPTION = 8000;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function fail(code: string, extra: Record<string, unknown> = {}): never {
  process.stdout.write(`${JSON.stringify({ ok: false, code, providerPosts: 0, ...extra })}\n`);
  process.exit(2);
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && "text" in part
        ? String((part as { text: unknown }).text ?? "")
        : ""
    )
    .join("");
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function normalizeBody(body: unknown): string {
  let json = JSON.stringify(body);
  json = json.split(ARGON_INNER).join(INNER_PLACEHOLDER);
  json = json.split(SHARED_INNER).join(INNER_PLACEHOLDER);
  return json;
}

function codeSha(): string {
  return execSync("git rev-parse HEAD", { cwd: process.cwd(), encoding: "utf8" }).trim();
}

function argonPlan(): RpQualityPrecallModelPlan {
  const wireModel = resolveMainRpPrimaryWireModelId(GEMINI_4_ARGON_MODEL);
  return {
    canonicalId: GEMINI_4_ARGON_MODEL,
    displayLabel: "Gemini 4 Argon",
    provider: selectedAIProvider(GEMINI_4_ARGON_MODEL),
    wireModel,
  } as RpQualityPrecallModelPlan;
}

export async function runArgonInnerScopeLiveCompare(): Promise<void> {
  const label = process.env.LABEL?.trim() || "";
  if (label !== "before" && label !== "after") fail("LABEL_REQUIRED");
  const dbPath = process.env.ARGON_SNAPSHOT_DB?.trim() || "";
  if (!dbPath || !fs.existsSync(dbPath)) fail("SNAPSHOT_DB_MISSING");
  const post = process.env.ARGON_POST === "1";
  const outDir = path.join("/opt/cursor/artifacts/argon-inner-compare", label);
  fs.mkdirSync(outDir, { recursive: true });
  const assistantPath = path.join(outDir, "assistant.txt");
  if (post && fs.existsSync(assistantPath)) fail("LABEL_ALREADY_POSTED", { label });

  const seed = COMMON_PROSE_BODY_CUE_REVIEW_SCENE_SEEDS.find((row) => row.id === "quiet_window_safe");
  if (!seed || seed.currentUserMessage !== REQUIRED_USER) fail("STIMULUS_DRIFT");

  const deployedGitSha =
    process.env.ARGON_DEPLOY_SHA?.trim() ||
    "e808831fe98d6be1a0e44e0d21e4b981abe4427c";
  const loaded = loadPrecallProductionRows({
    dbPath,
    deployedGitSha,
    env: process.env,
  });
  if (loaded.proof.characterId !== 18 || loaded.proof.characterName !== "라이크") {
    fail("CHARACTER_MISMATCH");
  }
  if (loaded.proof.personaId !== 1 || loaded.proof.personaName !== "렌") {
    fail("PERSONA_MISMATCH");
  }
  if (loaded.proof.authoringLevel !== "NORMAL" || loaded.proof.contentMode !== "SAFE") {
    fail("SETTING_MISMATCH", {
      authoringLevel: loaded.proof.authoringLevel,
      contentMode: loaded.proof.contentMode,
    });
  }

  const plan = argonPlan();
  if (plan.wireModel !== OPENROUTER_GEMINI_4_ARGON_MODEL) {
    fail("ARGON_WIRE_MISMATCH", { wireModel: plan.wireModel });
  }
  if (plan.canonicalId !== GEMINI_4_ARGON_MODEL) fail("ARGON_CANONICAL_MISMATCH");

  const assembled = assemblePrecallFinalWireWithSealedRequests(loaded.rows, [plan]);
  const argon = assembled.sealedRequests.find(
    (request) => request.fixtureId === "A_relationship_emotion"
  );
  if (!argon) fail("ARGON_A_REQUEST_MISSING");
  if (argon.wireModel !== OPENROUTER_GEMINI_4_ARGON_MODEL) {
    fail("ARGON_WIRE_MISMATCH", { wireModel: argon.wireModel });
  }
  if (argon.provider !== "openrouter") fail("PROVIDER_MISMATCH", { provider: argon.provider });
  if (argon.endpoint !== OPENROUTER_CHAT_COMPLETIONS_URL) fail("ENDPOINT_MISMATCH");

  const body = argon.requestBody;
  const bodyJson = JSON.stringify(body);
  const flatWire = ((body as { messages?: Array<{ role?: string; content?: unknown }> }).messages ?? [])
    .map((message) => flattenContent(message.content))
    .join("\n");
  const systemFlat = ((body as { messages?: Array<{ role?: string; content?: unknown }> }).messages ?? [])
    .filter((message) => message.role === "system")
    .map((message) => flattenContent(message.content))
    .join("\n");
  const lastUserFlat = flattenContent(
    [...((body as { messages?: Array<{ role?: string; content?: unknown }> }).messages ?? [])]
      .reverse()
      .find((message) => message.role === "user")?.content
  );
  if (!lastUserFlat.includes(REQUIRED_USER)) fail("STIMULUS_NOT_IN_WIRE");
  for (const marker of CHAT_801_TYPO_MARKERS) {
    if (flatWire.includes(marker)) fail("CHAT_801_TYPO_PRESENT", { marker });
  }
  if (!flatWire.includes(DIALOGUE_PERMISSION) || !flatWire.includes(IRREVERSIBLE)) {
    fail("PERMISSION_LINE_MISSING");
  }
  if (flatWire.includes("[AUTO PROGRESSION")) fail("AUTO_PROGRESSION_PRESENT");
  const argonCount = count(flatWire, ARGON_INNER);
  const sharedCount = count(flatWire, SHARED_INNER);
  if (argonCount + sharedCount !== 1) {
    fail("INNER_SENTENCE_COUNT", { argonCount, sharedCount });
  }
  if (count(systemFlat, OWNER_TITLE) !== 1) {
    fail("OWNER_COUNT", { ownerCount: count(systemFlat, OWNER_TITLE) });
  }
  const expectedInner = label === "after" ? "argon" : "shared";
  const actualInner = argonCount === 1 ? "argon" : "shared";
  if (process.env.ARGON_EXPECT_INNER === "shared" && actualInner !== "shared") {
    fail("UNEXPECTED_INNER_SENTENCE", { actualInner });
  }
  if (process.env.ARGON_EXPECT_INNER === "argon" && actualInner !== "argon") {
    fail("UNEXPECTED_INNER_SENTENCE", { actualInner });
  }

  const benchmark = assemblePrecallFinalWireWithSealedRequests(
    loaded.rows,
    rpQualityPrecallBenchmarkModels()
  );
  const benchmarkFingerprints = benchmark.sealedRequests
    .filter((request) => request.fixtureId === "A_relationship_emotion")
    .map((request) => ({
      canonicalId: request.canonicalId,
      provider: request.provider,
      wireModel: request.wireModel,
      requestBodyFingerprint: request.requestBodyFingerprint,
      normalizedFingerprint: sha256(normalizeBody(request.requestBody)),
    }));

  const requestModel = (body as { model?: unknown }).model;
  const fingerprints = {
    codeSha: codeSha(),
    label,
    experiment: "argon-normal-inner-boundary",
    stimulus: "approved A canon quiet_window_safe",
    chat801TypoInput: false,
    characterId: loaded.proof.characterId,
    personaId: loaded.proof.personaId,
    greetingSha256: loaded.proof.greetingSha256,
    authoringLevel: loaded.proof.authoringLevel,
    contentMode: loaded.proof.contentMode,
    autoProgression: false,
    stimulusSha256: sha256(REQUIRED_USER),
    lastUserSha256: sha256(lastUserFlat),
    requestModel,
    wireModel: argon.wireModel,
    provider: argon.provider,
    innerSentence: actualInner,
    expectedInner,
    argonInnerCount: argonCount,
    sharedInnerCount: sharedCount,
    systemOwnerCount: count(systemFlat, OWNER_TITLE),
    requestBodyFingerprint: argon.requestBodyFingerprint,
    normalizedFingerprint: sha256(normalizeBody(body)),
    benchmarkA: benchmarkFingerprints,
  };
  fs.writeFileSync(path.join(outDir, "fingerprints.json"), JSON.stringify(fingerprints, null, 2));

  const rates = resolveOpenRouterModelRates(OPENROUTER_GEMINI_4_ARGON_MODEL);
  const inputChars = bodyJson.length;
  const estimatedInputTokens = Math.ceil(estimateTokensFromCharCount(inputChars) * 1.3);
  const fxBase = Number(loaded.fx?.base_usd_krw ?? 0);
  if (!(fxBase > 0)) fail("FX_MISSING");
  const fx = applyOverseasCardFee(fxBase);
  const oneCallUsd =
    (estimatedInputTokens * rates.inputUsdPerM + OUTPUT_TOKEN_ASSUMPTION * rates.outputUsdPerM) /
    1_000_000;
  const pairUsd = oneCallUsd * 2;
  const oneCallKrw = oneCallUsd * fx;
  const estimatedPairKrw = pairUsd * fx;
  const estimate = {
    estimatedInputTokens,
    outputTokenAssumption: OUTPUT_TOKEN_ASSUMPTION,
    inputUsdPerMillion: rates.inputUsdPerM,
    outputUsdPerMillion: rates.outputUsdPerM,
    cacheReadUsdPerMillion: rates.cacheReadUsdPerM ?? null,
    oneCallUsd,
    pairUsd,
    oneCallKrw,
    fxBaseKrwPerUsd: fxBase,
    fxKrwPerUsd: fx,
    estimatedPairKrw,
    ceilingKrw: COST_CEILING_KRW,
    pricingOwner: "resolveOpenRouterModelRates",
  };
  fs.writeFileSync(path.join(outDir, "cost-estimate.json"), JSON.stringify(estimate, null, 2));
  if (estimatedPairKrw >= COST_CEILING_KRW) {
    fail("COST_CEILING", { estimatedPairKrw, oneCallKrw });
  }
  if (!post) {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        mode: "assemble",
        providerPosts: 0,
        label,
        codeSha: codeSha(),
        innerSentence: actualInner,
        wireModel: argon.wireModel,
        requestModel,
        normalizedFingerprint: fingerprints.normalizedFingerprint,
        requestBodyFingerprint: argon.requestBodyFingerprint,
        estimatedPairKrw,
        oneCallKrw,
        greetingSha256: loaded.proof.greetingSha256,
      })}\n`
    );
    return;
  }

  const keys = readPaidRunnerLiveInferenceKeys();
  if (!keys.openRouterKey) fail("MISSING_EXPERIMENT_KEY");
  if (experimentSecretUsesProductionKey(keys.openRouterKey)) {
    fail("PRODUCTION_KEY_FALLBACK_FORBIDDEN");
  }
  const started = Date.now();
  const response = await fetch(argon.endpoint, {
    method: "POST",
    headers: buildOpenRouterHeaders(keys.openRouterKey),
    body: bodyJson,
    signal: AbortSignal.timeout(240_000),
  });
  const elapsedMs = Date.now() - started;
  if (!response.ok) {
    const errorText = (await response.text()).slice(0, 500).replace(/sk-or-[A-Za-z0-9_-]+/g, "[REDACTED]");
    fs.writeFileSync(
      path.join(outDir, "meta.json"),
      JSON.stringify({ ok: false, status: response.status, elapsedMs, errorText }, null, 2)
    );
    fail("PROVIDER_HTTP_ERROR", {
      status: response.status,
      providerPosts: 1,
      completedGenerations: 0,
    });
  }
  const evidence = await decodeOpenAiCompatibleSseResponse(
    response,
    createOpenAiCompatibleSseEvidence()
  );
  const usage = parseOpenRouterUsage(evidence.lastUsage, response.headers);
  const rawUsage = evidence.lastUsage as { cost?: unknown } | null;
  const providerCostUsd =
    typeof rawUsage?.cost === "number" ? rawUsage.cost : usage.upstreamCostUsd ?? null;
  fs.writeFileSync(assistantPath, evidence.text);
  const meta = {
    ok: true,
    kind: "isolated_production_assembly_experiment",
    liveProductionChat: false,
    experiment: "argon-normal-inner-boundary",
    stimulus: "approved A canon quiet_window_safe",
    chat801TypoInput: false,
    label,
    codeSha: codeSha(),
    providerPosts: 1,
    retries: 0,
    canonicalId: GEMINI_4_ARGON_MODEL,
    wireModel: argon.wireModel,
    requestModel,
    responseModelId: evidence.responseModelId,
    provider: argon.provider,
    endpointHost: "openrouter.ai",
    keyEnv: RP_QUALITY_PAID_OPENROUTER_KEY_ENV,
    finishReason: evidence.finishReason,
    status: response.status,
    elapsedMs,
    assistantChars: evidence.text.length,
    assistantSha256: sha256(evidence.text),
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    reasoningTokens: usage.reasoningTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    providerCostUsd,
    requestBodyFingerprint: argon.requestBodyFingerprint,
    normalizedFingerprint: fingerprints.normalizedFingerprint,
    innerSentence: actualInner,
    systemOwnerCount: fingerprints.systemOwnerCount,
    estimatedPairKrw,
    oneCallKrw,
    characterId: 18,
    personaId: 1,
    greetingSha256: loaded.proof.greetingSha256,
    authoringLevel: loaded.proof.authoringLevel,
    contentMode: loaded.proof.contentMode,
    autoProgression: false,
  };
  fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2));
  process.stdout.write(`${JSON.stringify(meta)}\n`);
}
