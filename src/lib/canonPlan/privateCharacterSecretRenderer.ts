import {
  isLockedCharacterSecretChunk,
  type CanonVisibilityCounts,
  countVisibility,
} from "@/lib/canonPlan/canonVisibility";
import type { CanonPlanChunk, CanonPlanV1 } from "@/lib/canonPlan/types";

/** Max included secret CONTENT BODY chars — header/instructions are outside this budget. */
export const PRIVATE_CHARACTER_SECRET_MAX_CHARS = 1200;

const BLOCK_HEADER = `[PRIVATE CHARACTER SECRET — DO NOT DISCLOSE]
These facts are known by [A] but concealed.
Use only for hidden motives, strategic deception, cover behavior, avoidance, covert decisions, and consistent private history.
Do NOT quote or explain the secret unprompted, confess merely because user keywords overlap, treat as public knowledge, repeatedly foreshadow, or expose to NPC knowledge without in-scene cause.`;

export type PrivateCharacterSecretRenderResult = {
  block: string | null;
  /** Rendered secret content body only (title+text lines + separators). Hard-capped at maxChars. */
  s2BodyChars: number;
  /** Full injected block including concealment header. May exceed maxChars. */
  s2BlockChars: number;
  s2IncludedCount: number;
  s2OmittedCount: number;
  visibilityCounts: CanonVisibilityCounts;
};

function sortLockedSecretChunks(chunks: CanonPlanChunk[]): CanonPlanChunk[] {
  return [...chunks]
    .filter(isLockedCharacterSecretChunk)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Bounded S2 renderer — deterministic order, body-only char cap, no keyword expansion. */
export function renderPrivateCharacterSecretBlock(
  plan: CanonPlanV1,
  opts?: { charName?: string; maxChars?: number }
): PrivateCharacterSecretRenderResult {
  void opts?.charName;
  const maxBodyChars = opts?.maxChars ?? PRIVATE_CHARACTER_SECRET_MAX_CHARS;
  const visibilityCounts = countVisibility(plan.chunks);
  const eligible = sortLockedSecretChunks(plan.chunks);

  const included: string[] = [];
  let bodyUsedChars = 0;
  let omittedCount = 0;

  for (const chunk of eligible) {
    const title = chunk.sectionTitle.trim();
    const body = chunk.text.trim();
    if (!body) continue;
    const line = title ? `${title}\n${body}` : body;
    const separator = included.length > 0 ? 2 : 0; // "\n\n" between secret chunks
    const nextBody = bodyUsedChars + separator + line.length;
    if (nextBody > maxBodyChars) {
      omittedCount += eligible.length - included.length;
      break;
    }
    included.push(line);
    bodyUsedChars = nextBody;
  }

  if (included.length === 0) {
    return {
      block: null,
      s2BodyChars: 0,
      s2BlockChars: 0,
      s2IncludedCount: 0,
      s2OmittedCount: eligible.length,
      visibilityCounts,
    };
  }

  const block = `${BLOCK_HEADER}\n\n${included.join("\n\n")}`;
  return {
    block,
    s2BodyChars: bodyUsedChars,
    s2BlockChars: block.length,
    s2IncludedCount: included.length,
    s2OmittedCount: omittedCount,
    visibilityCounts,
  };
}
