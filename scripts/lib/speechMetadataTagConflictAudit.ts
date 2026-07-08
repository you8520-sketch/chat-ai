/**
 * Step 7.6b pre-prod — Step 4: SPEECH METADATA vs example tag parser conflict audit.
 */

import { formatSpeechSectionAsMetadata, isSpeechMetadataSection } from "@/lib/speechMetadataPolicy";
import {
  filterTaggedExampleDialogBody,
  inferSceneRegisterContext,
  SPEECH_CONTEXT_TAG_RE,
  stripLeadingContextTag,
} from "@/lib/exampleDialogSceneFilter";

export type ConflictCase = {
  id: string;
  input: string;
  context: "speech_card" | "example_dialog" | "mixed_block";
  metadataResult: string;
  tagParserResult: string;
  diverges: boolean;
  note: string;
};

const CASES: { id: string; context: ConflictCase["context"]; input: string; note: string }[] = [
  {
    id: "card-context-line",
    context: "speech_card",
    input: "공적인 자리: 건조한 군대식 다나까체",
    note: "# 말투 card line — metadata extracts context→register pair",
  },
  {
    id: "example-tag-line",
    context: "example_dialog",
    input: "[공적] 유저: 적이다!",
    note: "Example tag — tag parser strips [공적], metadata ignores (no colon register line)",
  },
  {
    id: "card-bed-line",
    context: "speech_card",
    input: "침대: 속삭이는 해요체, 짧은 문장",
    note: "Card uses 침대: register prose — NOT a bracket tag",
  },
  {
    id: "example-bed-line",
    context: "example_dialog",
    input: "[침대] 유저: …불 끌까?",
    note: "Example bracket tag — filter bucket bed",
  },
  {
    id: "prose-mention",
    context: "speech_card",
    input: "유저와 둘만 있을 때는 사적 공간이므로 해요체를 쓴다.",
    note: "Prose mentions 사적 — metadata may classify section; not an example tag",
  },
  {
    id: "colon-public-in-example",
    context: "example_dialog",
    input: "공적: …각오하십시오.",
    note: "Missing bracket — metadata pair vs tag parser (no SPEECH_CONTEXT_TAG match)",
  },
  {
    id: "english-tag",
    context: "example_dialog",
    input: "[public] User: Enemy!",
    note: "English alias — tag parser maps to public bucket",
  },
  {
    id: "paren-tag",
    context: "example_dialog",
    input: "(침대) 유저: …가까이 와도 돼?",
    note: "Paren form — REJECTED since Step 4 bracket-only decision (parser returns no tag)",
  },
];

function runMetadata(input: string): string {
  const isMeta = isSpeechMetadataSection("말투", input, "speech");
  if (!isMeta) return "(not speech metadata section)";
  return formatSpeechSectionAsMetadata("말투", input).split("\n").slice(0, 6).join("\n");
}

function runTagParser(input: string, scene = "bed"): string {
  const stripped = stripLeadingContextTag(input);
  const tagMatch = input.match(SPEECH_CONTEXT_TAG_RE);
  const filtered = filterTaggedExampleDialogBody(input, inferSceneRegisterContext({ userMessage: "불 끌까?" }));
  return [
    `strip: tag=${stripped.tag ?? "null"} rest="${stripped.rest.slice(0, 40)}"`,
    `regex: ${tagMatch ? tagMatch[1] : "no match"}`,
    `filter(hadTags=${filtered.hadTags}, pairs=${filtered.injectedCount}): ${filtered.filtered.slice(0, 60)}`,
  ].join(" | ");
}

export function runSpeechMetadataTagConflictAudit(): ConflictCase[] {
  return CASES.map((c) => {
    const metadataResult = runMetadata(c.input);
    const tagParserResult = runTagParser(c.input);
    const diverges =
      c.context === "speech_card" &&
      tagParserResult.includes("regex: no match") &&
      metadataResult.includes("register_by_context");
    return {
      id: c.id,
      input: c.input,
      context: c.context,
      metadataResult,
      tagParserResult,
      diverges: diverges || (c.id === "colon-public-in-example"),
      note: c.note,
    };
  });
}

export function summarizeCoexistenceRules(): string[] {
  return [
    "**Different layers:** `speechMetadataPolicy` processes `# 말투` card prose at canon build (save-time / Patch B); `exampleDialogSceneFilter` processes `[예시 대화]` at assembly (runtime, env-gated).",
    "**Same vocabulary, different syntax:** Card uses `공적인 자리: 다나까체` (CONTEXT_REGISTER_LINE_RE); examples use `[공적] 유저: …` (SPEECH_CONTEXT_TAG_RE). Word `공적`/`사적`/`침대` appears in both but with different grammars.",
    "**No double-parse on one line today:** Production canon path uses `formatSection()` not `formatSpeechSectionAsMetadata()` (Patch A). Metadata formatter is dead at runtime unless REGISTER_METADATA patch enabled.",
    "**Risk case — unbracketed `공적:` in example_dialog:** Metadata would read as register pair; tag filter would NOT treat as tag → filter may inject all tagged pairs or wrong subset. **Mitigation:** creator UI/docs require bracket tags in examples only.",
    "**Risk case — `[공적]` in # 말투 body:** Unlikely; if present, tag filter does not run on speech chunk (only [예시 대화] section). Metadata might mis-parse if Patch B on.",
    "**Risk case — scene cue regex overlap:** Filter infers bed from user text (`불 끌`, `가까이`); unrelated to metadata parser.",
  ];
}
