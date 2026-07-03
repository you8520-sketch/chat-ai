import type { ChunkCategory } from "@/types";

/** RP system — speech/register fields are invisible generation instructions, not story facts. */
export const SPEECH_METADATA_INVISIBLE_RULE = `[SPEECH METADATA — INVISIBLE INSTRUCTIONS]
말투·존댓말·register·tone·어조는 대사 "…" 생성에만 적용한다. 서사·지문에서 언급·설명하지 않는다.
Never narrate or describe inside the story: honorific level, speech register, or labels (해요체·하십시오체·하오체·합니다체·반말·존댓말).
Forbidden narration patterns: "해요체로 바뀌었다", "존댓말을 사용", "말투가 공손해졌다", "반말로 말했다" — show change only through dialogue, action, expression, reaction.
한 캐릭터는 한 턴 안에서 register를 섞지 않는다(합니다↔하오↔해요↔이오 전환 금지).`;

const SPEECH_SECTION_RE =
  /말투|speech|어조|대사|금지\s*말투|SPEECH CONSISTENCY|예시\s*대사/i;

/** Literal register label tokens — exported for narration lexicon scan (Group A). */
export const REGISTER_LABEL_PATTERN =
  /(해요체|다나까체|하십시오체|합니다체|하오체|반말|존댓말|반존대|군대식(?:\s*다나까)?(?:체)?|구어체|존댓\s*말|경어|높임말)/i;

const REGISTER_LABEL_RE = REGISTER_LABEL_PATTERN;

const CONTEXT_REGISTER_LINE_RE = /^([^:：\n]{2,48})[:：]\s*(.+)$/;

function formatSection(title: string, body: string): string {
  const t = title.trim();
  const b = body.trim();
  if (!b) return "";
  if (!t || t.startsWith("§")) return b;
  if (b.startsWith(t)) return b;
  return `${t}\n${b}`;
}

export function isSpeechMetadataSection(
  title: string,
  body: string,
  hint?: ChunkCategory
): boolean {
  if (hint === "speech") return true;
  const head = `${title}\n${body.slice(0, 240)}`;
  if (SPEECH_SECTION_RE.test(head)) return true;
  if (REGISTER_LABEL_RE.test(body) && /[:：]|예시|평소|전투|공적|사적|침대|private|formal/i.test(body)) {
    return true;
  }
  return false;
}

const CANONICAL_REGISTER_LABELS = [
  "다나까체",
  "해요체",
  "하십시오체",
  "합니다체",
  "하오체",
  "반말",
  "존댓말",
  "반존대",
  "구어체",
] as const;

function extractRegisterLabel(text: string): string {
  for (const label of CANONICAL_REGISTER_LABELS) {
    if (text.includes(label)) return label;
  }
  const m = text.match(REGISTER_LABEL_RE);
  if (m?.[1]) return m[1].replace(/\s+/g, "");
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 72 ? `${compact.slice(0, 69)}…` : compact;
}

function extractContextRegisterPairs(body: string): { context: string; register: string }[] {
  const pairs: { context: string; register: string }[] = [];
  for (const raw of body.split(/\n/)) {
    const line = raw.trim();
    if (!line || /^예시[:：]?/i.test(line)) continue;
    const m = line.match(CONTEXT_REGISTER_LINE_RE);
    if (!m?.[1] || !m[2]) continue;
    const context = m[1].replace(/^\*+|\*+$/g, "").trim();
    if (context.length < 2) continue;
    pairs.push({ context, register: extractRegisterLabel(m[2]) });
  }
  return pairs.slice(0, 8);
}

function extractDialogueExamples(body: string): string[] {
  const examples: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/"([^"\n]{2,160})"/g)) {
    const q = m[1]?.trim();
    if (!q || seen.has(q)) continue;
    seen.add(q);
    examples.push(`"${q.length > 100 ? `${q.slice(0, 97)}…` : q}"`);
    if (examples.length >= 6) break;
  }
  for (const m of body.matchAll(/「([^」\n]{2,160})」/g)) {
    const q = m[1]?.trim();
    if (!q || seen.has(q)) continue;
    seen.add(q);
    examples.push(`「${q.length > 100 ? `${q.slice(0, 97)}…` : q}」`);
    if (examples.length >= 6) break;
  }
  return examples;
}

function extractStyleNotes(body: string, pairs: { context: string; register: string }[]): string[] {
  const notes: string[] = [];
  for (const raw of body.split(/\n/)) {
    const line = raw.trim();
    if (!line || CONTEXT_REGISTER_LINE_RE.test(line)) continue;
    if (/^예시[:：]?/i.test(line)) continue;
    if (/SPEECH CONSISTENCY|Dialogue style is learned/i.test(line)) continue;
    if (/^[\-*•]\s/.test(line) && line.length >= 8 && line.length <= 200) {
      notes.push(line.replace(/^[\-*•]\s+/, "").trim());
    }
  }
  if (notes.length === 0 && pairs.length === 0) {
    const compact = body.replace(/\s+/g, " ").trim();
    if (compact && !REGISTER_LABEL_RE.test(compact.slice(0, 40))) {
      notes.push(compact.slice(0, 160));
    }
  }
  return notes.slice(0, 4);
}

/** Natural-language speech section → structured generation metadata (not narratable prose). */
export function formatSpeechSectionAsMetadata(title: string, body: string): string {
  const pairs = extractContextRegisterPairs(body);
  const examples = extractDialogueExamples(body);
  const notes = extractStyleNotes(body, pairs);

  const lines: string[] = [
    "[말투 — GENERATION METADATA · NEVER NARRATE]",
    "Apply only when writing [A] quoted dialogue. Not in-world facts.",
  ];

  if (pairs.length > 0) {
    lines.push("", "register_by_context:");
    for (const { context, register } of pairs) {
      lines.push(`- ${context} → ${register}`);
    }
  } else if (REGISTER_LABEL_RE.test(body)) {
    const defaultRegister = extractRegisterLabel(body);
    lines.push("", `default_register: ${defaultRegister}`);
  }

  if (notes.length > 0) {
    lines.push("", "style_notes (do not narrate — dialogue only):");
    for (const n of notes) lines.push(`- ${n}`);
  }

  if (examples.length > 0) {
    lines.push("", "dialogue_examples (style anchors — do not quote labels in narration):");
    for (const ex of examples) lines.push(`- ${ex}`);
  }

  if (pairs.length === 0 && examples.length === 0 && notes.length === 0) {
    const compact = body.replace(/\s+/g, " ").trim();
    if (compact) {
      lines.push("", "creator_notes (metadata — never narrate):");
      lines.push(`- ${compact.length > 240 ? `${compact.slice(0, 237)}…` : compact}`);
    }
  }

  return lines.join("\n");
}
