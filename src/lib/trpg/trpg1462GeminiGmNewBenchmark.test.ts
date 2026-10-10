import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildTrpgGmProviderRequest, GM_MAX_PROVIDER_ATTEMPTS } from "./gmCall";
import { TRPG_GM_SYSTEM } from "./gmPrompt";
import { TRPG_GM_MODEL } from "./types";
import {
  apply1480LocationRule,
  assembleTrpg1462NewBenchmark,
  assertProductionGmContract,
  sha256Utf8,
  TRPG_1462_HISTORICAL_F_PROMPT_SHA256,
  TRPG_1462_MIN_PAID_REQUEST_IDS,
  TRPG_1462_NEW_LOCATION_RULES,
  TRPG_1462_OLD_LOCATION_RULES,
  TRPG_1462_PINNED_REQUEST_HASHES,
  TRPG_1462_SYSTEM_SHA_1465,
  TRPG_1462_SYSTEM_SHA_1480,
} from "./trpg1462GeminiGmNewBenchmark";
import {
  assertNotForbiddenPrivatePath,
  canPostTrpg1462Attempt,
  createTrpg1462AttemptJournal,
  loadTrpg1462AttemptJournal,
  reserveTrpg1462Attempt,
  settleTrpg1462Attempt,
  trpg1462PrecallJournalPath,
  writeTrpg1462AttemptJournal,
} from "./trpg1462GeminiGmPrecallJournal";

