import type { DialogueTurn } from "@/lib/hybridMemory";
import { classifyChatOocIntent } from "@/lib/chatOocPriority";

/** RP와 무관한 OOC 턴(HTML/SNS mock·RP 중단 등) — 장기기억 히스토리에서 제외 */
export function isTurnEligibleForMemoryRecord(userMessage: string): boolean {
  return classifyChatOocIntent(userMessage) !== "rp_unrelated";
}

export function filterTurnsForMemorySummary(
  turns: DialogueTurn[]
): DialogueTurn[] {
  return turns.filter((t) => isTurnEligibleForMemoryRecord(t.user));
}

const OOC_PAREN_RE = /[\(（]\s*OOC\s*[:\：][^)）]*[\)）]/gi;
const OOC_BRACKET_RE = /\[\[\s*OOC\s*[:\：][^\]]*\]\]/gi;

/** 요약 본문에서 OOC 메타·UI 연출 서술 제거 */
export function stripOocFromMemorySummary(text: string, arrowSep = " → "): string {
  let cleaned = text.trim();
  if (!cleaned) return "";

  cleaned = cleaned.replace(OOC_PAREN_RE, " ");
  cleaned = cleaned.replace(OOC_BRACKET_RE, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(/(?:\s*→\s*)+/g, arrowSep).trim();

  if (!cleaned.includes(arrowSep)) {
    const single = isOocMetaSummarySegment(cleaned) ? "" : cleaned;
    return normalizeArrowSep(single, arrowSep);
  }

  const segments = cleaned
    .split(arrowSep)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !isOocMetaSummarySegment(s));

  return normalizeArrowSep(segments.join(arrowSep), arrowSep);
}

function normalizeArrowSep(text: string, arrowSep: string): string {
  if (!text) return "";
  return text
    .split(arrowSep)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(arrowSep)
    .trim();
}

function isOocMetaSummarySegment(segment: string): boolean {
  if (/OOC\s*[:\：]/i.test(segment)) return true;
  if (/롤플레잉\s*중단|RP\s*중(?:단|지)|서사\s*중단/i.test(segment)) return true;
  if (
    /트위터|twitter|익명\s*메(?:시지|일)|메시지\s*함|sns\s*ui|카톡\s*ui|dm\s*ui|mockup|목업/i.test(
      segment
    )
  ) {
    return true;
  }
  if (
    /HTML\s*(?:형식|UI|로)|UI\s*(?:구현|연출|형식)|코드\s*블(?:록|럭)/i.test(segment) &&
    /(?:제시|표시|구현|연출|출력|띄)/i.test(segment)
  ) {
    return true;
  }
  return false;
}
