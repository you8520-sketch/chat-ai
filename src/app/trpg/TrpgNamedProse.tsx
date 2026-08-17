"use client";

import NovelText from "@/components/NovelText";
import TaggedNovelText from "@/components/TaggedNovelText";
import type { CharacterAsset } from "@/lib/characterAssets";
import type { ChatDisplayPrefs } from "@/lib/chatDisplayPrefs";
import { useRevealedText } from "./useRevealedText";

const quoteSelectStyle = {
  userSelect: "text" as const,
  WebkitUserSelect: "text" as const,
  touchAction: "pan-y" as const,
  WebkitTouchCallout: "default" as const,
};

export function TrpgGmTalk({
  text,
  assets = [],
  reveal = false,
}: {
  text: string;
  assets?: CharacterAsset[];
  reveal?: boolean;
}) {
  const shown = useRevealedText(text, reveal);
  const body = shown.trim();
  if (!body) return null;
  return (
    <div
      className="select-text [touch-action:pan-y] [-webkit-user-select:text]"
      data-quote-assistant
      style={quoteSelectStyle}
    >
      <div
        className="whitespace-pre-wrap leading-relaxed"
        style={{
          fontSize: "var(--font-size-chat)",
          lineHeight: "var(--line-height-chat)",
          letterSpacing: "0.01em",
        }}
      >
        <span className="not-italic font-bold text-sky-300">GM:</span>{" "}
        {assets.length > 0 ? (
          <TaggedNovelText
            content={body}
            assets={assets}
            variant="character"
            paragraphMode="author"
            streaming={reveal}
          />
        ) : (
          <span className="italic font-semibold text-sky-100/85">{body}</span>
        )}
      </div>
    </div>
  );
}

export default function TrpgNamedProse({
  name,
  hint,
  text,
  variant,
  display,
  accent,
  assets = [],
  reveal = false,
  paragraphMode = "author",
}: {
  name?: string | null;
  hint?: string;
  text: string;
  variant: "character" | "user";
  display: ChatDisplayPrefs;
  /** Left rail. Defaults to on when a speaker name is shown — never on plain narration. */
  accent?: boolean;
  assets?: CharacterAsset[];
  reveal?: boolean;
  /** Default author keeps GM/explicit-speaker paths unchanged. AI PC actions pass ai. */
  paragraphMode?: "ai" | "author";
}) {
  const shown = useRevealedText(text, reveal);
  if (!shown.trim()) return null;
  const labeled = Boolean(name?.trim());
  const showRail = accent ?? labeled;
  const rail = showRail
    ? variant === "user"
      ? "border-l-[3px] border-violet-400"
      : "border-l-[3px] border-orange-400"
    : "";
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
        {assets.length > 0 ? (
          <TaggedNovelText
            content={shown}
            assets={assets}
            display={display}
            variant={variant}
            paragraphMode={paragraphMode}
            streaming={reveal}
          />
        ) : (
          <NovelText
            content={shown}
            display={display}
            variant={variant}
            paragraphMode={paragraphMode}
            streaming={reveal}
          />
        )}
      </div>
    </div>
  );
}
