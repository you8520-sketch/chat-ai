import type { GenerationContextInput } from "./types";

/** Compact prompt-audit summary — no full prompt text */
function summarizePromptAudit(
  audit: GenerationContextInput["promptAudit"]
): Record<string, unknown> | undefined {
  if (!audit) return undefined;
  return {
    breakdown: audit.breakdown,
    systemPromptTokens: audit.systemPromptTokens,
    historyTokens: audit.historyTokens,
    currentUserTurnTokens: audit.currentUserTurnTokens,
    totalAssembledTokens: audit.totalAssembledTokens,
    sectionCount: audit.sectionCount,
    duplicateLabels: audit.duplicates?.map((d) => d.label) ?? [],
    inefficiencyCount: audit.inefficiencies?.length ?? 0,
  };
}

export function buildGenerationContextJson(input: GenerationContextInput): string {
  const ctx: Record<string, unknown> = {
    writingStyle: input.writingStyle,
    completedTurns: input.completedTurns,
    targetResponseChars: input.targetResponseChars,
    userImpersonation: input.userImpersonation,
    model: input.model,
    provider: input.provider,
    route: input.route,
    nsfw: input.nsfw,
  };
  if (input.truncatedMemory) ctx.truncatedMemory = true;
  if (input.speechProfileCharName) ctx.speechProfile = input.speechProfileCharName;
  if (input.regenerate) ctx.regenerate = true;
  if (input.variantIndex != null) ctx.variantIndex = input.variantIndex;
  const auditSummary = summarizePromptAudit(input.promptAudit);
  if (auditSummary) ctx.promptAudit = auditSummary;
  return JSON.stringify(ctx);
}

/** Simple deterministic hash for dedup / grouping */
export function computePromptHash(contextJson: string): string {
  let h = 0;
  for (let i = 0; i < contextJson.length; i++) {
    h = (Math.imul(31, h) + contextJson.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
