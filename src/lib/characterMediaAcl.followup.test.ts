import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { GET as getPublicMedia } from "@/app/media/public/[filename]/route";
import { canPublishAsRepresentative } from "@/lib/assetVisionPolicy";
import { validateStructuredAssetVisionResult } from "@/lib/assetPersonTags";
import { createCharacterFromForm, type SessionUser } from "@/lib/characterFormSave";
import { getDb } from "@/lib/db";
import {
  bindTrustedCharacterMedia,
  evaluatePublicMediaAccess,
} from "@/lib/mediaAccess";
import {
  readMediaManifest,
  storePrivateMedia,
  writeMediaManifest,
} from "@/lib/mediaStorage";
import { finalizeStructuredVisionResult } from "@/lib/vision";

const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const CREATOR: SessionUser = { id: 93451, nickname: "acl-followup", is_adult: 1 };

function characterBody(overrides: Record<string, unknown> = {}) {
  const speech = "x".repeat(500);
  const promptBlock = "y".repeat(600);
  return {
    content_kind: "character",
    name: "검수후속",
    tagline: "한 줄 소개",
    description: "공개 소개",
    greeting: "안녕",
    system_prompt: promptBlock,
    world: promptBlock,
    speech_personality: speech,
    speech_traits: speech,
    speech_examples: speech,
    speech_forbidden: "",
    genres: ["로맨스"],
    gender: "male",
    nsfw: false,
    participant_min_age: 28,
    visibility: "public",
    ...overrides,
  };
}

async function publicRenditionStatus(mediaId: string): Promise<number> {
  const filename = `${mediaId}-public.webp`;
  const res = await getPublicMedia(new Request(`http://localhost/media/public/${filename}`), {
    params: Promise.resolve({ filename }),
  });
  return res.status;
}

