import Module from "module";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { classifySceneMode } from "./adultSceneRouting";
import { getActiveChatScene, listChatScenes } from "./chatScenes";
import { bootstrapChatObservers } from "./observerBootstrap";
import { ensureObserverSchema } from "./observerSchema";
import { mainCharacterObserverId } from "./observerTypes";
import { getScenePresence } from "./scenePresence";
import {
  buildAuthoritativeParticipantId,
  buildDynamicParticipantId,
  extractCurrentTurnSceneParticipantEvents,
} from "./secondarySceneParticipantEvidence";
import {
  buildProspectiveSecondarySceneSafetySnapshot,
  evaluateCurrentTurnSecondarySceneSafetyShadow,
  markSecondarySafetyCoverageIncomplete,
  persistAssistantTurnSecondarySceneSafety,
  readSecondarySceneSafetySnapshot,
  resolveCanonicalUserPlayableTurn,
  resolveSafetySceneBoundary,
  retractSecondarySafetyEventsForSourceMessages,
  SECONDARY_SAFETY_BRANCH_NONCANON_AUDIT,
  SECONDARY_SAFETY_CANONICAL_RECONCILIATION,
  SECONDARY_SAFETY_FUTURE_EXECUTION_ORDER,
  SECONDARY_SAFETY_FUTURE_FAILURE_POLICY,
  SECONDARY_SAFETY_USER_EDIT_BOUNDARY_POLICY,
} from "./secondarySceneParticipantSafety";
import { ensureSecondarySceneParticipantSafetySchema } from "./secondarySceneParticipantSafetySchema";
import {
  getSecondaryParticipantSafety,
  getSecondarySafetyCoverage,
  listPresentSecondaryParticipants,
  listSecondarySafetyEventsForParticipant,
} from "./secondarySceneParticipantSafetyStore";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

const ENV_KEYS = [
  "PERSONA_SECRET_DISCOVERY_ENABLED",
  "PERSONA_SECRET_BOUNDARY_ENABLED",
] as const;

function saveEnv(): Record<string, string | undefined> {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}
function restoreEnv(s: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    if (s[k] === undefined) delete process.env[k];
    else process.env[k] = s[k];
  }
}

function memDb(): Database.Database {
  const db = new Database(":memory:");
  ensureObserverSchema(db);
  ensureSecondarySceneParticipantSafetySchema(db);
  return db;
}

let chatSeq = 910000;

function nextChatId(): number {
  chatSeq += 1;
  return chatSeq;
}

