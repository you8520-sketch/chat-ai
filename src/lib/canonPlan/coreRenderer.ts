import type { CanonKnowledgeBucket } from "@/lib/characterKnowledgeBoundary";
import { isPublicVisibleChunk } from "@/lib/canonPlan/canonVisibility";
import type { CanonPlanChunk, CanonPlanV1 } from "@/lib/canonPlan/types";

export type CanonSerializationPath = "legacy_structured";

const BUCKET_HEADERS: Record<
  CanonKnowledgeBucket,
  (aiLabel: string) => string
> = {
  character: (aiLabel) => `[CHARACTER CANON — ${aiLabel} MAY KNOW & ROLEPLAY]`,
  world: (aiLabel) => `[WORLD CANON — IN-WORLD FACTS (not automatic ${aiLabel} memory)]`,
  player: (aiLabel) =>
    `[PLAYER CANON — ${aiLabel} DOES NOT KNOW]\nOnly [B] knows this. ${aiLabel} must never speak or think as if they remember, experienced, or were told this.`,
  scenario_meta: (aiLabel) =>
    `[SCENARIO META — CREATOR / SYSTEM — NOT ${aiLabel} KNOWLEDGE]\nFollow for story structure only. Never quote, paraphrase, or roleplay as if ${aiLabel} knows this metadata.`,
};

function sortChunks(chunks: CanonPlanChunk[]): CanonPlanChunk[] {
  return [...chunks].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

function groupByBucket(chunks: CanonPlanChunk[]): Record<CanonKnowledgeBucket, string[]> {
  const buckets: Record<CanonKnowledgeBucket, string[]> = {
    character: [],
    world: [],
    player: [],
    scenario_meta: [],
  };
  for (const chunk of sortChunks(chunks)) {
    const body = chunk.text.trim();
    if (!body) continue;
    const title = chunk.sectionTitle.trim();
    buckets[chunk.bucket].push(title ? `${title}\n${body}` : body);
  }
  return buckets;
}

function filterPublicRenderChunks(chunks: CanonPlanChunk[]): CanonPlanChunk[] {
  return chunks.filter((c) => isPublicVisibleChunk(c.visibility));
}

/** Deterministic CORE-only renderer — PUBLIC visibility chunks in coreIds only */
export function renderCoreCanonBlock(
  plan: CanonPlanV1,
  opts?: { charName?: string; serializationPath?: CanonSerializationPath }
): string {
  const coreSet = new Set(plan.coreIds);
  const coreChunks = filterPublicRenderChunks(plan.chunks.filter((c) => coreSet.has(c.id)));
  return renderCanonChunksBlock(coreChunks, opts);
}

export function renderCanonChunksBlock(
  chunks: CanonPlanChunk[],
  opts?: { charName?: string; serializationPath?: CanonSerializationPath }
): string {
  void (opts?.serializationPath ?? "legacy_structured");
  const aiLabel = opts?.charName?.trim() || "[A]";
  const buckets = groupByBucket(filterPublicRenderChunks(chunks));
  const parts: string[] = [];

  if (buckets.character.length) {
    parts.push(`${BUCKET_HEADERS.character(aiLabel)}\n${buckets.character.join("\n\n")}`);
  }
  if (buckets.world.length) {
    parts.push(`${BUCKET_HEADERS.world(aiLabel)}\n${buckets.world.join("\n\n")}`);
  }
  if (buckets.player.length) {
    parts.push(`${BUCKET_HEADERS.player(aiLabel)}\n\n${buckets.player.join("\n\n")}`);
  }
  if (buckets.scenario_meta.length) {
    parts.push(`${BUCKET_HEADERS.scenario_meta(aiLabel)}\n\n${buckets.scenario_meta.join("\n\n")}`);
  }

  return parts.join("\n\n");
}

export function estimateCanonBlockChars(text: string): number {
  return text.length;
}
