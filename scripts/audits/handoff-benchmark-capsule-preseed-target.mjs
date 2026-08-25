#!/usr/bin/env node
/**
 * Bootstrap an isolated target DB and insert one unrelated keyword lorebook
 * so the subsequent capsule import remaps lorebook_id away from the source id.
 *
 * Usage:
 *   TARGET_DATA_DIR=./data/handoff-benchmark-import \
 *   npx tsx scripts/audits/handoff-benchmark-capsule-preseed-target.mjs
 */

import fs from "fs";
import path from "path";
import Module from "module";
import { insertUnrelatedKeywordLorebook, parseArgs } from "./handoff-benchmark-capsule-lib.mjs";

const { env } = parseArgs(process.argv.slice(2));

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
};

const targetDataDir = path.resolve(
  env.TARGET_DATA_DIR ?? env.target_data_dir ?? "data/handoff-benchmark-import"
);
fs.mkdirSync(targetDataDir, { recursive: true });
process.env.DATA_DIR = targetDataDir;
process.env.NODE_ENV = "development";

const { getDb } = await import("../../src/lib/db.ts");
const db = getDb();
const preseedLorebookId = insertUnrelatedKeywordLorebook(db);

console.log(
  JSON.stringify(
    {
      ok: true,
      target_data_dir: targetDataDir,
      preseed_lorebook_id: preseedLorebookId,
    },
    null,
    2
  )
);
