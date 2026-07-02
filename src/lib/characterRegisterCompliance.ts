/** Step 7.5 — measure dialogue register vs character-card expectation for a scene context. */

import { extractDialogueLines } from "@/lib/registerMetaAudit";

export type ExpectedRegister = "haeyo" | "formal" | "danakka" | "banmal";

const HAeyo_RE = /(?:해요|어요|아요|예요|세요|죠|네요|군요|래요|가요|까요|습니까\?)(?:[.!?…]|$)/;
const FORMAL_RE = /(?:습니다|십니다|합니다|입니다|그렇습니다)(?:[.!?…]|$)/;
const DANAKKA_RE = /(?:십시오|하십시오|하옵|하오|이옵|하였소|하리오)(?:[.!?…]|$)|(?:[가-힣]+(?:십시오|하십시오))(?:[.!?…]|$)/;
const BANMAL_RE = /(?:[^다]|^)(?:다|야|지|네|군|잖아|거야|냐|니|해|돼)(?:[.!?…]|$)/;

export function classifyLineRegister(line: string): ExpectedRegister | "other" {
  const t = line.trim();
  if (DANAKKA_RE.test(t)) return "danakka";
  if (FORMAL_RE.test(t)) return "formal";
  if (HAeyo_RE.test(t)) return "haeyo";
  if (BANMAL_RE.test(t)) return "banmal";
  return "other";
}

function matchesExpected(got: ExpectedRegister | "other", expected: ExpectedRegister): boolean {
  if (got === "other") return false;
  if (expected === "haeyo") return got === "haeyo";
  if (expected === "formal") return got === "formal" || got === "danakka";
  if (expected === "danakka") return got === "danakka" || got === "formal";
  if (expected === "banmal") return got === "banmal";
  return false;
}

export type RegisterComplianceResult = {
  dialogueCount: number;
  matchingCount: number;
  complianceRate: number;
  driftKinds: string[];
  sampleMisses: string[];
};

export function evaluateRegisterCompliance(
  text: string,
  expected: ExpectedRegister
): RegisterComplianceResult {
  const lines = extractDialogueLines(text);
  const kinds = new Set<string>();
  let matching = 0;
  const misses: string[] = [];

  for (const line of lines) {
    const reg = classifyLineRegister(line);
    if (reg !== "other") kinds.add(reg);
    if (matchesExpected(reg, expected)) matching++;
    else if (lines.length <= 12) misses.push(`[${reg}] ${line.slice(0, 72)}`);
  }

  const driftKinds = [...kinds].filter((k) => !matchesExpected(k as ExpectedRegister, expected));

  return {
    dialogueCount: lines.length,
    matchingCount: matching,
    complianceRate: lines.length ? Math.round((matching / lines.length) * 1000) / 10 : 0,
    driftKinds,
    sampleMisses: misses.slice(0, 4),
  };
}
