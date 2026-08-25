import {
  chatAssets,
  findAssetsByTag,
  type CharacterAsset,
} from "@/lib/characterAssets";
import { GENDER_LABELS, resolveCharacterGender, type CharacterGender } from "@/lib/characterGender";
import { resolveEmotionTag } from "@/lib/emotionTag";

export const MAX_IMAGES_PER_GM_SCENE = 2;
export const MAX_SCENARIO_IMAGES_WITH_AI = 1;
export const MAX_SCENARIO_IMAGES_WITHOUT_AI = 2;
export const CHARACTER_TAG_PAIR_MAX = 1;

export const TRPG_CHARACTER_ASSET_MARKER_PREFIX = "[캐릭터에셋:";
export const TRPG_SCENARIO_ASSET_MARKER_PREFIX = "[태그:";

export type TrpgAiPartyIdentity = {
  participantId: number;
  name: string;
  gender: CharacterGender | string | null | undefined;
};

export type TrpgAiCharacterTagCatalogRow = {
  participantId: number;
  name: string;
  tags: readonly string[];
};

export type GmSceneAssetKeep =
  | { kind: "character"; participantId: number; tag: string }
  | { kind: "scenario"; tag: string };

const COMBINED_MARKER_RE = /\[캐릭터에셋:\s*([^\]]*)\]|\[태그:\s*([^\]]*)\]/g;
const CHARACTER_PAYLOAD_RE = /^(\d+)\s*\|\s*(.+)$/;

export function eligibleTrpgCharacterAssets(assets: CharacterAsset[]): CharacterAsset[] {
  return chatAssets(assets).filter((asset) => asset.moderationReject !== true && asset.tag.trim());
}

