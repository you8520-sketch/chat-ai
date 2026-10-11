/**
 * Shared world lorebook vs character-local lorebook attach.
 *
 * - World bible lorebook is the COMMON owner for every character in the world.
 * - Character-local entries are extra attach candidates for that character only.
 * - Public otherRelationships project into extra character-local entries so a
 *   name mentioned in RP can activate role/relationship memory. hidden stays
 *   out of lorebooks and remains a LOCKED_SECRET compile input.
 * - The same entryKey is never created twice: the shared owner wins, then
 *   hand-authored character-local keys, then projected relationship keys.
 */
import {
  LOREBOOK_CONTENT_MAX,
  LOREBOOK_KEYWORDS_PER_ENTRY,
  LOREBOOK_NAME_LIMIT,
} from "@/lib/keywordLorebooks";
import { castAliases, type CastRelationship } from "@/lib/officialSupply/castRelationships";
import type { OfficialWorldLorebookEntry } from "@/lib/officialSupply/types";
import { HIDDEN_KNOWLEDGE_RE } from "@/lib/officialSupply/worldQa";

export const LUCIAN_APPROVED_LOREBOOK_KEYS = [
  "mercator_internal_dealings",
  "aether_bonds",
  "mercator_exchange_underworld",
  "bio_aether_taboos",
] as const;

export function resolveOfficialCharacterLorebooks(
  shared: readonly OfficialWorldLorebookEntry[],
  characterLocal: readonly OfficialWorldLorebookEntry[] = []
): OfficialWorldLorebookEntry[] {
  const seen = new Set(shared.map((entry) => entry.entryKey));
  return [...shared, ...characterLocal.filter((entry) => !seen.has(entry.entryKey))];
}

function compactRelationshipName(name: string): string {
  return name.replace(/\s+/g, "");
}

/** Shared-lorebook hidden-knowledge wording is stripped; the bible itself is not rewritten. */
export function sanitizeRelationshipLorebookText(text: string): string {
  return text.replace(HIDDEN_KNOWLEDGE_RE, " ").replace(/\s+/g, " ").trim();
}

export function relationshipLorebookEntryKey(ownerKey: string, target: string): string {
  return `cast_rel_${ownerKey}_${compactRelationshipName(target)}`;
}

/**
 * Public name / role / relationship become character-local lorebook entries.
 * privateOpinion may ride along as this character's known stance. hidden never
 * enters the lorebook.
 */
export function projectOtherRelationshipsToCharacterLorebook(
  relationships: readonly CastRelationship[],
  ownerKey: string
): OfficialWorldLorebookEntry[] {
  const out: OfficialWorldLorebookEntry[] = [];
  const seen = new Set<string>();
  for (const rel of relationships) {
    const target = rel.target.trim();
    const publicText = sanitizeRelationshipLorebookText(rel.public ?? "");
    if (!target || !publicText) continue;
    const entryKey = relationshipLorebookEntryKey(ownerKey, target);
    if (seen.has(entryKey)) continue;
    seen.add(entryKey);
    const stance = sanitizeRelationshipLorebookText(rel.privateOpinion ?? "");
    const content = [`${target} — ${publicText}`, stance ? `이 인물에 대한 태도: ${stance}` : ""]
      .filter(Boolean)
      .join("\n")
      .slice(0, LOREBOOK_CONTENT_MAX);
    const keywords = castAliases(target)
      .map((alias) => alias.trim())
      .filter(Boolean)
      .slice(0, LOREBOOK_KEYWORDS_PER_ENTRY);
    out.push({
      entryKey,
      name: target.slice(0, LOREBOOK_NAME_LIMIT),
      keywords: keywords.length > 0 ? keywords : [target.slice(0, LOREBOOK_NAME_LIMIT)],
      content,
    });
  }
  return out;
}

export function attachOfficialCharacterLorebooks(input: {
  shared: readonly OfficialWorldLorebookEntry[];
  characterLocal?: readonly OfficialWorldLorebookEntry[];
  otherRelationships?: readonly CastRelationship[];
  ownerKey: string;
}): OfficialWorldLorebookEntry[] {
  const projected = projectOtherRelationshipsToCharacterLorebook(
    input.otherRelationships ?? [],
    input.ownerKey
  );
  return resolveOfficialCharacterLorebooks(
    input.shared,
    resolveOfficialCharacterLorebooks(input.characterLocal ?? [], projected)
  );
}
