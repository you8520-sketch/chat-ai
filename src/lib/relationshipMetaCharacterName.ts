import { getDb } from "@/lib/db";
import { extractCharacterCallName } from "@/lib/chatModels";
import { loadCharacterChunks, type CharacterSettingRow } from "@/lib/characterChunks";
import { isStructuralSectionHeader } from "@/lib/characterSettingSections";
import type { CharacterChunk } from "@/types";
import type { HonorificNames } from "@/lib/chatMemory";

const ROLEPLAY_NAME_LABEL = "이름|성명|본명|캐릭터\\s*명|Name";

const BRACKET_NAME_PATTERNS: RegExp[] = [
  /\[Name\]\s*([^\n(\[/]+)/i,
  /\[이름\]\s*([^\n(\[/]+)/,
];

const COLON_NAME_PATTERN = new RegExp(
  `(?:^|\\n)(?:${ROLEPLAY_NAME_LABEL})\\s*[:：]\\s*([^\\n(\\[/]+)`,
  "i"
);

const NEWLINE_NAME_PATTERN = new RegExp(
  `(?:^|\\n)[ \\t]*(?:#{1,3}[ \\t]*)?(?:${ROLEPLAY_NAME_LABEL})[ \\t]*\\n+[ \\t]*([^\\n]+)`,
  "i"
);

/**
 * Bracket and newline labels already become a name section.
 * A colon label is a real name for extraction, but the combined-source prefix
 * still normalizes it into `[이름]`, so it is not an existing name body.
 */
const EXPLICIT_NAME_BODY_PATTERNS: RegExp[] = [...BRACKET_NAME_PATTERNS, NEWLINE_NAME_PATTERN];

const EXPLICIT_NAME_LABEL_PATTERNS: RegExp[] = [
  ...BRACKET_NAME_PATTERNS,
  COLON_NAME_PATTERN,
  NEWLINE_NAME_PATTERN,
];

const ARROW_NAME_PATTERN = /(?:유저→캐릭터|→캐릭터)\s*[:：]\s*([^\n·]+)/;

const BARE_LATIN_TOKEN_RE = /^[A-Za-z][A-Za-z-]{0,20}$/;

const SIMULATION_TITLE_LABEL_RE =
  /^(?:최애|남주|여주|주인공|히로인|남자주인공|여자주인공|섭남|앨런|남캐|여캐)$/i;

/** 홈·목록용 제목(시뮬명·작품명) — 인물 이름으로 쓰면 안 됨 */
export function looksLikeDisplayTitle(name: string): boolean {
  const t = name.trim();
  if (!t) return true;
  if (SIMULATION_TITLE_LABEL_RE.test(t)) return true;
  if (t.length > 12) return true;
  if (/\s/.test(t) && t.length > 4) return true;
  if (/(?:또|죽|이다|했다|였|섭남|시뮬|남주|여주)/.test(t)) return true;
  return false;
}

function cleanPersonName(raw: string): string {
  let t = raw.trim();
  t = t.replace(/^["'「『]|["'」』]$/g, "").trim();
  const paren = t.match(/^([^(（[\n]+)/);
  if (paren?.[1]) t = paren[1].trim();
  return t.split(/\s+/)[0]?.trim() ?? t;
}

function isPlausiblePersonName(name: string): boolean {
  const t = cleanPersonName(name);
  if (t.length < 2 || t.length > 12) return false;
  if (looksLikeDisplayTitle(t)) return false;
  return true;
}

function nextNonEmptyLine(source: string, fromIndex: number): string | null {
  let index = fromIndex;
  while (index < source.length) {
    const end = source.indexOf("\n", index);
    const line = source.slice(index, end === -1 ? undefined : end).trim();
    if (line) return line;
    if (end === -1) break;
    index = end + 1;
  }
  return null;
}

/**
 * `Name\nAge\n25`: Age is not a section header, but it is the label of the next value.
 * A hangul name, a parenthetical codename, or a Latin name at EOF / before a real header stays.
 */
function isAmbiguousLatinFieldLabel(physicalLine: string, followingLine: string | null): boolean {
  if (!BARE_LATIN_TOKEN_RE.test(physicalLine)) return false;
  if (!followingLine) return false;
  if (isStructuralSectionHeader(followingLine)) return false;
  return true;
}

/** Same accept/reject rule for extraction and the explicit-name check. */
function acceptCapturedName(
  source: string,
  matchIndex: number,
  fullMatch: string,
  raw: string
): string | null {
  const trimmed = raw.trim();
  if (!trimmed || isStructuralSectionHeader(trimmed)) return null;
  const captureStart = matchIndex + fullMatch.length - raw.length;
  const lineStart = source.lastIndexOf("\n", Math.max(0, captureStart - 1)) + 1;
  const lineEndIdx = source.indexOf("\n", captureStart);
  const lineEnd = lineEndIdx === -1 ? source.length : lineEndIdx;
  const physicalLine = source.slice(lineStart, lineEnd).trim();
  const valueOccupiesLine = source.slice(lineStart, captureStart).trim() === "";
  const following = nextNonEmptyLine(source, lineEndIdx === -1 ? source.length : lineEndIdx + 1);
  if (valueOccupiesLine && isAmbiguousLatinFieldLabel(physicalLine, following)) return null;
  const candidate = cleanPersonName(trimmed);
  if (!candidate || isStructuralSectionHeader(candidate) || !isPlausiblePersonName(candidate)) {
    return null;
  }
  return candidate;
}

function firstAcceptedName(source: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    const global = new RegExp(re.source, flags);
    for (const match of source.matchAll(global)) {
      const raw = match[1];
      if (!raw || match.index == null) continue;
      const accepted = acceptCapturedName(source, match.index, match[0], raw);
      if (accepted) return accepted;
    }
  }
  return null;
}

/** A bracket or newline name label already has a real value, so callers must not invent a second name. */
export function settingTextCarriesExplicitNameBody(text: string): boolean {
  const source = text.trim();
  if (!source) return false;
  return firstAcceptedName(source, EXPLICIT_NAME_BODY_PATTERNS) != null;
}

/** 캐릭터 설정(identity·system_prompt)에서 RP 주인공 이름 추출 */
export function extractRoleplayNameFromSettingText(text: string): string | null {
  const source = text.trim();
  if (!source) return null;
  const labeled = firstAcceptedName(source, EXPLICIT_NAME_LABEL_PATTERNS);
  if (labeled) return labeled;
  const arrow = source.match(ARROW_NAME_PATTERN);
  if (!arrow?.[1]) return null;
  const candidate = cleanPersonName(arrow[1]);
  if (!candidate || isStructuralSectionHeader(candidate) || !isPlausiblePersonName(candidate)) {
    return null;
  }
  return candidate;
}

export function extractRoleplayNameFromChunks(
  chunks: CharacterChunk[],
  displayName?: string
): string | null {
  const display = displayName?.trim() ?? "";
  for (const chunk of chunks) {
    if (chunk.category !== "identity") continue;
    const found = extractRoleplayNameFromSettingText(chunk.content);
    if (!found) continue;
    if (display && (found === display || display.includes(found) || found === cleanPersonName(display))) {
      continue;
    }
    return found;
  }
  for (const chunk of chunks) {
    if (!/\[이름\]|Name\]|성명|본명/i.test(chunk.content)) continue;
    const found = extractRoleplayNameFromSettingText(chunk.content);
    if (!found) continue;
    if (display && (found === display || display.includes(found) || found === cleanPersonName(display))) {
      continue;
    }
    return found;
  }
  return null;
}

/** 목록명(display) vs 설정 기반 RP 이름(roleplay) 분리 */
export function resolveRoleplayCharacterName(opts: {
  displayName: string;
  systemPrompt?: string;
  chunks?: CharacterChunk[];
}): { roleplayName: string; displayName: string } {
  const display = opts.displayName.trim() || "캐릭터";

  const fromPrompt = opts.systemPrompt
    ? extractRoleplayNameFromSettingText(opts.systemPrompt)
    : null;
  if (fromPrompt) return { roleplayName: fromPrompt, displayName: display };

  const fromChunks =
    opts.chunks && opts.chunks.length > 0
      ? extractRoleplayNameFromChunks(opts.chunks, display)
      : null;
  if (fromChunks) return { roleplayName: fromChunks, displayName: display };

  const fromParen = extractCharacterCallName(display);
  if (fromParen !== display && isPlausiblePersonName(fromParen)) {
    return { roleplayName: fromParen, displayName: display };
  }

  if (isPlausiblePersonName(display)) {
    return { roleplayName: cleanPersonName(display), displayName: display };
  }

  if (isPlausiblePersonName(fromParen)) {
    return { roleplayName: cleanPersonName(fromParen), displayName: display };
  }

  return { roleplayName: "캐릭터", displayName: display };
}

export function resolveRelationshipMetaNames(opts: {
  displayName: string;
  systemPrompt?: string;
  chunks?: CharacterChunk[];
  userName: string;
}): HonorificNames {
  const { roleplayName, displayName } = resolveRoleplayCharacterName(opts);
  const userName = opts.userName.trim() || "유저";
  return {
    charName: roleplayName,
    userName,
    displayTitle: displayName !== roleplayName ? displayName : undefined,
  };
}

export function resolveRelationshipMetaNamesForCharacter(
  characterId: number,
  userName: string
): HonorificNames {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, name, gender, system_prompt, world, example_dialog, status_window_prompt, setting_chunks
       FROM characters WHERE id=?`
    )
    .get(characterId) as CharacterSettingRow | undefined;
  if (!row) {
    return { charName: "캐릭터", userName: userName.trim() || "유저" };
  }
  const chunks = loadCharacterChunks(row);
  return resolveRelationshipMetaNames({
    displayName: row.name,
    systemPrompt: row.system_prompt,
    chunks,
    userName,
  });
}
