import type { OpenAiImageQuality } from "@/lib/openAiImageEdit";
import {
  evaluateOfficialImageDimensions,
  officialImageProfileForSlot,
  OFFICIAL_ASSET_OUTPUT_COMPRESSION,
  resolveOfficialAssetImageModel,
} from "@/lib/officialSupply/imageProfile";
import { buildOfficialAssetPrompts, OFFICIAL_ASSET_TEMPLATE_ID } from "@/lib/officialSupply/imagePrompt";
import { OfficialSupplyGateError, type OfficialSupplyStore } from "@/lib/officialSupply/store";
import type { OfficialAssetModeration } from "@/lib/officialSupply/types";

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
    public readonly hasUnknownAttemptCost: boolean
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

function assetFilename(draftKey: string, slotKey: string, attempt: number): string {
  return `official-${spoolKey(draftKey, slotKey)}-a${attempt}.webp`;
}

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

async function finishUpload(
  deps: OfficialAssetRunnerDeps,
  draftKey: string,
  slotKey: string,
  buffer: Buffer,
  attempt: number,
  width: number,
  height: number
): Promise<OfficialAssetRunOutcome> {
  const key = spoolKey(draftKey, slotKey);
  try {
    const stored = await deps.storage.store(assetFilename(draftKey, slotKey, attempt), buffer);
    if (!deps.store.completeSlot(draftKey, slotKey, deps.workerId, { url: stored.url, width, height })) {
      return { status: "in_progress_elsewhere" };
    }
    await deps.spool.remove(key);
    return { status: "generated", url: stored.url, model: deps.store.getAsset(draftKey, slotKey).model ?? "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.store.markUploadPending(draftKey, slotKey, deps.workerId, `upload failed: ${message}`, width, height);
    return { status: "upload_pending", error: message };
  }
}

async function retryPendingUpload(
  deps: OfficialAssetRunnerDeps,
  draftKey: string,
  slotKey: string
): Promise<OfficialAssetRunOutcome> {
  const asset = deps.store.getAsset(draftKey, slotKey);
  const buffer = await deps.spool.load(spoolKey(draftKey, slotKey));
  if (!buffer || asset.width == null || asset.height == null) {
    return { status: "failed", error: "upload_pending without a spooled result" };
  }
  if (!deps.store.claimPendingUpload(draftKey, slotKey, deps.workerId)) {
    return { status: "in_progress_elsewhere" };
  }
  return finishUpload(deps, draftKey, slotKey, buffer, asset.attempts, asset.width, asset.height);
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
  if (asset.status === "upload_pending") return retryPendingUpload(deps, draftKey, slotKey);

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
  const attempt = deps.store.getAsset(draftKey, slotKey).attempts;

  const plan = character.assetPlan?.slots.find((slot) => slot.slotKey === slotKey);
  const candidate = style.candidates.find((c) => c.candidateId === style.approvedCandidateId);
  if (!plan || !character.appearance || !candidate || !style.styleSeed) {
    deps.store.failSlot(draftKey, slotKey, deps.workerId, "pipeline record incomplete");
    return { status: "failed", error: "pipeline record incomplete" };
  }
  const references =
    plan.kind === "representative"
      ? [style.styleSeed.url]
      : [deps.store.representativeAsset(draftKey).resultUrl ?? ""];
  if (references.some((ref) => !ref)) {
    deps.store.failSlot(draftKey, slotKey, deps.workerId, "missing reference");
    return { status: "failed", error: "missing reference" };
  }

  const profile = officialImageProfileForSlot(plan.kind);
  const prompts = buildOfficialAssetPrompts({
    draft: character.draft,
    appearance: character.appearance,
    style: candidate.dna,
    slot: plan,
  });
  const model = resolveOfficialAssetImageModel(deps.env);

  let generated: Awaited<ReturnType<OfficialImageTransport["generate"]>>;
  try {
    generated = await deps.transport.generate({
      model,
      primaryPrompt: prompts.primaryPrompt,
      strictFallbackPrompt: prompts.strictFallbackPrompt,
      references,
      size: profile.size,
      quality: batch.config.quality,
      outputCompression: OFFICIAL_ASSET_OUTPUT_COMPRESSION,
      templateId: OFFICIAL_ASSET_TEMPLATE_ID,
      idempotencyKey: `${draftKey}:${slotKey}:${attempt}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof OfficialImageTransportError) {
      deps.store.recordSpend(draftKey, slotKey, {
        costUsd: error.costUsd ?? 0,
        unknownCost: error.hasUnknownAttemptCost,
        model,
        providerRequestId: null,
      });
    } else {
      deps.store.recordSpend(draftKey, slotKey, { costUsd: 0, unknownCost: true, model, providerRequestId: null });
    }
    deps.store.failSlot(draftKey, slotKey, deps.workerId, message);
    return { status: "failed", error: message };
  }

  deps.store.recordSpend(draftKey, slotKey, {
    costUsd: generated.costUsd ?? 0,
    unknownCost: generated.costUsd == null || generated.hasUnknownAttemptCost,
    model,
    providerRequestId: generated.providerRequestId,
  });

  const dims = await deps.imageOps.inspect(generated.buffer);
  if (!dims || evaluateOfficialImageDimensions(profile, dims.width, dims.height) !== "exact") {
    const error = `malformed output ${dims ? `${dims.width}x${dims.height}` : "unreadable"} for ${profile.size}`;
    deps.store.failSlot(draftKey, slotKey, deps.workerId, error);
    return { status: "failed", error };
  }
  await deps.spool.save(spoolKey(draftKey, slotKey), generated.buffer);
  return finishUpload(deps, draftKey, slotKey, generated.buffer, attempt, profile.width, profile.height);
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
