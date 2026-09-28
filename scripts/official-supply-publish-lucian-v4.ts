import "server-only";

import { OfficialSupplyStore } from "@/lib/officialSupply/store";
import { publishOfficialSupplyCharacter } from "@/lib/officialSupply/publish";

const LIVE_ENV = "OFFICIAL_LUCIAN_PUBLISH_LIVE";
const DRAFT_KEY = "pilot-rf-v4-03";
const STUDIO_EMAIL = "romance@site-managed.invalid";
const STUDIO_NICKNAME = "로맨스 공식 스튜디오";

function stop(message: string): never {
  throw new Error(`LUCIAN_PUBLISH STOP: ${message}`);
}

function main(): void {
  if (process.env[LIVE_ENV] !== "1") {
    console.log(
      `[lucian-publish] NOT_RUN: set ${LIVE_ENV}=1 after private staging is complete`
    );
    return;
  }

  const store = new OfficialSupplyStore();
  const record = store.getCharacter(DRAFT_KEY);
  if (record.stagedCharacterId == null) {
    stop("Lucian has no staged character id");
  }
  if (record.stage !== "staged_private" && record.stage !== "published") {
    stop(`supply stage=${record.stage}; expected staged_private or published`);
  }

  const before = store.database
    .prepare(
      `SELECT c.id, c.creator_id, c.name, c.visibility, c.official,
              c.moderation_status, c.nsfw, c.assets,
              u.email, u.nickname, u.site_managed, u.is_admin, u.is_adult
       FROM characters c
       JOIN users u ON u.id=c.creator_id
       WHERE c.id=?`
    )
    .get(record.stagedCharacterId) as
    | {
        id: number;
        creator_id: number;
        name: string;
        visibility: string;
        official: number;
        moderation_status: string;
        nsfw: number;
        assets: string;
        email: string;
        nickname: string;
        site_managed: number;
        is_admin: number;
        is_adult: number;
      }
    | undefined;

  if (!before) stop("staged character or creator row missing");
  if (
    before.email.toLowerCase() !== STUDIO_EMAIL ||
    before.nickname !== STUDIO_NICKNAME ||
    before.site_managed !== 1 ||
    before.is_admin !== 0 ||
    before.is_adult !== 1
  ) {
    stop(
      `staged owner is not the canonical romance studio: ${JSON.stringify({
        creator_id: before.creator_id,
        email: before.email,
        nickname: before.nickname,
        site_managed: before.site_managed,
        is_admin: before.is_admin,
        is_adult: before.is_adult,
      })}`
    );
  }
  if (before.name !== "루시안 바스케스") {
    stop(`staged character name=${before.name}`);
  }
  if (before.nsfw !== 0) {
    stop("Lucian canonical character must remain SFW");
  }

  let parsedAssets: unknown[] = [];
  try {
    const parsed = JSON.parse(before.assets || "[]") as unknown;
    parsedAssets = Array.isArray(parsed) ? parsed : [];
  } catch {
    stop("staged assets JSON is malformed");
  }
  if (parsedAssets.length !== 14) {
    stop(`staged asset count=${parsedAssets.length}; expected 14`);
  }

  const result = publishOfficialSupplyCharacter({
    store,
    draftKey: DRAFT_KEY,
    actorUserId: before.creator_id,
  });

  const afterRecord = store.getCharacter(DRAFT_KEY);
  const after = store.database
    .prepare(
      `SELECT c.id, c.creator_id, c.name, c.visibility, c.official,
              c.moderation_status, u.email, u.nickname, u.site_managed
       FROM characters c
       JOIN users u ON u.id=c.creator_id
       WHERE c.id=?`
    )
    .get(record.stagedCharacterId) as
    | {
        id: number;
        creator_id: number;
        name: string;
        visibility: string;
        official: number;
        moderation_status: string;
        email: string;
        nickname: string;
        site_managed: number;
      }
    | undefined;

  if (
    !after ||
    afterRecord.stage !== "published" ||
    after.visibility !== "public" ||
    after.official !== 1 ||
    after.moderation_status !== "approved" ||
    after.creator_id !== before.creator_id ||
    after.email.toLowerCase() !== STUDIO_EMAIL ||
    after.nickname !== STUDIO_NICKNAME ||
    after.site_managed !== 1
  ) {
    stop(
      `publish post-condition failed: ${JSON.stringify({
        supplyStage: afterRecord.stage,
        row: after,
      })}`
    );
  }

  console.log(
    JSON.stringify({
      status: result.status === "already_published" ? "LUCIAN_ALREADY_PUBLISHED" : "LUCIAN_PUBLISHED",
      characterId: after.id,
      creatorId: after.creator_id,
      creatorNickname: after.nickname,
      visibility: after.visibility,
      official: after.official,
      moderationStatus: after.moderation_status,
      assetCount: parsedAssets.length,
    })
  );
}

try {
  main();
} catch (error) {
  console.error(
    "[lucian-publish] STOP:",
    error instanceof Error ? error.stack ?? error.message : String(error)
  );
  process.exit(1);
}
