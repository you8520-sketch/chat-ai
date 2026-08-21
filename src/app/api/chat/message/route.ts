import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { assertMessageAccess } from "@/lib/chatAccess";
import {
  editedMessageVariant,
  normalizeMessageVariants,
  resolveActiveVariantContent,
  serializeVariantsForClient,
} from "@/lib/messageAlternates";
import { stripMuseAcceptanceFromUsage } from "@/lib/museAcceptanceTelemetry";
import {
  keepInternalAdultRoutingForUser,
  stripAdultRoutingForClient,
} from "@/lib/billingReceiptAccess";
import { normalizeEditedProseForSave, isMaterialProseEdit } from "@/lib/canonicalProse";
import {
  parseStoredStatusWidgetValuesJson,
  sanitizeParsedStatusWidgetValues,
  serializeStatusWidgetValuesJson,
  stripExtractedFactsForClient,
} from "@/lib/statusWidget/parseValues";
import type { ParsedStatusWidgetTurnValues } from "@/lib/statusWidget/types";
import { resolveClientStatusMetaFlags } from "@/lib/statusMeta/displayPolicy";
import { parseStatusMetaRecord } from "@/lib/statusMeta/types";
import {
  parseSuggestedRepliesRecord,
  resolveClientSuggestedReplies,
} from "@/lib/suggestedReplies/parse";
import {
  markdownPipeTableStatusWindowActive,
  resolveUserNoteStatusWindowPolicy,
} from "@/lib/statusWindowNotePolicy";
import type { Usage } from "@/lib/chatUsage";
import { readOocSceneClientFlags } from "@/lib/oocSceneRender";
import { evaluateStatusWidgetTriggersBestEffort } from "@/lib/statusWidgetTriggers";
import {
  executeAtomicManualEditCore,
  getAssistantSourceTurn,
  isLatestCanonicalAssistantMessage,
} from "@/lib/rpDerivedStateLifecycle";
import {
  listCanonicalEligibleNumericFields,
  numericCanonicalFieldsChanged,
  resolveNumericCanonicalEligibility,
} from "@/lib/rpNumericState";
import { parseStatusWidgetJson } from "@/lib/statusWidget";
import {
  isGreetingMessage,
  resolveChatMessageEditLimit,
} from "@/lib/chatMessageEditPolicy";
import { recomputeAndPersistUserCoauthorMode } from "@/lib/userCoauthorState";

/** Read-only snapshot for stream EOF reconciliation (generationStatus + final content). */
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
      `SELECT m.id, m.chat_id, m.role, m.content, m.model, m.usage, m.alternates, m.active_variant,
              m.status_meta, m.status_widget_values_json, m.status_widget_turn_active,
              m.suggested_replies_json,
              m.generation_status, m.request_id, m.user_message_id, c.user_note
       FROM messages m
       JOIN chats c ON c.id = m.chat_id
       WHERE m.id=? AND c.user_id=? AND m.role='assistant'`
    )
    .get(messageId, user.id) as
    | {
        id: number;
        chat_id: number;
        role: string;
        content: string;
        model: string;
        usage: string | null;
        alternates: string | null;
        active_variant: number | null;
        status_meta: string | null;
        status_widget_values_json: string | null;
        status_widget_turn_active: number | null;
        suggested_replies_json: string | null;
        generation_status: string | null;
        request_id: string | null;
        user_message_id: number | null;
        user_note: string | null;
      }
    | undefined;

  if (!row) {
    return NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });
  }

  const keepInternalAdultRouting = keepInternalAdultRoutingForUser(user);
  const { variants, activeVariant } = normalizeMessageVariants(row);
  const variantMeta = serializeVariantsForClient(variants, activeVariant, {
    keepInternalAdultRouting,
  });
  const rowUsage = row.usage ? (JSON.parse(row.usage) as Usage) : null;
  const activeUsage = variants[activeVariant]?.usage ?? rowUsage;
  const oocFlags = readOocSceneClientFlags(activeUsage ?? rowUsage);
  const clientUsage = activeUsage
    ? stripAdultRoutingForClient(stripMuseAcceptanceFromUsage(activeUsage), {
        keepInternal: keepInternalAdultRouting,
      })
    : null;
  const activeContent = resolveActiveVariantContent({
    content: row.content,
    variants: variantMeta.variants,
    activeVariant: variantMeta.activeVariant,
  });
  const statusRecord = parseStatusMetaRecord(row.status_meta);
  const markdownStatusWindowActive = row.user_note
    ? markdownPipeTableStatusWindowActive(resolveUserNoteStatusWindowPolicy(row.user_note))
    : false;
  const statusFlags = resolveClientStatusMetaFlags({
    statusRecord,
    messageContent: activeContent,
    userNote: row.user_note ?? undefined,
    markdownStatusWindowActive,
  });
  const activeVariantSnapshot = variants[activeVariant];
  const hasVariantStatusSnapshot = Object.prototype.hasOwnProperty.call(
    activeVariantSnapshot ?? {},
    "statusWidgetValues"
  );
  const messageStatusWidgetValues = hasVariantStatusSnapshot
    ? (activeVariantSnapshot?.statusWidgetValues ?? null)
    : parseStoredStatusWidgetValuesJson(row.status_widget_values_json);
  const suggestedRepliesFields = resolveClientSuggestedReplies(
    parseSuggestedRepliesRecord(row.suggested_replies_json)
  );

  return NextResponse.json({
    messageId: row.id,
    chatId: row.chat_id,
    generationStatus: row.generation_status ?? "generating",
    content: activeContent,
    model: row.model,
    usage: clientUsage,
    variants: variantMeta.variants,
    activeVariant: variantMeta.activeVariant,
    variantCount: variantMeta.variantCount,
    statusWidgetValues: stripExtractedFactsForClient(messageStatusWidgetValues),
    statusWidgetTurnActive: row.status_widget_turn_active === 1,
    statusMetaPending: statusFlags.statusMetaPending,
    statusMetaRequested: statusFlags.statusMetaRequested,
    suggestedRepliesPending: suggestedRepliesFields.suggestedRepliesPending,
    suggestedReplies: suggestedRepliesFields.suggestedReplies,
    userMessageId: row.user_message_id,
    requestId: row.request_id ?? undefined,
    oocSceneRender: oocFlags.oocSceneRender,
    canonAdopted: oocFlags.canonAdopted,
  });
}

