"use client";

import {
  buildTrpgImageSceneDiagnosticsDisplayRows,
  isTrpgAiFocusRawFallback,
  type TrpgImageSceneDiagnosticsPayload,
} from "@/lib/trpg/trpgImageSceneDiagnosticsLifecycle";

type TrpgImageSceneDiagnosticsPanelProps = {
  diagnostics: TrpgImageSceneDiagnosticsPayload;
};

export default function TrpgImageSceneDiagnosticsPanel({
  diagnostics,
}: TrpgImageSceneDiagnosticsPanelProps) {
  const rows = buildTrpgImageSceneDiagnosticsDisplayRows(diagnostics);
  const rawFallback = isTrpgAiFocusRawFallback(diagnostics);

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[10px] font-semibold text-zinc-200">처리 경로</p>
        {rawFallback ? (
          <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
            AI_FOCUS → RAW fallback
          </span>
        ) : diagnostics.modeApplied === "AI_FOCUS" ? (
          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
            AI_FOCUS applied
          </span>
        ) : (
          <span className="rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5 text-[10px] font-semibold text-zinc-300">
            CURRENT_RAW
          </span>
        )}
      </div>
      <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.key} className="min-w-0">
            <dt className="text-[10px] text-zinc-500">{row.label}</dt>
            <dd
              className={`text-[10px] text-zinc-200 break-words ${
                row.key === "selectedHeroScene" ? "whitespace-pre-wrap" : ""
              }`}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
