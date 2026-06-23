import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFilledTableMarkdown,
  mergeTemplateRow,
  normalizeTemplateFilledRows,
  parseFormatSpecStructure,
  stripLabelPrefixFromValue,
  tableMarkdownHasContent,
} from "@/lib/statusMeta/formatSpec";
import { parseMarkdownPipeTable } from "@/lib/chatRichContent";
import { userMessageRequestsStatusWindowOoc } from "@/lib/statusMeta/ooc";
import {
  buildStatusMetaExtractSystemForTest,
  buildStatusMetaExtractUserBlockForTest,
  EXTRACT_ACTIVE_TIME_LOCATION_RULES,
  EXTRACT_TIMEKEEPER_RULE,
} from "@/lib/statusMeta/extract";
import {
  extractTimeLocationAnchors,
  formatPreviousTurnStatusContext,
} from "@/lib/statusMeta/previousStatusContext";
import { renderStatusMetaMarkdown, statusMetaDisplayMarkdown } from "@/lib/statusMeta/render";
import { stripAllStatusWindowOutputArtifacts, partitionModelStatusArtifacts, ensurePlainStatusBlockLayout, partitionPlainStatusBlockForDisplay, finalizePlainStatusSavedText, stripPlainStatusFromProse } from "@/lib/statusMeta/stripArtifacts";
import { hasVisibleStatusMeta, normalizeStatusMeta } from "@/lib/statusMeta/types";

const USER_FORMAT_SPEC = `|:---:|:---
|상태창||🕒00:00|🏠00|
|💡 NPC의 속마음 한 줄|
|📝 현재 상황을 짧게 요약|
|🔍 하고 싶은 것 1,  2,  3|
|✅ NPC의 낙서 한 줄(카오모지, 이모지 사용)|`;

describe("formatSpec structure", () => {
  it("parses user pipe table into data row templates", () => {
    const structure = parseFormatSpecStructure(USER_FORMAT_SPEC);
    assert.equal(structure.dataRowTemplates.length, 5);
    assert.deepEqual(structure.dataRowTemplates[0], ["상태창", "", "🕒00:00", "🏠00"]);
    assert.match(structure.dataRowTemplates[1]![0]!, /속마음/);
  });

  it("builds filled markdown preserving separator and labels", () => {
    const structure = parseFormatSpecStructure(USER_FORMAT_SPEC);
    const filled = normalizeTemplateFilledRows(structure, [
      ["상태창", "", "🕒 오전 09:55", "🏠 W.W 요새"],
      ["💡 NPC의 속마음 한 줄", "다시 나를 봐줘."],
      ["📝 현재 상황을 짧게 요약", "요새 안, 긴장된 분위기"],
      ["🔍 하고 싶은 것 1,  2,  3", "도망 · 숨기기 · 버티기"],
      ["✅ NPC의 낙서 한 줄(카오모지, 이모지 사용)", "(´；ω；`)"],
    ]);
    const md = buildFilledTableMarkdown(structure, filled);
    assert.match(md, /^\|:---/m);
    assert.match(md, /🕒 오전 09:55/);
    assert.match(md, /다시 나를 봐줘/);
    assert.match(md, /도망 · 숨기기 · 버티기/);
    assert.doesNotMatch(md, /NPC 목표/);
  });

  it("injects GFM separator when label-only pipe rows have no separator (plain→pipe conversion)", () => {
    const formatSpec = [
      "| 🕒00:00 ,🏠00 |",
      "| NPC의 속마음 한 줄 |",
      "| 현재 상황을 짧게 요약 |",
    ].join("\n");
    const structure = parseFormatSpecStructure(formatSpec);
    const filled = normalizeTemplateFilledRows(structure, [
      ["🕒 14:30 / 🏠 거실"],
      ["NPC의 속마음 한 줄", "속마음"],
      ["현재 상황을 짧게 요약", "요약"],
    ]);
    const md = buildFilledTableMarkdown(structure, filled);
    assert.match(md, /^\|\s*:---/m);
    assert.ok(parseMarkdownPipeTable(md));
  });

  it("mergeTemplateRow keeps label when value empty", () => {
    assert.deepEqual(
      mergeTemplateRow(["💡 NPC의 속마음 한 줄"], []),
      ["💡 NPC의 속마음 한 줄"]
    );
  });

  it("mergeTemplateRow joins multi-slot values into one cell", () => {
    const label = "🔍 하고 싶은 것 1,  2,  3";
    assert.deepEqual(
      mergeTemplateRow(
        [label],
        [label, "렌에게 안기기", "체온조절 안정화", "S-기어 안정화"]
      ),
      [label, "렌에게 안기기 · 체온조절 안정화 · S-기어 안정화"]
    );
  });

  it("mergeTemplateRow drops label echo in value column", () => {
    const label = "🔍 하고 싶은 것 1,  2,  3";
    assert.deepEqual(mergeTemplateRow([label], [label, label]), [label]);
    assert.deepEqual(
      mergeTemplateRow([label], [label, label, "렌에게 안기기"]),
      [label, "렌에게 안기기"]
    );
  });

  it("mergeTemplateRow strips label prefix from single combined value cell", () => {
    const label = "🔍 하고 싶은 것 1,  2,  3";
    assert.deepEqual(
      mergeTemplateRow(
        [label],
        [
          `${label} · 렌의 손 잡고 있기 · 렌의 향기 맡기 · 렌과 함께 집으로 가기`,
        ]
      ),
      [label, "렌의 손 잡고 있기 · 렌의 향기 맡기 · 렌과 함께 집으로 가기"]
    );
  });

  it("stripLabelPrefixFromValue removes label · prefix only", () => {
    const label = "🔍 하고 싶은 것 1,  2,  3";
    assert.equal(
      stripLabelPrefixFromValue(label, `${label} · 렌의 손 잡고 있기`),
      "렌의 손 잡고 있기"
    );
    assert.equal(stripLabelPrefixFromValue(label, label), "");
  });
});

