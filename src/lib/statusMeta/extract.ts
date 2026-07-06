import { callBackgroundMemory } from "@/lib/ai";
import { loadChatRelationshipMeta } from "@/lib/memory/memory-relationship-meta";
import {
  buildFilledTableMarkdown,
  isPlainTextStatusFormatSpec,
  normalizeTemplateFilledRows,
  parseFormatSpecStructure,
  plainTextStatusFieldCount,
  plainTextStatusFieldLines,
  rebalanceTableMarkdownWithFormatSpec,
  stripLabelPrefixFromValue,
} from "./formatSpec";
import { formatPreviousTurnStatusContext } from "./previousStatusContext";
import type { StatusMeta } from "./types";
import { EMPTY_STATUS_META, normalizeStatusMeta } from "./types";

/** DeepSeek V3 background-status-meta-extract ONLY — never inject into main RP system prompt */
export const EXTRACT_TIMEKEEPER_RULE = `[TIMEKEEPER RULE: NARRATIVE TIME PROGRESSION]
1. You are the Timekeeper of this roleplay. You must calculate the current time dynamically based ONLY on the actions and narrative flow described in the recent text.
2. Analyze the 'in-universe duration' of the recent actions:
   - Brief dialogue or quick actions (e.g., a short combat exchange, a quick kiss): +1 to 5 minutes.
   - Moderate tasks (e.g., taking a shower, eating a meal, a walk): +20 to 60 minutes.
   - Long events or explicit time skips (e.g., "After arriving in the city", "They slept"): +several hours.
   - Explicit mentions of time (e.g., "It is now midnight", "The morning sun rose"): Override previous time and set exactly to the narrative text.
3. Always reference the 'Previous Turn Status Meta' to know the starting point of the current time calculation.
4. Ensure the output format strictly follows the standard (e.g., "14:30" or "오후 2시 30분") and never leave it blank or write "Unknown" if an OOC hint like 🕒00:00 is provided.`;

/** Shared — legacy datetime/location + template 🕒/🏠 slots */
export const EXTRACT_ACTIVE_TIME_LOCATION_RULES = `- Active time/location deduction (MANDATORY for datetime & location, or 🕒/🏠 template cells):
  Do NOT only copy text that literally states a clock time or place name.
  Apply TIMEKEEPER RULE above: start from [PREVIOUS TURN STATUS META] clock anchor, then advance by in-universe duration of this turn's actions.
  Update location when the scene moves.

- OOC / template trigger recognition (MANDATORY):
  When the user note, user message, or status template uses hints like 🕒00:00, 🏠00, 🕒, 🏠, "00:00",
  or OOC/parenthetical status-window requests, treat that as a STRONG instruction:
  "Calculate and refresh time and place from context."
  If such hints appear, NEVER leave datetime, location, or 🕒/🏠 placeholder cells empty —
  infer plausible, scene-consistent values and fill them.`;

const EXTRACT_LEGACY_SYSTEM = `You extract RP scene status metadata as JSON only. No prose, no markdown fences.
Return a single JSON object with these keys:
datetime, location, relationship, npcEmotion, npcIntent, nextObjective, hiddenThought, sceneSummary

${EXTRACT_TIMEKEEPER_RULE}

${EXTRACT_ACTIVE_TIME_LOCATION_RULES}

Other rules:
- Korean values preferred when the scene is Korean.
- datetime: apply TIMEKEEPER RULE; output short clock label (e.g. "14:30", "오후 2시 30분").
- location: short place name where the scene is happening now.
- npcIntent / nextObjective: short bullet phrases joined with " · " if multiple.
- hiddenThought: one short inner-voice line without outer quotes in JSON.
- Never invent lore that contradicts the provided context.
- For fields OTHER than datetime/location: use "" only when truly no evidence; never fail.`;

function buildTemplateExtractSystem(rowCount: number): string {
  return `You fill a user-defined status window pipe-table from RP scene context. Return JSON only — no prose, no markdown fences.

Return exactly:
{ "rows": [ ["cell0","cell1",...], ... ] }

${EXTRACT_TIMEKEEPER_RULE}

${EXTRACT_ACTIVE_TIME_LOCATION_RULES}

Template rules:
- "rows" must contain EXACTLY ${rowCount} arrays — one per template data row, in order.
- Keep each row's LABEL cells (emoji + field names from template) unchanged unless filling a placeholder slot.
- NEVER repeat a row label in the value column — if you have no value yet, use "—".
- For 🕒/🏠 cells: apply TIMEKEEPER RULE from [PREVIOUS TURN STATUS META] starting clock, then write result as "🕒 14:30" / "🏠 place name" style — never 00:00, empty, or "Unknown" when OOC hints exist.
- Label-only rows: keep the label in column 0; put extracted content in the next column(s).
- Rows listing multiple slots in ONE label (e.g. "하고 싶은 것 1, 2, 3"): put ALL values in ONE cell beside the label, joined with " · " — NEVER split into separate table columns.
- Korean preferred when the scene is Korean.
- For non-time/place rows: use "—" only when there is truly no in-scene evidence.
- Do NOT add fields, rows, or columns beyond the template.
- Do NOT add NPC goals, emotions, or relationship fields unless the template row asks for them.`;
}

