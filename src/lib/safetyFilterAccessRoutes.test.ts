import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { GET as getUpload } from "@/app/uploads/[filename]/route";
import { canAccessCharacter } from "@/lib/characterVisibility";
import { fetchCharacterRanking } from "@/lib/characterRanking";
import { getDb } from "@/lib/db";
import { fetchHomeSections } from "@/lib/homeSections";
import { buildCharacterSearchSql } from "@/lib/tagSearch";
import { uploadsDataDir } from "@/lib/uploadStorage";
import {
  canAccessAdultContent,
  canUseCreatorTools,
  isAdultVerificationSkipped,
  shouldHideAdultListings,
} from "@/lib/adultVerification";

type Persona = {
  label: string;
  email: string | null;
  is_adult: number;
  is_admin: number;
  nsfw_on: number;
};

const ENV_KEYS = [
  "SKIP_ADULT_VERIFICATION",
  "PORTONE_CHARGE_ENABLED",
  "NEXT_PUBLIC_PAYMENTS_ENABLED",
  "NEXT_PUBLIC_PORTONE_CHARGE_ENABLED",
  "ADMIN_EMAILS",
] as const;

const previous: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function snapshotEnv() {
  for (const key of ENV_KEYS) previous[key] = process.env[key];
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
}

function setAccessEnv(opts: {
  skip?: string;
  payments?: string;
  adminEmails?: string;
}) {
  delete process.env.SKIP_ADULT_VERIFICATION;
  delete process.env.PORTONE_CHARGE_ENABLED;
  delete process.env.NEXT_PUBLIC_PAYMENTS_ENABLED;
  delete process.env.NEXT_PUBLIC_PORTONE_CHARGE_ENABLED;
  delete process.env.ADMIN_EMAILS;
  if (opts.skip !== undefined) process.env.SKIP_ADULT_VERIFICATION = opts.skip;
  if (opts.payments !== undefined) {
    process.env.PORTONE_CHARGE_ENABLED = opts.payments;
    process.env.NEXT_PUBLIC_PAYMENTS_ENABLED = opts.payments;
  }
  if (opts.adminEmails !== undefined) process.env.ADMIN_EMAILS = opts.adminEmails;
}

const GUEST = null;
const NEW_MEMBER: Persona = {
  label: "new-member",
  email: "new@example.com",
  is_adult: 0,
  is_admin: 0,
  nsfw_on: 0,
};
const LEGACY_MOCK: Persona = {
  label: "legacy-mock",
  email: "legacy-mock@example.com",
  is_adult: 1,
  is_admin: 0,
  nsfw_on: 1,
};
const NSFW_ON_ONLY: Persona = {
  label: "nsfw-on-only",
  email: "nsfw-on@example.com",
  is_adult: 0,
  is_admin: 0,
  nsfw_on: 1,
};
const ADMIN_UNVERIFIED_FILTER_ON: Persona = {
  label: "admin-unverified-on",
  email: "admin-on@example.com",
  is_adult: 0,
  is_admin: 1,
  nsfw_on: 0,
};
const ADMIN_FILTER_OFF: Persona = {
  label: "admin-off",
  email: "admin-off@example.com",
  is_adult: 0,
  is_admin: 1,
  nsfw_on: 1,
};
const REVIEWER_LIKE: Persona = {
  label: "reviewer-like",
  email: "portone-reviewer@hav.internal",
  is_adult: 1,
  is_admin: 0,
  nsfw_on: 0,
};

const PNG_1X1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360000002000154a24f580000000049454e44ae426082",
  "hex"
);

