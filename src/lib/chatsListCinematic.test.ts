import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { chatEntryHref } from "@/lib/chatLinks";
import {
  CHAT_RESUME_ATTR,
  CHAT_RESUME_CHAT_ATTR,
  CHAT_RESUME_NAME_ATTR,
  chatResumeAttrs,
  resolveChatResumeTarget,
} from "@/lib/chatResumeTransition";
import { recentTrpgCampaignHref } from "@/lib/recentActivity";
import { TRPG_RESUME_ATTR, resolveTrpgResumeTarget, trpgResumeAttrs } from "@/lib/trpgResumeTransition";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const modal = read("src/components/CharacterChatBranchModal.tsx");
const grid = read("src/components/ChatsPageGrid.tsx");
const host = read("src/components/MenuTransition.tsx");

function attrsFor(characterId: number, chatId: number, hidden = false) {
  return {
    href: hidden ? "/verify" : chatEntryHref(characterId, { chatId }),
    attrs: chatResumeAttrs({ characterId, chatId, name: "강이현", hidden }),
  };
}

function resolve(href: string, attrs: Record<string, string>) {
  const url = new URL(href, "http://localhost");
  return resolveChatResumeTarget({
    markerCharacterId: attrs[CHAT_RESUME_ATTR] ?? null,
    markerChatId: attrs[CHAT_RESUME_CHAT_ATTR] ?? null,
    destPathname: url.pathname,
    destSearch: url.search,
  });
}

describe("chats list: picker rows resolve to the exact chosen room", () => {
  it("maps a chosen chatId to that room only, for single and multiple rooms", () => {
    for (const chatId of [871370, 871371]) {
      const { href, attrs } = attrsFor(13, chatId);
      assert.deepEqual(resolve(href, attrs), { characterId: 13, chatId });
      assert.equal(attrs[CHAT_RESUME_NAME_ATTR], "강이현");
    }
  });

  it("never starts when the marker names a different chat than the link", () => {
    const { href } = attrsFor(13, 871370);
    const other = attrsFor(13, 871371).attrs;
    assert.equal(resolve(href, other), null);
    const otherCharacter = attrsFor(14, 871370).attrs;
    assert.equal(resolve(href, otherCharacter), null);
  });

  it("starts nothing for adult-hidden rows, which keep the /verify navigation", () => {
    const { href, attrs } = attrsFor(13, 871370, true);
    assert.equal(href, "/verify");
    assert.deepEqual(attrs, {});
    assert.equal(resolve(href, attrs), null);
  });

  it("does not treat a fresh chat or a persona-bearing link as an existing-room resume", () => {
    assert.equal(
      resolve(chatEntryHref(13, { fresh: true }), attrsFor(13, 1).attrs),
      null,
    );
    assert.equal(
      resolve(chatEntryHref(13, { chatId: 871370, personaId: 4 }), attrsFor(13, 871370).attrs),
      null,
    );
  });
});

describe("chats list: TRPG cards resolve to the exact campaign", () => {
  it("marks only the campaign link and ignores the lobby", () => {
    const href = recentTrpgCampaignHref(98);
    const attrs = trpgResumeAttrs({ campaignId: 98, title: "북부 전선", href });
    assert.equal(attrs[TRPG_RESUME_ATTR], "98");
    assert.deepEqual(
      resolveTrpgResumeTarget({
        markerCampaignId: attrs[TRPG_RESUME_ATTR] ?? null,
        destPathname: href,
        destSearch: "",
      }),
      { campaignId: 98 },
    );
    assert.deepEqual(trpgResumeAttrs({ campaignId: 98, title: "북부 전선", href: "/trpg" }), {});
  });
});

