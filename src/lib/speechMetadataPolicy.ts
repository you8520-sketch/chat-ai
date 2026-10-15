import type { ChunkCategory } from "@/types";

/** RP system — speech/register fields are invisible generation instructions, not story facts. */
export const SPEECH_METADATA_INVISIBLE_RULE = `[SPEECH METADATA — INVISIBLE INSTRUCTIONS]
말투·존댓말·register·tone·어조는 대사 "…" 생성에만 적용한다. 서사·지문에서 언급·설명하지 않는다.
Never narrate or describe inside the story: honorific level, speech register, or labels (해요체·하십시오체·하오체·합니다체·반말·존댓말).
Forbidden narration patterns: "해요체로 바뀌었다", "존댓말을 사용", "말투가 공손해졌다", "반말로 말했다" — show change only through dialogue, action, expression, reaction.
같은 상대에게는 한 턴 안에서 register를 이유 없이 섞지 않는다(합니다↔하오↔해요↔이오 전환 금지). 제작자가 상대·상황별로 다른 말투를 명시하면 그 조건을 따른다.`;

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

function preserveStyleText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Curly quotes → ASCII. Single owner shared by speech extraction, anchors, validator and Muse boundary. */
export function normalizeSmartQuotes(text: string): string {
  return text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

const MAX_CONTEXT_REGISTER_PAIRS = 8;
const MAX_DIALOGUE_EXAMPLES = 6;
const MAX_EXAMPLE_DISPLAY_LENGTH = 100;
const BOILERPLATE_LINE_RE =
  /SPEECH CONSISTENCY|Dialogue style is learned|Dialogue examples are the strongest/i;
const EXAMPLE_HEADER_RE = /^예시[:：]?/i;
/** 원문 따옴표 모양(" “” 「」)을 그대로 보존한다 — 예시 대사 줄 자체는 변형하지 않는다. */
const QUOTED_EXAMPLE_PATTERNS: RegExp[] = [
  /(["“])([^"“”\n]{2,160})(["”])/g,
  /(「)([^」\n]{2,160})(」)/g,
];

type MetadataLine =
  | { kind: "pair"; context: string; style: string }
  | { kind: "residual"; text: string };

type ExtractedExamples = {
  display: string[];
  /** 전문이 display에 그대로 실린 인용문 — 잔여 문장에서 제거해도 내용이 사라지지 않는다. */
  consumed: Set<string>;
};

function extractDialogueExamples(body: string): ExtractedExamples {
  const display: string[] = [];
  const consumed = new Set<string>();
  const seen = new Set<string>();
  for (const re of QUOTED_EXAMPLE_PATTERNS) {
    for (const m of body.matchAll(re)) {
      if (display.length >= MAX_DIALOGUE_EXAMPLES) break;
      const [, open = "", inner = "", close = ""] = m;
      const q = inner.trim();
      if (!q || seen.has(q)) continue;
      seen.add(q);
      const truncated = q.length > MAX_EXAMPLE_DISPLAY_LENGTH;
      if (!truncated) consumed.add(m[0]);
      display.push(`${open}${truncated ? `${q.slice(0, MAX_EXAMPLE_DISPLAY_LENGTH - 3)}…` : q}${close}`);
    }
  }
  return { display, consumed };
}

/**
 * 줄 단위 분류 — 조건:말투 쌍은 register_by_context로, 나머지는 문장 그대로 잔여 지시문으로 보존한다.
 * 쌍 상한(8)을 넘은 줄도 버리지 않고 잔여로 남긴다.
 */
function classifyMetadataLines(body: string, consumedExamples: Set<string>): MetadataLine[] {
  const lines: MetadataLine[] = [];
  let pairCount = 0;
  for (const raw of body.split(/\n/)) {
    const line = raw.trim();
    if (!line || BOILERPLATE_LINE_RE.test(line)) continue;
    const m = EXAMPLE_HEADER_RE.test(line) ? null : line.match(CONTEXT_REGISTER_LINE_RE);
    const context = m?.[1]?.replace(/^\*+|\*+$/g, "").trim() ?? "";
    const style = m?.[2] ? preserveStyleText(m[2]) : "";
    if (context.length >= 2 && style && pairCount < MAX_CONTEXT_REGISTER_PAIRS) {
      pairCount += 1;
      lines.push({ kind: "pair", context, style });
      continue;
    }
    let residual = line;
    for (const quoted of consumedExamples) residual = residual.split(quoted).join(" ");
    residual = preserveStyleText(
      residual.replace(/^[\-*•]\s+/, "").replace(EXAMPLE_HEADER_RE, "").replace(/^[\s,.·:：]+|[\s,]+$/g, "")
    );
    if (residual.length >= 2) lines.push({ kind: "residual", text: residual });
  }
  return lines;
}

/** Natural-language speech section → structured generation metadata (not narratable prose). */
export function formatSpeechSectionAsMetadata(title: string, body: string): string {
  void title;
  const examples = extractDialogueExamples(body);
  const classified = classifyMetadataLines(body, examples.consumed);
  const pairs = classified.filter((l): l is Extract<MetadataLine, { kind: "pair" }> => l.kind === "pair");
  const notes = classified.filter((l): l is Extract<MetadataLine, { kind: "residual" }> => l.kind === "residual");

  const lines: string[] = [
    "[말투 — GENERATION METADATA · NEVER NARRATE]",
    "Apply only when writing [A] quoted dialogue. Not in-world facts.",
  ];

  if (pairs.length > 0) {
    lines.push("", "register_by_context:");
    for (const { context, style } of pairs) {
      lines.push(`- ${context} → ${style}`);
    }
  }

  if (notes.length > 0) {
    lines.push("", "style_notes (do not narrate — dialogue only):");
    for (const n of notes) lines.push(`- ${n.text}`);
  }

  if (examples.display.length > 0) {
    lines.push("", "dialogue_examples (style anchors — do not quote labels in narration):");
    for (const ex of examples.display) lines.push(`- ${ex}`);
  }

  return lines.join("\n");
}
