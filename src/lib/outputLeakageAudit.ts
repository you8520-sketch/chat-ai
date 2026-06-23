import { KOREAN_CHARS_PER_OUTPUT_TOKEN } from "@/lib/responseLength";
import type { PartitionModelStatusResult } from "@/lib/statusMeta/stripArtifacts";
import { stripStatusWindowJsonBlock } from "@/lib/statusMeta/stripArtifacts";

export type OutputLeakageAudit = {
  apiOutputTokens: number;
  finishReason?: string | null;
  targetTier: number;
  chars: {
    modelDelivered: number;
    preStatusPartition: number;
    proseAfterPartition: number;
    afterClamp: number;
    savedBeforeHtmlFlash: number;
    savedFinal: number;
    savedVisibleBillable: number;
  };
  hiddenArtifacts: {
    detected: boolean;
    statusJsonChars: number;
    statusTableChars: number;
    statusHtmlChars: number;
    totalArtifactChars: number;
  };
  removed: {
    sanitizeChainChars: number;
    statusPartitionChars: number;
    clampChars: number;
    emotionDisplayStripChars: number;
    htmlFlashNetChars: number;
  };
  estimates: {
    hiddenTokenEstimate: number;
    savedCharsPerApiToken: number;
  };
};

export function buildOutputLeakageAudit(opts: {
  apiOutputTokens: number;
  finishReason?: string | null;
  targetTier: number;
  modelDeliveredText: string;
  preStatusPartitionText: string;
  statusArtifacts: PartitionModelStatusResult;
  afterClampText: string;
  savedBeforeHtmlFlash: string;
  savedFinalText: string;
  savedVisibleBillable: number;
}): OutputLeakageAudit {
  const modelDelivered = opts.modelDeliveredText.length;
  const preStatusPartition = opts.preStatusPartitionText.length;
  const proseAfterPartition = opts.statusArtifacts.prose.length;
  const afterClamp = opts.afterClampText.length;
  const savedBeforeHtmlFlash = opts.savedBeforeHtmlFlash.length;
  const savedFinal = opts.savedFinalText.length;

  const afterJsonStrip = stripStatusWindowJsonBlock(opts.preStatusPartitionText);
  const statusJsonChars = Math.max(0, preStatusPartition - afterJsonStrip.length);
  const statusTableChars = opts.statusArtifacts.capturedTableMarkdown?.length ?? 0;
  const statusHtmlChars = opts.statusArtifacts.capturedHtmlFence?.length ?? 0;
  const totalArtifactChars = statusJsonChars + statusTableChars + statusHtmlChars;
  const detected = totalArtifactChars > 0;

  const sanitizeChainChars = Math.max(0, modelDelivered - preStatusPartition);
  const statusPartitionChars = Math.max(0, preStatusPartition - proseAfterPartition);
  const clampChars = Math.max(0, proseAfterPartition - afterClamp);
  const emotionDisplayStripChars = Math.max(0, afterClamp - savedBeforeHtmlFlash);
  const htmlFlashNetChars = savedFinal - savedBeforeHtmlFlash;

  const hiddenTokenEstimate = Math.ceil(totalArtifactChars / KOREAN_CHARS_PER_OUTPUT_TOKEN);
  const savedCharsPerApiToken =
    opts.apiOutputTokens > 0
      ? Math.round((opts.savedVisibleBillable / opts.apiOutputTokens) * 1000) / 1000
      : 0;

  return {
    apiOutputTokens: opts.apiOutputTokens,
    finishReason: opts.finishReason ?? null,
    targetTier: opts.targetTier,
    chars: {
      modelDelivered,
      preStatusPartition,
      proseAfterPartition,
      afterClamp,
      savedBeforeHtmlFlash,
      savedFinal,
      savedVisibleBillable: opts.savedVisibleBillable,
    },
    hiddenArtifacts: {
      detected,
      statusJsonChars,
      statusTableChars,
      statusHtmlChars,
      totalArtifactChars,
    },
    removed: {
      sanitizeChainChars,
      statusPartitionChars,
      clampChars,
      emotionDisplayStripChars,
      htmlFlashNetChars,
    },
    estimates: {
      hiddenTokenEstimate,
      savedCharsPerApiToken,
    },
  };
}

export function shouldLogOutputLeakageAudit(): boolean {
  return process.env.OUTPUT_LEAKAGE_AUDIT === "1" || process.env.NODE_ENV !== "production";
}

export function logOutputLeakageAudit(audit: OutputLeakageAudit, chatId?: number): void {
  if (!shouldLogOutputLeakageAudit()) return;
  console.log("[OUTPUT LEAKAGE AUDIT]", {
    chatId,
    apiOutputTokens: audit.apiOutputTokens,
    finishReason: audit.finishReason,
    targetTier: audit.targetTier,
    savedVisibleBillable: audit.chars.savedVisibleBillable,
    savedCharsPerApiToken: audit.estimates.savedCharsPerApiToken,
    modelDeliveredChars: audit.chars.modelDelivered,
    hiddenArtifacts: audit.hiddenArtifacts,
    removed: audit.removed,
  });
}
