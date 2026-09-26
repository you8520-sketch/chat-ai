import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import {
  clearUserInputDraft,
  loadTrpgActionDraft,
  loadUserInputDraft,
  resolveSendCustodyBackup,
  resolveTrpgActionInitialBody,
  saveTrpgActionDraft,
  saveUserInputDraft,
  trpgActionDraftKey,
  trpgPartyDraftKey,
} from "./userInputDraft";
import { applyChatStreamDraftRecoveryOnLoad } from "./chatStreamDraftRecovery";

/** Minimal sessionStorage stub — production code guards on `window`. */
function installSessionStorageStub() {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  (globalThis as Record<string, unknown>).window ??= {};
  (globalThis as Record<string, unknown>).sessionStorage = stub;
  store.clear();
  return store;
}

describe("user input custody gap reproduction (must fail before fix)", () => {
  it("general RP send gap has a browser-side backup until durable ACK", () => {
    // Typed "hello" -> send starts (UI cleared) -> flush/bootstrap pending.
    // No moment may leave every owner empty.
    const owners = resolveSendCustodyBackup({
      reactInput: "",
      messageDraft: "",
      streamDraftUserText: "",
      dbUserRow: null,
      inFlightBackupText: "hello",
    });
    assert.equal(owners.hasOwner, true, "at least one browser owner must hold the text");
    assert.equal(owners.owner, "in-flight-backup");
  });

  it("TRPG action/party drafts survive reload scope", () => {
    const actionKey = trpgActionDraftKey(7, 3);
    const partyKey = trpgPartyDraftKey(7);
    assert.notEqual(actionKey, partyKey, "action and party are separate scopes");
    assert.match(actionKey, /3/, "action scope must include roundNumber");
  });
});

describe("send custody owner map", () => {
  it("empty everywhere means data loss", () => {
    const r = resolveSendCustodyBackup({
      reactInput: "  ",
      messageDraft: "",
      streamDraftUserText: "",
      dbUserRow: null,
      inFlightBackupText: "",
    });
    assert.equal(r.hasOwner, false);
    assert.equal(r.owner, null);
  });

  it("priority follows custody transfer order: db > react > message > stream > in-flight", () => {
    const base = {
      reactInput: "r",
      messageDraft: "m",
      streamDraftUserText: "s",
      dbUserRow: "d",
      inFlightBackupText: "f",
    };
    assert.equal(resolveSendCustodyBackup(base).owner, "db");
    assert.equal(resolveSendCustodyBackup({ ...base, dbUserRow: null }).owner, "react-input");
    assert.equal(
      resolveSendCustodyBackup({ ...base, dbUserRow: null, reactInput: "" }).owner,
      "message-draft"
    );
    assert.equal(
      resolveSendCustodyBackup({ ...base, dbUserRow: null, reactInput: "", messageDraft: "" })
        .owner,
      "stream-draft"
    );
    assert.equal(
      resolveSendCustodyBackup({
        ...base,
        dbUserRow: null,
        reactInput: "",
        messageDraft: "",
        streamDraftUserText: "",
      }).owner,
      "in-flight-backup"
    );
  });
});

describe("userInputDraft storage primitive", () => {
  it("saves typing, restores after reload, clears on empty, isolates scopes", () => {
    installSessionStorageStub();
    saveUserInputDraft("k:A", "  hello  ", 100);
    assert.equal(loadUserInputDraft("k:A", 100), "  hello  ");
    // Empty input removes the draft (typed-then-cleared must not resurrect).
    saveUserInputDraft("k:A", "   ", 100);
    assert.equal(loadUserInputDraft("k:A", 100), "");
    // Scope isolation.
    saveUserInputDraft("k:A", "room-a", 100);
    saveUserInputDraft("k:B", "room-b", 100);
    assert.equal(loadUserInputDraft("k:A", 100), "room-a");
    assert.equal(loadUserInputDraft("k:B", 100), "room-b");
    clearUserInputDraft("k:A");
    assert.equal(loadUserInputDraft("k:A", 100), "");
    assert.equal(loadUserInputDraft("k:B", 100), "room-b");
  });

  it("caps at max chars", () => {
    installSessionStorageStub();
    saveUserInputDraft("k:cap", "abcdef", 3);
    assert.equal(loadUserInputDraft("k:cap", 3), "abc");
  });
});

