import { BILLING_BREAKDOWN_KEYWORD_LOREBOOK_LABEL } from "@/lib/billingReceiptAccess";
import type { PromptSectionCategory } from "@/services/promptAudit";

export const RECEIPT_ESTIMATED_ALLOCATION_METHOD = "estimated_section_allocation" as const;

/** Semantic scope for the character receipt row — matches charPromptEst in route.ts. */
export const CHARACTER_RECEIPT_CHAR_SCOPE =
  "characterSetting+worldLore+dialogueExamples" as const;

const CHARACTER_RECEIPT_ALLOCATION_CATEGORIES: readonly PromptSectionCategory[] = [
  "characterSetting",
  "worldLore",
  "dialogueExamples",
];

export type ReceiptSectionKey =
  | "raw"
  | "narrative"
  | "character"
  | "system"
  | "memory"
  | "persona"
  | "keyword"
  | "note"
  | "asset"
  | "rel";

export type ReceiptSectionEstimate = {
  key: ReceiptSectionKey;
  est: number;
};

export type ReceiptBreakdownEntry = {
  label: string;
  tokens: number;
  pct: number;
};

type TrackedSectionForChars = {
  id: string;
  category: PromptSectionCategory;
  text: string;
};

/** Sum assembled chars for the same categories used by charPromptEst token estimate. */
export function sumCharacterReceiptContextChars(
  sections: readonly TrackedSectionForChars[],
  opts?: { excludeKeywordLorebook?: boolean }
): number {
  return sections.reduce((sum, section) => {
    if (opts?.excludeKeywordLorebook && section.id === "keyword-lorebook") {
      return sum;
    }
    if (!CHARACTER_RECEIPT_ALLOCATION_CATEGORIES.includes(section.category)) {
      return sum;
    }
    return sum + section.text.length;
  }, 0);
}

function formatEstimatedAllocationTokens(tokens: number): string {
  return `~${tokens.toLocaleString()} 입력 토큰 추정 배분`;
}

export function buildEstimatedReceiptSectionBreakdown(opts: {
  sectionEsts: ReceiptSectionEstimate[];
  draftInput: number;
  /** Same semantic scope as charPromptEst; omit chars in label when null/0. */
  characterContextChars: number | null | undefined;
  rawHistoryChars: number;
  rawCompleteExchanges: number;
}): ReceiptBreakdownEntry[] {
  const totalEst = Math.max(1, opts.sectionEsts.reduce((s, x) => s + x.est, 0));
  const alloc = (est: number) => Math.round((est / totalEst) * opts.draftInput);
  const characterChars = opts.characterContextChars ?? 0;
  const showCharacterChars = characterChars > 0;

  return opts.sectionEsts
    .map((s) => {
      const tokens = alloc(s.est);
      let label: string;

      switch (s.key) {
        case "raw":
          label = `최근 RAW: ${formatEstimatedAllocationTokens(tokens)} · ${opts.rawHistoryChars.toLocaleString()} chars · ${opts.rawCompleteExchanges} exchanges`;
          break;
        case "narrative":
          label = `요약·내러티브: ${formatEstimatedAllocationTokens(tokens)}`;
          break;
        case "character":
          label = showCharacterChars
            ? `캐릭터 컨텍스트: ${formatEstimatedAllocationTokens(tokens)} · ${characterChars.toLocaleString()} chars`
            : `캐릭터 컨텍스트: ${formatEstimatedAllocationTokens(tokens)}`;
          break;
        case "system":
          label = `시스템 프롬프트: ${formatEstimatedAllocationTokens(tokens)}`;
          break;
        case "memory":
          label = `장기기억: ${formatEstimatedAllocationTokens(tokens)}`;
          break;
        case "persona":
          label = `페르소나: ${formatEstimatedAllocationTokens(tokens)}`;
          break;
        case "keyword":
          label = `${BILLING_BREAKDOWN_KEYWORD_LOREBOOK_LABEL}: ${formatEstimatedAllocationTokens(tokens)}`;
          break;
        case "note":
          label = `유저 노트: ${formatEstimatedAllocationTokens(tokens)}`;
          break;
        case "asset":
          label = `에셋 태그: ${formatEstimatedAllocationTokens(tokens)}`;
          break;
        default:
          label = `관계 메모: ${formatEstimatedAllocationTokens(tokens)}`;
      }
      return {
        label,
        tokens,
        pct: Math.round((s.est / totalEst) * 100),
      };
    })
    .filter((s) => s.tokens > 0);
}
