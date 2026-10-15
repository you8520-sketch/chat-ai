import type { ReactNode } from "react";
import { cn } from "@/lib/studioDesign";

export type StatusNoticeTone = "success" | "info" | "error";

const TONE_CLASS: Record<StatusNoticeTone, string> = {
  success: "border-emerald-400/25 bg-emerald-500/10 text-emerald-200",
  info: "border-white/10 bg-white/[0.04] text-zinc-200",
  error: "border-rose-400/30 bg-rose-500/10 text-rose-200",
};

type Props = {
  tone: StatusNoticeTone;
  children: ReactNode;
  className?: string;
  testId?: string;
};

export default function StatusNotice({ tone, children, className, testId }: Props) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      data-testid={testId}
      data-tone={tone}
      className={cn("break-words rounded-xl border px-3 py-2.5 text-sm font-medium leading-relaxed", TONE_CLASS[tone], className)}
    >
      {children}
    </p>
  );
}
