import type { OpenAiImageQuality } from "@/lib/openAiImageEdit";
import { resolveOfficialGenerationReferencePlan } from "@/lib/officialSupply/generationReferences";
import {
  evaluateOfficialImageDimensions,
  officialImageProfileForSlot,
  OFFICIAL_ASSET_OUTPUT_COMPRESSION,
  resolveOfficialAssetImageModel,
  type OfficialImageProfile,
} from "@/lib/officialSupply/imageProfile";
import {
  buildOfficialAssetPrompts,
  OFFICIAL_ASSET_TEMPLATE_ID,
  type OfficialReferenceRoleLayout,
} from "@/lib/officialSupply/imagePrompt";
import {
  OfficialSupplyGateError,
  type OfficialCharacterRecord,
  type OfficialSupplyStore,
} from "@/lib/officialSupply/store";
import type {
  OfficialAssetModeration,
  OfficialAssetSlotKind,
  OfficialGenreStyle,
  StyleReference,
} from "@/lib/officialSupply/types";

/**
 * What the edit request sends as `image[]`.
 * Delegates to `resolveOfficialGenerationReferencePlan` so references and
 * prompt role stay one owner. Cluster B variation failures return [] so the
 * runner can fail closed before any provider call.
 */
export function officialSlotGenerationReferences(input: {
  kind: OfficialAssetSlotKind;
  styleSeed: StyleReference;
  representativeUrl: string | null | undefined;
}): string[] {
  const resolved = resolveOfficialGenerationReferencePlan(input);
  return resolved.ok ? [...resolved.plan.references] : [];
}

/** Platform-funded provider port. Production wraps the canonical OpenAI edit + safety fallback owner. */
export type OfficialImageTransport = {
  generate(input: {
    model: string;
    primaryPrompt: string;
    strictFallbackPrompt: string;
    references: string[];
    size: string;
    quality: OpenAiImageQuality;
    outputCompression: number;
    templateId: string;
    idempotencyKey: string;
  }): Promise<{
    buffer: Buffer;
    /** Sum of known attempt costs; null when the provider reported no usage. */
    costUsd: number | null;
    hasUnknownAttemptCost: boolean;
    providerRequestId: string | null;
  }>;
};

export class OfficialImageTransportError extends Error {
  constructor(
    message: string,
    public readonly costUsd: number | null,
    public readonly hasUnknownAttemptCost: boolean,
    /** False only when the failure happened before any provider request was started. */
    public readonly providerAttempted = true
  ) {
    super(message);
    this.name = "OfficialImageTransportError";
  }
}

export type OfficialImageOps = {
  inspect(buffer: Buffer): Promise<{ width: number; height: number } | null>;
};

/** Canonical asset-vision moderation port (production: `analyzeAssetImage`). */
export type OfficialAssetModerator = {
  moderate(url: string): Promise<OfficialAssetModeration>;
};

export type OfficialAssetStorage = {
  store(filename: string, buffer: Buffer): Promise<{ url: string }>;
};

