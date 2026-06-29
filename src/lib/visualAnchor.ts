import type { CharacterChunk } from "@/types";

export type HairColorTag =
  | "blonde"
  | "silver"
  | "black"
  | "brown"
  | "red"
  | "white"
  | "blue"
  | "pink"
  | "green"
  | "other";

export type EyeColorTag =
  | "blue"
  | "green"
  | "brown"
  | "gold"
  | "red"
  | "gray"
  | "black"
  | "purple"
  | "other";

export type VisualAppearancePolicy = {
  hair: HairColorTag | null;
  hairLabel: string | null;
  eyes: EyeColorTag | null;
  eyesLabel: string | null;
  body: string | null;
};

type ColorDef<T extends string> = { tag: T; label: string; re: RegExp };

const HAIR_DEFS: ColorDef<HairColorTag>[] = [
  { tag: "blonde", label: "금발 (blonde)", re: /금발|(?:밝은|연)?금(?:색|빛)(?:\s*머리)?|(?:blonde?|golden\s*hair)/i },
  { tag: "silver", label: "은발 (silver/platinum)", re: /은발|(?:은|백)(?:색|빛)\s*머리|(?:silver|platinum)(?:\s*hair)?/i },
  { tag: "black", label: "흑발 (black)", re: /흑발|검(?:은|정)\s*머리|(?:black|dark)\s*hair/i },
  { tag: "brown", label: "갈색 머리 (brown)", re: /(?:갈색|밤색|적갈|애쉬)\s*머리|(?:brown|auburn|chestnut)\s*hair/i },
  { tag: "red", label: "붉은/빨간 머리 (red)", re: /(?:빨간|붉은|적(?:색|갈)?)\s*머리|red\s*hair/i },
  { tag: "white", label: "백발 (white)", re: /백발|(?:하얀|흰)\s*머리|white\s*hair/i },
  { tag: "blue", label: "푸른/파란 머리 (blue)", re: /(?:푸른|파란|하늘(?:색)?)\s*머리|blue\s*hair/i },
  { tag: "pink", label: "분홍/핑크 머리 (pink)", re: /(?:분홍|핑크|자주)\s*머리|pink\s*hair/i },
  { tag: "green", label: "녹색 머리 (green)", re: /(?:녹색|초록)\s*머리|green\s*hair/i },
];

const EYE_DEFS: ColorDef<EyeColorTag>[] = [
  { tag: "blue", label: "푸른/파란 눈 (blue)", re: /(?:푸른|파란|하늘(?:색)?|청(?:색|록))\s*(?:눈|눈동자|홍책)|blue\s*eyes?/i },
  { tag: "green", label: "녹색/초록 눈 (green)", re: /(?:녹색|초록|에메랄드)\s*(?:눈|눈동자|홍책)|green\s*eyes?/i },
  { tag: "brown", label: "갈색 눈 (brown)", re: /(?:갈색|밤색|호박)\s*(?:눈|눈동자|홍책)|brown\s*eyes?/i },
  { tag: "gold", label: "금색/황금 눈 (gold/amber)", re: /(?:금(?:색|빛)|황금|호박)\s*(?:눈|눈동자|홍책)|(?:golden|amber)\s*eyes?/i },
  { tag: "red", label: "붉은/빨간 눈 (red)", re: /(?:붉은|빨간|적(?:색)?)\s*(?:눈|눈동자|홍책)|red\s*eyes?/i },
  { tag: "gray", label: "회색/회빛 눈 (gray)", re: /(?:회(?:색|빛)|은(?:색|빛))\s*(?:눈|눈동자|홍책)|gray|grey\s*eyes?/i },
  { tag: "black", label: "검은 눈 (black)", re: /(?:검(?:은|정)|흑(?:색)?)\s*(?:눈|눈동자|홍책)|black\s*eyes?/i },
  { tag: "purple", label: "보라/자주 눈 (purple)", re: /(?:보라|자주|자색)\s*(?:눈|눈동자|홍책)|purple|violet\s*eyes?/i },
];

