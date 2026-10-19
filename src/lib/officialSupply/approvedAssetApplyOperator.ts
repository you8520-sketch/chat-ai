import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { normalizeCreatorAssetTag } from "@/lib/characterAssets";
import { isOfficialAdminActor, type OfficialAdminActor } from "@/lib/officialAdminAccess";
import { officialModerationVerdict, type OfficialModerationVerdict } from "@/lib/officialSupply/moderation";
import {
  applyApprovedOfficialAssetReplacements,
  listOfficialAssetReplacementApplies,
  registerExternalOfficialAssetReplacement,
  rollbackOfficialAssetReplacementApply,
  type OfficialReplacementApplyResult,
  type OfficialReplacementRollbackResult,
} from "@/lib/officialSupply/replacement";
import {
  moderateOfficialAssetReplacement,
  type OfficialAssetModerator,
  type OfficialAssetStorage,
  type OfficialImageOps,
} from "@/lib/officialSupply/runner";
import {
  ANCHOR_QA_KEYS,
  OfficialSupplyGateError,
  VARIATION_QA_KEYS,
  type OfficialCharacterRecord,
  type OfficialReplacementRecord,
  type OfficialSupplyStore,
} from "@/lib/officialSupply/store";
import type {
  OfficialAnchorQaReport,
  OfficialAssetPlan,
  OfficialVariationQaReport,
  QaCheck,
} from "@/lib/officialSupply/types";
import type { VisionCostEvidence, VisionProviderPost, VisionRunControl } from "@/lib/vision";

/**
 * Step-by-step operator for applying one approved manifest of external files
 * to a linked official character: status → intake → moderation → review →
 * apply → rollback. Every write goes through the existing replacement owners;
 * this module only verifies the manifest, the admin and the link, skips slots
 * that already finished a step, and meters paid moderation.
 */

export type ApprovedAssetCandidate = { slot: string; tag: string; file: string; rawSha256: string };

export type ApprovedAssetOperatorTarget = {
  store: OfficialSupplyStore;
  draftKey: string;
  characterId: number;
  actor: OfficialAdminActor & { id: number };
  candidates: readonly ApprovedAssetCandidate[];
  bytesBySlot: ReadonlyMap<string, Buffer>;
  approvedPlan: OfficialAssetPlan;
};

export type SlotStep = "intake" | "moderate" | "review" | "apply" | "applied" | "blocked";

export type SlotStatus = {
  slot: string;
  tag: string;
  rawSha256: string;
  activeUrl: string | null;
  replacementStatus: OfficialReplacementRecord["status"] | null;
  candidateUrl: string | null;
  candidateMatchesManifest: boolean;
  moderation: OfficialModerationVerdict | null;
  next: SlotStep;
  reason: string | null;
};

const FIXTURE_RE = /test[-_ ]?fixture|not[-_ ]?quality[-_ ]?approval/i;

function gate(code: string, message: string): never {
  throw new OfficialSupplyGateError(code, message);
}

function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function resolveOperatorAdmin(store: OfficialSupplyStore, email: string): OfficialAdminActor & { id: number } {
  const wanted = email.trim().toLowerCase();
  if (!wanted) gate("operator_admin_required", "--admin-email is required");
  const row = store.database
    .prepare("SELECT id, email, is_admin FROM users WHERE lower(email)=?")
    .get(wanted) as { id: number; email: string; is_admin: number } | undefined;
  if (!row || !isOfficialAdminActor(row)) {
    gate("operator_admin_required", `${wanted} is not an official admin account in this database`);
  }
  return { id: row.id, email: row.email, is_admin: row.is_admin };
}

