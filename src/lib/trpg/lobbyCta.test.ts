import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { trpgLobbyCanInvite, trpgLobbyReenterCtaLabel } from "./lobbyCta";

describe("TRPG lobby re-enter CTA", () => {
  it("uses a status-specific primary label", () => {
    assert.equal(trpgLobbyReenterCtaLabel("CHARACTER_SETUP"), "캐릭터 설정 계속하기");
    assert.equal(trpgLobbyReenterCtaLabel("WAITING_FOR_PLAYERS"), "대기실 열기");
    assert.equal(trpgLobbyReenterCtaLabel("ACTION_INPUT"), "캠페인 계속하기");
    assert.equal(trpgLobbyReenterCtaLabel("CAMPAIGN_COMPLETE"), "캠페인 보기");
  });

  it("treats only setup/waiting rooms as invite-open", () => {
    assert.equal(trpgLobbyCanInvite("CHARACTER_SETUP"), true);
    assert.equal(trpgLobbyCanInvite("WAITING_FOR_PLAYERS"), true);
    assert.equal(trpgLobbyCanInvite("ACTION_INPUT"), false);
    assert.equal(trpgLobbyCanInvite("CAMPAIGN_COMPLETE"), false);
  });

  it("renders a violet primary re-enter button and no · 열기 link", () => {
    const lobby = readFileSync("src/app/trpg/TrpgLobbyClient.tsx", "utf8");
    assert.match(lobby, /trpgLobbyReenterCtaLabel/);
    assert.match(lobby, /data-trpg-reenter-cta/);
    assert.match(lobby, /bg-violet-600/);
    assert.match(lobby, /min-h-10/);
    assert.doesNotMatch(lobby, /· 열기/);
  });

  it("keeps invite secondary and hides the large started-room card", () => {
    const invite = readFileSync("src/app/trpg/TrpgInviteLink.tsx", "utf8");
    assert.match(invite, /초대 링크 복사/);
    assert.match(invite, /새 참가 불가/);
    assert.doesNotMatch(invite, /같이할 유저 초대/);
    assert.doesNotMatch(invite, /bg-violet-600/);
  });
});
