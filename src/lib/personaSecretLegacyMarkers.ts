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

/**
 * Convert raw stored persona.description into a public-only description.
 * Returns public string only — never extracted fragments or logs.
 */
export function toPublicPersonaDescription(rawDescription: string): PublicPersonaDescription {
  const raw = String(rawDescription ?? "");
  if (!raw) return asPublicPersonaDescription("");

  let out = stripBracketBlocks(raw);
  out = stripParenBlocks(out);
  // Collapse leftover blank runs from removed blocks without eating intentional spacing.
  out = out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return asPublicPersonaDescription(out);
}
