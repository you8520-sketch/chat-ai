/**
 * Isolated Gemini 3.8 A-scene compare.
 * Reuses the PRECALL production row loader and assemblePrecallFinalWire.
 * One OpenRouter POST per process. No retry, no other model POST.
 */
import "./server-only-mock";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { GEMINI_38_FLASH_MODEL } from "@/lib/chatModels";
import {
  buildOpenRouterHeaders,
  OPENROUTER_CHAT_COMPLETIONS_URL,
} from "@/lib/openRouterConfig";
import {
  createOpenAiCompatibleSseEvidence,
  decodeOpenAiCompatibleSseResponse,
} from "@/lib/openAiCompatibleSseDecoder";
import { parseOpenRouterUsage } from "@/lib/openRouterUsage";
import { estimateTokensFromCharCount } from "@/lib/tokenEstimate";
import { experimentSecretUsesProductionKey } from "@/lib/rpQualityPaidRunner";
import {
  RP_QUALITY_PAID_OPENROUTER_KEY_ENV,
  readPaidRunnerLiveInferenceKeys,
} from "@/lib/rpQualityPaidRunnerLiveTransport";
import { rpQualityPrecallBenchmarkModels } from "@/lib/rpQualityPrecall";
import { TERMINAL_DIALOGUE_BUDGET_MARKER } from "@/lib/scenePacingController";
import { COMMON_PROSE_BODY_CUE_REVIEW_SCENE_SEEDS } from "./rpModelQualificationFixture";
import { loadPrecallProductionRows } from "./rpQualityPrecallProductionRows";
import { assemblePrecallFinalWireWithSealedRequests } from "./rpQualityPrecallFinalWire";

const REQUIRED_USER = `OOC: 임무가 끝난 밤. 둘만 태형의 본부 숙소 창가에 있다. 다른 인물은 없다. 둘 다 성인이다. 여기서부터 장면 계속.

렌은 창틀에서 한 걸음 떨어져 유리 너머의 불빛만 본다. "오늘은 그냥 이렇게 있자."`;

const AXIS_PLACEHOLDER = "[[AXIS]]";
const KNOWN_AXIS_LINES = [
  "유저가 반응할 질문·제안·요구는 하나의 중심축으로 모으고, [B]의 새 직접 발화·중대한 선택은 유저에게 남긴다.",
  "이미 주어진 정보로 가능한 행동은 캐릭터가 이어가고, 사용자 답이 실제로 필요한 질문·제안·요구만 하나의 중심축으로 모은다. [B]의 새 직접 발화·중대한 선택은 유저에게 남긴다.",
];

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

function dialogueOwner(body: unknown): string {
  const messages = (body as { messages?: Array<{ role?: string; content?: unknown }> }).messages ?? [];
  const user = [...messages].reverse().find((message) => message.role === "user");
  const text = flattenContent(user?.content);
  const start = text.lastIndexOf(TERMINAL_DIALOGUE_BUDGET_MARKER);
  if (start < 0) return "";
  const block = text.slice(start).split(/\n\s*\n/)[0] ?? "";
  return block.trim();
}

function normalizeBody(body: unknown): string {
  let json = JSON.stringify(body);
  for (const line of KNOWN_AXIS_LINES) json = json.split(line).join(AXIS_PLACEHOLDER);
  return json;
}

function codeSha(): string {
  return execSync("git rev-parse HEAD", { cwd: process.cwd(), encoding: "utf8" }).trim();
}