const BODY_RE =
  /(?:체형|몸매|키\s*[:：]?\s*[^\n,]{1,24}|(?:날씬|마른|근육질|통통|작은\s*체격|긴\s*팔다리|slender|slim|muscular|petite|tall))/i;

/** Explicit appearance field — preferred over generic BODY_RE (avoids matching enemy "거대" in 외형 lines) */
const APPEARANCE_FIELD_LINE_RE =
  /^(?:[-*•#\s]*)(?:외형|외모|체형|몸매)\s*[:：]\s*(.+)/i;

/** Bracketed lore blocks for NPCs/enemies — not the playable AI character */
const LORE_ENTITY_HEADER_RE =
  /^\[(?:Enemy|NPC|Boss|Monster|Sub(?:-|\s)?character|전투(?:\s*시스템)?|Combat|적(?:\s|:|$)|몬스터|서브(?:\s|:|$)|조연|보스|Battle)/i;

const MAIN_PROFILE_SECTION_RE =
  /^(?:#{1,3}\s*)?(?:\[?(?:외형|외모|이름|성격|정체성)\]?|\[(?:이름|외형|외모|성격)\])/i;

const APPEARANCE_TRAIT_RE =
  /(?:금발|은발|흑발|백발|갈색\s*머리|(?:푸른|파란|하늘(?:색)?|금(?:색|빛)|황금|적(?:색|갈)?|녹색|회(?:색|빛)|검(?:은|정)|보라(?:색)?)\s*(?:눈|눈동자|홍책)|(?:blonde?|silver\s*hair|blue\s*eyes|golden\s*eyes)|(?:외모|외형|머리(?:색|칼)|눈(?:동자)?\s*색))/i;

const HAIR_CONTEXT_RE = /머리|모발|hair/i;
const EYE_CONTEXT_RE = /눈|눈동자|홍책|iris|eyes/i;

/** 외모 색상·체형 키워드가 있는 청크인지 */
export function hasAppearanceTraits(text: string): boolean {
  return APPEARANCE_TRAIT_RE.test(text);
}

function pickColor<T extends string>(
  text: string,
  defs: ColorDef<T>[],
  contextRe: RegExp
): ColorDef<T> | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const scoped = lines.filter((l) => contextRe.test(l));
  const searchLines = scoped.length > 0 ? scoped : lines;

  for (const line of searchLines) {
    for (const def of defs) {
      if (def.re.test(line)) return def;
    }
  }
  for (const def of defs) {
    if (def.re.test(text)) return def;
  }
  return null;
}

type ScoredLine = { line: string; score: number; appearanceProfile?: boolean };

const NPC_PROFILE_LINE_RE =
  /^(?:[A-Z][a-z]+(?:\s+(?:de|von)\s+[A-Z][a-z]+)?|[가-힣]{2,}(?:\s+(?:데|폰)\s+[가-힣]+)?)\s*[:：]/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** identity 청크·호칭에서 플레이 캐릭터 이름 별칭 수집 */
export function deriveCharacterNameAliases(chunks: CharacterChunk[], charName: string): string[] {
  const aliases = new Set<string>([charName.trim()]);
  const allText = chunks.map((c) => c.content).join("\n");

  for (const chunk of chunks) {
    if (chunk.category !== "identity") continue;
    const m = chunk.content.match(/Name\]\s*([^\n(]+)/i);
    if (!m?.[1]) continue;
    const full = m[1].trim();
    if (full) aliases.add(full);
    const first = full.split(/\s+/)[0];
    if (first && first.length >= 2) aliases.add(first);
  }

  for (const m of allText.matchAll(/유저→캐릭터:\s*([^\n·]+)/g)) {
    const name = m[1]?.trim();
    if (name && name.length >= 2) aliases.add(name);
  }

  return [...aliases].filter((a) => a.length >= 2);
}

/** NPC 프로필·페르소나 등 제외할 이름 */
function deriveExcludeNames(chunks: CharacterChunk[], personaName?: string): string[] {
  const exclude = new Set<string>();
  if (personaName?.trim()) exclude.add(personaName.trim());

  for (const chunk of chunks) {
    for (const line of chunk.content.split(/\r?\n/)) {
      const m = line.trim().match(NPC_PROFILE_LINE_RE);
      if (!m?.[1]) continue;
      const first = m[1].split(/\s+/)[0];
      if (first && first.length >= 2) exclude.add(first);
      exclude.add(m[1].trim());
    }
  }
  return [...exclude];
}

function lineHasAppearanceColor(line: string): boolean {
  return APPEARANCE_TRAIT_RE.test(line) || HAIR_CONTEXT_RE.test(line) || EYE_CONTEXT_RE.test(line);
}

function isLoreEntityHeader(line: string): boolean {
  const trimmed = line.trim();
  if (LORE_ENTITY_HEADER_RE.test(trimmed)) return true;
  const bracket = trimmed.match(/^\[([^\]\n]{1,80})\]/);
  if (!bracket?.[1]) return false;
  return /(?:enemy|npc|boss|monster|전투|몬스터|보스|괴수|적(?:\s|$))/i.test(bracket[1]);
}

/** Split chunk text into lines with lore-entity sections flagged */
function iterateLinesWithLoreContext(content: string): { line: string; inLoreEntity: boolean }[] {
  const out: { line: string; inLoreEntity: boolean }[] = [];
  let inLore = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      out.push({ line: rawLine, inLoreEntity: inLore });
      continue;
    }
    if (isLoreEntityHeader(line)) {
      inLore = true;
      out.push({ line: rawLine, inLoreEntity: true });
      continue;
    }
    if (inLore && MAIN_PROFILE_SECTION_RE.test(line)) {
      inLore = isLoreEntityHeader(line);
    }
    out.push({ line: rawLine, inLoreEntity: inLore });
  }
  return out;
}

