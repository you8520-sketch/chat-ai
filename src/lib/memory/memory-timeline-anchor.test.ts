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
  selectTimelineAnchorRegions,
  TIMELINE_ANCHOR_LINE_MAX_CHARS,
  TIMELINE_ANCHOR_MAX_CALLS,
} from "./memory-timeline-anchor";
import {
  __setSummarizeTurnBatchCallerForTests,
  __setTimelineAnchorCallerForTests,
  summarizeTurnBatch,
} from "./memory-rolling-summary";

const OPENING_ASSISTANT =
  "화약 냄새와 턱시도, 우스꽝스럽고도 광기 어렸던 프러포즈 소동은 요새의 건조한 공기 필터 속으로 흩어진 지 오래였다. 수류탄 핀 반지만 잔재로 남았다.\n\n대서양 데드존의 해상 시추선. 오즈의 위치와 밀그램의 EMP 테러 계획이라는 핵심 정보는 작전망을 완전히 뒤흔들었다.";
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
        label: "프러포즈 소동",
        asOf: "past",
        sourceQuote: "프러포즈 소동은 요새의 건조한 공기 필터 속으로 흩어진",
        resumePoint: "",
      },
      {
        mode: "resume_from_earlier_point",
        label: "핵심 정보",
        asOf: "past",
        sourceQuote: "핵심 정보는 작전망을 완전히 뒤흔들었다",
        resumePoint: "밀그램의 핵심 정보",
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
            label: "프러포즈 소동",
            asOf: "past",
            sourceQuote: "프러포즈 소동은 요새의 건조한 공기 필터 속으로 흩어진",
            resumePoint: "",
          },
          {
            mode: "resume_from_earlier_point",
            label: "핵심 정보",
            asOf: "past",
            sourceQuote: "핵심 정보는 작전망을 완전히 뒤흔들었다",
            resumePoint: "밀그램의 핵심 정보",
          },
        ],
      })
    )!,
    OPENING_ASSISTANT
  );

  it("renders past events and the resume point in one bounded line", () => {
    const line = formatTimelineAnchorLine(anchors);
    assert.ok(line.startsWith("[시간선] 과거: 프러포즈 소동"));
    assert.ok(line.includes("재개 지점: 밀그램의 핵심 정보"));
    assert.ok(line.length <= TIMELINE_ANCHOR_LINE_MAX_CHARS);
  });

  it("keeps the whole summary when the anchor fits, and omits the anchor when it does not", () => {
    const line = formatTimelineAnchorLine(anchors);
    assert.ok(line.length > 30, `line=${line.length}`);
    const tail = "펫캠후속";
    const textOf = (length: number) => {
      const unit = "애쉬폴 작전과 팬 커뮤니티가 이어졌다. ";
      let body = "";
      while (body.length + tail.length < length) body += unit;
      return body.slice(0, length - tail.length) + tail;
    };
    const fitted = textOf(454);
    const withAnchor = prependTimelineAnchorLine(fitted, anchors, 600);
    assert.ok(withAnchor.startsWith(`${line} `), withAnchor.slice(0, 80));
    assert.ok(withAnchor.endsWith(fitted));
    assert.equal(withAnchor.length, line.length + 1 + fitted.length);
    assert.ok(withAnchor.length <= 600);
    for (const length of [570, 590, 600]) {
      const summary = textOf(length);
      assert.equal(summary.length, length);
      assert.equal(prependTimelineAnchorLine(summary, anchors, 600), summary);
      assert.ok(summary.endsWith(tail));
    }
  });

  it("returns the summary byte-identical when there is no anchor", () => {
    const summary = "그는 문을 닫았다. ".repeat(10);
    assert.equal(prependTimelineAnchorLine(summary, [], 600), summary);
  });

  it("does not duplicate an anchor the summary already states", () => {
    const summary =
      "프러포즈 소동은 이미 과거 사건이며, 밀그램의 핵심 정보 이후 두 사람은 작전을 준비한다. ".repeat(3);
    const out = prependTimelineAnchorLine(summary, anchors, 600);
    assert.equal(out, summary);
  });

  it("never shortens the summary to make room for an anchor", () => {
    const summary = "짧은 요약.".repeat(30);
    assert.equal(prependTimelineAnchorLine(summary, anchors, 110), summary);
    assert.equal(prependTimelineAnchorLine(summary, anchors, 130), summary);
    const wide = prependTimelineAnchorLine(summary, anchors, 600);
    assert.ok(wide.endsWith(summary));
    assert.ok(wide.length <= 600);
  });
});

