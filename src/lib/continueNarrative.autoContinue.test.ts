import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildContinueNarrativeCommand,
  resolveAutoContinueHistoryTurns,
} from "@/lib/continueNarrative";

describe("resolveAutoContinueHistoryTurns", () => {
  it("drops exclusive OOC turn from history and sets resume ctx", () => {
    const turns = [
      { user: "안녕", assistant: "RP 장면 본문." },
      {
        user: "OOC: RP 중지. HTML로 입력한 내용만 띄워줘",
        assistant: "OOC HTML 출력 본문",
      },
    ];
    const { historyTurns, resumeCtx } = resolveAutoContinueHistoryTurns(turns);
    assert.equal(historyTurns.length, 1);
    assert.equal(historyTurns[0]!.user, "안녕");
    assert.equal(resumeCtx?.afterOocTurn, true);
    assert.equal(resumeCtx?.dropOocTurnFromHistory, true);
  });

  it("skips auto-continue turns when locating OOC anchor", () => {
    const turns = [
      { user: "RP", assistant: "장면 A." },
      { user: "OOC: HTML만", assistant: "HTML UI" },
      { user: "자동진행", assistant: "OOC를 또 말함" },
    ];
    const { historyTurns, resumeCtx } = resolveAutoContinueHistoryTurns(turns);
    assert.equal(historyTurns.length, 1);
    assert.equal(resumeCtx?.dropOocTurnFromHistory, true);
  });

  it("keeps history for rp_continuing OOC", () => {
    const turns = [
      { user: "RP", assistant: "장면." },
      { user: "OOC: 현재 장면 계속. 호감도 올려", assistant: "짧은 RP" },
    ];
    const { historyTurns, resumeCtx } = resolveAutoContinueHistoryTurns(turns);
    assert.equal(historyTurns.length, 2);
    assert.equal(resumeCtx?.afterOocTurn, true);
    assert.equal(resumeCtx?.dropOocTurnFromHistory, false);
    assert.equal(resumeCtx?.oocIntent, "rp_continuing");
  });

  it("returns full history when previous turn is normal RP", () => {
    const turns = [{ user: "걸어간다", assistant: "그녀가 따라온다." }];
    const { historyTurns, resumeCtx } = resolveAutoContinueHistoryTurns(turns);
    assert.equal(historyTurns.length, 1);
    assert.equal(resumeCtx, null);
  });
});

describe("buildContinueNarrativeCommand after OOC", () => {
  it("includes resume-in-character block for exclusive OOC", () => {
    const cmd = buildContinueNarrativeCommand({
      personaName: "유저",
      charName: "캐릭",
      resumeAfterOoc: {
        afterOocTurn: true,
        dropOocTurnFromHistory: true,
        oocIntent: "rp_unrelated",
      },
    });
    assert.match(cmd, /RESUME IN-CHARACTER RP — NOT OOC/);
    assert.match(cmd, /Do NOT repeat.*OOC\/meta\/HTML/);
    assert.doesNotMatch(cmd, /exact micro-moment the previous assistant turn ended/);
  });

  it("includes in-character guidance block for rp_continuing OOC", () => {
    const cmd = buildContinueNarrativeCommand({
      personaName: "유저",
      charName: "캐릭",
      resumeAfterOoc: {
        afterOocTurn: true,
        dropOocTurnFromHistory: false,
        oocIntent: "rp_continuing",
      },
    });
    assert.match(cmd, /OOC WAS SCENE GUIDANCE ONLY/);
    assert.doesNotMatch(cmd, /RESUME IN-CHARACTER RP — NOT OOC/);
  });
});
