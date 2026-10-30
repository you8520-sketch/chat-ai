/** Client-safe compile-refresh result types (no server imports). */

export type OfficialCompileRefreshSnapshot = {
  operation: "recompile";
  characterId: number;
  token: string;
  appliedToken: string;
};

export type OfficialCompileRefreshResult = {
  operation: "recompile";
  mode: "dry_run" | "apply";
  characterId: number;
  applied: boolean;
  changedFields: string[];
  preflightSnapshot: OfficialCompileRefreshSnapshot;
  beforeJsonHash: string;
  afterJsonHash: string;
  publicCanon: { added: string[]; removed: string[] };
  speechControl: { added: string[]; removed: string[] };
  derived: {
    chunksChanged: boolean;
    englishBefore: string;
    englishAfter: string;
    sourceFingerprintBefore: string;
    sourceFingerprintAfter: string;
    backgroundJobEnqueued: false;
  };
};