export async function runGemini38AxisLiveCompare(): Promise<void> {
  const label = process.env.LABEL?.trim() || "";
  if (label !== "before" && label !== "after") fail("LABEL_REQUIRED");
  const dbPath = process.env.G38_SNAPSHOT_DB?.trim() || "";
  if (!dbPath || !fs.existsSync(dbPath)) fail("SNAPSHOT_DB_MISSING");
  const post = process.env.G38_POST === "1";
  const outDir = path.join("/opt/cursor/artifacts/g38-axis-compare", label);
  fs.mkdirSync(outDir, { recursive: true });
  const assistantPath = path.join(outDir, "assistant.txt");
  if (post && fs.existsSync(assistantPath)) fail("LABEL_ALREADY_POSTED", { label });

  const seed = COMMON_PROSE_BODY_CUE_REVIEW_SCENE_SEEDS.find((row) => row.id === "quiet_window_safe");
  if (!seed || seed.currentUserMessage !== REQUIRED_USER) fail("STIMULUS_DRIFT");

  const deployedGitSha = process.env.G38_DEPLOY_SHA?.trim() || "0e81b15f54bff7e29f069c1ace298333b254b077";
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

  const assembled = assemblePrecallFinalWireWithSealedRequests(
    loaded.rows,
    rpQualityPrecallBenchmarkModels()
  );
  const gemini = assembled.sealedRequests.find(
    (request) =>
      request.canonicalId === GEMINI_38_FLASH_MODEL &&
      request.fixtureId === "A_relationship_emotion"
  );
  if (!gemini) fail("GEMINI_A_REQUEST_MISSING");
  const bodyJson = JSON.stringify(gemini.requestBody);
  const flatWire = ((gemini.requestBody as { messages?: Array<{ content?: unknown }> }).messages ?? [])
    .map((message) => flattenContent(message.content))
    .join("\n");
  const lastUserFlat = flattenContent(
    [...((gemini.requestBody as { messages?: Array<{ role?: string; content?: unknown }> }).messages ?? [])]
      .reverse()
      .find((message) => message.role === "user")?.content
  );
  if (!lastUserFlat.includes("오늘은 그냥 이렇게 있자") || !lastUserFlat.includes("창틀에서")) {
    fail("STIMULUS_NOT_IN_WIRE");
  }
  if (gemini.provider !== "openrouter") fail("PROVIDER_MISMATCH", { provider: gemini.provider });
  if (gemini.endpoint !== OPENROUTER_CHAT_COMPLETIONS_URL) fail("ENDPOINT_MISMATCH");

  const owner = dialogueOwner(gemini.requestBody);
  const ownerCount = bodyJson.split(TERMINAL_DIALOGUE_BUDGET_MARKER).length - 1;
  const fingerprints = assembled.sealedRequests
    .filter((request) => request.fixtureId === "A_relationship_emotion")
    .map((request) => ({
      canonicalId: request.canonicalId,
      provider: request.provider,
      wireModel: request.wireModel,
      requestBodyFingerprint: request.requestBodyFingerprint,
      normalizedFingerprint: sha256(normalizeBody(request.requestBody)),
      dialogueOwner: dialogueOwner(request.requestBody),
      ownerCount:
        JSON.stringify(request.requestBody).split(TERMINAL_DIALOGUE_BUDGET_MARKER).length - 1,
    }));
  fs.writeFileSync(
    path.join(outDir, "fingerprints.json"),
    JSON.stringify(
      {
        codeSha: codeSha(),
        label,
        characterId: loaded.proof.characterId,
        personaId: loaded.proof.personaId,
        greetingSha256: loaded.proof.greetingSha256,
        systemPromptSha256: loaded.proof.systemPromptSha256,
        worldSha256: loaded.proof.worldSha256,
        settingChunksSha256: loaded.proof.settingChunksSha256,
        personaPublicSha256: loaded.proof.personaPublicSha256,
        personaPublicChars: loaded.proof.personaPublicChars,
        authoringLevel: loaded.proof.authoringLevel,
        contentMode: loaded.proof.contentMode,
        userNoteChars: (loaded.rows.user.user_note ?? "").length,
        loreAttachments: loaded.rows.creatorLorebookAttachments,
        stimulusSourceExact: true,
        lastUserSha256: sha256(lastUserFlat),
        fingerprints,
      },
      null,
      2
    )
  );

  const inputChars = bodyJson.length;
  const estimatedInputTokens = Math.ceil(estimateTokensFromCharCount(inputChars) * 1.3);
  const inputUsdPerM = 0.375;
  const outputUsdPerM = 1.875;
  const pairUsd =
    ((estimatedInputTokens * inputUsdPerM + OUTPUT_TOKEN_ASSUMPTION * outputUsdPerM) / 1_000_000) * 2;
  const fxBase = Number(loaded.fx?.base_usd_krw ?? 0);
  const fx = fxBase > 0 ? fxBase * 1.02 : 1500;
  const estimatedPairKrw = pairUsd * fx;
  const estimate = {
    estimatedInputTokens,
    outputTokenAssumption: OUTPUT_TOKEN_ASSUMPTION,
    inputUsdPerMillion: inputUsdPerM,
    outputUsdPerMillion: outputUsdPerM,
    pairUsd,
    fxKrwPerUsd: fx,
    estimatedPairKrw,
    ceilingKrw: COST_CEILING_KRW,
  };
  fs.writeFileSync(path.join(outDir, "cost-estimate.json"), JSON.stringify(estimate, null, 2));
  if (estimatedPairKrw >= COST_CEILING_KRW) {
    fail("COST_CEILING", { estimatedPairKrw });
  }
  if (!post) {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        mode: "assemble",
        providerPosts: 0,
        label,
        dialogueOwner: owner,
        ownerCount,
        wireModel: gemini.wireModel,
        estimatedPairKrw,
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
  const response = await fetch(gemini.endpoint, {
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
  const providerCostUsd = typeof rawUsage?.cost === "number" ? rawUsage.cost : usage.upstreamCostUsd ?? null;
  fs.writeFileSync(assistantPath, evidence.text);
  const meta = {
    ok: true,
    kind: "isolated_production_assembly_experiment",
    liveProductionChat: false,
    label,
    codeSha: codeSha(),
    providerPosts: 1,
    retries: 0,
    canonicalId: gemini.canonicalId,
    wireModel: gemini.wireModel,
    responseModelId: evidence.responseModelId,
    provider: gemini.provider,
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
    requestBodyFingerprint: gemini.requestBodyFingerprint,
    finalWireFingerprint: gemini.finalWireFingerprint,
    dialogueOwner: owner,
    ownerCount,
    estimatedPairKrw,
    characterId: 18,
    personaId: 1,
    greetingSha256: loaded.proof.greetingSha256,
    authoringLevel: loaded.proof.authoringLevel,
    contentMode: loaded.proof.contentMode,
  };
  fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2));
  process.stdout.write(`${JSON.stringify(meta)}\n`);
}
