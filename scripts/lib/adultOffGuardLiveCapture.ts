/**
 * 성인 OFF 실측 스크립트의 공급자 호출 추적.
 * fetch를 시작한 순간부터 기록하고, 후속 작업 owner와 장부 마감이 끝난 뒤에만 완료로 본다.
 * 청구 ID는 readCompatibleCompletionProviderRequestId만 사용한다. completion id로 대체하지 않는다.
 */
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
} from "../../src/lib/cheaperInferenceConfig";
import { OPENROUTER_CHAT_COMPLETIONS_URL } from "../../src/lib/openRouterConfig";
import {
  readCompatibleCompletionProviderRequestId,
  type DeliveredCompletionProvider,
} from "../../src/lib/openRouterCompletion";
import {
  classifyCostRows,
  type CostClassification,
  type CostLedgerRow,
} from "./adultOffGuardEvidence";

export type MeasuredLedgerRow = CostLedgerRow & {
  provider_request_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
};

export type CapturedCallSnapshot = {
  kind: string;
  model: string;
  url: string;
  requestBodyChars: number;
  status: number | null;
  providerRequestId: string | null;
  /** 응답 JSON의 completion id. 청구 ID가 아니다. */
  completionId: string | null;
  headerError: string | null;
  bodyError: string | null;
  startedAtMs: number;
  headerAtMs: number | null;
  endedAtMs: number | null;
  responseText: string;
  /** 청구 ID가 같은 장부 행이 정확히 하나일 때만. 시간 근접으로 붙이지 않는다. */
  ledgerRequestKind: string | null;
};

export type MeasuredTurnReason =
  | "ok"
  | "owner_failed"
  | "call_unreadable"
  | "ledger_not_closed"
  | "timed_out";

export type MeasuredTurnReport = {
  reason: MeasuredTurnReason;
  calls: CapturedCallSnapshot[];
  ledger: MeasuredLedgerRow[];
  mayDeleteLedger: boolean;
  mayReportSuccess: boolean;
  cost: {
    confirmedUsd: number;
    estimatedUsd: number;
    unconfirmedRows: CostClassification["unconfirmedRows"];
    /** 미확정 행이 있으면 null. null 비용을 0으로 더한 합계가 아니다. */
    knownUsd: number | null;
  };
};

type TrackedCall = CapturedCallSnapshot & {
  settled: Promise<void>;
  markSettled: () => void;
};

const TERMINAL_LEDGER = new Set([
  "settled",
  "failed_with_usage",
  "failed_without_usage",
  "completed_without_exact_cost",
]);

export function providerForCompletionUrl(url: string): DeliveredCompletionProvider | null {
  if (
    url === CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL ||
    url.startsWith(`${CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL}?`)
  ) {
    return "cheaperinference";
  }
  if (
    url === OPENROUTER_CHAT_COMPLETIONS_URL ||
    url.startsWith(`${OPENROUTER_CHAT_COMPLETIONS_URL}?`)
  ) {
    return "openrouter";
  }
  return null;
}

