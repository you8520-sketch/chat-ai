import { estimateTokens } from "@/lib/tokenEstimate";
import { hasAppearanceTraits } from "@/lib/visualAnchor";
import {
  extractRoleplayNameFromSettingText,
  looksLikeDisplayTitle,
} from "@/lib/relationshipMetaCharacterName";
import type {
  CharacterChunk,
  CharacterSettingInput,
  ChunkCategory,
  ChunkImportance,
} from "@/types";

const HEADER_PATTERNS: { re: RegExp; category: ChunkCategory }[] = [
  { re: /^(?:#{1,3}\s*)?(?:이름|성명|캐릭터\s*명|정체성|identity)/i, category: "identity" },
  { re: /^(?:#{1,3}\s*)?(?:성격|personality|성향|기질)/i, category: "personality" },
  { re: /^(?:#{1,3}\s*)?(?:말투|어조|대사|speech|말\s*버릇|호칭|금지\s*말투)/i, category: "speech" },
  { re: /^(?:#{1,3}\s*)?(?:배경|과거|서사|background|history|생애)/i, category: "background" },
  { re: /^(?:#{1,3}\s*)?(?:관계|인간관계|relationship|가족|친구|연인)/i, category: "relationships" },
  { re: /^(?:#{1,3}\s*)?(?:능력|스킬|외형|외모|abilities|skill|외모\s*묘사)/i, category: "abilities" },
  { re: /^(?:#{1,3}\s*)?(?:세계관|world|설정|배경\s*설정|시대|무대)/i, category: "world" },
];

const CATEGORY_KEYWORDS: Record<ChunkCategory, string[]> = {
  identity: ["이름", "나이", "성별", "직업", "신분", "종족", "호칭", "본명", "별명"],
  personality: ["성격", "성향", "기질", "성격적", "내향", "외향", "냉정", "온화", "츤데레", "얀데레"],
  speech: ["말투", "어조", "말버릇", "종결", "존댓말", "반말", "유저:", "캐릭터:", "대사", "성격", "특징", "금지"],
  background: ["과거", "배경", "어린", "성장", "사건", "트라우마", "기원", "출신"],
  relationships: ["관계", "가족", "친구", "연인", "라이벌", "스승", "부모", "형제", "연애"],
  abilities: ["능력", "스킬", "마법", "무기", "외형", "외모", "키", "눈", "머리", "피부"],
  world: ["세계", "시대", "국가", "도시", "마을", "규칙", "설정", "아포칼립스"],
  other: [],
};

const CRITICAL_CATEGORIES = new Set<ChunkCategory>(["identity", "speech"]);
const CONTEXTUAL_CATEGORIES = new Set<ChunkCategory>([
  "personality",
  "background",
  "relationships",
  "abilities",
  "world",
]);
const SUPPLEMENTAL_HINTS =
  /사소|버릇|취미|좋아하는\s*음식|싫어하는|작은\s*습관|에피소드|잡\s*지식/i;

function normalizeLine(line: string): string {
  return line.replace(/^[\s#*\-•【】\[\]「」]+/, "").trim();
}

/** `[외형]` → `[외형]` · `레온의 말투]` / `Name]` → `[레온의 말투]` / `[Name]` */
function formatSectionTitle(label: string): string {
  const t = label.trim();
  if (!t) return "";
  if (t.startsWith("[")) return t;
  return `[${t}]`;
}

function parseTrailingBracketHeader(line: string): { label: string } | null {
  if (line.includes("[")) return null;
  const m = line.match(/^([^[\]\n]{1,64})\]$/);
  if (!m?.[1]) return null;
  return { label: m[1].trim() };
}

function detectCategory(text: string, hinted?: ChunkCategory): ChunkCategory {
  if (hinted) return hinted;
  const head = text.slice(0, 120);
  for (const { re, category } of HEADER_PATTERNS) {
    if (re.test(head)) return category;
  }
  let best: ChunkCategory = "other";
  let bestScore = 0;
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS) as [ChunkCategory, string[]][]) {
    let score = 0;
    for (const w of words) {
      if (new RegExp(w, "i").test(text)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  }
  return best;
}

function classifyImportance(category: ChunkCategory, content: string): ChunkImportance {
  if (CRITICAL_CATEGORIES.has(category)) return "CRITICAL";
  if (hasAppearanceTraits(content)) return "CRITICAL";
  if (SUPPLEMENTAL_HINTS.test(content)) return "SUPPLEMENTAL";
  if (CONTEXTUAL_CATEGORIES.has(category)) return "CONTEXTUAL";
  if (category === "other" && content.length < 120) return "SUPPLEMENTAL";
  return "CONTEXTUAL";
}

function extractKeywords(content: string, category: ChunkCategory): string[] {
  const words = new Set<string>();
  for (const w of CATEGORY_KEYWORDS[category]) {
    if (new RegExp(w, "i").test(content)) words.add(w.replace(/\\s/g, ""));
  }
  const tokens = content.match(/[\uAC00-\uD7A3]{2,}|[A-Za-z]{3,}/g) ?? [];
  for (const t of tokens.slice(0, 24)) {
    if (t.length >= 2) words.add(t.toLowerCase());
  }
  return [...words].slice(0, 20);
}

function resolveHeaderCategory(label: string): ChunkCategory | undefined {
  if (/세계관|world/i.test(label)) return "world";
  if (/예시\s*대화|speech|dialog/i.test(label)) return "speech";
  for (const { re, category } of HEADER_PATTERNS) {
    if (re.test(label)) return category;
  }
  return undefined;
}

/** `[외형] 본문...` 같이 같은 줄에 내용이 붙은 대괄호 헤더 */
function parseInlineBracketHeader(line: string): { label: string; body: string } | null {
  const m = line.match(/^\[([^\]\n]{1,64})\]\s+(\S.+)$/);
  if (!m?.[1]) return null;
  return { label: m[1].trim(), body: (m[2] ?? "").trim() };
}

const INLINE_SECTION_LABEL_RE =
  /^(?:이름|성명|현재\s*신분|외형|외모|성격|성향|말투|배경|과거|관계|능력|세계관|상태창|시스템|피의\s*저주|name|identity|personality|system\s*command)/i;

function isInlineSectionLabel(label: string): boolean {
  if (INLINE_SECTION_LABEL_RE.test(label)) return true;
  if (/말투|speech|어조/i.test(label)) return true;
  if (resolveHeaderCategory(label)) return true;
  return detectCategory(label) !== "other";
}

function splitIntoSections(combined: string): { title: string; body: string; hint?: ChunkCategory }[] {
  const lines = combined.split(/\r?\n/);
  const sections: { title: string; body: string; hint?: ChunkCategory }[] = [];
  let currentTitle = "";
  let currentLines: string[] = [];
  let currentHint: ChunkCategory | undefined;

  const flush = () => {
    const body = currentLines.join("\n").trim();
    if (body) sections.push({ title: currentTitle, body, hint: currentHint });
    currentLines = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (currentLines.length > 0) currentLines.push("");
      continue;
    }

    const inlineBracket = parseInlineBracketHeader(line);
    if (inlineBracket && isInlineSectionLabel(inlineBracket.label)) {
      flush();
      currentTitle = formatSectionTitle(inlineBracket.label);
      currentHint =
        resolveHeaderCategory(inlineBracket.label) ??
        detectCategory(inlineBracket.label);
      currentLines.push(inlineBracket.body);
      continue;
    }

    const trailingBracket = parseTrailingBracketHeader(line);
    if (trailingBracket && isInlineSectionLabel(trailingBracket.label)) {
      flush();
      currentTitle = formatSectionTitle(trailingBracket.label);
      currentHint =
        resolveHeaderCategory(trailingBracket.label) ??
        detectCategory(trailingBracket.label);
      continue;
    }

    const headerMatch =
      line.match(/^#{1,3}\s+(.+)$/) ||
      line.match(/^【(.+?)】$/) ||
      line.match(/^\[(.+?)\]$/);

    let headerCategory: ChunkCategory | undefined;
    let headerLabel: string | undefined;
    if (headerMatch) {
      headerLabel = headerMatch[1] ?? line;
      headerCategory = resolveHeaderCategory(headerLabel);
    }

    if (headerMatch || HEADER_PATTERNS.some(({ re }) => re.test(normalizeLine(line)))) {
      flush();
      currentTitle = headerLabel
        ? formatSectionTitle(headerLabel)
        : normalizeLine(line);
      currentHint = headerCategory ?? detectCategory(currentTitle);
      continue;
    }

    currentLines.push(raw);
  }
  flush();

  if (sections.length === 0 && combined.trim()) {
    return splitByParagraphs(combined);
  }
  if (sections.length === 1 && sections[0].body.length > 2500) {
    return splitByParagraphs(sections[0].body);
  }
  return sections;
}

function splitByParagraphs(text: string): { title: string; body: string; hint?: ChunkCategory }[] {
  const parts = text.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  return parts.map((body, i) => ({ title: `§${i + 1}`, body }));
}

function makeChunkId(characterId: string, index: number): string {
  return `${characterId}-chunk-${index}`;
}

function sectionToChunk(
  characterId: string,
  index: number,
  section: { title: string; body: string; hint?: ChunkCategory },
  forceCategory?: ChunkCategory
): CharacterChunk {
  const content =
    section.title && section.title !== `§${index + 1}`
      ? `${section.title}\n${section.body}`.trim()
      : section.body.trim();
  const category = forceCategory ?? detectCategory(content, section.hint);
  const importance = classifyImportance(category, content);
  return {
    id: makeChunkId(characterId, index),
    characterId,
    content,
    category,
    importance,
    tokenCount: estimateTokens(content),
    keywords: extractKeywords(content, category),
  };
}

/** RP에 넣을 설정 원문 (이름·성별·세계관·system_prompt·예시대화) */
export function buildCombinedCharacterSettingSource(input: CharacterSettingInput): string {
  const { systemPrompt, world = "", exampleDialog = "", characterName, gender } = input;

  const parts: string[] = [];
  const rpName = extractRoleplayNameFromSettingText(systemPrompt);
  if (rpName) {
    parts.push(`[이름]\n${rpName}`);
  } else if (characterName?.trim() && !looksLikeDisplayTitle(characterName.trim())) {
    parts.push(`[이름]\n${characterName.trim()}`);
  }
  if (gender && gender !== "other") {
    const genderLabel = gender === "male" ? "남성" : gender === "female" ? "여성" : String(gender);
    parts.push(`[정체성]\n성별: ${genderLabel}`);
  }
  if (world.trim()) parts.push(`[세계관]\n${world.trim()}`);
  if (systemPrompt.trim()) parts.push(systemPrompt.trim());
  if (exampleDialog.trim()) parts.push(`[예시 대화]\n${exampleDialog.trim()}`);

  return parts.join("\n\n").slice(0, 10_000).trim();
}

function buildFullSettingChunk(characterId: string, combined: string): CharacterChunk {
  const content = combined.trim();
  return {
    id: `${characterId}-chunk-full`,
    characterId,
    content,
    category: "identity",
    importance: "CRITICAL",
    tokenCount: estimateTokens(content),
    keywords: extractKeywords(content, "identity"),
  };
}

/** 10,000자 설정 — 섹션 분할 후 importance 분류 (코어/RAG 분리) */
export function parseCharacterSetting(input: CharacterSettingInput): CharacterChunk[] {
  const combined = buildCombinedCharacterSettingSource(input);
  if (!combined) return [];

  const sections = splitIntoSections(combined);
  if (sections.length <= 1 && combined.length <= 2500) {
    return [buildFullSettingChunk(input.characterId, combined)];
  }

  let chunks = sections.map((section, index) =>
    sectionToChunk(input.characterId, index, section)
  );
  chunks = mergeTinyChunks(chunks, input.characterId);
  return chunks;
}

/** 코어 아이덴티티 빌더용 — 설정 원문 섹션 분할 */
export { parseCharacterSettingIntoSections } from "@/lib/characterSettingSections";

function mergeTinyChunks(chunks: CharacterChunk[], characterId: string): CharacterChunk[] {
  if (chunks.length <= 1) return chunks;
  const merged: CharacterChunk[] = [];
  let buffer: CharacterChunk | null = null;

  for (const c of chunks) {
    if (c.content.length < 40 && c.importance !== "CRITICAL") {
      if (buffer) {
        const prev: CharacterChunk = buffer;
        const mergedContent = `${prev.content}\n${c.content}`;
        buffer = {
          ...prev,
          content: mergedContent,
          tokenCount: estimateTokens(mergedContent),
          keywords: [...new Set([...prev.keywords, ...c.keywords])],
        };
      } else {
        buffer = { ...c };
      }
    } else {
      if (buffer) {
        merged.push(buffer);
        buffer = null;
      }
      merged.push(c);
    }
  }
  if (buffer) merged.push(buffer);

  return merged.map((c, i) => ({ ...c, id: makeChunkId(characterId, i) }));
}

export function serializeCharacterChunks(chunks: CharacterChunk[]): string {
  return JSON.stringify(chunks);
}

export function deserializeCharacterChunks(raw: string | null | undefined): CharacterChunk[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as CharacterChunk[];
    return Array.isArray(parsed) ? parsed.filter((c) => c?.content?.trim()) : [];
  } catch {
    return [];
  }
}
