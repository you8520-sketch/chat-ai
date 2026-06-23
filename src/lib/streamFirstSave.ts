export { STREAM_SAVE_MIN_RETENTION } from "@/lib/streamFirstSaveConstants";
import { STREAM_SAVE_MIN_RETENTION } from "@/lib/streamFirstSaveConstants";

import { visibleAssistantDisplayCharCount, visibleAssistantDisplayText } from "@/lib/chatDisplayLength";
import { clampResponseLength, sanitizeStreamArtifacts } from "@/lib/responseLength";
import { recoverSentenceCompletion } from "@/lib/sentenceCompletionRecovery";
import { stripInternalTagLeakage, stripRpMetaLeakage } from "@/lib/narrativeRules";
import {
  partitionModelStatusArtifacts,
  stripAllStatusWindowOutputArtifacts,
  type StripStatusArtifactsOptions,
} from "@/lib/statusMeta/stripArtifacts";
import { stripLeakedDocumentMarkup } from "@/lib/chatHtmlSanitize";

export function streamSaveRetentionRatio(streamVisible: string, candidate: string): number {
  const base = visibleAssistantDisplayCharCount(streamVisible);
  if (base <= 0) return 1;
  return visibleAssistantDisplayCharCount(candidate) / base;
}

/** status/json/html만 제거 — RP 문단·서사 유지 */
export function stripFlashOwnedArtifactsOnly(
  text: string,
  opts?: StripStatusArtifactsOptions
): string {
  return stripLeakedDocumentMarkup(
    stripAllStatusWindowOutputArtifacts(
      stripInternalTagLeakage(sanitizeStreamArtifacts(stripRpMetaLeakage(text))),
      opts
    )
  );
}

/**
 * 스트림에서 유저가 본 텍스트(streamVisible)를 기준으로 후처리 결과(candidate)를 선택.
 * 5% 이상 prose 손실 시 streamVisible 유지 (hard cap 초과분만 clamp).
 */
export function preserveStreamFirstProse(
  streamVisible: string,
  candidate: string,
  targetResponseChars?: number | null,
  minRetention = STREAM_SAVE_MIN_RETENTION
): string {
  const stream = streamVisible.trimEnd();
  const cappedCandidate = clampResponseLength(candidate.trimEnd(), targetResponseChars);
  if (!stream) return cappedCandidate;

  const ratio = streamSaveRetentionRatio(stream, cappedCandidate);
  if (ratio >= minRetention) return cappedCandidate;

  console.warn("[stream-first-save] preserving stream-visible prose", {
    streamVisibleChars: visibleAssistantDisplayCharCount(stream),
    candidateChars: visibleAssistantDisplayCharCount(cappedCandidate),
    retention: Math.round(ratio * 1000) / 1000,
    minRetention,
  });
  return clampResponseLength(stream, targetResponseChars);
}

/** 스트림 종료 — status strip + cap만, dedupe/loop tail 금지 */
export function finalizeStreamEndProse(opts: {
  streamVisible: string;
  rawMerged: string;
  targetResponseChars?: number | null;
  statusArtifactsOpts?: StripStatusArtifactsOptions;
  oocHtmlMode?: boolean;
}): string {
  const stripped = opts.oocHtmlMode
    ? stripLeakedDocumentMarkup(
        stripInternalTagLeakage(sanitizeStreamArtifacts(stripRpMetaLeakage(opts.rawMerged)))
      )
    : stripFlashOwnedArtifactsOnly(opts.rawMerged, opts.statusArtifactsOpts);
  const processed = clampResponseLength(stripped, opts.targetResponseChars);
  const preserved = preserveStreamFirstProse(
    opts.streamVisible,
    processed,
    opts.targetResponseChars
  );
  const { text: completed, recovered } = recoverSentenceCompletion(preserved);
  if (recovered) {
    console.info("[sentence-completion-recovery] stream end", {
      beforeChars: preserved.length,
      afterChars: completed.length,
    });
  }
  return completed;
}

/** route 저장 — partition 후 stream-first 적용 */
export function applyStreamFirstAfterStatusPartition(opts: {
  streamVisible: string;
  prePartitionText: string;
  proseAfterPartition: string;
  targetResponseChars?: number | null;
}): string {
  const capped = clampResponseLength(opts.proseAfterPartition.trimEnd(), opts.targetResponseChars);
  const baseline =
    opts.streamVisible.trim() ||
    stripFlashOwnedArtifactsOnly(opts.prePartitionText).trimEnd();
  return preserveStreamFirstProse(baseline, capped, opts.targetResponseChars);
}

/** continuation merge — prior 본문 95% 미만으로 줄어들면 prior 유지 */
export function preserveStreamFirstContinuationMerge(
  priorProse: string,
  mergedProse: string,
  targetResponseChars?: number | null
): string {
  const prior = priorProse.trimEnd();
  const merged = mergedProse.trimEnd();
  if (!prior) return clampResponseLength(merged, targetResponseChars);
  const capped = clampResponseLength(merged, targetResponseChars);
  return preserveStreamFirstProse(prior, capped, targetResponseChars);
}

export function shouldSkipStreamEndShrink(
  streamVisible: string,
  nextText: string,
  minRetention = STREAM_SAVE_MIN_RETENTION
): boolean {
  const stream = streamVisible.trimEnd();
  const next = nextText.trimEnd();
  if (!stream || !next) return false;
  if (next.length >= stream.length) return false;
  return streamSaveRetentionRatio(stream, next) < minRetention;
}

/** @internal tests */
export function partitionStatusOnly(text: string, opts?: StripStatusArtifactsOptions) {
  return partitionModelStatusArtifacts(text, opts);
}

/** @internal tests */
export function visibleProseLength(text: string): number {
  return visibleAssistantDisplayText(text).length;
}
