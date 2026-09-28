import "server-only";

import { getDb } from "@/lib/db";
import { createSiteManagedStudioAccount } from "@/lib/siteManagedAccounts";

const LIVE_ENV = "OFFICIAL_ROMANCE_STUDIO_BOOTSTRAP";
const EMAIL = "romance@site-managed.invalid";
const NICKNAME = "로맨스 공식 스튜디오";

function stop(message: string): never {
  throw new Error(`ROMANCE_STUDIO_BOOTSTRAP STOP: ${message}`);
}

function main(): void {
  if (process.env[LIVE_ENV] !== "1") {
    console.log(
      `[romance-studio-bootstrap] NOT_RUN: set ${LIVE_ENV}=1 for the one-shot internal studio bootstrap`
    );
    return;
  }

  const db = getDb();
  const managed = db
    .prepare(
      `SELECT id, email, nickname, is_adult, is_admin, site_managed
       FROM users
       WHERE site_managed=1
       ORDER BY id`
    )
    .all() as Array<{
      id: number;
      email: string;
      nickname: string;
      is_adult: number;
      is_admin: number;
      site_managed: number;
    }>;

  const target = managed.find((row) => row.email.toLowerCase() === EMAIL);
  const otherAdultManaged = managed.filter(
    (row) => row.email.toLowerCase() !== EMAIL && row.is_adult === 1
  );
  if (otherAdultManaged.length > 0) {
    stop(
      `unexpected existing adult site-managed accounts: ${JSON.stringify(
        otherAdultManaged.map((row) => ({
          id: row.id,
          email: row.email,
          nickname: row.nickname,
        }))
      )}`
    );
  }

  if (target) {
    if (
      target.nickname !== NICKNAME ||
      target.site_managed !== 1 ||
      target.is_adult !== 1 ||
      target.is_admin !== 0
    ) {
      stop(
        `existing romance studio row has unexpected flags: ${JSON.stringify({
          id: target.id,
          email: target.email,
          nickname: target.nickname,
          is_adult: target.is_adult,
          is_admin: target.is_admin,
          site_managed: target.site_managed,
        })}`
      );
    }
    console.log(
      JSON.stringify({
        status: "ROMANCE_STUDIO_ALREADY_READY",
        id: target.id,
        email: target.email,
        nickname: target.nickname,
        siteManaged: true,
        interactiveLogin: false,
      })
    );
    return;
  }

  const sameEmail = db
    .prepare(
      `SELECT id, email, nickname, is_adult, is_admin, site_managed
       FROM users WHERE lower(email)=lower(?)`
    )
    .get(EMAIL) as
    | {
        id: number;
        email: string;
        nickname: string;
        is_adult: number;
        is_admin: number;
        site_managed: number;
      }
    | undefined;
  if (sameEmail) {
    stop(
      `reserved romance studio email already belongs to a non-canonical row: ${JSON.stringify({
        id: sameEmail.id,
        nickname: sameEmail.nickname,
        is_adult: sameEmail.is_adult,
        is_admin: sameEmail.is_admin,
        site_managed: sameEmail.site_managed,
      })}`
    );
  }

  const created = createSiteManagedStudioAccount({
    nickname: NICKNAME,
    email: EMAIL,
    isAdult: true,
  });

  const after = db
    .prepare(
      `SELECT id, email, nickname, is_adult, is_admin, site_managed
       FROM users WHERE id=?`
    )
    .get(created.id) as
    | {
        id: number;
        email: string;
        nickname: string;
        is_adult: number;
        is_admin: number;
        site_managed: number;
      }
    | undefined;

  if (
    !after ||
    after.email.toLowerCase() !== EMAIL ||
    after.nickname !== NICKNAME ||
    after.site_managed !== 1 ||
    after.is_adult !== 1 ||
    after.is_admin !== 0
  ) {
    stop("post-create studio account invariant failed");
  }

  const adultManagedCount = db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE site_managed=1 AND is_adult=1")
    .get() as { n: number };
  if (Number(adultManagedCount.n) !== 1) {
    stop(
      `adult site-managed count=${adultManagedCount.n}; expected exactly 1 after bootstrap`
    );
  }

  console.log(
    JSON.stringify({
      status: "ROMANCE_STUDIO_CREATED",
      id: after.id,
      email: after.email,
      nickname: after.nickname,
      siteManaged: true,
      interactiveLogin: false,
    })
  );
}

try {
  main();
} catch (error) {
  console.error(
    "[romance-studio-bootstrap] STOP:",
    error instanceof Error ? error.stack ?? error.message : String(error)
  );
  process.exit(1);
}