describe("timeline anchor meaning is rejected, not repaired", () => {
  const assistant = OPENING_ASSISTANT;

  it("rejects a label the quote does not support", () => {
    const anchors = verifyTimelineAnchors(
      [
        {
          mode: "past_event_reference",
          label: "법적 혼인",
          asOf: "past",
          sourceQuote: "프러포즈 소동은 요새의 건조한 공기 필터 속으로 흩어진",
          resumePoint: "",
        },
      ],
      assistant
    );
    assert.equal(anchors.length, 0);
  });

  it("rejects a grounded quote paired with an unsupported resume point", () => {
    const anchors = verifyTimelineAnchors(
      [
        {
          mode: "resume_from_earlier_point",
          label: "핵심 정보",
          asOf: "past",
          sourceQuote: "핵심 정보는 작전망을 완전히 뒤흔들었다",
          resumePoint: "왕궁 결혼식",
        },
      ],
      assistant
    );
    assert.equal(anchors.length, 0);
  });

  it("rejects an unrealized user return that the assistant never performs", () => {
    const anchors = verifyTimelineAnchors(
      [
        {
          mode: "resume_from_earlier_point",
          label: "왕궁 귀환",
          asOf: "past",
          sourceQuote: "핵심 정보는 작전망을 완전히 뒤흔들었다",
          resumePoint: "왕궁으로 귀환",
        },
      ],
      assistant
    );
    assert.equal(anchors.length, 0);
  });

  it("rejects a recollection quoted as if the story returned there", () => {
    const recalled = "그는 지난 프러포즈 소동을 떠올렸다. 창밖을 바라보았다.";
    const anchors = verifyTimelineAnchors(
      [
        {
          mode: "resume_from_earlier_point",
          label: "프러포즈 소동",
          asOf: "past",
          sourceQuote: "프러포즈 소동을 떠올렸다",
          resumePoint: "프러포즈 소동",
        },
      ],
      recalled
    );
    assert.equal(anchors.length, 0);
  });

  it("rejects a cancellation classified as a past-event reference", () => {
    const cancelled = "그 청혼은 없던 일이 되었다. 두 사람은 작전에 남았다.";
    const anchors = verifyTimelineAnchors(
      [
        {
          mode: "past_event_reference",
          label: "없던 일",
          asOf: "past",
          sourceQuote: "청혼은 없던 일이 되었다",
          resumePoint: "",
        },
      ],
      cancelled
    );
    assert.equal(anchors.length, 0);
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
            label: "프러포즈 소동",
            asOf: "past",
            sourceQuote: "프러포즈 소동은 요새의 건조한 공기 필터 속으로 흩어진",
            resumePoint: "",
          },
          {
            mode: "resume_from_earlier_point",
            label: "핵심 정보",
            asOf: "past",
            sourceQuote: "핵심 정보는 작전망을 완전히 뒤흔들었다",
            resumePoint: "밀그램의 핵심 정보",
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
    assert.ok(out.startsWith("[시간선] 과거: 프러포즈 소동"), out);
    assert.ok(out.includes("재개 지점: 밀그램의 핵심 정보"), out);
    assert.ok(out.includes(SUMMARY_TEXT), out);
    assert.ok(out.includes("팬 커뮤니티에서 주접 배틀을 벌였다."), out);
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

describe("timeline anchor candidate turns inside a batch", () => {
  const walk = "그는 고개를 끄덕이며 앞으로 걸어갔다.";
  const block = (turn: number, user: string, assistant: string) =>
    `[${turn}턴]\n유저: ${user}\nASSISTANT: ${assistant}`;

  function batchWithReturnAt(turn: number): string {
    return [1, 2, 3, 4, 5]
      .map((n) =>
        n === turn
          ? block(n, OPENING_USER, OPENING_ASSISTANT)
          : block(n, "다음", walk)
      )
      .join("\n\n");
  }

  async function countCalls(dialogue: string): Promise<{ calls: number; seen: string }> {
    let calls = 0;
    let seen = "";
    __setSummarizeTurnBatchCallerForTests(async () => ({
      text: "데미안이 밀그램의 정보를 넘기자 제이가 그를 개인실로 불렀고, 두 형제는 애쉬폴 작전에 합류한다. 이후 오스카는 팬 커뮤니티에서 주접 배틀을 벌였다.",
    }));
    __setTimelineAnchorCallerForTests(async (_system, user) => {
      calls += 1;
      seen = user;
      return JSON.stringify({ timelineAnchors: [] });
    });
    await summarizeTurnBatch({
      dialogue,
      charName: "ASSISTANT",
      startTurn: 81,
      endTurn: 85,
    });
    return { calls, seen };
  }

  it("finds a return on the first, second, or fourth turn with one call", async () => {
    for (const turn of [1, 2, 4]) {
      const { calls, seen } = await countCalls(batchWithReturnAt(turn));
      assert.equal(calls, TIMELINE_ANCHOR_MAX_CALLS, `turn ${turn}`);
      assert.ok(seen.includes("프러포즈 소동"), `turn ${turn}`);
      assert.equal(selectTimelineAnchorRegions(batchWithReturnAt(turn)).length, 1);
    }
  });

  it("packs two candidate turns into the single call budget", async () => {
    const dialogue = [
      block(1, "다음", walk),
      block(2, OPENING_USER, OPENING_ASSISTANT),
      block(3, "다음", walk),
      block(4, "*OOC: 그 전투는 이미 있었던 일이다*", "그 전투는 이미 있었던 일이며 흩어진 지 오래였다."),
      block(5, "다음", walk),
    ].join("\n\n");
    const { calls, seen } = await countCalls(dialogue);
    assert.equal(calls, 1);
    assert.equal(TIMELINE_ANCHOR_MAX_CALLS, 1);
    assert.ok(seen.includes("프러포즈 소동"));
    assert.ok(seen.includes("그 전투는 이미 있었던 일"));
    assert.equal(selectTimelineAnchorRegions(dialogue).length, 2);
  });

  it("does not call for style OOC, a new episode, an IF close, or a cancellation", async () => {
    const cases = [
      block(1, "(OOC: 문체를 더 짧게 써줘)", "그는 짧게 고개를 끄덕였다."),
      block(
        1,
        "[OOC: 현재 에피소드 중단. 새 에피소드 시작. 축제에서 선물을 건네는 장면을 서술해.]",
        "예전에 걷던 축제 길이 다시 열렸다."
      ),
      block(1, "(OOC: 본편으로 돌아가자. IF 종료.)", "본편으로 돌아왔다."),
      block(1, "(OOC: 그 사건은 없던 일로 취소해.)", "소동은 흩어진 지 오래였다."),
    ];
    for (const dialogue of cases) {
      const { calls } = await countCalls(dialogue);
      assert.equal(calls, 0, dialogue.slice(0, 80));
      assert.equal(isTimelineAnchorCandidate(extractBatchOpeningRegion(dialogue)), false);
    }
  });
});
