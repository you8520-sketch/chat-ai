/**
 * 후처리 단계별 실제 삭제 문자열 추적 — [REMOVAL TRACE] 로그
 * 각 stage는 실제 before→after 변환만 기록 (추정/probe 금지).
 */

export type RemovalRegion = {
  start: number;
  end: number;
  text: string;
};

export type RemovalStageRecord = {
  stage: string;
  beforeChars: number;
  afterChars: number;
  removedChars: number;
  insertedChars: number;
  removedText: string;
  removedTextWithContext: string;
  reason: string;
};

export type RemovalTraceReport = {
  rawModelChars: number;
  finalSavedChars: number;
  finalLossChars: number;
  stages: RemovalStageRecord[];
  dominantCulprit: string | null;
};

export type RemovalTraceStep = {
  stage: string;
  before: string;
  after: string;
  reason: string;
};

const CONTEXT_CHARS = 120;
/** Terminal preview cap — full dump when REMOVAL_TRACE_FULL=1 */
const REMOVAL_TRACE_REMOVED_TEXT_PREVIEW_CHARS = 240;

function formatRemovedTextForLog(removedText: string, removedTextWithContext: string): string {
  const body = removedTextWithContext || removedText;
  if (!body) return "";
  if (
    process.env.REMOVAL_TRACE_FULL === "1" ||
    body.length <= REMOVAL_TRACE_REMOVED_TEXT_PREVIEW_CHARS
  ) {
    return body;
  }
  const preview = body.slice(0, REMOVAL_TRACE_REMOVED_TEXT_PREVIEW_CHARS);
  return `${preview}\n… [removed_text_truncated: showing ${REMOVAL_TRACE_REMOVED_TEXT_PREVIEW_CHARS} of ${body.length} chars — set REMOVAL_TRACE_FULL=1 for full dump]`;
}

/** before → after (순서 유지 매칭) 기준 삭제 구간 */
export function diffRemovedRegions(before: string, after: string): {
  regions: RemovalRegion[];
  removedChars: number;
  insertedChars: number;
} {
  const regions: RemovalRegion[] = [];
  let bi = 0;
  let ai = 0;
  let regionStart: number | null = null;

  while (bi < before.length) {
    if (ai < after.length && before[bi] === after[ai]) {
      if (regionStart != null) {
        regions.push({
          start: regionStart,
          end: bi,
          text: before.slice(regionStart, bi),
        });
        regionStart = null;
      }
      bi++;
      ai++;
    } else {
      if (regionStart == null) regionStart = bi;
      bi++;
    }
  }

  if (regionStart != null) {
    regions.push({
      start: regionStart,
      end: before.length,
      text: before.slice(regionStart),
    });
  }

  const removedChars = regions.reduce((sum, r) => sum + r.text.length, 0);
  const insertedChars = ai < after.length ? after.length - ai : 0;
  return { regions, removedChars, insertedChars };
}

export function formatRemovedWithContext(before: string, regions: RemovalRegion[]): string {
  if (regions.length === 0) return "";
  const parts = regions.map((r) => {
    const ctxStart = Math.max(0, r.start - CONTEXT_CHARS);
    const ctxEnd = Math.min(before.length, r.end + CONTEXT_CHARS);
    return before.slice(ctxStart, ctxEnd);
  });
  return parts.join("\n---\n");
}

export function buildRemovalStageRecord(
  stage: string,
  before: string,
  after: string,
  reason: string
): RemovalStageRecord | null {
  if (before === after) return null;
  const { regions, removedChars, insertedChars } = diffRemovedRegions(before, after);
  if (removedChars === 0 && insertedChars === 0 && before.length === after.length) return null;

  const removedText = regions.map((r) => r.text).join("");
  return {
    stage,
    beforeChars: before.length,
    afterChars: after.length,
    removedChars,
    insertedChars,
    removedText,
    removedTextWithContext: formatRemovedWithContext(before, regions),
    reason,
  };
}

export class RemovalTraceCollector {
  private readonly stages: RemovalStageRecord[] = [];
  private rawModelText = "";
  private finalSavedText = "";

  setRawModelText(text: string): void {
    this.rawModelText = text;
  }

  setFinalSavedText(text: string): void {
    this.finalSavedText = text;
  }

  /** removed_chars: 0 baseline — 변환 없음, 길이만 기록 */
  recordBaseline(stage: string, text: string, reason: string): void {
    this.stages.push({
      stage,
      beforeChars: text.length,
      afterChars: text.length,
      removedChars: 0,
      insertedChars: 0,
      removedText: "",
      removedTextWithContext: "",
      reason,
    });
  }

  record(stage: string, before: string, after: string, reason: string): string {
    const rec = buildRemovalStageRecord(stage, before, after, reason);
    if (rec) this.stages.push(rec);
    return after;
  }

  apply<T extends string>(stage: string, before: string, fn: (input: string) => T, reason: string): T {
    const after = fn(before);
    this.record(stage, before, after, reason);
    return after;
  }

