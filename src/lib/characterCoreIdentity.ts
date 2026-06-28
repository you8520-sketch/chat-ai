import type { CharacterChunk, ChunkCategory } from "@/types";
import { estimateTokens } from "@/lib/tokenEstimate";
import { parseCharacterSettingIntoSections } from "@/utils/characterParser";

/** 매 턴 코어 아이덴티티 토큰 상한 — 설정이 이보다 작으면 통째로 코어 */
export const CORE_IDENTITY_MAX_TOKENS = 3000;

/** 설정이 3K를 넘을 때 코어 목표 하한 */
export const CORE_IDENTITY_MIN_TOKENS = 2000;

/** @deprecated char budget — 테스트·하위 호환 */
export const SETTING_SOURCE_MIN_CHARS = 1500;
export const SETTING_SOURCE_MAX_CHARS = 10_000;
export const CORE_IDENTITY_MIN_CHARS = 1500;
export const CORE_IDENTITY_MAX_CHARS = 2500;

/** 자주 안 쓰는 설정 — RAG 후보 힌트 */
const RAG_HINT =
  /과거\s*사건|특수\s*기술|좋아하는\s*음식|복장|취미|숨겨진|세부\s*세계관|에피소드|잡\s*지식|사소한\s*버릇/i;

const RAG_SYSTEM_META =
  /시스템\s*명령|상태창\s*표시|배드\s*엔딩|해피\s*엔딩|D-Day|루프|조건\s*\d|📅|⏳|\[시스템/i;

const RAG_PLOT_SCAFFOLD = /{{user}}|회귀|빙의|소설\s*속|최애캐|교통사고/i;

const RAG_WORLD_ENCYCLOPEDIA =
  /(?:왕국|신성\s*제국|제국|대륙|나라)\]|(?:왕국|신성\s*제국)\s*$/im;

