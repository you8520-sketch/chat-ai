import type Database from "better-sqlite3";

export type GmProviderTimings = {
  startAtMs: number;
  firstChunkAtMs: number | null;
  completeAtMs: number | null;
};

export type GmNarrationDraft = {
  generationId: string;
  text: string;
  updatedAtMs: number;
  providerTimings?: GmProviderTimings;
};

function parseDraft(raw: string | null | undefined): GmNarrationDraft | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<GmNarrationDraft>;
    if (typeof parsed.generationId !== "string" || typeof parsed.text !== "string") return null;
    return {
      generationId: parsed.generationId,
      text: parsed.text,
      updatedAtMs: typeof parsed.updatedAtMs === "number" ? parsed.updatedAtMs : Date.now(),
      providerTimings: parsed.providerTimings,
    };
  } catch {
    return null;
  }
}

export function loadGmNarrationDraft(db: Database.Database, roundId: number): GmNarrationDraft | null {
  const row = db
    .prepare(`SELECT gm_narration_draft_json, gm_generation_id FROM trpg_rounds WHERE id=?`)
    .get(roundId) as { gm_narration_draft_json: string | null; gm_generation_id: string | null } | undefined;
  if (!row?.gm_narration_draft_json) return null;
  if (!row.gm_generation_id) return null;
  const draft = parseDraft(row.gm_narration_draft_json);
  if (!draft) return null;
  if (draft.generationId !== row.gm_generation_id) return null;
  return draft;
}

/** Token-scoped draft write — stale owner updates affect 0 rows. */
export function saveGmNarrationDraftForGeneration(
  db: Database.Database,
  roundId: number,
  generationId: string,
  draft: Omit<GmNarrationDraft, "generationId">
): boolean {
  const payload: GmNarrationDraft = {
    generationId,
    text: draft.text,
    updatedAtMs: draft.updatedAtMs,
    providerTimings: draft.providerTimings,
  };
  const result = db
    .prepare(
      `UPDATE trpg_rounds
       SET gm_narration_draft_json=?, updated_at=datetime('now')
       WHERE id=? AND gm_generation_id=?`
    )
    .run(JSON.stringify(payload), roundId, generationId);
  return result.changes === 1;
}

export function clearGmNarrationDraft(db: Database.Database, roundId: number): void {
  db.prepare(`UPDATE trpg_rounds SET gm_narration_draft_json=NULL WHERE id=?`).run(roundId);
}

export function gmProviderTimingMetrics(timings: GmProviderTimings | undefined): {
  firstChunkMs: number | null;
  totalProviderMs: number | null;
} {
  if (!timings) return { firstChunkMs: null, totalProviderMs: null };
  const firstChunkMs =
    timings.firstChunkAtMs != null ? Math.max(0, timings.firstChunkAtMs - timings.startAtMs) : null;
  const totalProviderMs =
    timings.completeAtMs != null ? Math.max(0, timings.completeAtMs - timings.startAtMs) : null;
  return { firstChunkMs, totalProviderMs };
}
