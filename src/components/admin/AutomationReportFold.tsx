import type { ReactNode } from "react";

import { attentionTone } from "@/components/admin/AutomationAttentionSection";
import type { AttentionItem } from "@/lib/adminAutomationAttention";
import { formatKstDateTime } from "@/lib/adminAutomationStatus";

/**
 * Collapsible shell around an existing report card. A report that needs the
 * operator stays open; a healthy or reference-only one collapses to one line
 * that still shows its name, state and last run.
 */
export function AutomationReportFold({
  id,
  title,
  item,
  fallbackLabel,
  fallbackSummary,
  open,
  children,
}: {
  id: string;
  title: string;
  item: AttentionItem | null;
  fallbackLabel?: string;
  fallbackSummary?: string;
  open: boolean;
  children: ReactNode;
}) {
  const label = item?.statusLabel ?? fallbackLabel ?? "참고";
  const tone = item ? attentionTone(item.bucket, item.severity) : "bg-zinc-500/20 text-zinc-300";
  const summary = item?.reasons[0] ?? fallbackSummary ?? "";
  return (
    <details
      id={id}
      open={open}
      className="group mt-4 rounded-2xl border border-white/10 bg-[#11131a] open:pb-0"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 break-words font-bold text-zinc-100">{title}</span>
        <span className={"shrink-0 rounded px-2 py-0.5 text-[11px] font-bold " + tone}>{label}</span>
        {item?.lastRunAt ? (
          <span className="text-[11px] text-zinc-500">{formatKstDateTime(item.lastRunAt)}</span>
        ) : null}
        <span className="ml-auto text-[11px] text-zinc-600 group-open:hidden">펼치기 ▾</span>
        <span className="ml-auto hidden text-[11px] text-zinc-600 group-open:inline">접기 ▴</span>
        {summary ? (
          <span className="basis-full break-words text-xs leading-relaxed text-zinc-500">{summary}</span>
        ) : null}
      </summary>
      <div className="[&>section]:mt-0 [&>section]:rounded-t-none [&>section]:border-x-0 [&>section]:border-b-0">
        {children}
      </div>
    </details>
  );
}
