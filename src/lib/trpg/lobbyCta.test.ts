import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { trpgLobbyCanInvite, trpgLobbyReenterCtaLabel } from "./lobbyCta";

describe("TRPG lobby re-enter CTA", () => {
  it("uses a compact status-specific primary label", () => {
    assert.equal(trpgLobbyReenterCtaLabel("CHARACTER_SETUP"), "설정 계속");
    assert.equal(trpgLobbyReenterCtaLabel("WAITING_FOR_PLAYERS"), "대기실");
    assert.equal(trpgLobbyReenterCtaLabel("ACTION_INPUT"), "계속");
    assert.equal(trpgLobbyReenterCtaLabel("ROUND_COMPLETE"), "계속");
    assert.equal(trpgLobbyReenterCtaLabel("CAMPAIGN_COMPLETE"), "보기");
  });

  it("treats only setup/waiting rooms as invite-open", () => {
    assert.equal(trpgLobbyCanInvite("CHARACTER_SETUP"), true);
    assert.equal(trpgLobbyCanInvite("WAITING_FOR_PLAYERS"), true);
    assert.equal(trpgLobbyCanInvite("ACTION_INPUT"), false);
    assert.equal(trpgLobbyCanInvite("CAMPAIGN_COMPLETE"), false);
  });

  it("does not keep a duplicate my-campaign list on the TRPG lobby", () => {
    const lobby = readFileSync("src/app/trpg/TrpgLobbyClient.tsx", "utf8");
    assert.doesNotMatch(lobby, /내 캠페인/);
    assert.doesNotMatch(lobby, /trpgLobbyReenterCtaLabel/);
    assert.doesNotMatch(lobby, /data-trpg-reenter-cta/);
    assert.doesNotMatch(lobby, /href=\{`\/trpg\/\$\{c\.id\}`\}/);
    assert.doesNotMatch(lobby, /캠페인 계속하기/);
    assert.match(lobby, /초대 링크·코드로 참가/);
  });

  it("keeps invite secondary and hides the large started-room card", () => {
    const invite = readFileSync("src/app/trpg/TrpgInviteLink.tsx", "utf8");
    assert.match(invite, /초대 링크 복사/);
    assert.match(invite, /새 참가 불가/);
    assert.doesNotMatch(invite, /같이할 유저 초대/);
    assert.doesNotMatch(invite, /bg-violet-600/);
  });

  it("does not restore delayed force-scroll or a global ResizeObserver", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.doesNotMatch(room, /100, 250, 500, 1000, 1500, 2500/);
    assert.doesNotMatch(room, /setInterval\([^)]*3000/);
    assert.match(room, /followLatest/);
    assert.match(room, /data-trpg-live-scene/);
    assert.match(room, /bottomRef\.current\.scrollIntoView/);
    assert.doesNotMatch(room, /observer\.observe\(content\)/);
  });
});
