/**
 * #1354 operator wrapper — Cursor-side Flash A/B path.
 * Reuses #1377 assembly and CheaperInference header/URL/adapt owners.
 * Does not change production defaults. Does not fall back to CHEAPER_INFERENCE_API_KEY.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";

import { isAdminUser } from "@/lib/isAdminUser";
import {
  adaptCheaperInferenceChatBody,
  buildCheaperInferenceChatCompletionsUrl,
  buildCheaperInferenceHeaders,
  CHEAPER_INFERENCE_BASE_URL,
} from "@/lib/cheaperInferenceConfig";
import { CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL } from "@/lib/chatModels";
import {
  loadCharacterChunksForPromptReadOnly,
  loadCharacterChunksReadOnly,
} from "@/lib/characterChunks";
import { CHEAPER_INFERENCE_MODELS_SOURCE_URL } from "@/lib/modelPricingTrackingConfig";
import { readCompatibleCompletionProviderRequestId } from "@/lib/openRouterCompletion";
import { parseOpenRouterUsage } from "@/lib/openRouterUsage";
import { classifyEnglishLayer } from "@/lib/promptTranslation";
import {
  assembleLiveDeployedBodyCueSceneRequests,
  bodyCueInputCharacterId,
  buildLiveDeployedBodyCueReviewPacket,
  fieldHashesFromLiveDeployedRows,
  LIVE_DEPLOYED_ROW_PROOF,
  payloadMatchesLiveDeployedRowProof,
  type LiveDeployedBodyCueRows,
  type LiveVerifiedBodyCueReviewPacket,
} from "./mainRpBodyCuePreflight";
import { buildGreetingBodyCueReviewCases } from "./rpModelQualificationFixture";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as typeof import("better-sqlite3");

export const MAX_PAID_ATTEMPTS = 4;
export const BODY_CUE_1354_MODEL = CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL;
export const BODY_CUE_1354_MAX_TOKENS = 8192;
export const BODY_CUE_1354_MIN_DISCOUNT_PERCENT = 50;
export const BODY_CUE_1354_SUPPLY_URL = `${CHEAPER_INFERENCE_BASE_URL}/models/supply`;

export const SECRET_PLACEHOLDER = "<EXPERIMENT_KEY>";

const PLACEHOLDER_SECRETS = new Set([
  SECRET_PLACEHOLDER,
  "EXPERIMENT_KEY",
  "<EXPERIMENT_KEY>",
]);

export type RunnerMode = "prepare" | "execute";

export type ExperimentSecretSource =
  | { kind: "stdin"; read: () => string }
  | { kind: "file"; path: string };

export class ExperimentSecretError extends Error {
  readonly paidPostCount = 0;
  constructor(message: string) {
    super(message);
    this.name = "ExperimentSecretError";
  }
}

export class PaidAttemptBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaidAttemptBudgetError";
  }
}

export class LiveSealError extends Error {
  readonly paidPostCount = 0;
  constructor(
    message: string,
    readonly reason: string
  ) {
    super(message);
    this.name = "LiveSealError";
  }
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function readExperimentSecretOnce(source: ExperimentSecretSource | null): string {
  if (!source) {
    throw new ExperimentSecretError("experiment secret missing — fail closed before provider POST");
  }
  let raw: string;
  if (source.kind === "stdin") {
    raw = source.read();
  } else {
    const path = source.path;
    if (!path || path === "-") {
      throw new ExperimentSecretError("experiment secret file path missing — fail closed before provider POST");
    }
    const stat = fs.statSync(path);
    if ((stat.mode & 0o077) !== 0) {
      throw new ExperimentSecretError("experiment secret file must be 0600 — fail closed before provider POST");
    }
    raw = fs.readFileSync(path, "utf8");
    fs.unlinkSync(path);
  }
  const secret = raw.trim();
  if (!secret) {
    throw new ExperimentSecretError("experiment secret empty — fail closed before provider POST");
  }
  if (PLACEHOLDER_SECRETS.has(secret) || secret.includes("\n") || secret.length < 8) {
    throw new ExperimentSecretError("experiment secret malformed — fail closed before provider POST");
  }
  return secret;
}

export function experimentHeaders(secret: string): Record<string, string> {
  const key = secret.trim();
  if (!key) {
    throw new ExperimentSecretError("experiment secret empty — fail closed before provider POST");
  }
  return buildCheaperInferenceHeaders(key);
}

export class PaidAttemptBudget {
  private attempts = 0;
  consumeBeforePost(): number {
    if (this.attempts >= MAX_PAID_ATTEMPTS) {
      throw new PaidAttemptBudgetError("paid attempt 5 blocked before provider fetch");
    }
    this.attempts += 1;
    return this.attempts;
  }
  get count(): number {
    return this.attempts;
  }
}

export function applyBodyCue1354ExperimentOverrides(
  body: Record<string, unknown>
): Record<string, unknown> {
  const withOverrides = {
    ...body,
    model: BODY_CUE_1354_MODEL,
    max_tokens: BODY_CUE_1354_MAX_TOKENS,
    min_discount_percent: BODY_CUE_1354_MIN_DISCOUNT_PERCENT,
  };
  const adapted = adaptCheaperInferenceChatBody(withOverrides);
  if (adapted.max_tokens !== BODY_CUE_1354_MAX_TOKENS) {
    throw new Error("adaptCheaperInferenceChatBody stripped experiment max_tokens");
  }
  if (adapted.min_discount_percent !== BODY_CUE_1354_MIN_DISCOUNT_PERCENT) {
    throw new Error("adaptCheaperInferenceChatBody stripped experiment min_discount_percent");
  }
  if (adapted.model !== BODY_CUE_1354_MODEL) {
    throw new Error("adaptCheaperInferenceChatBody changed experiment model");
  }
  return adapted;
}

export function openSqliteQueryOnly(dbPath: string) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");
  return db;
}

export type LiveSealReport = {
  characterId: 18;
  likeUnique: boolean;
  id10IsLike: boolean;
  adminCount: number;
  adminRenCount: number;
  hashMatrix: Record<
    "greeting" | "system_prompt" | "world" | "setting_chunks" | "public_persona_description",
    "MATCH" | "CHANGED"
  >;
  nickname_equals_persona: boolean;
  nicknameLength: number;
  english: {
    setting_chunks_en_present: boolean;
    prompt_translation_hash_present: boolean;
    classifyEnglishLayer: ReturnType<typeof classifyEnglishLayer>;
    usedEnglish: boolean;
    bytesPresent: boolean;
    applied: boolean;
  };
};

export type LiveSeal = {
  rows: LiveDeployedBodyCueRows;
  packet: LiveVerifiedBodyCueReviewPacket;
  report: LiveSealReport;
  queryOnly: boolean;
};

function matchField(actual: string, expected: string): "MATCH" | "CHANGED" {
  return actual === expected ? "MATCH" : "CHANGED";
}

export function sealLiveDeployedInputFromDb(dbPath: string): LiveSeal {
  const db = openSqliteQueryOnly(dbPath);
  try {
    const queryOnlyRaw = db.pragma("query_only", { simple: true }) as unknown;
    const queryOnly =
      queryOnlyRaw === 1 ||
      queryOnlyRaw === "1" ||
      (typeof queryOnlyRaw === "object" &&
        queryOnlyRaw != null &&
        Number((queryOnlyRaw as { query_only?: unknown }).query_only) === 1);
    if (!queryOnly) {
      throw new LiveSealError("sqlite query_only is not ON", "query_only_off");
    }

    const likes = db.prepare("SELECT id, name FROM characters WHERE name = ?").all("라이크") as {
      id: number;
      name: string;
    }[];
    const id10 = db.prepare("SELECT id, name FROM characters WHERE id = 10").get() as
      | { name: string }
      | undefined;
    const users = db
      .prepare("SELECT id, email, is_admin, account_kind, nickname FROM users")
      .all() as {
      id: number;
      email: string;
      is_admin: number;
      account_kind: string | null;
      nickname: string;
    }[];
    const admins = users.filter((user) => isAdminUser(user));
    if (likes.length !== 1 || likes[0]?.id !== 18 || likes[0]?.name !== "라이크") {
      throw new LiveSealError("라이크 unique id 18 mismatch", "identity_mismatch");
    }
    if (id10?.name === "라이크") {
      throw new LiveSealError("id 10 is currently 라이크", "identity_mismatch");
    }
    if (admins.length !== 1) {
      throw new LiveSealError("canonical admin count is not 1", "identity_mismatch");
    }
    const admin = admins[0]!;
    if (admin.account_kind === "portone_reviewer") {
      throw new LiveSealError("portone_reviewer must be excluded", "identity_mismatch");
    }
    const ren = db
      .prepare("SELECT name, gender, description FROM user_personas WHERE user_id = ? AND name = ?")
      .all(admin.id, "렌") as { name: string; gender: string; description: string }[];
    if (ren.length !== 1) {
      throw new LiveSealError("admin 렌 persona count is not 1", "identity_mismatch");
    }

    const character = db
      .prepare(
        `SELECT id, name, gender, nsfw, official, greeting, system_prompt, world,
                setting_chunks, setting_chunks_en, prompt_translation_hash,
                speech_profile, creator_compiled_description_json,
                appearance_raw, appearance_compiled, appearance_compiled_source_hash,
                appearance_compiled_version, example_dialog, description, content_kind,
                narration_style_instructions
         FROM characters WHERE id = 18`
      )
      .get();
    const persona = ren[0]!;
    const userNickname = String(admin.nickname ?? "");
    const rows: LiveDeployedBodyCueRows = { character, persona, userNickname };
    const hashes = fieldHashesFromLiveDeployedRows(rows);
    const hashMatrix = {
      greeting: matchField(hashes.greetingSha256, LIVE_DEPLOYED_ROW_PROOF.greetingSha256),
      system_prompt: matchField(hashes.systemPromptSha256, LIVE_DEPLOYED_ROW_PROOF.systemPromptSha256),
      world: matchField(hashes.worldSha256, LIVE_DEPLOYED_ROW_PROOF.worldSha256),
      setting_chunks: matchField(hashes.settingChunksSha256, LIVE_DEPLOYED_ROW_PROOF.settingChunksSha256),
      public_persona_description: matchField(
        hashes.personaPublicSha256,
        LIVE_DEPLOYED_ROW_PROOF.personaPublicSha256
      ),
    };
    if (Object.values(hashMatrix).some((status) => status !== "MATCH")) {
      throw new LiveSealError("LIVE_DEPLOYED_ROW_PROOF hash mismatch", "hash_changed");
    }
    if (!payloadMatchesLiveDeployedRowProof(rows)) {
      throw new LiveSealError("payload does not match LIVE_DEPLOYED_ROW_PROOF", "hash_changed");
    }

    const korean = loadCharacterChunksReadOnly(character);
    const settingChunksEn = String(character.setting_chunks_en ?? "");
    const promptTranslationHash = String(character.prompt_translation_hash ?? "");
    const englishBytesPresent = Boolean(settingChunksEn.trim()) && settingChunksEn.trim() !== "[]";
    const classify = classifyEnglishLayer({
      koreanChunks: korean,
      settingChunksEn: character.setting_chunks_en,
      promptTranslationHash: character.prompt_translation_hash,
    });
    const loaded = loadCharacterChunksForPromptReadOnly(character, persona.name, userNickname);
    const packet = buildLiveDeployedBodyCueReviewPacket(rows, { source: "LIVE_VERIFIED" });
    if (packet.evidence.source !== "LIVE_VERIFIED") {
      throw new LiveSealError("evidence.source is not LIVE_VERIFIED", "live_verified_false");
    }
    assertPacketReadyForPaid(packet);

    return {
      rows,
      packet,
      queryOnly: true,
      report: {
        characterId: 18,
        likeUnique: true,
        id10IsLike: false,
        adminCount: 1,
        adminRenCount: 1,
        hashMatrix,
        nickname_equals_persona: userNickname.trim() === persona.name.trim(),
        nicknameLength: userNickname.trim().length,
        english: {
          setting_chunks_en_present: englishBytesPresent,
          prompt_translation_hash_present: Boolean(promptTranslationHash.trim()),
          classifyEnglishLayer: classify,
          usedEnglish: loaded.usedEnglish,
          bytesPresent: englishBytesPresent,
          applied: loaded.usedEnglish === true,
        },
      },
    };
  } finally {
    db.close();
  }
}

export function assertPacketReadyForPaid(
  packet: LiveVerifiedBodyCueReviewPacket | { evidence: { source: string }; scenes: Array<{
    id: string;
    soleAllowedDiff: boolean;
    rulesShaEqual: boolean;
    dynamicShaEqual: boolean;
    baseline: { cached: boolean[]; safeContract: boolean; normalAuthoring: boolean };
    candidate: { cached: boolean[]; safeContract: boolean; normalAuthoring: boolean };
    assembledUserSha256?: string;
  }>; authoringLevel: string }
): void {
  if (packet.evidence.source !== "LIVE_VERIFIED") {
    throw new LiveSealError("evidence.source is not LIVE_VERIFIED", "live_verified_false");
  }
  if (bodyCueInputCharacterId(packet as LiveVerifiedBodyCueReviewPacket) !== 18) {
    throw new LiveSealError("input character id is not 18", "identity_mismatch");
  }
  if (packet.authoringLevel !== "NORMAL") {
    throw new LiveSealError("authoring is not NORMAL", "scene_gate_failed");
  }
  const required = ["quiet_window_safe", "relationship_turn_safe"];
  for (const id of required) {
    const scene = packet.scenes.find((item) => item.id === id);
    if (!scene) throw new LiveSealError(`missing scene ${id}`, "scene_gate_failed");
    const cacheEqual = scene.baseline.cached.join() === scene.candidate.cached.join();
    if (
      scene.soleAllowedDiff !== true ||
      scene.rulesShaEqual !== true ||
      scene.dynamicShaEqual !== true ||
      !cacheEqual ||
      !scene.baseline.safeContract ||
      !scene.candidate.safeContract ||
      !scene.baseline.normalAuthoring ||
      !scene.candidate.normalAuthoring
    ) {
      throw new LiveSealError(`scene gate failed: ${id}`, scene.soleAllowedDiff ? "scene_gate_failed" : "sole_allowed_diff_false");
    }
  }
}

export type ExperimentArmRequest = {
  sceneId: string;
  arm: "A" | "B";
  requestBody: Record<string, unknown>;
  promptSha256: string;
  finalWireSha256: string;
  endpoint: string;
};

export function deriveExperimentRequests(rows: LiveDeployedBodyCueRows): ExperimentArmRequest[] {
  const out: ExperimentArmRequest[] = [];
  for (const caseData of buildGreetingBodyCueReviewCases(String(rows.character.greeting ?? ""))) {
    const assembled = assembleLiveDeployedBodyCueSceneRequests(rows, caseData);
    const arms = [
      { arm: "A" as const, request: assembled.baseline },
      { arm: "B" as const, request: assembled.candidate },
    ];
    for (const { arm, request } of arms) {
      const requestBody = applyBodyCue1354ExperimentOverrides(request.requestBody);
      out.push({
        sceneId: caseData.id,
        arm,
        requestBody,
        promptSha256: sha256Hex(JSON.stringify(requestBody.messages ?? [])),
        finalWireSha256: sha256Hex(JSON.stringify(requestBody)),
        endpoint: buildCheaperInferenceChatCompletionsUrl(),
      });
    }
  }
  return out;
}

export type ProviderPostFn = (input: {
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}) => Promise<{
  httpStatus: number;
  model: string | null;
  completionTokens: number;
  requestId: string | null;
  billedMicroUsd: number | null;
  settled: boolean;
  text: string;
  retried: boolean;
  fallback: boolean;
}>;

export type CatalogGetFn = (input: {
  url: string;
  headers: Record<string, string>;
}) => Promise<{ ok: boolean; pricingVersion?: string | null; candidateCount?: number }>;

export function assertCall1Gate(result: Awaited<ReturnType<ProviderPostFn>>): void {
  if (result.model !== BODY_CUE_1354_MODEL) {
    throw new Error("CALL 1 model mismatch");
  }
  if (result.completionTokens > BODY_CUE_1354_MAX_TOKENS) {
    throw new Error("CALL 1 completion_tokens exceeded 8192");
  }
  if (!result.requestId) {
    throw new Error("CALL 1 missing request id");
  }
  if (result.billedMicroUsd == null) {
    throw new Error("CALL 1 missing billed/settled cost evidence");
  }
  if (result.retried || result.fallback) {
    throw new Error("CALL 1 retry/fallback is forbidden");
  }
}

export type RunnerArtifact = {
  status: "PREPARE_READY" | "EXECUTE_BLOCKED" | "CALL1_BLOCKED" | "EXECUTE_COMPLETE";
  mode: RunnerMode;
  productionDeploySha: string | null;
  modelId: typeof BODY_CUE_1354_MODEL;
  liveInput: Omit<LiveSealReport, never>;
  scenes: Array<{
    id: string;
    soleAllowedDiff: boolean;
    rulesShaEqual: boolean;
    dynamicShaEqual: boolean;
    promptChars: number;
    flatCharDelta: number;
  }>;
  requests: Array<{
    sceneId: string;
    arm: "A" | "B";
    promptSha256: string;
    finalWireSha256: string;
    max_tokens: number;
    min_discount_percent: number;
    model: string;
  }>;
  paidPostCount: number;
  attemptCount: number;
  retries: 0;
  fallback: 0;
  catalog: { url: typeof CHEAPER_INFERENCE_MODELS_SOURCE_URL };
  supply: { url: typeof BODY_CUE_1354_SUPPLY_URL; min_discount_percent: number };
};

function sceneSummaries(packet: LiveVerifiedBodyCueReviewPacket) {
  return packet.scenes.map((scene) => ({
    id: scene.id,
    soleAllowedDiff: scene.soleAllowedDiff,
    rulesShaEqual: scene.rulesShaEqual,
    dynamicShaEqual: scene.dynamicShaEqual,
    promptChars: scene.promptChars,
    flatCharDelta: scene.flatCharDelta,
  }));
}

function requestSummaries(requests: ExperimentArmRequest[]) {
  return requests.map((request) => ({
    sceneId: request.sceneId,
    arm: request.arm,
    promptSha256: request.promptSha256,
    finalWireSha256: request.finalWireSha256,
    max_tokens: BODY_CUE_1354_MAX_TOKENS,
    min_discount_percent: BODY_CUE_1354_MIN_DISCOUNT_PERCENT,
    model: BODY_CUE_1354_MODEL,
  }));
}

export function assertArtifactHasNoSecrets(
  artifact: unknown,
  forbidden: string[]
): void {
  const text = JSON.stringify(artifact);
  for (const value of forbidden) {
    if (value && text.includes(value)) {
      throw new Error("artifact leaked a forbidden value");
    }
  }
}

export async function runBodyCueFlashAb1354(opts: {
  mode: RunnerMode;
  secretSource: ExperimentSecretSource | null;
  seal: () => LiveSeal;
  post?: ProviderPostFn;
  catalogGet?: CatalogGetFn;
  productionDeploySha?: string | null;
}): Promise<RunnerArtifact> {
  let secret: string | null = null;
  if (opts.mode === "execute") {
    secret = readExperimentSecretOnce(opts.secretSource);
  } else if (opts.secretSource) {
    secret = readExperimentSecretOnce(opts.secretSource);
  }

  const seal = opts.seal();
  assertPacketReadyForPaid(seal.packet);
  if ((globalThis as { __db?: unknown }).__db) {
    throw new LiveSealError("writable database owner was invoked", "getDb_called");
  }
  const requests = deriveExperimentRequests(seal.rows);
  const artifact: RunnerArtifact = {
    status: "PREPARE_READY",
    mode: opts.mode,
    productionDeploySha: opts.productionDeploySha ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
    modelId: BODY_CUE_1354_MODEL,
    liveInput: seal.report,
    scenes: sceneSummaries(seal.packet),
    requests: requestSummaries(requests),
    paidPostCount: 0,
    attemptCount: 0,
    retries: 0,
    fallback: 0,
    catalog: { url: CHEAPER_INFERENCE_MODELS_SOURCE_URL },
    supply: {
      url: BODY_CUE_1354_SUPPLY_URL,
      min_discount_percent: BODY_CUE_1354_MIN_DISCOUNT_PERCENT,
    },
  };

  if (opts.mode !== "execute") {
    secret = null;
    return artifact;
  }

  if (!secret) {
    throw new ExperimentSecretError("experiment secret missing — fail closed before provider POST");
  }
  if (!opts.post || !opts.catalogGet) {
    throw new ExperimentSecretError("execute transport not provided — fail closed before provider POST");
  }

  const headers = experimentHeaders(secret);
  secret = null;
  await opts.catalogGet({ url: CHEAPER_INFERENCE_MODELS_SOURCE_URL, headers });
  await opts.catalogGet({
    url: `${BODY_CUE_1354_SUPPLY_URL}?model=${encodeURIComponent(BODY_CUE_1354_MODEL)}&min_discount_percent=${BODY_CUE_1354_MIN_DISCOUNT_PERCENT}`,
    headers,
  });

  const budget = new PaidAttemptBudget();
  const seenRequestIds = new Set<string>();
  const first = requests[0];
  if (!first) throw new LiveSealError("no assembled requests", "scene_gate_failed");

  const attempt = budget.consumeBeforePost();
  const call1 = await opts.post({
    endpoint: first.endpoint,
    headers,
    body: first.requestBody,
  });
  artifact.paidPostCount = 1;
  artifact.attemptCount = attempt;
  if (call1.requestId) {
    if (seenRequestIds.has(call1.requestId)) {
      artifact.status = "CALL1_BLOCKED";
      throw new Error("duplicate request id");
    }
    seenRequestIds.add(call1.requestId);
  }
  try {
    assertCall1Gate(call1);
  } catch (error) {
    artifact.status = "CALL1_BLOCKED";
    throw error;
  }

  for (const request of requests.slice(1)) {
    const nextAttempt = budget.consumeBeforePost();
    const result = await opts.post({
      endpoint: request.endpoint,
      headers,
      body: request.requestBody,
    });
    artifact.paidPostCount += 1;
    artifact.attemptCount = nextAttempt;
    if (result.requestId) {
      if (seenRequestIds.has(result.requestId)) {
        throw new Error("duplicate request id");
      }
      seenRequestIds.add(result.requestId);
    }
  }

  artifact.status = "EXECUTE_COMPLETE";
  return artifact;
}

export function parseProviderPostResult(res: {
  status: number;
  headers: Headers;
  body: unknown;
}): Awaited<ReturnType<ProviderPostFn>> {
  const usage = parseOpenRouterUsage(
    res.body && typeof res.body === "object"
      ? (res.body as { usage?: unknown }).usage
      : null,
    res.headers
  );
  const requestId = readCompatibleCompletionProviderRequestId({
    provider: "cheaperinference",
    headers: res.headers,
    body: res.body,
  });
  const cheaper =
    res.body && typeof res.body === "object"
      ? (res.body as { cheaper_inference?: { billed_cost_usd?: unknown; settled?: unknown } }).cheaper_inference
      : undefined;
  const billedRaw = cheaper?.billed_cost_usd;
  const billedMicroUsd =
    typeof billedRaw === "number" && Number.isFinite(billedRaw)
      ? Math.round(billedRaw * 1_000_000)
      : typeof billedRaw === "string" && billedRaw.trim()
        ? Math.round(Number(billedRaw) * 1_000_000)
        : null;
  const model =
    res.body && typeof res.body === "object" && typeof (res.body as { model?: unknown }).model === "string"
      ? String((res.body as { model: string }).model)
      : null;
  const text =
    res.body && typeof res.body === "object"
      ? String(
          (
            (res.body as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]
              ?.message?.content ?? ""
          )
        )
      : "";
  return {
    httpStatus: res.status,
    model,
    completionTokens: usage.completionTokens,
    requestId,
    billedMicroUsd,
    settled: cheaper?.settled === true || (billedMicroUsd != null && billedMicroUsd > 0),
    text,
    retried: false,
    fallback: false,
  };
}

export function defaultProductionDbPath(): string {
  const dataDir = process.env.DATA_DIR?.trim() || "/data";
  return `${dataDir.replace(/\/$/, "")}/app.db`;
}
