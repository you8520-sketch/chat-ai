import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { GET as getPublicMedia } from "@/app/media/public/[filename]/route";
import { createCharacterFromForm, type SessionUser } from "@/lib/characterFormSave";
import { getDb } from "@/lib/db";
import {
  evaluatePrivateMediaAccess,
  evaluatePublicMediaAccess,
  projectAssetsForViewer,
  type PrivateMediaViewer,
} from "@/lib/mediaAccess";
import { parseAssets } from "@/lib/characterAssets";
import { storePrivateMedia, writeMediaManifest } from "@/lib/mediaStorage";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";

const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const CREATOR: SessionUser = {
  id: 94101,
  nickname: "acl-adult",
  email: "acl-adult-creator@test.local",
  is_adult: 1,
  is_admin: 0,
};

const MEMBER: PrivateMediaViewer = {
  id: 94102,
  email: "acl-adult-member@test.local",
  is_adult: 0,
  is_admin: 0,
};

const LEGACY_MOCK: PrivateMediaViewer = {
  id: 94103,
  email: "acl-adult-mock@test.local",
  is_adult: 1,
  is_admin: 0,
};

const ADMIN: PrivateMediaViewer = {
  id: 94104,
  email: "acl-adult-admin@test.local",
  is_adult: 0,
  is_admin: 1,
};

const REVIEWER: PrivateMediaViewer = {
  id: 94105,
  email: "portone-reviewer@hav.internal",
  is_adult: 1,
  is_admin: 0,
};

