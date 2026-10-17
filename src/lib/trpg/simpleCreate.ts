import { formatInventoryAuthoringText } from "./inventory";
import {
  scenarioEditorSavePayload,
  type ScenarioEditorSnapshot,
} from "./scenarioEditorState";
import { emptyTrpgScenarioPlan, hasMinimumPlayableStory, type TrpgScenarioPlan } from "./scenarioPlan";
import { evaluateScenarioReadiness } from "./scenarioReadiness";
import {
  countScenarioBundleChars,
  scenarioBundleLimitError,
  TRPG_SCENARIO_BUNDLE_LIMIT,
  type TrpgScenarioNpc,
  type TrpgScenarioTemplate,
  type TrpgScenarioTemplateInput,
} from "./scenarioTypes";
import { DEFAULT_TRPG_STAT_KEYS } from "./stats";

export const SIMPLE_CREATE_EMPTY_MESSAGE = "모험 설명을 적거나 기존 세계관을 하나 골라 주세요.";
export const SIMPLE_CREATE_UNUSABLE_DRAFT_MESSAGE =
  "AI가 모험을 끝까지 구성하지 못했습니다. 입력은 그대로 남겨 두었으니 다시 시도해 주세요.";
export const SIMPLE_CREATE_SAVE_FAILED_MESSAGE = "모험은 만들어졌지만 저장하지 못했습니다.";
export const SIMPLE_CREATE_DRAFT_TIMEOUT_MESSAGE =
  "AI 초안 생성이 예상보다 오래 걸렸습니다. 작성 중인 내용은 그대로 보존되었습니다. 잠시 후 다시 시도해 주세요.";

const DRAFT_ENDPOINT = "/api/trpg/scenarios/ai-draft";
const SCENARIOS_ENDPOINT = "/api/trpg/scenarios";

export function scenarioDraftErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (
      error.name === "TimeoutError" ||
      error.name === "AbortError" ||
      /aborted due to timeout|timed out|timeout/i.test(error.message)
    ) {
      return SIMPLE_CREATE_DRAFT_TIMEOUT_MESSAGE;
    }
    if (error.message.trim()) return error.message;
  }
  return "AI 초안에 실패했습니다.";
}

export type SimpleCreateInput = {
  description: string;
  worldId: number | null;
};

/** Own saved world the creator may pick; only the text that counts toward the bundle limit. */
export type SimpleCreateWorld = {
  id: number;
  summary: string;
  content: string;
};

export type SimpleCreateDraft = {
  title: string;
  summary: string;
  startLocation: string;
  startInventory: string[];
  npcs: TrpgScenarioNpc[];
  plan: TrpgScenarioPlan;
};

export type SimpleCreatePreview = {
  title: string;
  summary: string;
  startingSituation: string;
};

/** The exact payload that will be saved, fixed from the AI response before any React state is involved. */
export type SimpleCreateComposed = {
  payload: TrpgScenarioTemplateInput;
  preview: SimpleCreatePreview;
  generatedAt: string;
};

export type SimpleCreateSession = {
  input: SimpleCreateInput;
  composed: SimpleCreateComposed | null;
  saveAttempted: boolean;
  savedId: number | null;
};

export function newSimpleCreateSession(input: SimpleCreateInput): SimpleCreateSession {
  return { input, composed: null, saveAttempted: false, savedId: null };
}

export function sameSimpleCreateInput(a: SimpleCreateInput, b: SimpleCreateInput): boolean {
  return a.worldId === b.worldId && a.description.trim() === b.description.trim();
}

function bundleChars(input: SimpleCreateInput, world: SimpleCreateWorld | null | undefined): number {
  return countScenarioBundleChars({
    worldSummary: world?.summary,
    worldContent: world?.content,
    content: input.description.trim(),
  });
}

/** Only the two things a creator can get wrong before any paid call: nothing given, or too much text. */
export function simpleCreateInputProblem(
  input: SimpleCreateInput,
  world?: SimpleCreateWorld | null
): string | null {
  if (!input.description.trim() && input.worldId == null) return SIMPLE_CREATE_EMPTY_MESSAGE;
  const used = bundleChars(input, world);
  if (used > TRPG_SCENARIO_BUNDLE_LIMIT) return scenarioBundleLimitError(used);
  return null;
}

/** Same request the detailed editor sends for `fill_empty`; the description travels as `content`. */
export function buildSimpleDraftRequest(input: SimpleCreateInput) {
  return {
    worldId: input.worldId,
    mode: "fill_empty" as const,
    selectedFields: [] as string[],
    lockedFields: [] as string[],
    existingDraft: {
      title: "",
      summary: "",
      content: input.description.trim(),
      secretContent: "",
      startLocation: "",
      startInventory: [] as string[],
      npcs: [] as TrpgScenarioNpc[],
      plan: emptyTrpgScenarioPlan(),
      touchedFields: [] as string[],
    },
  };
}