function buildPlainTextExtractSystem(fieldCount: number): string {
  return `You fill a user-defined plain-text status window from RP scene context. Return JSON only — no markdown fences, no HTML.

Return exactly:
{ "lines": ["filled line 1", "filled line 2", ... ] }

${EXTRACT_TIMEKEEPER_RULE}

Rules:
- Output EXACTLY ${fieldCount} strings in "lines", one per user template field, in order.
- Each string MUST keep the template emoji + label text, then add the scene value after " : " (space-colon-space).
- Plain Korean prose only — NO pipe tables (|), NO HTML, NO code blocks.
- Korean preferred when the scene is Korean.
- For rows listing multiple slots in ONE label (e.g. "하고 싶은 것 1, 2, 3"): join values with " · " in the same line.
- The doodle/graffiti row (낙서/카오모지/이모지 in label) MAY include kaomoji/emojis in the value part only.
- Use "—" as the value when there is truly no in-scene evidence.
- Do NOT invent lore that contradicts the provided context.`;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1]!.trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildExtractUserBlock(opts: {
  charName: string;
  characterIdentity?: string | null;
  personaName: string;
  userPersona?: string | null;
  userMessage: string;
  assistantProse: string;
  userNote?: string;
  memoryBlock?: string;
  loreBlock?: string;
  previousMeta?: StatusMeta | null;
  formatSpec?: string | null;
  chatId: number;
}): string {
  const rel = loadChatRelationshipMeta(opts.chatId);
  const memoryHints = [
    rel.thoughts?.length ? `NPC thoughts (memory): ${rel.thoughts.slice(-3).join(" · ")}` : "",
    rel.items?.length ? `Items: ${rel.items.slice(-3).join(" · ")}` : "",
    rel.promises?.length
      ? `Promises: ${rel.promises
          .slice(-2)
          .map((p) => p.text)
          .join(" · ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const previousTurnBlock = formatPreviousTurnStatusContext(opts.previousMeta);

  const hasTimeLocationHints =
    /🕒|🏠|00:00|OOC|ooc|상태창/i.test(
      [opts.formatSpec, opts.userNote, opts.userMessage].filter(Boolean).join("\n")
    );

  const structure = opts.formatSpec?.trim()
    ? parseFormatSpecStructure(opts.formatSpec)
    : null;

  return [
    previousTurnBlock,
    opts.formatSpec?.trim()
      ? isPlainTextStatusFormatSpec(opts.formatSpec.trim())
        ? `[USER STATUS FORMAT — plain text lines; fill values after " : "]\n${opts.formatSpec.trim()}`
        : `[USER STATUS FORMAT — preserve row labels; fill placeholders only]\n${opts.formatSpec.trim()}`
      : "",
    structure && structure.dataRowTemplates.length > 0
      ? `[TEMPLATE ROW COUNT]\n${structure.dataRowTemplates.length}`
      : "",
    opts.formatSpec?.trim() && isPlainTextStatusFormatSpec(opts.formatSpec.trim())
      ? `[PLAIN TEXT FIELD COUNT]\n${plainTextStatusFieldCount(opts.formatSpec.trim())}`
      : "",
    hasTimeLocationHints
      ? `[OOC TIME/PLACE TRIGGER DETECTED]\nUser or template requested status refresh — apply TIMEKEEPER RULE from previous turn clock anchor + this turn's narrative. Do not leave 🕒/🏠 or datetime/location blank.`
      : "",
    opts.userNote?.trim() ? `[USER NOTE]\n${opts.userNote.trim()}` : "",
    opts.memoryBlock?.trim() ? `[MEMORY]\n${opts.memoryBlock.trim()}` : memoryHints,
    opts.loreBlock?.trim() ? `[ACTIVE LORE]\n${opts.loreBlock.trim()}` : "",
    `[CHARACTER] ${opts.charName}`,
    opts.characterIdentity?.trim() ? `[CHARACTER IDENTITY — MUST OBEY]\n${opts.characterIdentity.trim()}` : "",
    `[USER] ${opts.personaName}`,
    opts.userPersona?.trim() ? `[USER PERSONA — MUST OBEY]\n${opts.userPersona.trim()}` : "",
    `[USER MESSAGE]\n${opts.userMessage}`,
    `[ASSISTANT REPLY — prose only]\n${opts.assistantProse.slice(0, 6000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function normalizeTemplateExtraction(
  parsed: Record<string, unknown>,
  formatSpec: string
): StatusMeta {
  const structure = parseFormatSpecStructure(formatSpec);
  if (structure.dataRowTemplates.length === 0) {
    return { tableMarkdown: "" };
  }

  let tableMarkdown: string;
  if (typeof parsed.tableMarkdown === "string" && parsed.tableMarkdown.trim()) {
    tableMarkdown = parsed.tableMarkdown.trim();
  } else {
    const filledRows = normalizeTemplateFilledRows(structure, parsed.rows);
    tableMarkdown = buildFilledTableMarkdown(structure, filledRows);
  }
  return { tableMarkdown: rebalanceTableMarkdownWithFormatSpec(tableMarkdown, formatSpec) };
}

function normalizePlainTextExtraction(
  parsed: Record<string, unknown>,
  formatSpec: string
): StatusMeta {
  const templates = plainTextStatusFieldLines(formatSpec);
  const expected = plainTextStatusFieldCount(formatSpec) || templates.length;

  if (typeof parsed.plainTextStatus === "string" && parsed.plainTextStatus.trim()) {
    return { tableMarkdown: parsed.plainTextStatus.trim() };
  }

  const rawLines = Array.isArray(parsed.lines)
    ? parsed.lines.map((line) => (typeof line === "string" ? line.trim() : String(line).trim()))
    : [];

  if (rawLines.length === 0) return { tableMarkdown: "" };

  const out: string[] = [];
  for (let i = 0; i < expected; i++) {
    const template = templates[i]?.trim() ?? "";
    const filled = rawLines[i]?.trim() ?? "";
    if (!filled) {
      out.push(template ? `${template} : —` : "—");
      continue;
    }
    const stripped = template ? stripLabelPrefixFromValue(template, filled) : filled;
    if (template && stripped !== filled) {
      out.push(stripped ? `${template} : ${stripped.replace(/^[—\-–]\s*/, "")}` : `${template} : —`);
      continue;
    }
    if (template && !filled.includes(template.slice(0, Math.min(6, template.length)))) {
      out.push(`${template} : ${filled.replace(/^[—\-–]\s*/, "")}`);
    } else {
      out.push(filled);
    }
  }

  return { tableMarkdown: out.join("\n").trim() };
}

export async function extractStatusMetaFromTurn(opts: {
  chatId: number;
  charName: string;
  characterIdentity?: string | null;
  personaName: string;
  userPersona?: string | null;
  userMessage: string;
  assistantProse: string;
  userNote?: string;
  memoryBlock?: string;
  loreBlock?: string;
  previousMeta?: StatusMeta | null;
  formatSpec?: string | null;
}): Promise<StatusMeta> {
  const userBlock = buildExtractUserBlock(opts);
  const formatSpec = opts.formatSpec?.trim() ?? "";
  const structure = formatSpec ? parseFormatSpecStructure(formatSpec) : null;
  const usePlain = formatSpec ? isPlainTextStatusFormatSpec(formatSpec) : false;
  const useTemplate = Boolean(structure && structure.dataRowTemplates.length > 0);

  const system = usePlain
    ? buildPlainTextExtractSystem(plainTextStatusFieldCount(formatSpec))
    : useTemplate
      ? buildTemplateExtractSystem(structure!.dataRowTemplates.length)
      : EXTRACT_LEGACY_SYSTEM;

  try {
    const { text } = await callBackgroundMemory(
      system,
      [{ role: "user", content: userBlock }],
      undefined,
      "background-status-meta-extract"
    );
    const parsed = extractJsonObject(text);
    if (!parsed) {
      console.warn("[STATUS-META] JSON parse failed", {
        chatId: opts.chatId,
        preview: text.slice(0, 200),
      });
      return { ...EMPTY_STATUS_META };
    }

    if (usePlain && formatSpec) {
      return normalizePlainTextExtraction(parsed, formatSpec);
    }
    if (useTemplate && formatSpec) {
      return normalizeTemplateExtraction(parsed, formatSpec);
    }
    return normalizeStatusMeta(parsed);
  } catch (e) {
    console.error("[STATUS-META-ERROR] extract call failed", (e as Error).message);
    return { ...EMPTY_STATUS_META };
  }
}

/** @internal tests */
export function buildStatusMetaExtractSystemForTest(opts: {
  formatSpec?: string | null;
}): string {
  const formatSpec = opts.formatSpec?.trim() ?? "";
  const structure = formatSpec ? parseFormatSpecStructure(formatSpec) : null;
  const usePlain = formatSpec ? isPlainTextStatusFormatSpec(formatSpec) : false;
  const useTemplate = Boolean(structure && structure.dataRowTemplates.length > 0);
  return usePlain
    ? buildPlainTextExtractSystem(plainTextStatusFieldCount(formatSpec))
    : useTemplate
      ? buildTemplateExtractSystem(structure!.dataRowTemplates.length)
      : EXTRACT_LEGACY_SYSTEM;
}

export function buildStatusMetaExtractUserBlockForTest(
  opts: Parameters<typeof buildExtractUserBlock>[0]
): string {
  return buildExtractUserBlock(opts);
}
