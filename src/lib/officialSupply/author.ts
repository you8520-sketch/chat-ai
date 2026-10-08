import "server-only";

import {
  BACKGROUND_OPENROUTER_MODEL,
  callBackgroundMemory,
  resolveBackgroundTextModelId,
} from "@/lib/ai";
import type Database from "better-sqlite3";
import { CompatibleCompletionError } from "@/lib/openRouterCompletion";
import { isAssetPersonTag } from "@/lib/assetPersonTags";
import { isCharacterGenre } from "@/lib/characterGenres";
import { evaluateAppearanceLock } from "@/lib/officialSupply/appearance";
import { evaluateAssetPlan } from "@/lib/officialSupply/assetPlan";
import {
  buildAdultProfileSystem,
  buildAdultProfileUser,
  buildAppearanceSystem,
  buildAppearanceUser,
  buildAssetPlanSystem,
  buildAssetPlanUser,
  buildCharacterBible1System,
  buildCharacterBible1User,
  buildCharacterBondsSystem,
  buildCharacterBondsUser,
  buildCharacterVoiceSystem,
  buildCharacterVoiceUser,
  buildPortfolioReplacementUser,
  buildStyleBoardSystem,
  buildStyleBoardUser,
  buildWorldAtlasUser,
  buildWorldBibleSystem,
  buildWorldCoreUser,
  buildWorldPortfolioUser,
  OFFICIAL_AUTHOR_MAX_TOKENS,
  OFFICIAL_AUTHOR_SNAPSHOT_VERSION,
  OFFICIAL_AUTHOR_TEMPERATURE,
  OFFICIAL_AUTHOR_TEMPLATE_VERSION,
  type AdultProfilePlan,
  type AppearanceInput,
  type AssetPlanInput,
  type CharacterBible1Input,
  type CharacterBondsInput,
  type CharacterVoiceInput,
  type OfficialAuthorTask,
  type PortfolioBriefInput,
  type PortfolioReplacementInput,
  type StyleBoardInput,
  type WorldAtlasInput,
  type WorldBibleInput,
  type WorldPortfolioInput,
} from "@/lib/officialSupply/authorPrompts";
import {
  CHARACTER_BIBLE_1_SCHEMA,
  CHARACTER_BONDS_SCHEMA,
  CHARACTER_VOICE_SCHEMA,
  compileOfficialDraftFromBible,
  validateCharacterBible,
  validateWorldBible,
  WORLD_BIBLE_SCHEMA,
  type OfficialCharacterBible,
  type OfficialWorldBible,
} from "@/lib/officialSupply/bible";
import {
  evaluateAgeAndAdultConsistency,
  evaluateDraftSchema,
  evaluateOfficialTextLength,
  evaluateSupportingNpcs,
  mergeQa,
} from "@/lib/officialSupply/characterText";
import {
  composeOfficialCreatorComment,
  evaluateOfficialCreatorComment,
  evaluateOfficialPlayerGenderNeutral,
  evaluateOfficialPublicDescription,
} from "@/lib/officialSupply/publicProfileText";
import { isOfficialImageSubjects } from "@/lib/officialSupply/imageSubjects";
import { coerceMarketFitBrief } from "@/lib/officialSupply/marketFit";
import { OfficialSupplyGateError } from "@/lib/officialSupply/store";
import { validateStyleProposal } from "@/lib/officialSupply/style";
import {
  OFFICIAL_BACKGROUND_EXTRAS,
  OFFICIAL_FOREGROUND_CASTS,
  OFFICIAL_PARTNER_ROLES,
  qaResult,
  type OfficialAppearanceLock,
  type OfficialAssetPlan,
  type OfficialCharacterDraft,
  type QaResult,
  type VisualStyleCandidate,
} from "@/lib/officialSupply/types";
import {
  evaluateOriginality,
  evaluateSharedLorebook,
  evaluateWorldDiversity,
  type OriginalityCorpusEntry,
} from "@/lib/officialSupply/worldQa";

/**
 * Canonical official-character text author.
 *
 * ONE OWNER: every official text subtask (world bible, character bible
 * halves, appearance, asset plan, style board) runs through this module's
 * transport. No subtask owns its own LLM client, model string, pricing,
 * billing, points, creator reward, chat history, or streaming UI.
 *
 * Generation order (enforced by the pilot script, not by parallel calls):
 * WORLD BIBLE → PORTFOLIO MAP → CHARACTER BIBLE ×10 → deterministic compile
 * (`compileOfficialDraftFromBible`) → QA → appearance → asset plan.
 *
 * Transport reuse (never duplicated here):
 * - model resolver .... `resolveOfficialAuthorModelId` over the canonical
 *   background-text resolver (default `BACKGROUND_OPENROUTER_MODEL`)
 * - provider transport . `callBackgroundMemory` (CheaperInference/OpenRouter
 *   routing, auth, error normalization, usage parsing)
 * - structured output .. `response_format: "json_object"` forwarded by the
 *   canonical completion owner. NOTE (provider constraint, probed 2026-09-26):
 *   large `json_schema` payloads fail CheaperInference routing with
 *   `503 No compatible route`, while `json_object` serves the same request.
 *   Shape discipline therefore lives in code (schema constants + coercion +
 *   canonical QA), never in regex patching.
 * - cost .............. `recordBackgroundProviderCost` inside the canonical
 *   owner (`platform_funded`, background family)
 *
 * Separated (never touched): chat history, user billing/points, creator
 * rewards, streaming UI, user retry semantics, image generation, publishing.
 */

export const OFFICIAL_AUTHOR_REQUEST_KIND = "official-character-author";

/** Model resolver — env override only, never a hardcoded outbound id. */
export function resolveOfficialAuthorModelId(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.OFFICIAL_AUTHOR_MODEL?.trim();
  if (!raw) return BACKGROUND_OPENROUTER_MODEL;
  return resolveBackgroundTextModelId(raw);
}

export type OfficialAuthorRawCompletion = {
  text: string;
  /** Resolved requested model (recorded as provenance). */
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  providerRequestId: string | null;
};

export type OfficialAuthorTransport = {
  readonly label: string;
  completeJson(input: {
    task: OfficialAuthorTask;
    system: string;
    user: string;
    schemaName: string;
    schema: Record<string, unknown>;
    maxTokens?: number;
    temperature?: number;
    modelId?: string;
  }): Promise<OfficialAuthorRawCompletion>;
};

/** Production transport over the canonical background-text owner. */
export const liveOfficialAuthorTransport: OfficialAuthorTransport = {
  label: "live-background",
  async completeJson(input) {
    const model = input.modelId?.trim() || resolveOfficialAuthorModelId();
    const { text, usage } = await callBackgroundMemory(
      input.system,
      [{ role: "user", content: input.user }],
      undefined,
      OFFICIAL_AUTHOR_REQUEST_KIND,
      {
        maxTokens: input.maxTokens ?? OFFICIAL_AUTHOR_MAX_TOKENS[input.task],
        temperature: input.temperature ?? OFFICIAL_AUTHOR_TEMPERATURE[input.task],
        modelId: model,
        // json_object (not json_schema): see provider-constraint note above.
        responseFormat: "json_object",
      }
    );
    const completion: OfficialAuthorRawCompletion = {
      text,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.cheaperInferenceBilledCostUsd ?? usage.upstreamCostUsd ?? null,
      providerRequestId: usage.providerRequestId ?? null,
    };
    if (usage.finishReason === "length") throw new OfficialAuthorTruncatedError(input.task, completion);
    return completion;
  },
};

