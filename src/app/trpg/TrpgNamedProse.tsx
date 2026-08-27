"use client";

import { useLayoutEffect } from "react";
import NovelText from "@/components/NovelText";
import type { CharacterAsset } from "@/lib/characterAssets";
import type { ChatDisplayPrefs } from "@/lib/chatDisplayPrefs";
import type { TrpgPublicAiCharacterAssets } from "@/lib/trpg/aiCharacterContext";
import { resolveTrpgSpeakerRail } from "@/lib/trpg/actionCardUi";
import { sanitizeTrpgActionDisplayText } from "@/lib/trpg/gmSceneAssets";
import { novelParagraphSpacingClass } from "@/lib/novelParagraphs";
import TrpgTaggedNovelText from "./TrpgTaggedNovelText";
import { useRevealedText } from "./useRevealedText";
import { splitTrpgGmProseForAssets } from "@/lib/trpg/trpgTaggedProse";

const quoteSelectStyle = {
  userSelect: "text" as const,
  WebkitUserSelect: "text" as const,
  touchAction: "pan-y" as const,
  WebkitTouchCallout: "default" as const,
};

export { quoteSelectStyle };

const TRPG_GM_TALK_LABEL_CLASS = "not-italic font-bold text-sky-300";
const TRPG_GM_TALK_BODY_CLASS = "italic font-semibold text-sky-100/85";