describe("statusMeta extract prompts", () => {
  const USER_FORMAT = `|:---:|:---
|상태창||🕒00:00|🏠00|
|💡 NPC의 속마음 한 줄|`;

  it("legacy system prompt includes TIMEKEEPER RULE block", () => {
    const system = buildStatusMetaExtractSystemForTest({});
    assert.match(system, /\[TIMEKEEPER RULE: NARRATIVE TIME PROGRESSION\]/);
    assert.match(system, /You are the Timekeeper of this roleplay/i);
    assert.match(system, /Brief dialogue or quick actions/i);
    assert.match(system, /Previous Turn Status Meta/i);
    assert.ok(system.includes(EXTRACT_TIMEKEEPER_RULE));
  });

  it("legacy system prompt requires active time/location deduction", () => {
    const system = buildStatusMetaExtractSystemForTest({});
    assert.match(system, /Active time\/location deduction/i);
    assert.match(system, /OOC \/ template trigger recognition/i);
    assert.match(system, /NEVER leave datetime, location/i);
  });

  it("template system prompt requires filling 🕒/🏠 placeholders", () => {
    const system = buildStatusMetaExtractSystemForTest({ formatSpec: USER_FORMAT });
    assert.match(system, /🕒\/🏠/);
    assert.match(system, /never 00:00, empty, or "Unknown"/i);
    assert.ok(system.includes(EXTRACT_TIMEKEEPER_RULE.slice(0, 30)));
  });

  it("plain-text emoji formatSpec uses plain prose extract system", () => {
    const plainSpec = `💡 NPC의 속마음 한 줄
📝 현재 상황을 짧게 요약
🔍 하고 싶은 것 1,  2, 3
✅ NPC의 낙서 한 줄(카오모지, 이모지 사용)`;
    const system = buildStatusMetaExtractSystemForTest({ formatSpec: plainSpec });
    assert.match(system, /plain-text status window/i);
    assert.match(system, /NO pipe tables/i);
    assert.match(system, /NO HTML/i);
    assert.doesNotMatch(system, /pipe-table from RP/i);
  });

  it("user block flags OOC time/place trigger from formatSpec", () => {
    const block = buildStatusMetaExtractUserBlockForTest({
      chatId: 1,
      charName: "NPC",
      personaName: "User",
      userMessage: "계속해",
      assistantProse: "그는 문을 열었다.",
      formatSpec: USER_FORMAT,
    });
    assert.match(block, /OOC TIME\/PLACE TRIGGER DETECTED/);
    assert.match(block, /TIMEKEEPER RULE/);
  });

  it("user block always includes PREVIOUS TURN STATUS META section", () => {
    const block = buildStatusMetaExtractUserBlockForTest({
      chatId: 1,
      charName: "NPC",
      personaName: "User",
      userMessage: "계속해",
      assistantProse: "그는 문을 열었다.",
      previousMeta: {
        tableMarkdown: `|:---:|:---|
| 상태창 |  | 🕒 오후 2:00 | 🏠 거실 |`,
      },
    });
    assert.match(block, /\[PREVIOUS TURN STATUS META\]/);
    assert.match(block, /STARTING CLOCK/);
    assert.match(block, /오후 2:00/);
    assert.match(block, /ASSISTANT REPLY — prose only/);
  });
});