describe("S1 secondary-scene participant safety shadow", () => {
  let env: Record<string, string | undefined>;
  beforeEach(() => {
    env = saveEnv();
  });
  afterEach(() => restoreEnv(env));

  it("1. adult-only scene → empty secondary snapshot / safe", () => {
    const db = memDb();
    const chatId = nextChatId();
    const snap = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "문을 닫고 서로를 바라봤다.",
      sceneReset: false,
      currentTurn: 1,
      db,
    });
    assert.equal(snap.presentSecondaryParticipants.length, 0);
    assert.equal(snap.wouldBlockAdultScene, false);
    assert.equal(snap.reason, null);
  });

  it("2/26. unrelated child world text is never read", () => {
    const db = memDb();
    const chatId = nextChatId();
    const world = "세계관: 12세 초등학생이 마을에 산다.";
    const snap = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "오늘은 둘만 있는 방이다.",
      sceneReset: false,
      currentTurn: 1,
      db,
    });
    assert.doesNotMatch(world, /들어왔/);
    assert.equal(snap.presentSecondaryParticipants.length, 0);
    assert.equal(
      extractCurrentTurnSceneParticipantEvents(world).length,
      0
    );
  });

  it("3. historical 17 mention creates no entry", () => {
    const db = memDb();
    const snap = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId: nextChatId(),
      userMessage: "17살 때 만났던 친구 이야기를 했다.",
      sceneReset: false,
      currentTurn: 1,
      db,
    });
    assert.equal(snap.presentSecondaryParticipants.length, 0);
  });

  it("4. off-scene child creates no entry", () => {
    const db = memDb();
    const snap = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId: nextChatId(),
      userMessage: "아들은 학교에 있어. 동생은 집에 있다.",
      sceneReset: false,
      currentTurn: 1,
      db,
    });
    assert.equal(snap.presentSecondaryParticipants.length, 0);
  });

  it("5. user minor ENTER → present/minor", () => {
    const db = memDb();
    const snap = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId: nextChatId(),
      userMessage: "17살 동생이 문을 열고 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      db,
    });
    assert.equal(snap.presentSecondaryParticipants.length, 1);
    assert.equal(snap.presentSecondaryParticipants[0].adultStatus, "minor");
    assert.equal(snap.presentSecondaryParticipants[0].presenceState, "PRESENT");
    assert.equal(snap.minorParticipantIds.length, 1);
    assert.equal(snap.wouldBlockAdultScene, true);
  });

  it("6. user adult-age claim ENTER → present/unknown, not confirmed", () => {
    const db = memDb();
    const snap = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId: nextChatId(),
      userMessage: "22살 민수가 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      db,
    });
    assert.equal(snap.presentSecondaryParticipants.length, 1);
    assert.equal(snap.presentSecondaryParticipants[0].adultStatus, "unknown");
    assert.equal(snap.confirmedParticipantIds.length, 0);
    assert.equal(snap.unknownParticipantIds.length, 1);
  });

  it("7. user unknown adult ENTER → present/unknown", () => {
    const db = memDb();
    const snap = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId: nextChatId(),
      userMessage: "민수가 방으로 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      db,
    });
    assert.equal(snap.presentSecondaryParticipants[0].adultStatus, "unknown");
    assert.equal(snap.presentSecondaryParticipants[0].displayName, "민수");
  });

  it("8. real-person ENTER → present/real_person", () => {
    const db = memDb();
    const snap = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId: nextChatId(),
      userMessage: "실존 인물인 민수가 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      db,
    });
    assert.equal(snap.presentSecondaryParticipants[0].adultStatus, "real_person");
    assert.equal(snap.realPersonParticipantIds.length, 1);
  });

  it("9. authoritative adult metadata → confirmed", () => {
    const db = memDb();
    const snap = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId: nextChatId(),
      userMessage: "",
      sceneReset: false,
      currentTurn: 1,
      authoritativeActors: [
        {
          stableId: "npc-adult-1",
          displayName: "민수",
          kind: "creator_npc",
          metadata: { age: 22, adultStatus: "confirmed" },
        },
      ],
      db,
    });
    assert.equal(snap.presentSecondaryParticipants.length, 1);
    assert.equal(snap.presentSecondaryParticipants[0].adultStatus, "confirmed");
    assert.match(snap.presentSecondaryParticipants[0].participantId, /^auth:/);
    assert.equal(snap.wouldBlockAdultScene, false);
  });

  it("10. authoritative minor → minor", () => {
    const db = memDb();
    const snap = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId: nextChatId(),
      userMessage: "",
      sceneReset: false,
      currentTurn: 1,
      authoritativeActors: [
        {
          stableId: "npc-minor-1",
          displayName: "동생",
          kind: "server_npc",
          metadata: { age: 16 },
        },
      ],
      db,
    });
    assert.equal(snap.presentSecondaryParticipants[0].adultStatus, "minor");
  });

  it("11/12. restrictive spoof ignored and minor accepted on same spine", () => {
    const db = memDb();
    const adultClaim = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId: nextChatId(),
      userMessage: "성인 직장인 민수가 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      db,
    });
    assert.equal(adultClaim.presentSecondaryParticipants[0].adultStatus, "unknown");
    const minor = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId: nextChatId(),
      userMessage: "17살 동생이 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      db,
    });
    assert.equal(minor.presentSecondaryParticipants[0].adultStatus, "minor");
  });

  it("15/17. LEAVE removes current presence including a prior minor", () => {
    const db = memDb();
    const chatId = nextChatId();
    evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "17살 동생이 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      db,
    });
    const afterLeave = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "동생은 방을 나갔다. 이제 둘만 남았다.",
      sceneReset: false,
      currentTurn: 2,
      db,
    });
    assert.equal(afterLeave.presentSecondaryParticipants.length, 0);
    assert.equal(afterLeave.minorParticipantIds.length, 0);
  });

  it("16. ENTER then LEAVE in the same turn leaves the actor absent", () => {
    const db = memDb();
    const snap = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId: nextChatId(),
      userMessage: "민수가 들어왔다. 민수는 방을 나갔다.",
      sceneReset: false,
      currentTurn: 1,
      db,
    });
    assert.equal(snap.presentSecondaryParticipants.length, 0);
  });

  it("18/19. scene reset closes the old scene and does not inherit participants", () => {
    const db = memDb();
    const chatId = nextChatId();
    evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "17살 동생이 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      db,
    });
    const sceneA = getActiveChatScene(chatId, db);
    assert.ok(sceneA);
    assert.equal(listPresentSecondaryParticipants(sceneA!.id, db).length, 1);

    const afterReset = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "이제 둘만 있는 새 장면이다.",
      sceneReset: true,
      currentTurn: 2,
      db,
    });
    const sceneB = getActiveChatScene(chatId, db);
    assert.ok(sceneB);
    assert.notEqual(sceneB!.id, sceneA!.id);
    assert.equal(getActiveChatScene(chatId, db)?.status, "ACTIVE");
    const scenes = listChatScenes(chatId, db);
    assert.equal(scenes.filter((s) => s.status === "CLOSED").length, 1);
    assert.equal(afterReset.presentSecondaryParticipants.length, 0);
    assert.equal(listPresentSecondaryParticipants(sceneB!.id, db).length, 0);
    assert.equal(listPresentSecondaryParticipants(sceneA!.id, db).length, 1);
  });

  it("20. assistant minor introduction persists for the next turn", () => {
    const db = memDb();
    const chatId = nextChatId();
    evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "문을 열었다.",
      sceneReset: false,
      currentTurn: 1,
      db,
    });
    persistAssistantTurnSecondarySceneSafety({
      chatId,
      assistantText: "17살 동생이 문을 열고 들어왔다.",
      currentTurn: 1,
      db,
    });
    const nextTurn = readSecondarySceneSafetySnapshot({ chatId, db });
    assert.equal(nextTurn.presentSecondaryParticipants.length, 1);
    assert.equal(nextTurn.presentSecondaryParticipants[0].adultStatus, "minor");
    assert.equal(
      nextTurn.presentSecondaryParticipants[0].evidenceSource,
      "ASSISTANT_PROSE"
    );
  });

  it("21. assistant off-scene mention is ignored", () => {
    const db = memDb();
    const chatId = nextChatId();
    evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "창밖을 봤다.",
      sceneReset: false,
      currentTurn: 1,
      db,
    });
    persistAssistantTurnSecondarySceneSafety({
      chatId,
      assistantText: "아들은 학교에 있어. 사진 속 아이가 웃고 있다.",
      currentTurn: 1,
      db,
    });
    const snap = readSecondarySceneSafetySnapshot({ chatId, db });
    assert.equal(snap.presentSecondaryParticipants.length, 0);
  });

  it("22. Discovery flag OFF → safety spine still operates", () => {
    process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "0";
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "0";
    const db = memDb();
    const snap = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId: nextChatId(),
      userMessage: "17살 동생이 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      db,
    });
    assert.equal(snap.presentSecondaryParticipants[0].adultStatus, "minor");
  });

  it("23. no public age/adultStatus field becomes authoritative", () => {
    const db = memDb();
    const snap = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId: nextChatId(),
      userMessage: "민수가 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      publicParticipantClaims: [
        {
          participantId: "auth:creator_npc:forged",
          age: 22,
          adultStatus: "confirmed",
          isRealPerson: false,
        },
      ],
      db,
    });
    assert.equal(snap.presentSecondaryParticipants[0].adultStatus, "unknown");
    assert.match(
      snap.presentSecondaryParticipants[0].participantId,
      /^dyn:/
    );
    assert.doesNotMatch(
      snap.presentSecondaryParticipants[0].participantId,
      /^auth:/
    );
  });

  it("24. duplicate actor mention is idempotent", () => {
    const db = memDb();
    const chatId = nextChatId();
    evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "민수가 들어왔다. 민수도 여기 함께 있다.",
      sceneReset: false,
      currentTurn: 1,
      db,
    });
    const scene = getActiveChatScene(chatId, db)!;
    assert.equal(listPresentSecondaryParticipants(scene.id, db).length, 1);
  });

  it("25. two different same-name actors collapse conservatively", () => {
    const db = memDb();
    const snap = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId: nextChatId(),
      userMessage: "민수가 들어왔다. 다른 민수도 방에 합류했다.",
      sceneReset: false,
      currentTurn: 1,
      db,
    });
    assert.equal(snap.presentSecondaryParticipants.length, 1);
    assert.equal(snap.presentSecondaryParticipants[0].displayName, "민수");
  });

  it("27. extractor and shadow path make no provider calls", () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("provider must not be called");
    }) as typeof fetch;
    try {
      const db = memDb();
      evaluateCurrentTurnSecondarySceneSafetyShadow({
        chatId: nextChatId(),
        userMessage: "17살 동생이 들어왔다.",
        sceneReset: false,
        currentTurn: 1,
        db,
      });
      persistAssistantTurnSecondarySceneSafety({
        chatId: nextChatId(),
        assistantText: "민수가 방으로 들어왔다.",
        currentTurn: 1,
        db,
      });
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("authoritative actor with no adult metadata stays UNKNOWN", () => {
    const db = memDb();
    const snap = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId: nextChatId(),
      userMessage: "",
      sceneReset: false,
      currentTurn: 1,
      authoritativeActors: [
        {
          stableId: "npc-no-meta",
          displayName: "한별",
          kind: "creator_npc",
        },
      ],
      db,
    });
    assert.equal(snap.presentSecondaryParticipants[0].adultStatus, "unknown");
  });
});

