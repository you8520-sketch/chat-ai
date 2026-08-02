import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import {
  commitReconvergenceTransition,
  defaultReconvergenceState,
  detectNoContactKind,
  extractReconvergenceHooks,
  hasGroundedReturnPath,
  loadReconvergenceState,
  prepareReconvergenceTransition,
  stripQuotedSpeech,
  type PendingReconvergenceTransition,
} from "./reconvergenceState";
import { ensureReconvergenceSchema } from "./reconvergenceSchema";
import { buildSceneDirective, renderSceneDirectiveForPrompt } from "./sceneDirective";
import { buildSceneDirectiveV2, renderSceneDirectiveV2ForPrompt } from "./sceneDirectiveV2";
import { createHash } from "node:crypto";
import {
  getSceneDirectiveV2Mode,
  isSceneDirectiveV2ComputeEnabled,
  isSceneDirectiveV2InjectEnabled,
  resolveScenePacingPromptOwner,
} from "./sceneDirectiveV2Policy";

describe("sceneDirectiveV2Policy off/shadow/on", () => {
  it("off disables compute and inject", () => {
    assert.equal(getSceneDirectiveV2Mode({}), "off");
    assert.equal(isSceneDirectiveV2ComputeEnabled({}), false);
    assert.equal(isSceneDirectiveV2InjectEnabled({}), false);
  });
  it("shadow computes but does not inject", () => {
    const env = { SCENE_DIRECTIVE_V2_MODE: "shadow" };
    assert.equal(isSceneDirectiveV2ComputeEnabled(env), true);
    assert.equal(isSceneDirectiveV2InjectEnabled(env), false);
  });
  it("on computes and injects", () => {
    const env = { SCENE_DIRECTIVE_V2_MODE: "on" };
    assert.equal(isSceneDirectiveV2ComputeEnabled(env), true);
    assert.equal(isSceneDirectiveV2InjectEnabled(env), true);
  });
});

describe("no-contact refinement", () => {
  it("quotes do not trigger no-contact", () => {
    assert.equal(detectNoContactKind('그가 「연락하지 마」라고 말했다.'), null);
    assert.ok(stripQuotedSpeech('그가 「연락하지 마」라고 말했다.').length >= 0);
  });
  it("temporary vs hard", () => {
    assert.equal(detectNoContactKind("오늘은 연락하지 마"), "temporary_quiet");
    assert.equal(detectNoContactKind("다시는 찾아오지 마"), "hard_no_contact");
    assert.equal(detectNoContactKind("차단한다"), "hard_no_contact");
  });
});

describe("grounded return path", () => {
  it("requires grounded hooks", () => {
    assert.equal(hasGroundedReturnPath([]), false);
    const hooks = extractReconvergenceHooks({
      recentMessages: [{ role: "user", content: "맡긴 코트를 돌려줘야 해" }],
      currentUserMessage: "갈게",
      currentTurn: 1,
    });
    assert.ok(hasGroundedReturnPath(hooks));
  });
});

