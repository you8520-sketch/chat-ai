import type Database from "better-sqlite3";
import {
  saveGmNarrationDraftForGeneration,
  type GmProviderTimings,
} from "./gmNarrationDraft";
import { stripTrpgAssetControlMarkers } from "./gmSceneAssets";

/** Coalesced draft refresh — aligned with snapshot poll cadence, not per provider token. */
export const GM_NARRATION_DRAFT_COALESCE_MS = 400;
/** Force a persisted refresh after this much new narration growth. */
export const GM_NARRATION_DRAFT_GROWTH_CHARS = 64;

export type GmNarrationDraftCoalescerOpts = {
  db: Database.Database;
  roundId: number;
  generationId: string;
  providerTimings?: () => GmProviderTimings | undefined;
  onStaleDiscard?: () => void;
};

/** In-memory narration owner; SQLite writes are coalesced and token-fenced. */
export class GmNarrationDraftCoalescer {
  private latestText = "";
  private lastPersistedText = "";
  private lastFlushAtMs = 0;
  private firstNoteAtMs = 0;
  private staleLatched = false;
  private staleLogged = false;
  private dbWriteCount = 0;

  constructor(private readonly opts: GmNarrationDraftCoalescerOpts) {}

  get text(): string {
    return this.latestText;
  }

  get writeCount(): number {
    return this.dbWriteCount;
  }

  get isStaleLatched(): boolean {
    return this.staleLatched;
  }

  /** Provider parser hands cumulative narration; memory stays authoritative until flush. */
  noteNarration(narrationText: string): void {
    if (this.staleLatched) return;
    if (!narrationText) return;
    if (narrationText.length < this.latestText.length) return;
    if (this.latestText && !narrationText.startsWith(this.latestText)) return;
    if (this.firstNoteAtMs === 0) this.firstNoteAtMs = Date.now();
    this.latestText = narrationText;
    if (this.lastPersistedText === "") {
      this.maybeFlush(true);
      return;
    }
    this.maybeFlush(false);
  }

  /** Live draft prose only — asset markers resolve on canonical commit. */
  private draftTextForPersist(): string {
    return stripTrpgAssetControlMarkers(this.latestText);
  }

  maybeFlush(force: boolean): boolean {
    if (this.staleLatched) return false;
    if (!this.latestText) return false;
    const textToPersist = this.draftTextForPersist();
    if (!textToPersist) return false;
    if (textToPersist === this.lastPersistedText) return false;

    const now = Date.now();
    if (!force) {
      const elapsed =
        this.lastFlushAtMs > 0 ? now - this.lastFlushAtMs : this.firstNoteAtMs > 0 ? now - this.firstNoteAtMs : 0;
      const growth = textToPersist.length - this.lastPersistedText.length;
      if (elapsed < GM_NARRATION_DRAFT_COALESCE_MS && growth < GM_NARRATION_DRAFT_GROWTH_CHARS) {
        return false;
      }
    }

    const ok = saveGmNarrationDraftForGeneration(
      this.opts.db,
      this.opts.roundId,
      this.opts.generationId,
      {
        text: textToPersist,
        updatedAtMs: now,
        providerTimings: this.opts.providerTimings?.(),
      }
    );
    if (!ok) {
      if (!this.staleLogged) {
        this.staleLogged = true;
        this.opts.onStaleDiscard?.();
      }
      this.staleLatched = true;
      return false;
    }
    this.lastPersistedText = textToPersist;
    this.lastFlushAtMs = now;
    this.dbWriteCount += 1;
    return true;
  }

  flush(): boolean {
    return this.maybeFlush(true);
  }
}
