import { callBackgroundMemory, type TokenUsage } from "@/lib/ai";
import { collectWidgetJsonKeys } from "./prompt";
import {
  buildWidgetExtractSystem,
  buildWidgetExtractUserBlock,
  extractJsonObjectFromWidgetText,
  normalizeWidgetExtraction,
} from "./extractNormalize";
import { mergeStatusWidgetExtractUsages } from "./receiptUsage";
import type {
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
}): Promise<{ values: StatusWidgetValues | null; usage: TokenUsage | null }> {
  const keys = collectWidgetJsonKeys(opts.widget);
  if (keys.length === 0) return { values: null, usage: null };

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
    if (!parsed) {
      console.warn("[STATUS-WIDGET] JSON parse failed", {
        source: opts.source,
        preview: text.slice(0, 200),
      });
      return { values: null, usage };
    }
    const normalized = normalizeWidgetExtraction(parsed, opts.widget, opts.previousValues);
    const values = Object.keys(normalized).length > 0 ? normalized : null;
    return { values, usage };
  } catch (e) {
    console.error("[STATUS-WIDGET-ERROR] extract call failed", (e as Error).message);
    return { values: null, usage: null };
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
    });
    out.character = character.values;
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
    });
    out.user = user.values;
    if (user.usage) usages.push(user.usage);
  }

  return { values: out, usage: mergeStatusWidgetExtractUsages(usages) };
}
