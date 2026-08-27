"use client";

import InlineTaggedAssetImage from "@/components/InlineTaggedAssetImage";
import NovelText from "@/components/NovelText";
import TrpgCharacterSceneAsset from "@/components/TrpgCharacterSceneAsset";
import type { ChatDisplayPrefs } from "@/lib/chatDisplayPrefs";
import type { CharacterAsset } from "@/lib/characterAssets";
import type { TrpgPublicAiCharacterAssets } from "@/lib/trpg/aiCharacterContext";
import { splitTrpgGmProseForAssets } from "@/lib/trpg/trpgTaggedProse";

export function resolveTrpgTaggedNovelInlineFlow(opts: {
  inlineFirstParagraph: boolean;
  firstPartKind: "text" | "scenario" | "character" | null;
}): "fragment" | "block-wrapper" {
  if (opts.inlineFirstParagraph && opts.firstPartKind === "text") return "fragment";
  return "block-wrapper";
}

export default function TrpgTaggedNovelText({
  content,
  scenarioAssets,
  characterCatalog = [],
  campaignId,
  roundNumber,
  display,
  variant = "character",
  paragraphMode = "ai",
  streaming = false,
  viewerIsCreator = false,
  unlockedUrls,
  dialogueAccent = true,
  inlineFirstParagraph = false,
  proseClassName,
}: {
  content: string;
  scenarioAssets: CharacterAsset[];
  characterCatalog?: readonly TrpgPublicAiCharacterAssets[];
  campaignId: number;
  roundNumber: number;
  display?: Pick<
    ChatDisplayPrefs,
    "narrationColor" | "dialogueColor" | "userNarrationColor" | "userDialogueColor"
  >;
  variant?: "character" | "user";
  paragraphMode?: "ai" | "author";
  streaming?: boolean;
  viewerIsCreator?: boolean;
  unlockedUrls?: ReadonlySet<string>;
  dialogueAccent?: boolean;
  inlineFirstParagraph?: boolean;
  proseClassName?: string;
}) {
  const parts = splitTrpgGmProseForAssets(content, {
    scenarioAssets,
    characterCatalog,
    campaignId,
    roundNumber,
    streaming,
  });
  if (parts.length === 0) return null;

  const firstTextIndex = parts.findIndex((part) => part.kind === "text");
  const inlineFlow = resolveTrpgTaggedNovelInlineFlow({
    inlineFirstParagraph,
    firstPartKind: firstTextIndex >= 0 ? parts[firstTextIndex]!.kind : null,
  });
  const renderedParts = parts.map((part, i) => {
    switch (part.kind) {
      case "text":
        return (
          <NovelText
            key={`prose-${i}`}
            content={part.text}
            display={display}
            variant={variant}
            paragraphMode={paragraphMode}
            streaming={streaming && i === parts.length - 1}
            dialogueAccent={dialogueAccent}
            inlineFirstParagraph={inlineFirstParagraph && i === firstTextIndex}
            proseClassName={proseClassName}
          />
        );
      case "scenario":
        return (
          <InlineTaggedAssetImage
            key={`scenario-${part.asset.url}-${i}`}
            asset={part.asset}
            viewerIsCreator={viewerIsCreator}
            unlockedUrls={unlockedUrls}
          />
        );
      case "character":
        return (
          <TrpgCharacterSceneAsset
            key={`character-${part.participantId}-${part.asset.url}-${i}`}
            asset={part.asset}
            viewerIsCreator={viewerIsCreator}
            unlockedUrls={unlockedUrls}
          />
        );
      default: {
        const exhaustive: never = part;
        return exhaustive;
      }
    }
  });

  if (inlineFlow === "fragment") {
    return <>{renderedParts}</>;
  }

  return <div className="w-full min-w-0 max-w-full">{renderedParts}</div>;
}
