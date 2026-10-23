import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import sharp from "sharp";

import type { SessionUser } from "@/lib/characterFormSave";
import { officialImageProfileForSlot } from "@/lib/officialSupply/imageProfile";
import { loadApprovedWolfgangV4Source } from "@/lib/officialSupply/lockedSnapshotReconcileOperator";
import {
  HWANG_VOCAB,
  testAppearance,
  testAssetPlan,
  testDraft,
} from "@/lib/officialSupply/officialSupply.fixtures";
import type { OfficialAssetModerator, OfficialAssetStorage, OfficialImageOps } from "@/lib/officialSupply/runner";
import { stageOfficialCharacterPrivately } from "@/lib/officialSupply/staging";
import type { OfficialSupplyStore } from "@/lib/officialSupply/store";
import type {
  CompositionQaCheck,
  OfficialAnchorQaReport,
  OfficialAppearanceLock,
  OfficialAssetModeration,
  OfficialAssetPlan,
  OfficialVariationQaReport,
  OfficialWorldLorebookEntry,
} from "@/lib/officialSupply/types";
import { storeUpload } from "@/lib/uploadStorage";

/**
 * Isolated-DB fixtures for the approved fourteen-slot apply path. Moderation,
 * anchor QA and variation QA here are gate fixtures only, never an
 * image-quality approval of these files.
 */
export const TEST_ONLY_MODERATION: Extract<OfficialAssetModeration, { status: "checked" }> = {
  status: "checked",
  adultFlagged: false,
  moderationReject: false,
  reason: "test-fixture-not-quality-approval",
  visionTag: "앉음",
};
export const TEST_ONLY_REVIEWER = "test-fixture-reviewer-not-quality-approval";
const PASS = { ok: true };
export const anchorQa = (overrides: Partial<OfficialAnchorQaReport> = {}): OfficialAnchorQaReport => ({
  gender: PASS, ageAppearance: PASS, face: PASS, hair: PASS, eyes: PASS, body: PASS,
  identifyingFeatures: PASS, artStyle: PASS, outfit: PASS, cardCrop: PASS, compositionIndependence: PASS,
  ...overrides,
});
/** A reviewed reference as the test reviewer cites it: id plus the file SHA-256 (pinned in the id when the id carries one). */
export function citedReference(id: string, fallbackSha = "c".repeat(64)): { id: string; sha256: string } {
  const pinned = /^official-review-candidate:([0-9a-f]{64}):/.exec(id)?.[1];
  return { id, sha256: pinned ?? fallbackSha };
}

/** Composition check with the comparison basis a representative review must carry. */
export function compositionCheck(
  candidateUrl: string,
  candidateSha256: string,
  referenceIds: readonly string[] = ["official-review-candidate:" + "d".repeat(64) + ":docs/official-supply/reviews/assets/ref-a.webp"]
): CompositionQaCheck {
  return {
    ok: true,
    note: "head angle, gaze, crop and hand position differ from every compared reference",
    evidence: { candidateUrl, candidateSha256, references: referenceIds.map((id) => citedReference(id)) },
  };
}

export const variationQa = (): OfficialVariationQaReport => ({
  identityMatchesAnchor: PASS, expressionMatchesPlan: PASS, characterPresent: PASS, artStyle: PASS,
  compositionIndependence: PASS,
});

export const STAGING_USER: SessionUser = { id: 8301, nickname: "approved-apply-staging", is_adult: 1 };
export const ADMIN = { id: 8303, email: "approved-apply-admin@test.local", is_admin: 1 as const };
export const STRANGER = { id: 8304, email: "approved-apply-stranger@test.local", is_admin: 0 as const };
export const DOC = path.join(process.cwd(), "docs/official-supply/reviews/assets/wolfgang-asset-redesign");
export const MANIFEST_PATH = path.join(DOC, "fourteen-f-candidates.json");
export const APPROVED_PLAN_PATH = path.join(
  process.cwd(),
  "src/lib/officialSupply/pilot/fixtures/pilot-rf-02-approved-asset-plan-f.json"
);
const SHARED_LORE: OfficialWorldLorebookEntry[] = [
  { entryKey: "approved-apply-wall", name: "검은 방벽", keywords: ["방벽"], content: "북부의 검은 방벽은 흑철 요새가 지킨다." },
];

export type ManifestCandidate = {
  slot: string;
  tag: string;
  file: string;
  rawSha256: string;
  sentPromptSha256: string;
  laterOwnerAssemblyPromptSha256?: string;
};

export const CANDIDATES = (JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as { candidates: ManifestCandidate[] })
  .candidates;
export const APPROVED_PLAN = (JSON.parse(fs.readFileSync(APPROVED_PLAN_PATH, "utf8")) as { assetPlan: OfficialAssetPlan })
  .assetPlan;
export const REP = CANDIDATES.find((c) => c.slot === "rep")!;

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function candidateBytes(candidate: ManifestCandidate): Buffer {
  const bytes = fs.readFileSync(path.join(DOC, candidate.file));
  assert.equal(sha256(bytes), candidate.rawSha256, `${candidate.file} differs from the manifest`);
  return bytes;
}

