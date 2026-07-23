import { detectCharStutter } from "@/lib/antiRepetition";
import { visibleAssistantMessageLength } from "@/lib/chatDisplayLength";
import { isDegenerateOutput } from "@/lib/gibberishGuard";
import {
  AUTO_REFUND_MIN_VISIBLE_CHARS,
} from "@/lib/reportRefundPolicy";

export type AutoRefundReason =
  | "under_length"
  | "garbage_output"
  | "char_stutter"
  | "repeated_block"
  | "api_error"
  | "duplicate_output"
  | "input_echo";

export type AutoRefundAssessment = {
  isError: boolean;
  reasons: AutoRefundReason[];
  summary: string;
};

function normalizeCompareText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isDuplicateAssistantOutput(
  content: string,
  previousAssistantContent: string | null | undefined
): boolean {
  if (!previousAssistantContent?.trim()) return false;
  const a = normalizeCompareText(content);
  const b = normalizeCompareText(previousAssistantContent);
  if (a.length < 60 || b.length < 60) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.88) return true;
  return false;
}

function isInputEcho(content: string, userMessage: string | null | undefined): boolean {
  if (!userMessage?.trim()) return false;
  const a = normalizeCompareText(content);
  const b = normalizeCompareText(userMessage);
  if (b.length < 40 || a.length < 40) return false;
  if (a === b) return true;
  if (a.startsWith(b) && b.length / a.length >= 0.75) return true;
  return false;
}

/**
 * Detect long-form loop degeneration where several sentences or paragraphs repeat as a block.
 * This complements char-stutter detection, which only catches short local repetition.
 */
export function hasRepeatedLongFormBlock(content: string): boolean {
  const normalized = content.trim();
  if (normalized.length < 2_400) return false;

  const units = normalized
    .split(/\n+|(?<=[.!?。？！])\s+/)
    .map(normalizeCompareText)
    .filter((unit) => unit.length >= 24);
  if (units.length < 8) return false;

  const counts = new Map<string, number>();
  for (const unit of units) counts.set(unit, (counts.get(unit) ?? 0) + 1);

  let repeatedUnitKinds = 0;
  let repeatedInstances = 0;
  let repeatedChars = 0;
  for (const [unit, count] of counts) {
    if (count < 3) continue;
    repeatedUnitKinds += 1;
    repeatedInstances += count - 1;
    repeatedChars += unit.length * (count - 1);
  }

  return (
    repeatedUnitKinds >= 2 &&
    repeatedInstances >= 4 &&
    repeatedChars >= 800 &&
    repeatedChars / normalized.length >= 0.22
  );
}

const REASON_LABELS: Record<AutoRefundReason, string> = {
  under_length: `${AUTO_REFUND_MIN_VISIBLE_CHARS}자 미달`,
  garbage_output: "비정상·퇴화 출력",
  char_stutter: "반복·조기 중단",
  repeated_block: "장문 반복 루프",
  api_error: "API 오류",
  duplicate_output: "직전 AI 답변과 중복",
  input_echo: "유저 입력 에코",
};

export function formatAutoRefundReasons(reasons: AutoRefundReason[]): string {
  return reasons.map((r) => REASON_LABELS[r]).join(", ");
}

/** 오류 신고 시 자동 환불 가능한 출력 결함인지 */
export function assessMessageForAutoRefund(input: {
  content: string;
  messageStatus?: string | null;
  previousAssistantContent?: string | null;
  userMessage?: string | null;
}): AutoRefundAssessment {
  const reasons: AutoRefundReason[] = [];
  const content = input.content.trim();

  if (input.messageStatus === "error") reasons.push("api_error");
  if (content && isDegenerateOutput(content)) reasons.push("garbage_output");
  if (content && detectCharStutter(content)) reasons.push("char_stutter");
  if (content && hasRepeatedLongFormBlock(content)) reasons.push("repeated_block");
  if (content && visibleAssistantMessageLength(content) < AUTO_REFUND_MIN_VISIBLE_CHARS) {
    reasons.push("under_length");
  }
  if (content && isDuplicateAssistantOutput(content, input.previousAssistantContent)) {
    reasons.push("duplicate_output");
  }
  if (content && isInputEcho(content, input.userMessage)) reasons.push("input_echo");

  const unique = [...new Set(reasons)];
  return {
    isError: unique.length > 0,
    reasons: unique,
    summary: unique.length > 0 ? formatAutoRefundReasons(unique) : "",
  };
}