function extractAppearanceFieldValue(line: string): string | null {
  const trimmed = line.trim();
  const colon = trimmed.match(APPEARANCE_FIELD_LINE_RE);
  if (colon?.[1]?.trim()) return colon[1].trim().slice(0, 120);
  const inline = trimmed.match(/^\[(?:외형|외모)\]\s+(\S.+)$/i);
  if (inline?.[1]?.trim()) return inline[1].trim().slice(0, 120);
  return null;
}

function extractDedicatedAppearanceChunkBody(chunk: CharacterChunk): string | null {
  if (!isDedicatedAppearanceChunk(chunk)) return null;
  const withoutHeader = chunk.content
    .trim()
    .replace(/^\[(?:외형|외모)\]\s*\n?/i, "")
    .trim();
  return withoutHeader.length >= 4 ? withoutHeader.slice(0, 600) : null;
}

/** `[외형]` 헤더 단독 줄 + 다음 줄 본문 (characterParser splitIntoSections와 동일 패턴) */
function extractAppearanceAfterBracketHeader(
  lines: { line: string; inLoreEntity: boolean }[],
  startIdx: number
): string | null {
  const bodyLines: string[] = [];
  for (let j = startIdx + 1; j < lines.length; j++) {
    const { line: rawLine, inLoreEntity } = lines[j];
    if (inLoreEntity) break;
    const line = rawLine.trim();
    if (!line) {
      if (bodyLines.length > 0) break;
      continue;
    }
    if (MAIN_PROFILE_SECTION_RE.test(line) || isLoreEntityHeader(line)) break;
    bodyLines.push(line);
  }
  const joined = bodyLines.join(" ").trim();
  return joined.length >= 4 ? joined.slice(0, 600) : null;
}

