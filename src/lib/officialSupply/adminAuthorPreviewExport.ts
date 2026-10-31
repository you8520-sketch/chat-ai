/** Public admin preview fields only. No world bible, system prompt, or credentials. */

export type AdminAuthorExperienceExport = {
  desire: string;
  contradiction: string;
  behavior: string;
  incident: string;
  tension: string;
  daily: string;
  cost: string;
  play: string;
  voice: string;
  firstAction: string;
};

export type AdminAuthorPreviewExport = {
  previewId: string;
  qaOk: boolean;
  issues: { code: string; message: string }[];
  repairable: boolean;
  voiceRepairs: number;
  /** Authoring mode (general / adult) the preview was generated in. */
  adult: boolean;
  textLock: string;
  creatorComment?: string;
  manuscript: {
    name: string;
    tagline: string;
    description: string;
    greeting: string;
    genres: string[];
    tags: string[];
  };
  resolved: {
    genre: string;
    tone: string;
    humor: string;
    pacing: string;
    nameWordplay: string;
    worldScale: string;
    namingProfile: string;
    castIntent: string;
  };
  httpStatus?: number;
  error?: string;
  stage?: string;
  worldProjection?: {
    stage: string;
    code: string;
    hits: { field: string; excerpt: string }[];
  };
  selection?: {
    genre: string;
    tone: string;
    humor: string;
    pacing: string;
    nameWordplay: string;
    gender: string;
    castIntent: string;
  };
  resolvedSource?: "server" | "client_recommendation";
  manuscriptPresent?: boolean;
  experience?: AdminAuthorExperienceExport;
};

export function adminAuthorPreviewDownloadName(previewId: string): string {
  return `official-author-preview-${previewId || "held"}.json`;
}

/** Existing transcript/payout download path: the anchor must be in the document when clicked. */
export function downloadAdminAuthorPreviewJson(json: string, filename: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function copyOrDownloadAdminAuthorPreviewJson(
  json: string,
  filename: string
): Promise<"copied" | "downloaded"> {
  try {
    await navigator.clipboard.writeText(json);
    return "copied";
  } catch {
    downloadAdminAuthorPreviewJson(json, filename);
    return "downloaded";
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readWorldProjection(value: unknown): AdminAuthorPreviewExport["worldProjection"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const stage = readString(row.stage);
  const code = readString(row.code);
  if (!stage || !code) return undefined;
  const hits = Array.isArray(row.hits)
    ? row.hits.flatMap((hit) => {
        if (!hit || typeof hit !== "object") return [];
        const item = hit as Record<string, unknown>;
        const field = readString(item.field);
        const excerpt = typeof item.excerpt === "string" ? item.excerpt : undefined;
        return field != null && excerpt != null ? [{ field, excerpt }] : [];
      })
    : [];
  return { stage, code, hits };
}

export function adminAuthorManuscriptPresent(manuscript: AdminAuthorPreviewExport["manuscript"]): boolean {
  return Boolean(
    manuscript.name.trim() ||
      manuscript.tagline.trim() ||
      manuscript.description.trim() ||
      manuscript.greeting.trim()
  );
}

/** Allowed server-failure fields only. Invents nothing the payload did not send. */
export function readAdminAuthorServerFailure(input: {
  httpStatus: number;
  payload: Record<string, unknown>;
}): Pick<AdminAuthorPreviewExport, "httpStatus" | "error" | "stage" | "worldProjection"> {
  const error = readString(input.payload.error);
  const stage = readString(input.payload.stage);
  const worldProjection = readWorldProjection(input.payload.worldProjection);
  return {
    httpStatus: input.httpStatus,
    ...(error ? { error } : {}),
    ...(stage ? { stage } : {}),
    ...(worldProjection ? { worldProjection } : {}),
  };
}

export function adminAuthorPreviewExportJson(preview: AdminAuthorPreviewExport): string {
  const creatorComment = preview.creatorComment?.trim() ?? "";
  return JSON.stringify(
    {
      previewId: preview.previewId,
      qaOk: preview.qaOk,
      issues: preview.issues,
      repairable: preview.repairable,
      voiceRepairs: preview.voiceRepairs,
      textLock: preview.textLock,
      ...(creatorComment ? { creatorComment } : {}),
      manuscript: {
        name: preview.manuscript.name,
        tagline: preview.manuscript.tagline,
        description: preview.manuscript.description,
        greeting: preview.manuscript.greeting,
        genres: preview.manuscript.genres,
        tags: preview.manuscript.tags,
      },
      resolved: {
        genre: preview.resolved.genre,
        tone: preview.resolved.tone,
        humor: preview.resolved.humor,
        pacing: preview.resolved.pacing,
        nameWordplay: preview.resolved.nameWordplay,
        worldScale: preview.resolved.worldScale,
        namingProfile: preview.resolved.namingProfile,
        castIntent: preview.resolved.castIntent,
      },
      ...(preview.httpStatus != null ? { httpStatus: preview.httpStatus } : {}),
      ...(preview.error ? { error: preview.error } : {}),
      ...(preview.stage ? { stage: preview.stage } : {}),
      ...(preview.worldProjection ? { worldProjection: preview.worldProjection } : {}),
      ...(preview.selection ? { selection: preview.selection } : {}),
      ...(preview.resolvedSource ? { resolvedSource: preview.resolvedSource } : {}),
      ...(typeof preview.manuscriptPresent === "boolean" ? { manuscriptPresent: preview.manuscriptPresent } : {}),
      ...(preview.experience ? { experience: preview.experience } : {}),
    },
    null,
    2
  );
}
