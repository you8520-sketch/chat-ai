import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveStatusWindowOutputFormat,
  sourcesHaveExplicitMarkdownStatusRequest,
  userRequestsMarkdownStatusOutput,
} from "@/lib/statusWindowOutputFormat";
import { resolveUserNoteStatusWindowPolicy } from "@/lib/statusWindowNotePolicy";
import { isPlainTextStatusFormatSpec } from "@/lib/statusMeta/formatSpec";

describe("statusWindowOutputFormat", () => {
  it("defaults to plain when no format keyword", () => {
    assert.equal(
      resolveStatusWindowOutputFormat({
        userNote: `다음 상태창을 본문하단에 출력

NPC의 속마음 한 줄
현재 상황을 짧게 요약`,
      }),
      "plain"
    );
  });

  it("requires both markdown and 표형식 keywords", () => {
    assert.equal(
      userRequestsMarkdownStatusOutput("(OOC: 상태창 마크다운으로 보여줘)"),
      false
    );
    assert.equal(
      sourcesHaveExplicitMarkdownStatusRequest({
        userNote: "ooc: 다음 상태창을 마크다운 표 형식으로 출력",
      }),
      true
    );
  });

  it("prefers html over markdown", () => {
    assert.equal(
      resolveStatusWindowOutputFormat({
        userNote: "ooc: HTML로 상태창 마크다운 표기",
      }),
      "html"
    );
  });

  it("pipe-table template without markdown+표형식 uses markdown pipe-table format", () => {
    const note = `ooc:다음상태창을 본문하단에 표기할것
|💡 NPC의 속마음 한 줄|
|📝 현재 상황을 짧게 요약|`;
    const r = resolveUserNoteStatusWindowPolicy(note);
    assert.equal(r.everyTurn, true);
    assert.equal(r.outputFormat, "markdown");
    assert.equal(isPlainTextStatusFormatSpec(r.formatSpec!), false);
    assert.match(r.formatSpec ?? "", /^\|/m);
    assert.match(r.policyBlock, /markdown pipe-table/);
  });

  it("markdown+표형식 request keeps pipe-table formatSpec", () => {
    const note = `ooc:다음상태창을 본문하단에 마크다운 표 형식으로 표기할것
|💡 NPC의 속마음 한 줄|
|📝 현재 상황을 짧게 요약|`;
    const r = resolveUserNoteStatusWindowPolicy(note);
    assert.equal(r.everyTurn, true);
    assert.equal(r.outputFormat, "markdown");
    assert.match(r.formatSpec ?? "", /^\|/m);
    assert.equal(isPlainTextStatusFormatSpec(r.formatSpec!), false);
    assert.match(r.policyBlock, /markdown pipe-table/);
  });

  it("markdown-only with pipe-table template uses markdown (pipe rows imply table)", () => {
    const note = `ooc:다음상태창을 본문하단에 마크다운으로 표기할것
|💡 NPC의 속마음 한 줄|
|📝 현재 상황을 짧게 요약|`;
    const r = resolveUserNoteStatusWindowPolicy(note);
    assert.equal(r.outputFormat, "markdown");
    assert.match(r.formatSpec ?? "", /^\|/m);
    assert.equal(isPlainTextStatusFormatSpec(r.formatSpec!), false);
  });

  it("full user pipe-table note with separator row resolves to markdown table", () => {
    const note = `ooc:다음상태창을 본문하단에 표기할것
|:---:|:---
|상태창||🕒00:00|🏠00
|💡 NPC의 속마음 한 줄|
|📝 현재 상황을 짧게 요약|
|🔍 하고 싶은 것 1,  2, 3|
|✅ NPC의 낙서 한 줄(카오모지, 이모지 사용)|`;
    const r = resolveUserNoteStatusWindowPolicy(note);
    assert.equal(r.outputFormat, "markdown");
    assert.equal(r.everyTurn, true);
    assert.match(r.formatSpec ?? "", /^\|/m);
    assert.match(r.formatSpec ?? "", /속마음/);
    assert.equal(isPlainTextStatusFormatSpec(r.formatSpec!), false);
  });
});