function isDedicatedAppearanceChunk(chunk: CharacterChunk): boolean {
  const head = chunk.content.trim().slice(0, 48);
  return (
    chunk.category === "abilities" &&
    /^(?:\[외형\]|\[외모\]|#{1,3}\s*(?:외형|외모))/i.test(head)
  );
}

function scoreAppearanceLines(
  chunks: CharacterChunk[],
  aliases: string[],
  excludeNames: string[]
): ScoredLine[] {
  const aliasRes = aliases
    .filter((a) => a.length >= 2)
    .map((a) => new RegExp(escapeRegExp(a), "i"));
  const excludeRes = excludeNames
    .filter((n) => n.length >= 2)
    .map((n) => new RegExp(escapeRegExp(n), "i"));

  const results: ScoredLine[] = [];

  for (const chunk of chunks) {
    const dedicatedAppearance = isDedicatedAppearanceChunk(chunk);
    const chunkBonus = dedicatedAppearance
      ? 4
      : chunk.importance === "CRITICAL" &&
          (chunk.category === "identity" || chunk.category === "personality")
        ? 2
        : 0;

    for (const { line: rawLine, inLoreEntity } of iterateLinesWithLoreContext(chunk.content)) {
      const line = rawLine.trim();
      if (!line || !lineHasAppearanceColor(line)) continue;
      if (/^\[(?:외형|외모)\]$/i.test(line)) continue;
      if (inLoreEntity) continue;

      let score = chunkBonus;
      if (aliasRes.some((re) => re.test(line))) score += 3;
      const npcProfileLine = NPC_PROFILE_LINE_RE.test(line);
      if (excludeRes.some((re) => re.test(line)) && lineHasAppearanceColor(line)) score -= 5;
      if (npcProfileLine && lineHasAppearanceColor(line)) score -= 8;
      if (APPEARANCE_FIELD_LINE_RE.test(line)) score += 4;
      if (/(?:괴수|보스\s*몬|enemy|monster)/i.test(line)) score -= 8;

      const appearanceProfile =
        dedicatedAppearance || APPEARANCE_FIELD_LINE_RE.test(line) || /^\[(?:외형|외모)\]/i.test(line);

      if (score > -5) results.push({ line, score, appearanceProfile });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

function pickColorFromScored<T extends string>(
  scored: ScoredLine[],
  defs: ColorDef<T>[],
  contextRe: RegExp
): ColorDef<T> | null {
  // 캐릭터명·identity 청크와 연결된 라인(score>0)만 — NPC 색상 오추출 방지
  const positive = scored.filter((s) => s.score > 0);
  if (positive.length === 0) return null;

  const profileLines = positive.filter((s) => s.appearanceProfile);
  const searchSets = profileLines.length > 0 ? [profileLines, positive] : [positive];

  for (const set of searchSets) {
    for (const { line } of set) {
      if (!contextRe.test(line)) continue;
      for (const def of defs) {
        if (def.re.test(line)) return def;
      }
    }
    for (const { line } of set) {
      for (const def of defs) {
        if (def.re.test(line)) return def;
      }
    }
  }
  return null;
}

/** 캐릭터 외모 관련 라인만 점수순 수집 (NPC·페르소나 색상 제외) */
export function collectCharacterAppearanceText(
  chunks: CharacterChunk[],
  charName: string,
  opts?: { personaName?: string }
): string {
  const aliases = deriveCharacterNameAliases(chunks, charName);
  const excludeNames = deriveExcludeNames(chunks, opts?.personaName);
  const scored = scoreAppearanceLines(chunks, aliases, excludeNames);
  const usable = scored.filter((s) => s.score > 0);
  const lines = (usable.length > 0 ? usable : scored.filter((s) => s.score >= 0)).map((s) => s.line);
  return lines.join("\n");
}

function extractVisualAppearancePolicyFromScored(
  scored: ScoredLine[],
  scopedText: string
): VisualAppearancePolicy {
  const text = scopedText.trim();
  if (!text && scored.length === 0) {
    return { hair: null, hairLabel: null, eyes: null, eyesLabel: null, body: null };
  }

  const hair = pickColorFromScored(scored, HAIR_DEFS, HAIR_CONTEXT_RE);
  const eyes = pickColorFromScored(scored, EYE_DEFS, EYE_CONTEXT_RE);
  const bodyFromField = text ? extractBodyTag(text) : null;
  const body = bodyFromField;

  return {
    hair: hair?.tag ?? null,
    hairLabel: hair?.label ?? null,
    eyes: eyes?.tag ?? null,
    eyesLabel: eyes?.label ?? null,
    body,
  };
}

/** 설정 텍스트 + 캐릭터명 — char-scoped 라인만 사용 */
export function extractVisualAppearancePolicyForCharacter(
  settingText: string,
  charName: string
): VisualAppearancePolicy {
  const aliases = [charName.trim()].filter(Boolean);
  const lines = settingText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const aliasRes = aliases.map((a) => new RegExp(escapeRegExp(a), "i"));
  const scored: ScoredLine[] = [];

  for (const line of lines) {
    if (!lineHasAppearanceColor(line)) continue;
    let score = 0;
    if (aliasRes.some((re) => re.test(line))) score += 3;
    if (NPC_PROFILE_LINE_RE.test(line) && lineHasAppearanceColor(line)) score -= 5;
    if (score > -5) scored.push({ line, score });
  }

  const scoped = scored
    .filter((s) => s.score > 0)
    .map((s) => s.line)
    .join("\n");
  return extractVisualAppearancePolicyFromScored(scored, scoped);
}

/** 청크 기반 — 플레이 캐릭터 외모만 추출 (NPC·유저 페르소나 색상 제외) */
export function extractVisualAppearancePolicyFromChunks(
  chunks: CharacterChunk[],
  charName: string,
  opts?: { personaName?: string }
): VisualAppearancePolicy {
  const aliases = deriveCharacterNameAliases(chunks, charName);
  const excludeNames = deriveExcludeNames(chunks, opts?.personaName);
  const scored = scoreAppearanceLines(chunks, aliases, excludeNames);
  const scopedText = collectCharacterAppearanceText(chunks, charName, opts);
  const policy = extractVisualAppearancePolicyFromScored(scored, scopedText);
  const mainBody = extractMainCharacterAppearanceBody(chunks, charName, opts);
  if (mainBody) {
    return { ...policy, body: mainBody };
  }
  return policy;
}

function extractBodyTag(text: string): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const field = extractAppearanceFieldValue(line);
    if (field && field.length >= 4) return field;
  }

  for (const line of lines) {
    if (APPEARANCE_FIELD_LINE_RE.test(line)) continue;
    if (BODY_RE.test(line)) {
      const trimmed = line.replace(/^[-*•#\s]+/, "").slice(0, 80).trim();
      if (trimmed.length >= 4) return trimmed;
    }
  }
  return null;
}

/** First character-profile 외형 field — ignores [Enemy]/[NPC] lore blocks */
export function extractMainCharacterAppearanceBody(
  chunks: CharacterChunk[],
  charName: string,
  opts?: { personaName?: string }
): string | null {
  const aliases = deriveCharacterNameAliases(chunks, charName);
  const excludeNames = deriveExcludeNames(chunks, opts?.personaName);
  const aliasRes = aliases.map((a) => new RegExp(escapeRegExp(a), "i"));

  const preferredCategories = new Set(["identity", "personality", "abilities"]);
  for (const chunk of chunks) {
    const dedicated = extractDedicatedAppearanceChunkBody(chunk);
    if (dedicated) return dedicated;
  }

  const ordered = [
    ...chunks.filter((c) => preferredCategories.has(c.category)),
    ...chunks.filter((c) => !preferredCategories.has(c.category)),
  ];

  for (const chunk of ordered) {
    const lines = iterateLinesWithLoreContext(chunk.content);
    for (let i = 0; i < lines.length; i++) {
      const { line: rawLine, inLoreEntity } = lines[i];
      if (inLoreEntity) continue;
      const line = rawLine.trim();

      if (/^\[(?:외형|외모)\]$/i.test(line)) {
        const block = extractAppearanceAfterBracketHeader(lines, i);
        if (block) return block;
        continue;
      }

      const field = extractAppearanceFieldValue(line);
      if (!field || field.length < 4) continue;

      if (excludeNames.some((n) => line.includes(n) && !aliasRes.some((re) => re.test(line)))) {
        continue;
      }
      return field;
    }
  }
  return null;
}

/** 설정·로어북 텍스트에서 핵심 외모 태그 추출 */
export function extractVisualAppearancePolicy(settingText: string): VisualAppearancePolicy {
  const text = settingText.trim();
  if (!text) {
    return { hair: null, hairLabel: null, eyes: null, eyesLabel: null, body: null };
  }

  const hair = pickColor(text, HAIR_DEFS, HAIR_CONTEXT_RE);
  const eyes = pickColor(text, EYE_DEFS, EYE_CONTEXT_RE);
  const body = extractBodyTag(text);

  return {
    hair: hair?.tag ?? null,
    hairLabel: hair?.label ?? null,
    eyes: eyes?.tag ?? null,
    eyesLabel: eyes?.label ?? null,
    body,
  };
}

/** 기존 DB 청크 — 런타임 CRITICAL 승격 (재저장 없이 적용) */
export function promoteAppearanceChunkImportance(chunks: CharacterChunk[]): CharacterChunk[] {
  return chunks.map((chunk) => {
    if (chunk.importance === "CRITICAL") return chunk;
    if (!hasAppearanceTraits(chunk.content)) return chunk;
    return { ...chunk, importance: "CRITICAL" };
  });
}

/** explicit cache — system_instruction 대신 contents tail에만 둘 때 system 본문에서 제거 */
export function stripVisualAnchorFromSystem(system: string, anchor: string | null | undefined): string {
  const trimmed = anchor?.trim();
  if (!trimmed) return system;
  const idx = system.lastIndexOf(trimmed);
  if (idx < 0) return system;
  return system.slice(0, idx).replace(/\n{3,}$/, "\n\n").trimEnd();
}

const PERSONA_APPEARANCE_RE = /(?:외형|외모)\s*[:：]\s*([^\n]+)/i;
const PERSONA_SCENT_RE = /체향\s*[:：]\s*([^\n]+)/i;

/** Body text may mention eyes without matching EYE_DEFS (e.g. 금안) — tail reminder only */
function inferEyeLabelFromBody(body: string | null): string | null {
  if (!body?.trim()) return null;
  if (/금안/i.test(body)) return "금안 (golden eyes)";
  if (/금빛\s*눈|황금\s*(?:눈|눈동자)|golden\s*eyes?/i.test(body)) {
    return "금색/황금 눈 (gold/amber)";
  }
  return null;
}

/** 유저 RP 캐릭터(페르소나) 외형·체향 — 매 턴 하단 리마인더용 */
export function buildUserPersonaAppearanceReminder(
  personaText: string,
  userName: string
): string | null {
  const text = personaText.trim();
  if (!text || !userName.trim()) return null;

  const appearance = text.match(PERSONA_APPEARANCE_RE)?.[1]?.trim();
  const scent = text.match(PERSONA_SCENT_RE)?.[1]?.trim();
  if (!appearance && !scent) return null;

  const lines = [
    `[USER CHARACTER — ${userName} appearance (immutable)]`,
    `This is the human player character, NOT the AI character you play.`,
  ];
  if (appearance) lines.push(`Look: ${appearance.slice(0, 240)}`);
  if (scent) lines.push(`Scent: ${scent.slice(0, 80)}`);
  lines.push(
    `When describing ${userName}, use ONLY these traits.`,
    `Do NOT swap ${userName}'s look/scent with NPCs or the AI character.`
  );
  return lines.join("\n");
}

/** 프롬프트 최하단 Visual Anchor — hair/eye only (no full body restatement) */
export function buildVisualAnchorReminder(policy: VisualAppearancePolicy): string | null {
  const eyesLabel = policy.eyesLabel ?? inferEyeLabelFromBody(policy.body);
  if (!policy.hairLabel && !eyesLabel) return null;

  const lines = [
    "[APPEARANCE LOCK — immutable traits from character setting]",
  ];

  if (policy.hairLabel) {
    lines.push(
      `Hair: ${policy.hairLabel}. NEVER write conflicting hair colors (e.g. no 금발/blonde if silver).`,
      `Uniform/coat color is NOT hair color — do not describe hair as the coat/uniform color (e.g. 검은색 제복 ≠ 검은 머리).`
    );
  }
  if (eyesLabel) {
    lines.push(
      `Eyes: ${eyesLabel}. NEVER write conflicting eye colors (e.g. no 푸른/blue if gold).`
    );
  }

  lines.push(
    "Ignore wrong hair/eye colors from prior chat — NPC drift errors.",
    "Do not invent colors not listed above."
  );

  return lines.join("\n");
}

type DriftRule = { wrong: RegExp; right: string };

const HAIR_DRIFT: Partial<Record<HairColorTag, DriftRule[]>> = {
  blonde: [
    { wrong: /은발/g, right: "금발" },
    { wrong: /(?:은|백)(?:색|빛)\s*머리/g, right: "금발" },
    { wrong: /검(?:은|정)\s*머리(?:카락)?/g, right: "금발" },
    { wrong: /흑발/g, right: "금발" },
    { wrong: /(?:silver|platinum)\s*hair/gi, right: "blonde hair" },
    { wrong: /(?:black|dark)\s*hair/gi, right: "blonde hair" },
    { wrong: /달(?:빛|빛에)\s*(?:비친|스민)?\s*은(?:빛|색)?\s*머리/g, right: "금발" },
  ],
  silver: [
    { wrong: /금발/g, right: "은발" },
    { wrong: /(?:gold|golden|blonde?)\s*hair/gi, right: "silver hair" },
    { wrong: /(?:밝은|연)?금(?:색|빛)\s*머리/g, right: "은발" },
  ],
  black: [
    { wrong: /금발/g, right: "흑발" },
    { wrong: /은발/g, right: "흑발" },
    { wrong: /(?:blonde?|silver)\s*hair/gi, right: "black hair" },
  ],
  blue: [
    { wrong: /금발/g, right: "푸른 머리" },
    { wrong: /(?:blonde?|silver)\s*hair/gi, right: "blue hair" },
  ],
};

const EYE_DRIFT: Partial<Record<EyeColorTag, DriftRule[]>> = {
  blue: [
    { wrong: /금(?:색|빛)\s*(?:눈|눈동자|홍책)/g, right: "푸른 눈" },
    { wrong: /(?:golden|amber)\s*eyes?/gi, right: "blue eyes" },
    { wrong: /금빛\s*눈동자/g, right: "푸른 눈동자" },
    { wrong: /황금(?:색|빛)\s*(?:눈|눈동자)/g, right: "푸른 눈" },
    { wrong: /(?:보라|자주|보랏)(?:색|빛)?\s*(?:눈|눈동자|홍책)/g, right: "푸른 눈" },
    { wrong: /(?:purple|violet)\s*eyes?/gi, right: "blue eyes" },
    { wrong: /보랏빛\s*눈동자/g, right: "푸른 눈동자" },
  ],
  gold: [
    { wrong: /(?:푸른|파란|하늘(?:색)?)\s*(?:눈|눈동자)/g, right: "금색 눈" },
    { wrong: /blue\s*eyes?/gi, right: "golden eyes" },
  ],
  green: [
    { wrong: /(?:푸른|파란)\s*(?:눈|눈동자)/g, right: "녹색 눈" },
    { wrong: /blue\s*eyes?/gi, right: "green eyes" },
  ],
  brown: [
    { wrong: /(?:푸른|파란)\s*(?:눈|눈동자)/g, right: "갈색 눈" },
    { wrong: /blue\s*eyes?/gi, right: "brown eyes" },
  ],
};

const HAIR_CONFLICT: Partial<Record<HairColorTag, RegExp>> = {
  blonde: /은발|(?:은|백)(?:색|빛)\s*머리|(?:silver|platinum)\s*hair/i,
  silver: /금발|(?:gold|golden|blonde?)\s*hair|(?:밝은|연)?금(?:색|빛)\s*머리/i,
  black: /금발|은발|(?:blonde?|silver|platinum)\s*hair/i,
  blue: /금발|은발|(?:blonde?|silver)\s*hair/i,
};

const EYE_CONFLICT: Partial<Record<EyeColorTag, RegExp>> = {
  blue: /금(?:색|빛)\s*(?:눈|눈동자)|(?:golden|amber)\s*eyes?|금빛\s*눈동자|황금(?:색|빛)\s*(?:눈|눈동자)|(?:보라|자주|보랏)(?:색|빛)?\s*(?:눈|눈동자)|(?:purple|violet)\s*eyes?|보랏빛\s*눈동자/i,
  gold: /(?:푸른|파란|하늘(?:색)?)\s*(?:눈|눈동자)|blue\s*eyes?/i,
  green: /(?:푸른|파란)\s*(?:눈|눈동자)|blue\s*eyes?/i,
  brown: /(?:푸른|파란)\s*(?:눈|눈동자)|blue\s*eyes?/i,
};

function applyDriftRules(text: string, rules: DriftRule[] | undefined): string {
  if (!rules?.length) return text;
  let out = text;
  for (const { wrong, right } of rules) {
    out = out.replace(wrong, right);
  }
  return out;
}

/** 설정 hair/eye 태그와 충돌하는 색상 표현이 있는지 (교정 전 검사) */
export function detectAppearancePolicyConflict(
  text: string,
  policy: VisualAppearancePolicy
): boolean {
  if (!text.trim() || (!policy.hair && !policy.eyes)) return false;
  const hairConflict = policy.hair ? HAIR_CONFLICT[policy.hair] : undefined;
  const eyeConflict = policy.eyes ? EYE_CONFLICT[policy.eyes] : undefined;
  if (hairConflict?.test(text)) return true;
  if (eyeConflict?.test(text)) return true;
  return false;
}

/** AI 출력 — 설정과 충돌하는 머리/눈 색상 교정 또는 문장 제거 */
export function sanitizeVisualAppearance(text: string, policy: VisualAppearancePolicy): string {
  if (!policy.hair && !policy.eyes) return text;

  const hairRules = policy.hair ? HAIR_DRIFT[policy.hair] : undefined;
  const eyeRules = policy.eyes ? EYE_DRIFT[policy.eyes] : undefined;
  const hairConflict = policy.hair ? HAIR_CONFLICT[policy.hair] : undefined;
  const eyeConflict = policy.eyes ? EYE_CONFLICT[policy.eyes] : undefined;

  if (!hairRules && !eyeRules) return text;

  /** HTML visual card — 태그·해시태그 포함 전역 치환 (문장 분리 시 누락 방지) */
  if (/<(?:div|section|p|span|h[1-6]|ul|li|html)\b|#(?:은|금|흑)발/i.test(text)) {
    let out = text;
    out = applyDriftRules(out, hairRules);
    out = applyDriftRules(out, eyeRules);
    return out;
  }

  const parts = text.split(/(?<=[.!?…])\s+|\n+/);
  const kept: string[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    let sentence = applyDriftRules(trimmed, hairRules);
    sentence = applyDriftRules(sentence, eyeRules);

    let drop = false;
    if (hairConflict?.test(sentence)) drop = true;
    if (eyeConflict?.test(sentence)) drop = true;

    if (!drop) kept.push(sentence);
  }

  if (kept.length === 0) return text;
  return kept.join("\n\n");
}

/** OOC HTML — 서버 lock/sanitize용 설정 외형 원문 (Flash 프롬프트에는 주입하지 않음) */
export function buildFlashCanonicalAppearanceBlock(
  chunks: CharacterChunk[],
  charName: string,
  _policy: VisualAppearancePolicy,
  opts?: { personaName?: string }
): string {
  const body = extractMainCharacterAppearanceBody(chunks, charName, opts);
  if (body) return `[외형 profile]\n${body}`;
  const appearanceLines = collectCharacterAppearanceText(chunks, charName, opts);
  if (appearanceLines) return `[외형 lines from setting]\n${appearanceLines}`;
  return "";
}