export type SimpleComposeResult =
  | { ok: true; composed: SimpleCreateComposed }
  | { ok: false; message: string };

/** Builds the private-save payload through the same save/readiness owners the detailed editor uses. */
export function composeSimpleScenario(
  input: SimpleCreateInput,
  draft: SimpleCreateDraft,
  world?: SimpleCreateWorld | null
): SimpleComposeResult {
  const fields: ScenarioEditorSnapshot = {
    title: draft.title,
    summary: draft.summary,
    content: input.description.trim(),
    secretContent: "",
    worldId: input.worldId ?? "",
    visibility: "private",
    startLocation: draft.startLocation,
    inventoryText: formatInventoryAuthoringText(draft.startInventory),
    statKeys: [...DEFAULT_TRPG_STAT_KEYS],
    npcs: draft.npcs,
    genres: [],
    assets: [],
    plan: draft.plan,
    characterIds: [],
  };
  let payload: TrpgScenarioTemplateInput;
  try {
    payload = scenarioEditorSavePayload(fields);
  } catch {
    return { ok: false, message: SIMPLE_CREATE_UNUSABLE_DRAFT_MESSAGE };
  }
  const used = countScenarioBundleChars({
    worldSummary: world?.summary,
    worldContent: world?.content,
    summary: draft.summary,
    content: fields.content,
    npcs: payload.npcs,
    scenarioPlan: draft.plan,
  });
  const readiness = evaluateScenarioReadiness({
    title: draft.title,
    content: fields.content,
    summary: draft.summary,
    visibility: "private",
    scenarioPlan: draft.plan,
    npcs: payload.npcs,
    inventoryText: fields.inventoryText,
    bundleChars: used,
  });
  if (!hasMinimumPlayableStory(draft.plan)) {
    return { ok: false, message: SIMPLE_CREATE_UNUSABLE_DRAFT_MESSAGE };
  }
  if (!readiness.canSave) {
    const overBundle = readiness.blockers.some((item) => item.id === "bundle_limit");
    return {
      ok: false,
      message: overBundle ? scenarioBundleLimitError(used) : SIMPLE_CREATE_UNUSABLE_DRAFT_MESSAGE,
    };
  }
  return {
    ok: true,
    composed: {
      payload,
      preview: {
        title: draft.title.trim(),
        summary: draft.summary.trim(),
        startingSituation: draft.plan.startingSituation.trim(),
      },
      generatedAt: draft.plan.provenance?.generatedAt ?? "",
    },
  };
}

export type SimpleCreateStep = "draft" | "save";

export type SimpleCreateOutcome =
  | { status: "saved"; session: SimpleCreateSession; scenario: TrpgScenarioTemplate | null }
  | { status: "draft_failed"; session: SimpleCreateSession; message: string }
  | { status: "save_failed"; session: SimpleCreateSession; message: string };

type DraftResponse = {
  error?: string;
  code?: string;
  draft?: Partial<SimpleCreateDraft>;
};

function parseDraft(raw: Partial<SimpleCreateDraft> | undefined): SimpleCreateDraft | null {
  if (!raw || !raw.plan) return null;
  return {
    title: String(raw.title ?? ""),
    summary: String(raw.summary ?? ""),
    startLocation: String(raw.startLocation ?? ""),
    startInventory: Array.isArray(raw.startInventory) ? raw.startInventory.map(String) : [],
    npcs: Array.isArray(raw.npcs) ? raw.npcs : [],
    plan: raw.plan,
  };
}

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function requestDraft(
  input: SimpleCreateInput,
  world: SimpleCreateWorld | null | undefined,
  fetchImpl: typeof fetch
): Promise<{ ok: true; composed: SimpleCreateComposed } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await fetchImpl(DRAFT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSimpleDraftRequest(input)),
    });
  } catch (error) {
    return { ok: false, message: scenarioDraftErrorMessage(error) };
  }
  const data = await readJson<DraftResponse>(res);
  if (!res.ok) {
    if (data?.code === "SCENARIO_DRAFT_TIMEOUT") {
      return { ok: false, message: SIMPLE_CREATE_DRAFT_TIMEOUT_MESSAGE };
    }
    return { ok: false, message: data?.error?.trim() || "AI 초안을 만들지 못했습니다." };
  }
  const draft = parseDraft(data?.draft);
  if (!draft) return { ok: false, message: SIMPLE_CREATE_UNUSABLE_DRAFT_MESSAGE };
  const composed = composeSimpleScenario(input, draft, world);
  return composed.ok ? composed : { ok: false, message: composed.message };
}

/**
 * A prior POST may have committed even though the response never arrived. The draft's own
 * `generatedAt` stamp is unique, so a saved row carrying it is this same adventure.
 */
