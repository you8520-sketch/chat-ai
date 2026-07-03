import { callOpenRouterCompletion } from "@/lib/openRouterCompletion";
import type { TurnApiBudget } from "@/lib/turnApiBudget";
import {
  detectRegisterLexiconInNarration,
  isNarrationLexiconGateEnabled,
} from "./narrationLexicon";
import { buildNarrationLexiconRewriteUserMessage } from "./prompts";

export type NarrationLexiconRewriteOpts = {
  text: string;
  charName: string;
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  model: string;
  targetResponseChars: number;
  requestKind: string;
  turnApiBudget?: TurnApiBudget;
};

/** Post-gen: one rewrite when narration contains register lexicon (Group A). */
export async function maybeRewriteNarrationLexicon(
  opts: NarrationLexiconRewriteOpts
): Promise<{ text: string; rewritten: boolean; hits: string[] }> {
  if (!isNarrationLexiconGateEnabled(opts.charName)) {
    return { text: opts.text, rewritten: false, hits: [] };
  }

  const { fail, hits } = detectRegisterLexiconInNarration(opts.text);
  if (!fail) return { text: opts.text, rewritten: false, hits: [] };

  const rewriteUser = buildNarrationLexiconRewriteUserMessage(hits);
  const rewriteHistory = [
    ...opts.history.filter((m) => m.content?.trim()),
    { role: "assistant" as const, content: opts.text.trim() },
    { role: "user" as const, content: rewriteUser },
  ];

  if (opts.turnApiBudget && !opts.turnApiBudget.canSubCall()) {
    console.warn("[speechLock] narration lexicon rewrite skipped — turn API budget exhausted", { hits });
    return { text: opts.text, rewritten: false, hits };
  }

  try {
    opts.turnApiBudget?.beforeFetch("narration-lexicon-rewrite");
    const res = await callOpenRouterCompletion({
      system: opts.system,
      history: rewriteHistory,
      model: opts.model,
      temperature: 0.35,
      maxTokens: Math.min(4096, Math.ceil(opts.targetResponseChars * 1.4)),
      requestKind: `${opts.requestKind}-narrationLexiconRewrite`,
    });
    const next = res.text.trim();
    if (!next) return { text: opts.text, rewritten: false, hits };
    const recheck = detectRegisterLexiconInNarration(next);
    return { text: next, rewritten: true, hits: recheck.hits.length ? recheck.hits : hits };
  } catch (err) {
    console.warn("[speechLock] narration lexicon rewrite failed — keeping original", {
      error: (err as Error).message,
      hits,
    });
    return { text: opts.text, rewritten: false, hits };
  }
}
