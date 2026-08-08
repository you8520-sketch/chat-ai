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
  hasLaterCanonicalTurn,
  isCanonicalFrontierAssistantMessage,
  isLatestCanonicalAssistantMessage,
} from "@/lib/rpDerivedStateLifecycle";
import {
  executeAtomicNumericVariantSwitch,
  listCanonicalEligibleNumericFields,
  NumericHistoricalVariantReplayUnsupportedError,
  NumericVariantChainNotReadyError,
  NumericVariantFrontierMovedError,
  NumericVariantSourceNotReadyError,
  resolveNumericCanonicalEligibility,
} from "@/lib/rpNumericState";
import { parseStatusWidgetJson } from "@/lib/statusWidget";
import { PREFERENCE_EVENT } from "@/lib/feedback/events";
import { recordPreferenceEvent } from "@/lib/feedback/feedback-db";
import { enqueueScoreRecompute } from "@/lib/feedback/queue";
import { getChatMemoryCapacity } from "@/lib/memory/memory-capacity";
import { isMemoryFeatureEnabled } from "@/lib/memory/memory-feature";
import { resolveMemoryTier } from "@/lib/memory/memory-manager";

/** 재생성 버전 선택 — ACTIVE SELECTED VARIANT == CANONICAL WORLDLINE */
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

  const characterRow = db
    .prepare("SELECT name, status_widget_json FROM characters WHERE id=?")
    .get(msg.character_id) as
    | { name: string; status_widget_json?: string }
    | undefined;
  const characterWidget = parseStatusWidgetJson(characterRow?.status_widget_json);
  const numericEligible =
    resolveNumericCanonicalEligibility({
      userId: user.id,
      characterId: msg.character_id,
    }).eligible &&
    listCanonicalEligibleNumericFields(characterWidget).length > 0;

  // Numeric path MUST enter BEGIN IMMEDIATE — never trust pre-txn same-active.
  // Nonnumeric keeps the cheap same-active early return.
  if (variantIndex === activeVariant && !numericEligible) {
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

  const sourceTurn = getAssistantSourceTurn(db, msg.chat_id, messageId);
  const isLatest = isLatestCanonicalAssistantMessage(db, msg.chat_id, messageId);

  // ─── Numeric-enabled path (B1-D2) ───
  if (numericEligible) {
    if (hasLaterCanonicalTurn(db, msg.chat_id, messageId)) {
      return NextResponse.json(
        {
          error: "이후 대화가 있는 과거 턴의 버전 전환은 지원하지 않습니다.",
          code: "numeric_state_historical_variant_replay_unsupported",
        },
        { status: 409 }
      );
    }
    if (!isCanonicalFrontierAssistantMessage(db, msg.chat_id, messageId)) {
      return NextResponse.json(
        {
          error: "이후 입력이 있어 이 답변의 버전을 바꿀 수 없습니다. 새로고침 후 다시 시도해 주세요.",
          code: "variant_switch_frontier_moved",
        },
        { status: 409 }
      );
    }

    let atomicResult: ReturnType<typeof executeAtomicNumericVariantSwitch>;
    try {
      atomicResult = executeAtomicNumericVariantSwitch(db, {
        chatId: msg.chat_id,
        characterId: msg.character_id,
        userId: msg.user_id,
        messageId,
        variantIndex,
        characterWidget,
        memory: {
          enabled: isMemoryFeatureEnabled(),
          tier: resolveMemoryTier(user),
          memoryCapacity: getChatMemoryCapacity(msg.chat_id),
        },
      });
    } catch (e) {
      if (e instanceof NumericVariantFrontierMovedError) {
        return NextResponse.json(
          {
            error: "이후 입력이 있어 이 답변의 버전을 바꿀 수 없습니다. 새로고침 후 다시 시도해 주세요.",
            code: e.code,
          },
          { status: 409 }
        );
      }
      if (e instanceof NumericHistoricalVariantReplayUnsupportedError) {
        return NextResponse.json(
          {
            error: "이후 대화가 있는 과거 턴의 버전 전환은 지원하지 않습니다.",
            code: e.code,
          },
          { status: 409 }
        );
      }
      if (e instanceof NumericVariantChainNotReadyError) {
        return NextResponse.json(
          {
            error: "숫자 상태 체인이 불완전해 버전을 전환할 수 없습니다.",
            code: e.code,
          },
          { status: 409 }
        );
      }
      if (e instanceof NumericVariantSourceNotReadyError) {
        return NextResponse.json(
          {
            error: "선택한 버전의 숫자 상태 원본을 찾을 수 없습니다.",
            code: e.code,
          },
          { status: 409 }
        );
      }
      console.error(
        "[DerivedState] atomic numeric variant switch failed:",
        (e as Error).message
      );
      return NextResponse.json(
        { error: "버전 전환 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    // HTTP RESPONSE == COMMITTED DB CANONICAL STATE
    const responseVariants = atomicResult.canonicalVariants;
    const responseActive = atomicResult.activeVariant;
    const responseSelected = responseVariants[responseActive]!;

    if (atomicResult.kind === "APPLIED") {
      recordPreferenceEvent({
        userId: user.id,
        chatId: msg.chat_id,
        messageId,
        eventType: PREFERENCE_EVENT.VARIANT_SWITCH,
        payload: { from: fromVariant, to: responseActive },
      });
      enqueueScoreRecompute(messageId);

      const canonicalStatusForTriggers = atomicResult.canonicalStatusForTriggers;
      if (
        atomicResult.sourceTurn != null &&
        canonicalStatusForTriggers &&
        Object.keys(canonicalStatusForTriggers.character ?? {}).length > 0
      ) {
        try {
          evaluateStatusWidgetTriggersBestEffort(db, {
            chatId: msg.chat_id,
            characterId: msg.character_id,
            sourceTurn: atomicResult.sourceTurn,
            statusValues: canonicalStatusForTriggers,
            sourceMessageId: messageId,
            requestId: atomicResult.selectedRequestId,
            generationSequence: atomicResult.selectedGenerationSequence,
          });
        } catch (e) {
          console.error(
            "[StatusTrigger] post-commit numeric variant trigger re-evaluation failed:",
            (e as Error).message
          );
        }
      }
    }

    return NextResponse.json({
      ok: true,
      ...serializeVariantsForClient(responseVariants, responseActive),
      content: responseSelected.content,
      usage: responseSelected.usage
        ? stripAdultRoutingForClient(
            stripMuseAcceptanceFromUsage(responseSelected.usage)
          )
        : null,
    });
  }

  // ─── Nonnumeric path (unchanged behavior) ───
  if (isLatest) {
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