  build(): RemovalTraceReport {
    const rawModelChars = this.rawModelText.length;
    const finalSavedChars = this.finalSavedText.length;
    const finalLossChars = Math.max(0, rawModelChars - finalSavedChars);

    let dominantCulprit: string | null = null;
    let maxRemoved = 0;
    for (const s of this.stages) {
      if (s.removedChars > maxRemoved) {
        maxRemoved = s.removedChars;
        dominantCulprit = s.stage;
      }
    }

    return {
      rawModelChars,
      finalSavedChars,
      finalLossChars,
      stages: [...this.stages],
      dominantCulprit,
    };
  }
}

export function shouldLogRemovalTrace(): boolean {
  return process.env.REMOVAL_TRACE === "1" || process.env.NODE_ENV !== "production";
}

export function formatRemovalTraceLog(
  report: RemovalTraceReport,
  meta?: { chatId?: number; savedVisibleChars?: number }
): string {
  const lines: string[] = ["[REMOVAL TRACE]"];
  if (meta?.chatId != null) lines.push(`chat_id: ${meta.chatId}`);
  lines.push(`raw_model_chars: ${report.rawModelChars.toLocaleString()}`);
  lines.push(`final_saved_chars: ${report.finalSavedChars.toLocaleString()}`);
  if (meta?.savedVisibleChars != null) {
    lines.push(`saved_visible_billable_chars: ${meta.savedVisibleChars.toLocaleString()}`);
  }
  lines.push("");

  for (const s of report.stages) {
    lines.push(`stage: ${s.stage}`);
    lines.push(`removed_chars: ${s.removedChars.toLocaleString()}`);
    if (s.insertedChars > 0) {
      lines.push(`inserted_chars: ${s.insertedChars.toLocaleString()}`);
    }
    if (s.beforeChars !== s.afterChars || s.removedChars > 0) {
      lines.push(
        `before_chars: ${s.beforeChars.toLocaleString()} → after_chars: ${s.afterChars.toLocaleString()}`
      );
    }
    lines.push("");
    if (s.removedChars > 0) {
      lines.push("removed_text:");
      lines.push(`"${formatRemovedTextForLog(s.removedText, s.removedTextWithContext)}"`);
      lines.push("");
    }
    lines.push("reason:");
    lines.push(s.reason);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  lines.push("FINAL_LOSS:");
  lines.push(`${report.finalLossChars.toLocaleString()} chars`);
  lines.push("");
  lines.push("dominant_culprit:");
  lines.push(report.dominantCulprit ?? "(none — length matched or insertions offset)");
  return lines.join("\n");
}

export function logRemovalTrace(
  report: RemovalTraceReport,
  meta?: { chatId?: number; savedVisibleChars?: number }
): void {
  if (!shouldLogRemovalTrace()) return;
  console.log(formatRemovalTraceLog(report, meta));
}

/** 실제 chronology steps만 반영 — hypothetical probe 없음 */
export function buildRemovalTraceReport(opts: {
  rawModelText: string;
  rawModelTextReason: string;
  /** openRouter stream end — before modelDeliveredText baseline */
  preRouteSteps?: RemovalTraceStep[];
  /** route save pipeline after modelDeliveredText */
  steps: RemovalTraceStep[];
  finalSavedText: string;
}): RemovalTraceReport {
  const c = new RemovalTraceCollector();
  c.setRawModelText(opts.rawModelText);

  for (const step of opts.preRouteSteps ?? []) {
    c.record(step.stage, step.before, step.after, step.reason);
  }

  c.recordBaseline("raw_model_text", opts.rawModelText, opts.rawModelTextReason);

  for (const step of opts.steps) {
    c.record(step.stage, step.before, step.after, step.reason);
  }

  const allSteps = [...(opts.preRouteSteps ?? []), ...opts.steps];
  const lastPipelineText =
    allSteps.length > 0 ? allSteps[allSteps.length - 1]!.after : opts.rawModelText;
  if (lastPipelineText !== opts.finalSavedText) {
    c.record(
      "final_saved_text",
      lastPipelineText,
      opts.finalSavedText,
      "remaining mutations → DB savedText (html flash / continuation / clamp if not yet traced)"
    );
  } else {
    c.recordBaseline(
      "final_saved_text",
      opts.finalSavedText,
      "DB savedText — no further mutations after prior stages"
    );
  }

  c.setFinalSavedText(opts.finalSavedText);
  return c.build();
}

/** @deprecated use buildRemovalTraceReport with explicit steps */
export function traceOpenRouterSavePipeline(opts: {
  rawModelTextReason: string;
  steps: RemovalTraceStep[];
  finalSavedText: string;
  modelDeliveredText?: string;
}): RemovalTraceReport {
  const raw =
    opts.modelDeliveredText ??
    (opts.steps.length > 0 ? opts.steps[0]!.before : opts.finalSavedText);
  return buildRemovalTraceReport({
    rawModelText: raw,
    rawModelTextReason: opts.rawModelTextReason,
    steps: opts.steps,
    finalSavedText: opts.finalSavedText,
  });
}

/** step push helper — skips no-op transforms */
export function pushRemovalTraceStep(
  steps: RemovalTraceStep[],
  stage: string,
  before: string,
  after: string,
  reason: string
): string {
  if (before !== after) {
    steps.push({ stage, before, after, reason });
  }
  return after;
}
