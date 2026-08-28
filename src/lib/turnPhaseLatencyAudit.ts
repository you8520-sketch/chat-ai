/**
 * Temporary E2E phase latency audit — active only when GEMINI_TTFT_PHASE_AUDIT=1.
 * No prose bodies; timestamps and token counts only.
 */

export type TurnPhaseTokenSnapshot = {
  prompt_tokens?: number;
  cached_tokens?: number;
  cache_ratio?: number | null;
  completion_tokens?: number;
  reasoning_tokens?: number;
  estimated_input_tokens?: number;
  estimated?: boolean;
};

export type TurnPhaseLatencyReport = {
  request_id: string;
  marks: Record<string, number>;
  deltas_ms: Record<string, number | null>;
  PRE_PROVIDER_TOTAL_MS: number | null;
  MEMORY_SYNC_MS: number | null;
  SUMMARY_PREP_MS: number | null;
  SUMMARY_BARRIER_WAIT_MS: number | null;
  CANON_MS: number | null;
  CONTEXT_BUILD_MS: number | null;
  REQUEST_ASSEMBLY_MS: number | null;
  PROVIDER_WAIT_MS: number | null;
  PROVIDER_VISIBLE_TTFT_MS: number | null;
  SERVER_STREAM_MS: number | null;
  CLIENT_TRANSPORT_MS: number | null;
  UI_REVEAL_DELAY_MS: number | null;
  USER_VISIBLE_TTFT_MS: number | null;
  tokens: TurnPhaseTokenSnapshot;
};

let activeAudit: TurnPhaseLatencyAudit | null = null;

export function isTurnPhaseAuditEnabled(): boolean {
  return process.env.GEMINI_TTFT_PHASE_AUDIT === "1";
}

export class TurnPhaseLatencyAudit {
  readonly requestId: string;
  readonly originMs: number;
  private marksInternal: Record<string, number> = {};
  private tokensInternal: TurnPhaseTokenSnapshot = {};

  constructor(requestId: string, originMs?: number) {
    this.requestId = requestId;
    this.originMs = originMs ?? Date.now();
    this.marksInternal.T0_REQUEST_IN = this.originMs;
  }

  backfillMark(name: string, epochMs: number): void {
    this.marksInternal[name] = epochMs;
  }

  mark(name: string): void {
    if (this.marksInternal[name] != null) return;
    this.marksInternal[name] = Date.now();
  }

  setTokens(snapshot: TurnPhaseTokenSnapshot): void {
    this.tokensInternal = { ...this.tokensInternal, ...snapshot };
    if (
      snapshot.prompt_tokens != null &&
      snapshot.cached_tokens != null &&
      snapshot.prompt_tokens > 0
    ) {
      this.tokensInternal.cache_ratio =
        Math.round((snapshot.cached_tokens / snapshot.prompt_tokens) * 1000) / 1000;
    }
  }

  delta(from: string, to: string): number | null {
    const a = this.marksInternal[from];
    const b = this.marksInternal[to];
    if (a == null || b == null) return null;
    return Math.max(0, b - a);
  }

  deltaFromOrigin(to: string): number | null {
    const b = this.marksInternal[to];
    if (b == null) return null;
    return Math.max(0, b - this.originMs);
  }