describe("previousStatusContext", () => {
  it("extractTimeLocationAnchors reads clock from tableMarkdown", () => {
    const anchors = extractTimeLocationAnchors({
      tableMarkdown: "| 상태 | 🕒 14:30 | 🏠 카페 |",
    });
    assert.equal(anchors.datetime, "14:30");
    assert.equal(anchors.location, "카페");
  });

  it("formatPreviousTurnStatusContext handles first turn", () => {
    const text = formatPreviousTurnStatusContext(null);
    assert.match(text, /first status window/i);
  });
});

describe("statusMeta stripArtifacts", () => {
  it("removes trailing json fence", () => {
    const input = "RP 본문입니다.\n\n```json\n{\"시간\":\"09:00\"}\n```";
    assert.equal(stripAllStatusWindowOutputArtifacts(input), "RP 본문입니다.");
  });

  it("removes status markdown table", () => {
    const input = "RP\n\n| 항목 | 내용 |\n|:---:|:---:|\n| 시간 | 09:00 |";
    assert.equal(stripAllStatusWindowOutputArtifacts(input), "RP");
  });

  it("removes status table glued to prose without line break", () => {
    const input = "RP 본문입니다.| 항목 | 내용 |\n|:---:|:---:|\n| 시간 | 09:00 |";
    assert.equal(stripAllStatusWindowOutputArtifacts(input), "RP 본문입니다.");
  });

  it("removes trailing ```html from model output", () => {
    const input = "RP 본문입니다.\n\n```html\n<div>상태</div>\n```";
    assert.equal(stripAllStatusWindowOutputArtifacts(input), "RP 본문입니다.");
  });

  it("layout separates glued plain status and moves block to bottom", () => {
    const formatSpec = `NPC의 속마음 한 줄
현재 상황을 짧게 요약`;
    const input = `그는 창밖을 바라보았다.NPC의 속마음 한 줄 : test
중간 지문
NPC의 속마음 한 줄 : 다시
현재 상황을 짧게 요약 : 새벽`;
    const out = ensurePlainStatusBlockLayout(input, formatSpec, "bottom");
    assert.match(out, /그는 창밖을 바라보았다\.\n중간 지문\n\nNPC의 속마음/);
    assert.doesNotMatch(out, /바라보았다\.NPC/);
  });

  it("layout moves plain status block to top when requested", () => {
    const formatSpec = `NPC의 속마음 한 줄
현재 상황을 짧게 요약`;
    const input = `중간 지문
NPC의 속마음 한 줄 : 다시
현재 상황을 짧게 요약 : 새벽`;
    const out = ensurePlainStatusBlockLayout(input, formatSpec, "top");
    assert.match(out, /^NPC의 속마음 한 줄 : 다시\n현재 상황을 짧게 요약 : 새벽\n\n중간 지문/);
  });

  it("recognizes em-dash status lines and detaches glued suffix", () => {
    const formatSpec = `NPC의 속마음 한 줄
현재 상황을 짧게 요약`;
    const input = `그는 멈췄다.NPC의 속마음 한 줄 — 조용히
현재 상황을 짧게 요약 — 새벽`;
    const split = partitionPlainStatusBlockForDisplay(input, formatSpec, "bottom");
    assert.equal(split.prose, "그는 멈췄다.");
    assert.match(split.statusBlock ?? "", /속마음/);
    assert.match(split.statusBlock ?? "", /새벽/);
  });

  it("partitionPlainStatusBlockForDisplay splits prose and status card body", () => {
    const formatSpec = `NPC의 속마음 한 줄
현재 상황을 짧게 요약`;
    const input = `RP 본문입니다.\n\nNPC의 속마음 한 줄 : test\n현재 상황을 짧게 요약 : dawn`;
    const split = partitionPlainStatusBlockForDisplay(input, formatSpec, "bottom");
    assert.equal(split.prose, "RP 본문입니다.");
    assert.match(split.statusBlock ?? "", /test/);
  });

  it("pulls bullet-prefixed and bold status lines from bottom", () => {
    const formatSpec = `NPC의 속마음 한 줄
현재 상황을 짧게 요약
하고 싶은 것 1, 2, 3
NPC의 낙서 한 줄(카오모지, 이모지 사용)`;
    const input = `RP 본문입니다.

- **NPC의 속마음 한 줄** : 조용히
• 현재 상황을 짧게 요약 — 새벽
1. 하고 싶은 것 1, 2, 3 : 잠, 산책
NPC의 낙서 한 줄 : (｡･ω･｡)`;
    const split = partitionPlainStatusBlockForDisplay(input, formatSpec, "bottom");
    assert.equal(split.prose, "RP 본문입니다.");
    assert.match(split.statusBlock ?? "", /조용히/);
    assert.match(split.statusBlock ?? "", /새벽/);
    assert.match(split.statusBlock ?? "", /산책/);
    assert.match(split.statusBlock ?? "", /낙서/);
  });

  it("finalizePlainStatusSavedText recovers status stripped by prose-only continuation", () => {
    const formatSpec = `NPC의 속마음 한 줄
현재 상황을 짧게 요약`;
    const withStatus = `RP 본문입니다.\n\nNPC의 속마음 한 줄 : test\n현재 상황을 짧게 요약 : dawn`;
    const proseOnly = "RP 본문입니다.\n\n추가로 이어진 지문입니다.";
    const out = finalizePlainStatusSavedText(proseOnly, formatSpec, "bottom", [withStatus]);
    assert.match(out, /RP 본문/);
    assert.match(out, /추가로 이어진/);
    assert.match(out, /NPC의 속마음/);
    assert.match(out, /test/);
    assert.ok(out.indexOf("추가로") < out.indexOf("NPC의"));
  });

  it("relocateMisplacedStatus moves top status lines to bottom card split", () => {
    const formatSpec = `NPC의 속마음 한 줄
현재 상황을 짧게 요약`;
    const input = `NPC의 속마음 한 줄 : first\n현재 상황을 짧게 요약 : dawn\n\nRP 본문입니다.`;
    const split = partitionPlainStatusBlockForDisplay(input, formatSpec, "bottom");
    assert.equal(split.prose, "RP 본문입니다.");
    assert.match(split.statusBlock ?? "", /first/);
  });

  it("splits multiple status fields glued on one line", () => {
    const formatSpec = `NPC의 속마음 한 줄
현재 상황을 짧게 요약`;
    const input = `RP.\n\nNPC의 속마음 한 줄 : a 현재 상황을 짧게 요약 : b`;
    const split = partitionPlainStatusBlockForDisplay(input, formatSpec, "bottom");
    assert.equal(split.prose, "RP.");
    assert.match(split.statusBlock ?? "", /속마음/);
    assert.match(split.statusBlock ?? "", /상황/);
  });

  it("stripPlainStatusFromProse removes model plain status for Flash path", () => {
    const formatSpec = `NPC의 속마음 한 줄
현재 상황을 짧게 요약`;
    const input = `RP 본문입니다.\n\nNPC의 속마음 한 줄 : test\n현재 상황을 짧게 요약 : dawn`;
    assert.equal(stripPlainStatusFromProse(input, formatSpec, "bottom"), "RP 본문입니다.");
  });

  it("partitionModelStatusArtifacts captures table and html before strip", () => {
    const input =
      "RP 본문입니다.\n\n| 항목 | 내용 |\n|:---:|:---:|\n| 시간 | 09:00 |\n\n```html\n<div>상태</div>\n```";
    const split = partitionModelStatusArtifacts(input);
    assert.equal(split.prose, "RP 본문입니다.");
    assert.match(split.capturedTableMarkdown ?? "", /시간/);
    assert.match(split.capturedHtmlFence ?? "", /```html/);
  });

  it("partitionModelStatusArtifacts captures status widget values before JSON strip", () => {
    const input = `RP 본문입니다.

<<<STATUS_VALUES char>>>
{"시간":"21:30","장소":"거실","속마음":"불안했다","현재상황":"대화 중"}
<<<END_STATUS>>>`;
    const split = partitionModelStatusArtifacts(input);
    assert.equal(split.prose, "RP 본문입니다.");
    assert.equal(split.capturedStatusWidgetValues?.character?.["시간"], "21:30");
    assert.equal(split.capturedStatusWidgetValues?.character?.["속마음"], "불안했다");
  });

});

describe("statusMeta ooc", () => {
  it("detects plain OOC status request without HTML", () => {
    assert.equal(userMessageRequestsStatusWindowOoc("(OOC: 상태창 띄워줘)"), true);
  });

  it("detects HTML + status OOC request", () => {
    assert.equal(userMessageRequestsStatusWindowOoc("(OOC: HTML로 상태창 띄워줘)"), true);
  });

  it("ignores normal RP without status request", () => {
    assert.equal(userMessageRequestsStatusWindowOoc("안녕, 계속 이야기해줘"), false);
  });
});

describe("statusMeta types", () => {
  it("normalizeStatusMeta trims strings", () => {
    const meta = normalizeStatusMeta({ datetime: " 09:00 ", location: 123 });
    assert.equal(meta.datetime, "09:00");
    assert.equal(meta.location, "123");
  });

  it("hasVisibleStatusMeta true for tableMarkdown", () => {
    assert.equal(hasVisibleStatusMeta({ tableMarkdown: "| a | b |" }), true);
  });

  it("hasVisibleStatusMeta false for empty", () => {
    assert.equal(hasVisibleStatusMeta(normalizeStatusMeta({})), false);
  });
});

describe("renderStatusMetaMarkdown", () => {
  it("returns tableMarkdown when present", () => {
    const table = "| 💡 | thought |\n|:---:|:---:|\n| 💡 | hi |";
    assert.equal(renderStatusMetaMarkdown({ tableMarkdown: table }), table);
  });

  it("renders legacy filled sections without formatSpec", () => {
    const md = renderStatusMetaMarkdown({
      datetime: "오전 09:55",
      location: "W.W 요새",
      npcEmotion: "불안",
      hiddenThought: "다시 나를 봐줘.",
    });
    assert.match(md, /오전 09:55/);
    assert.match(md, /불안/);
    assert.match(md, /다시 나를 봐줘/);
  });

  it("statusMetaDisplayMarkdown uses template table content", () => {
    const structure = parseFormatSpecStructure(USER_FORMAT_SPEC);
    const filled = normalizeTemplateFilledRows(structure, [
      ["상태창", "", "🕒 10:00", "🏠 집"],
      ["💡 NPC의 속마음 한 줄", "속마음"],
      ["📝 현재 상황을 짧게 요약", "요약"],
      ["🔍 하고 싶은 것 1,  2,  3", "1, 2, 3"],
      ["✅ NPC의 낙서 한 줄(카오모지, 이모지 사용)", "^^"],
    ]);
    const tableMarkdown = buildFilledTableMarkdown(structure, filled);
    const md = statusMetaDisplayMarkdown({ tableMarkdown }, USER_FORMAT_SPEC);
    assert.ok(md);
    assert.match(md!, /속마음/);
    assert.ok(tableMarkdownHasContent(md!));
  });
});
