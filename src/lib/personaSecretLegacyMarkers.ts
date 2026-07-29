import {
  asPublicPersonaDescription,
  type PublicPersonaDescription,
} from "@/lib/personaSecretTypes";

/**
 * Explicit NPC/character-unknown secret markers only.
 * Prefer false-negative (leave ambiguous text) over false-positive strip.
 *
 * Does NOT strip: [비밀], [배경], 실은, 숨겨진 정체, 과거의 비밀, etc.
 */
const LEGACY_SECRET_PREFIXES = [
  /^NPC들은\s*모르는\s*비밀설정/i,
  /^NPC가\s*모르는\s*비밀설정/i,
  /^캐릭터들은\s*모르는\s*설정/i,
  /^캐릭터는\s*모르는\s*비밀/i,
] as const;

function isLegacySecretInner(inner: string): boolean {
  const trimmed = inner.trim();
  return LEGACY_SECRET_PREFIXES.some((re) => re.test(trimmed));
}

function stripBracketBlocks(raw: string): string {
  // Square brackets may contain nested parentheses, e.g.
  // [NPC들은 모르는 비밀설정(관련 서술금지): …]
  return raw.replace(/\[[^\]]*\]/g, (block) => {
    const inner = block.slice(1, -1);
    return isLegacySecretInner(inner) ? "" : block;
  });
}

function stripParenBlocks(raw: string): string {
  return raw.replace(/\([^)]*\)/g, (block) => {
    const inner = block.slice(1, -1);
    return isLegacySecretInner(inner) ? "" : block;
  });
}

function collapsePublicWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Convert raw stored persona.description into a public-only description.
 * Returns public string only — never extracted fragments or logs.
 */
export function toPublicPersonaDescription(rawDescription: string): PublicPersonaDescription {
  const raw = String(rawDescription ?? "");
  if (!raw) return asPublicPersonaDescription("");

  let out = stripBracketBlocks(raw);
  out = stripParenBlocks(out);
  out = collapsePublicWhitespace(out);

  return asPublicPersonaDescription(out);
}

/** True when raw description contains an explicit legacy secret marker block. */
export function hasExplicitLegacySecretMarkers(rawDescription: string): boolean {
  const raw = String(rawDescription ?? "");
  if (!raw) return false;
  return extractLegacySecretBlocks(raw).length > 0;
}

const LEGACY_BLOCK_RE = /\[[^\]]*\]|\([^)]*\)/g;

/**
 * Extract opaque legacy marker blocks in source order with multiplicity.
 * Never logs or returns the inner secret for telemetry — callers must treat
 * returned strings as opaque raw storage fragments only.
 */
export function extractLegacySecretBlocks(rawDescription: string): string[] {
  const raw = String(rawDescription ?? "");
  if (!raw) return [];

  const blocks: string[] = [];

  for (const match of raw.matchAll(LEGACY_BLOCK_RE)) {
    const block = match[0]!;
    const opener = block[0];
    const closer = block[block.length - 1];

    if (
      !(
        (opener === "[" && closer === "]") ||
        (opener === "(" && closer === ")")
      )
    ) {
      continue;
    }

    const inner = block.slice(1, -1);
    if (isLegacySecretInner(inner)) {
      blocks.push(block);
    }
  }

  return blocks;
}

/**
 * Server-only save helper: apply a public description update while preserving
 * existing explicit legacy secret marker blocks in the DB raw description.
 *
 * Does not migrate markers into secret_description or invoke the compiler.
 */
export function preserveLegacySecretBlocksOnPublicDescriptionUpdate(
  existingRawDescription: string,
  nextPublicDescription: string
): string {
  const existingRaw = String(existingRawDescription ?? "");
  const nextPublic = String(toPublicPersonaDescription(nextPublicDescription));
  const legacyBlocks = extractLegacySecretBlocks(existingRaw);
  if (legacyBlocks.length === 0) return nextPublic;

  const legacyPart = legacyBlocks.join("\n");
  if (!nextPublic) return legacyPart;
  return `${nextPublic}\n${legacyPart}`;
}
