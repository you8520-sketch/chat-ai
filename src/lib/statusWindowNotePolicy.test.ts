import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractPipeTableLines,
  resolveStatusFormatSpecFromSources,
  resolveStatusWindowPolicyFromSources,
  resolveUserNoteStatusWindowPolicy,
  stripRedundantStatusWindowFromSource,
} from "@/lib/statusWindowNotePolicy";
import { isPlainTextStatusFormatSpec } from "@/lib/statusMeta/formatSpec";
import { resolveStatusMetaExtractionEnabled } from "@/lib/statusMeta/displayPolicy";
import { mergeUserNoteBodyFromEditor } from "@/lib/userNoteStatusWindow";

describe("resolveUserNoteStatusWindowPolicy", () => {
  it("enables every-turn markdown for pipe-table template without markdown+표형식 keywords", () => {
    const note = `ooc:다음상태창을 본문하단에 표기할것
|💡 NPC의 속마음 한 줄|
|📝 현재 상황을 짧게 요약|`;
    const r = resolveUserNoteStatusWindowPolicy(note);
    assert.equal(r.everyTurn, true);
    assert.equal(r.outputFormat, "markdown");
    assert.ok(r.formatSpec);
    assert.equal(isPlainTextStatusFormatSpec(r.formatSpec!), false);
    assert.match(r.formatSpec ?? "", /^\|/m);
    assert.match(r.policyBlock, /markdown pipe-table/);
  });

  it("requires pipe-table template for every-turn (keyword-only OOC is not enough)", () => {
    const r = resolveUserNoteStatusWindowPolicy("(OOC: 상태창 보여줘)");
    assert.equal(r.everyTurn, false);
    assert.equal(r.formatSpec, null);
  });

  it("exact user ooc markdown+표형식 directive with pipe fields enables markdown every-turn", () => {
    const note = `ooc:다음상태창을 본문하단에 마크다운 표형식으로 표기할것
|💡 NPC의 속마음 한 줄|
|📝 현재 상황을 짧게 요약|`;
    const r = resolveUserNoteStatusWindowPolicy(note);
    assert.equal(r.everyTurn, true);
    assert.equal(r.outputFormat, "markdown");
    assert.match(r.formatSpec ?? "", /^\|/m);
    assert.equal(isPlainTextStatusFormatSpec(r.formatSpec!), false);
    assert.match(r.policyBlock, /markdown pipe-table/);
  });

  it("markdown-only without 표형식 keeps plain field list (no pipe-table conversion)", () => {
    const note = `다음 상태창을 본문하단에 마크다운으로 출력

💡 NPC의 속마음 한 줄
📝 현재 상황을 짧게 요약`;
    const r = resolveUserNoteStatusWindowPolicy(note);
    assert.equal(r.outputFormat, "plain");
    assert.equal(r.everyTurn, true);
    assert.doesNotMatch(r.formatSpec ?? "", /^\|/m);
    assert.equal(isPlainTextStatusFormatSpec(r.formatSpec!), true);
  });

  it("markdown request with plain emoji fields converts to pipe-table formatSpec", () => {
    const note = `다음 상태창을 본문하단에 마크다운 표 형식으로 출력

💡 NPC의 속마음 한 줄
📝 현재 상황을 짧게 요약`;
    const r = resolveUserNoteStatusWindowPolicy(note);
    assert.equal(r.everyTurn, true);
    assert.equal(r.outputFormat, "markdown");
    assert.match(r.formatSpec ?? "", /^\|/m);
    assert.equal(isPlainTextStatusFormatSpec(r.formatSpec!), false);
    assert.match(r.policyBlock, /markdown pipe-table/);
  });

  it("markdown request with plain text fields (no emoji) converts to pipe-table formatSpec", () => {
    const note = `다음 상태창을 본문하단에 마크다운 표 형식으로 출력

NPC의 속마음 한 줄
현재 상황을 짧게 요약
하고 싶은 것 1,  2, 3
NPC의 낙서 한 줄(카오모지, 이모지 사용)`;
    const r = resolveUserNoteStatusWindowPolicy(note);
    assert.equal(r.everyTurn, true);
    assert.equal(r.outputFormat, "markdown");
    assert.match(r.formatSpec ?? "", /^\|/m);
    assert.match(r.formatSpec ?? "", /NPC의 속마음/);
    assert.equal(isPlainTextStatusFormatSpec(r.formatSpec!), false);
    assert.match(r.policyBlock, /markdown pipe-table/);
  });

  it("markdown request converts plain field list in reference zone to pipe-table", () => {
    const note = mergeUserNoteBodyFromEditor(
      "다음 상태창을 본문하단에 마크다운 표 형식으로 출력",
      "NPC의 속마음 한 줄\n현재 상황을 짧게 요약\nNPC의 낙서 한 줄"
    );
    const r = resolveUserNoteStatusWindowPolicy(note);
    assert.equal(r.outputFormat, "markdown");
    assert.match(r.formatSpec ?? "", /^\|/m);
    assert.equal(isPlainTextStatusFormatSpec(r.formatSpec!), false);
  });

  it("enables every-turn plain-text emoji fields without HTML", () => {
    const note = `다음상태창을 본문하단에 출력해라

💡 NPC의 속마음 한 줄
📝 현재 상황을 짧게 요약
🔍 하고 싶은 것 1,  2, 3
✅ NPC의 낙서 한 줄(카오모지, 이모지 사용)`;
    const r = resolveUserNoteStatusWindowPolicy(note);
    assert.equal(r.everyTurn, true);
    assert.match(r.formatSpec ?? "", /속마음/);
    assert.match(r.formatSpec ?? "", /낙서/);
    assert.match(r.policyBlock, /FLASH-GENERATED \(BOTTOM\)/);
    assert.match(r.policyBlock, /background DeepSeek V3 model/);
    assert.doesNotMatch(r.policyBlock, /```json/);
    assert.doesNotMatch(r.formatSpec ?? "", /^\|/m);
  });

  it("matches exact user plain-line status note (no pipe table)", () => {
    const note = `다음 상태창을 본문하단에 출력 

NPC의 속마음 한 줄
현재 상황을 짧게 요약
하고 싶은 것 1,  2, 3
nPC의 낙서 한 줄(카오모지, 이모지 사용)`;
    const r = resolveUserNoteStatusWindowPolicy(note);
    assert.equal(r.everyTurn, true);
    assert.equal(r.placement, "bottom");
    assert.match(r.formatSpec ?? "", /NPC의 속마음 한 줄/);
    assert.match(r.formatSpec ?? "", /nPC의 낙서/);
    assert.doesNotMatch(r.formatSpec ?? "", /^\|/m);
    assert.equal(isPlainTextStatusFormatSpec(r.formatSpec!), true);
  });

  it("enables every-turn plain-text fields without emoji when status window intent is set", () => {
    const note = `다음상태창을 본문하단에 출력해라

NPC의 속마음 한 줄
현재 상황을 짧게 요약
하고 싶은 것 1,  2, 3
NPC의 낙서 한 줄(카오모지, 이모지 사용)`;
    const r = resolveUserNoteStatusWindowPolicy(note);
    assert.equal(r.everyTurn, true);
    assert.equal(r.placement, "bottom");
    assert.match(r.formatSpec ?? "", /속마음/);
    assert.doesNotMatch(r.formatSpec ?? "", /^\|/m);
  });

  it("every-turn plain status at top when note requests 본문상단", () => {
    const note = `다음 상태창을 본문상단에 출력

NPC의 속마음 한 줄
현재 상황을 짧게 요약
하고 싶은 것 1, 2, 3
NPC의 낙서 한 줄(카오모지, 이모지 사용)`;
    const r = resolveUserNoteStatusWindowPolicy(note);
    assert.equal(r.everyTurn, true);
    assert.equal(r.placement, "top");
    assert.match(r.policyBlock, /FLASH-GENERATED \(TOP\)/);
  });

  it("defers to HTML lorebook when HTML + status window requested together", () => {
    const note = `ooc:다음상태창을 본문하단에 HTML을 사용하여 표기할것
🕒00:00|🏠00
💡 NPC의 속마음 한 줄`;
    const r = resolveStatusWindowPolicyFromSources({ userNote: note });
    assert.equal(r.everyTurn, false);
    assert.equal(r.formatSpec, null);
    assert.equal(r.policyBlock, "");
  });

  it("uses default Flash plain policy when note has no status window", () => {
    const r = resolveUserNoteStatusWindowPolicy("NPC 이름은 철수. 매턴 존댓말.");
    assert.equal(r.everyTurn, false);
    assert.equal(r.outputFormat, "plain");
    assert.match(r.policyBlock, /SERVER HANDLED|background DeepSeek/);
  });

  it("respects deny OOC in note", () => {
    const r = resolveUserNoteStatusWindowPolicy("(OOC: 상태창 출력 금지)");
    assert.equal(r.everyTurn, false);
  });
});

describe("resolveStatusFormatSpecFromSources", () => {
  it("keeps pipe-table formatSpec when markdown+표형식 absent but template has pipe rows", () => {
    const note = `ooc:다음상태창을 본문하단에 표기할것
|💡 NPC의 속마음 한 줄|
|📝 현재 상황을 짧게 요약|`;
    const spec = resolveStatusFormatSpecFromSources({ userNote: note });
    assert.ok(spec);
    assert.match(spec!, /속마음/);
    assert.match(spec!, /^\|/m);
    assert.equal(isPlainTextStatusFormatSpec(spec!), false);
  });
});

describe("OOC status without HTML", () => {
  it("OOC plain status uses Flash StatusMeta extraction", () => {
    assert.equal(
      resolveStatusMetaExtractionEnabled({
        statusWindowEveryTurn: false,
        userMessage: "(OOC: 상태창 띄워줘)",
      }),
      true
    );
  });

  it("skips status meta when OOC requests HTML status", () => {
    assert.equal(
      resolveStatusMetaExtractionEnabled({
        statusWindowEveryTurn: false,
        userMessage: "(OOC: HTML로 상태창 띄워줘)",
      }),
      false
    );
  });

  it("provides formatSpec from note for OOC plain status", () => {
    const note = `다음상태창을 본문하단에 출력해라

💡 NPC의 속마음 한 줄
📝 현재 상황을 짧게 요약`;
    const r = resolveStatusWindowPolicyFromSources({
      userNote: note,
      userMessage: "(OOC: 상태창 띄워줘)",
    });
    assert.equal(r.everyTurn, true);
    assert.match(r.formatSpec ?? "", /속마음/);
  });
});

describe("stripRedundantStatusWindowFromSource", () => {
  it("removes promoted table and ooc from mandatory note when every-turn policy active", () => {
    const note = `ooc:다음상태창을 본문하단에 표기할것
|:---:|:---
|상태창||🕒00:00|🏠00|
|💡 NPC의 속마음 한 줄|
NPC 이름은 철수.`;
    const policy = resolveUserNoteStatusWindowPolicy(
      `다음상태창을 본문하단에 출력해라

💡 NPC의 속마음 한 줄
NPC 이름은 철수.`
    );
    assert.equal(policy.everyTurn, true);
    const stripped = stripRedundantStatusWindowFromSource(note, policy);
    assert.match(stripped, /NPC 이름은 철수/);
  });

  it("removes deny lines when default OOC-only policy", () => {
    const policy = resolveUserNoteStatusWindowPolicy("(OOC: 상태창 출력 금지)");
    assert.equal(policy.everyTurn, false);
    const stripped = stripRedundantStatusWindowFromSource(
      "NPC 철수.\n(OOC: 상태창 출력 금지)",
      policy
    );
    assert.match(stripped, /NPC 철수/);
    assert.doesNotMatch(stripped, /상태창 출력 금지/);
  });
});

describe("plain status field zones", () => {
  it("extracts plain field block when directive and fields are in separate note zones", () => {
    const directive = "다음 상태창을 본문하단에 출력";
    const fields = `NPC의 속마음 한 줄
현재 상황을 짧게 요약
하고 싶은 것 1,  2, 3
NPC의 낙서 한 줄(카오모지, 이모지 사용)`;
    const note = `${fields}\n\n${directive}`;
    const r = resolveStatusWindowPolicyFromSources({ userNote: note });
    assert.equal(r.everyTurn, true);
    assert.match(r.formatSpec ?? "", /속마음/);
    assert.doesNotMatch(r.formatSpec ?? "", /^\|/m);
  });
});

describe("extractPipeTableLines", () => {
  it("collects contiguous pipe rows", () => {
    const t = "intro\n| a | b |\n|:---:|:---:|\n| 1 | 2 |\nend";
    assert.equal(extractPipeTableLines(t), "| a | b |\n|:---:|:---:|\n| 1 | 2 |");
  });
});
