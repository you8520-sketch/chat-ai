import type Database from "better-sqlite3";
import { OPENROUTER_GEMINI_25_FLASH_MODEL } from "@/lib/chatModels";
import { callOpenRouterCompletion } from "@/lib/openRouterCompletion";
import { isDemoEnv } from "@/lib/demo";

export type CommentAiVerdict = "ALLOW" | "BLOCK";

export type CommentAiModerationResult = {
  verdict: CommentAiVerdict;
  reason: string;
  estimated: boolean;
};

const MODERATION_SYSTEM = `You are a Korean community comment moderator for a character chat platform.
Analyze the comment IN CONTEXT. Reply with ONLY one word: ALLOW or BLOCK.

BLOCK when the comment clearly contains:
- Profanity, slurs, or personal attacks
- Attacks on AI creators / artists ("딸깍충", "프롬충", "파쿠리", insults toward creators)
- Harassment, hate, or severe toxicity

ALLOW when:
- The comment is constructive criticism, neutral, or benign
- A banned-word filter false-positive (innocent use of similar syllables)
- Mild disagreement without insults

Output exactly ALLOW or BLOCK on the first line. Optional second line: brief Korean reason.`;

function parseVerdict(text: string): CommentAiModerationResult | null {
  const first = text.trim().split(/\r?\n/)[0]?.trim().toUpperCase() ?? "";
  if (first === "ALLOW" || first.startsWith("ALLOW ")) {
    return { verdict: "ALLOW", reason: text.trim().split(/\r?\n/).slice(1).join(" ").trim(), estimated: false };
  }
  if (first === "BLOCK" || first.startsWith("BLOCK ")) {
    return { verdict: "BLOCK", reason: text.trim().split(/\r?\n/).slice(1).join(" ").trim(), estimated: false };
  }
  return null;
}

export async function moderateCommentWithAi(input: {
  content: string;
  normalized: string;
  matchedWords: string[];
  trigger: "banned_word" | "report_threshold";
}): Promise<CommentAiModerationResult> {
  if (isDemoEnv() && process.env.SKIP_COMMENT_MODERATION === "1") {
    return { verdict: "ALLOW", reason: "dev skip", estimated: true };
  }

  const userPrompt = `[TRIGGER: ${input.trigger}]
Matched filter terms: ${input.matchedWords.length ? input.matchedWords.join(", ") : "(none)"}
Normalized: ${input.normalized}

Original comment:
"""
${input.content}
"""

Verdict:`;

  try {
    const { text } = await callOpenRouterCompletion({
      system: MODERATION_SYSTEM,
      history: [{ role: "user", content: userPrompt }],
      model: process.env.COMMENT_MODERATION_MODEL?.trim() || OPENROUTER_GEMINI_25_FLASH_MODEL,
      temperature: 0.1,
      maxTokens: 64,
      requestKind: "comment-moderation",
      timeoutMs: 30_000,
    });
    const parsed = parseVerdict(text);
    if (parsed) return parsed;
    return { verdict: "BLOCK", reason: "AI 응답 파싱 실패 — 보수적 차단", estimated: false };
  } catch (err) {
    console.error("[comment-moderation] AI failed", err);
    return { verdict: "BLOCK", reason: "AI 검수 실패 — 보수적 차단", estimated: true };
  }
}

export function insertCommentModerationLog(
  db: Database.Database,
  row: {
    comment_id?: number | null;
    user_id?: number | null;
    event_type: string;
    original_content: string;
    normalized_content: string;
    matched_words_json?: string;
    report_count?: number | null;
    ai_verdict?: string | null;
    ai_reason?: string;
    action: string;
    delete_reason?: string;
  }
): number {
  const result = db
    .prepare(
      `INSERT INTO profile_comment_moderation_logs
       (comment_id, user_id, event_type, original_content, normalized_content,
        matched_words_json, report_count, ai_verdict, ai_reason, action, delete_reason)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      row.comment_id ?? null,
      row.user_id ?? null,
      row.event_type,
      row.original_content,
      row.normalized_content,
      row.matched_words_json ?? "[]",
      row.report_count ?? null,
      row.ai_verdict ?? null,
      row.ai_reason ?? "",
      row.action,
      row.delete_reason ?? ""
    );
  return Number(result.lastInsertRowid);
}

export function countAuthorModerationBlocks(db: Database.Database, authorId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM profile_comment_moderation_logs
       WHERE user_id = ? AND action IN ('blocked_post','deleted_report')`
    )
    .get(authorId) as { c: number };
  return row?.c ?? 0;
}

export function maybeBanCommentAuthor(db: Database.Database, authorId: number, strikesNeeded: number): void {
  const strikes = countAuthorModerationBlocks(db, authorId);
  if (strikes >= strikesNeeded) {
    db.prepare("UPDATE users SET comment_banned=1 WHERE id=?").run(authorId);
  }
}
