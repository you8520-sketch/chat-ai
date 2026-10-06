import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("TRPG UX polish contracts", () => {
  it("keeps user chat inside the command dock and display settings on the rail", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const rail = readFileSync("src/app/trpg/TrpgCampaignRail.tsx", "utf8");
    const panel = readFileSync("src/app/trpg/TrpgUserChatPanel.tsx", "utf8");
    const dock = readFileSync("src/app/trpg/TrpgCommandDock.tsx", "utf8");
    assert.match(room, /data-trpg-stream-interval-ms=\{streamIntervalMs\}/);
    assert.match(room, /saveTrpgStreamIntervalMs/);
    assert.match(room, /streamCharsPerTick: current.streamCharsPerTick/);
    assert.doesNotMatch(room, /data-trpg-user-chat-desktop/);
    assert.match(dock, /<TrpgUserChatPanel/);
    assert.match(dock, /partyBody=\{partyBody\}/);
    assert.match(dock, /onSendParty=\{onSendParty\}/);
    assert.doesNotMatch(dock, /<TrpgUserChatPanel[\s\S]{0,240}onSendAction/);
    assert.match(panel, /유저 채팅/);
    assert.match(panel, /플레이어끼리만 보이며 GM 진행에는 반영되지 않습니다/);
    assert.match(panel, /유저에게 메시지 보내기/);
    assert.match(dock, /commandDockModeLabel\(mode\)/);
    assert.match(readFileSync("src/lib/trpg/commandDock.ts", "utf8"), /return "유저 채팅"/);
    assert.match(rail, /return "채팅 설정"/);
    assert.match(rail, /title="출력 속도"/);
    assert.match(rail, /ChatStreamSpeedSettings/);
    assert.doesNotMatch(rail, /return "유저 채팅"/);
    assert.doesNotMatch(rail, /return "표시"/);
    assert.doesNotMatch(rail, /잡담/);
    assert.doesNotMatch(panel, /잡담/);
  });
});
