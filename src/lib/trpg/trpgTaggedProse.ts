import { isWideInlineAsset, type CharacterAsset } from "@/lib/characterAssets";
import { stripTrailingEmotionTagStreamCandidate } from "@/lib/emotionTag";
import {
  createTrpgCombinedAssetMarkerRegExp,
  gmSceneAssetSeed,
  parseCharacterAssetMarkerPayload,
  selectStableTaggedAsset,
  selectStableViewerVisibleTaggedAsset,
  stripMalformedTrpgAssetControlMarkers,
  stripTrpgAssetControlMarkers,
  TRPG_CHARACTER_ASSET_MARKER_PREFIX,
} from "./gmSceneAssets";
import type { TrpgPublicAiCharacterAssets } from "./aiCharacterContext";

export type TrpgInlineProsePart =
  | { kind: "text"; text: string }
  | { kind: "scenario"; tag: string; asset: CharacterAsset }
  | { kind: "character"; participantId: number; tag: string; asset: CharacterAsset };

const TRPG_STREAMING_CHARACTER_MARKER_RE = /^\[캐릭터에셋:[ \t]*[^\]\r\n]*\]$/;

function stripTrailingCharacterAssetCandidate(text: string): string {
  const trimmed = text.trimEnd();
  const openBracket = trimmed.lastIndexOf("[");
  if (openBracket < 0) return text;
  const suffix = trimmed.slice(openBracket);
  const compact = suffix.replace(/[ \t]+/g, "");
  const isMarkerPrefix =
    compact.length > 0 && TRPG_CHARACTER_ASSET_MARKER_PREFIX.startsWith(compact);
  const isPartialOrCompleteMarker =
    compact.startsWith(TRPG_CHARACTER_ASSET_MARKER_PREFIX) &&
    (compact.indexOf("]") < 0 || TRPG_STREAMING_CHARACTER_MARKER_RE.test(compact));
  if (!isMarkerPrefix && !isPartialOrCompleteMarker) return text;
  if (/^\[캐릭터에셋:[ \t]*[^\]\r\n]+\]$/.test(compact)) return text;
  return trimmed.slice(0, openBracket).trimEnd();
}

export function stripTrailingTrpgAssetMarkers(text: string): string {
  return stripTrailingCharacterAssetCandidate(stripTrailingEmotionTagStreamCandidate(text));
}

export function splitTrpgGmProseForAssets(
  text: string,
  opts: {
    scenarioAssets: CharacterAsset[];
    characterCatalog?: readonly TrpgPublicAiCharacterAssets[];
    campaignId: number;
    roundNumber: number;
    streaming?: boolean;
    unlockedUrlsByCharacterId?: ReadonlyMap<number, ReadonlySet<string>>;
  }
): TrpgInlineProsePart[] {
  const source = stripMalformedTrpgAssetControlMarkers(
    opts.streaming ? stripTrailingTrpgAssetMarkers(text) : text
  );
  const parts: TrpgInlineProsePart[] = [];
  const re = createTrpgCombinedAssetMarkerRegExp();
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    if (match.index > last) {
      parts.push({ kind: "text", text: source.slice(last, match.index) });
    }
    if (typeof match[1] === "string") {
      const parsed = parseCharacterAssetMarkerPayload(match[1]);
      const entry = parsed
        ? opts.characterCatalog?.find((row) => row.participantId === parsed.participantId)
        : undefined;
      const asset =
        parsed && entry
          ? selectStableViewerVisibleTaggedAsset(
              entry.assets,
              parsed.tag,
              gmSceneAssetSeed({
                campaignId: opts.campaignId,
                roundNumber: opts.roundNumber,
                participantId: parsed.participantId,
                tag: parsed.tag,
                kind: "character",
              }),
              {
                viewerIsCreator: entry.viewerIsCreator,
                unlockedUrls: opts.unlockedUrlsByCharacterId?.get(entry.characterId),
              }
            )
          : null;
      if (parsed && asset) {
        parts.push({ kind: "character", participantId: parsed.participantId, tag: parsed.tag, asset });
      }
    } else {
      const tag = String(match[2] ?? "").trim();
      const asset = tag
        ? selectStableTaggedAsset(
            opts.scenarioAssets.filter((item) => isWideInlineAsset(item)),
            tag,
            gmSceneAssetSeed({
              campaignId: opts.campaignId,
              roundNumber: opts.roundNumber,
              tag,
              kind: "scenario",
            })
          )
        : null;
      if (asset && isWideInlineAsset(asset)) {
        parts.push({ kind: "scenario", tag, asset });
      }
    }
    last = match.index + match[0].length;
  }
  if (last < source.length) {
    parts.push({ kind: "text", text: source.slice(last) });
  }
  return parts.filter((part) => part.kind !== "text" || part.text.length > 0);
}

export function visibleTrpgGmProse(text: string): string {
  return stripTrpgAssetControlMarkers(text);
}
