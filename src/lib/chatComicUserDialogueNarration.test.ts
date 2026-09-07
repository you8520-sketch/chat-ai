import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  extractDeterministicEvents,
  visualEvents,
} from "./chatImageScenePlan";
import {
  renderComicTextBrief,
  selectComicDialogueCandidates,
  selectComicNarrationCandidates,
  resolveComicTextDensity,
} from "./chatComicTextBrief";

const SPEAKER = { personaName: "렌", characterName: "태형" };
const BINDING = { characterLabel: "A", characterName: "태형", personaLabel: "B", personaName: "렌" };

/** Production path: raw user+assistant source pair → canonical events → deterministic plan. */
function pair(userText: string, assistantText: string) {
  const messages = buildSceneSourceMessages([
    { id: 1, role: "user", content: userText },
    { id: 2, role: "assistant", content: assistantText },
  ]);
  const events = extractDeterministicEvents(messages, SPEAKER);
  const plan = buildDeterministicScenePlan(messages, undefined, SPEAKER);
  const visual = visualEvents(events);
  const dialogue = events.filter((e) => e.kind === "dialogue");
  const anchor = dialogue[dialogue.length - 1];
  return { messages, events, plan, visual, anchor };
}

function briefFor(pairResult: ReturnType<typeof pair>, focusEventIds: string[], panelMode: "auto" | 3 | 4 = "auto") {
  const { plan, anchor } = pairResult;
  const selection = { anchorEventId: anchor!.id, focusEventIds };
  return renderComicTextBrief({ plan, selection, binding: BINDING, safety: {}, panelMode });
}