function parseIncomingWidgetValues(raw: unknown): ParsedStatusWidgetTurnValues | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as ParsedStatusWidgetTurnValues;
  return sanitizeParsedStatusWidgetValues({
    character: obj.character ?? null,
    user: obj.user ?? null,
  });
}

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json();
  const { messageId, content } = body as {
    messageId?: unknown;
    content?: unknown;
    statusWidgetValues?: unknown;
  };
  const id = Number(messageId);
  let text = typeof content === "string" ? normalizeEditedProseForSave(content) : "";
  if (!id) return NextResponse.json({ error: "messageId가 필요합니다." }, { status: 400 });
  if (!text.trim()) return NextResponse.json({ error: "내용을 입력하세요." }, { status: 400 });

  const msg = assertMessageAccess(user.id, id);
  if (!msg) return NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });

  const maxLen = resolveChatMessageEditLimit(msg);
  if (text.length > maxLen) {
    return NextResponse.json(
      { error: `메시지는 ${maxLen.toLocaleString()}자까지 입력할 수 있습니다.` },
      { status: 400 }
    );
  }

  const db = getDb();
  const keepInternalAdultRouting = keepInternalAdultRoutingForUser(user);
  if (isGreetingMessage(msg)) {
    const variant = editedMessageVariant({ content: text, model: "greeting", usage: null });
    db.prepare("UPDATE messages SET content=?, alternates=NULL, active_variant=0 WHERE id=?").run(
      text,
      id
    );
    return NextResponse.json({
      ok: true,
      content: text,
      ...serializeVariantsForClient([variant], 0, { keepInternalAdultRouting }),
      statusWidgetValues: null,
    });
  }

  const incomingWidgets =
    msg.role === "assistant" ? parseIncomingWidgetValues(body.statusWidgetValues) : null;
  const hasWidgetPatch = msg.role === "assistant" && "statusWidgetValues" in body;

  if (msg.role === "assistant") {
    // Phase B0: detect material prose change vs format-only edit. A material
    // prose edit invalidates episodic facts derived from the old prose (wrong
    // stale memory > missing memory is rejected). Format-only / status-only
    // edits preserve facts.
    const materialProseChange = isMaterialProseEdit(msg.content, text);

    const variant = editedMessageVariant({
      content: text,
      model: msg.model,
      usage: msg.usage ? JSON.parse(msg.usage) : null,
    });

    // Phase B0.1 Fix A: a material prose edit must clear embedded
    // extracted_facts regardless of whether a statusWidgetValues patch was
    // supplied. The canonical stored payload is reconstructed from the
    // existing stored payload: character/user are preserved when no widget
    // patch is supplied; extracted_facts are dropped on material edit.
    const existing = parseStoredStatusWidgetValuesJson(msg.status_widget_values_json);
    const nextCharacter =
      hasWidgetPatch && incomingWidgets?.character
        ? incomingWidgets.character
        : existing.character ?? null;
    const nextUser =
      hasWidgetPatch && incomingWidgets?.user
        ? incomingWidgets.user
        : existing.user ?? null;
    const preserveFacts =
      !materialProseChange && existing.extracted_facts?.length
        ? { extracted_facts: existing.extracted_facts }
        : {};
    const merged: ParsedStatusWidgetTurnValues = {
      character: nextCharacter,
      user: nextUser,
      ...preserveFacts,
    };
    const sanitized = sanitizeParsedStatusWidgetValues(merged);
    const statusWidgetValuesJson = serializeStatusWidgetValuesJson(sanitized);
    const clientWidgetValues = stripExtractedFactsForClient(sanitized);

    // Phase B1-C V1: block manual edits that change canonical numeric field values.
    if (hasWidgetPatch) {
      const characterRow = db
        .prepare("SELECT status_widget_json FROM characters WHERE id=?")
        .get(msg.character_id) as { status_widget_json?: string } | undefined;
      const characterWidget = parseStatusWidgetJson(characterRow?.status_widget_json);
      const numericFields = listCanonicalEligibleNumericFields(characterWidget);
      const numericEligible =
        resolveNumericCanonicalEligibility({
          userId: user.id,
          characterId: msg.character_id,
        }).eligible && numericFields.length > 0;
      if (
        numericEligible &&
        numericCanonicalFieldsChanged(existing, sanitized, numericFields)
      ) {
        return NextResponse.json(
          {
            error: "숫자 상태 직접 수정은 아직 지원되지 않습니다.",
            code: "numeric_state_manual_edit_not_enabled",
          },
          { status: 409 }
        );
      }
    }

    const isLatest = isLatestCanonicalAssistantMessage(db, msg.chat_id, id);
    // Phase B0.2: supersession belongs in the atomic core whenever the
    // latest message's status snapshot is being patched — including
    // material prose + widget edits. Material prose without a widget patch
    // leaves status values unchanged, so triggers stay untouched.
    const supersedeTriggers = hasWidgetPatch && isLatest;

    // Phase B0.1/B0.2: atomic manual-edit core. Message UPDATE + embedded
    // facts clearing + episodic invalidation + (when supersedeTriggers)
    // trigger supersession commit together or roll back together. No
    // "new prose + old memory" or "new status + old trigger" half-state.
    try {
      executeAtomicManualEditCore(db, {
        chatId: msg.chat_id,
        messageId: id,
        content: text,
        alternatesJson: JSON.stringify([variant]),
        statusWidgetValuesJson,
        materialProseChange,
        sourceTurn: getAssistantSourceTurn(db, msg.chat_id, id),
        supersedeTriggers,
        triggerSupersessionReason: supersedeTriggers
          ? "manual_status_edit"
          : undefined,
      });
    } catch (e) {
      console.error(
        "[DerivedState] atomic manual edit core failed:",
        (e as Error).message
      );
      return NextResponse.json(
        { error: "메시지 수정 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    // Phase B0.2: AFTER the canonical core committed, best-effort trigger
    // re-evaluation on the saved sanitized payload. materialProseChange is
    // NOT a gate — material+widget and status-only both re-evaluate.
    // Supersession already happened once inside the core (no double call).
    if (hasWidgetPatch && isLatest) {
      try {
        const sourceTurn = getAssistantSourceTurn(db, msg.chat_id, id);
        if (sourceTurn != null) {
          evaluateStatusWidgetTriggersBestEffort(db, {
            chatId: msg.chat_id,
            characterId: msg.character_id,
            sourceTurn,
            statusValues: sanitized,
            sourceMessageId: id,
            requestId: null,
            generationSequence: null,
          });
        }
      } catch (e) {
        console.error("[StatusTrigger] manual status edit reconcile failed:", (e as Error).message);
      }
    } else if (hasWidgetPatch && !isLatest) {
      // Historical manual widget edit: derived trigger reconciliation is out
      // of scope for B0 (would require downstream replay). Phase B1 numeric
      // chats will fail-closed historical numeric edits.
      console.warn(
        "[DerivedState] HISTORICAL_MANUAL_EDIT_LONG_TERM_SUMMARY_RECONCILIATION_UNVERIFIED — historical status edit; trigger replay not performed"
      );
    }

    return NextResponse.json({
      ok: true,
      content: text,
      ...serializeVariantsForClient([variant], 0, { keepInternalAdultRouting }),
      statusWidgetValues: clientWidgetValues,
    });
  }

  db.prepare("UPDATE messages SET content=? WHERE id=?").run(text, id);
  if (msg.role === "user") {
    recomputeAndPersistUserCoauthorMode(db, msg.chat_id);
  }
  return NextResponse.json({ ok: true, content: text });
}
