/**
 * #1354 operator wrapper — Cursor-side Flash A/B path.
 * Reuses #1377 assembly and CheaperInference header/URL/adapt owners.
 * Does not change production defaults. Does not fall back to CHEAPER_INFERENCE_API_KEY.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";

import { isAdminUser } from "@/lib/isAdminUser";
import {
  adaptCheaperInferenceChatBody,
  buildCheaperInferenceChatCompletionsUrl,
  buildCheaperInferenceHeaders,
  CHEAPER_INFERENCE_BASE_URL,
} from "@/lib/cheaperInferenceConfig";
import { parseCatalogPricing } from "@/lib/cheaperInferenceCatalogPricing.server";
import { CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL } from "@/lib/chatModels";
import {
  loadCharacterChunksForPromptReadOnly,
  loadCharacterChunksReadOnly,
} from "@/lib/characterChunks";
import { CHEAPER_INFERENCE_MODELS_SOURCE_URL } from "@/lib/modelPricingTrackingConfig";
import { readCompatibleCompletionProviderRequestId } from "@/lib/openRouterCompletion";
import { parseCompatibleUsage } from "@/lib/openRouterUsage";
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
export const FLASH_INPUT_CEILING = 0.075;
export const FLASH_OUTPUT_CEILING = 0.3;
export const APPROVED_EXECUTION_PLAN = [
  { sceneId: "quiet_window_safe", variant: "baseline" },
  { sceneId: "relationship_turn_safe", variant: "candidate" },
  { sceneId: "quiet_window_safe", variant: "candidate" },
  { sceneId: "relationship_turn_safe", variant: "baseline" },
] as const;

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

export class CatalogGateError extends Error {
  readonly paidPostCount = 0;
  constructor(
    message: string,
    readonly reason:
      | "non_ok"
      | "model_missing"
      | "malformed"
      | "price_violation"
      | "supply_empty"
      | "supply_ceiling"
  ) {
    super(message);
    this.name = "CatalogGateError";
  }
}

export class RunnerStopError extends Error {
  constructor(
    message: string,
    readonly artifact: RunnerArtifact,
    readonly reveal: BlindReveal | null = null
  ) {
    super(message);
    this.name = "RunnerStopError";
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

export type ExperimentVariant = "baseline" | "candidate";

export type ExperimentArmRequest = {
  sceneId: string;
  variant: ExperimentVariant;
  requestBody: Record<string, unknown>;
  promptSha256: string;
  finalWireSha256: string;
  endpoint: string;
};

export function deriveExperimentRequests(rows: LiveDeployedBodyCueRows): ExperimentArmRequest[] {
  const derived: ExperimentArmRequest[] = [];
  for (const caseData of buildGreetingBodyCueReviewCases(String(rows.character.greeting ?? ""))) {
    const assembled = assembleLiveDeployedBodyCueSceneRequests(rows, caseData);
    const arms: Array<{ variant: ExperimentVariant; request: typeof assembled.baseline }> = [
      { variant: "baseline", request: assembled.baseline },
      { variant: "candidate", request: assembled.candidate },
    ];
    for (const { variant, request } of arms) {
      const requestBody = applyBodyCue1354ExperimentOverrides(request.requestBody);
      derived.push({
        sceneId: caseData.id,
        variant,
        requestBody,
        promptSha256: sha256Hex(JSON.stringify(requestBody.messages ?? [])),
        finalWireSha256: sha256Hex(JSON.stringify(requestBody)),
        endpoint: buildCheaperInferenceChatCompletionsUrl(),
      });
    }
  }
  return planApprovedExecution(derived);
}

export function planApprovedExecution(derived: ExperimentArmRequest[]): ExperimentArmRequest[] {
  return APPROVED_EXECUTION_PLAN.map((step) => {
    const found = derived.find(
      (item) => item.sceneId === step.sceneId && item.variant === step.variant
    );
    if (!found) {
      throw new LiveSealError(
        `approved plan missing ${step.sceneId}/${step.variant}`,
        "scene_gate_failed"
      );
    }
    return found;
  });
}

export type PaidCallResult = {
  httpStatus: number;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  billedCostUsd: number | null;
  settled: boolean;
  requestId: string | null;
  text: string;
  retried: false;
  fallback: false;
  errorCategory?: string;
};

export type ProviderPostFn = (input: {
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}) => Promise<PaidCallResult>;

export type CatalogGetFn = (input: {
  url: string;
  headers: Record<string, string>;
}) => Promise<{ ok: boolean; httpStatus: number; payload: unknown }>;

export function readCheaperInferenceBillingStatus(cheaperInference: unknown): string | null {
  if (!cheaperInference || typeof cheaperInference !== "object") return null;
  const billing = (cheaperInference as { billing?: unknown }).billing;
  if (!billing || typeof billing !== "object") return null;
  const status = (billing as { status?: unknown }).status;
  return typeof status === "string" && status.trim() ? status.trim().toLowerCase() : null;
}

export function interpretPaidCompletion(res: {
  status: number;
  headers: Headers;
  body: unknown;
}): PaidCallResult {
  const cheaper =
    res.body && typeof res.body === "object"
      ? (res.body as { cheaper_inference?: unknown }).cheaper_inference
      : undefined;
  const usage = parseCompatibleUsage({
    usage:
      res.body && typeof res.body === "object"
        ? (res.body as { usage?: unknown }).usage
        : null,
    cheaperInference: cheaper,
    headers: res.headers,
    transportProvider: "cheaperinference",
  });
  const requestId = readCompatibleCompletionProviderRequestId({
    provider: "cheaperinference",
    headers: res.headers,
    body: res.body,
  });
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
  const billedCostUsd = usage.cheaperInferenceBilledCostUsd ?? null;
  const settled = readCheaperInferenceBillingStatus(cheaper) === "settled" && billedCostUsd != null;
  return {
    httpStatus: res.status,
    model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    billedCostUsd,
    settled,
    requestId,
    text,
    retried: false,
    fallback: false,
    errorCategory: res.status < 200 || res.status >= 300 ? "http" : undefined,
  };
}

export function assertPaidCallGate(result: PaidCallResult, callIndex: number): void {
  const label = `CALL ${callIndex}`;
  if (result.httpStatus < 200 || result.httpStatus >= 300) {
    throw new Error(`${label} HTTP ${result.httpStatus}`);
  }
  if (result.model !== BODY_CUE_1354_MODEL) {
    throw new Error(`${label} model mismatch`);
  }
  if (result.completionTokens > BODY_CUE_1354_MAX_TOKENS) {
    throw new Error(`${label} completion_tokens exceeded 8192`);
  }
  if (!result.requestId) {
    throw new Error(`${label} missing request id`);
  }
  if (!result.settled || result.billedCostUsd == null) {
    throw new Error(`${label} unsettled billing evidence`);
  }
  if (result.retried || result.fallback) {
    throw new Error(`${label} retry/fallback is forbidden`);
  }
}

export function assertCall1Gate(result: PaidCallResult): void {
  assertPaidCallGate(result, 1);
}

/** Catalog presence is the exact model row plus canonical parseCatalogPricing. */
export function parseFlashCatalogGate(payload: unknown): {
  available: true;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
  cacheWriteUsdPerMillion: number;
  pricingVersion: string | null;
  pricingCheckedAt: string | null;
  pricingUpdatedAt: string | null;
} {
  if (!payload || typeof payload !== "object") {
    throw new CatalogGateError("catalog payload malformed", "malformed");
  }
  const obj = payload as Record<string, unknown>;
  if (!Array.isArray(obj.data)) {
    throw new CatalogGateError("catalog payload malformed", "malformed");
  }
  const flash = obj.data.find(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof (item as { id?: unknown }).id === "string" &&
      String((item as { id: string }).id).trim().toLowerCase() === BODY_CUE_1354_MODEL
  ) as Parameters<typeof parseCatalogPricing>[0] | undefined;
  if (!flash) {
    throw new CatalogGateError("flash catalog row missing", "model_missing");
  }
  const meta = {
    ...(typeof obj.pricing_version === "string" ? { pricingVersion: obj.pricing_version } : {}),
    ...(typeof obj.pricing_checked_at === "string" ? { pricingCheckedAt: obj.pricing_checked_at } : {}),
    ...(typeof obj.pricing_updated_at === "string" ? { pricingUpdatedAt: obj.pricing_updated_at } : {}),
  };
  const parsed = parseCatalogPricing(flash, Date.now(), meta);
  if (!parsed) {
    throw new CatalogGateError("flash catalog row malformed", "malformed");
  }
  if (parsed.inputUsdPerMillion > FLASH_INPUT_CEILING || parsed.outputUsdPerMillion > FLASH_OUTPUT_CEILING) {
    throw new CatalogGateError("flash catalog price exceeds ceiling", "price_violation");
  }
  return {
    available: true,
    inputUsdPerMillion: parsed.inputUsdPerMillion,
    outputUsdPerMillion: parsed.outputUsdPerMillion,
    cacheReadUsdPerMillion: parsed.cacheReadUsdPerMillion,
    cacheWriteUsdPerMillion: parsed.cacheWriteUsdPerMillion,
    pricingVersion: parsed.catalogPricingVersion ?? null,
    pricingCheckedAt: parsed.catalogPricingCheckedAt ?? null,
    pricingUpdatedAt: parsed.catalogPricingUpdatedAt ?? null,
  };
}

