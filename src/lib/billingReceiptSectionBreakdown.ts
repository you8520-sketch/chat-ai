import { BILLING_BREAKDOWN_KEYWORD_LOREBOOK_LABEL } from "@/lib/billingReceiptAccess";

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

export type OpenRouterSystemSplitChars = {
  characterSettingsBlock: string;
  systemRulesBlock: string;
  dynamicBlock: string;
};

export type ReceiptBreakdownEntry = {
  label: string;
  tokens: number;
  pct: number;
};

export function buildEstimatedReceiptSectionBreakdown(opts: {
  sectionEsts: ReceiptSectionEstimate[];
  draftInput: number;
  splitChars: OpenRouterSystemSplitChars | null | undefined;
  charPromptEst: number;
  rawHistoryChars: number;
  rawCompleteExchanges: number;
}): ReceiptBreakdownEntry[] {
  const splitChars = opts.splitChars;
  const totalEst = Math.max(1, opts.sectionEsts.reduce((s, x) => s + x.est, 0));
  const alloc = (est: number) => Math.round((est / totalEst) * opts.draftInput);

  return opts.sectionEsts
    .map((s) => {
      const tokens = alloc(s.est);
      let label: string;
      switch (s.key) {
        case "raw":
          label = `최근 RAW: ~${tokens.toLocaleString()} 토큰 배분 · ${opts.rawHistoryChars.toLocaleString()} chars · ${opts.rawCompleteExchanges} exchanges`;
          break;
        case "narrative":
          label = `요약·내러티브: ~${tokens.toLocaleString()} 토큰 배분`;
          break;
        case "character":
          label = `캐릭터 프롬프트: ~${tokens.toLocaleString()} 토큰 배분 · ${(splitChars?.characterSettingsBlock.length ?? opts.charPromptEst).toLocaleString()} chars`;
          break;
        case "system":
          label = `시스템 프롬프트: ~${tokens.toLocaleString()} 토큰 배분`;
          break;
        case "memory":
          label = `장기기억: ~${tokens.toLocaleString()} 토큰 배분`;
          break;
        case "persona":
          label = `페르소나: ~${tokens.toLocaleString()} 토큰 배분`;
          break;
        case "keyword":
          label = `${BILLING_BREAKDOWN_KEYWORD_LOREBOOK_LABEL}: ~${tokens.toLocaleString()} 토큰 배분`;
          break;
        case "note":
          label = `유저 노트: ~${tokens.toLocaleString()} 토큰 배분`;
          break;
        case "asset":
          label = `에셋 태그: ~${tokens.toLocaleString()} 토큰 배분`;
          break;
        default:
          label = `관계 메모: ~${tokens.toLocaleString()} 토큰 배분`;
      }
      return {
        label,
        tokens,
        pct: Math.round((s.est / totalEst) * 100),
      };
    })
    .filter((s) => s.tokens > 0);
}
