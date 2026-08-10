import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  MEMORY_PANEL_BACKFILL_MAX_BATCHES_PER_REQUEST,
  prepareMemoryPanelView,
  syncAndCompressMemoryFromChat,
} from "./memory-backfill";

describe("memory backfill cost safety (static)", () => {
  it("panel catch-up allows at most one batch per request", () => {
    assert.equal(MEMORY_PANEL_BACKFILL_MAX_BATCHES_PER_REQUEST, 1);
  });

  it("app boot / migrate sources do not import panel backfill scheduler", () => {
    const serverJs = fs.readFileSync(path.join(process.cwd(), "server.js"), "utf8");
    const dbTs = fs.readFileSync(path.join(process.cwd(), "src/lib/db.ts"), "utf8");
    assert.equal(serverJs.includes("scheduleMemoryPanelBackfill"), false);
    assert.equal(serverJs.includes("catchUpRollingSummaries"), false);
    assert.equal(dbTs.includes("scheduleMemoryPanelBackfill"), false);
    assert.equal(dbTs.includes("syncAndCompressMemoryFromChat"), false);
  });

  it("GET memory route awaits catch-up when sealed batches are missing", () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/chat/memory/route.ts"),
      "utf8"
    );
    assert.match(route, /prepareMemoryPanelView\(backfillOpts\)/);
    assert.match(route, /needsSealCatchUp/);
    assert.match(route, /expectedSealedTurnCount/);
    assert.match(route, /if \(needsSealCatchUp\)/);
    assert.match(route, /await syncAndCompressMemoryFromChat\(backfillOpts\)/);
    assert.match(route, /catchUpSummary/);
  });

  it("ChatSettingsPanel does not attach backfill=1 on every memoryRefreshKey", () => {
    const panel = fs.readFileSync(
      path.join(process.cwd(), "src/components/ChatSettingsPanel.tsx"),
      "utf8"
    );
    assert.equal(panel.includes('memoryRefreshKey > 0 ? "&backfill=1"'), false);
    assert.match(panel, /memoryBackfillOnceRef/);
    assert.match(panel, /memoryBackfillOnceRef\.current = true/);
  });

  it("syncAndCompressMemoryFromChat source hard-caps maxRounds to 1", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/memory/memory-backfill.ts"),
      "utf8"
    );
    assert.match(
      src,
      /catchUpRollingSummaries\(\{\s*\.\.\.opts,\s*maxRounds:\s*MEMORY_PANEL_BACKFILL_MAX_BATCHES_PER_REQUEST/
    );
    assert.equal(src.includes("maxRounds: 5"), false);
  });

  it("processRollingSummaryBatch coalesces in-flight seal and skips when active row exists", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/memory/memory-rolling-summary.ts"),
      "utf8"
    );
    const fnStart = src.indexOf("export async function processRollingSummaryBatch");
    const fnEnd = src.indexOf("export async function regenerateMemoryRecordBatch");
    assert.ok(fnStart >= 0 && fnEnd > fnStart);
    const fn = src.slice(fnStart, fnEnd);
    assert.match(fn, /withRollingSummaryLock/);
    assert.match(fn, /active row already present/);
    const lockIdx = fn.indexOf("withRollingSummaryLock(");
    const composeIdx = fn.indexOf("await composeBatchScopePayload(");
    assert.ok(lockIdx >= 0 && composeIdx > lockIdx);
  });

  it("prepareMemoryPanelView is exported for read-only reconcile path", () => {
    assert.equal(typeof prepareMemoryPanelView, "function");
    assert.equal(typeof syncAndCompressMemoryFromChat, "function");
  });
});