function readFiniteNumber(value: unknown): number | null {
  const n = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function parseFlashSupplyGate(payload: unknown): {
  candidateCount: number;
  maxInputPerMillion: number;
  maxOutputPerMillion: number;
} {
  if (!payload || typeof payload !== "object") {
    throw new CatalogGateError("supply payload malformed", "malformed");
  }
  const obj = payload as Record<string, unknown>;
  const block =
    obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)
      ? (obj.data as Record<string, unknown>)
      : obj;
  const candidateCount = readFiniteNumber(block.candidate_count);
  const maxInput = readFiniteNumber(block.max_input_per_million);
  const maxOutput = readFiniteNumber(block.max_output_per_million);
  if (candidateCount == null || maxInput == null || maxOutput == null) {
    throw new CatalogGateError("supply payload malformed", "malformed");
  }
  if (candidateCount < 1) {
    throw new CatalogGateError("supply candidate_count is 0", "supply_empty");
  }
  if (maxInput > FLASH_INPUT_CEILING || maxOutput > FLASH_OUTPUT_CEILING) {
    throw new CatalogGateError("supply ceiling violation", "supply_ceiling");
  }
  return {
    candidateCount,
    maxInputPerMillion: maxInput,
    maxOutputPerMillion: maxOutput,
  };
}