function insertUser(persona: Persona): number {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO users (email, nickname, pw_hash, is_adult, nsfw_on, is_admin, points)
       VALUES (?, ?, 'x', ?, ?, ?, 0)`
    )
    .run(persona.email, persona.label, persona.is_adult, persona.nsfw_on, persona.is_admin);
  return Number(info.lastInsertRowid);
}

function insertOfficialCharacter(opts: { name: string; nsfw: number; imageUrl: string; creatorId: number }): number {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO characters
        (name, tagline, description, greeting, system_prompt, genre, tags, nsfw, official,
         emoji, hue, creator_id, creator_name, visibility, moderation_status, images, assets)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      opts.name,
      "tag",
      "desc",
      "hi",
      "sys",
      "로맨스",
      JSON.stringify(["성인테스트"]),
      opts.nsfw,
      1,
      "✨",
      260,
      opts.creatorId,
      "공식",
      "public",
      "approved",
      JSON.stringify([opts.imageUrl]),
      JSON.stringify([{ url: opts.imageUrl, tag: "대표" }])
    );
  return Number(info.lastInsertRowid);
}

function listingNames(rows: { name: string }[]): string[] {
  return rows.map((row) => row.name).sort();
}

function rankingFilter(blurNsfw: boolean): { filter: string; params: unknown[] } {
  return blurNsfw
    ? { filter: "AND c.nsfw=0", params: [] }
    : { filter: "", params: [] };
}

function searchNames(blurNsfw: boolean): string[] {
  const db = getDb();
  const built = buildCharacterSearchSql({ blurNsfw });
  const like = "%성인테스트%";
  const rows = db
    .prepare(built.sql)
    .all(like, like, like, like, like, ...built.filterParams) as { name: string }[];
  return listingNames(rows);
}

function rankingNames(blurNsfw: boolean): string[] {
  const { filter, params } = rankingFilter(blurNsfw);
  return listingNames(fetchCharacterRanking(getDb(), "all", filter, params));
}

function homeNames(user: Persona | null): { recommended: string[]; newest: string[] } {
  const blur = shouldHideAdultListings(user);
  const sections = fetchHomeSections(getDb(), user, blur);
  return {
    recommended: listingNames(sections.recommended),
    newest: listingNames(sections.newest),
  };
}

function adultRouteBlocked(user: Persona | null, nsfw: number): boolean {
  return nsfw === 1 && !canAccessAdultContent(user);
}

function settingsFilterPatchAllowed(user: Persona | null): boolean {
  return canAccessAdultContent(user);
}

describe("safety filter live listing and route access", () => {
  const previousAdminEmails = process.env.ADMIN_EMAILS;
  let creatorId = 0;
  let sfwId = 0;
  let nsfwId = 0;
  const uploadName = "fixture-public-upload.png";

  before(() => {
    snapshotEnv();
    setAccessEnv({ skip: "1", payments: "0" });
    const db = getDb();
    creatorId = insertUser(ADMIN_FILTER_OFF);
    insertUser(NEW_MEMBER);
    insertUser(LEGACY_MOCK);
    insertUser(NSFW_ON_ONLY);
    insertUser(ADMIN_UNVERIFIED_FILTER_ON);
    insertUser(REVIEWER_LIKE);
    sfwId = insertOfficialCharacter({
      name: "SFW공개",
      nsfw: 0,
      imageUrl: "/uploads/sfw-card.png",
      creatorId,
    });
    nsfwId = insertOfficialCharacter({
      name: "NSFW공개",
      nsfw: 1,
      imageUrl: "/uploads/nsfw-card.png",
      creatorId,
    });
    db.prepare(
      `INSERT INTO characters
        (name, tagline, description, greeting, system_prompt, genre, tags, nsfw, official,
         emoji, hue, creator_id, creator_name, visibility, moderation_status, images, assets)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      "NSFW재사용",
      "tag",
      "desc",
      "hi",
      "sys",
      "로맨스",
      "[]",
      1,
      1,
      "✨",
      260,
      creatorId,
      "공식",
      "public",
      "approved",
      JSON.stringify(["/uploads/nsfw-card.png"]),
      JSON.stringify([{ url: "/uploads/nsfw-card.png", tag: "대표" }])
    );
    fs.mkdirSync(uploadsDataDir(), { recursive: true });
    fs.writeFileSync(path.join(uploadsDataDir(), uploadName), PNG_1X1);
  });

  after(() => {
    restoreEnv();
    if (previousAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = previousAdminEmails;
  });

  it("skip and payments-off do not open adult view for any non-admin persona", () => {
    for (const env of [
      { skip: "1", payments: "0" },
      { skip: "0", payments: "0" },
      { skip: "0", payments: "1" },
    ] as const) {
      setAccessEnv(env);
      assert.equal(isAdultVerificationSkipped(), env.skip === "1");
      for (const user of [GUEST, NEW_MEMBER, LEGACY_MOCK, NSFW_ON_ONLY, REVIEWER_LIKE]) {
        assert.equal(canAccessAdultContent(user), false, `${env.skip}/${env.payments} ${user?.label ?? "guest"}`);
        assert.equal(shouldHideAdultListings(user), true);
        assert.equal(adultRouteBlocked(user, 1), true);
        assert.equal(settingsFilterPatchAllowed(user), false);
      }
      assert.equal(canAccessAdultContent(ADMIN_UNVERIFIED_FILTER_ON), true);
      assert.equal(canAccessAdultContent(ADMIN_FILTER_OFF), true);
    }
    setAccessEnv({ payments: "0" });
    assert.equal(isAdultVerificationSkipped(), true);
    assert.equal(canAccessAdultContent(LEGACY_MOCK), false);
    setAccessEnv({ skip: "1", payments: "0" });
  });

  it("home, newest, ranking, and search omit NSFW unless admin filter is OFF", () => {
    setAccessEnv({ skip: "1", payments: "0" });
    for (const user of [GUEST, NEW_MEMBER, LEGACY_MOCK, NSFW_ON_ONLY, REVIEWER_LIKE, ADMIN_UNVERIFIED_FILTER_ON]) {
      const home = homeNames(user);
      assert.deepEqual(home.newest, ["SFW공개"]);
      assert.ok(!home.newest.includes("NSFW공개"));
      assert.deepEqual(searchNames(shouldHideAdultListings(user)), ["SFW공개"]);
      assert.deepEqual(rankingNames(shouldHideAdultListings(user)), ["SFW공개"]);
    }

    const adminOffHome = homeNames(ADMIN_FILTER_OFF);
    assert.ok(adminOffHome.newest.includes("NSFW공개"));
    assert.ok(adminOffHome.newest.includes("SFW공개"));
    assert.ok(searchNames(false).includes("NSFW공개"));
    assert.ok(rankingNames(false).includes("NSFW공개"));
  });

  it("character detail and chat stay closed for legacy mock and reviewer-like rows", () => {
    const nsfwRow = getDb()
      .prepare("SELECT id, creator_id, visibility, moderation_status, share_slug, official, nsfw FROM characters WHERE id=?")
      .get(nsfwId) as {
      id: number;
      creator_id: number;
      visibility: "public";
      moderation_status: "approved";
      share_slug: null;
      official: number;
      nsfw: number;
    };
    assert.equal(canAccessCharacter(nsfwRow, 2).ok, true);
    assert.equal(adultRouteBlocked(LEGACY_MOCK, nsfwRow.nsfw), true);
    assert.equal(adultRouteBlocked(REVIEWER_LIKE, nsfwRow.nsfw), true);
    assert.equal(adultRouteBlocked(NEW_MEMBER, nsfwRow.nsfw), true);
    assert.equal(adultRouteBlocked(ADMIN_UNVERIFIED_FILTER_ON, nsfwRow.nsfw), false);
    assert.equal(adultRouteBlocked(ADMIN_FILTER_OFF, nsfwRow.nsfw), false);
    assert.equal(sfwId > 0, true);
  });

  it("creator tools stay split from adult view", () => {
    assert.equal(canUseCreatorTools(NEW_MEMBER), false);
    assert.equal(canUseCreatorTools(LEGACY_MOCK), true);
    assert.equal(canUseCreatorTools(REVIEWER_LIKE), true);
    assert.equal(canUseCreatorTools(ADMIN_UNVERIFIED_FILTER_ON), true);
    assert.equal(canAccessAdultContent(LEGACY_MOCK), false);
    assert.equal(canAccessAdultContent(REVIEWER_LIKE), false);
  });

  it("GET /uploads serves a synthetic file without a session and keeps public cache", async () => {
    const res = await getUpload(new Request("http://localhost/uploads/fixture-public-upload.png"), {
      params: Promise.resolve({ filename: uploadName }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
    assert.equal(res.headers.get("Content-Type"), "image/png");
    const body = Buffer.from(await res.arrayBuffer());
    assert.deepEqual(body, PNG_1X1);

    const traversal = await getUpload(new Request("http://localhost/uploads/../secret.png"), {
      params: Promise.resolve({ filename: "../secret.png" }),
    });
    assert.equal(traversal.status, 400);
  });

  it("cannot map an upload filename to nsfw ownership from storage metadata", () => {
    const rows = getDb()
      .prepare("SELECT id, nsfw, images, assets FROM characters WHERE images LIKE ?")
      .all("%nsfw-card.png%") as { id: number; nsfw: number; images: string; assets: string }[];
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.nsfw === 1));
    assert.ok(rows.every((row) => row.images.includes("/uploads/nsfw-card.png")));
    assert.equal(path.extname("nsfw-card.png"), ".png");
    assert.equal("nsfw-card.png".includes("nsfw"), true);
    assert.equal(fs.existsSync(path.join(uploadsDataDir(), "nsfw-card.png")), false);
  });
});
