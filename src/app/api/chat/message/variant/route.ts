import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { assertMessageAccess } from "@/lib/chatAccess";
import {
  normalizeMessageVariants,
  serializeVariantsForClient,
  variantToRowFields,
} from "@/lib/messageAlternates";
import { stripMuseAcceptanceFromUsage } from "@/lib/museAcceptanceTelemetry";
import { stripAdultRoutingForClient } from "@/lib/billingReceiptAccess";
import { serializeStatusWidgetValuesJson } from "@/lib/statusWidget";
import { persistEpisodicMemoryFactsBestEffort } from "@/lib/episodicMemoryFacts";
import { evaluateStatusWidgetTriggersBestEffort } from "@/lib/statusWidgetTriggers";
import {
  getAssistantSourceTurn,
  isLatestCanonicalAssistantMessage,
  supersedeStatusTriggerEventsForSourceMessage,
} from "@/lib/rpDerivedStateLifecycle";
import { PREFERENCE_EVENT } from "@/lib/feedback/events";
import { recordPreferenceEvent } from "@/lib/feedback/feedback-db";
import { enqueueScoreRecompute } from "@/lib/feedback/queue";

/** 재생성 버전 선택 */
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json();
  const messageId = Number(body.messageId);
  const variantIndex = Number(body.variantIndex);
  if (!messageId || Number.isNaN(variantIndex)) {
    return NextResponse.json({ error: "messageId와 variantIndex가 필요합니다." }, { status: 400 });
  }

  const msg = assertMessageAccess(user.id, messageId);
  if (!msg) return NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });
  if (msg.role !== "assistant" || msg.model === "greeting") {
    return NextResponse.json({ error: "AI 답변만 버전 선택이 가능합니다." }, { status: 400 });
  }

  const db = getDb();
  const row = db
    .prepare("SELECT content, model, usage, alternates, active_variant FROM messages WHERE id=?")
    .get(messageId) as {
    content: string;
    model: string;
    usage: string | null;
    alternates: string | null;
    active_variant: number | null;
  };

  const { variants, activeVariant } = normalizeMessageVariants(row);
  if (variants.length <= 1) {
    return NextResponse.json({ error: "선택할 다른 버전이 없습니다." }, { status: 400 });
  }
  if (variantIndex < 0 || variantIndex >= variants.length) {
    return NextResponse.json({ error: "잘못된 버전 번호입니다." }, { status: 400 });
  }
  if (variantIndex === activeVariant) {
    const current = variants[activeVariant];
    return NextResponse.json({
      ok: true,
      ...serializeVariantsForClient(variants, activeVariant),
      content: current.content,
      usage: current.usage
        ? stripAdultRoutingForClient(stripMuseAcceptanceFromUsage(current.usage))
        : null,
    });
  }

  const fromVariant = activeVariant;
  const fields = variantToRowFields(variants, variantIndex);
  const selectedVariant = variants[variantIndex];
  const selectedAdultRouteMetaJson = selectedVariant?.usage?.adultRouting
    ? JSON.stringify(selectedVariant.usage.adultRouting)
    : "";
  const hasVariantStatusSnapshot = Object.prototype.hasOwnProperty.call(
    selectedVariant ?? {},
    "statusWidgetValues"
  );
  const selectedStatusWidgetValuesJson = hasVariantStatusSnapshot
    ? selectedVariant?.statusWidgetValues
      ? serializeStatusWidgetValuesJson(selectedVariant.statusWidgetValues)
      : ""
    : undefined;
  if (selectedStatusWidgetValuesJson !== undefined) {
    db.prepare(
      "UPDATE messages SET content=?, model=?, usage=?, adult_route_meta_json=?, alternates=?, active_variant=?, status_widget_values_json=?, status_widget_turn_active=? WHERE id=?"
    ).run(
      fields.content,
      fields.model,
      fields.usage,
      selectedAdultRouteMetaJson,
      JSON.stringify(variants),
      variantIndex,
      selectedStatusWidgetValuesJson,
      selectedVariant?.statusWidgetTurnActive ? 1 : 0,
      messageId
    );
  } else {
    db.prepare(
      "UPDATE messages SET content=?, model=?, usage=?, adult_route_meta_json=?, alternates=?, active_variant=? WHERE id=?"
    ).run(
      fields.content,
      fields.model,
      fields.usage,
      selectedAdultRouteMetaJson,
      JSON.stringify(variants),
      variantIndex,
      messageId
    );
  }

  recordPreferenceEvent({
    userId: user.id,
    chatId: msg.chat_id,
    messageId,
    eventType: PREFERENCE_EVENT.VARIANT_SWITCH,
    payload: { from: fromVariant, to: variantIndex },
  });
  enqueueScoreRecompute(messageId);

  // Phase B0: latest assistant variant switch reconciles derived state.
  // Historical variant switch requires downstream replay (out of scope for
  // B0); only the display snapshot is updated and a diagnostic is logged.
  try {
    if (isLatestCanonicalAssistantMessage(db, msg.chat_id, messageId)) {
      supersedeStatusTriggerEventsForSourceMessage(
        db,
        msg.chat_id,
        messageId,
        "variant_switch"
      );
      const sourceTurn = getAssistantSourceTurn(db, msg.chat_id, messageId);
      const selectedFacts = selectedVariant?.statusWidgetValues?.extracted_facts ?? [];
      if (sourceTurn != null) {
        persistEpisodicMemoryFactsBestEffort(db, {
          chatId: msg.chat_id,
          characterId: msg.character_id,
          userId: msg.user_id,
          sourceTurn,
          facts: selectedFacts,
          replaceSourceTurn: true,
          metadata: {
            assistant_message_id: messageId,
            request_id: selectedVariant?.requestId ?? null,
            variant_switch: true,
            variant_index: variantIndex,
          },
        });
      }
      if (
        sourceTurn != null &&
        selectedVariant?.statusWidgetValues &&
        Object.keys(selectedVariant.statusWidgetValues.character ?? {}).length > 0
      ) {
        evaluateStatusWidgetTriggersBestEffort(db, {
          chatId: msg.chat_id,
          characterId: msg.character_id,
          sourceTurn,
          statusValues: selectedVariant.statusWidgetValues,
          sourceMessageId: messageId,
          requestId: selectedVariant?.requestId ?? null,
          generationSequence: selectedVariant?.generationSequence ?? null,
        });
      }
    } else {
      console.warn(
        "[DerivedState] HISTORICAL_VARIANT_DERIVED_STATE_REPLAY_UNSUPPORTED — historical variant switch; downstream derived-state replay not performed"
      );
    }
  } catch (e) {
    console.error("[DerivedState] variant switch reconcile failed:", (e as Error).message);
  }

  const selected = variants[variantIndex];
  return NextResponse.json({
    ok: true,
    ...serializeVariantsForClient(variants, variantIndex),
    content: selected.content,
    usage: selected.usage
      ? stripAdultRoutingForClient(stripMuseAcceptanceFromUsage(selected.usage))
      : null,
  });
}
