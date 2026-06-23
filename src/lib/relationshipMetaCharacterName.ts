import { getDb } from "@/lib/db";
import { extractCharacterCallName } from "@/lib/chatModels";
import { loadCharacterChunks, type CharacterSettingRow } from "@/lib/characterChunks";
import type { CharacterChunk } from "@/types";
import type { HonorificNames } from "@/lib/chatMemory";

const SETTING_NAME_PATTERNS: RegExp[] = [
  /\[Name\]\s*([^\n(\[/]+)/i,
  /\[이름\]\s*([^\n(\[/]+)/,
  /(?:^|\n)(?:이름|성명|본명|캐릭터\s*명|Name)\s*[:：]\s*([^\n(\[/]+)/im,
  /(?:유저→캐릭터|→캐릭터)\s*[:：]\s*([^\n·]+)/,
];

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

/** 캐릭터 설정(identity·system_prompt)에서 RP 주인공 이름 추출 */
export function extractRoleplayNameFromSettingText(text: string): string | null {
  const source = text.trim();
  if (!source) return null;
  for (const re of SETTING_NAME_PATTERNS) {
    const m = source.match(re);
    if (!m?.[1]) continue;
    const candidate = cleanPersonName(m[1]);
    if (isPlausiblePersonName(candidate)) return candidate;
  }
  return null;
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
