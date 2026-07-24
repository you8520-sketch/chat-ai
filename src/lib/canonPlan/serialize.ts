import {
  CANON_COMPILER_VERSION,
  CANON_PLAN_VERSION,
  type CanonPlanV1,
} from "@/lib/canonPlan/types";
import { isValidKnowledgeVisibility } from "@/lib/canonPlan/canonVisibility";

export function serializeCanonPlanV1(plan: CanonPlanV1): string {
  return JSON.stringify(plan);
}

export function parseCanonPlanV1(raw: string | null | undefined): CanonPlanV1 | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CanonPlanV1>;
    if (parsed.version !== CANON_PLAN_VERSION) return null;
    if (parsed.compilerVersion !== CANON_COMPILER_VERSION) return null;
    if (typeof parsed.sourceHash !== "string" || !parsed.sourceHash.trim()) return null;
    if (!Array.isArray(parsed.chunks) || !Array.isArray(parsed.coreIds)) return null;

    const shapedChunks = parsed.chunks.filter(
      (chunk): chunk is CanonPlanV1["chunks"][number] =>
        Boolean(chunk) &&
        typeof chunk === "object" &&
        typeof (chunk as { id?: unknown }).id === "string" &&
        typeof (chunk as { text?: unknown }).text === "string" &&
        typeof (chunk as { bucket?: unknown }).bucket === "string" &&
        typeof (chunk as { order?: unknown }).order === "number"
    );

    // Plan V2/Compiler V3: missing/invalid visibility is fail-closed (reject plan).
    // Do not coerce undefined/unknown → PUBLIC. Lazy recompile handles recovery when raw exists.
    for (const chunk of shapedChunks) {
      if (!isValidKnowledgeVisibility((chunk as { visibility?: unknown }).visibility)) {
        return null;
      }
    }

    const chunks: CanonPlanV1["chunks"] = shapedChunks
      .map((chunk) => {
        const salience: CanonPlanV1["chunks"][number]["salience"] =
          chunk.salience === "core" || chunk.salience === "active" ? chunk.salience : "dormant";
        const source: CanonPlanV1["chunks"][number]["provenance"]["source"] =
          chunk.provenance?.source === "compiled_sentence" ? "compiled_sentence" : "public_canon";
        return {
          ...chunk,
          text: chunk.text.trim(),
          sectionTitle: chunk.sectionTitle ?? "",
          salience,
          visibility: chunk.visibility,
          provenance: {
            sectionIndex: chunk.provenance?.sectionIndex ?? 0,
            paragraphIndex: chunk.provenance?.paragraphIndex ?? 0,
            source,
          },
        };
      })
      .filter((chunk) => chunk.text.length > 0);

    if (chunks.length === 0) return null;

    const coreIds = parsed.coreIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
    const chunkIds = new Set(chunks.map((c) => c.id));
    const validCoreIds = coreIds.filter((id) => chunkIds.has(id));

    return {
      version: CANON_PLAN_VERSION,
      sourceHash: parsed.sourceHash,
      compilerVersion: CANON_COMPILER_VERSION,
      chunks,
      coreIds: validCoreIds,
      provenance: {
        sourceLength: parsed.provenance?.sourceLength ?? 0,
        compiledAt: parsed.provenance?.compiledAt ?? "",
        publicCanonLineCount: parsed.provenance?.publicCanonLineCount ?? 0,
        chunkCount: chunks.length,
      },
      retrieval: {
        activeBudgetChars: parsed.retrieval?.activeBudgetChars ?? 1200,
        archiveBudgetChars: parsed.retrieval?.archiveBudgetChars ?? 1500,
      },
    };
  } catch {
    return null;
  }
}

export function isValidCanonPlanV1(raw: string | null | undefined): boolean {
  return parseCanonPlanV1(raw) !== null;
}