function characterBody(overrides: Record<string, unknown> = {}) {
  const speech = "x".repeat(500);
  const promptBlock = "y".repeat(600);
  return {
    content_kind: "character",
    name: "성인해금",
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

async function storeCheckedMedia() {
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
  return stored;
}

async function publicRenditionStatus(mediaId: string): Promise<number> {
  const filename = `${mediaId}-public.webp`;
  const res = await getPublicMedia(new Request(`http://localhost/media/public/${filename}`), {
    params: Promise.resolve({ filename }),
  });
  return res.status;
}

function insertUser(user: PrivateMediaViewer) {
  getDb()
    .prepare(
      "INSERT INTO users (id, email, nickname, pw_hash, points, is_adult, is_admin) VALUES (?,?,?,?,0,?,?)"
    )
    .run(user.id, user.email, user.email.split("@")[0], "hash", user.is_adult ?? 0, user.is_admin ?? 0);
}

function insertChat(userId: number, characterId: number): number {
  const info = getDb()
    .prepare("INSERT INTO chats (user_id, character_id, mode) VALUES (?,?,?)")
    .run(userId, characterId, "safe");
  return Number(info.lastInsertRowid);
}

function insertAssistant(chatId: number, content: string, generationStatus: string) {
  getDb()
    .prepare("INSERT INTO messages (chat_id, role, content, generation_status) VALUES (?,?,?,?)")
    .run(chatId, "assistant", content, generationStatus);
}

function hiddenAsset(stored: { url: string; mediaId: string }) {
  return {
    url: stored.url,
    tag: "분노",
    mediaId: stored.mediaId,
    viewerBlur: true,
    chat: true,
  };
}

function representativeAsset(stored: { url: string; mediaId: string }) {
  return {
    url: stored.url,
    tag: "미소",
    mediaId: stored.mediaId,
    representativeRank: 1,
    adultFlagged: false,
    moderationReject: false,
  };
}

describe("review #1345 adult unlock and published public GET", () => {
  before(() => {
    installIsolatedTestDatabase();
    insertUser({
      id: CREATOR.id,
      email: CREATOR.email ?? "acl-adult-creator@test.local",
      is_adult: CREATOR.is_adult,
      is_admin: CREATOR.is_admin,
    });
    insertUser(MEMBER);
    insertUser(LEGACY_MOCK);
    insertUser(ADMIN);
    insertUser(REVIEWER);
  });

  after(() => {
    uninstallIsolatedTestDatabase();
  });

  it("private checked representative is not a guest public GET; link and public stay published", async () => {
    const privateMedia = await storeCheckedMedia();
    const privateCreated = await createCharacterFromForm(
      CREATOR,
      characterBody({
        name: "비공개검수대표",
        visibility: "private",
        assets: [representativeAsset(privateMedia)],
      })
    );
    assert.equal(privateCreated.ok, true, privateCreated.ok ? undefined : privateCreated.error);
    if (!privateCreated.ok) return;
    assert.equal(privateCreated.visibility, "private");
    assert.equal(evaluatePublicMediaAccess(`${privateMedia.mediaId}-public.webp`).ok, false);
    assert.equal(await publicRenditionStatus(privateMedia.mediaId), 404);

    const linkMedia = await storeCheckedMedia();
    const linkCreated = await createCharacterFromForm(
      CREATOR,
      characterBody({
        name: "링크검수대표",
        visibility: "link",
        assets: [representativeAsset(linkMedia)],
      })
    );
    assert.equal(linkCreated.ok, true, linkCreated.ok ? undefined : linkCreated.error);
    if (!linkCreated.ok) return;
    assert.equal(linkCreated.visibility, "link");
    assert.equal(linkCreated.moderationStatus, "approved");
    assert.equal(evaluatePublicMediaAccess(`${linkMedia.mediaId}-public.webp`).ok, true);
    assert.equal(await publicRenditionStatus(linkMedia.mediaId), 200);

    const publicMedia = await storeCheckedMedia();
    const publicCreated = await createCharacterFromForm(
      CREATOR,
      characterBody({
        name: "공개검수대표",
        visibility: "public",
        assets: [representativeAsset(publicMedia)],
      })
    );
    assert.equal(publicCreated.ok, true, publicCreated.ok ? undefined : publicCreated.error);
    if (!publicCreated.ok) return;
    assert.equal(publicCreated.listed, true);
    assert.equal(evaluatePublicMediaAccess(`${publicMedia.mediaId}-public.webp`).ok, true);
    assert.equal(await publicRenditionStatus(publicMedia.mediaId), 200);
  });

  it("NSFW private GET reuses canAccessAdultContent; SFW completed tags still unlock", async () => {
    const sfwHidden = await storeCheckedMedia();
    const sfwCreated = await createCharacterFromForm(
      CREATOR,
      characterBody({
        name: "SFW해금",
        visibility: "private",
        assets: [representativeAsset(await storeCheckedMedia()), hiddenAsset(sfwHidden)],
      })
    );
    assert.equal(sfwCreated.ok, true, sfwCreated.ok ? undefined : sfwCreated.error);
    if (!sfwCreated.ok) return;

    const nsfwHidden = await storeCheckedMedia();
    const nsfwCreated = await createCharacterFromForm(
      CREATOR,
      characterBody({
        name: "NSFW해금",
        visibility: "private",
        nsfw: true,
        assets: [representativeAsset(await storeCheckedMedia()), hiddenAsset(nsfwHidden)],
      })
    );
    assert.equal(nsfwCreated.ok, true, nsfwCreated.ok ? undefined : nsfwCreated.error);
    if (!nsfwCreated.ok) return;

    const sfwFilename = `${sfwHidden.mediaId}.webp`;
    const nsfwFilename = `${nsfwHidden.mediaId}.webp`;
    const memberSfwChat = insertChat(MEMBER.id, sfwCreated.id);
    insertAssistant(memberSfwChat, "장면\n[태그: 분노]", "completed");
    const memberNsfwChat = insertChat(MEMBER.id, nsfwCreated.id);
    insertAssistant(memberNsfwChat, "장면\n[태그: 분노]", "completed");
    const mockNsfwChat = insertChat(LEGACY_MOCK.id, nsfwCreated.id);
    insertAssistant(mockNsfwChat, "장면\n[태그: 분노]", "completed");
    const reviewerNsfwChat = insertChat(REVIEWER.id, nsfwCreated.id);
    insertAssistant(reviewerNsfwChat, "장면\n[태그: 분노]", "completed");
    const adminNsfwChat = insertChat(ADMIN.id, nsfwCreated.id);
    insertAssistant(adminNsfwChat, "장면\n[태그: 분노]", "completed");
    const streamingChat = insertChat(MEMBER.id, sfwCreated.id);
    insertAssistant(streamingChat, "장면\n[태그: 분노]", "streaming");
    const otherRoom = insertChat(MEMBER.id, sfwCreated.id);
    insertAssistant(otherRoom, "다른 방", "completed");

    assert.equal(evaluatePrivateMediaAccess(null, sfwFilename, memberSfwChat).ok, false);
    assert.equal(evaluatePrivateMediaAccess(null, nsfwFilename, memberNsfwChat).ok, false);

    assert.equal(evaluatePrivateMediaAccess(MEMBER, sfwFilename, memberSfwChat).ok, true);
    assert.equal(evaluatePrivateMediaAccess(MEMBER, sfwFilename, streamingChat).ok, false);
    assert.equal(evaluatePrivateMediaAccess(MEMBER, sfwFilename, otherRoom).ok, false);
    assert.equal(evaluatePrivateMediaAccess(MEMBER, sfwFilename, 999999).ok, false);
    assert.equal(evaluatePrivateMediaAccess(MEMBER, sfwFilename, memberNsfwChat).ok, false);

    assert.equal(evaluatePrivateMediaAccess(MEMBER, nsfwFilename, memberNsfwChat).ok, false);
    assert.equal(evaluatePrivateMediaAccess(LEGACY_MOCK, nsfwFilename, mockNsfwChat).ok, false);
    assert.equal(evaluatePrivateMediaAccess(REVIEWER, nsfwFilename, reviewerNsfwChat).ok, false);
    assert.equal(evaluatePrivateMediaAccess(ADMIN, nsfwFilename, adminNsfwChat).ok, true);
    assert.equal(
      evaluatePrivateMediaAccess(
        { id: CREATOR.id, email: CREATOR.email ?? "", is_adult: 1, is_admin: 0 },
        nsfwFilename,
        null
      ).ok,
      true
    );

    const nsfwRow = getDb()
      .prepare("SELECT assets FROM characters WHERE id=?")
      .get(nsfwCreated.id) as { assets: string };
    const projected = projectAssetsForViewer(parseAssets(nsfwRow.assets), {
      canSeeOriginals: false,
      unlockedUrls: new Set([nsfwHidden.url]),
      chatId: memberNsfwChat,
      nsfw: true,
      viewer: MEMBER,
    });
    assert.equal(JSON.stringify(projected).includes("/media/private/"), false);
    assert.equal(evaluatePrivateMediaAccess(MEMBER, nsfwFilename, memberNsfwChat).ok, false);
  });
});