const RAG_NPC_BLOCK =
  /^\[(?:Enemy|NPC|Boss|Monster|몬스터|적|조연|보스)/im;

/** 설정 전체 토큰 수 */
export function estimateSettingTokens(settingText: string): number {
  return estimateTokens(settingText.trim());
}

/** 설정이 3K 이하면 통째로 코어 — 초과 시에만 2~3K 목표 */
export function resolveCoreIdentityTokenBudget(settingText: string): number {
  const trimmed = settingText.trim();
  if (!trimmed) return 0;

  const totalTokens = estimateSettingTokens(trimmed);
  if (totalTokens <= CORE_IDENTITY_MAX_TOKENS) return totalTokens;

  const maxSourceTokens = Math.ceil(SETTING_SOURCE_MAX_CHARS * 0.9);
  const overflow = totalTokens - CORE_IDENTITY_MAX_TOKENS;
  const span = Math.max(1, maxSourceTokens - CORE_IDENTITY_MAX_TOKENS);
  const ratio = Math.min(1, overflow / span);
  return Math.round(
    CORE_IDENTITY_MAX_TOKENS - ratio * (CORE_IDENTITY_MAX_TOKENS - CORE_IDENTITY_MIN_TOKENS)
  );
}

/** @deprecated — resolveCoreIdentityTokenBudget 사용 */
export function resolveCoreIdentityCharBudget(totalSettingChars: number): number {
  if (totalSettingChars <= 0) return 0;
  const tokenBudget = resolveCoreIdentityTokenBudget("x".repeat(totalSettingChars));
  return Math.ceil(tokenBudget / 0.9);
}

/**
 * 높을수록 자주 안 쓰는 설정 — 코어에서 빼 RAG로 보낼 후보.
 * (주요 설정을 골라 넣기 X → 덜 쓰는 설정을 골라 빼기 O)
 */
export function scoreSectionRagPriority(
  title: string,
  body: string,
  category: ChunkCategory
): number {
  const text = `${title}\n${body}`;
  let score = 0;

  if (RAG_SYSTEM_META.test(text)) score += 90;
  if (RAG_NPC_BLOCK.test(text)) score += 85;
  if (RAG_PLOT_SCAFFOLD.test(text)) score += 75;
  if (RAG_HINT.test(text)) score += 65;
  if (RAG_WORLD_ENCYCLOPEDIA.test(text) && body.length > 180) score += 60;
  if (category === "background") score += 45;
  if (category === "world" && body.length > 220) score += 50;
  if (category === "other" && body.length > 150) score += 35;

  if (/외형|외모/i.test(text)) score -= 80;
  if (/말투|어조|speech/i.test(text)) score -= 75;
  if (/이름|성명|성별|현재\s*신분|정체성/i.test(text)) score -= 80;
  if (/성격|personality/i.test(text) && body.length < 800) score -= 40;
  if (/관계|호칭/i.test(text) && body.length < 400) score -= 25;
  if (category === "identity" || category === "speech") score -= 30;
  if (category === "abilities" && /외형|외모/i.test(text)) score -= 70;

  return score;
}

export function scoreChunkRagPriority(chunk: CharacterChunk): number {
  const head = chunk.content.split(/\r?\n/)[0] ?? "";
  return scoreSectionRagPriority(head, chunk.content, chunk.category);
}

function detectSectionCategory(section: {
  title: string;
  body: string;
  hint?: ChunkCategory;
}): ChunkCategory {
  if (section.hint) return section.hint;
  const head = `${section.title}\n${section.body.slice(0, 200)}`;
  if (/이름|성명|정체성|성별/i.test(head)) return "identity";
  if (/말투|어조|대사|speech/i.test(head)) return "speech";
  if (/성격|personality/i.test(head)) return "personality";
  if (/관계|relationship/i.test(head)) return "relationships";
  if (/세계관|world/i.test(head)) return "world";
  if (/외형|외모|능력|스킬/i.test(head)) return "abilities";
  if (/과거|배경|background/i.test(head)) return "background";
  return "other";
}

function formatSection(title: string, body: string): string {
  const t = title.trim();
  const b = body.trim();
  if (!b) return "";
  if (!t || t.startsWith("§")) return b;
  if (b.startsWith(t)) return b;
  return `${t}\n${b}`;
}

function blockTokens(block: string): number {
  return estimateTokens(block);
}

type AnnotatedSection = {
  index: number;
  block: string;
  tokens: number;
  ragScore: number;
};

function annotateSections(combinedSetting: string): AnnotatedSection[] {
  const sections = parseCharacterSettingIntoSections(combinedSetting);
  return sections
    .map((section, index) => {
      const block = formatSection(section.title, section.body);
      if (!block) return null;
      const category = detectSectionCategory(section);
      return {
        index,
        block,
        tokens: blockTokens(block),
        ragScore: scoreSectionRagPriority(section.title, section.body, category),
      };
    })
    .filter((s): s is AnnotatedSection => s != null);
}

/** 3K 초과 시 RAG로 보낼 섹션 본문 (디버그·테스트용) */
export function selectRagSectionsFromSetting(combinedSetting: string): string[] {
  const trimmed = combinedSetting.trim();
  if (!trimmed) return [];
  if (estimateSettingTokens(trimmed) <= CORE_IDENTITY_MAX_TOKENS) return [];

  const budget = resolveCoreIdentityTokenBudget(trimmed);
  const annotated = annotateSections(trimmed);
  if (annotated.length === 0) return [];

  const sepTokens = estimateTokens("\n\n");
  const headerTokens = estimateTokens("[CORE IDENTITY]");
  let kept = [...annotated];
  let total =
    headerTokens +
    kept.reduce((sum, s, i) => sum + s.tokens + (i > 0 ? sepTokens : 0), 0);

  const removed: AnnotatedSection[] = [];
  while (total > budget && kept.length > 1) {
    kept.sort(
      (a, b) => b.ragScore - a.ragScore || b.tokens - a.tokens || a.index - b.index
    );
    const drop = kept.shift()!;
    removed.push(drop);
    kept.sort((a, b) => a.index - b.index);
    total =
      headerTokens +
      kept.reduce((sum, s, i) => sum + s.tokens + (i > 0 ? sepTokens : 0), 0);
  }

  return removed.map((s) => s.block);
}

/**
 * 매 턴 주입용 코어 아이덴티티.
 * - 설정 ≤ 3K tokens: 통째로 코어
 * - 설정 > 3K: 자주 안 쓰는 섹션부터 RAG로 빼고, 남은 것만 2~3K 코어
 */
export function buildCoreIdentityBlock(combinedSetting: string): string {
  const trimmed = combinedSetting.trim();
  if (!trimmed) return "";

  const totalTokens = estimateSettingTokens(trimmed);
  if (totalTokens <= CORE_IDENTITY_MAX_TOKENS) {
    return `[CORE IDENTITY]\n${trimmed}`;
  }

  const budget = resolveCoreIdentityTokenBudget(trimmed);
  const annotated = annotateSections(trimmed);
  if (annotated.length === 0) {
    const approxChars = Math.max(80, Math.floor(budget / 0.9));
    return `[CORE IDENTITY]\n${trimmed.slice(0, approxChars)}`;
  }

  const sepTokens = estimateTokens("\n\n");
  const headerTokens = estimateTokens("[CORE IDENTITY]");
  let kept = [...annotated];
  let total =
    headerTokens +
    kept.reduce((sum, s, i) => sum + s.tokens + (i > 0 ? sepTokens : 0), 0);

  while (total > budget && kept.length > 1) {
    kept.sort(
      (a, b) => b.ragScore - a.ragScore || b.tokens - a.tokens || a.index - b.index
    );
    kept.shift();
    kept.sort((a, b) => a.index - b.index);
    total =
      headerTokens +
      kept.reduce((sum, s, i) => sum + s.tokens + (i > 0 ? sepTokens : 0), 0);
  }

  if (kept.length === 0) {
    const approxChars = Math.max(80, Math.floor(budget / 0.9));
    return `[CORE IDENTITY]\n${trimmed.slice(0, approxChars)}`;
  }

  return `[CORE IDENTITY]\n${kept.map((s) => s.block).join("\n\n")}`;
}

/** RAG 풀 — CRITICAL 제외 + 자주 안 쓰는 설정 청크 우선 */
export function filterCharacterChunksForRag(chunks: CharacterChunk[]): CharacterChunk[] {
  return chunks.filter((c) => {
    if (c.importance === "CRITICAL") return false;
    if (c.importance === "SUPPLEMENTAL") return true;
    if (scoreChunkRagPriority(c) >= 40) return true;
    return c.importance === "CONTEXTUAL";
  });
}
