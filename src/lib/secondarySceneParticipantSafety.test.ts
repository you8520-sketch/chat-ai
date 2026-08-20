import Module from "module";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getActiveChatScene, listChatScenes } from "./chatScenes";
import { ensureObserverSchema } from "./observerSchema";
import {
  extractCurrentTurnSceneParticipantEvents,
} from "./secondarySceneParticipantEvidence";
import {
  evaluateCurrentTurnSecondarySceneSafetyShadow,
  persistAssistantTurnSecondarySceneSafety,
  readSecondarySceneSafetySnapshot,
} from "./secondarySceneParticipantSafety";
import { ensureSecondarySceneParticipantSafetySchema } from "./secondarySceneParticipantSafetySchema";
import { listPresentSecondaryParticipants } from "./secondarySceneParticipantSafetyStore";

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
