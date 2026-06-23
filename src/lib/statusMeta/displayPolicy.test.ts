import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chatUsesHtmlVisualStatusWindow,
  resolveStatusMetaExtractionEnabled,
  shouldShowStatusMetaCard,
} from "@/lib/statusMeta/displayPolicy";

const HTML_STATUS_NOTE = `다음상태창을 본문하단에 HTML을 사용하여 표기할것

💡 NPC의 속마음 한 줄
📝 현재 상황을 짧게 요약`;

const ANON_INBOX_OOC = `*[OOC: 잠시 롤플레잉 중단. HTML로 익명 메시지함 UI 출력]*`;
describe("statusMeta displayPolicy", () => {
  it("detects HTML emoji status window from user note", () => {
    assert.equal(chatUsesHtmlVisualStatusWindow({ userNote: HTML_STATUS_NOTE }), true);
  });

  it("extracts status meta for every-turn plain (Flash owns output)", () => {
    assert.equal(
      resolveStatusMetaExtractionEnabled({
        htmlReplacesMarkdownStatus: false,
        statusWindowEveryTurn: true,
        userMessage: "hello",
      }),
      true
    );
  });

  it("skips status meta when HTML replaces markdown status", () => {
    assert.equal(
      resolveStatusMetaExtractionEnabled({
        htmlReplacesMarkdownStatus: true,
        statusWindowEveryTurn: false,
        userMessage: "hello",
      }),
      false
    );
  });

  it("HTML standing wins over every-turn plain StatusMeta", () => {
    assert.equal(
      resolveStatusMetaExtractionEnabled({
        htmlReplacesMarkdownStatus: true,
        htmlVisualCardStanding: true,
        statusWindowEveryTurn: true,
        userMessage: "hello",
      }),
      false
    );
  });

  it("skips status meta when HTML Flash enabled for this turn", () => {
    assert.equal(
      resolveStatusMetaExtractionEnabled({
        htmlVisualCardEnabled: true,
        statusWindowEveryTurn: true,
        userMessage: "OOC: HTML로 상태창",
      }),
      false
    );
  });

  it("hides StatusMetaCard failed state when user turn triggers HTML Flash", () => {
    assert.equal(
      shouldShowStatusMetaCard({
        messageContent: "",
        statusMetaRequested: true,
        statusMetaFailed: true,
        userMessage: ANON_INBOX_OOC,
      }),
      false
    );
  });

  it("shows StatusMetaCard pending during streaming", () => {
    assert.equal(
      shouldShowStatusMetaCard({
        messageContent: "RP only",
        statusMetaPending: true,
        statusMetaRequested: true,
        isStreaming: true,
      }),
      true
    );
  });

  it("shows StatusMetaCard when every-turn Flash status active", () => {
    assert.equal(
      shouldShowStatusMetaCard({
        messageContent: "RP only",
        statusMeta: { tableMarkdown: "💡 NPC의 속마음 한 줄 : test" },
        statusMetaRequested: true,
        markdownStatusWindowActive: true,
      }),
      true
    );
  });

  it("hides StatusMetaCard when message has ```html block", () => {
    const content = "RP 본문\n\n```html\n<div>상태창</div>\n```";
    assert.equal(
      shouldShowStatusMetaCard({
        messageContent: content,
        statusMeta: { datetime: "14:00" },
        statusMetaRequested: true,
      }),
      false
    );
  });

  it("shows StatusMetaCard when every-turn active even if model leaked ```html", () => {
    const content = "RP 본문\n\n```html\n<div>상태창</div>\n```";
    assert.equal(
      shouldShowStatusMetaCard({
        messageContent: content,
        statusMeta: { tableMarkdown: "NPC의 속마음 한 줄 : test" },
        statusMetaRequested: true,
        markdownStatusWindowActive: true,
      }),
      true
    );
  });

  it("hides StatusMetaCard for HTML emoji status standing", () => {
    assert.equal(
      shouldShowStatusMetaCard({
        messageContent: "RP only",
        statusMeta: { datetime: "14:00" },
        statusMetaRequested: true,
        userNote: HTML_STATUS_NOTE,
      }),
      false
    );
  });

  it("shows StatusMetaCard for plain every-turn note with HTML messenger coexistence", () => {
    const note = `다음상태창을 본문하단에 출력해라

💡 NPC의 속마음 한 줄

ooc: HTML을 사용해서 카톡 내역을 상단에 출력`;
    assert.equal(
      shouldShowStatusMetaCard({
        messageContent: "RP only",
        statusMeta: { tableMarkdown: "💡 NPC의 속마음 한 줄 : test" },
        statusMetaRequested: true,
        userNote: note,
        markdownStatusWindowActive: true,
      }),
      true
    );
    assert.equal(
      chatUsesHtmlVisualStatusWindow({
        userNote: note,
        markdownStatusWindowActive: true,
      }),
      false
    );
  });
});