describe("TRPG action draft", () => {
  it("round-scoped keys isolate campaigns and rounds", () => {
    assert.notEqual(trpgActionDraftKey(7, 3), trpgActionDraftKey(7, 4));
    assert.notEqual(trpgActionDraftKey(7, 3), trpgActionDraftKey(8, 3));
    assert.notEqual(trpgActionDraftKey(7, 3), trpgPartyDraftKey(7));
    assert.notEqual(trpgPartyDraftKey(7), trpgPartyDraftKey(8));
  });

  it("server locked draft wins over local unsent draft", () => {
    assert.equal(resolveTrpgActionInitialBody("서버 잠금 본문", "로컬 초안"), "서버 잠금 본문");
    assert.equal(resolveTrpgActionInitialBody("", "로컬 초안"), "로컬 초안");
    assert.equal(resolveTrpgActionInitialBody(null, "로컬 초안"), "로컬 초안");
    assert.equal(resolveTrpgActionInitialBody("  ", undefined), "");
  });

  it("preserves body/type/origin across reload, clears on submit, never leaks across rounds", () => {
    installSessionStorageStub();
    const key3 = trpgActionDraftKey(7, 3);
    saveTrpgActionDraft(
      key3,
      { body: "문을 어깨로 밀어 본다.", actionType: "athletics", inputOrigin: "reply_suggestion" },
      1500
    );
    const restored = loadTrpgActionDraft(key3, 1500);
    assert.equal(restored?.body, "문을 어깨로 밀어 본다.");
    assert.equal(restored?.actionType, "athletics");
    assert.equal(restored?.inputOrigin, "reply_suggestion");
    // Previous-round draft must not appear in the new round.
    assert.equal(loadTrpgActionDraft(trpgActionDraftKey(7, 4), 1500), null);
    // Successful submit clears the local unsent draft.
    clearUserInputDraft(key3);
    assert.equal(loadTrpgActionDraft(key3, 1500), null);
    // Empty body never persists.
    saveTrpgActionDraft(key3, { body: "   ", actionType: "free", inputOrigin: "manual" }, 1500);
    assert.equal(loadTrpgActionDraft(key3, 1500), null);
  });
});

describe("general RP client custody wiring", () => {
  const client = () => fs.readFileSync("src/app/chat/[id]/ChatClient.tsx", "utf8");

  it("empty-input effect cannot delete the in-flight draft (scoped guard)", () => {
    const src = client();
    assert.match(src, /inFlightInScope/);
    assert.match(src, /saveChatMessageDraft\(character\.id, chatId, inFlight\.text\)/);
  });

  it("message draft clears only on the durable-bootstrap ACK, not after flush", () => {
    const src = client();
    assert.match(src, /inFlightInputRef\.current\?\.requestId === rid/);
    assert.match(src, /clearChatMessageDraft\(character\.id, data\.chatId \?\? chatId\)/);
    assert.doesNotMatch(
      src,
      /clearChatMessageDraft\(character\.id, chatId\);\n    writeChatStreamDraft/
    );
  });

  it("pre-bootstrap failures preserve drafts instead of clearing the stream backup", () => {
    const src = client();
    assert.match(src, /Pre-bootstrap failure/);
    // send()'s HTTP-error path must not clear the stream draft anymore.
    const sendEarlyExit = src.match(
      /handleStreamError\(res, aiIndex, \(\) => \{[\s\S]*?\}, text\);[\s\S]*?if \(earlyExit\) \{([\s\S]*?)\n      \}/
    );
    assert.ok(sendEarlyExit, "send earlyExit block must exist");
    assert.doesNotMatch(sendEarlyExit[1]!, /clearChatStreamDraft/);
    assert.match(sendEarlyExit[1]!, /saveChatMessageDraft\(character\.id, chatId, text\)/);
  });

  it("orphan stream drafts restore the composer without synthesizing turns", () => {
    const src = client();
    assert.match(src, /dbHasMatchingRequest/);
    // Pure recovery still clears the orphan without fabricating rows.
    const result = applyChatStreamDraftRecoveryOnLoad(
      [{ role: "user", content: "other" }],
      { requestId: "cr_missing", chatId: 1, userText: "lost text", assistantPartial: "", updatedAt: 1 }
    );
    assert.equal(result.action, "clear-orphan");
    assert.equal(result.clearedDraft, true);
    assert.deepEqual(result.messages, [{ role: "user", content: "other" }]);
  });
});

describe("TRPG client custody wiring", () => {
  const room = () => fs.readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8");

  it("action submit clears the local draft only on server acceptance", () => {
    const src = room();
    assert.match(src, /async function sendAction/);
    assert.match(
      src,
      /clearUserInputDraft\(trpgActionDraftKey\(campaignId, roundNumber\)\)/
    );
    assert.match(src, /onSendAction=\{\(\) => void sendAction\(\)\}/);
  });

  it("party chat clears on success and preserves on failure", () => {
    const src = room();
    assert.match(src, /clearUserInputDraft\(trpgPartyDraftKey\(snap\.id\)\)/);
    assert.match(
      src,
      /saveUserInputDraft\(trpgPartyDraftKey\(snap\.id\), partyBody, TRPG_PARTY_CHAT_MAX_CHARS\)/
    );
  });

  it("server locked draft takes precedence over the local draft on every snapshot", () => {
    const src = room();
    assert.match(src, /resolveTrpgActionInitialBody/);
    assert.match(src, /SERVER LOCKED DRAFT > LOCAL UNSENT DRAFT/);
  });

  it("suggestion-round lifecycle cannot overwrite a draft restored by the round owner", () => {
    const src = room();
    const effectStart = src.indexOf("if (suggestionRound !== snap.round.number)");
    assert.ok(effectStart >= 0, "suggestion-round effect must exist");
    const effectEnd = src.indexOf("}, [snap.id, snap.myDraft, snap.round.number, suggestionRound]);", effectStart);
    assert.ok(effectEnd > effectStart, "suggestion-round effect boundary must exist");
    const effect = src.slice(effectStart, effectEnd);
    assert.doesNotMatch(effect, /setActionBody\(/);
    assert.doesNotMatch(effect, /setActionType\(/);
    assert.doesNotMatch(effect, /setInputOrigin\(/);
    assert.match(src, /Round composer state is owned by apply\(\)/);
  });
});
