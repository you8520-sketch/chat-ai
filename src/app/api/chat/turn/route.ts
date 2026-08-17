import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  executeLastTurnDeleteTransaction,
  NumericTurnDeleteChainNotReadyError,
} from "@/lib/chatLastTurnDelete";
import { getDb } from "@/lib/db";
import { getLastTurnMessageIds } from "@/lib/chatAccess";
import {
  listCanonicalEligibleNumericFields,
  resolveNumericCanonicalEligibility,
} from "@/lib/rpNumericState";
import { parseStatusWidgetJson } from "@/lib/statusWidget";
import { getChatMemoryCapacity } from "@/lib/memory/memory-capacity";
import { reconcileMemoryAfterTurnDelete } from "@/lib/memory/memory-reconcile";
import { resolveMemoryTier } from "@/lib/memory/memory-manager";
import { isMemoryFeatureEnabled } from "@/lib/memory/memory-feature";
import { countChatTurns } from "@/lib/memory/memory-turn-loader";
import { isCanonAdoptedScene, OOC_CANON_ADOPTION_COPY } from "@/lib/oocSceneRender";

export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = (await req.json()) as {
    chatId?: unknown;
    expectedAssistantMessageId?: unknown;
  };
  const cId = Number(body.chatId);
  if (!cId) return NextResponse.json({ error: "chatId가 필요합니다." }, { status: 400 });

  const expectedAssistantRaw = body.expectedAssistantMessageId;
  const expectedAssistantMessageId =
    expectedAssistantRaw === undefined || expectedAssistantRaw === null
      ? null
      : Number(expectedAssistantRaw);
  if (
    expectedAssistantRaw != null &&
    (!Number.isSafeInteger(expectedAssistantMessageId) ||
      (expectedAssistantMessageId as number) <= 0)
  ) {
    return NextResponse.json(
      { error: "expectedAssistantMessageId가 올바르지 않습니다." },
      { status: 400 }
    );
  }

  const db = getDb();
  const chat = db
    .prepare("SELECT id, character_id FROM chats WHERE id=? AND user_id=?")
    .get(cId, user.id) as { id: number; character_id: number } | undefined;
  if (!chat) return NextResponse.json({ error: "채팅방을 찾을 수 없습니다." }, { status: 404 });

  const character = db
    .prepare("SELECT name, status_widget_json FROM characters WHERE id=?")
    .get(chat.character_id) as { name: string; status_widget_json?: string } | undefined;

  const lastTurn = getLastTurnMessageIds(cId);
  if (!lastTurn) {
    return NextResponse.json({ error: "삭제할 대화 턴이 없습니다." }, { status: 400 });
  }

  if (lastTurn.assistantId != null) {
    const adoptedRow = db
      .prepare("SELECT usage FROM messages WHERE id=? AND chat_id=?")
      .get(lastTurn.assistantId, cId) as { usage?: unknown } | undefined;
    if (isCanonAdoptedScene(adoptedRow?.usage)) {
      return NextResponse.json(
        {
          error: OOC_CANON_ADOPTION_COPY.deleteProtected,
          code: "ooc_canon_adopted_delete_blocked",
        },
        { status: 409 }
      );
    }
  }

  if (
    expectedAssistantMessageId != null &&
    lastTurn.assistantId !== expectedAssistantMessageId
  ) {
    return NextResponse.json(
      {
        error: "삭제 대상 턴이 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
        code: "turn_delete_target_changed",
      },
      { status: 409 }
    );
  }

  const characterWidget = parseStatusWidgetJson(character?.status_widget_json);
  const numericEligible =
    resolveNumericCanonicalEligibility({
      userId: user.id,
      characterId: chat.character_id,
    }).eligible &&
    listCanonicalEligibleNumericFields(characterWidget).length > 0;

  const deletedPlayableTurn = countChatTurns(cId);
  const deletedUserMessageId = lastTurn.userId;
  const deletedAssistantMessageId = lastTurn.assistantId;

  let deletedIds: number[];
  try {
    const result = executeLastTurnDeleteTransaction(db, {
      chatId: cId,
      characterId: chat.character_id,
      userMessageId: lastTurn.userId,
      assistantMessageId: lastTurn.assistantId,
      revertNumeric: numericEligible,
    });
    deletedIds = result.deletedIds;
  } catch (e) {
    if (e instanceof NumericTurnDeleteChainNotReadyError) {
      return NextResponse.json(
        {
          error: "숫자 상태 체인이 불완전해 턴을 삭제할 수 없습니다.",
          code: "numeric_state_turn_delete_chain_not_ready",
        },
        { status: 409 }
      );
    }
    throw e;
  }

  if (isMemoryFeatureEnabled()) {
    try {
      reconcileMemoryAfterTurnDelete({
        chatId: cId,
        userId: user.id,
        characterId: chat.character_id,
        charName: character?.name ?? "캐릭터",
        tier: resolveMemoryTier(user),
        memoryCapacity: getChatMemoryCapacity(cId),
        deletedUserMessageId,
        deletedAssistantMessageId,
        deletedPlayableTurn,
      });
    } catch (e) {
      console.warn("[memory] reconcile after turn delete failed:", (e as Error).message);
    }

    // Roll back relationship-meta entries that only existed in the deleted turn.
    try {
      const deletedUserRow = db
        .prepare("SELECT content FROM messages WHERE id=?")
        .get(deletedUserMessageId) as { content: string } | undefined;
      const deletedAssistantRow = deletedAssistantMessageId
        ? (db
            .prepare("SELECT content FROM messages WHERE id=?")
            .get(deletedAssistantMessageId) as { content: string } | undefined)
        : undefined;
      const { rollbackRelationshipMetaForDeletedTurn } = await import(
        "@/lib/memory/memory-relationship-meta"
      );
      const { resolveRelationshipMetaNamesForCharacter } = await import(
        "@/lib/relationshipMetaCharacterName"
      );
      const names = resolveRelationshipMetaNamesForCharacter(
        chat.character_id,
        user.nickname
      );
      rollbackRelationshipMetaForDeletedTurn({
        chatId: cId,
        names,
        deletedUserText: deletedUserRow?.content ?? "",
        deletedAssistantText: deletedAssistantRow?.content ?? "",
      });
    } catch (e) {
      console.warn("[memory] relationship meta rollback failed:", (e as Error).message);
    }
  }

  return NextResponse.json({ ok: true, deletedIds });
}
