/**
 * Experiment E helpers — word-count USER_TAIL swap only.
 * Production still uses USER_TAIL_LENGTH_OWNER_SENTENCE (3,200자).
 * This module is not imported by the chat route.
 */
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";

export const VANILLA_LENGTH_PHRASE = "3,200자 이상";
export const WORD_COUNT_LENGTH_PHRASE = "1,100~1,500단어";

export const WORD_COUNT_OWNER_SENTENCE = USER_TAIL_LENGTH_OWNER_SENTENCE.replace(
  VANILLA_LENGTH_PHRASE,
  WORD_COUNT_LENGTH_PHRASE
);

export function applyWordCountOwnerSwap(userTurn: string): string {
  const count = userTurn.split(USER_TAIL_LENGTH_OWNER_SENTENCE).length - 1;
  if (count !== 1) {
    throw new Error(`owner count must be 1, got ${count}`);
  }
  if (!userTurn.includes(VANILLA_LENGTH_PHRASE)) {
    throw new Error("vanilla length phrase missing");
  }
  return userTurn.replace(USER_TAIL_LENGTH_OWNER_SENTENCE, WORD_COUNT_OWNER_SENTENCE);
}

export function assertWordCountAssembledDiff(opts: {
  systemA: string;
  systemB: string;
  historyA: Array<{ role: string; content: string }>;
  historyB: Array<{ role: string; content: string }>;
}): {
  systemDiff: number;
  historyPrefixDiff: number;
  ownerPositionDiff: number;
  ownerCountA: number;
  ownerCountB: number;
  currentUserDiffOnlyPhrase: boolean;
} {
  if (opts.systemA !== opts.systemB) {
    throw new Error("SYSTEM diff != 0");
  }
  if (opts.historyA.length !== opts.historyB.length) {
    throw new Error("history length diff");
  }
  for (let i = 0; i < opts.historyA.length - 1; i++) {
    if (JSON.stringify(opts.historyA[i]) !== JSON.stringify(opts.historyB[i])) {
      throw new Error(`history prefix diff at ${i}`);
    }
  }
  const lastA = [...opts.historyA].reverse().find((m) => m.role === "user")?.content ?? "";
  const lastB = [...opts.historyB].reverse().find((m) => m.role === "user")?.content ?? "";
  const ownerCountA = lastA.split(USER_TAIL_LENGTH_OWNER_SENTENCE).length - 1;
  const ownerCountB = lastB.split(WORD_COUNT_OWNER_SENTENCE).length - 1;
  if (ownerCountA !== 1 || ownerCountB !== 1) {
    throw new Error(`owner count A=${ownerCountA} B=${ownerCountB}`);
  }
  if (lastB !== applyWordCountOwnerSwap(lastA)) {
    throw new Error("current user diff is not the word-count phrase swap");
  }
  if (lastA.replaceAll(VANILLA_LENGTH_PHRASE, "") !== lastB.replaceAll(WORD_COUNT_LENGTH_PHRASE, "")) {
    throw new Error("non-phrase residue in user turn");
  }
  const posA = lastA.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE);
  const posB = lastB.indexOf(WORD_COUNT_OWNER_SENTENCE);
  if (posA !== posB) {
    throw new Error("owner position diff");
  }
  return {
    systemDiff: 0,
    historyPrefixDiff: 0,
    ownerPositionDiff: 0,
    ownerCountA,
    ownerCountB,
    currentUserDiffOnlyPhrase: true,
  };
}