function findAlreadySaved(
  mine: readonly TrpgScenarioTemplate[],
  composed: SimpleCreateComposed
): TrpgScenarioTemplate | null {
  if (!composed.generatedAt) return null;
  return (
    mine.find(
      (row) =>
        row.title === composed.preview.title &&
        row.scenarioPlan?.provenance?.generatedAt === composed.generatedAt
    ) ?? null
  );
}

async function lookupAlreadySaved(
  composed: SimpleCreateComposed,
  fetchImpl: typeof fetch
): Promise<TrpgScenarioTemplate | null> {
  try {
    const res = await fetchImpl(SCENARIOS_ENDPOINT, { method: "GET" });
    if (!res.ok) return null;
    const data = await readJson<{ mine?: TrpgScenarioTemplate[] }>(res);
    return findAlreadySaved(data?.mine ?? [], composed);
  } catch {
    return null;
  }
}

/**
 * Runs whichever steps are still missing: draft (paid) then private save. A retry never repeats a
 * step that already finished, so a failed save is retried without another AI call and a saved
 * adventure is never saved twice.
 */
export async function advanceSimpleCreate(opts: {
  session: SimpleCreateSession;
  world?: SimpleCreateWorld | null;
  fetchImpl: typeof fetch;
  onStep?: (step: SimpleCreateStep) => void;
}): Promise<SimpleCreateOutcome> {
  const fetchImpl = opts.fetchImpl;
  let session = opts.session;
  if (session.savedId != null) return { status: "saved", session, scenario: null };

  if (!session.composed) {
    opts.onStep?.("draft");
    const drafted = await requestDraft(session.input, opts.world, fetchImpl);
    if (!drafted.ok) return { status: "draft_failed", session, message: drafted.message };
    session = { ...session, composed: drafted.composed };
  }
  const composed = session.composed!;

  opts.onStep?.("save");
  if (session.saveAttempted) {
    const existing = await lookupAlreadySaved(composed, fetchImpl);
    if (existing) {
      session = { ...session, savedId: existing.id };
      return { status: "saved", session, scenario: existing };
    }
  }
  session = { ...session, saveAttempted: true };
  let res: Response;
  try {
    res = await fetchImpl(SCENARIOS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(composed.payload),
    });
  } catch {
    return { status: "save_failed", session, message: SIMPLE_CREATE_SAVE_FAILED_MESSAGE };
  }
  const data = await readJson<{ error?: string; scenario?: TrpgScenarioTemplate | null }>(res);
  const id = data?.scenario?.id;
  if (!res.ok || !id) {
    return {
      status: "save_failed",
      session,
      message: data?.error?.trim() || SIMPLE_CREATE_SAVE_FAILED_MESSAGE,
    };
  }
  session = { ...session, savedId: id };
  return { status: "saved", session, scenario: data?.scenario ?? null };
}

/** Synchronous double-submit guard: a second call while one runs joins the first instead of starting another. */
export function createSingleFlight() {
  let inFlight: Promise<unknown> | null = null;
  return {
    get busy() {
      return inFlight != null;
    },
    run<T>(task: () => Promise<T>): Promise<T> {
      if (inFlight) return inFlight as Promise<T>;
      const started = task().finally(() => {
        inFlight = null;
      });
      inFlight = started;
      return started;
    },
  };
}

export const SIMPLE_CREATE_STORAGE_KEY = "habi:trpg-simple-create:v1";

export function serializeSimpleCreateSession(session: SimpleCreateSession): string {
  return JSON.stringify(session);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Restores what was typed or generated before a refresh; anything malformed or foreign is dropped. */
export function parseSimpleCreateSession(
  raw: string | null,
  ownedWorldIds: readonly number[]
): SimpleCreateSession | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.input)) return null;
  const rawWorldId = parsed.input.worldId;
  const worldId =
    typeof rawWorldId === "number" && ownedWorldIds.includes(rawWorldId) ? rawWorldId : null;
  const worldDropped = typeof rawWorldId === "number" && worldId == null;
  const input: SimpleCreateInput = {
    description: typeof parsed.input.description === "string" ? parsed.input.description : "",
    worldId,
  };
  const savedId =
    typeof parsed.savedId === "number" && Number.isInteger(parsed.savedId) && parsed.savedId > 0
      ? parsed.savedId
      : null;
  const composedRaw = parsed.composed;
  const composed =
    !worldDropped &&
    isRecord(composedRaw) &&
    isRecord(composedRaw.payload) &&
    isRecord(composedRaw.preview) &&
    typeof composedRaw.generatedAt === "string"
      ? (composedRaw as unknown as SimpleCreateComposed)
      : null;
  return {
    input,
    composed,
    saveAttempted: composed != null && parsed.saveAttempted === true,
    savedId,
  };
}

export function simpleCreatedHref(scenarioId: number): string {
  return `/world/create?tab=scenario&created=${scenarioId}`;
}

export function parseSimpleCreatedId(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const id = Number(String(raw).trim());
  return Number.isInteger(id) && id > 0 ? id : null;
}