/** Verifies the admin, the linked character and the manifest files before any step. */
export function openApprovedAssetOperator(input: {
  store: OfficialSupplyStore;
  draftKey: string;
  characterId: number;
  adminEmail: string;
  manifestPath: string;
  approvedPlanPath: string;
}): ApprovedAssetOperatorTarget {
  const { store, draftKey } = input;
  const actor = resolveOperatorAdmin(store, input.adminEmail);
  const character = store.assertReplacementOperator(draftKey, actor);
  if (!Number.isInteger(input.characterId) || character.stagedCharacterId !== input.characterId) {
    gate(
      "operator_target_mismatch",
      `${draftKey} is linked to character ${character.stagedCharacterId}, not ${input.characterId}`
    );
  }
  const manifest = JSON.parse(fs.readFileSync(input.manifestPath, "utf8")) as { candidates?: ApprovedAssetCandidate[] };
  const candidates = manifest.candidates ?? [];
  const approvedPlan = (JSON.parse(fs.readFileSync(input.approvedPlanPath, "utf8")) as { assetPlan: OfficialAssetPlan })
    .assetPlan;
  const planTags = new Map(approvedPlan.slots.map((slot) => [slot.slotKey, slot.tag]));
  const shape = (plan: OfficialAssetPlan) => plan.slots.map((slot) => `${slot.slotKey}:${slot.kind}`).join(",");
  if (!character.assetPlan || shape(approvedPlan) !== shape(character.assetPlan)) {
    gate("operator_manifest_slots", `${draftKey}: approved plan slots differ from the stored plan`);
  }
  const seen = new Set<string>();
  const bytesBySlot = new Map<string, Buffer>();
  const filesDir = path.dirname(input.manifestPath);
  for (const candidate of candidates) {
    if (seen.has(candidate.slot)) gate("operator_manifest_slots", `${candidate.slot} appears twice in the manifest`);
    seen.add(candidate.slot);
    if (!planTags.has(candidate.slot)) gate("operator_manifest_slots", `${candidate.slot} is not a plan slot`);
    if (normalizeCreatorAssetTag(candidate.tag, "") !== candidate.tag || planTags.get(candidate.slot) !== candidate.tag) {
      gate("operator_manifest_tag", `${candidate.slot} tag ${candidate.tag} differs from the approved plan`);
    }
    if (path.basename(candidate.file) !== candidate.file) {
      gate("operator_manifest_file", `${candidate.slot} file must be a bare file name`);
    }
    const filePath = path.join(filesDir, candidate.file);
    if (!fs.existsSync(filePath)) gate("operator_manifest_file", `${candidate.slot} file ${candidate.file} is missing`);
    const bytes = fs.readFileSync(filePath);
    if (sha256Hex(bytes) !== candidate.rawSha256) {
      gate("operator_manifest_sha", `${candidate.slot} file ${candidate.file} differs from its manifest SHA-256`);
    }
    bytesBySlot.set(candidate.slot, bytes);
  }
  if (candidates.length === 0) gate("operator_manifest_slots", "manifest has no candidates");
  return { store, draftKey, characterId: input.characterId, actor, candidates, bytesBySlot, approvedPlan };
}

/** Intake lease still held by another run; claim refuses it until it expires. */
function liveIntakeLease(replacement: OfficialReplacementRecord, nowMs: number): string | null {
  if (!replacement.leaseOwner) return null;
  if (replacement.leaseExpiresAt != null && replacement.leaseExpiresAt < nowMs) return null;
  const until = replacement.leaseExpiresAt != null ? new Date(replacement.leaseExpiresAt).toISOString() : "no expiry";
  return `another intake holds the lease (${until})`;
}

