import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { ensureTrpgTables } from "./schema";
import { loadGmNarrationDraft } from "./gmNarrationDraft";
import { GmNarrationDraftCoalescer } from "./gmNarrationDraftCoalescer";
import { enforceGmSceneAssetMarkers } from "./gmSceneAssets";
import {
  resolveTrpgGmLiveAssetResolution,
  resolveTrpgGmPacingSource,
} from "./gmProviderStreamDisplay";
import { splitTrpgGmProseForAssets } from "./trpgTaggedProse";
import type { CharacterAsset } from "@/lib/characterAssets";

const VALID_MARKER = "[캐릭터에셋: 12|분노]";
const FIXTURE = `앞 문단.\n${VALID_MARKER}\n뒤 문단.`;

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function insertRound(db: Database.Database, generationId: string): number {
  return Number(
    db
      .prepare(
        `INSERT INTO trpg_rounds (campaign_id, round_number, phase, gm_generation_id)
         VALUES (1, 1, 'GENERATING_NARRATION', ?)`
      )
      .run(generationId).lastInsertRowid
  );
}

const enforceOpts = {
  aiParticipantIds: new Set([12]),
  characterTagsByParticipant: new Map([[12, new Set(["분노"])]]),
  scenarioTags: new Set<string>(),
};

const characterCatalog = [
  {
    participantId: 12,
    characterId: 99,
    name: "태현",
    viewerIsCreator: true,
    assets: [
      {
        tag: "분노",
        url: "/assets/anger.webp",
        viewerBlur: false,
        moderationReject: false,
      } satisfies CharacterAsset,
    ],
  },
];

describe("gmStreamingAssetReveal path proof", () => {
  it("before-fix structural blockers: draft stripped markers and client gated assets", () => {
    const coalescerBefore = (text: string) =>
      text.replace(/\[캐릭터에셋:[^\]]+\]/g, "").replace(/\[태그:[^\]]+\]/g, "");
    const persistedBefore = coalescerBefore(FIXTURE);
    assert.equal(/\[캐릭터에셋:/.test(persistedBefore), false, "BEFORE_DRAFT_MARKER_PRESENT=false");

    const final = enforceGmSceneAssetMarkers(FIXTURE, enforceOpts).text;
    assert.match(final, /\[캐릭터에셋: 12\|분노\]/, "BEFORE_FINAL_MARKER_PRESENT=true");

    assert.equal(
      resolveTrpgGmLiveAssetResolution({ canonicalCommitted: false, revealComplete: false }),
      false,
      "BEFORE_CLIENT_LIVE_RESOLUTION=false"
    );
  });

  it("after-fix: valid marker survives draft persist, pacing, and live client resolution", () => {
    const db = memoryDb();
    const roundId = insertRound(db, "gen-1");
    const coalescer = new GmNarrationDraftCoalescer({
      db,
      roundId,
      generationId: "gen-1",
      draftSanitize: (text) => enforceGmSceneAssetMarkers(text, enforceOpts).text,
    });
    coalescer.noteNarration(FIXTURE);
    const draft = loadGmNarrationDraft(db, roundId);
    assert.match(draft?.text ?? "", /\[캐릭터에셋: 12\|분노\]/, "DRAFT_MARKER_PRESENT_AFTER_FIX=true");

    const pacing = resolveTrpgGmPacingSource({ gmStreamDraft: draft?.text, canonicalNarration: null });
    assert.match(pacing, /\[캐릭터에셋: 12\|분노\]/, "SNAPSHOT_DRAFT_HAS_MARKER=true");

    assert.equal(
      resolveTrpgGmLiveAssetResolution({
        canonicalCommitted: false,
        revealComplete: false,
        liveStreaming: true,
      }),
      true,
      "CLIENT_DRAFT_RENDER_CAN_RENDER_MARKER=true"
    );

    const parts = splitTrpgGmProseForAssets(pacing, {
      scenarioAssets: [],
      characterCatalog,
      campaignId: 1,
      roundNumber: 1,
      streaming: true,
    });
    assert.ok(parts.some((part) => part.kind === "character"), "VALID_MARKER_REVEALED_BEFORE_STREAM_END=true");

    const final = enforceGmSceneAssetMarkers(FIXTURE, enforceOpts).text;
    assert.match(final, /\[캐릭터에셋: 12\|분노\]/, "FINAL_MARKER_PRESENT=true");
    db.close();
  });

  it("partial marker is not visible in live pacing source", () => {
    const partial = "앞.\n[캐릭터에셋: 12|자";
    const pacing = resolveTrpgGmPacingSource({ gmStreamDraft: partial, canonicalNarration: null });
    assert.doesNotMatch(pacing, /캐릭터에셋/, "PARTIAL_MARKER_RAW_TEXT_VISIBLE=false");
    assert.match(pacing, /앞\./);
  });

  it("invalid marker is stripped by canonical enforcement on draft persist", () => {
    const db = memoryDb();
    const roundId = insertRound(db, "gen-2");
    const coalescer = new GmNarrationDraftCoalescer({
      db,
      roundId,
      generationId: "gen-2",
      draftSanitize: (text) => enforceGmSceneAssetMarkers(text, enforceOpts).text,
    });
    coalescer.noteNarration(`앞.\n[캐릭터에셋: 99|분노]\n뒤.`);
    const draft = loadGmNarrationDraft(db, roundId);
    assert.doesNotMatch(draft?.text ?? "", /캐릭터에셋/, "INVALID_ASSET_RENDERED=false");
    db.close();
  });
});
