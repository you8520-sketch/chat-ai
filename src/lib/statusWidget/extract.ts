import { callBackgroundMemory, type TokenUsage } from "@/lib/ai";
import { collectWidgetJsonKeys } from "./prompt";
import {
  buildWidgetExtractSystem,
  buildWidgetExtractUserBlock,
  extractJsonObjectFromWidgetText,
  normalizeWidgetExtraction,
} from "./extractNormalize";
import { mergeStatusWidgetExtractUsages } from "./receiptUsage";
import { mergeExtractedFacts, sanitizeExtractedFacts } from "./extractedFacts";
import { logStatusWidgetLiveTrace, statusWidgetDiagnosticHash } from "./diagnostics";
import type {
  ExtractedStatusFact,
  ParsedStatusWidgetTurnValues,
  ResolvedStatusWidgetTurn,
  StatusWidget,
  StatusWidgetValues,
} from "./types";

async function extractStatusWidgetValuesForWidget(opts: {
  charName: string;
  characterIdentity?: string | null;
  personaName: string;
  userPersona?: string | null;
  userMessage: string;
  assistantProse: string;
  widget: StatusWidget;
  source: "character" | "user";
  previousValues?: StatusWidgetValues | null;
  previousAssistantProse?: string | null;
  userNote?: string;
  trace?: { requestId?: string | null; chatId?: number | null; messageId?: number | null };
}): Promise<{ values: StatusWidgetValues | null; facts: ExtractedStatusFact[]; usage: TokenUsage | null }> {
  const keys = collectWidgetJsonKeys(opts.widget);
  if (keys.length === 0) return { values: null, facts: [], usage: null };

  const system = buildWidgetExtractSystem(opts.widget, keys, opts.source);
  const userBlock = buildWidgetExtractUserBlock(opts);

  try {
    const { text, usage } = await callBackgroundMemory(
      system,
      [{ role: "user", content: userBlock }],
      undefined,
      "background-status-widget-extract"
    );
    const parsed = extractJsonObjectFromWidgetText(text);
    logStatusWidgetLiveTrace({
      ...opts.trace,
      phase: "v3_extract_result",
      v3ExtractCalled: true,
      v3ExtractSucceeded: Boolean(parsed),
      v3ExtractReturnedTextLength: text.length,
      v3ExtractJsonFound: Boolean(parsed),
      contentHash: statusWidgetDiagnosticHash(text),
      reasonCode: parsed ? "OK" : text.trim() ? "V3_PARSE_FAILED" : "V3_EMPTY_OUTPUT",
    });
    if (!parsed) {
      console.warn("[STATUS-WIDGET] JSON parse failed", {
        source: opts.source,
        textLength: text.length,
        textHash: statusWidgetDiagnosticHash(text),
      });
      return { values: null, facts: [], usage };
    }
    const normalized = normalizeWidgetExtraction(parsed, opts.widget);
    const values = Object.keys(normalized).length > 0 ? normalized : null;
    return { values, facts: sanitizeExtractedFacts(parsed.extracted_facts), usage };
  } catch (e) {
    console.error("[STATUS-WIDGET-ERROR] extract call failed", (e as Error).message);
    logStatusWidgetLiveTrace({
      ...opts.trace,
      phase: "v3_extract_result",
      v3ExtractCalled: true,
      v3ExtractSucceeded: false,
      v3ExtractReturnedTextLength: 0,
      v3ExtractJsonFound: false,
      reasonCode: "V3_EMPTY_OUTPUT",
    });
    return { values: null, facts: [], usage: null };
  }
}

export async function extractStatusWidgetValuesForTurn(opts: {
  charName: string;
  characterIdentity?: string | null;
  personaName: string;
  userPersona?: string | null;
  userMessage: string;
  assistantProse: string;
  resolved: ResolvedStatusWidgetTurn;
  previousValues?: ParsedStatusWidgetTurnValues | null;
  previousAssistantProse?: string | null;
  userNote?: string;
  trace?: { requestId?: string | null; chatId?: number | null; messageId?: number | null };
}): Promise<{ values: ParsedStatusWidgetTurnValues; usage: TokenUsage | null }> {
  const out: ParsedStatusWidgetTurnValues = {};
  const usages: TokenUsage[] = [];

  if (opts.resolved.needsCharacterValues && opts.resolved.characterWidget) {
    const character = await extractStatusWidgetValuesForWidget({
      charName: opts.charName,
      characterIdentity: opts.characterIdentity,
      personaName: opts.personaName,
      userPersona: opts.userPersona,
      userMessage: opts.userMessage,
      assistantProse: opts.assistantProse,
      widget: opts.resolved.characterWidget,
      source: "character",
      previousValues: opts.previousValues?.character ?? null,
      previousAssistantProse: opts.previousAssistantProse,
      userNote: opts.userNote,
      trace: opts.trace,
    });
    out.character = character.values;
    out.extracted_facts = mergeExtractedFacts(out.extracted_facts, character.facts);
    if (character.usage) usages.push(character.usage);
  }

  if (opts.resolved.needsUserValues && opts.resolved.userWidget) {
    const user = await extractStatusWidgetValuesForWidget({
      charName: opts.charName,
      characterIdentity: opts.characterIdentity,
      personaName: opts.personaName,
      userPersona: opts.userPersona,
      userMessage: opts.userMessage,
      assistantProse: opts.assistantProse,
      widget: opts.resolved.userWidget,
      source: "user",
      previousValues: opts.previousValues?.user ?? null,
      previousAssistantProse: opts.previousAssistantProse,
      userNote: opts.userNote,
      trace: opts.trace,
    });
    out.user = user.values;
    out.extracted_facts = mergeExtractedFacts(out.extracted_facts, user.facts);
    if (user.usage) usages.push(user.usage);
  }

  return { values: out, usage: mergeStatusWidgetExtractUsages(usages) };
}
