import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("TRPG UX polish contracts", () => {
  it("keeps desktop user chat as a persistent panel labeled 유저 채팅", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const rail = readFileSync("src/app/trpg/TrpgCampaignRail.tsx", "utf8");
    const panel = readFileSync("src/app/trpg/TrpgUserChatPanel.tsx", "utf8");
    assert.match(room, /data-trpg-stream-interval-ms=\{streamIntervalMs\}/);
    assert.match(room, /saveTrpgStreamIntervalMs/);
    assert.match(room, /streamCharsPerTick: current.streamCharsPerTick/);
    assert.match(room, /data-trpg-user-chat-desktop/);
    assert.match(room, /min-\[576px\]:flex/);
    assert.match(room, /w-\[260px\]/);
    assert.match(panel, /유저 채팅/);
    assert.match(panel, /플레이어끼리만 보이며 GM 진행에는 반영되지 않습니다/);
    assert.match(panel, /유저에게 메시지 보내기/);
    assert.match(rail, /return "유저 채팅"/);
    assert.match(rail, /return "채팅 설정"/);
    assert.match(rail, /title="출력 속도"/);
    assert.match(rail, /ChatStreamSpeedSettings/);
    assert.match(rail, /compact \? \["display", "sheets", "ooc"\] : \["display", "sheets"\]/);
    assert.doesNotMatch(rail, /return "표시"/);
    assert.doesNotMatch(rail, /잡담/);
    assert.doesNotMatch(panel, /잡담/);
  });
});