/** A billed provider response that hit maxTokens — counted as a failed physical attempt, never parsed. */
export class OfficialAuthorTruncatedError extends OfficialSupplyGateError {
  constructor(
    task: OfficialAuthorTask,
    public readonly completion: OfficialAuthorRawCompletion
  ) {
    super("author_truncated", `${task}: output hit maxTokens; split the task instead of patching`);
    this.name = "OfficialAuthorTruncatedError";
  }
}

// ── Physical-attempt cost accounting ─────────────────────────────────────────

export type OfficialAuthorAttemptOutcome = "success" | "provider_failed" | "truncated";

export type OfficialAuthorAttemptLine = {
  task: OfficialAuthorTask;
  draftKey: string | null;
  /** Workflow (step/character) attempt this physical call belonged to. */
  workflowAttempt: number;
  outcome: OfficialAuthorAttemptOutcome;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  error?: string;
};

/**
 * Reporting summary over the canonical cost owner. Every physical provider
 * call is one line — successful completions (billed even if a later QA gate
 * rejects them) and failed attempts are counted separately; workflow retries
 * are counted by the caller once per re-run step, never per line.
 */
export type OfficialAuthorCostReport = {
  version: 2;
  successfulCompletions: number;
  failedProviderAttempts: number;
  physicalAttempts: number;
  workflowRetries: number;
  billedCostUsd: number;
  failedAttemptCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  imageCalls: 0;
  lines: OfficialAuthorAttemptLine[];
};

export function createAuthorCostReport(): OfficialAuthorCostReport {
  return {
    version: 2,
    successfulCompletions: 0,
    failedProviderAttempts: 0,
    physicalAttempts: 0,
    workflowRetries: 0,
    billedCostUsd: 0,
    failedAttemptCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    imageCalls: 0,
    lines: [],
  };
}

function recordAttemptLine(report: OfficialAuthorCostReport, line: OfficialAuthorAttemptLine): void {
  report.lines.push(line);
  report.physicalAttempts += 1;
  report.inputTokens += line.inputTokens;
  report.outputTokens += line.outputTokens;
  const cost = line.costUsd ?? 0;
  if (line.outcome === "success") {
    report.successfulCompletions += 1;
    report.billedCostUsd += cost;
  } else {
    report.failedProviderAttempts += 1;
    report.billedCostUsd += cost;
    report.failedAttemptCostUsd += cost;
  }
}

/** One re-run of a workflow step (character/world/plan), counted once. */
export function recordWorkflowRetry(report: OfficialAuthorCostReport): void {
  report.workflowRetries += 1;
}

/** Wraps a transport so every physical call (success or failure) is recorded exactly once. */
export function withAuthorAccounting(
  inner: OfficialAuthorTransport,
  report: OfficialAuthorCostReport,
  context: { draftKey: string | null; workflowAttempt: number }
): OfficialAuthorTransport {
  return {
    label: `${inner.label}+accounting`,
    async completeJson(input) {
      try {
        const completion = await inner.completeJson(input);
        recordAttemptLine(report, {
          task: input.task,
          draftKey: context.draftKey,
          workflowAttempt: context.workflowAttempt,
          outcome: "success",
          model: completion.model,
          inputTokens: completion.inputTokens,
          outputTokens: completion.outputTokens,
          costUsd: completion.costUsd,
        });
        return completion;
      } catch (error) {
        const truncated = error instanceof OfficialAuthorTruncatedError ? error.completion : null;
        const usage = error instanceof CompatibleCompletionError ? error.usage : null;
        recordAttemptLine(report, {
          task: input.task,
          draftKey: context.draftKey,
          workflowAttempt: context.workflowAttempt,
          outcome: truncated ? "truncated" : "provider_failed",
          model: truncated?.model ?? input.modelId ?? resolveOfficialAuthorModelId(),
          inputTokens: truncated?.inputTokens ?? usage?.inputTokens ?? 0,
          outputTokens: truncated?.outputTokens ?? usage?.outputTokens ?? 0,
          costUsd: truncated?.costUsd ?? usage?.cheaperInferenceBilledCostUsd ?? usage?.upstreamCostUsd ?? null,
          error: String((error as Error)?.message ?? error).slice(0, 200),
        });
        throw error;
      }
    },
  };
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  return (fenced ? fenced[1] : trimmed).trim();
}

/**
 * Strict JSON parse — no regex patching. A model that cannot emit valid JSON
 * is retried at the character level, never repaired with string surgery.
 */
export function parseAuthorJson(rawText: string, task: OfficialAuthorTask): unknown {
  const raw = stripCodeFence(rawText);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new OfficialSupplyGateError("author_json_invalid", `${task}: model did not return valid JSON`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(obj: Record<string, unknown>, key: string, task: string, fieldPath = key): string {
  const value = obj[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new OfficialSupplyGateError("author_shape_invalid", `${task}: ${fieldPath} must be a non-empty string`);
  }
  return value;
}

function optionalStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

const APPEARANCE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    identity: {
      type: "object",
      properties: {
        apparentAgeBand: { type: "string" },
        faceShape: { type: "string" },
        eyes: { type: "string" },
        eyeColor: { type: "string" },
        hair: { type: "string" },
        hairColor: { type: "string" },
        hairLength: { type: "string" },
        heightCm: { type: "number" },
        build: { type: "string" },
        skinTone: { type: "string" },
        identifyingFeatures: { type: "array", items: { type: "string" } },
      },
    },
    outfit: {
      type: "object",
      properties: {
        defaultOutfit: { type: "string" },
        alternateOutfitPolicy: { type: "string" },
      },
    },
    forbiddenDrift: { type: "array", items: { type: "string" } },
  },
};

const ASSET_PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    slots: {
      type: "array",
      items: {
        type: "object",
        properties: {
          slotKey: { type: "string" },
          kind: { type: "string" },
          tag: { type: "string" },
          expression: { type: "string" },
          pose: { type: "string" },
          outfit: { type: "string" },
          location: { type: ["string", "null"] },
          situation: { type: ["string", "null"] },
          characterPresence: { type: "string" },
          imageSubjects: {
            type: "object",
            properties: {
              foreground: { type: "string", enum: [...OFFICIAL_FOREGROUND_CASTS] },
              partnerRole: { type: "string", enum: [...OFFICIAL_PARTNER_ROLES] },
              backgroundExtras: { type: "string", enum: [...OFFICIAL_BACKGROUND_EXTRAS] },
            },
            required: ["foreground", "backgroundExtras"],
          },
          depiction: { type: "string" },
          personTag: { type: ["string", "null"] },
        },
        required: ["imageSubjects"],
      },
    },
  },
};

