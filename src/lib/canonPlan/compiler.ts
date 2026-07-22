import {
  classifySettingSectionKnowledge,
  type CanonKnowledgeBucket,
} from "@/lib/characterKnowledgeBoundary";
import { parseCharacterSettingIntoSections } from "@/lib/characterSettingSections";
import { compileCreatorDescriptionTriggers } from "@/lib/creatorDescriptionTriggerCompiler";
import { hashCanonSource, normalizeCanonSource, stableCanonChunkId } from "@/lib/canonPlan/hash";
import {
  CANON_COMPILER_VERSION,
  CANON_PLAN_VERSION,
  type CanonChunkSalience,
  type CanonPlanChunk,
  type CanonPlanCompileResult,
  type CanonPlanV1,
} from "@/lib/canonPlan/types";

const CORE_SECTION_TITLE =
  /(?:^|\[)(?:name|identity|alias|appearance|personality|current\s*status|말투|외형|외모|성격|정체성|이름|호칭|별명|현재\s*신분|speech|abilities|능력|저주|curse|hidden\s*(?:condition|ability)|숨겨진\s*(?:조건|능력|저주))/i;

const CORE_IDENTITY_BODY =
  /^(?:이름|name|본명|별명|정체성|직업|신분|종족|나이|성별)/i;

const CORE_WORLD_LAW =
  /(?:불변|절대\s*규칙|항상\s*적용|must\s*never|immutable|never\s*break|위반\s*불가)/i;

/** Plot hooks / secrets — important but not always-on CORE */
const DORMANT_PLOT_HOOK =
  /(?:비밀|secret|트리거|trigger|조건\s*(?:충족|달성)|해금|루트|고백|폭주|숨긴|모른다|알지\s*못한다|폭로\s*전|발각\s*전)/i;

const DEFAULT_ACTIVE_BUDGET_CHARS = 1200;
const DEFAULT_ARCHIVE_BUDGET_CHARS = 1500;

function splitParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function splitCompiledSentences(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed
      .split(/(?<=[.!?。！？])\s+/)
      .map((p) => p.trim())
      .filter(Boolean);
    out.push(...(parts.length > 0 ? parts : [trimmed]));
  }
  return out;
}

function inferSalience(chunk: Pick<CanonPlanChunk, "text" | "bucket" | "sectionTitle">): CanonChunkSalience {
  if (chunk.bucket === "player" || chunk.bucket === "scenario_meta") return "dormant";
  if (DORMANT_PLOT_HOOK.test(chunk.text)) return "dormant";

  if (chunk.bucket === "character") {
    if (CORE_SECTION_TITLE.test(chunk.sectionTitle)) return "core";
    if (CORE_IDENTITY_BODY.test(chunk.text.slice(0, 48))) return "core";
    return "dormant";
  }

  if (chunk.bucket === "world") {
    if (CORE_WORLD_LAW.test(chunk.text)) return "core";
    return "dormant";
  }

  return "dormant";
}

function pushChunk(
  chunks: CanonPlanChunk[],
  input: {
    text: string;
    bucket: CanonKnowledgeBucket;
    sectionTitle: string;
    sectionIndex: number;
    paragraphIndex: number;
    source: CanonPlanChunk["provenance"]["source"];
  }
): void {
  const text = input.text.trim();
  if (!text) return;
  const id = stableCanonChunkId({
    bucket: input.bucket,
    sectionTitle: input.sectionTitle,
    paragraphIndex: input.paragraphIndex,
    text,
  });
  if (chunks.some((c) => c.id === id)) return;

  const draft = {
    id,
    text,
    salience: "dormant" as CanonChunkSalience,
    bucket: input.bucket,
    order: chunks.length,
    sectionTitle: input.sectionTitle,
    provenance: {
      sectionIndex: input.sectionIndex,
      paragraphIndex: input.paragraphIndex,
      source: input.source,
    },
  };
  draft.salience = inferSalience(draft);
  chunks.push(draft);
}

function compileChunksFromPublicCanon(publicCanonText: string): CanonPlanChunk[] {
  const chunks: CanonPlanChunk[] = [];
  const trimmed = publicCanonText.trim();
  if (!trimmed) return chunks;

  const sections = parseCharacterSettingIntoSections(trimmed);
  if (sections.length === 0) {
    for (const [paragraphIndex, paragraph] of splitParagraphs(trimmed).entries()) {
      pushChunk(chunks, {
        text: paragraph,
        bucket: "character",
        sectionTitle: "",
        sectionIndex: 0,
        paragraphIndex,
        source: "public_canon",
      });
    }
    return chunks;
  }

  for (const [sectionIndex, section] of sections.entries()) {
    for (const classified of classifySettingSectionKnowledge(section)) {
      const paragraphs = splitParagraphs(classified.body);
      if (paragraphs.length === 0) continue;
      for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
        pushChunk(chunks, {
          text: paragraph,
          bucket: classified.bucket,
          sectionTitle: classified.title,
          sectionIndex,
          paragraphIndex,
          source: "public_canon",
        });
      }
    }
  }

  return chunks;
}