describe("S1.1 secondary-scene safety pre-enforcement hardening", () => {
  let env: Record<string, string | undefined>;
  beforeEach(() => {
    env = saveEnv();
  });
  afterEach(() => restoreEnv(env));

  it("H1 multi-actor same clause: 17살 민수 ENTER + 철수 unknown", () => {
    const snap = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId: nextChatId(),
      userMessage: "17살 민수와 철수가 방으로 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      db: memDb(),
    });
    const byName = Object.fromEntries(
      snap.presentSecondaryParticipants.map((p) => [p.displayName, p])
    );
    assert.equal(snap.presentSecondaryParticipants.length, 2);
    assert.equal(byName["민수"].adultStatus, "minor");
    assert.equal(byName["민수"].restrictiveAge, 17);
    assert.equal(byName["철수"].adultStatus, "unknown");
    assert.equal(byName["철수"].restrictiveAge, null);
  });

  it("H1 B. 22 raw on 철수 is stripped; 민수 stays minor", () => {
    const snap = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId: nextChatId(),
      userMessage: "17살 민수와 22살 철수가 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      db: memDb(),
    });
    const byName = Object.fromEntries(
      snap.presentSecondaryParticipants.map((p) => [p.displayName, p])
    );
    assert.equal(byName["민수"].adultStatus, "minor");
    assert.equal(byName["철수"].adultStatus, "unknown");
    assert.equal(byName["철수"].age, null);
  });

  it("H1 C/D multi-action order and ENTER then LEAVE", () => {
    const db = memDb();
    const chatId = nextChatId();
    const bothEnter = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "민수가 들어오고 17살 동생도 따라 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      db,
    });
    assert.equal(bothEnter.presentSecondaryParticipants.length, 2);
    assert.ok(bothEnter.minorParticipantIds.length === 1);
    const afterLeave = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "민수가 들어왔다. 철수가 나갔다.",
      sceneReset: false,
      currentTurn: 2,
      db,
    });
    const names = afterLeave.presentSecondaryParticipants.map((p) => p.displayName);
    assert.ok(names.includes("민수"));
    assert.ok(names.includes("동생"));
    assert.ok(!names.includes("철수"));
  });

  it("H1 minor first/middle/last never disappears from a shared clause", () => {
    for (const text of [
      "17살 민수와 철수와 영희가 들어왔다.",
      "철수와 17살 민수와 영희가 들어왔다.",
      "철수와 영희와 17살 민수가 들어왔다.",
    ]) {
      const snap = evaluateCurrentTurnSecondarySceneSafetyShadow({
        chatId: nextChatId(),
        userMessage: text,
        sceneReset: false,
        currentTurn: 1,
        db: memDb(),
      });
      assert.equal(snap.presentSecondaryParticipants.length, 3, text);
      const minsu = snap.presentSecondaryParticipants.find((p) => p.displayName === "민수");
      assert.equal(minsu?.adultStatus, "minor", text);
      assert.equal(snap.minorParticipantIds.length, 1, text);
    }
  });

  it("H2 clearSceneTransition closes the previous scene; ordinary movement does not", () => {
    const db = memDb();
    const chatId = nextChatId();
    evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "17살 동생이 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      db,
    });
    const sceneA = getActiveChatScene(chatId, db)!;

    const ordinary = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "민수가 방으로 들어왔다.",
      sceneReset: false,
      clearSceneTransition: false,
      currentTurn: 2,
      db,
    });
    assert.equal(getActiveChatScene(chatId, db)?.id, sceneA.id);
    assert.equal(ordinary.minorParticipantIds.length, 1);
    assert.ok(
      ordinary.presentSecondaryParticipants.some((p) => p.displayName === "민수")
    );

    const ooc = classifySceneMode({
      currentInput:
        "OOC: 기존 RP 종료. 새로운 에피소드 시작.\n둘이 카페에서 우연히 다시 만나는 장면을 출력.",
    });
    assert.equal(ooc.sceneReset, true);
    const afterOoc = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: ooc.reason ? "이제 카페에 둘만 있다." : "",
      sceneReset: ooc.sceneReset,
      clearSceneTransition: ooc.clearSceneTransition,
      currentTurn: 3,
      db,
    });
    const sceneB = getActiveChatScene(chatId, db)!;
    assert.notEqual(sceneB.id, sceneA.id);
    assert.equal(sceneB.status, "ACTIVE");
    assert.equal(afterOoc.presentSecondaryParticipants.length, 0);
    assert.ok(
      listPresentSecondaryParticipants(sceneA.id, db).some(
        (row) => row.adult_status === "minor"
      )
    );

    const chatId2 = nextChatId();
    evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId: chatId2,
      userMessage: "17살 동생이 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      db,
    });
    const sceneC = getActiveChatScene(chatId2, db)!;
    const timePlace = classifySceneMode({
      currentInput: "다음 날 장소를 옮겨 식당에 앉았다.",
    });
    assert.equal(timePlace.sceneReset, false);
    assert.equal(timePlace.clearSceneTransition, true);
    const afterJump = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId: chatId2,
      userMessage: "다음 날 장소를 옮겨 식당에 앉았다.",
      sceneReset: timePlace.sceneReset,
      clearSceneTransition: timePlace.clearSceneTransition,
      currentTurn: 2,
      db,
    });
    const sceneD = getActiveChatScene(chatId2, db)!;
    assert.notEqual(sceneD.id, sceneC.id);
    assert.equal(afterJump.presentSecondaryParticipants.length, 0);
    const boundary = resolveSafetySceneBoundary({
      chatId: chatId2,
      sceneReset: false,
      clearSceneTransition: true,
      currentTurn: 3,
      db,
    });
    assert.equal(boundary.closedPrevious, true);
    assert.notEqual(boundary.scene.id, sceneD.id);
  });

  it("H3/H4 dual provenance + reseed keeps restrictive 17 and authoritative 22", () => {
    const db = memDb();
    const chatId = nextChatId();
    const actor = {
      stableId: "npc-minsu",
      displayName: "민수",
      kind: "creator_npc" as const,
      metadata: { age: 22, adultStatus: "confirmed" as const },
    };
    const turnN = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "17살 민수가 들어왔다.",
      sceneReset: false,
      currentTurn: 4,
      sourceMessageId: 401,
      authoritativeActors: [actor],
      db,
    });
    const authId = buildAuthoritativeParticipantId("creator_npc", "npc-minsu");
    const rowN = turnN.presentSecondaryParticipants.find(
      (p) => p.participantId === authId
    );
    assert.ok(rowN);
    assert.equal(rowN!.authoritativeAge, 22);
    assert.equal(rowN!.authoritativeAdultStatus, "confirmed");
    assert.equal(rowN!.restrictiveAge, 17);
    assert.equal(rowN!.restrictiveAdultStatus, "minor");
    assert.equal(rowN!.adultStatus, "conflict");
    assert.equal(rowN!.evidenceTrust, "AUTHORITATIVE");

    const turnN1 = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "창밖을 봤다.",
      sceneReset: false,
      currentTurn: 5,
      sourceMessageId: 402,
      authoritativeActors: [actor],
      db,
    });
    const rowN1 = turnN1.presentSecondaryParticipants.find(
      (p) => p.participantId === authId
    );
    assert.ok(rowN1);
    assert.equal(rowN1!.authoritativeAge, 22);
    assert.equal(rowN1!.authoritativeAdultStatus, "confirmed");
    assert.equal(rowN1!.restrictiveAge, 17);
    assert.equal(rowN1!.restrictiveAdultStatus, "minor");
    assert.equal(rowN1!.adultStatus, "conflict");
    const scene = getActiveChatScene(chatId, db)!;
    const stored = getSecondaryParticipantSafety(scene.id, authId, db)!;
    assert.equal(stored.authoritative_age, 22);
    assert.equal(stored.restrictive_age, 17);
    assert.notEqual(stored.authoritative_age, stored.restrictive_age);
  });

  it("H5 assistant regen retracts only the superseded assistant source", () => {
    const db = memDb();
    const chatId = nextChatId();
    evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "문을 열었다. 17살 민수도 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      sourceMessageId: 11,
      db,
    });
    persistAssistantTurnSecondarySceneSafety({
      chatId,
      assistantText: "17살 동생이 들어왔다.",
      currentTurn: 1,
      sourceMessageId: 22,
      db,
    });
    let snap = readSecondarySceneSafetySnapshot({ chatId, db });
    assert.ok(snap.presentSecondaryParticipants.some((p) => p.displayName === "동생"));
    assert.ok(snap.presentSecondaryParticipants.some((p) => p.displayName === "민수"));

    persistAssistantTurnSecondarySceneSafety({
      chatId,
      assistantText: "둘만 남아 있었다.",
      currentTurn: 1,
      sourceMessageId: 22,
      db,
    });
    snap = readSecondarySceneSafetySnapshot({ chatId, db });
    assert.ok(!snap.presentSecondaryParticipants.some((p) => p.displayName === "동생"));
    const minsu = snap.presentSecondaryParticipants.find((p) => p.displayName === "민수");
    assert.ok(minsu);
    assert.equal(minsu!.adultStatus, "minor");
    const scene = getActiveChatScene(chatId, db)!;
    const siblingId = buildDynamicParticipantId("동생");
    assert.equal(
      listSecondarySafetyEventsForParticipant(scene.id, siblingId, db).length,
      0
    );
  });

  it("H6 last-turn delete retracts user+assistant owned events", () => {
    const db = memDb();
    const chatId = nextChatId();
    evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "17살 동생이 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      sourceMessageId: 501,
      db,
    });
    persistAssistantTurnSecondarySceneSafety({
      chatId,
      assistantText: "철수가 들어왔다.",
      currentTurn: 1,
      sourceMessageId: 502,
      db,
    });
    assert.equal(
      readSecondarySceneSafetySnapshot({ chatId, db }).presentSecondaryParticipants
        .length,
      2
    );
    const { deleted } = retractSecondarySafetyEventsForSourceMessages({
      chatId,
      sourceMessageIds: [501, 502],
      db,
    });
    assert.ok(deleted >= 2);
    const snap = readSecondarySceneSafetySnapshot({ chatId, db });
    assert.equal(snap.presentSecondaryParticipants.length, 0);
    assert.equal(SECONDARY_SAFETY_CANONICAL_RECONCILIATION.regen, "SUPPORTED");
    assert.equal(SECONDARY_SAFETY_CANONICAL_RECONCILIATION.delete, "SUPPORTED");
    assert.equal(
      SECONDARY_SAFETY_CANONICAL_RECONCILIATION["branch/noncanon"],
      "NOT_APPLICABLE_TO_SECONDARY_SAFETY"
    );
    assert.equal(
      SECONDARY_SAFETY_CANONICAL_RECONCILIATION.fork,
      "COVERAGE_INCOMPLETE"
    );
  });

  it("H7 Discovery ON scene reset restores main presence and drops secondary inheritance", () => {
    process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "1";
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    const db = memDb();
    const chatId = nextChatId();
    const characterId = 17;
    const bootA = bootstrapChatObservers({
      chatId,
      characterId,
      displayName: "로코",
      turnNumber: 1,
      db,
    });
    assert.ok(bootA.sceneId);
    evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "17살 동생이 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      db,
    });
    const sceneA = getActiveChatScene(chatId, db)!;
    assert.equal(sceneA.id, bootA.sceneId);
    assert.equal(
      getScenePresence({
        sceneId: sceneA.id,
        observerType: "CHARACTER",
        observerId: mainCharacterObserverId(characterId),
        db,
      })?.presence_state,
      "PRESENT"
    );
    assert.equal(listPresentSecondaryParticipants(sceneA.id, db).length, 1);

    evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "이제 둘만 있는 새 장면이다.",
      sceneReset: true,
      currentTurn: 2,
      db,
    });
    const sceneB = getActiveChatScene(chatId, db)!;
    assert.notEqual(sceneB.id, sceneA.id);
    assert.equal(sceneB.status, "ACTIVE");
    assert.equal(
      listChatScenes(chatId, db).find((s) => s.id === sceneA.id)?.status,
      "CLOSED"
    );
    const bootB = bootstrapChatObservers({
      chatId,
      characterId,
      displayName: "로코",
      turnNumber: 2,
      db,
    });
    assert.equal(bootB.sceneId, sceneB.id);
    assert.equal(
      getScenePresence({
        sceneId: sceneB.id,
        observerType: "CHARACTER",
        observerId: mainCharacterObserverId(characterId),
        db,
      })?.presence_state,
      "PRESENT"
    );
    assert.equal(listPresentSecondaryParticipants(sceneB.id, db).length, 0);
    assert.equal(listPresentSecondaryParticipants(sceneA.id, db).length, 1);
  });

  it("H7 Discovery OFF still owns the safety scene lifecycle", () => {
    process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "0";
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "0";
    const db = memDb();
    const chatId = nextChatId();
    const boot = bootstrapChatObservers({
      chatId,
      characterId: 17,
      displayName: "로코",
      turnNumber: 1,
      db,
    });
    assert.equal(boot.sceneId, "");
    evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "17살 동생이 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      db,
    });
    const sceneA = getActiveChatScene(chatId, db)!;
    assert.ok(sceneA);
    evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "다음 날이다.",
      sceneReset: true,
      currentTurn: 2,
      db,
    });
    const sceneB = getActiveChatScene(chatId, db)!;
    assert.notEqual(sceneB.id, sceneA.id);
    assert.equal(readSecondarySceneSafetySnapshot({ chatId, db }).presentSecondaryParticipants.length, 0);
  });

  it("H8 same-name dynamic actors merge conservatively and never confirm adulthood", () => {
    const snap = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId: nextChatId(),
      userMessage: "민수가 들어왔다. 17살 민수도 방에 합류했다.",
      sceneReset: false,
      currentTurn: 1,
      db: memDb(),
    });
    assert.equal(snap.presentSecondaryParticipants.length, 1);
    assert.equal(snap.presentSecondaryParticipants[0].participantId, buildDynamicParticipantId("민수"));
    assert.equal(snap.presentSecondaryParticipants[0].adultStatus, "minor");
    assert.equal(snap.confirmedParticipantIds.length, 0);

    const db = memDb();
    const distinct = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId: nextChatId(),
      userMessage: "",
      sceneReset: false,
      currentTurn: 1,
      authoritativeActors: [
        {
          stableId: "npc-a",
          displayName: "민수",
          kind: "creator_npc",
          metadata: { age: 22, adultStatus: "confirmed" },
        },
        {
          stableId: "npc-b",
          displayName: "민수",
          kind: "creator_npc",
          metadata: { age: 24, adultStatus: "confirmed" },
        },
      ],
      db,
    });
    assert.equal(distinct.presentSecondaryParticipants.length, 2);
    assert.ok(
      distinct.presentSecondaryParticipants.every((p) => p.participantId.startsWith("auth:"))
    );
  });

  it("H9 shadow path still makes no provider calls", () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("provider must not be called");
    }) as typeof fetch;
    try {
      const db = memDb();
      evaluateCurrentTurnSecondarySceneSafetyShadow({
        chatId: nextChatId(),
        userMessage: "17살 민수와 철수가 들어왔다.",
        sceneReset: false,
        clearSceneTransition: true,
        currentTurn: 1,
        sourceMessageId: 1,
        db,
      });
      persistAssistantTurnSecondarySceneSafety({
        chatId: nextChatId(),
        assistantText: "17살 동생이 들어왔다.",
        currentTurn: 1,
        sourceMessageId: 2,
        db,
      });
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("S1.2 deterministic / atomic / preflight / coverage hardening", () => {
  it("P1 same-second ENTER→LEAVE is always ABSENT with event_index order", () => {
    for (let run = 0; run < 30; run += 1) {
      const db = memDb();
      const chatId = nextChatId();
      evaluateCurrentTurnSecondarySceneSafetyShadow({
        chatId,
        userMessage: "민수가 들어왔다. 민수가 나갔다.",
        sceneReset: false,
        currentTurn: 1,
        sourceMessageId: 100,
        db,
      });
      const scene = getActiveChatScene(chatId, db)!;
      const participantId = buildDynamicParticipantId("민수");
      const row = getSecondaryParticipantSafety(scene.id, participantId, db)!;
      assert.equal(row.presence_state, "ABSENT");
      const events = listSecondarySafetyEventsForParticipant(
        scene.id,
        participantId,
        db
      );
      assert.deepEqual(
        events.map((event) => [event.action, event.event_index]),
        [
          ["ENTER", 0],
          ["LEAVE", 1],
        ]
      );
      assert.equal(events[0].created_at, events[1].created_at);
    }
  });

  it("P1 same-second LEAVE→ENTER is always PRESENT", () => {
    for (let run = 0; run < 30; run += 1) {
      const db = memDb();
      const chatId = nextChatId();
      const snap = evaluateCurrentTurnSecondarySceneSafetyShadow({
        chatId,
        userMessage: "민수가 나갔다. 민수가 들어왔다.",
        sceneReset: false,
        currentTurn: 1,
        sourceMessageId: 100,
        db,
      });
      assert.equal(snap.presentSecondaryParticipants.length, 1);
      assert.equal(
        snap.presentSecondaryParticipants[0].presenceState,
        "PRESENT"
      );
    }
  });

  it("P1 user events sort before assistant events in one playable turn", () => {
    const db = memDb();
    const chatId = nextChatId();
    evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "민수가 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      sourceMessageId: 900,
      db,
    });
    persistAssistantTurnSecondarySceneSafety({
      chatId,
      assistantText: "민수가 나갔다.",
      currentTurn: 1,
      sourceMessageId: 100,
      db,
    });
    assert.equal(
      readSecondarySceneSafetySnapshot({ chatId, db })
        .presentSecondaryParticipants.length,
      0
    );
    const scene = getActiveChatScene(chatId, db)!;
    const events = listSecondarySafetyEventsForParticipant(
      scene.id,
      buildDynamicParticipantId("민수"),
      db
    );
    assert.deepEqual(
      events.map((event) => event.source_role),
      ["user", "assistant"]
    );
  });

  it("P2 canonical user source turns are 1, 2 and edits preserve the turn", () => {
    const db = memDb();
    db.exec(`
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT ''
      );
    `);
    const chatId = nextChatId();
    const user1 = Number(
      db
        .prepare(
          `INSERT INTO messages (chat_id, role, content) VALUES (?, 'user', '첫 턴')`
        )
        .run(chatId).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, model)
       VALUES (?, 'assistant', '첫 답변', 'model')`
    ).run(chatId);
    const user2 = Number(
      db
        .prepare(
          `INSERT INTO messages (chat_id, role, content) VALUES (?, 'user', '둘째 턴')`
        )
        .run(chatId).lastInsertRowid
    );
    assert.equal(
      resolveCanonicalUserPlayableTurn({
        chatId,
        userMessageId: user1,
        db,
      }),
      1
    );
    assert.equal(
      resolveCanonicalUserPlayableTurn({
        chatId,
        userMessageId: user2,
        db,
      }),
      2
    );
    evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "17살 동생이 들어왔다.",
      sceneReset: false,
      currentTurn: 2,
      sourceMessageId: user2,
      db,
    });
    db.prepare("INSERT INTO messages (chat_id, role, content) VALUES (?, 'user', '후속')")
      .run(chatId);
    assert.equal(
      resolveCanonicalUserPlayableTurn({
        chatId,
        userMessageId: user2,
        db,
      }),
      2
    );
  });

  it("P3 event insert + projection rollback atomically", () => {
    const db = memDb();
    const chatId = nextChatId();
    assert.throws(
      () =>
        evaluateCurrentTurnSecondarySceneSafetyShadow({
          chatId,
          userMessage: "17살 동생이 들어왔다.",
          sceneReset: false,
          currentTurn: 1,
          sourceMessageId: 1,
          db,
          __testFailurePoint: "AFTER_EVENT_INSERT",
        }),
      /AFTER_EVENT_INSERT/
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM scene_secondary_participant_safety_events WHERE chat_id=?"
        )
        .get(chatId).count,
      0
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM scene_secondary_participant_safety WHERE chat_id=?"
        )
        .get(chatId).count,
      0
    );
  });

  it("P3 source retract + projection rollback atomically", () => {
    const db = memDb();
    const chatId = nextChatId();
    evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "17살 동생이 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      sourceMessageId: 11,
      db,
    });
    const before = readSecondarySceneSafetySnapshot({ chatId, db });
    assert.throws(
      () =>
        retractSecondarySafetyEventsForSourceMessages({
          chatId,
          sourceMessageIds: [11],
          db,
          __testFailurePoint: "AFTER_EVENT_DELETE",
        }),
      /AFTER_EVENT_DELETE/
    );
    assert.deepEqual(readSecondarySceneSafetySnapshot({ chatId, db }), before);
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM scene_secondary_participant_safety_events WHERE chat_id=?"
        )
        .get(chatId).count,
      1
    );
  });

  it("P3 multi-actor batch rolls back without half-applied state", () => {
    const db = memDb();
    const chatId = nextChatId();
    assert.throws(
      () =>
        evaluateCurrentTurnSecondarySceneSafetyShadow({
          chatId,
          userMessage: "17살 민수와 철수가 들어왔다.",
          sceneReset: false,
          currentTurn: 1,
          sourceMessageId: 12,
          db,
          __testFailurePoint: "MID_EVENT_BATCH",
        }),
      /MID_EVENT_BATCH/
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM scene_secondary_participant_safety_events WHERE chat_id=?"
        )
        .get(chatId).count,
      0
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM scene_secondary_participant_safety WHERE chat_id=?"
        )
        .get(chatId).count,
      0
    );
  });

  it("P3 public mutation uses no nested transaction inside outer owner", () => {
    const db = memDb();
    const chatId = nextChatId();
    db.transaction(() => {
      assert.equal(db.inTransaction, true);
      evaluateCurrentTurnSecondarySceneSafetyShadow({
        chatId,
        userMessage: "민수가 들어왔다.",
        sceneReset: false,
        currentTurn: 1,
        sourceMessageId: 13,
        db,
      });
      assert.equal(db.inTransaction, true);
    }).immediate();
    assert.equal(
      readSecondarySceneSafetySnapshot({ chatId, db })
        .presentSecondaryParticipants.length,
      1
    );
  });

  it("P4 prospective snapshot equals persisted snapshot for 20+ fixtures", () => {
    const fixtures = [
      "문을 닫았다.",
      "민수가 들어왔다.",
      "17살 동생이 들어왔다.",
      "22살 철수가 들어왔다.",
      "민수가 들어왔다. 민수가 나갔다.",
      "민수가 나갔다. 민수가 들어왔다.",
      "17살 민수와 철수가 들어왔다.",
      "철수와 17살 민수와 영희가 들어왔다.",
      "실존 인물인 민수가 들어왔다.",
      "동생도 여기 함께 있다.",
      "세 사람이 방에 합류했다.",
      "동생은 방을 나갔다.",
      "아들은 학교에 있어.",
      "사진 속 아이가 웃었다.",
      "전화 중인 동생 이야기다.",
      "17살 때 만났던 친구다.",
      "민수가 방으로 들어왔다.",
      "민수가 들어오고 17살 동생도 따라 들어왔다.",
      "민수가 들어왔다. 철수가 나갔다.",
      "17살 민수와 22살 철수가 들어왔다.",
      "고등학생 동생이 들어왔다.",
      "미성년자 민수가 들어왔다.",
      "민수가 여기 함께 있다.",
      "민수가 떠났다.",
    ];
    for (const [index, text] of fixtures.entries()) {
      const db = memDb();
      const chatId = nextChatId();
      evaluateCurrentTurnSecondarySceneSafetyShadow({
        chatId,
        userMessage: "철수가 들어왔다.",
        sceneReset: false,
        currentTurn: 1,
        sourceMessageId: 1,
        db,
      });
      const prospective = buildProspectiveSecondarySceneSafetySnapshot({
        chatId,
        currentTurn: 2,
        currentUserMessage: text,
        sceneReset: false,
        db,
      });
      const persisted = evaluateCurrentTurnSecondarySceneSafetyShadow({
        chatId,
        userMessage: text,
        sceneReset: false,
        currentTurn: 2,
        sourceMessageId: 1000 + index,
        db,
      });
      assert.deepEqual(prospective, persisted, text);
    }
  });

  it("P4 prospective authoritative/restrictive conflict matches persisted", () => {
    const db = memDb();
    const chatId = nextChatId();
    const authoritativeActors = [
      {
        stableId: "prospective-minsu",
        displayName: "민수",
        kind: "creator_npc" as const,
        metadata: { age: 22, adultStatus: "confirmed" as const },
      },
    ];
    const prospective = buildProspectiveSecondarySceneSafetySnapshot({
      chatId,
      currentTurn: 1,
      currentUserMessage: "17살 민수가 들어왔다.",
      sceneReset: false,
      authoritativeActors,
      db,
    });
    const persisted = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "17살 민수가 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      sourceMessageId: 100,
      authoritativeActors,
      db,
    });
    assert.deepEqual(prospective, persisted);
    assert.equal(
      prospective.presentSecondaryParticipants[0].adultStatus,
      "conflict"
    );
  });

  it("P4 prospective boundary semantics are pure and match persisted reset/transition", () => {
    for (const boundary of [
      { sceneReset: true, clearSceneTransition: false },
      { sceneReset: false, clearSceneTransition: true },
    ]) {
      const db = memDb();
      const chatId = nextChatId();
      evaluateCurrentTurnSecondarySceneSafetyShadow({
        chatId,
        userMessage: "17살 동생이 들어왔다.",
        sceneReset: false,
        currentTurn: 1,
        sourceMessageId: 1,
        db,
      });
      markSecondarySafetyCoverageIncomplete({
        chatId,
        reason: "test_incomplete",
        db,
      });
      const sceneBefore = getActiveChatScene(chatId, db)!;
      const countsBefore = {
        scenes: db
          .prepare("SELECT COUNT(*) AS count FROM chat_scenes WHERE chat_id=?")
          .get(chatId).count,
        events: db
          .prepare(
            "SELECT COUNT(*) AS count FROM scene_secondary_participant_safety_events WHERE chat_id=?"
          )
          .get(chatId).count,
        rows: db
          .prepare(
            "SELECT COUNT(*) AS count FROM scene_secondary_participant_safety WHERE chat_id=?"
          )
          .get(chatId).count,
      };
      const prospective = buildProspectiveSecondarySceneSafetySnapshot({
        chatId,
        currentTurn: 2,
        currentUserMessage: "민수가 들어왔다.",
        ...boundary,
        db,
      });
      assert.equal(getActiveChatScene(chatId, db)?.id, sceneBefore.id);
      assert.deepEqual(
        {
          scenes: db
            .prepare("SELECT COUNT(*) AS count FROM chat_scenes WHERE chat_id=?")
            .get(chatId).count,
          events: db
            .prepare(
              "SELECT COUNT(*) AS count FROM scene_secondary_participant_safety_events WHERE chat_id=?"
            )
            .get(chatId).count,
          rows: db
            .prepare(
              "SELECT COUNT(*) AS count FROM scene_secondary_participant_safety WHERE chat_id=?"
            )
            .get(chatId).count,
        },
        countsBefore
      );
      assert.equal(prospective.coverage, "COMPLETE");
      const persisted = evaluateCurrentTurnSecondarySceneSafetyShadow({
        chatId,
        userMessage: "민수가 들어왔다.",
        currentTurn: 2,
        sourceMessageId: 2,
        ...boundary,
        db,
      });
      assert.deepEqual(prospective, persisted);
    }
  });

  it("P4 prospective preflight performs zero provider calls", () => {
    const db = memDb();
    const chatId = nextChatId();
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error("provider call forbidden");
    }) as typeof fetch;
    try {
      buildProspectiveSecondarySceneSafetySnapshot({
        chatId,
        currentTurn: 1,
        currentUserMessage: "17살 동생이 들어왔다.",
        sceneReset: false,
        db,
      });
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("P5 future block point precedes persistence, provider, and billing owners", () => {
    assert.deepEqual(SECONDARY_SAFETY_FUTURE_EXECUTION_ORDER, [
      "classify_scene",
      "base_main_persona_eligibility",
      "prospective_secondary_safety",
      "SecondarySceneParticipantGuard",
      "durable_user_assistant_bootstrap",
      "commit_secondary_safety_evidence",
      "background_extractors",
      "adult_route_delivery",
      "provider",
      "billing_deduction",
    ]);
    const guard = SECONDARY_SAFETY_FUTURE_EXECUTION_ORDER.indexOf(
      "SecondarySceneParticipantGuard"
    );
    assert.ok(
      guard <
        SECONDARY_SAFETY_FUTURE_EXECUTION_ORDER.indexOf(
          "durable_user_assistant_bootstrap"
        )
    );
    assert.ok(
      guard <
        SECONDARY_SAFETY_FUTURE_EXECUTION_ORDER.indexOf(
          "background_extractors"
        )
    );
    assert.ok(
      guard <
        SECONDARY_SAFETY_FUTURE_EXECUTION_ORDER.indexOf("provider")
    );
    assert.ok(
      guard <
        SECONDARY_SAFETY_FUTURE_EXECUTION_ORDER.indexOf(
          "billing_deduction"
        )
    );

    const routeSource = readFileSync(
      new URL("../app/api/chat/route.ts", import.meta.url),
      "utf8"
    );
    const preflight = routeSource.indexOf(
      "const prospectiveSecondarySafety"
    );
    const durableBootstrap = routeSource.indexOf("bootstrapStreamingTurn(db");
    const provider = routeSource.indexOf(
      "return streamOpenRouterAdultToClient("
    );
    const billing = routeSource.indexOf("const deducted = deductPoints(");
    assert.ok(preflight > 0);
    assert.ok(preflight < durableBootstrap);
    assert.ok(preflight < provider);
    assert.ok(preflight < billing);
  });

  it("P6 fork coverage is incomplete at frontier/history and reset completes it", () => {
    for (const reason of [
      "fork_current_frontier_not_reconstructed",
      "fork_historical_not_reconstructed",
    ]) {
      const db = memDb();
      const childChatId = nextChatId();
      markSecondarySafetyCoverageIncomplete({
        chatId: childChatId,
        reason,
        db,
      });
      assert.equal(
        getSecondarySafetyCoverage(childChatId, db),
        "INCOMPLETE"
      );
      assert.equal(
        readSecondarySceneSafetySnapshot({ chatId: childChatId, db }).coverage,
        "INCOMPLETE"
      );
      evaluateCurrentTurnSecondarySceneSafetyShadow({
        chatId: childChatId,
        userMessage: "새 장면을 시작한다.",
        sceneReset: true,
        currentTurn: 3,
        sourceMessageId: 3,
        db,
      });
      assert.equal(getSecondarySafetyCoverage(childChatId, db), "COMPLETE");
    }
  });

  it("P7 branch/noncanon is memory-only and not a safety mutation path", () => {
    assert.equal(
      SECONDARY_SAFETY_BRANCH_NONCANON_AUDIT.classification,
      "NOT_APPLICABLE_TO_SECONDARY_SAFETY"
    );
    assert.match(
      SECONDARY_SAFETY_BRANCH_NONCANON_AUDIT.reason,
      /does not replace message rows.*switch variants.*mutate chat_scenes.*create\/copy chats/
    );
    const branchOwners = [
      "memory/memory-branch-control.ts",
      "memory/memory-turn-summary.ts",
    ].map((path) =>
      readFileSync(new URL(path, import.meta.url), "utf8")
    );
    for (const source of branchOwners) {
      assert.doesNotMatch(source, /UPDATE\s+messages/i);
      assert.doesNotMatch(source, /active_variant/i);
      assert.doesNotMatch(source, /chat_scenes/i);
      assert.doesNotMatch(source, /INSERT\s+INTO\s+chats/i);
    }
  });

  it("P8 user edit retracts source evidence; boundary edit marks coverage incomplete", () => {
    const db = memDb();
    const chatId = nextChatId();
    evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "17살 동생이 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      sourceMessageId: 81,
      db,
    });
    const edited = evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "창밖을 바라봤다.",
      sceneReset: false,
      currentTurn: 1,
      sourceMessageId: 81,
      skipSceneBoundary: true,
      db,
    });
    assert.equal(edited.minorParticipantIds.length, 0);
    assert.equal(edited.presentSecondaryParticipants.length, 0);

    markSecondarySafetyCoverageIncomplete({
      chatId,
      reason: "user_edit_changed_scene_boundary",
      db,
    });
    assert.equal(
      SECONDARY_SAFETY_USER_EDIT_BOUNDARY_POLICY.classification,
      "UNSUPPORTED_FOR_S2"
    );
    assert.equal(getSecondarySafetyCoverage(chatId, db), "INCOMPLETE");
  });

  it("P9 future failure policy disables adult handoff or fails closed", () => {
    assert.deepEqual(SECONDARY_SAFETY_FUTURE_FAILURE_POLICY, {
      normalRp: "continue_general_model_adult_handoff_disabled",
      adultOrSexual: "fail_closed_before_provider",
    });
  });
});