  buildReport(clientSubmitMs?: number | null): TurnPhaseLatencyReport {
    const m = this.marksInternal;
    const d = (a: string, b: string) => this.delta(a, b);
    const report: TurnPhaseLatencyReport = {
      request_id: this.requestId,
      marks: { ...m },
      deltas_ms: {},
      PRE_PROVIDER_TOTAL_MS: d("T0_REQUEST_IN", "T10_PROVIDER_FETCH_START"),
      MEMORY_SYNC_MS: d("T3_MEMORY_SYNC_START", "T4_MEMORY_SYNC_DONE"),
      SUMMARY_PREP_MS: d("T4a_SUMMARY_PREP_START", "T4b_SUMMARY_PREP_DONE"),
      SUMMARY_BARRIER_WAIT_MS: d("T4_MEMORY_SYNC_DONE", "T5_CANON_START"),
      CANON_MS: d("T5_CANON_START", "T6_CANON_DONE"),
      CONTEXT_BUILD_MS: d("T7_CONTEXT_BUILD_START", "T8_CONTEXT_BUILD_DONE"),
      REQUEST_ASSEMBLY_MS: d("T8_CONTEXT_BUILD_DONE", "T9_REQUEST_ASSEMBLY_DONE"),
      PROVIDER_WAIT_MS: d("T10_PROVIDER_FETCH_START", "T12_PROVIDER_FIRST_SSE"),
      PROVIDER_VISIBLE_TTFT_MS: d("T10_PROVIDER_FETCH_START", "T13_PROVIDER_FIRST_VISIBLE_TOKEN"),
      SERVER_STREAM_MS: d("T13_PROVIDER_FIRST_VISIBLE_TOKEN", "T14_SERVER_FIRST_VISIBLE_WRITE"),
      CLIENT_TRANSPORT_MS:
        clientSubmitMs != null && m.T15_BROWSER_FIRST_VISIBLE_RECEIVE != null
          ? Math.max(0, m.T15_BROWSER_FIRST_VISIBLE_RECEIVE - (m.T14_SERVER_FIRST_VISIBLE_WRITE ?? clientSubmitMs))
          : null,
      UI_REVEAL_DELAY_MS:
        m.T15_BROWSER_FIRST_VISIBLE_RECEIVE != null && m.T16_UI_FIRST_CHARACTER_PAINT != null
          ? Math.max(0, m.T16_UI_FIRST_CHARACTER_PAINT - m.T15_BROWSER_FIRST_VISIBLE_RECEIVE)
          : null,
      USER_VISIBLE_TTFT_MS:
        m.T16_UI_FIRST_CHARACTER_PAINT != null
          ? this.deltaFromOrigin("T16_UI_FIRST_CHARACTER_PAINT")
          : m.T15_BROWSER_FIRST_VISIBLE_RECEIVE != null
            ? this.deltaFromOrigin("T15_BROWSER_FIRST_VISIBLE_RECEIVE")
            : this.deltaFromOrigin("T14_SERVER_FIRST_VISIBLE_WRITE"),
      tokens: { ...this.tokensInternal },
    };
    for (const key of Object.keys(m)) {
      report.deltas_ms[`${key}_from_T0`] = this.deltaFromOrigin(key);
    }
    return report;
  }

  log(clientSubmitMs?: number | null): TurnPhaseLatencyReport {
    const report = this.buildReport(clientSubmitMs);
    console.info("[TurnPhaseLatency]", report);
    return report;
  }
}

export function beginTurnPhaseAudit(
  requestId: string,
  originMs?: number
): TurnPhaseLatencyAudit | null {
  if (!isTurnPhaseAuditEnabled()) return null;
  const audit = new TurnPhaseLatencyAudit(requestId, originMs);
  activeAudit = audit;
  return audit;
}

export function getActiveTurnPhaseAudit(): TurnPhaseLatencyAudit | null {
  return activeAudit;
}

export function clearActiveTurnPhaseAudit(audit: TurnPhaseLatencyAudit | null): void {
  if (activeAudit === audit) activeAudit = null;
}

export function wrapSendForPhaseAudit(
  send: (obj: object) => void,
  audit: TurnPhaseLatencyAudit | null
): (obj: object) => void {
  if (!audit) return send;
  return (obj: object) => {
    const rec = obj as { type?: string; text?: string; delta?: string };
    if (
      audit &&
      audit.buildReport().marks.T14_SERVER_FIRST_VISIBLE_WRITE == null &&
      (rec.type === "delta" ||
        rec.type === "append" ||
        (rec.type === "replace" && Boolean(rec.text?.trim())))
    ) {
      audit.mark("T14_SERVER_FIRST_VISIBLE_WRITE");
    }
    send(obj);
  };
}
