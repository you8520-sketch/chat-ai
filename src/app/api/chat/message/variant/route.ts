import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { assertMessageAccess } from "@/lib/chatAccess";
import {
  normalizeMessageVariants,
  serializeVariantsForClient,
} from "@/lib/messageAlternates";
import {
  keepInternalAdultRoutingForUser,
  serializeUsageForPublicClient,
} from "@/lib/billingReceiptAccess";
import { evaluateStatusWidgetTriggersBestEffort } from "@/lib/statusWidgetTriggers";
import {
  executeAtomicNonnumericVariantSwitch,
  hasLaterCanonicalTurn,
  resolveCanonicalVariantSwitchGate,
} from "@/lib/rpDerivedStateLifecycle";
import {
  assertS4VariantSwitchAllowed,
  S4HistoricalVariantReplayUnsupportedError,
  S4VariantProvenanceInvalidError,
} from "@/lib/knowledgeTransferVariant";
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
import { isCanonAdoptedScene, OOC_CANON_ADOPTION_COPY } from "@/lib/oocSceneRender";
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
  if (isCanonAdoptedScene(row.usage)) {
    return NextResponse.json(
      {
        error: OOC_CANON_ADOPTION_COPY.variantSwitchBlocked,
        code: "ooc_canon_adopted_variant_blocked",
      },
      { status: 409 }
    );
  }
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
  const keepInternalAdultRouting = keepInternalAdultRoutingForUser(user);
  if (variantIndex === activeVariant && !numericEligible) {
    const current = variants[activeVariant];
    return NextResponse.json({
      ok: true,
      ...serializeVariantsForClient(variants, activeVariant, {
        keepInternalAdultRouting,
      }),
      content: current.content,
      usage: current.usage
        ? serializeUsageForPublicClient(current.usage, {
            keepInternal: keepInternalAdultRouting,
          })
        : null,
    });
  }

  const fromVariant = activeVariant;

  try {
    assertS4VariantSwitchAllowed(
      db,
      msg.chat_id,
      messageId,
      hasLaterCanonicalTurn(db, msg.chat_id, messageId)
    );
  } catch (e) {
    if (e instanceof S4HistoricalVariantReplayUnsupportedError) {
      return NextResponse.json(
        {
          error: "이후 대화가 있는 과거 턴의 S4 버전 전환은 지원하지 않습니다.",
          code: e.code,
        },
        { status: 409 }
      );
    }
    throw e;
  }

  const variantGate = resolveCanonicalVariantSwitchGate(db, msg.chat_id, messageId);
  if (!variantGate.allowed) {
    return NextResponse.json(
      { error: variantGate.error, code: variantGate.code },
      { status: 409 }
    );
  }

  // ─── Numeric-enabled path (B1-D2) ───
  if (numericEligible) {
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
      if (e instanceof S4VariantProvenanceInvalidError) {
        return NextResponse.json(
          {
            error: "선택한 버전의 S4 출처 정보가 유효하지 않습니다.",
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
      ...serializeVariantsForClient(responseVariants, responseActive, {
        keepInternalAdultRouting,
      }),
      content: responseSelected.content,
      usage: responseSelected.usage
        ? serializeUsageForPublicClient(responseSelected.usage, {
            keepInternal: keepInternalAdultRouting,
          })
        : null,
    });
  }

  // ─── Nonnumeric path — BEGIN IMMEDIATE txn-local frontier authority ───
  let nonnumericResult: ReturnType<typeof executeAtomicNonnumericVariantSwitch>;
  try {
    nonnumericResult = executeAtomicNonnumericVariantSwitch(db, {
      chatId: msg.chat_id,
      characterId: msg.character_id,
      userId: msg.user_id,
      messageId,
      variantIndex,
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
    if (e instanceof S4VariantProvenanceInvalidError) {
      return NextResponse.json(
        {
          error: "선택한 버전의 S4 출처 정보가 유효하지 않습니다.",
          code: e.code,
        },
        { status: 409 }
      );
    }
    console.error(
      "[DerivedState] atomic nonnumeric variant switch failed:",
      (e as Error).message
    );
    return NextResponse.json(
      { error: "버전 전환 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }

  const responseVariants = nonnumericResult.canonicalVariants;
  const responseActive = nonnumericResult.activeVariant;
  const responseSelected = responseVariants[responseActive]!;

  if (nonnumericResult.kind === "APPLIED") {
    recordPreferenceEvent({
      userId: user.id,
      chatId: msg.chat_id,
      messageId,
      eventType: PREFERENCE_EVENT.VARIANT_SWITCH,
      payload: { from: fromVariant, to: responseActive },
    });
    enqueueScoreRecompute(messageId);

    const canonicalStatusForTriggers = responseSelected.statusWidgetValues;
    if (
      nonnumericResult.sourceTurn != null &&
      canonicalStatusForTriggers &&
      Object.keys(canonicalStatusForTriggers.character ?? {}).length > 0
    ) {
      try {
        evaluateStatusWidgetTriggersBestEffort(db, {
          chatId: msg.chat_id,
          characterId: msg.character_id,
          sourceTurn: nonnumericResult.sourceTurn,
          statusValues: canonicalStatusForTriggers,
          sourceMessageId: messageId,
          requestId: nonnumericResult.selectedRequestId,
          generationSequence: nonnumericResult.selectedGenerationSequence,
        });
      } catch (e) {
        console.error(
          "[StatusTrigger] post-commit variant trigger re-evaluation failed:",
          (e as Error).message
        );
      }
    }
  }

  return NextResponse.json({
    ok: true,
    ...serializeVariantsForClient(responseVariants, responseActive, {
      keepInternalAdultRouting,
    }),
    content: responseSelected.content,
    usage: responseSelected.usage
      ? serializeUsageForPublicClient(responseSelected.usage, {
          keepInternal: keepInternalAdultRouting,
        })
      : null,
  });
}
