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
import { evaluateStatusWidgetTriggersBestEffort } from "@/lib/statusWidgetTriggers";
import {
  executeAtomicVariantSwitchCore,
  getAssistantSourceTurn,
  isLatestCanonicalAssistantMessage,
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

  const isLatest = isLatestCanonicalAssistantMessage(db, msg.chat_id, messageId);

  if (isLatest) {
    // Phase B0.1: atomic canonical mutation core. Message UPDATE + trigger
    // supersession + episodic reconciliation commit together or roll back
    // together. Trigger re-evaluation runs AFTER commit (best-effort).
    const sourceTurn = getAssistantSourceTurn(db, msg.chat_id, messageId);
    try {
      executeAtomicVariantSwitchCore(db, {
        chatId: msg.chat_id,
        messageId,
        content: fields.content,
        model: fields.model,
        usageJson: fields.usage,
        adultRouteMetaJson: selectedAdultRouteMetaJson,
        variantsJson: JSON.stringify(variants),
        variantIndex,
        statusWidgetValuesJson: selectedStatusWidgetValuesJson,
        statusWidgetTurnActive: selectedVariant?.statusWidgetTurnActive,
        sourceTurn: sourceTurn ?? 0,
        characterId: msg.character_id,
        userId: msg.user_id,
        selectedFacts: selectedVariant?.statusWidgetValues?.extracted_facts ?? [],
        selectedRequestId: selectedVariant?.requestId ?? null,
        selectedGenerationSequence: selectedVariant?.generationSequence ?? null,
      });
    } catch (e) {
      console.error(
        "[DerivedState] atomic variant switch core failed:",
        (e as Error).message
      );
      return NextResponse.json(
        { error: "버전 전환 중 오류가 발생했습니다." },
        { status: 500 }
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

    // Best-effort trigger re-evaluation AFTER the canonical core committed.
    // A missing new trigger is strictly preferred over a stale rejected
    // variant's trigger (§12): never roll back the core to restore old events.
    if (
      sourceTurn != null &&
      selectedVariant?.statusWidgetValues &&
      Object.keys(selectedVariant.statusWidgetValues.character ?? {}).length > 0
    ) {
      try {
        evaluateStatusWidgetTriggersBestEffort(db, {
          chatId: msg.chat_id,
          characterId: msg.character_id,
          sourceTurn,
          statusValues: selectedVariant.statusWidgetValues,
          sourceMessageId: messageId,
          requestId: selectedVariant?.requestId ?? null,
          generationSequence: selectedVariant?.generationSequence ?? null,
        });
      } catch (e) {
        console.error(
          "[StatusTrigger] post-commit variant trigger re-evaluation failed:",
          (e as Error).message
        );
      }
    }
  } else {
    // Historical variant switch: only the display snapshot is updated. The
    // atomic core is still used so the message UPDATE + status snapshot are
    // consistent, but derived-state replay for downstream turns is out of
    // scope for B0 (would require replay). No trigger supersession / episodic
    // reconciliation is performed for historical switches.
    try {
      db.transaction(() => {
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
      })();
    } catch (e) {
      console.error(
        "[DerivedState] historical variant switch update failed:",
        (e as Error).message
      );
      return NextResponse.json(
        { error: "버전 전환 중 오류가 발생했습니다." },
        { status: 500 }
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

    console.warn(
      "[DerivedState] HISTORICAL_VARIANT_DERIVED_STATE_REPLAY_UNSUPPORTED — historical variant switch; downstream derived-state replay not performed"
    );
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
