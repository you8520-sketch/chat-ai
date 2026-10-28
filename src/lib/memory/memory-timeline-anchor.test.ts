import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  extractBatchOpeningRegion,
  isTimelineAnchorCandidate,
  parseTimelineAnchorJson,
  verifyTimelineAnchors,
  formatTimelineAnchorLine,
  prependTimelineAnchorLine,
  buildTimelineAnchorExtractionMessages,
  TIMELINE_ANCHOR_LINE_MAX_CHARS,
} from "./memory-timeline-anchor";
import {
  __setSummarizeTurnBatchCallerForTests,
  __setTimelineAnchorCallerForTests,
  summarizeTurnBatch,
} from "./memory-rolling-summary";

const OPENING_ASSISTANT =
  "화약 냄새와 턱시도, 우스꽝스럽고도 광기 어렸던 프러포즈 소동은 요새의 건조한 공기 필터 속으로 흩어진 지 오래였다.\n\n대서양 데드존의 해상 시추선. 오즈의 위치와 밀그램의 EMP 테러 계획이라는 핵심 정보는 작전망을 완전히 뒤흔들었다.";
const OPENING_USER =
  "*OOC: 프로포즈소동은 한때의 기억으로 남기고 다시 데미안이 밀그램의 정보를 말한 이후의 상황을 이어간다*";
const DIALOGUE = `[81턴]\n유저: ${OPENING_USER}\nASSISTANT: ${OPENING_ASSISTANT}\n\n[82턴]\n유저: 다음\nASSISTANT: 이어지는 장면`;

beforeEach(() => {
  __setSummarizeTurnBatchCallerForTests(null);
  __setTimelineAnchorCallerForTests(null);
});

describe("timeline anchor opening region", () => {
  it("parses only the first turn block and keeps the leading paragraphs", () => {
    const region = extractBatchOpeningRegion(DIALOGUE);
    assert.ok(region);
    assert.equal(region!.paragraphs, 2);
    assert.ok(region!.assistantText.includes("프러포즈 소동"));
    assert.ok(!region!.assistantText.includes("이어지는 장면"));
  });

  it("returns null for a dialogue with no assistant text", () => {
    assert.equal(extractBatchOpeningRegion("[1턴]\n유저: 안녕"), null);
  });
});

describe("timeline anchor candidacy is general, not work-specific", () => {
  it("normal continuing progression is not a candidate", () => {
    const region = extractBatchOpeningRegion(
      "[3턴]\n유저: 문을 연다\nASSISTANT: 그는 고개를 끄덕이며 앞으로 걸어갔다."
    );
    assert.ok(region);
    assert.equal(isTimelineAnchorCandidate(region), false);
  });

  it("OOC in the opening user message is a candidate", () => {
    const region = extractBatchOpeningRegion(DIALOGUE);
    assert.equal(isTimelineAnchorCandidate(region), true);
  });

  it("retrospective leading narration without OOC is a candidate", () => {
    const region = extractBatchOpeningRegion(
      "[7턴]\n유저: 그날 이야기를 꺼낸다\nASSISTANT: 그날의 사건은 이미 흩어진 지 오래였다."
    );
    assert.equal(isTimelineAnchorCandidate(region), true);
  });
});