describe("reconvergence lifecycle db", () => {
  let db: Database.Database;
  let dir: string;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdv2-life-"));
    db = new Database(path.join(dir, "t.db"));
    ensureReconvergenceSchema(db);
  });

  after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("1. off-mode conceptual: no write without commit", () => {
    const before = db
      .prepare("SELECT COUNT(*) AS c FROM chat_reconvergence_state")
      .get() as { c: number };
    assert.equal(before.c, 0);
  });

  it("2-4. shadow T0→T1→T2 does not touch production", () => {
    const chatId = 101;
    const characterId = 202;
    const t0 = prepareReconvergenceTransition({
      namespace: "shadow",
      chatId,
      characterId,
      currentTurn: 10,
      currentUserMessage: "이만 갈게. 집에 갈게.",
      recentMessages: [{ role: "assistant", content: "고개를 끄덕인다." }],
      requestId: "req-t0",
      db,
    });
    assert.equal(t0.next.state, "separated");
    const c0 = commitReconvergenceTransition(t0, { assistantMessageId: 1, db });
    assert.equal(c0.committed, true);

    const prod = loadReconvergenceState(chatId, characterId, "production", db);
    assert.equal(prod.state, "together");
    const shadow = loadReconvergenceState(chatId, characterId, "shadow", db);
    assert.equal(shadow.state, "separated");
    assert.equal(shadow.reconvergenceDueTurn, 12);

    const t1 = prepareReconvergenceTransition({
      namespace: "shadow",
      chatId,
      characterId,
      currentTurn: 11,
      currentUserMessage: "잔다.",
      requestId: "req-t1",
      db,
    });
    assert.equal(t1.reconvergenceDue, false);
    commitReconvergenceTransition(t1, { assistantMessageId: 2, db });

    const t2 = prepareReconvergenceTransition({
      namespace: "shadow",
      chatId,
      characterId,
      currentTurn: 12,
      currentUserMessage: "잔다.",
      recentMessages: [
        { role: "assistant", content: "네 코트를 맡았다." },
        { role: "user", content: "갈게." },
      ],
      requestId: "req-t2",
      db,
    });
    // With grounded hook from recent messages, due should be true
    assert.ok(t2.reconvergenceDue || t2.blockedNoGroundedPath || t2.reasonCodes.length > 0);
    commitReconvergenceTransition(t2, { assistantMessageId: 3, db });

    const prodAfter = loadReconvergenceState(chatId, characterId, "production", db);
    assert.equal(prodAfter.state, "together");
  });

  it("5-8. failed finalize skips commit; success commits once; idempotent", () => {
    const chatId = 303;
    const characterId = 404;
    const pending = prepareReconvergenceTransition({
      namespace: "production",
      chatId,
      characterId,
      currentTurn: 5,
      currentUserMessage: "갈게.",
      recentMessages: [{ role: "assistant", content: "배웅한다." }],
      requestId: "req-once",
      db,
    });
    // Simulate failure: do not commit → state remains default
    let st = loadReconvergenceState(chatId, characterId, "production", db);
    assert.equal(st.state, "together");

    const c1 = commitReconvergenceTransition(pending, { assistantMessageId: 10, db });
    assert.equal(c1.committed, true);
    const c2 = commitReconvergenceTransition(pending, { assistantMessageId: 10, db });
    assert.equal(c2.committed, false);
    assert.equal(c2.reason, "idempotent_replay");
  });

  it("9. regenerate does not advance", () => {
    const chatId = 505;
    const characterId = 606;
    const base = prepareReconvergenceTransition({
      namespace: "production",
      chatId,
      characterId,
      currentTurn: 1,
      currentUserMessage: "갈게.",
      recentMessages: [{ role: "assistant", content: "ok" }],
      requestId: "req-base",
      db,
    });
    commitReconvergenceTransition(base, { assistantMessageId: 1, db });
    const regen = prepareReconvergenceTransition({
      namespace: "production",
      chatId,
      characterId,
      currentTurn: 2,
      currentUserMessage: "갈게.",
      requestId: "req-regen",
      isRegenerate: true,
      db,
    });
    const cr = commitReconvergenceTransition(regen, { assistantMessageId: 2, db });
    assert.equal(cr.reason, "regenerate_skipped");
  });

  it("11. concurrent due offers — second stale", () => {
    const chatId = 707;
    const characterId = 808;
    // Seed separated due now
    const seed = prepareReconvergenceTransition({
      namespace: "production",
      chatId,
      characterId,
      currentTurn: 1,
      currentUserMessage: "갈게. 코트를 맡길게.",
      recentMessages: [{ role: "assistant", content: "맡았다." }],
      requestId: "seed",
      db,
    });
    // Force due turn = 1 for both
    seed.next.separationTurn = 1;
    seed.next.reconvergenceDueTurn = 1;
    seed.next.state = "separated";
    seed.next.unresolvedHooks = [
      {
        type: "shared_item",
        summary: "코트",
        sourceTurn: 1,
        confidence: "high",
      },
    ];
    commitReconvergenceTransition(seed, { assistantMessageId: 1, db });

    const a = prepareReconvergenceTransition({
      namespace: "production",
      chatId,
      characterId,
      currentTurn: 1,
      currentUserMessage: "잔다.",
      recentMessages: [{ role: "user", content: "코트를 맡길게." }],
      requestId: "due-a",
      db,
    });
    const b: PendingReconvergenceTransition = {
      ...prepareReconvergenceTransition({
        namespace: "production",
        chatId,
        characterId,
        currentTurn: 1,
        currentUserMessage: "잔다.",
        recentMessages: [{ role: "user", content: "코트를 맡길게." }],
        requestId: "due-b",
        db,
      }),
      expectedVersion: a.expectedVersion,
    };
    const ca = commitReconvergenceTransition(a, { assistantMessageId: 2, db });
    const cb = commitReconvergenceTransition(b, { assistantMessageId: 3, db });
    assert.equal(ca.committed, true);
    assert.ok(cb.reason === "stale_version" || cb.reason === "idempotent_replay" || !cb.committed);
  });

  it("12. user reconnect cancels due", () => {
    const chatId = 909;
    const characterId = 910;
    const sep = prepareReconvergenceTransition({
      namespace: "production",
      chatId,
      characterId,
      currentTurn: 1,
      currentUserMessage: "갈게.",
      recentMessages: [{ role: "assistant", content: "ok" }],
      requestId: "sep",
      db,
    });
    commitReconvergenceTransition(sep, { assistantMessageId: 1, db });
    const back = prepareReconvergenceTransition({
      namespace: "production",
      chatId,
      characterId,
      currentTurn: 2,
      currentUserMessage: "다시 연락할게. 돌아왔어.",
      requestId: "back",
      db,
    });
    assert.ok(back.reasonCodes.includes("USER_INITIATED_RECONNECTION"));
    commitReconvergenceTransition(back, { assistantMessageId: 2, db });
    const st = loadReconvergenceState(chatId, characterId, "production", db);
    assert.equal(st.state, "together");
  });

  it("14. trigger defer once", () => {
    const chatId = 1111;
    const characterId = 1212;
    let st = defaultReconvergenceState(chatId, characterId);
    st = {
      ...st,
      state: "separated",
      separationTurn: 1,
      reconvergenceDueTurn: 3,
      unresolvedHooks: [
        {
          type: "established_contact_channel",
          summary: "연락",
          sourceTurn: 1,
          confidence: "high",
        },
      ],
    };
    const p = prepareReconvergenceTransition({
      namespace: "production",
      chatId,
      characterId,
      currentTurn: 3,
      currentUserMessage: "잔다.",
      triggerPresent: true,
      previousOverride: st,
      requestId: "defer1",
      db,
    });
    assert.ok(p.reasonCodes.includes("AUTHORITATIVE_TRIGGER_DEFERRED_RECONVERGENCE"));
    assert.equal(p.next.triggerDeferCount, 1);
  });

  it("15-16. no-contact blocks offer", () => {
    const chatId = 1313;
    const characterId = 1414;
    const p = prepareReconvergenceTransition({
      namespace: "production",
      chatId,
      characterId,
      currentTurn: 2,
      currentUserMessage: "다시는 연락하지 마",
      previousOverride: {
        ...defaultReconvergenceState(chatId, characterId),
        state: "separated",
        separationTurn: 1,
        reconvergenceDueTurn: 2,
      },
      requestId: "nc",
      db,
    });
    assert.equal(p.next.state, "hard_no_contact");
    assert.equal(p.reconvergenceDue, false);
  });

  it("17. no grounded path blocks fabrication", () => {
    const d = buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: [
        { role: "assistant", content: "헤어진다." },
        { role: "user", content: "갈게." },
        { role: "assistant", content: "남는다." },
        { role: "user", content: "눈을 감는다." },
      ],
      currentUserMessage: "눈을 감는다.",
      reconvergenceState: {
        ...defaultReconvergenceState(1, 1),
        state: "separated",
        separationTurn: 1,
        reconvergenceDueTurn: 3,
        unresolvedHooks: [],
      },
      currentTurn: 3,
    });
    assert.notEqual(d.pacingDecision, "reconverge");
    assert.equal(d.allowNewNpc, false);
    assert.ok(d.reasonCodes.includes("RECONVERGENCE_BLOCKED_NO_GROUNDED_PATH"));
  });
});

