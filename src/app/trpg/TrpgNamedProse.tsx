"use client";

import NovelText from "@/components/NovelText";
import type { ChatDisplayPrefs } from "@/lib/chatDisplayPrefs";

export default function TrpgNamedProse({
  name,
  hint,
  text,
  variant,
  display,
}: {
  name: string;
  hint?: string;
  text: string;
  variant: "character" | "user";
  display: ChatDisplayPrefs;
}) {
  if (!text.trim()) return null;
  return (
    <div className="flex items-start gap-3">
      <div className="w-[4.75rem] shrink-0 pt-1 text-right">
        <p
          className={`text-xs font-semibold leading-snug ${
            variant === "user" ? "text-violet-200/90" : "text-orange-200/90"
          }`}
        >
          {name}
        </p>
        {hint ? <p className="mt-0.5 text-[10px] font-medium text-zinc-500">{hint}</p> : null}
      </div>
      <div
        className="min-w-0 flex-1 border-l border-white/10 pl-3 select-text [touch-action:pan-y] [-webkit-user-select:text]"
        data-quote-assistant
        style={{ userSelect: "text", WebkitUserSelect: "text", touchAction: "pan-y", WebkitTouchCallout: "default" }}
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