describe("timeline anchor parsing and grounding", () => {
  const valid = JSON.stringify({
    timelineAnchors: [
      {
        mode: "past_event_reference",
        label: "오스카의 공개 청혼",
        asOf: "past",
        sourceQuote: "우스꽝스럽고도 광기 어렸던 프러포즈 소동",
        resumePoint: "",
      },
      {
        mode: "resume_from_earlier_point",
        label: "밀그램 정보 공개 이후",
        asOf: "past",
        sourceQuote: "핵심 정보는 작전망을 완전히 뒤흔들었다",
        resumePoint: "밀그램 정보 공개 직후",
      },
    ],
  });

  it("parses plain and fenced JSON", () => {
    assert.equal(parseTimelineAnchorJson(valid)?.length, 2);
    assert.equal(parseTimelineAnchorJson("```json\n" + valid + "\n```")?.length, 2);
    assert.equal(parseTimelineAnchorJson("not json"), null);
  });

  it("keeps grounded anchors and drops fabricated, OOC, cancelled and new-episode items", () => {
    const items = parseTimelineAnchorJson(valid)!;
    items.push(
      {
        mode: "past_event_reference",
        label: "원문에 없는 사건",
        asOf: "past",
        sourceQuote: "이 문장은 원문에 없다",
        resumePoint: "",
      },
      {
        mode: "past_event_reference",
        label: "OOC 명령문",
        asOf: "past",
        sourceQuote: "프로포즈소동은 한때의 기억으로 남기고",
        resumePoint: "",
      },
      {
        mode: "new_episode",
        label: "새 에피소드",
        asOf: "past",
        sourceQuote: "프러포즈 소동",
        resumePoint: "",
      },
      {
        mode: "past_event_reference",
        label: "진행 중 사건",
        asOf: "present",
        sourceQuote: "프러포즈 소동",
        resumePoint: "",
      }
    );
    const region = extractBatchOpeningRegion(DIALOGUE)!;
    const anchors = verifyTimelineAnchors(items, region.assistantText);
    assert.equal(anchors.length, 2);
    assert.deepEqual(
      anchors.map((a) => a.mode),
      ["past_event_reference", "resume_from_earlier_point"]
    );
    assert.ok(anchors.every((a) => region.assistantText.includes(a.sourceQuote)));
  });

  it("drops a resume anchor without a resume point", () => {
    const region = extractBatchOpeningRegion(DIALOGUE)!;
    const anchors = verifyTimelineAnchors(
      [
        {
          mode: "resume_from_earlier_point",
          label: "복귀",
          asOf: "past",
          sourceQuote: "프러포즈 소동",
          resumePoint: "",
        },
      ],
      region.assistantText
    );
    assert.equal(anchors.length, 0);
  });
});

describe("timeline line formatting and budget", () => {
  const anchors = verifyTimelineAnchors(
    parseTimelineAnchorJson(
      JSON.stringify({
        timelineAnchors: [
          {
            mode: "past_event_reference",
            label: "오스카의 공개 청혼",
            asOf: "past",
            sourceQuote: "프러포즈 소동",
            resumePoint: "",
          },
          {
            mode: "resume_from_earlier_point",
            label: "밀그램 정보 공개 이후",
            asOf: "past",
            sourceQuote: "핵심 정보는 작전망을 완전히 뒤흔들었다",
            resumePoint: "밀그램 정보 공개 직후",
          },
        ],
      })
    )!,
    OPENING_ASSISTANT
  );

  it("renders past events and the resume point in one bounded line", () => {
    const line = formatTimelineAnchorLine(anchors);
    assert.ok(line.startsWith("[시간선] 과거: 오스카의 공개 청혼"));
    assert.ok(line.includes("재개 지점: 밀그램 정보 공개 직후"));
    assert.ok(line.length <= TIMELINE_ANCHOR_LINE_MAX_CHARS);
  });

  it("prepends the line and stays within the summary budget", () => {
    const summary = "데미안이 정보를 넘겼다. ".repeat(40);
    const out = prependTimelineAnchorLine(summary, anchors, 600);
    assert.ok(out.startsWith("[시간선]"));
    assert.ok(out.length <= 600, `length=${out.length}`);
  });

  it("returns the summary byte-identical when there is no anchor", () => {
    const summary = "그는 문을 닫았다. ".repeat(10);
    assert.equal(prependTimelineAnchorLine(summary, [], 600), summary);
  });

  it("does not duplicate an anchor the summary already states", () => {
    const summary =
      "오스카의 공개 청혼은 이미 과거 사건이며, 데미안이 정보를 넘긴 뒤 두 사람은 작전을 준비한다. ".repeat(3);
    const out = prependTimelineAnchorLine(summary, anchors, 600);
    assert.ok(!out.includes("[시간선] 과거: 오스카의 공개 청혼"));
  });

  it("never trades the summary itself for an anchor", () => {
    const summary = "짧은 요약.".repeat(30);
    const tight = prependTimelineAnchorLine(summary, anchors, 110);
    assert.equal(tight, summary);
    const fits = prependTimelineAnchorLine(summary, anchors, 130);
    assert.ok(fits.length <= 130);
    assert.equal(prependTimelineAnchorLine(summary, anchors, 600).length <= 600, true);
  });
});