describe("chats list: ownership and regression guards", () => {
  it("lets the picker confirm a real room through a native Link and the D-2 marker", () => {
    assert.match(modal, /chatResumeAttrs\(\{ characterId, chatId, name: characterName, hidden \}\)/);
    assert.match(modal, /chatEntryHref\(characterId, \{ chatId \}\)/);
    assert.match(modal, /<Link\s+\{\.\.\.enterLinkProps\(b\.chat_id\)\}/);
    assert.match(modal, /<Link\s+\{\.\.\.enterLinkProps\(latest\.chat_id\)\}/);
    assert.doesNotMatch(modal, /router\.push\(chatEntryHref/);
    assert.doesNotMatch(modal, /role="button"/);
  });

  it("keeps the picker's rename, delete, cancel and character-info out of the cinematic", () => {
    const rename = modal.slice(modal.indexOf("function startRename"), modal.indexOf("return (\n    <div\n      className=\"fixed"));
    assert.doesNotMatch(rename, /chatResume|CHAT_RESUME|router\.push/);
    assert.match(modal, /onClick=\{\(\) => startRename\(b\)\}/);
    assert.match(modal, /onClick=\{\(\) => onDeleteRequest\(b\)\}/);
    const info = modal.slice(modal.indexOf("캐릭터 정보") - 400, modal.indexOf("캐릭터 정보"));
    assert.doesNotMatch(info, /chatResume|enterLinkProps/);
  });

  it("starts fresh chats through the explicit session owner with no resume marker", () => {
    const fresh = modal.slice(modal.indexOf("async function startFreshChat"), modal.indexOf("function startRename"));
    assert.match(fresh, /requestExplicitChatSession\(/);
    assert.match(fresh, /router\.push\(chatRoomHref\(characterId, chatId\)\)/);
    assert.doesNotMatch(fresh, /chatResume|CHAT_RESUME|enterLinkProps/);
  });

  it("closes the picker only on a plain left click so modified clicks keep native behavior", () => {
    assert.match(modal, /isPlainLeftClick\(e\)/);
    assert.match(modal, /if \(isPlainLeftClick\(e\)\) onClose\(\)/);
  });

  it("starts from a visible, non-private avatar and blurs it for adult-hidden rooms", () => {
    assert.match(modal, /\{\.\.\.\{ \[CHAT_RESUME_THUMB_ATTR\]: "" \}\}/);
    assert.match(modal, /hidden \? "blur-md" : ""/);
    assert.match(host, /includes\("\/media\/private\/"\)/);
  });

  it("keeps the character photo link to the profile and the card body as the picker opener", () => {
    assert.match(grid, /href=\{characterPageHref\(group\.character_id, hidden, group\.nsfw === 1\)\}/);
    assert.match(grid, /onClick=\{selectionMode \? onToggleSelection : onOpenBranches\}/);
    const character = grid.slice(grid.indexOf("function ChatCharacterCard"), grid.indexOf("function TrpgChatCard"));
    assert.doesNotMatch(character, /chatResume|trpgResume/);
  });

  it("merges the TRPG image and body into one marked Link outside selection mode", () => {
    const card = grid.slice(grid.indexOf("function TrpgChatCard"), grid.indexOf("export default function ChatsPageGrid"));
    assert.match(card, /trpgResumeAttrs\(\{\s*campaignId: campaign\.campaignId,\s*title: campaign\.title,\s*href: campaign\.href,/);
    assert.match(card, /\{\.\.\.\{ \[TRPG_RESUME_GLYPH_ATTR\]: "" \}\}/);
    assert.equal((card.match(/<Link/g) ?? []).length, 1, "one accessible link, not an image link plus a body link");
    const selection = card.slice(card.indexOf("{selectionMode ? ("), card.indexOf(") : (\n        <Link"));
    assert.match(selection, /onToggleSelection/);
    assert.doesNotMatch(selection, /<Link|trpgResume/);
  });

  it("leaves lobby and empty-state links unmarked", () => {
    const empty = grid.slice(grid.indexOf("if (sessions.length === 0"), grid.indexOf("return (\n    <div className=\"chats-page-grid"));
    assert.match(empty, /href="\/trpg"/);
    assert.doesNotMatch(empty, /chatResume|trpgResume|TRPG_RESUME/);
  });

  it("adds no second host, router, fetch, or session writer for the list", () => {
    assert.equal(host.match(/export default function MenuTransitionHost/g)?.length, 1);
    for (const src of [modal, grid]) {
      assert.doesNotMatch(src, /MenuTransitionHost|menu-veil|\.cr-veil|\.tr-veil/);
    }
    const rows = modal.slice(modal.indexOf("function enterLinkProps"), modal.indexOf("async function startFreshChat"));
    assert.doesNotMatch(rows, /fetch\(|router\.|requestExplicitChatSession/);
    const trpgCard = grid.slice(grid.indexOf("function TrpgChatCard"), grid.indexOf("export default function ChatsPageGrid"));
    assert.doesNotMatch(trpgCard, /fetch\(|router\./);
  });
});
