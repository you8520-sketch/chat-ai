"use client";

import InlineTaggedAssetImage from "@/components/InlineTaggedAssetImage";
import NovelText from "@/components/NovelText";
import TrpgCharacterSceneAsset from "@/components/TrpgCharacterSceneAsset";
import type { ChatDisplayPrefs } from "@/lib/chatDisplayPrefs";
import type { CharacterAsset } from "@/lib/characterAssets";
import type { TrpgPublicAiCharacterAssets } from "@/lib/trpg/aiCharacterContext";
import { splitTrpgGmProseForAssets } from "@/lib/trpg/trpgTaggedProse";
import type { TrpgProseVariant } from "@/lib/trpg/gmTableTalkTypography";

export default function TrpgTaggedNovelText({
  content,
  scenarioAssets,
  characterCatalog = [],
  campaignId,
  roundNumber,
  display,
  variant = "character",
  paragraphMode = "ai",
  paragraphSpacingMode = "default",
  proseVariant = "default",
  inlineLead = false,
  streaming = false,
  viewerIsCreator = false,
  unlockedUrls,
  dialogueAccent = true,
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
  paragraphSpacingMode?: "default" | "gm";
  proseVariant?: TrpgProseVariant;
  inlineLead?: boolean;
  streaming?: boolean;
  viewerIsCreator?: boolean;
  unlockedUrls?: ReadonlySet<string>;
  dialogueAccent?: boolean;
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
  return (
    <div className={`w-full min-w-0 max-w-full${proseVariant === "gm-table-talk" ? " inline" : ""}`}>
      {parts.map((part, i) => {
        switch (part.kind) {
          case "text":
            return (
              <NovelText
                key={`prose-${i}`}
                content={part.text}
                display={display}
                variant={variant}
                paragraphMode={paragraphMode}
                paragraphSpacingMode={paragraphSpacingMode}
                proseVariant={proseVariant}
                inlineLead={inlineLead && i === firstTextIndex}
                streaming={streaming && i === parts.length - 1}
                dialogueAccent={dialogueAccent}
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
      })}
    </div>
  );
}