describe("summarizeTurnBatch timeline anchor integration", () => {
  const SUMMARY_TEXT =
    "데미안이 밀그램의 정보를 넘기자 제이가 그를 개인실로 불렀고, 두 형제는 애쉬폴 작전에 합류한다. 이후 오스카는 팬 커뮤니티에서 주접 배틀을 벌였다.";

  it("prepends a verified anchor through the canonical owner", async () => {
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: SUMMARY_TEXT }));
    __setTimelineAnchorCallerForTests(async (system, user) => {
      assert.ok(system.includes("시간선 앵커 추출"));
      assert.ok(user.includes(OPENING_ASSISTANT.split("\n\n")[0]!));
      return JSON.stringify({
        timelineAnchors: [
          {
            mode: "past_event_reference",
            label: "오스카의 공개 청혼",
            asOf: "past",
            sourceQuote: "프러포즈 소동",
            resumePoint: "",
          },
          {
            mode: "resume_from_earlier_point",
            label: "밀그램 정보 공개 이후",
            asOf: "past",
            sourceQuote: "핵심 정보는 작전망을 완전히 뒤흔들었다",
            resumePoint: "밀그램 정보 공개 직후",
          },
        ],
      });
    });
    const out = await summarizeTurnBatch({
      dialogue: DIALOGUE,
      charName: "ASSISTANT",
      startTurn: 81,
      endTurn: 85,
    });
    assert.ok(out.startsWith("[시간선] 과거: 오스카의 공개 청혼"), out);
    assert.ok(out.includes("재개 지점: 밀그램 정보 공개 직후"), out);
    assert.ok(out.includes("데미안이 밀그램의 정보를 넘기자"), out);
    assert.ok(out.length <= 600);
  });

  it("keeps the summary unchanged when the extractor fails or returns empty", async () => {
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: SUMMARY_TEXT }));
    __setTimelineAnchorCallerForTests(async () => {
      throw new Error("provider down");
    });
    const failed = await summarizeTurnBatch({
      dialogue: DIALOGUE,
      charName: "ASSISTANT",
      startTurn: 81,
      endTurn: 85,
    });
    __setTimelineAnchorCallerForTests(async () => JSON.stringify({ timelineAnchors: [] }));
    const empty = await summarizeTurnBatch({
      dialogue: DIALOGUE,
      charName: "ASSISTANT",
      startTurn: 81,
      endTurn: 85,
    });
    __setTimelineAnchorCallerForTests(null);
    const noAnchors = await summarizeTurnBatch({
      dialogue: DIALOGUE,
      charName: "ASSISTANT",
      startTurn: 81,
      endTurn: 85,
    });
    assert.equal(failed, noAnchors);
    assert.equal(empty, noAnchors);
    assert.ok(!failed.includes("[시간선]"));
  });

  it("never calls the extractor for a non-candidate batch", async () => {
    let calls = 0;
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: SUMMARY_TEXT }));
    __setTimelineAnchorCallerForTests(async () => {
      calls += 1;
      return JSON.stringify({ timelineAnchors: [] });
    });
    const out = await summarizeTurnBatch({
      dialogue:
        "[1턴]\n유저: 문을 연다\nASSISTANT: 그는 고개를 끄덕이며 앞으로 걸어갔다.\n\n[2턴]\n유저: 다음\nASSISTANT: 계속 걷는다",
      charName: "ASSISTANT",
      startTurn: 1,
      endTurn: 5,
    });
    assert.equal(calls, 0);
    assert.equal(out, SUMMARY_TEXT.replace(/\s+/g, " ").trim());
  });

  it("extraction messages never ask to store OOC text as canon", () => {
    const region = extractBatchOpeningRegion(DIALOGUE)!;
    const { system, user } = buildTimelineAnchorExtractionMessages(region);
    assert.ok(system.includes("OOC 명령문 자체를 사건으로 저장하지 않는다"));
    assert.ok(system.includes("ASSISTANT 원문에서 문자 그대로 복사"));
    assert.ok(user.includes("OOC는 판단 근거이며 저장 대상이 아님"));
  });
});
