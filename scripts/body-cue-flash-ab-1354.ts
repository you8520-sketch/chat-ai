/**
 * #1354 operator CLI. Default is prepare (paid POST = 0).
 * Secret via --secret-file (0600) or --secret-stdin only. Never argv.
 */
import fs from "node:fs";

import {
  defaultProductionDbPath,
  runBodyCueFlashAb1354,
  sealLiveDeployedInputFromDb,
  type ExperimentSecretSource,
  type RunnerMode,
} from "./lib/bodyCueFlashAb1354Runner";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  mode: RunnerMode;
  secretSource: ExperimentSecretSource | null;
  dbPath: string;
  artifactPath: string | null;
} {
  let mode: RunnerMode = "prepare";
  let secretSource: ExperimentSecretSource | null = null;
  let dbPath = defaultProductionDbPath();
  let artifactPath: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--help") {
      console.log(
        [
          "Usage:",
          "  npm run ab:1354-flash -- --mode prepare",
          "  npm run ab:1354-flash -- --mode execute --secret-file /path/to/0600-key",
          "  npm run ab:1354-flash -- --mode execute --secret-stdin",
          "",
          "Secret is never accepted as a CLI value. Use --secret-file or --secret-stdin.",
          "Default mode is prepare: live seal + assemble, paid POST count = 0.",
        ].join("\n")
      );
      process.exit(0);
    }
    if (arg === "--mode") {
      const value = argv[++i];
      if (value !== "prepare" && value !== "execute") fail("invalid --mode");
      mode = value;
      continue;
    }
    if (arg === "--secret-file") {
      const path = argv[++i];
      if (!path) fail("--secret-file requires a path");
      secretSource = { kind: "file", path };
      continue;
    }
    if (arg === "--secret-stdin") {
      secretSource = {
        kind: "stdin",
        read: () => fs.readFileSync(0, "utf8"),
      };
      continue;
    }
    if (arg === "--db-path") {
      const path = argv[++i];
      if (!path) fail("--db-path requires a path");
      dbPath = path;
      continue;
    }
    if (arg === "--artifact") {
      const path = argv[++i];
      if (!path) fail("--artifact requires a path");
      artifactPath = path;
      continue;
    }
    fail("unknown or positional argument rejected (secrets must not be argv)");
  }

  return { mode, secretSource, dbPath, artifactPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifact = await runBodyCueFlashAb1354({
    mode: args.mode,
    secretSource: args.secretSource,
    seal: () => sealLiveDeployedInputFromDb(args.dbPath),
    productionDeploySha: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
  });
  const json = JSON.stringify(artifact, null, 2);
  if (args.artifactPath) {
    fs.writeFileSync(args.artifactPath, json);
  }
  console.log(json);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "runner failed";
  console.error(message);
  process.exit(1);
});
