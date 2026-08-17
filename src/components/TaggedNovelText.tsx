"use client";

import InlineTaggedAssetImage from "@/components/InlineTaggedAssetImage";
import NovelText from "@/components/NovelText";
import type { ChatDisplayPrefs } from "@/lib/chatDisplayPrefs";
import type { CharacterAsset } from "@/lib/characterAssets";
import { splitProseForInlineAssets } from "@/lib/inlineTaggedAssets";

export default function TaggedNovelText({
  content,
  assets,
  display,
  variant = "character",
  paragraphMode = "ai",
  streaming = false,
  viewerIsCreator = false,
  unlockedUrls,
  dialogueAccent = true,
}: {
  content: string;
  assets: CharacterAsset[];
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
}) {
  const parts = splitProseForInlineAssets(content, assets, { streaming, oncePerAsset: true });
  if (parts.length === 0) return null;
  return (
    <div className="w-full min-w-0 max-w-full">
      {parts.map((part, i) => {
        if (part.kind === "text") {
          return (
            <NovelText
              key={`prose-${i}`}
              content={part.text}
              display={display}
              variant={variant}
              paragraphMode={paragraphMode}
              streaming={streaming && i === parts.length - 1}
              dialogueAccent={dialogueAccent}
            />
          );
        }
        return (
          <InlineTaggedAssetImage
            key={`asset-${part.asset.url}-${i}`}
            asset={part.asset}
            viewerIsCreator={viewerIsCreator}
            unlockedUrls={unlockedUrls}
          />
        );
      })}
    </div>
  );
}