function TrpgGmProseBody({
  body,
  assets = [],
  characterCatalog = [],
  campaignId = 0,
  roundNumber = 0,
  contentStreaming = false,
  inlineFirstParagraph = true,
}: {
  body: string;
  assets?: CharacterAsset[];
  characterCatalog?: readonly TrpgPublicAiCharacterAssets[];
  campaignId?: number;
  roundNumber?: number;
  contentStreaming?: boolean;
  inlineFirstParagraph?: boolean;
}) {
  const proseBlocks = body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const renderBlock = (block: string, blockIndex: number, blockCount: number) => {
    const hasSceneAssets =
      assets.length > 0 ||
      characterCatalog.length > 0 ||
      /\[(?:캐릭터에셋|태그):/.test(block);

    const blockInlineFirst = inlineFirstParagraph && blockIndex === 0;
    const blockStreaming = contentStreaming && blockIndex === blockCount - 1;

    if (hasSceneAssets) {
      const parts = splitTrpgGmProseForAssets(block, {
        scenarioAssets: assets,
        characterCatalog,
        campaignId,
        roundNumber,
        streaming: blockStreaming,
      });
      const firstTextIndex = parts.findIndex((part) => part.kind === "text");
      return (
        <TrpgTaggedNovelText
          content={block}
          scenarioAssets={assets}
          characterCatalog={characterCatalog}
          campaignId={campaignId}
          roundNumber={roundNumber}
          variant="character"
          paragraphMode="ai"
          streaming={blockStreaming}
          dialogueAccent={false}
          inlineFirstParagraph={blockInlineFirst && firstTextIndex === 0}
          proseClassName={TRPG_GM_TALK_BODY_CLASS}
        />
      );
    }

    return (
      <NovelText
        content={block}
        variant="character"
        paragraphMode="ai"
        streaming={blockStreaming}
        dialogueAccent={false}
        inlineFirstParagraph={blockInlineFirst}
        proseClassName={TRPG_GM_TALK_BODY_CLASS}
      />
    );
  };

  if (proseBlocks.length <= 1) {
    return renderBlock(body.trim(), 0, 1);
  }

  return (
    <>
      {proseBlocks.map((block, i) => (
        <div
          key={`gm-prose-${i}`}
          className={
            i > 0
              ? novelParagraphSpacingClass("narration", "narration", "ai")
              : undefined
          }
        >
          {renderBlock(block, i, proseBlocks.length)}
        </div>
      ))}
    </>
  );
}

export function TrpgGmTalk({
  text,
  assets = [],
  characterCatalog = [],
  campaignId = 0,
  roundNumber = 0,
  reveal = false,
  contentStreaming = false,
  onRevealChange,
  quoteAssistantRoot = true,
}: {
  text: string;
  assets?: CharacterAsset[];
  characterCatalog?: readonly TrpgPublicAiCharacterAssets[];
  campaignId?: number;
  roundNumber?: number;
  reveal?: boolean;
  /** Live GM narration growth hint — does not own reveal; stabilizes paragraph boundaries only. */
  contentStreaming?: boolean;
  onRevealChange?: (report: { complete: boolean; progressive: boolean }) => void;
  /** When false, ancestor owns [data-quote-assistant] (TRPG scene turns). */
  quoteAssistantRoot?: boolean;
}) {
  const { shownText: shown, complete } = useRevealedText(text, reveal);
  const body = shown.trim();
  useLayoutEffect(() => {
    if (!onRevealChange) return;
    const fullLen = Array.from(text).length;
    const shownLen = Array.from(shown).length;
    onRevealChange({
      complete: fullLen === 0 || shownLen >= fullLen,
      progressive: shownLen > 0 && shownLen < fullLen,
    });
  }, [complete, onRevealChange, shown, text]);
  if (!body) return null;
  return (
    <div
      className="select-text [touch-action:pan-y] [-webkit-user-select:text]"
      {...(quoteAssistantRoot ? { "data-quote-assistant": true } : {})}
      style={quoteSelectStyle}
    >
      <div
        className="leading-relaxed"
        style={{
          fontSize: "var(--font-size-chat)",
          lineHeight: "var(--line-height-chat)",
          letterSpacing: "0.01em",
        }}
      >
        <span className={TRPG_GM_TALK_LABEL_CLASS}>GM:</span>{" "}
        <TrpgGmProseBody
          body={body}
          assets={assets}
          characterCatalog={characterCatalog}
          campaignId={campaignId}
          roundNumber={roundNumber}
          contentStreaming={contentStreaming}
        />
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
  characterCatalog = [],
  campaignId = 0,
  roundNumber = 0,
  reveal = false,
  revealHeld = false,
  streamIntervalMs,
  paragraphMode = "author",
  dialogueAccent = true,
  hideMobileLabel = false,
  resolveSceneAssets = true,
  onRevealChange,
  quoteAssistantRoot = true,
  contentStreaming,
}: {
  name?: string | null;
  hint?: string;
  text: string;
  variant: "character" | "user";
  display: ChatDisplayPrefs;
  /** Left rail. Defaults to on when a speaker name is shown — never on plain narration. */
  accent?: boolean;
  assets?: CharacterAsset[];
  characterCatalog?: readonly TrpgPublicAiCharacterAssets[];
  campaignId?: number;
  roundNumber?: number;
  reveal?: boolean;
  revealHeld?: boolean;
  streamIntervalMs?: number;
  /** Default author keeps GM/explicit-speaker paths unchanged. AI PC actions pass ai. */
  paragraphMode?: "ai" | "author";
  /** Global chat keeps dialogue rails. TRPG action cards pass false. */
  dialogueAccent?: boolean;
  /** A mobile roll header can own the speaker label so prose starts at full width below it. */
  hideMobileLabel?: boolean;
  /** GM narration may resolve scene images. Action cards must stay prose-only. */
  resolveSceneAssets?: boolean;
  onRevealChange?: (report: { complete: boolean; progressive: boolean }) => void;
  /** When false, ancestor owns [data-quote-assistant] (TRPG scene turns). */
  quoteAssistantRoot?: boolean;
  /** Live GM narration growth hint — stabilizes paragraph boundaries only; does not own reveal. */
  contentStreaming?: boolean;
}) {
  const { shownText: shown, complete } = useRevealedText(
    text,
    reveal,
    "bot",
    streamIntervalMs,
    revealHeld
  );
  useLayoutEffect(() => {
    if (!onRevealChange) return;
    const fullLen = Array.from(text).length;
    const shownLen = Array.from(shown).length;
    onRevealChange({
      complete: fullLen === 0 || shownLen >= fullLen,
      progressive: shownLen > 0 && shownLen < fullLen,
    });
  }, [complete, onRevealChange, shown, text]);
  if (!shown.trim()) return null;
  const proseStreaming = contentStreaming ?? reveal;
  const labeled = Boolean(name?.trim());
  const showRail = resolveTrpgSpeakerRail(accent, labeled);
  const rail = showRail
    ? variant === "user"
      ? "border-l-[3px] border-violet-400"
      : "border-l-[3px] border-orange-400"
    : "";
  const nameColor = variant === "user" ? "text-violet-200" : "text-orange-200";
  const hasLabel = labeled || Boolean(hint);

  return (
    <div className="grid grid-cols-1 items-start gap-y-1.5 sm:grid-cols-[5.75rem_minmax(0,1fr)] sm:gap-y-0">
      <div
        className={`${hasLabel ? "flex" : "hidden sm:block"} ${hideMobileLabel ? "max-sm:hidden" : ""} min-w-0 items-baseline gap-2 px-0.5 text-left sm:block sm:pr-3 sm:pt-1 sm:text-right`}
      >
        {labeled ? (
          <p className={`min-w-0 truncate text-[13px] font-bold leading-snug tracking-tight ${nameColor}`}>
            {name}
          </p>
        ) : null}
        {hint ? (
          <p className="shrink-0 text-[10px] font-medium text-zinc-500 sm:mt-0.5">{hint}</p>
        ) : null}
      </div>
      <div
        className={`min-w-0 ${rail} ${showRail ? "pl-3 sm:pl-4" : "sm:pl-4"} select-text [touch-action:pan-y] [-webkit-user-select:text]`}
        {...(quoteAssistantRoot ? { "data-quote-assistant": true } : {})}
        style={quoteSelectStyle}
      >
        {resolveSceneAssets &&
        (assets.length > 0 || characterCatalog.length > 0 || /\[(?:캐릭터에셋|태그):/.test(shown)) ? (
          <TrpgTaggedNovelText
            content={shown}
            scenarioAssets={assets}
            characterCatalog={characterCatalog}
            campaignId={campaignId}
            roundNumber={roundNumber}
            display={display}
            variant={variant}
            paragraphMode={paragraphMode}
            streaming={proseStreaming}
            dialogueAccent={dialogueAccent}
          />
        ) : (
          <NovelText
            content={resolveSceneAssets ? shown : sanitizeTrpgActionDisplayText(shown)}
            display={display}
            variant={variant}
            paragraphMode={paragraphMode}
            streaming={proseStreaming}
            dialogueAccent={dialogueAccent}
          />
        )}
      </div>
    </div>
  );
}
