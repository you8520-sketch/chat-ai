/**
 * Status-OFF deferred shared owner — GET /suggested-replies is read-only;
 * generation is owned by the post-SSE shared inference path.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { resolveActiveAssistantGenerationScope } from "@/lib/assistantGenerationScope";
import {
  loadMessageSuggestedReplies,
  markMessageSuggestedRepliesPending,
  scheduleSuggestedRepliesExtraction,
} from "@/lib/suggestedReplies/job";
import { resolveClientSuggestedReplies } from "@/lib/suggestedReplies/parse";

const CHAT_ID = 88001;
const USER_ID = 88002;
const CHARACTER_ID = 88003;
const MSG_ID = 88004;

function seedAssistantMessage(): void {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHARACTER_ID);
  db.prepare("DELETE FROM users WHERE id=?").run(USER_ID);

  db.prepare(
    "INSERT INTO users (id, email, nickname, pw_hash, points) VALUES (?,?,?,?,2000)"
  ).run(USER_ID, "race@test.local", "race", "x");
  db.prepare("INSERT INTO characters (id, name) VALUES (?,?)").run(CHARACTER_ID, "라이크");
  db.prepare(
    "INSERT INTO chats (id, user_id, character_id) VALUES (?,?,?)"
  ).run(CHAT_ID, USER_ID, CHARACTER_ID);
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, alternates, active_variant, model, request_id)
     VALUES (?, ?, 'assistant', '라이크는 복도에 서 있었다.', NULL, 'completed', '[]', 0, 'gpt-5.6-luna', 'req-status-off-race')`
  ).run(MSG_ID, CHAT_ID);
  db.prepare("UPDATE messages SET suggested_replies_json=NULL WHERE id=?").run(MSG_ID);
}

describe("status-OFF deferred shared owner — suggested replies read path", () => {
  before(() => {
    installIsolatedTestDatabase();
  });

  it("GET route is pure read — no requeue or extraction eligibility helpers", () => {
    const getRoute = readFileSync(
      join(process.cwd(), "src/app/api/chat/suggested-replies/route.ts"),
      "utf8"
    );
    assert.doesNotMatch(getRoute, /requeueSuggestedRepliesExtractionIfNeeded/);
    assert.doesNotMatch(getRoute, /shouldEnsureSuggestedRepliesExtraction/);
    assert.match(getRoute, /Pure read\/poll/);
  });

  it("greeting standalone extract makes exactly one provider call when shared budget not consumed", async () => {
    seedAssistantMessage();
    const scope = resolveActiveAssistantGenerationScope(MSG_ID);
    assert.ok(scope);
    let providerCalls = 0;
    scheduleSuggestedRepliesExtraction({
      messageId: MSG_ID,
      chatId: CHAT_ID,
      generationScope: scope,
      charName: "라이크",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: "라이크는 복도에 서 있었다.",
      __testExtract: async () => {
        providerCalls += 1;
        return [];
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(providerCalls, 1);
  });

  it("pending reservation before SSE done exposes read-only poll state", () => {
    seedAssistantMessage();
    const scope = resolveActiveAssistantGenerationScope(MSG_ID);
    assert.ok(scope);

    markMessageSuggestedRepliesPending(MSG_ID, scope);
    const record = loadMessageSuggestedReplies(MSG_ID);
    assert.equal(record?.pending, true);
    assert.equal(record?.generationSequence, scope.generationSequence);

    const client = resolveClientSuggestedReplies(record);
    assert.equal(client.suggestedRepliesPending, true);
    assert.deepEqual(client.suggestedReplies, []);

    let providerCalls = 0;
    scheduleSuggestedRepliesExtraction({
      messageId: MSG_ID,
      chatId: CHAT_ID,
      generationScope: scope,
      charName: "라이크",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: "라이크는 복도에 서 있었다.",
      sharedInitialAttemptConsumed: true,
      __testExtract: async () => {
        providerCalls += 1;
        return [];
      },
    });
    assert.equal(providerCalls, 0);
    assert.equal(loadMessageSuggestedReplies(MSG_ID)?.noRetry, true);
  });

  it("route reserves pending when deferPostTurnShared && generation eligible", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/chat/route.ts"), "utf8");
    assert.match(
      route,
      /else if \(deferPostTurnShared\) \{[\s\S]*markMessageSuggestedRepliesPending\(aiMessageId, postTurnGenerationScope\)/,
      "status-OFF must persist generation-scoped pending before SSE done"
    );
  });

  it("status-OFF branch defers shared provider past SSE done", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/chat/route.ts"), "utf8");
    const marker = "} else if (isMemoryFeatureEnabled() || suggestedRepliesGenerationEligible) {";
    const start = route.indexOf(marker);
    assert.ok(start > 0);
    const end = route.indexOf("if (visualPolicy.hair", start);
    assert.ok(end > start);
    assert.doesNotMatch(
      route.slice(start, end),
      /await runPostTurnRelationshipOnlyInitial/
    );
  });
});