describe("review #1345 follow-up MUST FIX", () => {
  const previous = process.env.DATA_DIR;
  let dataDir = "";

  before(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hav-media-followup-"));
    process.env.DATA_DIR = dataDir;
    getDb()
      .prepare(
        "INSERT OR IGNORE INTO users (id, email, nickname, pw_hash, points, is_adult) VALUES (?,?,?,?,0,1)"
      )
      .run(CREATOR.id, "acl-followup@test.local", CREATOR.nickname, "hash");
  });

  after(() => {
    getDb().prepare("DELETE FROM characters WHERE creator_id=?").run(CREATOR.id);
    getDb().prepare("DELETE FROM users WHERE id=?").run(CREATOR.id);
    if (previous == null) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("1. unreviewed private media cannot become a public representative or sharp GET", async () => {
    const stored = await storePrivateMedia(PIXEL_PNG, "image/png", CREATOR.id);
    const manifest = readMediaManifest(`${stored.mediaId}.webp`);
    assert.equal(manifest?.moderationStatus, "pending");
    assert.equal(typeof manifest?.adultFlagged, "undefined");

    const skippedTag = await createCharacterFromForm(
      CREATOR,
      characterBody({
        visibility: "public",
        assets: [
          {
            url: stored.url,
            tag: "미소",
            mediaId: stored.mediaId,
            representativeRank: 1,
            adultFlagged: false,
            moderationReject: false,
          },
        ],
      })
    );
    assert.equal(skippedTag.ok, false);
    if (!skippedTag.ok) assert.match(skippedTag.error, /검수/);

    const privateDraft = await createCharacterFromForm(
      CREATOR,
      characterBody({
        visibility: "private",
        assets: [
          {
            url: stored.url,
            tag: "미소",
            mediaId: stored.mediaId,
            representativeRank: 1,
            adultFlagged: false,
            moderationReject: false,
          },
        ],
      })
    );
    assert.equal(privateDraft.ok, true);
    assert.equal(evaluatePublicMediaAccess(`${stored.mediaId}-public.webp`).ok, false);
    assert.equal(await publicRenditionStatus(stored.mediaId), 404);

    await writeMediaManifest(`${stored.mediaId}.webp`, {
      uploadedBy: CREATOR.id,
      createdAt: new Date().toISOString(),
      contentType: "image/webp",
      moderationStatus: "checked",
      adultFlagged: false,
      moderationReject: false,
      nippleExposure: "none",
    });
    const published = await createCharacterFromForm(
      CREATOR,
      characterBody({
        name: "검수후속공개",
        visibility: "public",
        assets: [
          {
            url: stored.url,
            tag: "미소",
            mediaId: stored.mediaId,
            representativeRank: 1,
            adultFlagged: false,
            moderationReject: false,
          },
        ],
      })
    );
    assert.equal(published.ok, true, published.ok ? undefined : published.error);
    assert.equal(evaluatePublicMediaAccess(`${stored.mediaId}-public.webp`).ok, true);
    assert.equal(await publicRenditionStatus(stored.mediaId), 200);
  });

  it("2. representative nipple ban is gender-neutral and fail-closed on missing evidence", () => {
    assert.equal(
      canPublishAsRepresentative({
        moderationStatus: "checked",
        adultFlagged: false,
        moderationReject: false,
        nippleExposure: "visible",
        moderationReason: "",
      }).ok,
      false
    );
    for (const reason of ["남성 유두 노출", "여성 젖꼭지", "male nipple visible"]) {
      assert.equal(
        canPublishAsRepresentative({
          moderationStatus: "checked",
          adultFlagged: false,
          moderationReject: false,
          nippleExposure: "none",
          moderationReason: reason,
        }).ok,
        false,
        reason
      );
    }
    assert.equal(
      canPublishAsRepresentative({
        mediaId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
        moderationStatus: "checked",
        adultFlagged: false,
        moderationReject: false,
        moderationReason: "",
      }).ok,
      false
    );
    assert.equal(
      canPublishAsRepresentative({
        mediaId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
        moderationStatus: "pending",
        adultFlagged: false,
        moderationReject: false,
        moderationReason: "",
      }).ok,
      false
    );
    assert.equal(
      canPublishAsRepresentative({
        mediaId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
        moderationStatus: "checked",
        adultFlagged: false,
        moderationReject: false,
        nippleExposure: "none",
        moderationReason: "일상 전신 옷",
      }).ok,
      true
    );
    const parsed = validateStructuredAssetVisionResult({
      imageType: "person",
      personTag: "미소",
      backgroundTag: null,
      adult: false,
      reject: false,
      reason: "",
      nippleExposure: "visible",
    });
    assert.equal(parsed?.nippleExposure, "visible");
    const finalized = finalizeStructuredVisionResult(parsed!);
    assert.equal(finalized.nippleExposure, "visible");
  });

  it("3. same private media cannot be attached to both all-ages and adult characters", async () => {
    const stored = await storePrivateMedia(PIXEL_PNG, "image/png", CREATOR.id);
    await writeMediaManifest(`${stored.mediaId}.webp`, {
      uploadedBy: CREATOR.id,
      createdAt: new Date().toISOString(),
      contentType: "image/webp",
      moderationStatus: "checked",
      adultFlagged: false,
      moderationReject: false,
      nippleExposure: "none",
    });
    const sfw = await createCharacterFromForm(
      CREATOR,
      characterBody({
        name: "일반혼용",
        visibility: "private",
        nsfw: false,
        assets: [
          {
            url: stored.url,
            tag: "미소",
            mediaId: stored.mediaId,
            representativeRank: 1,
          },
        ],
      })
    );
    assert.equal(sfw.ok, true, sfw.ok ? undefined : sfw.error);
    const nsfw = await createCharacterFromForm(
      CREATOR,
      characterBody({
        name: "성인혼용",
        visibility: "private",
        nsfw: true,
        participant_min_age: 28,
        assets: [
          {
            url: stored.url,
            tag: "미소",
            mediaId: stored.mediaId,
            representativeRank: 1,
          },
        ],
      })
    );
    assert.equal(nsfw.ok, false);
    if (!nsfw.ok) assert.match(nsfw.error, /일반용과 성인용/);
    const stolenFlags = bindTrustedCharacterMedia(
      [
        {
          url: stored.url,
          tag: "미소",
          mediaId: stored.mediaId,
          representativeRank: 1,
          adultFlagged: false,
          moderationReject: false,
        },
      ],
      CREATOR.id,
      { nsfw: true }
    );
    assert.equal(stolenFlags.ok, false);
  });

  it("does not copy #1333 canAccessAdultContent (BLOCKED_BY_1333)", () => {
    const mediaAccess = fs.readFileSync(path.join(process.cwd(), "src/lib/mediaAccess.ts"), "utf8");
    const adultOnThisBranch = fs.readFileSync(
      path.join(process.cwd(), "src/lib/adultVerification.ts"),
      "utf8"
    );
    assert.doesNotMatch(mediaAccess, /from ["']@\/lib\/adultVerification["']/);
    assert.doesNotMatch(mediaAccess, /canAccessAdultContent\s*\(/);
    assert.doesNotMatch(adultOnThisBranch, /export function canAccessAdultContent/);
  });
});