function nextStep(
  replacement: OfficialReplacementRecord | null,
  candidate: ApprovedAssetCandidate,
  nowMs: number
): { next: SlotStep; reason: string | null } {
  if (!replacement) return { next: "intake", reason: null };
  const matches = replacement.candidateSha256 === candidate.rawSha256;
  const reclaim = (reason: string): { next: SlotStep; reason: string } => {
    const lease = liveIntakeLease(replacement, nowMs);
    return lease ? { next: "blocked", reason: lease } : { next: "intake", reason };
  };
  switch (replacement.status) {
    case "applied":
      return matches ? { next: "applied", reason: null } : { next: "blocked", reason: "another file is applied" };
    case "approved":
      return matches ? { next: "apply", reason: null } : { next: "blocked", reason: "another file is approved" };
    case "generated": {
      if (!matches) return reclaim("replaces an unreviewed candidate with another file");
      const verdict = officialModerationVerdict(replacement.moderation);
      switch (verdict) {
        case "missing":
        case "unavailable":
          return { next: "moderate", reason: verdict === "unavailable" ? "previous moderation unavailable" : null };
        case "rejected":
          return { next: "blocked", reason: "moderation rejected this file" };
        case "adult_flagged":
        case "clean":
          return { next: "review", reason: null };
        default: {
          const exhaustive: never = verdict;
          return gate("operator_state", String(exhaustive));
        }
      }
    }
    case "rejected":
      return { next: "blocked", reason: matches ? "review rejected this file" : "review rejected another file" };
    case "planned":
      return reclaim(
        replacement.leaseOwner ? "previous intake lease expired before registration" : "previous intake stopped before registration"
      );
    case "failed":
      return reclaim(`previous attempt failed${replacement.error ? `: ${replacement.error}` : ""}`);
    case "generating":
    case "upload_pending":
      return { next: "blocked", reason: `replacement is ${replacement.status}` };
    default: {
      const exhaustive: never = replacement.status;
      return gate("operator_state", String(exhaustive));
    }
  }
}

export function slotStatuses(target: ApprovedAssetOperatorTarget, nowMs = Date.now()): SlotStatus[] {
  const replacements = new Map(target.store.listReplacements(target.draftKey).map((r) => [r.slotKey, r]));
  return target.candidates.map((candidate) => {
    const replacement = replacements.get(candidate.slot) ?? null;
    const { next, reason } = nextStep(replacement, candidate, nowMs);
    return {
      slot: candidate.slot,
      tag: candidate.tag,
      rawSha256: candidate.rawSha256,
      activeUrl: target.store.getAsset(target.draftKey, candidate.slot).resultUrl,
      replacementStatus: replacement?.status ?? null,
      candidateUrl: replacement?.candidateResultUrl ?? null,
      candidateMatchesManifest: replacement?.candidateSha256 === candidate.rawSha256,
      moderation: replacement ? officialModerationVerdict(replacement.moderation) : null,
      next,
      reason,
    };
  });
}

function characterSummary(target: ApprovedAssetOperatorTarget, character: OfficialCharacterRecord) {
  return {
    draftKey: target.draftKey,
    characterId: target.characterId,
    stage: character.stage,
    textLockHash: character.textLockHash,
    appearanceLockHash: character.appearanceLockHash,
    admin: { id: target.actor.id, email: target.actor.email },
  };
}

export function approvedAssetStatus(target: ApprovedAssetOperatorTarget) {
  const character = target.store.getCharacter(target.draftKey);
  return {
    step: "status" as const,
    writes: 0,
    ...characterSummary(target, character),
    manifest: { candidates: target.candidates.length, filesMatchSha256: true },
    slots: slotStatuses(target),
    applies: listOfficialAssetReplacementApplies(target.store, target.draftKey),
    rereviews: target.store.listReplacementRereviews(target.draftKey).map((row) => ({
      id: row.id,
      slot: row.slotKey,
      candidateUrl: row.candidateResultUrl,
      candidateSha256: row.candidateSha256,
      previousStatus: row.previousStatus,
      newStatus: row.newStatus,
      reviewer: row.reviewer,
      createdAt: row.createdAt,
    })),
  };
}

/**
 * Registers every slot whose next step is intake through the existing
 * claim/register owner. A slot left planned or failed by an earlier run is
 * reclaimed by the same claim CAS; a live lease, an approved/applied file or a
 * running generation stays protected. The first failure stops the run and is
 * reported with its slot and code, never as skipped or registered.
 */
