"use client";

import NovelText from "@/components/NovelText";
import type { ChatDisplayPrefs } from "@/lib/chatDisplayPrefs";

const quoteSelectStyle = {
  userSelect: "text" as const,
  WebkitUserSelect: "text" as const,
  touchAction: "pan-y" as const,
  WebkitTouchCallout: "default" as const,
};

export function TrpgGmTalk({ text }: { text: string }) {
  const body = text.trim();
  if (!body) return null;
  return (
    <div
      className="select-text [touch-action:pan-y] [-webkit-user-select:text]"
      data-quote-assistant
      style={quoteSelectStyle}
    >
      <p
        className="whitespace-pre-wrap leading-relaxed"
        style={{
          fontSize: "var(--font-size-chat)",
          lineHeight: "var(--line-height-chat)",
          letterSpacing: "0.01em",
        }}
      >
        <span className="not-italic font-bold text-sky-300">GM:</span>{" "}
        <span className="italic font-semibold text-sky-100/85">{body}</span>
      </p>
    </div>
  );
}

export default function TrpgNamedProse({
  name,
  hint,
  text,
  variant,
  display,
}: {
  name?: string | null;
  hint?: string;
  text: string;
  variant: "character" | "user";
  display: ChatDisplayPrefs;
}) {
  if (!text.trim()) return null;
  const labeled = Boolean(name?.trim());
  const rail = labeled
    ? variant === "user"
      ? "border-l-[3px] border-violet-400"
      : "border-l-[3px] border-orange-400"
    : "border-l-[3px] border-zinc-500/70";
  const nameColor = variant === "user" ? "text-violet-200" : "text-orange-200";

  return (
    <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-start">
      <div className="pr-3 pt-1 text-right">
        {labeled ? (
          <p className={`text-[13px] font-bold leading-snug tracking-tight ${nameColor}`}>{name}</p>
        ) : null}
        {hint ? <p className="mt-0.5 text-[10px] font-medium text-zinc-500">{hint}</p> : null}
      </div>
      <div
        className={`min-w-0 ${rail} pl-4 select-text [touch-action:pan-y] [-webkit-user-select:text]`}
        data-quote-assistant
        style={quoteSelectStyle}
      >
        <NovelText
          content={text}
          display={display}
          variant={variant}
          paragraphMode="author"
        />
      </div>
    </div>
  );
}
