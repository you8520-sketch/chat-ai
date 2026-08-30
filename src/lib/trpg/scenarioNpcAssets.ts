import type { CharacterAsset } from "@/lib/characterAssets";
import {
  formatNpcAssetMarker,
  isTrpgCharacterAssetVisibleToViewer,
  TRPG_CLOSED_NPC_MARKER_RE,
  parseNpcAssetMarkerPayload,
} from "./gmSceneAssets";
import { isTrpgSpeakerPrefix } from "./sceneSpeech";
import {
  createScenarioNpcKey,
  ensureScenarioNpcKeys,
  type TrpgScenarioNpc,
  type TrpgScenarioNpcRole,
} from "./scenarioTypes";

export type TrpgPublicScenarioNpcImage = {
  npcKey: string;
  name: string;
  role: TrpgScenarioNpcRole;
  image: CharacterAsset;
};

export function eligibleScenarioNpcImage(npc: TrpgScenarioNpc): CharacterAsset | null {
  const asset = npc.image;
  if (!asset?.url?.trim() || asset.moderationReject === true) return null;
  return asset;
}

export function npcsWithImages(npcs: readonly TrpgScenarioNpc[]): TrpgScenarioNpc[] {
  return ensureScenarioNpcKeys([...npcs]).filter((npc) => eligibleScenarioNpcImage(npc));
}

export function toPublicScenarioNpcImages(npcs: readonly TrpgScenarioNpc[]): TrpgPublicScenarioNpcImage[] {
  return npcsWithImages(npcs).map((npc) => {
    const image = eligibleScenarioNpcImage(npc)!;
    return {
      npcKey: npc.npcKey,
      name: npc.name.trim(),
      role: npc.role === "boss" ? "boss" : "supporting",
      image: {
        url: image.url,
        tag: image.tag.trim() || npc.name.trim(),
        ...(image.width ? { width: image.width } : {}),
        ...(image.height ? { height: image.height } : {}),
        ...(image.orientation ? { orientation: image.orientation } : {}),
        ...(image.viewerBlur === true ? { viewerBlur: true } : {}),
      },
    };
  });
}

export function buildScenarioNpcImageTagPrompt(npcs: readonly TrpgScenarioNpc[]): string {
  const rows = npcsWithImages(npcs);
  if (rows.length === 0) return "";
  const blocks = rows.map((npc) => {
    const image = eligibleScenarioNpcImage(npc)!;
    return [
      `npcKey=${npc.npcKey}`,
      `name=${npc.name.trim()}`,
      `role=${npc.role}`,
      `imageAvailable=true`,
      `orientation=${image.orientation ?? "unknown"}`,
    ].join("\n");
  });
  return [
    "[SCENARIO NPC IMAGES]",
    "Use only when this NPC is physically present in the scene (enters, is seen, or speaks directly).",
    "Do not insert for name-only mentions, off-screen references, or past recollection.",
    "Marker: [NPC에셋: npcKey]",
    "Example: [NPC에셋: npc_01234567-89ab-cdef-0123-456789abcdef]",
    "Each npcKey at most once per campaign first meaningful appearance. Separate from [태그: ...] and [캐릭터에셋: ...].",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

export function buildGmSceneAssetPrompt(opts: {
  scenarioAssetPrompt: string;
  npcs: readonly TrpgScenarioNpc[];
}): string {
  return [opts.scenarioAssetPrompt.trim(), buildScenarioNpcImageTagPrompt(opts.npcs)].filter(Boolean).join("\n\n");
}

export function collectUsedNpcKeys(texts: readonly string[]): Set<string> {
  const used = new Set<string>();
  const re = new RegExp(TRPG_CLOSED_NPC_MARKER_RE.source, "g");
  for (const text of texts) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const inner = match[0].slice("[NPC에셋:".length, -1);
      const payload = parseNpcAssetMarkerPayload(inner);
      if (payload) used.add(payload);
    }
  }
  return used;
}

export function resolveNpcImageCatalogEntry(
  npcKey: string,
  catalog: readonly TrpgPublicScenarioNpcImage[]
): TrpgPublicScenarioNpcImage | null {
  const key = npcKey.trim();
  if (!key) return null;
  return catalog.find((row) => row.npcKey === key) ?? null;
}

export function resolveNpcImageAsset(
  npcKey: string,
  catalog: readonly TrpgPublicScenarioNpcImage[],
  opts: {
    viewerIsCreator: boolean;
    unlockedUrls?: ReadonlySet<string>;
  }
): CharacterAsset | null {
  const row = resolveNpcImageCatalogEntry(npcKey, catalog);
  if (!row) return null;
  if (!isTrpgCharacterAssetVisibleToViewer(row.image, opts)) return null;
  return row.image;
}

export function applyNpcSpeakerImageFallback(
  narration: string,
  opts: {
    npcs: readonly TrpgScenarioNpc[];
    usedNpcKeys: ReadonlySet<string>;
  }
): string {
  const catalog = npcsWithImages(opts.npcs);
  if (catalog.length === 0) return narration;
  const byName = new Map<string, TrpgScenarioNpc>();
  for (const npc of catalog) {
    const name = npc.name.trim();
    if (!name || byName.has(name)) continue;
    byName.set(name, npc);
  }
  const knownNames = [...byName.keys()];
  const lines = narration.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let changed = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const colonIdx = trimmed.search(/[:：]/);
    if (colonIdx > 0) {
      const speaker = trimmed.slice(0, colonIdx).trim();
      const rest = trimmed.slice(colonIdx + 1).trim();
      const npc = byName.get(speaker);
      if (
        npc &&
        !opts.usedNpcKeys.has(npc.npcKey) &&
        isTrpgSpeakerPrefix(speaker, rest, knownNames) &&
        !narration.includes(formatNpcAssetMarker(npc.npcKey))
      ) {
        out.push(formatNpcAssetMarker(npc.npcKey));
        changed = true;
      }
    }
    out.push(line);
  }
  return changed ? out.join("\n") : narration;
}

export function scenarioHasBossNpc(npcs: readonly TrpgScenarioNpc[]): boolean {
  return npcs.some((npc) => npc.role === "boss" && npc.name.trim());
}

export function normalizeDraftBossIntoNpcs(planBoss: string, npcs: TrpgScenarioNpc[]): TrpgScenarioNpc[] {
  const normalized = ensureScenarioNpcKeys(npcs);
  if (scenarioHasBossNpc(normalized)) return normalized;
  const bossText = planBoss.trim();
  if (!bossText) return normalized;
  const firstLine = bossText.split("\n")[0]?.trim() ?? bossText;
  const name = firstLine.slice(0, 40).trim() || "보스";
  const description =
    bossText.length > name.length ? bossText.slice(0, 2000) : firstLine.length < bossText.length ? bossText.slice(0, 2000) : "";
  return [
    ...normalized,
    {
      npcKey: createScenarioNpcKey(),
      role: "boss" as const,
      name,
      description,
      greeting: "",
      systemPrompt: "",
      stats: null,
      image: null,
    },
  ];
}