export async function runApprovedAssetIntake(
  target: ApprovedAssetOperatorTarget,
  deps: { storage: OfficialAssetStorage; imageOps: OfficialImageOps; nowMs?: number },
  execute: boolean
) {
  const statuses = slotStatuses(target, deps.nowMs);
  const pending = statuses.filter((s) => s.next === "intake");
  const registered: Array<{ slot: string; candidateUrl: string; candidateSha256: string; resumed: string | null }> = [];
  const report = (status: "planned" | "completed" | "stopped", failed: { slot: string; code: string; message: string } | null = null) => ({
    step: "intake" as const,
    execute,
    status,
    planned: pending.map((s) => ({ slot: s.slot, resumes: s.reason })),
    registered,
    failed,
    skipped: statuses.filter((s) => s.next !== "intake").map((s) => ({ slot: s.slot, next: s.next, reason: s.reason })),
  });
  if (!execute) return report("planned");
  for (const status of pending) {
    const candidate = target.candidates.find((c) => c.slot === status.slot)!;
    try {
      const record = await registerExternalOfficialAssetReplacement({
        store: target.store,
        storage: deps.storage,
        imageOps: deps.imageOps,
        actor: target.actor,
        draftKey: target.draftKey,
        slotKey: candidate.slot,
        bytes: target.bytesBySlot.get(candidate.slot)!,
        approvedTag: candidate.tag,
        nowMs: deps.nowMs,
      });
      if (record.candidateSha256 !== candidate.rawSha256 || !record.candidateResultUrl) {
        gate("operator_intake_sha", `${candidate.slot} stored candidate does not match the manifest SHA-256`);
      }
      registered.push({
        slot: candidate.slot,
        candidateUrl: record.candidateResultUrl,
        candidateSha256: record.candidateSha256,
        resumed: status.reason,
      });
    } catch (error) {
      const code = error instanceof OfficialSupplyGateError ? error.code : "intake_error";
      return report("stopped", { slot: candidate.slot, code, message: (error as Error).message });
    }
  }
  return report("completed");
}

/** Builds a moderator whose vision owner checks `control` before every provider POST, fallback included. */
export type ModerationMeter = {
  /** Provider POSTs one image may need (primary + internal fallback). */
  attemptsPerCall: number;
  createModerator(control: VisionRunControl): OfficialAssetModerator;
};

/** Caps for one command run; reruns get their own caps and are not summed. */
export type ModerationBudget = { maxCalls: number; maxCostUsd: number; perCallReserveUsd: number };

type ModerationPost = {
  slot: string;
  model: string;
  outcome: VisionProviderPost["outcome"];
  confirmedCostUsd: number | null;
  aboveReserve: boolean;
};

