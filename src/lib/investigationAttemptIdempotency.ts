import { createHash } from "node:crypto";
import type { InvestigationActionType } from "@/lib/investigationTypes";
import {
  INVESTIGATION_MATCHER_VERSION,
  INVESTIGATION_RESOLVER_VERSION,
} from "@/lib/investigationCatalog";
import { hashInvestigationTags } from "@/lib/investigationTargets";

export function buildInvestigationAttemptIdempotencyKey(opts: {
  chatId: number;
  sourceMessageId: number | null;
  actionId?: string | null;
  actionType: InvestigationActionType;
  targetKey: string;
  resolverVersion?: number;
}): string {
  const source =
    opts.sourceMessageId != null
      ? `msg:${opts.sourceMessageId}`
      : `action:${opts.actionId ?? "none"}`;
  const version = opts.resolverVersion ?? INVESTIGATION_RESOLVER_VERSION;
  return [
    "investigation-attempt",
    opts.chatId,
    source,
    opts.actionType,
    opts.targetKey,
    version,
  ].join(":");
}

export function buildInvestigationResultIdempotencyKey(opts: {
  attemptId: string;
  resultType: string;
  resultTags: string[];
  resolverVersion?: number;
}): string {
  const version = opts.resolverVersion ?? INVESTIGATION_RESOLVER_VERSION;
  return [
    "investigation-result",
    opts.attemptId,
    opts.resultType,
    hashInvestigationTags(opts.resultTags),
    version,
  ].join(":");
}

export function buildInvestigationDiscoveryIdempotencyKey(opts: {
  investigationResultId: string;
  discoveryRuleId: string;
  observerType: string;
  observerId: string;
  matcherVersion?: number;
}): string {
  const version = opts.matcherVersion ?? INVESTIGATION_MATCHER_VERSION;
  return [
    "investigation-discovery",
    opts.investigationResultId,
    opts.discoveryRuleId,
    opts.observerType,
    opts.observerId,
    version,
  ].join(":");
}

export function sha16(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, 16);
}
