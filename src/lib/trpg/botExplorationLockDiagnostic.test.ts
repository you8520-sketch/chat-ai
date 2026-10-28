import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  BOT_EXPLORATION_LOG_UNKNOWN_ROOM,
  botExplorationProseIntentAudit,
  emitBotExplorationLockDiagnosticSafe,
  explorationRejectCode,
  logSafeFromRoomId,
  logSafeRoomId,
  logSafeRoomIds,
} from "./botExplorationLockDiagnostic";
import { emptyExplorationState, EXPLORATION_ENTRANCE } from "./explorationMap";

describe("botExplorationLockDiagnostic", () => {
  it("classifies rejection messages without echoing user text", () => {
    assert.equal(explorationRejectCode(new Error("연결되지 않은 방입니다.")), "disconnected");
    assert.equal(explorationRejectCode(new Error("행동력이 부족합니다.")), "ap_insufficient");
    assert.equal(explorationRejectCode(new Error("행동이 너무 깁니다.")), "body_too_long");
    assert.equal(explorationRejectCode(new Error("unexpected")), "other");
  });

  it("maps known rooms to canonical ids and unknown tokens to a fixed marker", () => {
    const map = emptyExplorationState("default").map;
    assert.equal(logSafeRoomId(map, EXPLORATION_ENTRANCE), EXPLORATION_ENTRANCE);
    assert.equal(logSafeRoomId(map, "비공식비밀기지"), BOT_EXPLORATION_LOG_UNKNOWN_ROOM);
    assert.deepEqual(logSafeRoomIds(map, ["출구", "없는곳", EXPLORATION_ENTRANCE]), [
      "출구",
      BOT_EXPLORATION_LOG_UNKNOWN_ROOM,
      EXPLORATION_ENTRANCE,
    ]);
    assert.equal(logSafeFromRoomId(map, "없는현재위치"), BOT_EXPLORATION_LOG_UNKNOWN_ROOM);
  });

  it("does not throw when prose/intent audit fails", () => {
    const map = emptyExplorationState("default").map;
    const logs: unknown[] = [];
    const info = mock.method(console, "info", (label: unknown, payload?: unknown) => {
      if (label === "[trpg-bot-exploration-lock]") logs.push(payload);
    });
    const audit = mock.method(botExplorationProseIntentAudit, "readMoveRoomIds", () => {
      throw new Error("parser boom");
    });
    assert.doesNotThrow(() =>
      emitBotExplorationLockDiagnosticSafe(map, "ignored", {
        campaignId: 44,
        roundId: 1,
        participantId: 2,
        fromLocationLabel: EXPLORATION_ENTRANCE,
        declaredRoomIdsRaw: ["출구"],
        legalRoomIdsRaw: [],
        firstRejectCode: "disconnected",
        fallbackBranch: "priced-empty",
        outcome: "stay-fallback",
        retryRejectCode: null,
      })
    );
    assert.equal(logs.length, 1);
    const entry = logs[0] as { diagnosticFailureCode: string; declaredRoomIds: string[] };
    assert.equal(entry.diagnosticFailureCode, "audit_parse_failed");
    assert.deepEqual(entry.declaredRoomIds, ["출구"]);
    audit.mock.restore();
    info.mock.restore();
  });

  it("includes retryRejectCode without logging raw errors", () => {
    const map = emptyExplorationState("default").map;
    const logs: unknown[] = [];
    const info = mock.method(console, "info", (label: unknown, payload?: unknown) => {
      if (label === "[trpg-bot-exploration-lock]") logs.push(payload);
    });
    emitBotExplorationLockDiagnosticSafe(map, "현관홀로 이동한다.", {
      campaignId: 44,
      roundId: 14,
      participantId: 9,
      fromLocationLabel: EXPLORATION_ENTRANCE,
      declaredRoomIdsRaw: ["출구", "없는곳"],
      legalRoomIdsRaw: ["남쪽복도"],
      firstRejectCode: "disconnected",
      fallbackBranch: "retry-throw",
      outcome: "stay-fallback",
      retryRejectCode: "body_too_long",
    });
    const entry = logs[0] as {
      retryRejectCode: string;
      firstRejectCode: string;
      declaredRoomIds: string[];
    };
    assert.equal(entry.retryRejectCode, "body_too_long");
    assert.equal(entry.firstRejectCode, "disconnected");
    assert.deepEqual(entry.declaredRoomIds, ["출구", BOT_EXPLORATION_LOG_UNKNOWN_ROOM]);
    info.mock.restore();
  });

  it("does not throw when console.info fails", () => {
    const map = emptyExplorationState("default").map;
    const info = mock.method(console, "info", () => {
      throw new Error("log sink down");
    });
    assert.doesNotThrow(() =>
      emitBotExplorationLockDiagnosticSafe(map, "현관홀로 이동한다.", {
        campaignId: 44,
        roundId: 1,
        participantId: 2,
        fromLocationLabel: EXPLORATION_ENTRANCE,
        declaredRoomIdsRaw: [EXPLORATION_ENTRANCE],
        legalRoomIdsRaw: [EXPLORATION_ENTRANCE],
        firstRejectCode: null,
        fallbackBranch: "full-lock",
        outcome: "move-locked",
        retryRejectCode: null,
      })
    );
    info.mock.restore();
  });
});
