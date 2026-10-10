/**
 * Operator CLI for MAIN_RP_STYLE_LENGTH golden create/reload/current-live.
 * Public stdout is hash-only. Provider POST = 0. Production DB write = 0.
 */
import "./lib/rpQualityPrecallEgressGuard";

import { DatabaseSync } from "node:sqlite";

import {
  MAIN_RP_STYLE_LENGTH_PRIVATE_ROOT,
  MAIN_RP_STYLE_LENGTH_TARGET,
} from "../src/lib/rpMainRpStyleLengthFixture";
import {
  compareCurrentLiveToGolden,
  createLiveMainRpStyleLengthGolden,
  dryRunMainRpStyleLengthEvaluation,
  publicGoldenStdout,
  reloadMainRpStyleLengthGolden,
  type GoldenListingMeta,
} from "./lib/rpMainRpStyleLengthGolden";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredArg(name: string): string {
  const value = argValue(name);
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function readListingMeta(dbPath: string, characterId: number): GoldenListingMeta {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec("PRAGMA query_only = ON");
    const row = db
      .prepare(
        `SELECT nsfw, official, length(greeting) greeting_len
         FROM characters WHERE id = ?`
      )
      .get(characterId) as
      | { nsfw?: number; official?: number; greeting_len?: number }
      | undefined;
    return {
      nsfwListing: typeof row?.nsfw === "number" ? row.nsfw : null,
      officialListing: typeof row?.official === "number" ? row.official : null,
      greetingChars: typeof row?.greeting_len === "number" ? row.greeting_len : null,
    };
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const action = requiredArg("--action");
  const version = Number(requiredArg("--version"));
  const dbPath = argValue("--db") ?? "/data/app.db";
  const root = argValue("--root") ?? MAIN_RP_STYLE_LENGTH_PRIVATE_ROOT;
  const deployedGitSha = argValue("--deploy-sha") ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? "";

  if (action === "create") {
    const created = createLiveMainRpStyleLengthGolden({
      dbPath,
      deployedGitSha,
      env: process.env,
      version,
      root,
      listing: readListingMeta(dbPath, MAIN_RP_STYLE_LENGTH_TARGET.characterId),
    });
    process.stdout.write(
      publicGoldenStdout({
        action: "create",
        publicManifest: created.publicManifest,
        sealedSha256: created.sealedSha256,
        providerPosts: 0,
        dbWrites: 0,
      })
    );
    return;
  }

  if (action === "reload") {
    const loaded = reloadMainRpStyleLengthGolden({ root, version });
    process.stdout.write(
      publicGoldenStdout({
        action: "reload",
        publicManifest: loaded.publicManifest,
        sealedSha256: loaded.sealedSha256,
        providerPosts: 0,
        dbWrites: 0,
      })
    );
    return;
  }

  if (action === "evaluate") {
    const mode = (argValue("--mode") ?? "GOLDEN_SNAPSHOT") as "GOLDEN_SNAPSHOT" | "CURRENT_LIVE";
    const dry = await dryRunMainRpStyleLengthEvaluation({
        mode,
        version,
        root,
        dbPath,
        deployedGitSha,
        env: process.env,
        verifyPinnedPublicV1: process.argv.includes("--verify-pinned-v1"),
      });
    process.stdout.write(
      publicGoldenStdout({
        action: "evaluate",
        publicManifest: dry.publicManifest,
        sealedSha256: dry.sealedSha256,
        compare: dry.compare,
        providerPosts: dry.providerPosts,
        dbWrites: dry.dbWrites,
        evaluation: {
          mode: dry.mode,
          sealOk: dry.seal.ok,
          requestBodiesPresent: dry.requestBodiesPresent,
          fingerprintsMatchPinnedV1: dry.fingerprintsMatchPinnedV1,
          transportPosts: dry.transportPosts,
          networkAttempts: dry.networkAttempts,
        },
      })
    );
    return;
  }

  if (action === "current-live") {
    const compare = compareCurrentLiveToGolden({
      dbPath,
      deployedGitSha,
      env: process.env,
      version,
      root,
    });
    process.stdout.write(
      publicGoldenStdout({
        action: "current-live",
        compare,
        providerPosts: 0,
        dbWrites: 0,
      })
    );
    return;
  }

  throw new Error("action must be create, reload, current-live, or evaluate");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
