import type { ChatMsg } from "@/lib/ai";
import { isContinueUserMessage } from "@/lib/continueNarrative";
import { visibleAssistantDisplayCharCount } from "@/lib/chatDisplayLength";

const AUTO_CONTINUE_DIRECTIVE_PREFIX = "[SYSTEM DIRECTIVE: CONTINUE THE NARRATIVE]";

/** Auto-continue / system wrapper — not a user RP line to echo-check. */
export function isAutoContinueDirectiveMessage(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (isContinueUserMessage(trimmed)) return true;
  return trimmed.startsWith(AUTO_CONTINUE_DIRECTIVE_PREFIX);
}

/** Last user message in history (any). */
export function lastUserMessageFromHistory(history: ChatMsg[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg?.role === "user") return msg.content;
  }
  return "";
}

/** Last real RP user line — skips auto-continue directive wrappers. */
export function lastRpUserMessageFromHistory(history: ChatMsg[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg?.role !== "user") continue;
    if (isAutoContinueDirectiveMessage(msg.content)) continue;
    return msg.content;
  }
  return null;
}

/** Dev log preview — quoted speech + *action* blocks + plain prose fragments. */
export function extractKeyPhrases(userMessage: string): string[] {
  const phrases: string[] = [];
  const quoted = userMessage.match(/[""「『][^""」』\n]{4,}[""」』]/g) ?? [];
  for (const q of quoted) {
    const inner = q.slice(1, -1).trim();
    if (inner.length >= 4) phrases.push(inner);
  }

  const actions = userMessage.match(/\*[^*\n]+\*/g) ?? [];
  for (const a of actions) {
    const inner = a.slice(1, -1).trim();
    if (inner.length >= 4) phrases.push(inner);
  }

  const stripped = userMessage
    .replace(/\*[^*]+\*/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length >= 6 && !phrases.includes(stripped)) {
    phrases.push(stripped.slice(0, 120));
  }

  return [...new Set(phrases)].slice(0, 12);
}

/** Plain speech fragments split on ellipsis / sentence breaks (outside *actions*). */
function extractPlainSpeechFragments(userMessage: string): string[] {
  const withoutActions = userMessage.replace(/\*[^*]+\*/g, " ");
  return withoutActions
    .split(/[.…?!]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
}

const ECHO_INDIRECT_PATTERNS = [
  /(?:라는|이라는)\s*말(?:이|을)/,
  /그\s*말(?:이|을)?[^.\n]{0,24}(?:맴돌|울렸|새|들)/,
  /(?:귓가|귓속)(?:에|에서)\s*(?:닿|들|울)/,
];

/** Punctuation/whitespace-insensitive core text for echo overlap. */
export function normalizeForEchoCheck(text: string): string {
  return text
    .replace(/\*[^*]+\*/g, " ")
    .replace(/[""「『」』]/g, "")
    .replace(/[?!.…~,]+/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

function actionSubstringHit(actionNorm: string, openingNorm: string, minLen = 4): boolean {
  if (!actionNorm || !openingNorm) return false;
  if (actionNorm.length < minLen) return openingNorm.includes(actionNorm);
  for (let len = Math.min(16, actionNorm.length); len >= minLen; len--) {
    for (let i = 0; i <= actionNorm.length - len; i++) {
      if (openingNorm.includes(actionNorm.slice(i, i + len))) return true;
    }
  }
  return false;
}

function countActionKeywordHits(userMessage: string, openingNorm: string): number {
  let hits = 0;
  const actionSources =
    userMessage.match(/\*[^*\n]+\*/g)?.map((a) => a.slice(1, -1).trim()) ?? [];
  for (const source of actionSources) {
    const norm = normalizeForEchoCheck(source);
    if (norm.length >= 2 && actionSubstringHit(norm, openingNorm, 2)) hits += 1;
  }
  return hits;
}

/** True when model output repeats user phrases or uses indirect echo patterns early. */
export function checkPhraseOverlap(userMessage: string, modelOutput: string): boolean {
  const userNorm = normalizeForEchoCheck(userMessage);
  const outNorm = normalizeForEchoCheck(modelOutput);
  if (!userNorm || !outNorm) return false;

  const opening = outNorm.slice(0, Math.min(600, outNorm.length));
  for (const phrase of extractKeyPhrases(userMessage)) {
    const p = normalizeForEchoCheck(phrase);
    if (p.length >= 4 && opening.includes(p)) return true;
  }

  for (const fragment of extractPlainSpeechFragments(userMessage)) {
    const p = normalizeForEchoCheck(fragment);
    if (p.length >= 4 && opening.includes(p)) return true;
  }

  if (userNorm.length >= 6) {
    const probe = userNorm.slice(0, Math.min(40, userNorm.length));
    if (opening.includes(probe)) return true;
  }

  // [B] *action* replay — opening re-narrates user's typed gestures
  if (countActionKeywordHits(userMessage, opening) >= 1) return true;

  const openingRaw = modelOutput.slice(0, 400);
  return ECHO_INDIRECT_PATTERNS.some((re) => re.test(openingRaw));
}

export function logInputEchoCheck(userMessage: string, modelOutput: string): void {
  const echoed = checkPhraseOverlap(userMessage, modelOutput);
  console.log("[input-echo-check]", {
    user_input_words: extractKeyPhrases(userMessage),
    echoed_in_output: echoed,
    output_opening_chars: visibleAssistantDisplayCharCount(modelOutput.slice(0, 400)),
  });
}

/** Echo check for assembled turn — skips auto-continue (no new user input). */
export function logInputEchoCheckForTurn(history: ChatMsg[], modelOutput: string): void {
  const currentUser = lastUserMessageFromHistory(history);
  if (currentUser && isAutoContinueDirectiveMessage(currentUser)) {
    console.log("[input-echo-check]", {
      skipped: "auto_continue",
      echoed_in_output: null,
      output_opening_chars: visibleAssistantDisplayCharCount(modelOutput.slice(0, 400)),
    });
    return;
  }

  const rpUser = lastRpUserMessageFromHistory(history);
  if (!rpUser?.trim()) {
    console.log("[input-echo-check]", {
      skipped: "no_rp_user_message",
      echoed_in_output: null,
    });
    return;
  }

  logInputEchoCheck(rpUser, modelOutput);
}