export function uniqueCharacterAssetTags(assets: CharacterAsset[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const asset of eligibleTrpgCharacterAssets(assets)) {
    const tag = asset.tag.trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

export function formatTrpgCharacterIdentityBlock(
  name: string,
  gender: CharacterGender | string | null | undefined
): string {
  const resolved = resolveCharacterGender(gender);
  return `[CHARACTER IDENTITY]\nName: ${name.trim()}\nGender: ${GENDER_LABELS[resolved]}`;
}

export function formatTrpgGenderLabel(gender: CharacterGender | string | null | undefined): string {
  return GENDER_LABELS[resolveCharacterGender(gender)];
}

export function buildAiPartyIdentityBlock(rows: readonly TrpgAiPartyIdentity[]): string {
  if (rows.length === 0) return "";
  const lines = rows.map(
    (row) => `participantId=${row.participantId} | ${row.name.trim()} | ${formatTrpgGenderLabel(row.gender)}`
  );
  return `[AI PARTY IDENTITIES]\n${lines.join("\n")}`;
}

export function buildAiCharacterImageTagCatalog(
  rows: readonly TrpgAiCharacterTagCatalogRow[]
): string {
  const usable = rows.filter((row) => row.tags.some((tag) => tag.trim()));
  if (usable.length === 0) return "";
  const blocks = usable.map((row) => {
    const tags = [...new Set(row.tags.map((tag) => tag.trim()).filter(Boolean))];
    return `participantId=${row.participantId}\nname=${row.name.trim()}\ntags=${tags.join(" | ")}`;
  });
  return [
    "[AI CHARACTER IMAGE TAGS]",
    "Place a character image only when this narration has a meaningful expression change, emotional shift, reaction, or state change and an exact stored tag exists.",
    "Do not insert an image merely because the tag exists.",
    `Marker: ${TRPG_CHARACTER_ASSET_MARKER_PREFIX} participantId|exactTag]`,
    "Example: [캐릭터에셋: 12|분노]",
    "Each exact CHARACTER + TAG pair at most once. Character markers are a separate namespace from scenario [태그: ...] markers.",
    `Total images this scene ≤ ${MAX_IMAGES_PER_GM_SCENE}. Prefer different characters when relevance is otherwise equal.`,
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

export function parseCharacterAssetMarkerPayload(
  raw: string
): { participantId: number; tag: string } | null {
  const match = raw.trim().match(CHARACTER_PAYLOAD_RE);
  if (!match) return null;
  const participantId = Number(match[1]);
  const tag = match[2]?.trim() ?? "";
  if (!Number.isInteger(participantId) || participantId <= 0 || !tag) return null;
  return { participantId, tag };
}

export function formatCharacterAssetMarker(participantId: number, tag: string): string {
  return `[캐릭터에셋: ${participantId}|${tag.trim()}]`;
}

export function formatScenarioAssetMarker(tag: string): string {
  return `[태그: ${tag.trim()}]`;
}

export function stablePickIndex(seed: string, count: number): number {
  if (count <= 1) return 0;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % count;
}

export function selectStableTaggedAsset(
  assets: CharacterAsset[],
  tag: string,
  seed: string
): CharacterAsset | null {
  const matches = findAssetsByTag(eligibleTrpgCharacterAssets(assets), tag);
  if (matches.length === 0) return null;
  return matches[stablePickIndex(seed, matches.length)] ?? null;
}

export function enforceGmSceneAssetMarkers(
  narration: string,
  opts: {
    aiParticipantIds: ReadonlySet<number>;
    characterTagsByParticipant: ReadonlyMap<number, ReadonlySet<string>>;
    scenarioTags: ReadonlySet<string>;
  }
): { text: string; kept: GmSceneAssetKeep[] } {
  const hasAi = opts.aiParticipantIds.size > 0;
  const maxScenario = hasAi ? MAX_SCENARIO_IMAGES_WITH_AI : MAX_SCENARIO_IMAGES_WITHOUT_AI;
  const allowedScenario = [...opts.scenarioTags];
  const kept: GmSceneAssetKeep[] = [];
  const seenCharacterPairs = new Set<string>();
  const seenScenario = new Set<string>();
  let total = 0;
  let scenarioCount = 0;

  const rewritten = narration.replace(COMBINED_MARKER_RE, (full, characterPayload?: string, scenarioPayload?: string) => {
    if (typeof characterPayload === "string") {
      const parsed = parseCharacterAssetMarkerPayload(characterPayload);
      if (!parsed) return "";
      if (!opts.aiParticipantIds.has(parsed.participantId)) return "";
      const owned = opts.characterTagsByParticipant.get(parsed.participantId);
      if (!owned?.has(parsed.tag)) return "";
      const pairKey = `${parsed.participantId}\0${parsed.tag}`;
      if (seenCharacterPairs.has(pairKey) || kept.filter((item) => item.kind === "character" && item.participantId === parsed.participantId && item.tag === parsed.tag).length >= CHARACTER_TAG_PAIR_MAX) {
        return "";
      }
      if (total >= MAX_IMAGES_PER_GM_SCENE) return "";
      seenCharacterPairs.add(pairKey);
      total += 1;
      kept.push({ kind: "character", participantId: parsed.participantId, tag: parsed.tag });
      return formatCharacterAssetMarker(parsed.participantId, parsed.tag);
    }

    const rawTag = String(scenarioPayload ?? "").trim();
    const resolved = resolveEmotionTag(rawTag, allowedScenario);
    if (!resolved) return "";
    if (seenScenario.has(resolved)) return "";
    if (scenarioCount >= maxScenario || total >= MAX_IMAGES_PER_GM_SCENE) return "";
    seenScenario.add(resolved);
    scenarioCount += 1;
    total += 1;
    kept.push({ kind: "scenario", tag: resolved });
    return formatScenarioAssetMarker(resolved);
  });

  const stripped = rewritten
    .replace(/\[캐릭터에셋:[^\]]*$/g, "")
    .replace(/\[태그:[^\]]*$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();

  return { text: stripped, kept };
}

export function gmSceneAssetSeed(opts: {
  campaignId: number;
  roundNumber: number;
  participantId?: number;
  tag: string;
  kind: "character" | "scenario";
}): string {
  switch (opts.kind) {
    case "character":
      return `${opts.campaignId}:${opts.roundNumber}:${opts.participantId ?? 0}:${opts.tag}`;
    case "scenario":
      return `${opts.campaignId}:${opts.roundNumber}:scenario:${opts.tag}`;
    default: {
      const exhaustive: never = opts.kind;
      return exhaustive;
    }
  }
}
