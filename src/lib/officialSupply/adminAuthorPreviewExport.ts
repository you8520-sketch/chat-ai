/** Public admin preview fields only. No world bible, system prompt, or credentials. */

export type AdminAuthorPreviewExport = {
  previewId: string;
  qaOk: boolean;
  issues: { code: string; message: string }[];
  repairable: boolean;
  voiceRepairs: number;
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
    },
    null,
    2
  );
}