describe("comic user dialogue + narration quality floor (production path)", () => {
  it("UD-1 important user line survives canonical → candidate → final brief when in focus", () => {
    const p = pair('"나 진짜 너를 좋아해. 이번엔 거짓말 아니야." *그의 손을 꽉 잡는다*', '"좋아해? 평생 나만 보고 살겠다는 각오라면, 받아줄게." *렌의 손을 놓지 않는다*');
    const focus = p.visual.map((e) => e.id);
    const cands = selectComicDialogueCandidates(p.plan, { anchorEventId: p.anchor!.id, focusEventIds: focus }, BINDING);
    assert.ok(cands.some((c) => c.speakerSubject === "B" && c.exactText.includes("좋아해")), "user line becomes a persona candidate");
    const brief = briefFor(p, focus);
    assert.equal(brief.audit.candidateUserDialogueCount, 1, "candidate user count");
    assert.equal(brief.audit.candidateCharacterDialogueCount, 1, "candidate character count");
    assert.equal(brief.audit.canonicalUserDialogueCount, 1);
    assert.equal(brief.audit.focusUserDialogueCount, 1);
    assert.equal(brief.audit.anchorSourceRole, "assistant");
    assert.match(brief.text, /B: "나 진짜 너를 좋아해\./u, "user line reaches final brief as a candidate");
  });

  it("UD-2 trivial user line is not forced by any user quota; story-bearing assistant stays", () => {
    const p = pair('"응, 그래." *고개를 끄덕인다*', '"오늘부터 계약은 끝이다. 내가 널 내 사람으로 만들 거야." *눈을 마주친다*');
    const focus = p.visual.map((e) => e.id);
    const brief = briefFor(p, focus);
    assert.doesNotMatch(brief.text, /must include.*user dialogue|force.*user|user.*quota/iu, "no user-dialogue quota wording");
    const cands = selectComicDialogueCandidates(p.plan, { anchorEventId: p.anchor!.id, focusEventIds: focus }, BINDING);
    const anchorCand = cands.find((c) => c.priority === 1);
    assert.equal(anchorCand?.speakerSubject, "A", "story-bearing assistant line anchors, not the trivial user line");
    assert.doesNotMatch(brief.text, /must be rendered|must appear/iu, "no forced-line contract");
  });

  it("UD-3 assistant echo of a user line never becomes a duplicate candidate", () => {
    const p = pair(
      '"나 진짜 너를 좋아해."',
      '렌은 말을 잇지 못했다. "나도 널 좋아해." "나 진짜 너를 좋아해." 라고 되받아치듯 말했다. *손을 맞잡는다*'
    );
    const focus = p.visual.map((e) => e.id);
    const cands = selectComicDialogueCandidates(p.plan, { anchorEventId: p.anchor!.id, focusEventIds: focus }, BINDING);
    const texts = cands.map((c) => c.exactText);
    const echoText = "나 진짜 너를 좋아해.";
    const occurrences = texts.filter((t) => t === echoText).length;
    assert.equal(occurrences, 1, "the echoed sentence appears exactly once across candidates (no user+character duplicate)");
    const kept = cands.find((c) => c.exactText === echoText);
    assert.equal(kept?.speakerSubject, "B", "the user's original line is kept over the character echo");
  });

  it("NAR-1 same-place contiguous dialogue scene → 0 narration allowed", () => {
    const p = pair('"오늘 어땠어?"', '"꽤 좋았어." "그래서 다행이야." *미소를 짓는다*');
    const focus = p.visual.map((e) => e.id);
    const narr = selectComicNarrationCandidates(p.plan, { anchorEventId: p.anchor!.id, focusEventIds: focus });
    assert.equal(narr.length, 0, "no transition beats → 0 candidates");
    const density = resolveComicTextDensity({ effectivePanelMode: 3, dialogueCandidateCount: 2, narrationCandidateCount: narr.length });
    assert.equal(density.narrationTarget, "0", "no transition → narration floor 0");
    const brief = briefFor(p, focus, 3);
    assert.match(brief.text, /Narration: 0 short boxes\./u);
  });

  it("NAR-2 explicit time jump in focus → source-grounded narration candidate + meaningful target", () => {
    const p = pair(
      '"여기서 뭐 하는 거야?"',
      '잠시 후, 두 사람은 큰 유리창 너머로 도시의 야경을 바라보며 술잔을 천천히 기울이고 있었다. "도시의 밤은 참 예쁘다."'
    );
    const focus = p.visual.map((e) => e.id);
    const narr = selectComicNarrationCandidates(p.plan, { anchorEventId: p.anchor!.id, focusEventIds: focus });
    assert.ok(narr.length >= 1, "time jump produces a narration candidate");
    assert.ok(narr.some((n) => n.purpose === "time_bridge"), "purpose time_bridge");
    const brief = briefFor(p, focus, 4);
    assert.equal(brief.audit.narrationCandidateCount, narr.length);
    assert.equal(brief.audit.narrationTarget, "1", "one transition beat → narration target 1");
  });

  it("NAR-3 location transition in focus → location_bridge candidate + target", () => {
    const p = pair('"가자."', '두 사람은 방을 나와 복도를 지나 발코니로 걸어간다. "밤공기가 참 좋다."');
    const focus = p.visual.map((e) => e.id);
    const narr = selectComicNarrationCandidates(p.plan, { anchorEventId: p.anchor!.id, focusEventIds: focus });
    assert.ok(narr.some((n) => n.purpose === "location_bridge"), "location transition candidate");
    const brief = briefFor(p, focus, 4);
    assert.match(brief.audit.narrationTarget, /^1$/);
    assert.match(brief.text, /source-grounded transition beats/);
  });

  it("NAR-4 important action bridge is not lost; target reflects it", () => {
    const p = pair('"기다려."', '*렌이 손을 내밀어 그의 손을 잡는다* "고마워."');
    const focus = p.visual.map((e) => e.id);
    const narr = selectComicNarrationCandidates(p.plan, { anchorEventId: p.anchor!.id, focusEventIds: focus });
    assert.ok(narr.length >= 1, "action bridge survives");
    const brief = briefFor(p, focus, 4);
    assert.equal(brief.audit.narrationTarget, "1", "bridge present → narration target 1, not optional 0-2");
  });

  it("NAR-5 long meaningful transition is not dropped by length; concise projection used", () => {
    const p = pair(
      '"진심이야?"',
      '잠시 후, 렌은 거울 앞에 서서 천천히 옷매무새를 정리했다. 검은색 실크 셔츠와 회색 바지는 그가 전날 밤에 직접 골라 건네준 것이었고, 소매에는 은은하게 수놓아진 이름이 있었다. "어때?"'
    );
    const focus = p.visual.map((e) => e.id);
    const narr = selectComicNarrationCandidates(p.plan, { anchorEventId: p.anchor!.id, focusEventIds: focus });
    assert.ok(narr.length >= 1, "long transition still yields a candidate (not dropped by char filter)");
    assert.ok(narr[0]!.text.length <= 60, "candidate text is concise");
    assert.match(narr[0]!.text, /잠시 후, 렌은 거울 앞에 서서/u, "first sentence kept");
    assert.doesNotMatch(narr[0]!.text, /수놓아진 이름/u, "later sentence detail projected away — no invented fact, just shorter");
    const brief = briefFor(p, focus, 4);
    assert.equal(brief.audit.narrationTarget, "1");
  });
});