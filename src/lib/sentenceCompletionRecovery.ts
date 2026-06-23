import { endsAtCompleteSentence, endsIncomplete } from "@/lib/responseLength";
import { splitChatRichBlocks, type ChatRichBlock } from "@/lib/chatRichContent";
import { stripBrokenHtmlTailSafely } from "@/lib/htmlTailStrip";

export type SentenceCompletionRecoveryResult = {
  text: string;
  recovered: boolean;
  /** @internal tests */
  actions: string[];
};

const CLOSING_QUOTE: Record<string, string> = {
  '"': '"',
  "\u201C": "\u201D",
  "'": "'",
  "\u2018": "\u2019",
  "「": "」",
  "『": "』",
  "(": ")",
  "[": "]",
};

/** 미완성 서술·대사 tail — API 재호출 없이 최소 suffix만 허용 */
const TRUNCATED_PAST_FINAL_SYLLABLE_RE =
  /(?:[았었였]|[췸췄봤갔났왔줬렸섰켰웠팠떴겼썼놨셨졌맡깠닿])$/u;

function lastHangulWord(text: string): string {
  return text.trimEnd().match(/[가-힣]+$/)?.[0] ?? "";
}

function endsWithTruncatedPastPredicate(text: string): boolean {
  const word = lastHangulWord(text);
  if (word.length < 2) return false;
  return TRUNCATED_PAST_FINAL_SYLLABLE_RE.test(word);
}

function trailingWhitespace(original: string): string {
  const trimmedLen = original.trimEnd().length;
  return original.slice(trimmedLen);
}

function closeUnclosedDelimiters(text: string): { text: string; closed: string[] } {
  const stack: string[] = [];
  let inAsciiDouble = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      inAsciiDouble = !inAsciiDouble;
      continue;
    }
    if (inAsciiDouble) continue;

    if (ch in CLOSING_QUOTE) {
      stack.push(ch);
      continue;
    }
    const opener = Object.entries(CLOSING_QUOTE).find(([, close]) => close === ch)?.[0];
    if (opener && stack[stack.length - 1] === opener) {
      stack.pop();
    }
  }

  let out = text;
  const closed: string[] = [];
  if (inAsciiDouble) {
    out += '"';
    closed.push('"');
  }
  while (stack.length > 0) {
    const open = stack.pop()!;
    const close = CLOSING_QUOTE[open];
    if (!close) continue;
    out += close;
    closed.push(close);
  }
  return { text: out, closed };
}


/** @deprecated stripBrokenHtmlTailSafely 사용 */
export function stripBrokenHtmlTailForRecovery(text: string): {
  text: string;
  stripped: boolean;
} {
  return stripBrokenHtmlTailSafely(text);
}

/** 동사·형용사 어간 + ㅆ/었 계열로 끊긴 경우 — 「다.」만 붙임 */
export function isRecoverablePredicateTruncation(text: string): boolean {
  const t = text.trimEnd();
  if (!t || !endsIncomplete(t)) return false;
  if (/다["'」』)]*$/.test(t)) return false;
  return endsWithTruncatedPastPredicate(t);
}

export function isEligibleForSentenceCompletionRecovery(text: string): boolean {
  const t = text.trimEnd();
  if (!t) return false;
  if (endsAtCompleteSentence(t)) return false;
  if (!endsIncomplete(t)) return false;
  if (isRecoverablePredicateTruncation(t)) return true;
  const { closed } = closeUnclosedDelimiters(t);
  if (closed.length > 0) return true;
  if (/[,;:—–-]$/.test(t)) return false;
  if (/[을를이가은는와과의에로]$/.test(t)) return false;
  return false;
}

/**
 * 스트림 truncation 등으로 끊긴 마지막 문장을 최소 수정으로 마무리.
 * 새 행동·대사·문단 추가 없음 — suffix/닫는 부호만.
 */
export function recoverSentenceCompletion(text: string): SentenceCompletionRecoveryResult {
  const htmlGuard = stripBrokenHtmlTailSafely(text);
  if (htmlGuard.stripped) {
    return {
      text: htmlGuard.text,
      recovered: true,
      actions: ["strip:broken-html-fragment"],
    };
  }

  const suffix = trailingWhitespace(text);
  const core = text.trimEnd();
  if (!core) return { text, recovered: false, actions: [] };

  if (endsAtCompleteSentence(core)) {
    return { text, recovered: false, actions: [] };
  }

  const actions: string[] = [];
  let out = core;

  const quoteFix = closeUnclosedDelimiters(out);
  if (quoteFix.text !== out) {
    out = quoteFix.text;
    actions.push(`close:${quoteFix.closed.join("")}`);
  }

  if (!endsAtCompleteSentence(out) && isRecoverablePredicateTruncation(out)) {
    out = `${out}다.`;
    actions.push("predicate:다.");
  }

  if (actions.length === 0) {
    return { text, recovered: false, actions: [] };
  }

  if (!endsAtCompleteSentence(out) && endsIncomplete(out)) {
    return { text, recovered: false, actions: [] };
  }

  return { text: out + suffix, recovered: true, actions };
}

function richBlockToText(block: ChatRichBlock): string {
  if (block.kind === "html") return `\`\`\`html\n${block.text}\n\`\`\``;
  return block.text;
}

/** HTML·표 블록은 유지하고 novel prose tail만 복구 */
export function recoverSentenceCompletionInFullResponse(
  text: string
): SentenceCompletionRecoveryResult {
  if (/```html/i.test(text)) {
    const htmlGuard = stripBrokenHtmlTailSafely(text);
    if (htmlGuard.stripped) {
      return {
        text: htmlGuard.text,
        recovered: true,
        actions: ["strip:broken-html-fragment"],
      };
    }
    return { text, recovered: false, actions: [] };
  }

  const htmlGuard = stripBrokenHtmlTailSafely(text);
  if (htmlGuard.stripped) {
    return {
      text: htmlGuard.text,
      recovered: true,
      actions: ["strip:broken-html-fragment"],
    };
  }

  const blocks = splitChatRichBlocks(text);
  const actions: string[] = [];
  let recovered = false;

  const next = blocks.map((block) => {
    if (block.kind !== "novel") return block;
    const result = recoverSentenceCompletion(block.text);
    if (!result.recovered) return block;
    recovered = true;
    actions.push(...result.actions);
    return { kind: "novel" as const, text: result.text };
  });

  if (!recovered) return { text, recovered: false, actions: [] };
  return {
    text: next.map(richBlockToText).join("\n\n"),
    recovered: true,
    actions,
  };
}