export function createOperatorCheaperInferenceTransport(opts?: {
  fetchImpl?: typeof fetch;
}): { post: ProviderPostFn; catalogGet: CatalogGetFn } {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  return {
    catalogGet: async ({ url, headers }) => {
      const res = await fetchImpl(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      let payload: unknown = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }
      return { ok: res.ok, httpStatus: res.status, payload };
    },
    post: async ({ endpoint, headers, body }) => {
      let res: Response;
      try {
        res = await fetchImpl(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(240_000),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "network";
        const timeout = /timeout|aborted/i.test(message);
        return {
          httpStatus: 0,
          model: null,
          promptTokens: 0,
          completionTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          billedCostUsd: null,
          settled: false,
          requestId: null,
          text: "",
          retried: false,
          fallback: false,
          errorCategory: timeout ? "timeout" : "network",
        };
      }
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        return {
          httpStatus: res.status,
          model: null,
          promptTokens: 0,
          completionTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          billedCostUsd: null,
          settled: false,
          requestId: readCompatibleCompletionProviderRequestId({
            provider: "cheaperinference",
            headers: res.headers,
          }),
          text: "",
          retried: false,
          fallback: false,
          errorCategory: "schema",
        };
      }
      return interpretPaidCompletion({
        status: res.status,
        headers: res.headers,
        body: parsed,
      });
    },
  };
}