/** Billed cost of one vision attempt when the provider reported it; otherwise null. */
export function knownVisionAttemptCostUsd(attempt: VisionCostEvidence): number | null {
  if (attempt.usageEstimated) return null;
  return attempt.cheaperInferenceBilledCostUsd ?? attempt.upstreamCostUsd ?? null;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Paid moderation for one command run. Before every provider POST the vision
 * owner asks this meter; a POST is refused when it would pass the call cap,
 * when confirmed charges plus the reserve held for unknown-cost POSTs plus one
 * more reserve would pass the cost cap, or after any confirmed charge above
 * the per-call reserve. Unsent fallbacks and unused reserve are never reported
 * as calls or charges. Default is a plan with zero calls.
 */
export async function runApprovedAssetModeration(
  target: ApprovedAssetOperatorTarget,
  meter: ModerationMeter,
  budget: ModerationBudget | null,
  execute: boolean
) {
  const statuses = slotStatuses(target);
  const pending = statuses.filter((s) => s.next === "moderate").map((s) => s.slot);
  const worstCaseCalls = pending.length * meter.attemptsPerCall;
  const plan = {
    scope: "this command run" as const,
    pending,
    attemptsPerCall: meter.attemptsPerCall,
    worstCaseCalls,
    worstCaseCostUsd: budget ? round6(worstCaseCalls * budget.perCallReserveUsd) : null,
  };
  const posts: ModerationPost[] = [];
  const results: Array<{ slot: string; verdict: OfficialModerationVerdict }> = [];
  const reserve = budget?.perCallReserveUsd ?? 0;
  const confirmedCostUsd = () => posts.reduce((sum, p) => sum + (p.confirmedCostUsd ?? 0), 0);
  const unknownCostPosts = () => posts.filter((p) => p.confirmedCostUsd == null).length;
  const budgetUsedUsd = () => confirmedCostUsd() + unknownCostPosts() * reserve;
  const report = (
    status: "planned" | "completed" | "stopped",
    stopReason: string | null = null,
    error: { code: string; message: string } | null = null
  ) => ({
    step: "moderate" as const,
    execute,
    status,
    stopReason,
    error,
    plan,
    budget,
    accounting: {
      scope: "this command run" as const,
      providerPosts: posts.length,
      postsWithConfirmedCost: posts.length - unknownCostPosts(),
      confirmedCostUsd: round6(confirmedCostUsd()),
      postsWithUnknownCost: unknownCostPosts(),
      unknownCostReserveHeldUsd: round6(unknownCostPosts() * reserve),
      budgetUsedUsd: round6(budgetUsedUsd()),
      reservedUsd: execute ? plan.worstCaseCostUsd : null,
      unusedReserveUsd: execute && plan.worstCaseCostUsd != null ? round6(Math.max(0, plan.worstCaseCostUsd - budgetUsedUsd())) : null,
      chargesAboveReserve: posts
        .filter((p) => p.aboveReserve)
        .map((p) => ({ slot: p.slot, model: p.model, confirmedCostUsd: p.confirmedCostUsd, reserveUsd: reserve })),
    },
    posts,
    results,
    skipped: statuses.filter((s) => s.next !== "moderate").map((s) => ({ slot: s.slot, next: s.next })),
  });
  if (!execute) return report("planned");

  const valid = (n: number) => Number.isFinite(n) && n > 0;
  if (!budget || !Number.isInteger(budget.maxCalls) || !valid(budget.maxCalls) || !valid(budget.maxCostUsd) || !valid(budget.perCallReserveUsd)) {
    gate(
      "operator_moderation_budget_required",
      "paid moderation needs --max-calls, --max-cost-usd and --per-call-reserve-usd"
    );
  }
  if (worstCaseCalls > budget.maxCalls || worstCaseCalls * budget.perCallReserveUsd > budget.maxCostUsd + 1e-9) {
    gate(
      "operator_moderation_budget_exceeded",
      `${pending.length} images need up to ${worstCaseCalls} calls / ${plan.worstCaseCostUsd} USD; caps are ${budget.maxCalls} calls / ${budget.maxCostUsd} USD`
    );
  }
  const refusal = (): string | null => {
    const above = posts.find((p) => p.aboveReserve);
    if (above) {
      return `${above.slot} ${above.model} was billed ${above.confirmedCostUsd} USD, above the ${reserve} USD per-call reserve`;
    }
    if (posts.length + 1 > budget.maxCalls) return `call cap ${budget.maxCalls} reached`;
    if (budgetUsedUsd() + reserve > budget.maxCostUsd + 1e-9) return `cost cap ${budget.maxCostUsd} USD would be exceeded`;
    return null;
  };
  for (const slot of pending) {
    const before = refusal();
    if (before) return report("stopped", `${slot} not started: ${before}`);
    const control = { refused: null as string | null };
    const moderator = meter.createModerator({
      beforeProviderPost: () => {
        control.refused = refusal();
        return control.refused;
      },
      afterProviderPost: (post) => {
        const confirmed = post.cost ? knownVisionAttemptCostUsd(post.cost) : null;
        posts.push({
          slot,
          model: post.model,
          outcome: post.outcome,
          confirmedCostUsd: confirmed,
          aboveReserve: confirmed != null && confirmed > reserve,
        });
      },
    });
    let verdict: OfficialModerationVerdict;
    try {
      verdict = officialModerationVerdict(
        await moderateOfficialAssetReplacement({ store: target.store, moderator }, target.draftKey, slot)
      );
    } catch (error) {
      const code = error instanceof OfficialSupplyGateError ? error.code : "moderation_error";
      return report("stopped", `${slot} moderation failed`, { code, message: (error as Error).message });
    }
    results.push({ slot, verdict });
    if (control.refused) return report("stopped", `${slot}: ${control.refused}; the next provider POST was not sent`);
    if (posts.some((p) => p.aboveReserve)) return report("stopped", refusal());
    if (verdict === "unavailable") return report("stopped", `${slot} moderation unavailable`);
  }
  return report("completed");
}

export type ReviewEvidence = {
  draftKey: string;
  characterId: number;
  isolatedProofOnly: boolean;
  reviewer: string;
  approvalEvidence: string;
  slots: Array<{
    slot: string;
    candidateUrl: string;
    candidateSha256: string;
    qa: Record<string, QaCheck>;
    /** Only read with `rereview`: why the earlier rejected judgement of this same file is corrected. */
    correction?: { reason: string; evidence: string };
  }>;
};

function qaKeysFor(slot: string, target: ApprovedAssetOperatorTarget): readonly string[] {
  const kind = target.approvedPlan.slots.find((s) => s.slotKey === slot)?.kind;
  return kind === "representative" ? ANCHOR_QA_KEYS : VARIATION_QA_KEYS;
}

/** Unfilled review form for the slots awaiting review; it cannot be submitted as is. */
export function approvedAssetReviewTemplate(target: ApprovedAssetOperatorTarget) {
  return {
    draftKey: target.draftKey,
    characterId: target.characterId,
    isolatedProofOnly: false,
    reviewer: "",
    approvalEvidence: "",
    slots: slotStatuses(target)
      .filter((s) => s.next === "review")
      .map((s) => ({
        slot: s.slot,
        candidateUrl: s.candidateUrl,
        candidateSha256: s.rawSha256,
        qa: Object.fromEntries(qaKeysFor(s.slot, target).map((key) => [key, { ok: null, note: "" }])),
      })),
  };
}

/**
 * Records human review from an evidence file bound to each candidate URL and
 * SHA-256. Every QA check must be explicit with a note; nothing is filled in.
 * Test-fixture approvals and isolated-proof evidence never reach production.
 */
export function runApprovedAssetReview(
  target: ApprovedAssetOperatorTarget,
  evidenceBytes: Buffer,
  options: { execute: boolean; productionDatabase: boolean; rereview?: boolean }
) {
  const rereview = options.rereview === true;
  const evidence = JSON.parse(evidenceBytes.toString("utf8")) as ReviewEvidence;
  const fail = (message: string): never => gate("operator_review_evidence", message);
  if (evidence.draftKey !== target.draftKey || evidence.characterId !== target.characterId) {
    fail("evidence targets another draft or character");
  }
  if (typeof evidence.isolatedProofOnly !== "boolean") fail("isolatedProofOnly must be true or false");
  if (evidence.isolatedProofOnly && options.productionDatabase) {
    fail("isolated-proof review evidence cannot be recorded in the production database");
  }
  for (const text of [evidence.reviewer, evidence.approvalEvidence]) {
    if (typeof text !== "string" || !text.trim()) fail("reviewer and approvalEvidence are required");
    if (FIXTURE_RE.test(text)) fail("test-fixture approvals are not review evidence");
  }
  const statuses = new Map(slotStatuses(target).map((s) => [s.slot, s]));
  const replacements = new Map(target.store.listReplacements(target.draftKey).map((r) => [r.slotKey, r]));
  const seen = new Set<string>();
  const planned: Array<{
    slot: string;
    qa: Record<string, QaCheck>;
    candidateUrl: string;
    candidateSha256: string;
    correction: { reason: string; evidence: string } | null;
  }> = [];
  const alreadyReviewed: string[] = [];
  for (const entry of evidence.slots ?? []) {
    const candidate = target.candidates.find((c) => c.slot === entry.slot);
    if (!candidate || seen.has(entry.slot)) fail(`${entry.slot} is not a manifest slot or appears twice`);
    seen.add(entry.slot);
    if (entry.candidateSha256 !== candidate!.rawSha256) fail(`${entry.slot} SHA-256 differs from the manifest`);
    const status = statuses.get(entry.slot)!;
    const stored = replacements.get(entry.slot);
    if (!stored || stored.candidateResultUrl !== entry.candidateUrl || stored.candidateSha256 !== entry.candidateSha256) {
      fail(`${entry.slot} evidence does not name the stored candidate file`);
    }
    if (!rereview && (status.next === "apply" || status.next === "applied")) {
      alreadyReviewed.push(entry.slot);
      continue;
    }
    let correction: { reason: string; evidence: string } | null = null;
    if (rereview) {
      if (status.next !== "blocked" || stored!.status !== "rejected") {
        fail(`${entry.slot} has no rejected review to correct (${status.next})`);
      }
      if (target.approvedPlan.slots.find((s) => s.slotKey === entry.slot)?.kind !== "representative") {
        fail(`${entry.slot} explicit re-review is limited to the representative`);
      }
      const reason = entry.correction?.reason;
      const proof = entry.correction?.evidence;
      if (typeof reason !== "string" || !reason.trim() || typeof proof !== "string" || !proof.trim()) {
        fail(`${entry.slot} re-review needs correction.reason and correction.evidence`);
      }
      if (FIXTURE_RE.test(reason!) || FIXTURE_RE.test(proof!)) fail(`${entry.slot} correction is a test fixture`);
      correction = { reason: reason!.trim(), evidence: proof!.trim() };
    } else {
      if (entry.correction !== undefined) fail(`${entry.slot} correction is only accepted with --rereview`);
      if (status.next !== "review") {
        fail(`${entry.slot} is not ready for review (${status.next}${status.reason ? `: ${status.reason}` : ""})`);
      }
    }
    const keys = qaKeysFor(entry.slot, target);
    const extra = Object.keys(entry.qa ?? {}).filter((key) => !keys.includes(key));
    if (extra.length > 0) fail(`${entry.slot} has unknown QA checks ${extra.join(",")}`);
    const qa: Record<string, QaCheck> = {};
    for (const key of keys) {
      const check = entry.qa?.[key];
      if (!check || typeof check.ok !== "boolean" || typeof check.note !== "string" || !check.note.trim()) {
        fail(`${entry.slot}.${key} needs an explicit ok and a note`);
      }
      if (FIXTURE_RE.test(check!.note!)) fail(`${entry.slot}.${key} note is a test fixture`);
      qa[key] = { ok: check!.ok, note: check!.note!.trim() };
    }
    planned.push({
      slot: entry.slot,
      qa,
      candidateUrl: entry.candidateUrl,
      candidateSha256: entry.candidateSha256,
      correction,
    });
  }
  const recorded: Array<{ slot: string; approved: boolean; rereviewId?: number }> = [];
  if (options.execute) {
    for (const item of planned) {
      const kind = target.approvedPlan.slots.find((s) => s.slotKey === item.slot)!.kind;
      if (item.correction) {
        const corrected = target.store.rereviewRepresentativeReplacement(
          target.actor,
          target.draftKey,
          item.qa as OfficialAnchorQaReport,
          { candidateUrl: item.candidateUrl, candidateSha256: item.candidateSha256 },
          evidence.reviewer.trim(),
          item.correction
        );
        recorded.push({ slot: item.slot, approved: corrected.approved, rereviewId: corrected.rereviewId });
        continue;
      }
      const result =
        kind === "representative"
          ? target.store.reviewRepresentativeReplacement(
              target.actor,
              target.draftKey,
              item.qa as OfficialAnchorQaReport,
              { candidateUrl: item.candidateUrl, candidateSha256: item.candidateSha256 },
              evidence.reviewer.trim()
            )
          : target.store.reviewReplacement(
              target.actor,
              target.draftKey,
              item.slot,
              item.qa as OfficialVariationQaReport,
              item.candidateUrl
            );
      recorded.push({ slot: item.slot, approved: result.approved });
    }
  }
  return {
    step: "review" as const,
    execute: options.execute,
    rereview,
    evidenceSha256: sha256Hex(evidenceBytes),
    reviewer: evidence.reviewer.trim(),
    approvalEvidence: evidence.approvalEvidence.trim(),
    isolatedProofOnly: evidence.isolatedProofOnly,
    planned: planned.map((p) => ({
      slot: p.slot,
      candidateUrl: p.candidateUrl,
      candidateSha256: p.candidateSha256,
      allChecksOk: Object.values(p.qa).every((c) => c.ok),
      correction: p.correction,
    })),
    recorded,
    alreadyReviewed,
    notInEvidence: target.candidates.map((c) => c.slot).filter((slot) => !seen.has(slot)),
  };
}

function sameSlots(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join(",") === [...right].sort().join(",");
}

/** Default is a dry run; a recorded apply prints its id for rollback. */
export function runApprovedAssetApply(target: ApprovedAssetOperatorTarget, execute: boolean) {
  const statuses = slotStatuses(target);
  const slotKeys = target.candidates.map((c) => c.slot);
  if (statuses.every((s) => s.next === "applied")) {
    const ledger = listOfficialAssetReplacementApplies(target.store, target.draftKey)
      .filter((row) => row.status === "applied" && sameSlots(row.slotKeys, slotKeys))
      .at(-1);
    return { step: "apply" as const, execute, status: "already_applied" as const, applyId: ledger?.applyId ?? null, swapped: [] };
  }
  const notReady = statuses.filter((s) => s.next !== "apply");
  if (notReady.length > 0) {
    gate(
      "operator_apply_not_ready",
      `not approved for this manifest: ${notReady.map((s) => `${s.slot}=${s.next}`).join(", ")}`
    );
  }
  const replacements = new Map(target.store.listReplacements(target.draftKey).map((r) => [r.slotKey, r]));
  for (const candidate of target.candidates) {
    if (replacements.get(candidate.slot)?.approvedTag !== candidate.tag) {
      gate("operator_manifest_tag", `${candidate.slot} approved tag differs from the manifest`);
    }
  }
  const representativeSlot = target.approvedPlan.slots.find((s) => s.kind === "representative")?.slotKey;
  const result: OfficialReplacementApplyResult = applyApprovedOfficialAssetReplacements({
    store: target.store,
    draftKey: target.draftKey,
    actor: target.actor,
    slotKeys,
    ...(representativeSlot && slotKeys.includes(representativeSlot)
      ? { representative: { nextAssetPlan: target.approvedPlan, generationReference: "representative_identity_and_style" as const } }
      : {}),
    dryRun: !execute,
  });
  return { step: "apply" as const, execute, ...result };
}

export function runApprovedAssetRollback(
  target: ApprovedAssetOperatorTarget,
  applyId: string,
  execute: boolean
): { step: "rollback"; execute: boolean } & OfficialReplacementRollbackResult {
  if (!applyId.trim()) gate("operator_apply_id_required", "--apply-id is required");
  return {
    step: "rollback",
    execute,
    ...rollbackOfficialAssetReplacementApply({
      store: target.store,
      draftKey: target.draftKey,
      applyId: applyId.trim(),
      actor: target.actor,
      dryRun: !execute,
    }),
  };
}