function compileChunksFromCompiledSentences(publicCanonLines: string[]): CanonPlanChunk[] {
  const chunks: CanonPlanChunk[] = [];
  for (const [index, sentence] of splitCompiledSentences(publicCanonLines).entries()) {
    pushChunk(chunks, {
      text: sentence,
      bucket: "character",
      sectionTitle: "",
      sectionIndex: 0,
      paragraphIndex: index,
      source: "compiled_sentence",
    });
  }
  return chunks;
}

/** Deterministic merge — structured section chunks win; fill gaps from compiled sentences */
function mergeChunkSources(sectionChunks: CanonPlanChunk[], sentenceChunks: CanonPlanChunk[]): CanonPlanChunk[] {
  if (sectionChunks.length === 0) return sentenceChunks;
  if (sentenceChunks.length === 0) return sectionChunks;

  const seenText = new Set(sectionChunks.map((c) => normalizeCanonSource(c.text)));
  const merged = [...sectionChunks];
  for (const chunk of sentenceChunks) {
    const key = normalizeCanonSource(chunk.text);
    if (seenText.has(key)) continue;
    seenText.add(key);
    merged.push({ ...chunk, order: merged.length });
  }
  return merged;
}

export function compileCanonPlanV1(opts: {
  creatorRawDescription: string;
  compilerDescription?: string;
  now?: string;
}): CanonPlanCompileResult {
  const creatorRawDescription = opts.creatorRawDescription ?? "";
  const normalized = normalizeCanonSource(creatorRawDescription);
  if (!normalized) {
    return { ok: false, error: "empty creator raw description" };
  }

  const compilerDescription =
    opts.compilerDescription?.trim() ||
    normalized;

  let compiled;
  try {
    compiled = compileCreatorDescriptionTriggers({ description: compilerDescription });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "creator description compile failed",
    };
  }

  const publicCanonText = compiled.public_canon.map((line) => line.trim()).filter(Boolean).join("\n\n");
  const sectionChunks = compileChunksFromPublicCanon(publicCanonText);
  const sentenceChunks = compileChunksFromCompiledSentences(compiled.public_canon);
  let chunks = mergeChunkSources(sectionChunks, sentenceChunks);

  for (const [index, note] of compiled.hidden_event_notes.entries()) {
    const text = note.trim();
    if (!text) continue;
    const bucket: CanonKnowledgeBucket =
      /(?:{{user}}|\[B\]|유저(?:만|에게)|플레이어만|player\s*only)/i.test(text) ? "player" : "scenario_meta";
    pushChunk(chunks, {
      text,
      bucket,
      sectionTitle: "hidden_event_note",
      sectionIndex: 9000,
      paragraphIndex: index,
      source: "compiled_sentence",
    });
  }

  chunks = chunks.map((chunk, order) => ({ ...chunk, order }));

  if (chunks.length === 0) {
    return { ok: false, error: "no canon chunks produced" };
  }

  const coreIds = chunks.filter((c) => c.salience === "core").map((c) => c.id);
  const plan: CanonPlanV1 = {
    version: CANON_PLAN_VERSION,
    sourceHash: hashCanonSource(normalized),
    compilerVersion: CANON_COMPILER_VERSION,
    chunks,
    coreIds,
    provenance: {
      sourceLength: normalized.length,
      compiledAt: opts.now ?? new Date(0).toISOString(),
      publicCanonLineCount: compiled.public_canon.length,
      chunkCount: chunks.length,
    },
    retrieval: {
      activeBudgetChars: DEFAULT_ACTIVE_BUDGET_CHARS,
      archiveBudgetChars: DEFAULT_ARCHIVE_BUDGET_CHARS,
    },
  };

  return { ok: true, plan };
}

export function canonCoreInflationMetrics(plan: CanonPlanV1): {
  totalChunks: number;
  coreChunks: number;
  dormantChunks: number;
  coreChars: number;
  totalChars: number;
  coreRatio: number;
} {
  const coreSet = new Set(plan.coreIds);
  const coreChunks = plan.chunks.filter((c) => coreSet.has(c.id));
  const dormantChunks = plan.chunks.length - coreChunks.length;
  const coreChars = coreChunks.reduce((sum, c) => sum + c.text.length, 0);
  const totalChars = plan.chunks.reduce((sum, c) => sum + c.text.length, 0);
  return {
    totalChunks: plan.chunks.length,
    coreChunks: coreChunks.length,
    dormantChunks,
    coreChars,
    totalChars,
    coreRatio: totalChars > 0 ? coreChars / totalChars : 0,
  };
}