export type RunnerStatus =
  | "PREPARE_READY"
  | "PREFLIGHT_BLOCKED"
  | "CALL1_BLOCKED"
  | "EARLY_STOP"
  | "EXECUTE_COMPLETE";

export type PaidResultRecord = {
  opaqueLabel: string;
  sceneId: string;
  generatedText: string;
  outputChars: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  billedCostUsd: number | null;
  requestIdSha256: string | null;
  httpStatus: number;
  settled: boolean;
  model: string | null;
  attemptNumber: number;
  errorCategory?: string;
};

export type BlindReveal = {
  nonce: string;
  commitmentSha256: string;
  mapping: Array<{
    opaqueLabel: string;
    sceneId: string;
    variant: ExperimentVariant;
  }>;
};

export type RunnerArtifact = {
  status: RunnerStatus;
  mode: RunnerMode;
  productionDeploySha: string | null;
  modelId: typeof BODY_CUE_1354_MODEL;
  liveInput: LiveSealReport;
  scenes: Array<{
    id: string;
    soleAllowedDiff: boolean;
    rulesShaEqual: boolean;
    dynamicShaEqual: boolean;
    promptChars: number;
    flatCharDelta: number;
  }>;
  executionOrder: string[];
  requests: Array<{
    opaqueLabel: string;
    sceneId: string;
    promptSha256: string;
    finalWireSha256: string;
    max_tokens: number;
    min_discount_percent: number;
    model: string;
  }>;
  results: PaidResultRecord[];
  totalSettledBilledUsd: number;
  labelCommitmentSha256: string;
  paidPostCount: number;
  attemptedPostCount: number;
  attemptCount: number;
  retries: 0;
  fallback: 0;
  catalog: {
    url: typeof CHEAPER_INFERENCE_MODELS_SOURCE_URL;
    available: true | null;
    inputUsdPerMillion: number | null;
    outputUsdPerMillion: number | null;
    cacheReadUsdPerMillion: number | null;
    cacheWriteUsdPerMillion: number | null;
    pricingVersion: string | null;
    pricingCheckedAt: string | null;
    pricingUpdatedAt: string | null;
  };
  supply: {
    url: typeof BODY_CUE_1354_SUPPLY_URL;
    min_discount_percent: number;
    candidateCount: number | null;
    maxInputPerMillion: number | null;
    maxOutputPerMillion: number | null;
  };
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

export function assignBlindLabels(requests: ExperimentArmRequest[]): {
  labeled: Array<ExperimentArmRequest & { opaqueLabel: string }>;
  reveal: BlindReveal;
} {
  const used = new Set<string>();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const nextLabel = (prefix: "Q" | "R") => {
    for (let i = 0; i < 32; i += 1) {
      const bytes = randomBytes(2);
      const label = `${prefix}-${alphabet[bytes[0]! % alphabet.length]}${digits[bytes[1]! % digits.length]}`;
      if (!used.has(label)) {
        used.add(label);
        return label;
      }
    }
    throw new Error("failed to allocate opaque label");
  };
  const labeled = requests.map((request) => ({
    ...request,
    opaqueLabel: nextLabel(request.sceneId.startsWith("quiet") ? "Q" : "R"),
  }));
  const nonce = randomBytes(16).toString("hex");
  const mapping = labeled.map((item) => ({
    opaqueLabel: item.opaqueLabel,
    sceneId: item.sceneId,
    variant: item.variant,
  }));
  return {
    labeled,
    reveal: {
      nonce,
      commitmentSha256: sha256Hex(JSON.stringify({ nonce, mapping })),
      mapping,
    },
  };
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

export type RunnerOutput = {
  artifact: RunnerArtifact;
  reveal: BlindReveal;
};

function emptyArtifact(input: {
  mode: RunnerMode;
  seal: LiveSeal;
  labeled: Array<ExperimentArmRequest & { opaqueLabel: string }>;
  reveal: BlindReveal;
  productionDeploySha?: string | null;
}): RunnerArtifact {
  return {
    status: "PREPARE_READY",
    mode: input.mode,
    productionDeploySha: input.productionDeploySha ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
    modelId: BODY_CUE_1354_MODEL,
    liveInput: input.seal.report,
    scenes: sceneSummaries(input.seal.packet),
    executionOrder: input.labeled.map((item) => item.opaqueLabel),
    requests: input.labeled.map((item) => ({
      opaqueLabel: item.opaqueLabel,
      sceneId: item.sceneId,
      promptSha256: item.promptSha256,
      finalWireSha256: item.finalWireSha256,
      max_tokens: BODY_CUE_1354_MAX_TOKENS,
      min_discount_percent: BODY_CUE_1354_MIN_DISCOUNT_PERCENT,
      model: BODY_CUE_1354_MODEL,
    })),
    results: [],
    totalSettledBilledUsd: 0,
    labelCommitmentSha256: input.reveal.commitmentSha256,
    paidPostCount: 0,
    attemptedPostCount: 0,
    attemptCount: 0,
    retries: 0,
    fallback: 0,
    catalog: {
      url: CHEAPER_INFERENCE_MODELS_SOURCE_URL,
      available: null,
      inputUsdPerMillion: null,
      outputUsdPerMillion: null,
      cacheReadUsdPerMillion: null,
      cacheWriteUsdPerMillion: null,
      pricingVersion: null,
      pricingCheckedAt: null,
      pricingUpdatedAt: null,
    },
    supply: {
      url: BODY_CUE_1354_SUPPLY_URL,
      min_discount_percent: BODY_CUE_1354_MIN_DISCOUNT_PERCENT,
      candidateCount: null,
      maxInputPerMillion: null,
      maxOutputPerMillion: null,
    },
  };
}

function recordPaidResult(
  artifact: RunnerArtifact,
  request: ExperimentArmRequest & { opaqueLabel: string },
  result: PaidCallResult,
  attemptNumber: number
): void {
  const keepText = result.httpStatus >= 200 && result.httpStatus < 300 && !result.errorCategory;
  artifact.results.push({
    opaqueLabel: request.opaqueLabel,
    sceneId: request.sceneId,
    generatedText: keepText ? result.text : "",
    outputChars: keepText ? result.text.length : 0,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    cacheReadTokens: result.cacheReadTokens,
    cacheWriteTokens: result.cacheWriteTokens,
    billedCostUsd: result.billedCostUsd,
    requestIdSha256: result.requestId ? sha256Hex(result.requestId) : null,
    httpStatus: result.httpStatus,
    settled: result.settled,
    model: result.model,
    attemptNumber,
    ...(result.errorCategory ? { errorCategory: result.errorCategory } : {}),
  });
  artifact.paidPostCount = artifact.results.length;
  artifact.attemptedPostCount = artifact.results.length;
  artifact.attemptCount = attemptNumber;
  artifact.totalSettledBilledUsd = artifact.results.reduce(
    (sum, item) => sum + (item.settled && item.billedCostUsd != null ? item.billedCostUsd : 0),
    0
  );
}

function resolveExecuteTransport(opts: {
  post?: ProviderPostFn;
  catalogGet?: CatalogGetFn;
  fetchImpl?: typeof fetch;
}): { post: ProviderPostFn; catalogGet: CatalogGetFn } {
  if (opts.post && opts.catalogGet) {
    return { post: opts.post, catalogGet: opts.catalogGet };
  }
  if (opts.post || opts.catalogGet) {
    throw new ExperimentSecretError("execute transport incomplete — fail closed before provider POST");
  }
  return createOperatorCheaperInferenceTransport({ fetchImpl: opts.fetchImpl });
}

function failedPaidCall(partial: Partial<PaidCallResult> & { errorCategory: string }): PaidCallResult {
  return {
    httpStatus: 0,
    model: null,
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    billedCostUsd: null,
    settled: false,
    requestId: null,
    text: "",
    retried: false,
    fallback: false,
    ...partial,
  };
}

export async function runBodyCueFlashAb1354(opts: {
  mode: RunnerMode;
  secretSource: ExperimentSecretSource | null;
  seal: () => LiveSeal;
  post?: ProviderPostFn;
  catalogGet?: CatalogGetFn;
  fetchImpl?: typeof fetch;
  productionDeploySha?: string | null;
  assignLabels?: typeof assignBlindLabels;
}): Promise<RunnerOutput> {
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
  const assignLabels = opts.assignLabels ?? assignBlindLabels;
  const { labeled, reveal } = assignLabels(requests);
  const artifact = emptyArtifact({
    mode: opts.mode,
    seal,
    labeled,
    reveal,
    productionDeploySha: opts.productionDeploySha,
  });

  if (opts.mode !== "execute") {
    secret = null;
    return { artifact, reveal };
  }

  if (!secret) {
    throw new ExperimentSecretError("experiment secret missing — fail closed before provider POST");
  }

  const transport = resolveExecuteTransport(opts);
  const headers = experimentHeaders(secret);
  assertArtifactHasNoSecrets(artifact, [secret]);
  secret = null;

  try {
    const models = await transport.catalogGet({
      url: CHEAPER_INFERENCE_MODELS_SOURCE_URL,
      headers,
    });
    if (!models.ok) {
      throw new CatalogGateError("catalog GET non-ok", "non_ok");
    }
    const catalogEvidence = parseFlashCatalogGate(models.payload);
    artifact.catalog = {
      url: artifact.catalog.url,
      ...catalogEvidence,
    };
    const supply = await transport.catalogGet({
      url: `${BODY_CUE_1354_SUPPLY_URL}?model=${encodeURIComponent(BODY_CUE_1354_MODEL)}&min_discount_percent=${BODY_CUE_1354_MIN_DISCOUNT_PERCENT}`,
      headers,
    });
    if (!supply.ok) {
      throw new CatalogGateError("supply GET non-ok", "non_ok");
    }
    const supplyEvidence = parseFlashSupplyGate(supply.payload);
    artifact.supply = {
      url: artifact.supply.url,
      min_discount_percent: artifact.supply.min_discount_percent,
      ...supplyEvidence,
    };
  } catch (error) {
    artifact.status = "PREFLIGHT_BLOCKED";
    if (error instanceof CatalogGateError) throw error;
    throw new CatalogGateError("catalog/supply gate failed", "malformed");
  }

  const budget = new PaidAttemptBudget();
  const seenRequestIds = new Set<string>();

  const halt = (status: Extract<RunnerStatus, "CALL1_BLOCKED" | "EARLY_STOP">, message: string): never => {
    artifact.status = status;
    throw new RunnerStopError(message, artifact, reveal);
  };

  for (let index = 0; index < labeled.length; index += 1) {
    const request = labeled[index]!;
    const callIndex = index + 1;
    const haltStatus = callIndex === 1 ? "CALL1_BLOCKED" : "EARLY_STOP";
    const attempt = budget.consumeBeforePost();
    let result: PaidCallResult;
    try {
      result = await transport.post({
        endpoint: request.endpoint,
        headers,
        body: request.requestBody,
      });
    } catch {
      recordPaidResult(
        artifact,
        request,
        failedPaidCall({ errorCategory: "network" }),
        attempt
      );
      halt(haltStatus, `CALL ${callIndex} provider post failed`);
    }
    recordPaidResult(artifact, request, result, attempt);
    if (result.requestId) {
      if (seenRequestIds.has(result.requestId)) {
        halt(haltStatus, "duplicate request id");
      }
      seenRequestIds.add(result.requestId);
    }
    try {
      assertPaidCallGate(result, callIndex);
    } catch (error) {
      halt(haltStatus, error instanceof Error ? error.message : `CALL ${callIndex} gate failed`);
    }
  }

  artifact.status = "EXECUTE_COMPLETE";
  return { artifact, reveal };
}

export function defaultProductionDbPath(): string {
  const dataDir = process.env.DATA_DIR?.trim() || "/data";
  return `${dataDir.replace(/\/$/, "")}/app.db`;
}
