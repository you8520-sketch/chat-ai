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
