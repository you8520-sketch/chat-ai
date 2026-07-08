import {
  STATUS_VALUES_BLOCK,
  STATUS_VALUES_CHAR_BLOCK,
  STATUS_VALUES_END,
  STATUS_VALUES_USER_BLOCK,
} from "./parseValues";
import { fieldPlaceholderKey } from "./fieldKeys";
import type { ResolvedStatusWidgetTurn, StatusWidget } from "./types";

function fieldLines(widget: StatusWidget, prefix: string): string {
  return widget.fields
    .map((f) => `- ${prefix}${fieldPlaceholderKey(f)}: ${f.instruction}`)
    .join("\n");
}

export function collectWidgetJsonKeys(widget: StatusWidget): string[] {
  const keys = new Set<string>();
  for (const f of widget.fields) {
    const key = fieldPlaceholderKey(f);
    if (key) keys.add(key);
    const id = f.id?.trim();
    if (id) keys.add(id);
  }
  for (const m of widget.htmlTemplate.matchAll(/\{\{([^}]+)\}\}/g)) {
    const k = m[1]?.trim();
    if (k) keys.add(k);
  }
  return [...keys];
}

export const EXTRACTED_FACTS_STATUS_VALUES_INSTRUCTIONS = `Structured facts for future memory:
- Every STATUS_VALUES JSON object MUST include "extracted_facts": [].
- Each item, if any, MUST be exactly: {"category":"...","subject":"...","attribute":"...","value":"...","importance":"...","fact_text":"..."}
- category MUST be one of: relationship, character, setting, item, preference, rule, quest, location, organization.
- subject: short stable snake_case identifier for the entity that owns the fact. Reuse the same identifier for the same entity; never create duplicates.
- attribute: concise snake_case property name. Reuse existing attribute names; do not invent synonyms.
- value: concise current value, short, not a sentence, no spaces.
- importance MUST be one of: critical, important, normal.
- fact_text MUST be one complete Korean sentence understandable without surrounding conversation.
- Extract ONLY NEW or CHANGED long-term facts likely useful in future conversations: relationship changes, important character traits, persistent preferences, acquired items, rules, goals, important locations, organizations, major world changes.
- Never extract greetings, jokes, filler, temporary emotions, transient combat states, one-time reactions, small talk, or information unlikely to matter later.
- If uncertain, omit it. If none, output exactly "extracted_facts": []. Maximum 3 facts.
- NEVER generate source_turn, id, uuid, or timestamp.`;

function jsonExample(widget: StatusWidget): string {
  const obj: Record<string, string | unknown[]> = {};
  for (const k of collectWidgetJsonKeys(widget)) {
    obj[k] = "<scene value>";
  }
  obj.extracted_facts = [];
  return JSON.stringify(obj);
}

export function buildStatusWidgetPromptBlock(resolved: ResolvedStatusWidgetTurn): string {
  if (!resolved.active) return "";

  const parts: string[] = [
    "[STATUS WIDGET — values only, NO HTML]",
    "Do NOT output status window HTML. Do NOT duplicate status in prose.",
    "Use Korean for values unless scene is otherwise. Unknown → \"—\".",
    "Fill every JSON key with a scene-accurate value — never copy \"<scene value>\", \"…\", or \"...\" from the example.",
    EXTRACTED_FACTS_STATUS_VALUES_INSTRUCTIONS,
  ];

  const formatBlocks: string[] = [];

  if (resolved.needsCharacterValues && resolved.characterWidget) {
    parts.push("", "Character widget fields:", fieldLines(resolved.characterWidget, ""));
    formatBlocks.push(
      STATUS_VALUES_CHAR_BLOCK,
      jsonExample(resolved.characterWidget),
      STATUS_VALUES_END
    );
  }

  if (resolved.needsUserValues && resolved.userWidget) {
    parts.push("", "User widget fields:", fieldLines(resolved.userWidget, ""));
    formatBlocks.push(
      STATUS_VALUES_USER_BLOCK,
      jsonExample(resolved.userWidget),
      STATUS_VALUES_END
    );
  }

  if (
    !resolved.needsCharacterValues &&
    !resolved.needsUserValues &&
    resolved.characterWidget
  ) {
    parts.push("", "Fields:", fieldLines(resolved.characterWidget, ""));
    formatBlocks.push(
      STATUS_VALUES_BLOCK,
      jsonExample(resolved.characterWidget),
      STATUS_VALUES_END
    );
  }

  if (formatBlocks.length > 0) {
    parts.push("", "Append format (after RP prose):", ...formatBlocks);
  }

  return parts.join("\n");
}