export function isLedgerRowTerminal(eventStatus: string | null): boolean {
  return eventStatus != null && TERMINAL_LEDGER.has(eventStatus);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function completionIdOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const id = (body as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function linkLedgerKind(call: CapturedCallSnapshot, ledger: readonly MeasuredLedgerRow[]): string | null {
  if (!call.providerRequestId) return null;
  const matches = ledger.filter((row) => row.provider_request_id === call.providerRequestId);
  return matches.length === 1 ? matches[0].request_kind : null;
}

export function createAdultOffLiveCapture(options?: { now?: () => number }) {
  const now = options?.now ?? (() => Date.now());
  let calls: TrackedCall[] = [];

  function snapshot(): CapturedCallSnapshot[] {
    return calls.map(({ settled: _settled, markSettled: _mark, ...rest }) => ({ ...rest }));
  }

  function reset(): void {
    calls = [];
  }

  async function forward(
    realFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    meta: { kind: string; model: string }
  ): Promise<Response> {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const bodyText = typeof init?.body === "string" ? init.body : "";
    let resolveSettled: () => void = () => {};
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    const call: TrackedCall = {
      kind: meta.kind,
      model: meta.model,
      url,
      requestBodyChars: bodyText.length,
      status: null,
      providerRequestId: null,
      completionId: null,
      headerError: null,
      bodyError: null,
      startedAtMs: now(),
      headerAtMs: null,
      endedAtMs: null,
      responseText: "",
      ledgerRequestKind: null,
      settled,
      markSettled: resolveSettled,
    };
    calls.push(call);

    const finish = () => {
      if (call.endedAtMs == null) call.endedAtMs = now();
      call.markSettled();
    };

    try {
      const response = await realFetch(input, init);
      call.status = response.status;
      call.headerAtMs = now();
      const provider = providerForCompletionUrl(url);
      if (provider) {
        call.providerRequestId = readCompatibleCompletionProviderRequestId({
          provider,
          headers: response.headers,
        });
      }
      let clone: Response;
      try {
        clone = response.clone();
      } catch (error) {
        call.bodyError = errorText(error);
        finish();
        return response;
      }
      void clone
        .text()
        .then((text) => {
          call.responseText = text;
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = null;
          }
          call.completionId = completionIdOf(parsed);
          if (provider) {
            call.providerRequestId = readCompatibleCompletionProviderRequestId({
              provider,
              headers: response.headers,
              body: parsed,
            });
          }
        })
        .catch((error: unknown) => {
          call.bodyError = errorText(error);
        })
        .finally(finish);
      return response;
    } catch (error) {
      call.headerError = errorText(error);
      finish();
      throw error;
    }
  }

  async function finish(input: {
    listOwners: () => readonly Promise<unknown>[];
    readLedger: () => MeasuredLedgerRow[];
    deadlineMs: number;
    estimatesUsdByRequestKind?: ReadonlyMap<string, number>;
  }): Promise<MeasuredTurnReport> {
    const deadlineAt = now() + input.deadlineMs;
    const ownerState = new Map<Promise<unknown>, "pending" | "done" | "failed">();

    const observeOwner = (owner: Promise<unknown>) => {
      if (ownerState.has(owner)) return;
      ownerState.set(owner, "pending");
      void owner.then(
        () => {
          if (ownerState.get(owner) === "pending") ownerState.set(owner, "done");
        },
        () => {
          ownerState.set(owner, "failed");
        }
      );
    };

    const pendingWork = (): Array<Promise<unknown>> => {
      for (const owner of input.listOwners()) observeOwner(owner);
      const owners = [...ownerState.entries()]
        .filter(([, state]) => state === "pending")
        .map(([owner]) => owner);
      const inflight = calls.filter((call) => call.endedAtMs == null).map((call) => call.settled);
      return [...owners, ...inflight];
    };

    let timedOut = false;
    for (;;) {
      const pending = pendingWork();
      if (pending.length === 0) break;
      const remaining = deadlineAt - now();
      if (remaining <= 0) {
        timedOut = true;
        break;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        Promise.all(pending).then(() => "work" as const),
        new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), remaining);
        }),
      ]);
      if (timer) clearTimeout(timer);
      if (outcome === "timeout") {
        timedOut = true;
        break;
      }
    }

    const ledger = input.readLedger();
    const linked = snapshot().map((call) => ({
      ...call,
      ledgerRequestKind: linkLedgerKind(call, ledger),
    }));
    for (const call of calls) {
      call.ledgerRequestKind = linkLedgerKind(call, ledger);
    }
    const costRows = classifyCostRows(ledger, input.estimatesUsdByRequestKind ?? new Map());
    const knownUsd =
      costRows.unconfirmedRows.length === 0 ? costRows.confirmedUsd + costRows.estimatedUsd : null;
    const ownerFailed = [...ownerState.values()].some((state) => state === "failed");
    const unreadable = linked.some((call) => call.headerError != null || call.bodyError != null);
    const ledgerOpen = ledger.some((row) => !isLedgerRowTerminal(row.event_status));
    let reason: MeasuredTurnReason = "ok";
    if (timedOut) reason = "timed_out";
    else if (ownerFailed) reason = "owner_failed";
    else if (unreadable) reason = "call_unreadable";
    else if (ledgerOpen) reason = "ledger_not_closed";
    const ok = reason === "ok";
    return {
      reason,
      calls: linked,
      ledger,
      mayDeleteLedger: ok,
      mayReportSuccess: ok,
      cost: {
        confirmedUsd: costRows.confirmedUsd,
        estimatedUsd: costRows.estimatedUsd,
        unconfirmedRows: costRows.unconfirmedRows,
        knownUsd,
      },
    };
  }

  return { forward, finish, snapshot, reset };
}

/** 완료된 실행만 장부를 지운다. 미완료 attempt가 있으면 호출하지 않는다. */
export function commitMeasuredLedger(
  report: Pick<MeasuredTurnReport, "mayDeleteLedger" | "mayReportSuccess">,
  deleteLedger: () => void
): "called" | "incomplete" {
  if (report.mayDeleteLedger) deleteLedger();
  return report.mayReportSuccess ? "called" : "incomplete";
}