/** Durable local copy of a paid result until upload succeeds (partial-upload recovery). */
export type OfficialAssetSpool = {
  save(key: string, buffer: Buffer): Promise<void>;
  load(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
};

export type OfficialAssetRunnerDeps = {
  store: OfficialSupplyStore;
  transport: OfficialImageTransport;
  imageOps: OfficialImageOps;
  storage: OfficialAssetStorage;
  spool: OfficialAssetSpool;
  workerId: string;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
};

export type OfficialAssetRunOutcome =
  | { status: "generated"; url: string; model: string }
  | { status: "already_generated"; url: string | null }
  | { status: "in_progress_elsewhere" }
  | { status: "attempts_exhausted" }
  | { status: "failed"; error: string }
  | { status: "upload_pending"; error: string };

export class OfficialSupplyBudgetError extends OfficialSupplyGateError {}

function spoolKey(draftKey: string, slotKey: string): string {
  return `${draftKey}__${slotKey}`.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function replacementSpoolKey(draftKey: string, slotKey: string): string {
  return `${spoolKey(draftKey, slotKey)}-r`;
}

function assetFilename(draftKey: string, slotKey: string, attempt: number): string {
  return `official-${spoolKey(draftKey, slotKey)}-a${attempt}.webp`;
}

function replacementFilename(draftKey: string, slotKey: string, attempt: number): string {
  return `official-${spoolKey(draftKey, slotKey)}-r${attempt}.webp`;
}

export type OfficialSlotGenerationCompose =
  | {
      ok: true;
      references: readonly string[];
      referenceRoleLayout: OfficialReferenceRoleLayout;
      primaryPrompt: string;
      strictFallbackPrompt: string;
      model: string;
      profile: OfficialImageProfile;
    }
  | { ok: false; error: string };

/**
 * Shared prompt/reference/model/size owner for initial generation and
 * replacement generation. Persistence target is chosen by the caller.
 */
export function composeOfficialSlotGeneration(input: {
  character: OfficialCharacterRecord;
  style: OfficialGenreStyle;
  slotKey: string;
  representativeUrl: string | null | undefined;
  env?: NodeJS.ProcessEnv;
}): OfficialSlotGenerationCompose {
  const plan = input.character.assetPlan?.slots.find((slot) => slot.slotKey === input.slotKey);
  const candidate = input.style.candidates.find((c) => c.candidateId === input.style.approvedCandidateId);
  if (!plan || !input.character.appearance || !candidate || !input.style.styleSeed) {
    return { ok: false, error: "pipeline record incomplete" };
  }
  const generation = resolveOfficialGenerationReferencePlan({
    kind: plan.kind,
    styleSeed: input.style.styleSeed,
    representativeUrl: input.representativeUrl,
  });
  if (!generation.ok) {
    return { ok: false, error: generation.reason };
  }
  if (generation.plan.references.length === 0 || generation.plan.references.some((ref) => !ref)) {
    return { ok: false, error: "missing reference" };
  }
  const prompts = buildOfficialAssetPrompts({
    draft: input.character.draft,
    appearance: input.character.appearance,
    style: candidate.dna,
    slot: plan,
    styleSeed: input.style.styleSeed,
    referenceRoleLayout: generation.plan.referenceRoleLayout,
  });
  return {
    ok: true,
    references: generation.plan.references,
    referenceRoleLayout: generation.plan.referenceRoleLayout,
    primaryPrompt: prompts.primaryPrompt,
    strictFallbackPrompt: prompts.strictFallbackPrompt,
    model: resolveOfficialAssetImageModel(input.env),
    profile: officialImageProfileForSlot(plan.kind),
  };
}

type OfficialSlotPersistHooks = {
  spoolKey: string;
  filename: (attempt: number) => string;
  idempotencyKey: (attempt: number) => string;
  attempt: number;
  pendingDims: { width: number | null; height: number | null };
  readModel: () => string;
  recordSpend: (input: {
    costUsd: number;
    unknownCost: boolean;
    model: string;
    providerRequestId: string | null;
  }) => void;
  fail: (error: string) => void;
  failBeforeProvider: (error: string) => void;
  complete: (input: { url: string; width: number; height: number }) => boolean;
  markUploadPending: (error: string, width: number, height: number) => void;
  claimPendingUpload: () => boolean;
};

/** Pause the batch when any hierarchy level would exceed its cap with one more image. */
function enforceBudget(deps: OfficialAssetRunnerDeps, batchKey: string, draftKey: string): void {
  const batch = deps.store.getBatch(batchKey);
  const reserve = batch.config.reservePerImageUsd;
  const spent = deps.store.spendSnapshot(draftKey, reserve);
  const caps = batch.config.budgetUsd;
  const levels: Array<[string, number, number | undefined]> = [
    ["batch", spent.batch, caps.batch],
    ["genre", spent.genre, caps.perGenre],
    ["world", spent.world, caps.perWorld],
    ["character", spent.character, caps.perCharacter],
  ];
  for (const [level, value, cap] of levels) {
    if (cap != null && value + reserve > cap) {
      const reason = `budget hard-stop: ${level} spend ${value.toFixed(4)} + reserve ${reserve} > cap ${cap}`;
      deps.store.pauseBatch(batchKey, reason);
      throw new OfficialSupplyBudgetError("budget_exceeded", reason);
    }
  }
}

async function finishUploadWith(
  deps: OfficialAssetRunnerDeps,
  persist: OfficialSlotPersistHooks,
  buffer: Buffer,
  attempt: number,
  width: number,
  height: number
): Promise<OfficialAssetRunOutcome> {
  try {
    const stored = await deps.storage.store(persist.filename(attempt), buffer);
    if (!persist.complete({ url: stored.url, width, height })) {
      return { status: "in_progress_elsewhere" };
    }
    await deps.spool.remove(persist.spoolKey);
    return { status: "generated", url: stored.url, model: persist.readModel() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    persist.markUploadPending(`upload failed: ${message}`, width, height);
    return { status: "upload_pending", error: message };
  }
}

async function retryPendingUploadWith(
  deps: OfficialAssetRunnerDeps,
  persist: OfficialSlotPersistHooks
): Promise<OfficialAssetRunOutcome> {
  const buffer = await deps.spool.load(persist.spoolKey);
  if (!buffer || persist.pendingDims.width == null || persist.pendingDims.height == null) {
    return { status: "failed", error: "upload_pending without a spooled result" };
  }
  if (!persist.claimPendingUpload()) {
    return { status: "in_progress_elsewhere" };
  }
  return finishUploadWith(
    deps,
    persist,
    buffer,
    persist.attempt,
    persist.pendingDims.width,
    persist.pendingDims.height
  );
}

async function executeComposedOfficialGeneration(
  deps: OfficialAssetRunnerDeps,
  composed: Extract<OfficialSlotGenerationCompose, { ok: true }>,
  persist: OfficialSlotPersistHooks,
  quality: OpenAiImageQuality
): Promise<OfficialAssetRunOutcome> {
  let generated: Awaited<ReturnType<OfficialImageTransport["generate"]>>;
  try {
    generated = await deps.transport.generate({
      model: composed.model,
      primaryPrompt: composed.primaryPrompt,
      strictFallbackPrompt: composed.strictFallbackPrompt,
      references: [...composed.references],
      size: composed.profile.size,
      quality,
      outputCompression: OFFICIAL_ASSET_OUTPUT_COMPRESSION,
      templateId: OFFICIAL_ASSET_TEMPLATE_ID,
      idempotencyKey: persist.idempotencyKey(persist.attempt),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof OfficialImageTransportError && !error.providerAttempted) {
      persist.failBeforeProvider(message);
      return { status: "failed", error: message };
    }
    if (error instanceof OfficialImageTransportError) {
      persist.recordSpend({
        costUsd: error.costUsd ?? 0,
        unknownCost: error.hasUnknownAttemptCost,
        model: composed.model,
        providerRequestId: null,
      });
    } else {
      persist.recordSpend({
        costUsd: 0,
        unknownCost: true,
        model: composed.model,
        providerRequestId: null,
      });
    }
    persist.fail(message);
    return { status: "failed", error: message };
  }

  persist.recordSpend({
    costUsd: generated.costUsd ?? 0,
    unknownCost: generated.costUsd == null || generated.hasUnknownAttemptCost,
    model: composed.model,
    providerRequestId: generated.providerRequestId,
  });

  const dims = await deps.imageOps.inspect(generated.buffer);
  if (!dims || evaluateOfficialImageDimensions(composed.profile, dims.width, dims.height) !== "exact") {
    const error = `malformed output ${dims ? `${dims.width}x${dims.height}` : "unreadable"} for ${composed.profile.size}`;
    persist.fail(error);
    return { status: "failed", error };
  }
  await deps.spool.save(persist.spoolKey, generated.buffer);
  return finishUploadWith(
    deps,
    persist,
    generated.buffer,
    persist.attempt,
    composed.profile.width,
    composed.profile.height
  );
}

function activeSlotPersist(deps: OfficialAssetRunnerDeps, draftKey: string, slotKey: string): OfficialSlotPersistHooks {
  const asset = deps.store.getAsset(draftKey, slotKey);
  return {
    spoolKey: spoolKey(draftKey, slotKey),
    filename: (attempt) => assetFilename(draftKey, slotKey, attempt),
    idempotencyKey: (attempt) => `${draftKey}:${slotKey}:${attempt}`,
    attempt: asset.attempts,
    pendingDims: { width: asset.width, height: asset.height },
    readModel: () => deps.store.getAsset(draftKey, slotKey).model ?? "",
    recordSpend: (input) => deps.store.recordSpend(draftKey, slotKey, input),
    fail: (error) => deps.store.failSlot(draftKey, slotKey, deps.workerId, error),
    failBeforeProvider: (error) => deps.store.failSlotBeforeProvider(draftKey, slotKey, deps.workerId, error),
    complete: (input) => deps.store.completeSlot(draftKey, slotKey, deps.workerId, input),
    markUploadPending: (error, width, height) =>
      deps.store.markUploadPending(draftKey, slotKey, deps.workerId, error, width, height),
    claimPendingUpload: () => deps.store.claimPendingUpload(draftKey, slotKey, deps.workerId),
  };
}

function replacementSlotPersist(
  deps: OfficialAssetRunnerDeps,
  draftKey: string,
  slotKey: string
): OfficialSlotPersistHooks {
  const replacement = deps.store.getReplacement(draftKey, slotKey);
  return {
    spoolKey: replacementSpoolKey(draftKey, slotKey),
    filename: (attempt) => replacementFilename(draftKey, slotKey, attempt),
    idempotencyKey: (attempt) => `${draftKey}:${slotKey}:r${attempt}`,
    attempt: replacement.attempts,
    pendingDims: { width: replacement.width, height: replacement.height },
    readModel: () => deps.store.getReplacement(draftKey, slotKey).model ?? "",
    recordSpend: (input) => deps.store.recordReplacementSpend(draftKey, slotKey, input),
    fail: (error) => deps.store.failReplacement(draftKey, slotKey, deps.workerId, error),
    failBeforeProvider: (error) =>
      deps.store.failReplacementBeforeProvider(draftKey, slotKey, deps.workerId, error),
    complete: (input) => deps.store.completeReplacement(draftKey, slotKey, deps.workerId, input),
    markUploadPending: (error, width, height) =>
      deps.store.markReplacementUploadPending(draftKey, slotKey, deps.workerId, error, width, height),
    claimPendingUpload: () => deps.store.claimReplacementPendingUpload(draftKey, slotKey, deps.workerId),
  };
}

function composeOrFail(
  deps: OfficialAssetRunnerDeps,
  character: OfficialCharacterRecord,
  style: OfficialGenreStyle,
  draftKey: string,
  slotKey: string,
  persist: OfficialSlotPersistHooks
): Extract<OfficialSlotGenerationCompose, { ok: true }> | OfficialAssetRunOutcome {
  const composed = composeOfficialSlotGeneration({
    character,
    style,
    slotKey,
    representativeUrl: deps.store.representativeAsset(draftKey).resultUrl,
    env: deps.env,
  });
  if (!composed.ok) {
    persist.fail(composed.error);
    return { status: "failed", error: composed.error };
  }
  return composed;
}

/**
 * Generates exactly one planned slot. Gates are checked before any spend; a
 * slot that already produced an image is never sent to the provider again.
 */
export async function runOfficialAssetSlot(
  deps: OfficialAssetRunnerDeps,
  draftKey: string,
  slotKey: string
): Promise<OfficialAssetRunOutcome> {
  const now = deps.now ?? Date.now;
  const { character, style, asset } = deps.store.assertGenerationAllowed(draftKey, slotKey);
  if (asset.status === "generated" || asset.status === "approved") {
    return { status: "already_generated", url: asset.resultUrl };
  }
  if (asset.status === "upload_pending") {
    return retryPendingUploadWith(deps, activeSlotPersist(deps, draftKey, slotKey));
  }

  const batch = deps.store.getBatch(character.batchKey);
  if (batch.status !== "active") {
    throw new OfficialSupplyGateError("batch_paused", `batch ${batch.batchKey} paused: ${batch.pauseReason ?? ""}`);
  }
  enforceBudget(deps, character.batchKey, draftKey);

  const claimed = deps.store.claimSlot(
    draftKey,
    slotKey,
    deps.workerId,
    now(),
    batch.config.leaseMs,
    batch.config.maxAttemptsPerSlot
  );
  if (!claimed) {
    const latest = deps.store.getAsset(draftKey, slotKey);
    if (latest.attempts >= batch.config.maxAttemptsPerSlot && latest.status !== "generating") {
      return { status: "attempts_exhausted" };
    }
    return { status: "in_progress_elsewhere" };
  }
  const persist = activeSlotPersist(deps, draftKey, slotKey);
  const composed = composeOrFail(deps, character, style, draftKey, slotKey, persist);
  if ("status" in composed) return composed;
  return executeComposedOfficialGeneration(deps, composed, persist, batch.config.quality);
}

/**
 * Generates one replacement candidate for an already-approved live slot.
 * Never writes `official_supply_assets.result_url` / status or `characters.assets`.
 */
export async function runOfficialAssetReplacement(
  deps: OfficialAssetRunnerDeps,
  draftKey: string,
  slotKey: string
): Promise<OfficialAssetRunOutcome> {
  const now = deps.now ?? Date.now;
  const { character, style, replacement } = deps.store.assertReplacementGenerationAllowed(draftKey, slotKey);
  if (replacement.status === "generated" || replacement.status === "approved") {
    return { status: "already_generated", url: replacement.candidateResultUrl };
  }
  if (replacement.status === "upload_pending") {
    return retryPendingUploadWith(deps, replacementSlotPersist(deps, draftKey, slotKey));
  }

  const batch = deps.store.getBatch(character.batchKey);
  if (batch.status !== "active") {
    throw new OfficialSupplyGateError("batch_paused", `batch ${batch.batchKey} paused: ${batch.pauseReason ?? ""}`);
  }
  enforceBudget(deps, character.batchKey, draftKey);

  const claimed = deps.store.claimReplacement(
    draftKey,
    slotKey,
    deps.workerId,
    now(),
    batch.config.leaseMs,
    batch.config.maxAttemptsPerSlot
  );
  if (!claimed) {
    const latest = deps.store.getReplacement(draftKey, slotKey);
    if (latest.attempts >= batch.config.maxAttemptsPerSlot && latest.status !== "generating") {
      return { status: "attempts_exhausted" };
    }
    return { status: "in_progress_elsewhere" };
  }
  const persist = replacementSlotPersist(deps, draftKey, slotKey);
  const composed = composeOrFail(deps, character, style, draftKey, slotKey, persist);
  if ("status" in composed) return composed;
  return executeComposedOfficialGeneration(deps, composed, persist, batch.config.quality);
}

/**
 * Runs canonical moderation on the slot's current image (representative and
 * RP alike, SFW and 19+ alike) and records it. Review cannot proceed without it.
 */
export async function moderateOfficialAssetSlot(
  deps: { store: OfficialSupplyStore; moderator: OfficialAssetModerator },
  draftKey: string,
  slotKey: string
): Promise<OfficialAssetModeration> {
  const asset = deps.store.getAsset(draftKey, slotKey);
  if (asset.status !== "generated" || !asset.resultUrl) {
    throw new OfficialSupplyGateError("asset_not_generated", `${draftKey}/${slotKey} is ${asset.status}`);
  }
  const moderation = await deps.moderator.moderate(asset.resultUrl);
  deps.store.recordModeration(draftKey, slotKey, moderation);
  return moderation;
}

/**
 * Moderates the replacement candidate only. Never calls `recordModeration`
 * on the active `official_supply_assets` row.
 */
export async function moderateOfficialAssetReplacement(
  deps: { store: OfficialSupplyStore; moderator: OfficialAssetModerator },
  draftKey: string,
  slotKey: string
): Promise<OfficialAssetModeration> {
  const replacement = deps.store.getReplacement(draftKey, slotKey);
  if (replacement.status !== "generated" || !replacement.candidateResultUrl) {
    throw new OfficialSupplyGateError(
      "replacement_not_generated",
      `${draftKey}/${slotKey} replacement is ${replacement.status}`
    );
  }
  const moderation = await deps.moderator.moderate(replacement.candidateResultUrl);
  deps.store.recordReplacementModeration(draftKey, slotKey, moderation);
  return moderation;
}
