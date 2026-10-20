import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  asyncRecordMatchesGenerationScope,
  resolveActiveAssistantGenerationScope,
} from "@/lib/assistantGenerationScope";
import { loadMessageSuggestedReplies } from "@/lib/suggestedReplies/job";
import { resolveClientSuggestedReplies } from "@/lib/suggestedReplies/parse";
import { adultOffProofCarrier } from "@/lib/adultOffAuxApproval";
import { adultOffReadGuardAppliesForChat } from "@/lib/adultOffVisibleOutput";
import {
  adultOffActiveVariantUsage,
  adultOffStoredTextDisposition,
  collectSuggestedReplyVisibleTexts,
} from "@/lib/adultOffOutputGuard";

/** Pure read/poll — never starts provider inference. */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const url = new URL(req.url);
  const messageId = Number(url.searchParams.get("messageId"));
  if (!messageId) {
    return NextResponse.json({ error: "messageId가 필요합니다." }, { status: 400 });
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT m.suggested_replies_json, m.chat_id, m.content, m.model, m.usage, m.alternates,
              m.active_variant, c.adult_handoff_enabled
         FROM messages m
         JOIN chats c ON c.id = m.chat_id
        WHERE m.id=? AND c.user_id=? AND m.role='assistant'`
    )
    .get(messageId, user.id) as
    | {
        suggested_replies_json: string | null;
        chat_id: number;
        content: string;
        model: string | null;
        usage: string | null;
        alternates: string | null;
        active_variant: number | null;
        adult_handoff_enabled: number | null;
      }
    | undefined;

  if (!row) {
    return NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });
  }

  const activeScope = resolveActiveAssistantGenerationScope(messageId);
  const rawRecord = loadMessageSuggestedReplies(messageId);
  const record =
    activeScope && asyncRecordMatchesGenerationScope(rawRecord, activeScope) ? rawRecord : null;

  const client = resolveClientSuggestedReplies(record);
  const applyGuard = adultOffReadGuardAppliesForChat({
    user,
    adultHandoffEnabled: row.adult_handoff_enabled,
  });
  const replyTexts = collectSuggestedReplyVisibleTexts(client.suggestedReplies);
  const proofs = [
    adultOffActiveVariantUsage(row),
    adultOffProofCarrier(record?.adultOffGuard),
  ];
  const repliesApproved =
    !applyGuard ||
    client.suggestedRepliesPending ||
    replyTexts.every((text) =>
      proofs.some((proof) => adultOffStoredTextDisposition(proof, text) === "approved")
    );
  const withheld = applyGuard && !client.suggestedRepliesPending && !repliesApproved;

  return NextResponse.json({
    messageId,
    chatId: row.chat_id,
    requested: client.suggestedRepliesRequested,
    pending: withheld ? false : client.suggestedRepliesPending,
    failed: withheld ? true : client.suggestedRepliesFailed,
    replies: client.suggestedRepliesPending || withheld ? [] : client.suggestedReplies,
    extractedAt: record?.extractedAt ?? null,
  });
}
