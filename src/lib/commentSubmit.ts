import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { matchCommentBannedWords } from "@/lib/commentBannedWords";
import {
  insertCommentModerationLog,
  maybeBanCommentAuthor,
  moderateCommentWithAi,
} from "@/lib/commentModeration";
import { COMMENT_AUTHOR_BLOCK_STRIKES } from "@/lib/commentModerationPolicy";
import type { ProfileCommentTarget } from "@/lib/profileComments";
import { notifyProfileCommentReceived } from "@/lib/userNotifications";

export type SubmitProfileCommentResult =
  | { ok: true; commentId: number }
  | { ok: false; error: string; status: number };

export async function submitProfileComment(input: {
  targetType: ProfileCommentTarget;
  targetId: number;
  authorId: number;
  authorName: string;
  content: string;
  isPrivate?: boolean;
}): Promise<SubmitProfileCommentResult> {
  const db = getDb();
  const { normalized, matches, requiresAi } = matchCommentBannedWords(db, input.content);

  if (matches.length > 0 && requiresAi) {
    const ai = await moderateCommentWithAi({
      content: input.content,
      normalized,
      matchedWords: matches.map((m) => m.word),
      trigger: "banned_word",
    });

    insertCommentModerationLog(db, {
      user_id: input.authorId,
      event_type: "post_banned_word",
      original_content: input.content,
      normalized_content: normalized,
      matched_words_json: JSON.stringify(matches.map((m) => m.word)),
      ai_verdict: ai.verdict,
      ai_reason: ai.reason,
      action: ai.verdict === "BLOCK" ? "blocked_post" : "allowed_post",
      delete_reason: ai.verdict === "BLOCK" ? ai.reason : "",
    });

    if (ai.verdict === "BLOCK") {
      maybeBanCommentAuthor(db, input.authorId, COMMENT_AUTHOR_BLOCK_STRIKES);
      return {
        ok: false,
        error: "커뮤니티 가이드에 맞지 않는 댓글입니다.",
        status: 403,
      };
    }
  } else if (matches.length > 0) {
    insertCommentModerationLog(db, {
      user_id: input.authorId,
      event_type: "post_banned_word",
      original_content: input.content,
      normalized_content: normalized,
      matched_words_json: JSON.stringify(matches.map((m) => m.word)),
      action: "blocked_post",
      delete_reason: "금지어 (AI 미검사)",
    });
    maybeBanCommentAuthor(db, input.authorId, COMMENT_AUTHOR_BLOCK_STRIKES);
    return {
      ok: false,
      error: "커뮤니티 가이드에 맞지 않는 댓글입니다.",
      status: 403,
    };
  }

  const result = db
    .prepare(
      `INSERT INTO profile_comments
       (target_type, target_id, author_id, author_name, content, is_private, normalized_content, moderation_status)
       VALUES (?,?,?,?,?,?,?,'visible')`
    )
    .run(
      input.targetType,
      input.targetId,
      input.authorId,
      input.authorName,
      input.content,
      input.isPrivate ? 1 : 0,
      normalized
    );

  const commentId = Number(result.lastInsertRowid);

  insertCommentModerationLog(db, {
    comment_id: commentId,
    user_id: input.authorId,
    event_type: "post",
    original_content: input.content,
    normalized_content: normalized,
    matched_words_json: "[]",
    action: "allowed_post",
  });

  if (input.targetType === "creator") {
    notifyProfileCommentReceived(db, {
      recipientId: input.targetId,
      actorId: input.authorId,
      actorNickname: input.authorName,
      commentId,
      targetType: "creator",
      targetLabel: "",
      preview: input.content,
    });
  } else {
    const character = db
      .prepare("SELECT name, creator_id FROM characters WHERE id=?")
      .get(input.targetId) as { name: string; creator_id: number | null } | undefined;
    if (character) {
      notifyProfileCommentReceived(db, {
        recipientId: character.creator_id,
        actorId: input.authorId,
        actorNickname: input.authorName,
        commentId,
        targetType: "character",
        targetLabel: character.name,
        preview: input.content,
      });
    }
  }

  return { ok: true, commentId };
}