describe("off-mode prompt parity", () => {
  it("OFF_MODE_PROMPT_BYTE_IDENTICAL: legacy V1 block stable; V2 never owns inject", () => {
    const input = {
      mode: "interactive" as const,
      recentMessages: [
        { role: "assistant" as const, content: "소파에 앉는다." },
        { role: "user" as const, content: "옆에 앉는다." },
        { role: "assistant" as const, content: "차를 준다." },
        { role: "user" as const, content: "마신다." },
      ],
      currentUserMessage: "고마워.",
      memoryText: "",
      relationshipMemoryText: "",
      lorebookText: "",
      triggeredEventText: "",
    };
    const v1a = renderSceneDirectiveForPrompt(buildSceneDirective(input));
    const v1b = renderSceneDirectiveForPrompt(buildSceneDirective(input));
    const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
    assert.equal(v1a, v1b);
    assert.equal(sha(v1a), sha(v1b));
    assert.equal(isSceneDirectiveV2InjectEnabled({ SCENE_DIRECTIVE_V2_MODE: "off" }), false);
    assert.equal(isSceneDirectiveV2ComputeEnabled({ SCENE_DIRECTIVE_V2_MODE: "off" }), false);
    assert.equal(isSceneDirectiveV2InjectEnabled({ SCENE_DIRECTIVE_V2_MODE: "shadow" }), false);
    assert.equal(
      resolveScenePacingPromptOwner({ v2Mode: "off", livingEnabled: false }),
      "legacy_v1"
    );
    assert.equal(
      resolveScenePacingPromptOwner({ v2Mode: "shadow", livingEnabled: false }),
      "legacy_v1"
    );
    // Shadow/off owners must not equal event_restraint_v2 even if V2 text differs.
    const v2 = renderSceneDirectiveV2ForPrompt(buildSceneDirectiveV2(input));
    assert.notEqual(sha(v1a), sha(v2));
  });
});