const STYLE_BOARD_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          candidateId: { type: "string" },
          label: { type: "string" },
          dna: { type: "object" },
          suitability: { type: "object" },
          strengths: { type: "array", items: { type: "string" } },
          references: {
            type: "array",
            items: {
              type: "object",
              properties: {
                url: { type: "string" },
                provenance: { type: "string" },
                note: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

// ── Provenance / cost ────────────────────────────────────────────────────────

export type OfficialAuthorProvenance = {
  model: string;
  requestKind: typeof OFFICIAL_AUTHOR_REQUEST_KIND;
  templateVersion: string;
  snapshotVersion: string;
  attempt: number;
  createdAt: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  providerRequestId: string | null;
};

export function provenanceFor(
  completion: OfficialAuthorRawCompletion,
  attempt: number
): OfficialAuthorProvenance {
  return {
    model: completion.model,
    requestKind: OFFICIAL_AUTHOR_REQUEST_KIND,
    templateVersion: OFFICIAL_AUTHOR_TEMPLATE_VERSION,
    snapshotVersion: OFFICIAL_AUTHOR_SNAPSHOT_VERSION,
    attempt,
    createdAt: new Date().toISOString(),
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
    costUsd: completion.costUsd,
    providerRequestId: completion.providerRequestId,
  };
}

/** Additive provenance table — no existing table is altered. */
export function ensureAuthorRunsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS official_supply_author_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      draft_key TEXT NOT NULL,
      task TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 1,
      model TEXT NOT NULL,
      request_kind TEXT NOT NULL,
      template_version TEXT NOT NULL,
      snapshot_version TEXT NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cost_usd REAL,
      provider_request_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_official_supply_author_runs_draft
      ON official_supply_author_runs(draft_key, task);
  `);
}

export function recordAuthorRun(
  db: Database.Database,
  input: { draftKey: string; task: OfficialAuthorTask; provenance: OfficialAuthorProvenance }
): void {
  ensureAuthorRunsSchema(db);
  db.prepare(
    `INSERT INTO official_supply_author_runs
      (draft_key, task, attempt, model, request_kind, template_version, snapshot_version,
       input_tokens, output_tokens, cost_usd, provider_request_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    input.draftKey,
    input.task,
    input.provenance.attempt,
    input.provenance.model,
    input.provenance.requestKind,
    input.provenance.templateVersion,
    input.provenance.snapshotVersion,
    input.provenance.inputTokens,
    input.provenance.outputTokens,
    input.provenance.costUsd,
    input.provenance.providerRequestId
  );
}

// ── World bible ──────────────────────────────────────────────────────────────

function isRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

/** Portfolio briefs from model JSON; manifest slot genders always win. */
function coercePortfolioBriefs(
  raw: unknown,
  task: OfficialAuthorTask,
  slotGenders?: readonly ("male" | "female" | "other")[]
): PortfolioBriefInput[] {
  return isRecordArray(raw).map((brief, i) => {
    const slot = typeof brief.slot === "number" ? Math.round(brief.slot) : i + 1;
    const fixed = slotGenders?.[slot - 1];
    const gender: PortfolioBriefInput["gender"] =
      fixed ?? (brief.gender === "female" || brief.gender === "other" ? brief.gender : "male");
    const audience: PortfolioBriefInput["audience"] =
      brief.audience === "male" || brief.audience === "all" ? brief.audience : "female";
    return {
      slot,
      name: requiredString(brief, "name", task),
      gender,
      age: typeof brief.age === "number" ? Math.round(brief.age) : 0,
      archetype: requiredString(brief, "archetype", task),
      relationshipTrope: requiredString(brief, "relationshipTrope", task),
      occupation: requiredString(brief, "occupation", task),
      faction: typeof brief.faction === "string" ? brief.faction : "",
      socialPosition: typeof brief.socialPosition === "string" ? brief.socialPosition : "",
      personalityCore: typeof brief.personalityCore === "string" ? brief.personalityCore : "",
      visualSilhouette: typeof brief.visualSilhouette === "string" ? brief.visualSilhouette : "",
      rpHook: requiredString(brief, "rpHook", task),
      adultCandidate: brief.adultCandidate === true,
      speechDirection: typeof brief.speechDirection === "string" ? brief.speechDirection : "",
      audience,
      marketFit: coerceMarketFitBrief(brief.marketFit),
    };
  });
}

/**
 * Re-plan specific portfolio slots inside an existing world (world fields and
 * every other brief untouched). Gender and adult candidacy come from the
 * manifest plan, not the model.
 */
export async function generateOfficialPortfolioReplacement(input: {
  transport: OfficialAuthorTransport;
  replacement: PortfolioReplacementInput;
  modelId?: string;
}): Promise<{ briefs: PortfolioBriefInput[]; completion: OfficialAuthorRawCompletion }> {
  const completion = await input.transport.completeJson({
    task: "world_bible",
    system: buildWorldBibleSystem(),
    user: buildPortfolioReplacementUser(input.replacement),
    schemaName: "official_world_bible",
    schema: WORLD_BIBLE_SCHEMA,
    modelId: input.modelId,
  });
  const data = parseAuthorJson(completion.text, "world_bible");
  if (!isRecord(data) || !Array.isArray(data.portfolio)) {
    throw new OfficialSupplyGateError("author_shape_invalid", "portfolio replacement: portfolio array required");
  }
  const plan = new Map(input.replacement.slots.map((s) => [s.slot, s] as const));
  const genders: ("male" | "female" | "other")[] = [];
  for (const s of input.replacement.slots) genders[s.slot - 1] = s.gender;
  const briefs = coercePortfolioBriefs(data.portfolio, "world_bible", genders)
    .filter((b) => plan.has(b.slot))
    .map((b) => ({ ...b, adultCandidate: plan.get(b.slot)!.adultCandidate }));
  const got = new Set(briefs.map((b) => b.slot));
  const missing = input.replacement.slots.filter((s) => !got.has(s.slot)).map((s) => s.slot);
  if (missing.length || briefs.length !== plan.size) {
    throw new OfficialSupplyGateError("author_shape_invalid", `portfolio replacement: slots ${missing.join(",") || "duplicated"} missing`);
  }
  return { briefs, completion };
}

function coerceWorldBible(
  data: unknown,
  opts: { slotGenders?: ("male" | "female" | "other")[] } = {}
): OfficialWorldBible {
  const task = "world_bible";
  if (!isRecord(data)) throw new OfficialSupplyGateError("author_shape_invalid", `${task}: top-level object required`);
  const str = (key: string): string => requiredString(data, key, task);
  const situation = isRecord(data.situation) ? data.situation : {};
  const powerSystem = isRecord(data.powerSystem) ? data.powerSystem : {};
  const knowledge = isRecord(data.knowledge) ? data.knowledge : {};
  const userEntry = isRecord(data.userEntry) ? data.userEntry : {};
  const society = isRecord(data.society) ? data.society : {};
  const societyOut: Record<string, string> = {};
  for (const [key, value] of Object.entries(society)) {
    if (typeof value === "string" && value.trim()) societyOut[key] = value;
  }
  const portfolio = coercePortfolioBriefs(data.portfolio, task, opts.slotGenders);
  return {
    name: str("name"),
    genre: str("genre"),
    subgenre: typeof data.subgenre === "string" ? data.subgenre : "",
    tone: str("tone"),
    era: str("era"),
    techLevel: typeof data.techLevel === "string" ? data.techLevel : "",
    regions: str("regions"),
    societyForm: typeof data.societyForm === "string" ? data.societyForm : "",
    premise: str("premise"),
    centralPremise: str("centralPremise"),
    situation: {
      biggestEvent: String(situation.biggestEvent ?? ""),
      beneficiaries: String(situation.beneficiaries ?? ""),
      threatened: String(situation.threatened ?? ""),
      upcomingChange: String(situation.upcomingChange ?? ""),
    },
    factions: isRecordArray(data.factions).map((f) => ({
      name: String(f.name ?? ""),
      purpose: String(f.purpose ?? ""),
      leadership: String(f.leadership ?? ""),
      means: String(f.means ?? ""),
      relations: String(f.relations ?? ""),
      publicView: String(f.publicView ?? ""),
    })),
    powerSystem: {
      capabilities: String(powerSystem.capabilities ?? ""),
      users: String(powerSystem.users ?? ""),
      acquisition: String(powerSystem.acquisition ?? ""),
      ranks: String(powerSystem.ranks ?? ""),
      limits: String(powerSystem.limits ?? ""),
      costs: String(powerSystem.costs ?? ""),
      socialImpact: String(powerSystem.socialImpact ?? ""),
      taboos: String(powerSystem.taboos ?? ""),
    },
    society: societyOut,
    culture: isRecordArray(data.culture).map((c) => ({
      name: String(c.name ?? ""),
      detail: String(c.detail ?? ""),
    })),
    locations: isRecordArray(data.locations).map((location) => ({
      name: String(location.name ?? ""),
      purpose: String(location.purpose ?? ""),
      mood: String(location.mood ?? ""),
      users: String(location.users ?? ""),
      rpEvents: String(location.rpEvents ?? ""),
    })),
    history: isRecordArray(data.history).map((h) => ({
      event: String(h.event ?? ""),
      impact: String(h.impact ?? ""),
    })),
    knowledge: {
      common: optionalStringArray(knowledge.common),
      faction: optionalStringArray(knowledge.faction),
      characterLocal: optionalStringArray(knowledge.characterLocal),
      authorOnly: optionalStringArray(knowledge.authorOnly),
    },
    userEntry: {
      allowedRoles: optionalStringArray(userEntry.allowedRoles),
      note: typeof userEntry.note === "string" ? userEntry.note : "",
    },
    lorebook: isRecordArray(data.lorebook).map((entry, index) => ({
      entryKey:
        typeof entry.entryKey === "string" && entry.entryKey.trim() ? entry.entryKey : `lore-${index + 1}`,
      name: requiredString(entry, "name", task),
      keywords: optionalStringArray(entry.keywords),
      content: requiredString(entry, "content", task),
    })),
    portfolio,
  };
}

export async function generateOfficialWorldBible(input: {
  transport: OfficialAuthorTransport;
  world: WorldBibleInput;
  modelId?: string;
  attempt?: number;
}): Promise<{
  bible: OfficialWorldBible;
  provenances: [OfficialAuthorProvenance, OfficialAuthorProvenance, OfficialAuthorProvenance];
  completions: [OfficialAuthorRawCompletion, OfficialAuthorRawCompletion, OfficialAuthorRawCompletion];
}> {
  // Provider constraint: one giant world call never completes on the
  // background route (503). Three sequential structured calls (core → atlas
  // → portfolio) stay inside the proven output budget; the merged bible gets
  // the same deterministic QA as a single call would.
  const system = buildWorldBibleSystem();
  const complete = (user: string): Promise<OfficialAuthorRawCompletion> =>
    input.transport.completeJson({
      task: "world_bible",
      system,
      user,
      schemaName: "official_world_bible",
      schema: WORLD_BIBLE_SCHEMA,
      modelId: input.modelId,
    });
  const coreCompletion = await complete(buildWorldCoreUser(input.world));
  const coreData = parseAuthorJson(coreCompletion.text, "world_bible");
  if (!isRecord(coreData)) throw new OfficialSupplyGateError("author_shape_invalid", "world_bible core: object required");
  const worldName = requiredString(coreData, "name", "world_bible");
  const centralPremise = requiredString(coreData, "centralPremise", "world_bible");
  const factionNames = (Array.isArray(coreData.factions) ? coreData.factions : [])
    .filter(isRecord)
    .map((f) => String(f.name ?? "").trim())
    .filter(Boolean);

  const atlasInput: WorldAtlasInput = { worldName, centralPremise, factionNames };
  const atlas = await complete(buildWorldAtlasUser(atlasInput));
  const atlasData = parseAuthorJson(atlas.text, "world_bible");
  if (!isRecord(atlasData)) throw new OfficialSupplyGateError("author_shape_invalid", "world_bible atlas: object required");
  const locationNames = (Array.isArray(atlasData.locations) ? atlasData.locations : [])
    .filter(isRecord)
    .map((location) => String(location.name ?? "").trim())
    .filter(Boolean);

  const portfolioInput: WorldPortfolioInput = {
    worldName,
    centralPremise,
    factionNames,
    locationNames,
    slots: input.world.slots,
    adultCandidates: input.world.adultCandidates,
    genderMix: input.world.genderMix,
    slotGenders: input.world.slotGenders,
    market: input.world.market,
    castIntent: input.world.castIntent,
  };
  const portfolioCompletion = await complete(buildWorldPortfolioUser(portfolioInput));
  const portfolioData = parseAuthorJson(portfolioCompletion.text, "world_bible");
  if (!isRecord(portfolioData) || !Array.isArray(portfolioData.portfolio)) {
    throw new OfficialSupplyGateError("author_shape_invalid", "world_bible portfolio: portfolio array required");
  }

  const bible = (() => {
    try {
      return coerceWorldBible(
        { ...coreData, ...atlasData, portfolio: portfolioData.portfolio },
        { slotGenders: input.world.slotGenders }
      );
    } catch (error) {
      const keys = [
        ...Object.keys(isRecord(coreData) ? coreData : {}),
        ...Object.keys(isRecord(atlasData) ? atlasData : {}),
      ].join(",");
      throw new OfficialSupplyGateError(
        "author_shape_invalid",
        `${(error as Error).message} (top keys: ${keys})`
      );
    }
  })();
  if (bible.portfolio.length !== input.world.slots) {
    throw new OfficialSupplyGateError(
      "author_shape_invalid",
      `world_bible: ${bible.portfolio.length} briefs, ${input.world.slots} required`
    );
  }
  const qa = validateWorldBible(bible, {
    slots: input.world.slots,
    adultCandidates: input.world.adultCandidates,
  });
  if (!qa.ok) throw new OfficialSupplyGateError("author_world_rejected", "world bible failed QA", qa);
  const attempt = input.attempt ?? 1;
  return {
    bible,
    provenances: [
      provenanceFor(coreCompletion, attempt * 10 + 1),
      provenanceFor(atlas, attempt * 10 + 2),
      provenanceFor(portfolioCompletion, attempt * 10 + 3),
    ],
    completions: [coreCompletion, atlas, portfolioCompletion],
  };
}

// ── Character bible halves → assembled bible ─────────────────────────────────

function coerceNpc(raw: unknown, index: number): OfficialCharacterBible["npcs"][number] {
  const task = "character_bible_voice";
  if (!isRecord(raw)) {
    throw new OfficialSupplyGateError("author_shape_invalid", `${task}: npcs[${index}] invalid`);
  }
  return {
    name: requiredString(raw, "name", task, `npcs[${index}].name`),
    age: typeof raw.age === "number" ? Math.round(raw.age) : null,
    heightCm: typeof raw.heightCm === "number" ? Math.round(raw.heightCm) : null,
    appearance: typeof raw.appearance === "string" ? raw.appearance : "",
    personalityKeywords: optionalStringArray(raw.personalityKeywords),
    role: requiredString(raw, "role", task, `npcs[${index}].role`),
    relationToChar: requiredString(raw, "relationToChar", task, `npcs[${index}].relationToChar`),
    speech: typeof raw.speech === "string" ? raw.speech : "",
    adultEligible: raw.adultEligible === true,
  };
}

/** Voice NPC required strings — same coerce as assemble, before Bonds is billed. */
function assertVoiceNpcShape(voiceHalf: Record<string, unknown>): void {
  const npcs = Array.isArray(voiceHalf.npcs) ? voiceHalf.npcs : [];
  for (const [index, npc] of npcs.entries()) coerceNpc(npc, index);
}

export async function generateOfficialCharacterBible(input: {
  transport: OfficialAuthorTransport;
  part1: CharacterBible1Input;
  voice: Omit<CharacterVoiceInput, "part1Recap"> & { part1Recap?: string };
  bonds: Omit<CharacterBondsInput, "part1Recap"> & { part1Recap?: string };
  modelId?: string;
}): Promise<{
  bible: OfficialCharacterBible;
  completions: [OfficialAuthorRawCompletion, OfficialAuthorRawCompletion, OfficialAuthorRawCompletion];
}> {
  const first = await input.transport.completeJson({
    task: "character_bible_1",
    system: buildCharacterBible1System(),
    user: buildCharacterBible1User(input.part1),
    schemaName: "official_character_bible_1",
    schema: CHARACTER_BIBLE_1_SCHEMA,
    modelId: input.modelId,
  });
  const half1 = parseAuthorJson(first.text, "character_bible_1");
  if (!isRecord(half1)) throw new OfficialSupplyGateError("author_shape_invalid", "character_bible_1: object required");

  const recap = buildPart1Recap(half1);
  const second = await input.transport.completeJson({
    task: "character_bible_voice",
    system: buildCharacterVoiceSystem(),
    user: buildCharacterVoiceUser({ ...input.voice, part1Recap: input.voice.part1Recap ?? recap }),
    schemaName: "official_character_bible_voice",
    schema: CHARACTER_VOICE_SCHEMA,
    modelId: input.modelId,
  });
  const voiceHalf = parseAuthorJson(second.text, "character_bible_voice");
  if (!isRecord(voiceHalf)) {
    throw new OfficialSupplyGateError("author_shape_invalid", "character_bible_voice: object required");
  }
  assertVoiceNpcShape(voiceHalf);
  const third = await input.transport.completeJson({
    task: "character_bible_bonds",
    system: buildCharacterBondsSystem(),
    user: buildCharacterBondsUser({ ...input.bonds, part1Recap: input.bonds.part1Recap ?? recap }),
    schemaName: "official_character_bible_bonds",
    schema: CHARACTER_BONDS_SCHEMA,
    modelId: input.modelId,
  });
  const bondsHalf = parseAuthorJson(third.text, "character_bible_bonds");
  if (!isRecord(bondsHalf)) {
    throw new OfficialSupplyGateError("author_shape_invalid", "character_bible_bonds: object required");
  }

  const bible = assembleOfficialCharacterBible(half1, voiceHalf, bondsHalf);
  return {
    bible: { ...bible, promptStandard: "compact_rp_v1" },
    completions: [first, second, third],
  };
}

function buildPart1Recap(half1: Record<string, unknown>): string {
  const identity = isRecord(half1.identity) ? half1.identity : {};
  const personality = isRecord(half1.personality) ? half1.personality : {};
  return [
    typeof identity === "object" ? String(identity.name ?? "") : "",
    isRecord(personality) ? String(personality.behavioral ?? "").slice(0, 400) : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 800);
}

function strArray(value: unknown): string[] {
  return optionalStringArray(value);
}

export type OfficialVoiceRevisionField = "greeting" | "publicDescription" | "speech" | "tags";

/**
 * Minimal voice correction: re-runs ONLY the voice third and copies back only
 * the fields named in `fields`. Part1 (identity, appearance source,
 * personality, backstory, abilities, habits), bonds, NPCs and tagline are
 * never touched; tags only when named.
 */
export async function reviseOfficialCharacterVoice(input: {
  transport: OfficialAuthorTransport;
  bible: OfficialCharacterBible;
  voice: Omit<CharacterVoiceInput, "part1Recap" | "feedback">;
  fields: readonly OfficialVoiceRevisionField[];
  reasons: string[];
  modelId?: string;
}): Promise<{ bible: OfficialCharacterBible; completion: OfficialAuthorRawCompletion }> {
  const current = input.bible;
  const keep = [
    input.fields.includes("greeting") ? "" : `greeting는 기존 그대로 두어도 된다.`,
    input.fields.includes("publicDescription")
      ? `기존 publicProfile.description(같은 인물·관계를 유지하고 반려 사유만 고친다): ${current.publicProfile.description}`
      : "",
    input.fields.includes("greeting")
      ? `기존 greeting(같은 장면·훅·목소리를 유지하고 반려 사유만 고친다, 분량 채우기 반복 금지):\n${current.greeting}`
      : "",
    input.fields.includes("tags")
      ? `기존 tags(바이블 본문에 실제로 있는 경험·관계·직업으로만 교체한다): ${current.publicProfile.tags.join(", ")}`
      : "",
  ].filter(Boolean);
  const completion = await input.transport.completeJson({
    task: "character_bible_voice",
    system: buildCharacterVoiceSystem(),
    user: buildCharacterVoiceUser({
      ...input.voice,
      part1Recap: buildPart1Recap(current as unknown as Record<string, unknown>),
      feedback: [...input.reasons, ...keep].join("\n"),
    }),
    schemaName: "official_character_bible_voice",
    schema: CHARACTER_VOICE_SCHEMA,
    modelId: input.modelId,
  });
  const voiceHalf = parseAuthorJson(completion.text, "character_bible_voice");
  if (!isRecord(voiceHalf)) throw new OfficialSupplyGateError("author_shape_invalid", "character_bible_voice: object required");
  const self = current as unknown as Record<string, unknown>;
  const fresh = assembleOfficialCharacterBible(self, { ...voiceHalf, npcs: current.npcs }, self);
  const next: OfficialCharacterBible = {
    ...current,
    greeting: input.fields.includes("greeting") ? fresh.greeting : current.greeting,
    publicProfile: {
      ...current.publicProfile,
      description: input.fields.includes("publicDescription") ? fresh.publicProfile.description : current.publicProfile.description,
      tags: input.fields.includes("tags") ? fresh.publicProfile.tags : current.publicProfile.tags,
    },
    speech: input.fields.includes("speech") ? { ...fresh.speech } : current.speech,
  };
  return { bible: next, completion };
}

/**
 * Minimal adult correction: rewrites ONLY `adultSection` toward a pilot-scoped,
 * character-fit plan. Age, orientation and the canonical consent enums stay
 * owned by the plan/validator; SFW sheets are rejected outright.
 */
export async function reviseOfficialAdultProfile(input: {
  transport: OfficialAuthorTransport;
  bible: OfficialCharacterBible;
  participantMinAge: number;
  plan: AdultProfilePlan;
  siblingDynamics: string[];
  feedback?: string;
  modelId?: string;
}): Promise<{ bible: OfficialCharacterBible; completion: OfficialAuthorRawCompletion }> {
  const current = input.bible;
  if (!current.nsfw || !current.adultSection) {
    throw new OfficialSupplyGateError("adult_revision_on_sfw", `${current.identity.name} is not an adult sheet`);
  }
  const recap = [
    `성격: ${current.personality.keywords.join(", ")}`,
    `내적 모순: ${current.contradiction}`,
    `말투: ${current.speech.keywords.join(", ")} — 친밀할 때 ${current.speech.intimateStyle}`,
    `유저 관계: ${current.userRelationship.progression.join(" → ")}`,
  ].join("\n");
  const completion = await input.transport.completeJson({
    task: "adult_profile",
    system: buildAdultProfileSystem(),
    user: buildAdultProfileUser({
      name: current.identity.name,
      age: current.identity.age,
      participantMinAge: input.participantMinAge,
      orientation: current.adultSection.orientation,
      characterRecap: recap,
      plan: input.plan,
      siblingDynamics: input.siblingDynamics,
      feedback: input.feedback,
    }),
    schemaName: "official_adult_profile",
    schema: { type: "object", properties: { adultSection: { type: "object" } } },
    modelId: input.modelId,
  });
  const data = parseAuthorJson(completion.text, "adult_profile");
  const raw = isRecord(data) && isRecord(data.adultSection) ? data.adultSection : null;
  if (!raw) throw new OfficialSupplyGateError("author_shape_invalid", "adult_profile: adultSection object required");
  const next: OfficialCharacterBible = {
    ...current,
    adultSection: {
      // Orientation and the canonical enums come from the existing sheet / plan, never the model.
      orientation: current.adultSection.orientation,
      hookSummary: String(raw.hookSummary ?? ""),
      dialogueProfile: input.plan.dialogueProfile,
      consentModes: [...input.plan.consentModes],
      tone: String(raw.tone ?? ""),
      preferenceKeywords: strArray(raw.preferenceKeywords),
      boundaries: strArray(raw.boundaries),
      consentBehavior: String(raw.consentBehavior ?? ""),
      scenarioExamples: strArray(raw.scenarioExamples),
    },
  };
  return { bible: next, completion };
}

/** Merge the three structured thirds into one validated-shape bible. */
export function assembleOfficialCharacterBible(
  half1: Record<string, unknown>,
  voiceHalf: Record<string, unknown>,
  bondsHalf: Record<string, unknown>
): OfficialCharacterBible {
  const task = "character_bible_1";
  const voiceTask = "character_bible_voice";
  const bondsTask = "character_bible_bonds";
  const identity = isRecord(half1.identity) ? half1.identity : {};
  const appearance = isRecord(half1.appearance) ? half1.appearance : {};
  const personality = isRecord(half1.personality) ? half1.personality : {};
  const values = isRecord(half1.values) ? half1.values : {};
  const backstory = isRecord(half1.backstory) ? half1.backstory : {};
  const habits = isRecord(half1.habits) ? half1.habits : {};
  const situation = isRecord(half1.situation) ? half1.situation : {};
  const speech = isRecord(voiceHalf.speech) ? voiceHalf.speech : {};
  const userRelationship = isRecord(bondsHalf.userRelationship) ? bondsHalf.userRelationship : {};
  const rpEngine = isRecord(bondsHalf.rpEngine) ? bondsHalf.rpEngine : {};
  const publicProfile = isRecord(voiceHalf.publicProfile) ? voiceHalf.publicProfile : {};
  const adultSection = isRecord(bondsHalf.adultSection) ? bondsHalf.adultSection : null;
  const nsfw = voiceHalf.nsfw === true || bondsHalf.nsfw === true;
  const gender = identity.gender === "female" || identity.gender === "other" ? identity.gender : "male";
  return {
    identity: {
      name: requiredString(identity, "name", task),
      gender,
      age: typeof identity.age === "number" ? Math.round(identity.age) : 0,
      apparentAge: typeof identity.apparentAge === "string" ? identity.apparentAge : "",
      heightCm: typeof identity.heightCm === "number" ? Math.round(identity.heightCm) : 0,
      species: typeof identity.species === "string" ? identity.species : "",
      occupation: requiredString(identity, "occupation", task),
      socialPosition: requiredString(identity, "socialPosition", task),
      affiliation: typeof identity.affiliation === "string" ? identity.affiliation : "",
      worldRole: requiredString(identity, "worldRole", task),
    },
    appearance: {
      faceShape: String(appearance.faceShape ?? ""),
      eyes: String(appearance.eyes ?? ""),
      eyeColor: String(appearance.eyeColor ?? ""),
      hairColor: String(appearance.hairColor ?? ""),
      hairstyle: String(appearance.hairstyle ?? ""),
      hairLength: String(appearance.hairLength ?? ""),
      skin: String(appearance.skin ?? ""),
      build: String(appearance.build ?? ""),
      musculature: String(appearance.musculature ?? ""),
      distinguishingFeatures: String(appearance.distinguishingFeatures ?? ""),
      usualExpression: String(appearance.usualExpression ?? ""),
      defaultOutfit: String(appearance.defaultOutfit ?? ""),
      accessories: String(appearance.accessories ?? ""),
      impression: String(appearance.impression ?? ""),
    },
    personality: {
      keywords: strArray(personality.keywords),
      behavioral: typeof personality.behavioral === "string" ? personality.behavioral : "",
    },
    contradiction: typeof half1.contradiction === "string" ? half1.contradiction : "",
    values: {
      desires: strArray(values.desires),
      fears: strArray(values.fears),
      coreValues: strArray(values.coreValues),
      nonNegotiable: strArray(values.nonNegotiable),
    },
    backstory: {
      events: (Array.isArray(backstory.events) ? backstory.events : []).filter(isRecord).map((e) => ({
        event: String(e.event ?? ""),
        choice: String(e.choice ?? ""),
        residue: String(e.residue ?? ""),
      })),
    },
    abilities: (Array.isArray(half1.abilities) ? half1.abilities : []).filter(isRecord).map((a) => ({
      name: String(a.name ?? ""),
      scope: String(a.scope ?? ""),
      level: String(a.level ?? ""),
      limit: String(a.limit ?? ""),
      cost: String(a.cost ?? ""),
      usage: String(a.usage ?? ""),
    })),
    habits: {
      hobbies: strArray(habits.hobbies),
      habits: strArray(habits.habits),
      likes: strArray(habits.likes),
      dislikes: strArray(habits.dislikes),
    },
    dailyLife: typeof half1.dailyLife === "string" ? half1.dailyLife : "",
    situation: {
      worldContext: String(situation.worldContext ?? ""),
      personalSituation: String(situation.personalSituation ?? ""),
      userEntry: String(situation.userEntry ?? ""),
    },
    speech: {
      register: String(speech.register ?? ""),
      sentenceLength: String(speech.sentenceLength ?? ""),
      tempo: String(speech.tempo ?? ""),
      vocabulary: String(speech.vocabulary ?? ""),
      frequentPhrases: strArray(speech.frequentPhrases),
      rarePhrases: strArray(speech.rarePhrases),
      profanity: String(speech.profanity ?? ""),
      humorStyle: String(speech.humorStyle ?? ""),
      addressStyle: String(speech.addressStyle ?? ""),
      hiddenEmotionStyle: String(speech.hiddenEmotionStyle ?? ""),
      angryStyle: String(speech.angryStyle ?? ""),
      intimateStyle: String(speech.intimateStyle ?? ""),
      keywords: strArray(speech.keywords),
      description: String(speech.description ?? ""),
      examples: String(speech.examples ?? ""),
      forbidden: String(speech.forbidden ?? ""),
    },
    behaviorRules: strArray(voiceHalf.behaviorRules),
    userRelationship: {
      initialView: String(userRelationship.initialView ?? ""),
      userRole: String(userRelationship.userRole ?? ""),
      startingPoint: String(userRelationship.startingPoint ?? ""),
      progression: strArray(userRelationship.progression),
    },
    otherRelationships: (Array.isArray(bondsHalf.otherRelationships) ? bondsHalf.otherRelationships : [])
      .filter(isRecord)
      .map((rel) => ({
        target: String(rel.target ?? ""),
        public: String(rel.public ?? ""),
        privateOpinion: String(rel.privateOpinion ?? ""),
        hidden: String(rel.hidden ?? ""),
      })),
    secrets: strArray(bondsHalf.secrets),
    rpEngine: {
      immediateHook: String(rpEngine.immediateHook ?? ""),
      repeatable: strArray(rpEngine.repeatable),
      mediumConflict: String(rpEngine.mediumConflict ?? ""),
      longTermChange: String(rpEngine.longTermChange ?? ""),
    },
    greeting: typeof voiceHalf.greeting === "string" ? voiceHalf.greeting : "",
    publicProfile: {
      tagline: String(publicProfile.tagline ?? ""),
      description: String(publicProfile.description ?? ""),
      tags: strArray(publicProfile.tags),
    },
    npcs: (Array.isArray(voiceHalf.npcs) ? voiceHalf.npcs : []).map((npc, index) => coerceNpc(npc, index)),
    nsfw,
    adultSection: adultSection
      ? {
          orientation: String(adultSection.orientation ?? ""),
          hookSummary: String(adultSection.hookSummary ?? ""),
          dialogueProfile: String(adultSection.dialogueProfile ?? ""),
          consentModes: strArray(adultSection.consentModes),
          tone: String(adultSection.tone ?? ""),
          preferenceKeywords: strArray(adultSection.preferenceKeywords),
          boundaries: strArray(adultSection.boundaries),
          consentBehavior: String(adultSection.consentBehavior ?? ""),
          scenarioExamples: strArray(adultSection.scenarioExamples),
        }
      : null,
  };
}

/**
 * TEXT_LOCK-equivalent QA for a compiled draft (mirrors `store.lockText`
 * minus the DB write and the canonical-save dry run, which the pilot test
 * runs separately through `parseCharacterFormBody`).
 */
export function validatePilotDraftForTextLock(
  draft: OfficialCharacterDraft,
  siblings: readonly OfficialCharacterDraft[],
  corpus: readonly OriginalityCorpusEntry[] = [],
  worldTerms: readonly string[] = []
): QaResult {
  return mergeQa(
    evaluateDraftSchema(draft),
    evaluateOfficialTextLength(draft),
    evaluateSupportingNpcs(draft),
    evaluateAgeAndAdultConsistency(draft),
    evaluateOfficialPublicDescription(draft.description, draft.name),
    evaluateOfficialCreatorComment(composeOfficialCreatorComment(draft), draft.description),
    evaluateOfficialPlayerGenderNeutral({ greeting: draft.greeting }),
    evaluateWorldDiversity([draft, ...siblings]),
    evaluateOriginality(draft, corpus, worldTerms)
  );
}

export function validatePilotBible(
  bible: OfficialCharacterBible,
  opts: { adultExpected: boolean }
): QaResult {
  return validateCharacterBible(bible, opts);
}

export function validatePilotLorebook(
  entries: OfficialWorldBible["lorebook"],
  drafts: readonly OfficialCharacterDraft[]
): QaResult {
  return evaluateSharedLorebook(entries, drafts);
}

// ── Appearance / asset plan / style board ────────────────────────────────────

const AGE_BANDS = new Set([
  "early_20s",
  "mid_20s",
  "late_20s",
  "30s",
  "40s",
  "50_plus",
  "ageless_adult",
]);

export async function generateOfficialAppearanceLock(input: {
  transport: OfficialAuthorTransport;
  appearance: AppearanceInput;
  modelId?: string;
}): Promise<{ lock: OfficialAppearanceLock; completion: OfficialAuthorRawCompletion }> {
  const completion = await input.transport.completeJson({
    task: "appearance",
    system: buildAppearanceSystem(),
    user: buildAppearanceUser(input.appearance),
    schemaName: "official_appearance_lock",
    schema: APPEARANCE_SCHEMA,
    modelId: input.modelId,
  });
  const data = parseAuthorJson(completion.text, "appearance");
  if (!isRecord(data) || !isRecord(data.identity) || !isRecord(data.outfit)) {
    throw new OfficialSupplyGateError("author_shape_invalid", "appearance: identity + outfit required");
  }
  const id = data.identity;
  const band = typeof id.apparentAgeBand === "string" && AGE_BANDS.has(id.apparentAgeBand) ? id.apparentAgeBand : "";
  if (!band) throw new OfficialSupplyGateError("author_shape_invalid", "appearance: apparentAgeBand invalid");
  const lock: OfficialAppearanceLock = {
    identity: {
      apparentAgeBand: band as OfficialAppearanceLock["identity"]["apparentAgeBand"],
      faceShape: String(id.faceShape ?? ""),
      eyes: String(id.eyes ?? ""),
      eyeColor: String(id.eyeColor ?? ""),
      hair: String(id.hair ?? ""),
      hairColor: String(id.hairColor ?? ""),
      hairLength: String(id.hairLength ?? ""),
      heightCm: typeof id.heightCm === "number" ? Math.round(id.heightCm) : 0,
      build: String(id.build ?? ""),
      skinTone: String(id.skinTone ?? ""),
      identifyingFeatures: optionalStringArray(id.identifyingFeatures),
    },
    outfit: {
      defaultOutfit: String(data.outfit.defaultOutfit ?? ""),
      alternateOutfitPolicy: String(data.outfit.alternateOutfitPolicy ?? ""),
    },
    forbiddenDrift: optionalStringArray(data.forbiddenDrift),
  };
  return { lock, completion };
}

const ASSET_SLOT_KINDS = new Set(["representative", "signature", "emotion", "scene"]);
const ASSET_DEPICTIONS = new Set(["standard", "adult_grounded_non_explicit"]);

const PROMPT_TIER_LABEL_RE = /^\s*(?:PRIMARY|SECONDARY|EXCEPTIONAL)(?:\s*장소)?\s*[:：]\s*/i;

/** The planner prompt groups locations under tier labels; a copied label is not part of the place name. */
export function stripPromptTierLabel(location: string): string {
  return location.replace(PROMPT_TIER_LABEL_RE, "");
}

export async function generateOfficialAssetPlan(input: {
  transport: OfficialAuthorTransport;
  plan: AssetPlanInput;
  modelId?: string;
}): Promise<{ plan: OfficialAssetPlan; completion: OfficialAuthorRawCompletion }> {
  const completion = await input.transport.completeJson({
    task: "asset_plan",
    system: buildAssetPlanSystem(),
    user: buildAssetPlanUser(input.plan),
    schemaName: "official_asset_plan",
    schema: ASSET_PLAN_SCHEMA,
    modelId: input.modelId,
  });
  const data = parseAuthorJson(completion.text, "asset_plan");
  if (!isRecord(data) || !Array.isArray(data.slots)) {
    throw new OfficialSupplyGateError("author_shape_invalid", "asset_plan: slots array required");
  }
  const plan: OfficialAssetPlan = {
    slots: data.slots.map((slot: unknown, index: number) => {
      if (!isRecord(slot)) throw new OfficialSupplyGateError("author_shape_invalid", `slot[${index}] invalid`);
      const kind = typeof slot.kind === "string" && ASSET_SLOT_KINDS.has(slot.kind) ? slot.kind : "";
      if (!kind) throw new OfficialSupplyGateError("author_shape_invalid", `slot[${index}]: kind invalid`);
      const depiction =
        typeof slot.depiction === "string" && ASSET_DEPICTIONS.has(slot.depiction) ? slot.depiction : "standard";
      const rawTag = typeof slot.personTag === "string" && slot.personTag ? slot.personTag : null;
      // personTag is an optional taxonomy hint: an off-taxonomy value is dropped,
      // never invented into the canonical person-tag list.
      const personTag: OfficialAssetPlan["slots"][number]["personTag"] =
        rawTag && isAssetPersonTag(rawTag) ? rawTag : null;
      if (!isOfficialImageSubjects(slot.imageSubjects)) {
        throw new OfficialSupplyGateError(
          "author_shape_invalid",
          `slot[${index}]: imageSubjects must be an explicit foreground/backgroundExtras/partner contract`
        );
      }
      return {
        slotKey: typeof slot.slotKey === "string" ? slot.slotKey : `slot-${index}`,
        kind: kind as OfficialAssetPlan["slots"][number]["kind"],
        tag: typeof slot.tag === "string" ? slot.tag : "",
        expression: typeof slot.expression === "string" ? slot.expression : "",
        pose: typeof slot.pose === "string" ? slot.pose : "",
        outfit: typeof slot.outfit === "string" ? slot.outfit : "default",
        location: typeof slot.location === "string" ? stripPromptTierLabel(slot.location) : null,
        situation: typeof slot.situation === "string" ? slot.situation : null,
        characterPresence: "required" as const,
        imageSubjects: slot.imageSubjects,
        depiction: depiction as OfficialAssetPlan["slots"][number]["depiction"],
        personTag,
      };
    }),
  };
  return { plan, completion };
}

export async function generateOfficialStyleBoard(input: {
  transport: OfficialAuthorTransport;
  board: StyleBoardInput;
  modelId?: string;
}): Promise<{ candidates: VisualStyleCandidate[]; completion: OfficialAuthorRawCompletion }> {
  const completion = await input.transport.completeJson({
    task: "style_board",
    system: buildStyleBoardSystem(),
    user: buildStyleBoardUser(input.board),
    schemaName: "official_style_board",
    schema: STYLE_BOARD_SCHEMA,
    modelId: input.modelId,
  });
  const data = parseAuthorJson(completion.text, "style_board");
  if (!isRecord(data) || !Array.isArray(data.candidates)) {
    throw new OfficialSupplyGateError("author_shape_invalid", "style_board: candidates array required");
  }
  const candidates = data.candidates as VisualStyleCandidate[];
  if (!isCharacterGenre(input.board.genre)) {
    throw new OfficialSupplyGateError("author_shape_invalid", `style_board: genre ${input.board.genre} is not canonical`);
  }
  const qa = validateStyleProposal({
    styleKey: input.board.styleKey,
    genre: input.board.genre,
    candidates,
  });
  if (!qa.ok) throw new OfficialSupplyGateError("author_style_rejected", "style board failed QA", qa);
  return { candidates, completion };
}

// ── QA re-exports for the pilot harness (canonical owners, not copies) ──────

export function validatePilotAppearance(
  draft: OfficialCharacterDraft,
  lock: OfficialAppearanceLock
): QaResult {
  return evaluateAppearanceLock(draft, lock);
}

export function validatePilotAssetPlan(
  draft: OfficialCharacterDraft,
  plan: OfficialAssetPlan
): QaResult {
  return evaluateAssetPlan(draft, plan);
}

export function pilotQaSummary(qa: QaResult): { errors: string[]; warnings: string[] } {
  return {
    errors: qa.errors.map((e) => `${e.code}: ${e.message}`),
    warnings: qa.warnings.map((w) => `${w.code}: ${w.message}`),
  };
}

export { compileOfficialDraftFromBible };
export { qaResult };
export { OFFICIAL_AUTHOR_SNAPSHOT_VERSION, OFFICIAL_AUTHOR_TEMPLATE_VERSION };
export type { OfficialCharacterBible, OfficialWorldBible };
