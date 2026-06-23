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

function jsonExample(widget: StatusWidget): string {
  const obj: Record<string, string> = {};
  for (const k of collectWidgetJsonKeys(widget)) {
    obj[k] = "<scene value>";
  }
  return JSON.stringify(obj);
}

export function buildStatusWidgetAppendInstruction(): string {
  return `[STATUS WIDGET — append after RP prose]
Append the <<<STATUS_VALUES>>> block at the end. Values only — no status HTML in prose.`;
}

export function buildStatusWidgetPromptBlock(resolved: ResolvedStatusWidgetTurn): string {
  if (!resolved.active) return "";

  const parts: string[] = [
    "[STATUS WIDGET — values only, NO HTML]",
    "Do NOT output status window HTML. Do NOT duplicate status in prose.",
    "Use Korean for values unless scene is otherwise. Unknown → \"—\".",
    "Fill every JSON key with a scene-accurate value — never copy \"<scene value>\", \"…\", or \"...\" from the example.",
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