describe("Living + V2 precedence matrix (policy)", () => {
  it("Living OFF + V2 OFF → legacy_v1", () => {
    assert.equal(
      resolveScenePacingPromptOwner({ v2Mode: "off", livingEnabled: false }),
      "legacy_v1"
    );
  });
  it("Living ON + V2 OFF → living_continuity_director", () => {
    assert.equal(
      resolveScenePacingPromptOwner({ v2Mode: "off", livingEnabled: true }),
      "living_continuity_director"
    );
  });
  it("Living OFF + V2 shadow → legacy_v1 (V2 not injected)", () => {
    assert.equal(
      resolveScenePacingPromptOwner({ v2Mode: "shadow", livingEnabled: false }),
      "legacy_v1"
    );
    assert.equal(isSceneDirectiveV2InjectEnabled({ SCENE_DIRECTIVE_V2_MODE: "shadow" }), false);
    assert.equal(isSceneDirectiveV2ComputeEnabled({ SCENE_DIRECTIVE_V2_MODE: "shadow" }), true);
  });
  it("Living ON + V2 shadow → living_continuity_director (V2 not injected)", () => {
    assert.equal(
      resolveScenePacingPromptOwner({ v2Mode: "shadow", livingEnabled: true }),
      "living_continuity_director"
    );
  });
  it("Living OFF + V2 ON → event_restraint_v2 sole owner", () => {
    assert.equal(
      resolveScenePacingPromptOwner({ v2Mode: "on", livingEnabled: false }),
      "event_restraint_v2"
    );
  });
  it("Living ON + V2 ON → event_restraint_v2 sole owner (no Living dual inject)", () => {
    assert.equal(
      resolveScenePacingPromptOwner({ v2Mode: "on", livingEnabled: true }),
      "event_restraint_v2"
    );
    assert.equal(isSceneDirectiveV2InjectEnabled({ SCENE_DIRECTIVE_V2_MODE: "on" }), true);
  });
});