export class TestPorts {
  storedFiles: string[] = [];
  moderatedUrls: string[] = [];
  nextModeration: OfficialAssetModeration[] = [];

  storage: OfficialAssetStorage = {
    store: async (filename, buffer) => {
      this.storedFiles.push(filename);
      return { url: (await storeUpload(filename, buffer, "image/webp")).url };
    },
  };

  imageOps: OfficialImageOps = {
    inspect: async (buffer) => {
      const meta = await sharp(buffer).metadata();
      return meta.width && meta.height ? { width: meta.width, height: meta.height } : null;
    },
  };

  moderator: OfficialAssetModerator = {
    moderate: async (url) => {
      this.moderatedUrls.push(url);
      const next = this.nextModeration.shift();
      if (!next) throw new Error("test moderation fixture not queued");
      return next;
    },
  };
}

export function seedApprovedApplyUsers(db: Database.Database): void {
  db.prepare("INSERT OR IGNORE INTO users (id, email, nickname, pw_hash, points, is_adult) VALUES (?,?,?,?,1000,1)")
    .run(STAGING_USER.id, "approved-apply-staging@test.local", STAGING_USER.nickname, "hash");
  db.prepare("UPDATE users SET site_managed=1, is_admin=0 WHERE id=?").run(STAGING_USER.id);
  for (const user of [ADMIN, STRANGER]) {
    db.prepare(
      "INSERT OR IGNORE INTO users (id, email, nickname, pw_hash, points, is_adult, is_admin) VALUES (?,?,?,?,1000,1,?)"
    ).run(user.id, user.email, `user-${user.id}`, "hash", user.is_admin);
  }
}

function seedApprovedAssets(store: OfficialSupplyStore, draftKey: string): void {
  const character = store.getCharacter(draftKey);
  assert.ok(character.assetPlan && character.appearanceLockHash);
  for (const slot of character.assetPlan.slots) {
    const profile = officialImageProfileForSlot(slot.kind);
    store.database
      .prepare(
        `UPDATE official_supply_assets
         SET status='approved', result_url=?, width=?, height=?, attempts=1,
             appearance_lock_hash=?, moderation_json=?, qa_json=?
         WHERE draft_key=? AND slot_key=?`
      )
      .run(
        `/uploads/official-${draftKey}__${slot.slotKey}-a1.webp`,
        profile.width,
        profile.height,
        character.appearanceLockHash,
        JSON.stringify({ ...TEST_ONLY_MODERATION, visionTag: undefined }),
        JSON.stringify(slot.kind === "representative" ? anchorQa() : variationQa()),
        draftKey,
        slot.slotKey
      );
  }
  store.database
    .prepare("UPDATE official_supply_characters SET stage='qa_passed', anchor_approved_by='seed-reviewer' WHERE draft_key=?")
    .run(draftKey);
}

export async function stageApprovedWolfgangDraft(
  store: OfficialSupplyStore,
  draftKey: string,
  batchKey: string
): Promise<number> {
  const { nextDraft } = loadApprovedWolfgangV4Source();
  const characterFile = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/pilot/characters/pilot-rf-02.json"), "utf8")
  ) as { appearance: OfficialAppearanceLock; assetPlan: OfficialAssetPlan };
  store.addCharacterDraft(batchKey, { ...nextDraft, draftKey }, {});
  const textQa = store.lockText(draftKey, { stagingUser: STAGING_USER });
  assert.equal(textQa.ok, true, JSON.stringify(textQa.errors));
  assert.equal(store.lockAppearance(draftKey, characterFile.appearance).ok, true);
  assert.equal(store.lockAssetPlan(draftKey, characterFile.assetPlan).ok, true);
  seedApprovedAssets(store, draftKey);
  const staged = await stageOfficialCharacterPrivately({
    store,
    draftKey,
    stagingUser: STAGING_USER,
    sharedLorebook: SHARED_LORE,
  });
  return staged.characterId;
}

export async function stageDefaultPathDraft(
  store: OfficialSupplyStore,
  draftKey: string,
  batchKey: string
): Promise<number> {
  const draft = testDraft({ draftKey, name: "레온하르트", vocabulary: HWANG_VOCAB });
  store.addCharacterDraft(batchKey, { ...draft, styleKey: "romance_fantasy_v4", worldKey: "approved-apply-world-b" }, {});
  assert.equal(store.lockText(draftKey, { stagingUser: STAGING_USER }).ok, true);
  assert.equal(store.lockAppearance(draftKey, testAppearance()).ok, true);
  assert.equal(store.lockAssetPlan(draftKey, testAssetPlan()).ok, true);
  seedApprovedAssets(store, draftKey);
  const staged = await stageOfficialCharacterPrivately({ store, draftKey, stagingUser: STAGING_USER });
  return staged.characterId;
}
