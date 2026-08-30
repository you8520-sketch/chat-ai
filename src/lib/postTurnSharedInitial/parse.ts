import {
  dropRepairEchoFields,
  extractJsonObjectFromWidgetText,
  normalizeWidgetExtraction,
  parseCombinedDualWidgetExtractResponse,
} from "@/lib/statusWidget/extractNormalize";
import type { StatusWidget } from "@/lib/statusWidget/types";
import {
  parseSuggestedRepliesFromModelText,
  suggestedRepliesHaveContent,
} from "@/lib/suggestedReplies/parse";
import type { SuggestedReplyItem } from "@/lib/suggestedReplies/types";
import type {
  PostTurnSharedInitialInput,
  PostTurnSharedInitialMode,
  PostTurnSharedInitialParseResult,
  PostTurnSharedSingleWidgetParse,
} from "./types";

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseSingleWidgetSection(
  raw: Record<string, unknown> | null,
  widget: StatusWidget,
  valuesKey: "character_values" | "user_values"
): PostTurnSharedSingleWidgetParse {
  const empty: PostTurnSharedSingleWidgetParse = {
    values: null,
    ok: false,
    echoDroppedKeys: [],
  };
  if (!raw) return empty;
  const section = asJsonRecord(raw[valuesKey]);
  if (!section) return empty;
  let normalized = normalizeWidgetExtraction(section, widget);
  const filtered = dropRepairEchoFields(normalized, widget);
  normalized = filtered.values;
  const keys = Object.entries(normalized).filter(([, v]) => Boolean(v?.trim())).map(([k]) => k);
  if (keys.length === 0) return { ...empty, echoDroppedKeys: filtered.droppedKeys };
  return {
    values: normalized,
    ok: true,
    echoDroppedKeys: filtered.droppedKeys,
  };
}

function extractSuggestedRepliesSection(root: Record<string, unknown>): SuggestedReplyItem[] {
  const section = root.suggestedReplies ?? root.suggested_replies;
  if (!section) return [];
  if (typeof section === "object" && section !== null && !Array.isArray(section)) {
    const items = (section as { items?: unknown }).items;
    if (items != null) {
      return parseSuggestedRepliesFromModelText(JSON.stringify({ items }));
    }
  }
  return parseSuggestedRepliesFromModelText(JSON.stringify(section));
}

export function parsePostTurnSharedInitialResponse(
  text: string,
  input: PostTurnSharedInitialInput
): PostTurnSharedInitialParseResult {
  const empty: PostTurnSharedInitialParseResult = {
    jsonParseOk: false,
    dual: null,
    character: null,
    user: null,
    suggestedReplies: [],
    suggestedRepliesOk: false,
  };
  const root = extractJsonObjectFromWidgetText(text);
  if (!root) return empty;

  const widgetRoot =
    asJsonRecord(root.statusWidget) ??
    (root.character_values != null || root.user_values != null ? root : null);

  let dual: PostTurnSharedInitialParseResult["dual"] = null;
  let character: PostTurnSharedSingleWidgetParse | null = null;
  let user: PostTurnSharedSingleWidgetParse | null = null;

  if (input.mode === "dual" && input.characterWidget && input.userWidget && widgetRoot) {
    dual = parseCombinedDualWidgetExtractResponse(JSON.stringify(widgetRoot), {
      characterWidget: input.characterWidget,
      userWidget: input.userWidget,
      applyEchoFilter: true,
    });
  } else if (input.mode === "character" && input.characterWidget && widgetRoot) {
    character = parseSingleWidgetSection(widgetRoot, input.characterWidget, "character_values");
  } else if (input.mode === "user" && input.userWidget && widgetRoot) {
    user = parseSingleWidgetSection(widgetRoot, input.userWidget, "user_values");
  }

  const suggestedReplies = extractSuggestedRepliesSection(root);

  return {
    jsonParseOk: true,
    dual,
    character,
    user,
    suggestedReplies,
    suggestedRepliesOk: suggestedRepliesHaveContent(suggestedReplies),
  };
}

export function resolvePostTurnSharedInitialMode(input: {
  needCharExtract: boolean;
  needUserExtract: boolean;
}): PostTurnSharedInitialMode | null {
  if (input.needCharExtract && input.needUserExtract) return "dual";
  if (input.needCharExtract) return "character";
  if (input.needUserExtract) return "user";
  return null;
}