describe("TRPG #1462 Gemini GM new benchmark PRECALL", () => {
  const assembled = assembleTrpg1462NewBenchmark();

  it("keeps #1465 system and derives #1480 by the intended Rules sentence only", () => {
    assert.equal(sha256Utf8(TRPG_GM_SYSTEM), TRPG_1462_SYSTEM_SHA_1465);
    assert.match(TRPG_GM_SYSTEM, new RegExp(TRPG_1462_OLD_LOCATION_RULES));
    assert.doesNotMatch(TRPG_GM_SYSTEM, /world\/NPC location remain yours/);
    const system1480 = apply1480LocationRule(TRPG_GM_SYSTEM);
    assert.equal(sha256Utf8(system1480), TRPG_1462_SYSTEM_SHA_1480);
    assert.equal(system1480.replace(TRPG_1462_NEW_LOCATION_RULES, TRPG_1462_OLD_LOCATION_RULES), TRPG_GM_SYSTEM);
    assert.equal(assembled.system1465, TRPG_GM_SYSTEM);
    assert.equal(assembled.system1480, system1480);
  });

  it("freezes identical F users for A/B and does not replay #1468 F", () => {
    assert.equal(assembled.requests.A.userSha256, assembled.requests.B.userSha256);
    assert.notEqual(assembled.requests.A.promptSha256, TRPG_1462_HISTORICAL_F_PROMPT_SHA256);
    assert.ok(assembled.users.F.includes("달을 주머니에 넣는다."));
    assert.ok(assembled.users.F.includes("no_check reason=no_meaningful_uncertainty"));
    assert.doesNotMatch(assembled.users.F, /\[GM SECRET/);
  });

  it("pins movement and stay-still control users across both systems", () => {
    assert.equal(assembled.requests.C_1465.userSha256, assembled.requests.C_1480.userSha256);
    assert.equal(assembled.requests.D_1465.userSha256, assembled.requests.D_1480.userSha256);
    assert.ok(assembled.users.C.includes("열린 찻집 문으로 들어간다."));
    assert.ok(assembled.users.C.includes("no_check reason=routine_traversal"));
    assert.ok(assembled.users.D.includes("그 자리에 서서 골목 소리를 듣는다."));
    assert.ok(assembled.users.D.includes("no_check reason=no_meaningful_uncertainty"));
    assert.match(TRPG_GM_SYSTEM, /movement stays player choice/);
    assert.match(TRPG_GM_SYSTEM, /Extra NPCs: invent world extras/);
  });

  it("pins request hashes and production Gemini GM body contract", () => {
    assert.equal(TRPG_GM_MODEL, "gemini-3.8-flash");
    assert.equal(GM_MAX_PROVIDER_ATTEMPTS, 2);
    for (const id of Object.keys(TRPG_1462_PINNED_REQUEST_HASHES) as Array<
      keyof typeof TRPG_1462_PINNED_REQUEST_HASHES
    >) {
      const row = assembled.requests[id];
      const pinned = TRPG_1462_PINNED_REQUEST_HASHES[id];
      assert.equal(row.userSha256, pinned.userSha256, id);
      assert.equal(row.promptSha256, pinned.promptSha256, id);
      assert.equal(row.requestBodySha256, pinned.requestBodySha256, id);
      assertProductionGmContract(row);
    }
    const bodyA = JSON.stringify(
      buildTrpgGmProviderRequest({ system: assembled.system1465, user: assembled.users.F }).body
    );
    const bodyB = JSON.stringify(
      buildTrpgGmProviderRequest({ system: assembled.system1480, user: assembled.users.F }).body
    );
    assert.equal(bodyA.replace(TRPG_1462_OLD_LOCATION_RULES, TRPG_1462_NEW_LOCATION_RULES), bodyB);
  });

  it("blocks one-shot retransmit after reserve, posted, unknown, or timeout", () => {
    const bodies = {
      A: assembled.requests.A.requestBodySha256,
      B: assembled.requests.B.requestBodySha256,
      C_1465: assembled.requests.C_1465.requestBodySha256,
      C_1480: assembled.requests.C_1480.requestBodySha256,
      D_1465: assembled.requests.D_1465.requestBodySha256,
      D_1480: assembled.requests.D_1480.requestBodySha256,
    };
    let journal = createTrpg1462AttemptJournal(bodies);
    assert.deepEqual(journal.minPaidRequestIds, TRPG_1462_MIN_PAID_REQUEST_IDS);
    assert.equal(journal.doNotCall, "callTrpgGm");
    assert.equal(journal.bodyOwner, "buildTrpgGmProviderRequest");
    assert.equal(journal.unknownOrTimeoutRetransmit, false);
    assert.equal(canPostTrpg1462Attempt(journal, "A", bodies.A), true);

    journal = reserveTrpg1462Attempt(journal, "A", bodies.A);
    assert.equal(canPostTrpg1462Attempt(journal, "A", bodies.A), false);
    assert.throws(() => reserveTrpg1462Attempt(journal, "A", bodies.A), /one-shot blocked/);

    const posted = settleTrpg1462Attempt(journal, "A", "posted", 200);
    assert.equal(posted.paidPosts, 1);
    assert.equal(canPostTrpg1462Attempt(posted, "A", bodies.A), false);

    let unknown = reserveTrpg1462Attempt(createTrpg1462AttemptJournal(bodies), "B", bodies.B);
    unknown = settleTrpg1462Attempt(unknown, "B", "unknown");
    assert.equal(canPostTrpg1462Attempt(unknown, "B", bodies.B), false);

    let timeout = reserveTrpg1462Attempt(createTrpg1462AttemptJournal(bodies), "C_1480", bodies.C_1480);
    timeout = settleTrpg1462Attempt(timeout, "C_1480", "timeout");
    assert.equal(canPostTrpg1462Attempt(timeout, "C_1480", bodies.C_1480), false);

    const dir = mkdtempSync(join(tmpdir(), "trpg1462-precall-"));
    const path = trpg1462PrecallJournalPath(dir);
    writeTrpg1462AttemptJournal(path, createTrpg1462AttemptJournal(bodies));
    const reloaded = loadTrpg1462AttemptJournal(path);
    assert.equal(reloaded.paidPosts, 0);
    assert.equal(canPostTrpg1462Attempt(reloaded, "D_1480", bodies.D_1480), true);
    assert.throws(() => assertNotForbiddenPrivatePath("/data/private-golden-fixtures/v1"));
    assert.throws(() => assertNotForbiddenPrivatePath("/data/rp-quality-12call/journal.json"));
    assert.doesNotThrow(() => assertNotForbiddenPrivatePath("/data/private-trpg-1462-gm-precall/attempt-journal.json"));
  });
});
