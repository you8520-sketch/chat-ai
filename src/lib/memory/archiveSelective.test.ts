import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  archiveWholeBlobWouldInject,
  selectArchiveChunksSelective,
  splitArchiveIntoChunks,
} from "@/lib/memory/archiveSelective";

const ARCHIVE_FIXTURE = [
  "A. 레온과 첫 만남에서 검을 맞댔다.",
  "B. 던전에서 보물 상자를 찾았다.",
  "C. 회귀 직후 궁정에서 축제가 열렸다.",
  "D. 고백 트리거 직전 호감도가 79였다.",
  "E. 평범한 일상에서 차를 마셨다.",
].join("\n\n");

describe("archiveSelective", () => {
  it("splits archive into paragraph chunks", () => {
    const chunks = splitArchiveIntoChunks(ARCHIVE_FIXTURE);
    assert.equal(chunks.length, 5);
    assert.match(chunks[0]!.text, /^A\./);
  });

  it("does not inject whole blob when only one chunk is relevant", () => {
    const selective = selectArchiveChunksSelective({
      archive: ARCHIVE_FIXTURE,
      userMessage: "회귀와 고백",
      budgetChars: 500,
    });

    assert.equal(selective.included, true);
    assert.ok(selective.selectedChunks.length < 5);
    assert.ok(selective.selectedChars < selective.candidateChars);
    const text = selective.selectedText;
    assert.match(text, /회귀|고백/);
    assert.doesNotMatch(text, /^A\./m);
    assert.doesNotMatch(text, /^B\./m);
  });

  it("returns empty selection when nothing matches", () => {
    const selective = selectArchiveChunksSelective({
      archive: ARCHIVE_FIXTURE,
      userMessage: "xyz",
      budgetChars: 500,
    });
    assert.equal(selective.included, false);
    assert.equal(selective.selectedChunks.length, 0);
  });

  it("whole-blob legacy gate differs from selective granularity", () => {
    const userMessage = "회귀와 고백";
    assert.equal(archiveWholeBlobWouldInject(ARCHIVE_FIXTURE, userMessage), true);

    const selective = selectArchiveChunksSelective({
      archive: ARCHIVE_FIXTURE,
      userMessage,
      budgetChars: 500,
    });
    assert.ok(selective.selectedChars < ARCHIVE_FIXTURE.length);
  });

  it("orders selected chunks deterministically by score then index", () => {
    const first = selectArchiveChunksSelective({
      archive: ARCHIVE_FIXTURE,
      userMessage: "회귀 고백",
      budgetChars: 800,
    });
    const second = selectArchiveChunksSelective({
      archive: ARCHIVE_FIXTURE,
      userMessage: "회귀 고백",
      budgetChars: 800,
    });
    assert.deepEqual(
      first.selectedChunks.map((c) => c.index),
      second.selectedChunks.map((c) => c.index)
    );
  });

  // ───── D1.1: archive retrieval context repair (recent scene bridge) ─────

  const D11_ARCHIVE = [
    "3년 전 도윤이 맡았던 유사 실종 사건: 피해자는 강남 일대 유흥업소에서 마지막으로 목격된 뒤 실종됐고, 당시 용의자로 지목된 유흥업소 업주가 증거 불충분으로 풀려났다.",
    "도윤의 경찰 재직 시절 징계 기록: 용의자 심문 중 과잉 폭력으로 내부 징계 2회.",
    "도윤이 평소 즐겨 마시는 커피는 연한 라떼이며, 사무소 한켠에 고양이 '무'를 키운 지 2년째다.",
    "도윤은 작년 봄에 사무소를 현재 건물로 이전했고, 월세 계약은 매년 갱신한다.",
  ].join("\n\n");

  const D11_RECENT = [
    "한도윤 씨? 제 동생이 사라진 지 일주일 됐어요. 경찰은 성인 실종이라 소극적이에요.",
    "동생은 박지훈, 27살. 마지막 연락은 일주일 전 금요일 밤, 강남 쪽이었어요.",
  ].join("\n");

  it("A. direct lexical: current cue keyword selects relevant paragraph", () => {
    const selective = selectArchiveChunksSelective({
      archive: D11_ARCHIVE,
      userMessage: "강남 유흥업소 실종 사건 다시 보자",
      budgetChars: 1000,
    });
    assert.equal(selective.included, true);
    assert.ok(selective.selectedChunks.length >= 1);
    assert.match(selective.selectedText, /유사 실종 사건/);
    // coffee/cat paragraph must NOT be pulled in
    assert.doesNotMatch(selective.selectedText, /라떼|고양이/);
  });

  it("B. indirect recent-context bridge: current cue has 0 overlap, recent history bridges", () => {
    // Current cue: 편의점/점원/금요일/목격/단서 — 0 lexical overlap with the
    // 유사 실종 사건 archive paragraph. Recent history supplies 실종/강남 bridge.
    const selective = selectArchiveChunksSelective({
      archive: D11_ARCHIVE,
      userMessage:
        "오늘 아침 동생이 마지막으로 목격됐다는 편의점을 찾았어요. 점원이 금요일 밤에 혼자 온 손님을 기억한다고 했어요. 이 단서 어떻게 처리하면 될까요?",
      recentContext: D11_RECENT,
      budgetChars: 1000,
    });
    assert.equal(selective.included, true);
    assert.ok(selective.selectedChunks.length >= 1);
    assert.match(selective.selectedText, /유사 실종 사건/);
    // irrelevant archive paragraphs must be dropped
    assert.doesNotMatch(selective.selectedText, /라떼|고양이|월세|이전했/);
  });

  it("B-rollback: without recentContext the same modern cue selects nothing (HEAD parity)", () => {
    const selective = selectArchiveChunksSelective({
      archive: D11_ARCHIVE,
      userMessage:
        "오늘 아침 동생이 마지막으로 목격됐다는 편의점을 찾았어요. 점원이 금요일 밤에 혼자 온 손님을 기억한다고 했어요. 이 단서 어떻게 처리하면 될까요?",
      budgetChars: 1000,
    });
    assert.equal(selective.included, false);
    assert.equal(selective.selectedChunks.length, 0);
  });

  it("C. deictic/ellipsis: '그때처럼' current cue resolves via recent history", () => {
    const selective = selectArchiveChunksSelective({
      archive: D11_ARCHIVE,
      userMessage: "그때처럼 하면 될까요?",
      recentContext: D11_RECENT,
      budgetChars: 1000,
    });
    // '그때' alone has no archive overlap; recent bridge (실종/강남) recalls it
    assert.equal(selective.included, true);
    assert.match(selective.selectedText, /유사 실종 사건/);
  });

  it("D. true unrelated: current + recent both irrelevant → selected=0, no fallback", () => {
    const selective = selectArchiveChunksSelective({
      archive: D11_ARCHIVE,
      userMessage: "날씨가 좋네요. 산책이나 할까요.",
      recentContext: "오늘 점심은 파스타를 먹었어요. 정말 맛있었죠.",
      budgetChars: 1000,
    });
    assert.equal(selective.included, false);
    assert.equal(selective.selectedChunks.length, 0);
  });

  it("E. multiple paragraphs: only the relevant subset is selected, not the whole blob", () => {
    const selective = selectArchiveChunksSelective({
      archive: D11_ARCHIVE,
      userMessage: "강남 유흥업소 실종 사건 다시 보자",
      budgetChars: 1000,
    });
    assert.ok(selective.selectedChunks.length < selective.candidateCount);
    assert.ok(selective.selectedChars < selective.candidateChars);
    assert.match(selective.selectedText, /유사 실종 사건/);
    assert.doesNotMatch(selective.selectedText, /라떼|고양이|월세/);
  });

  it("F. old-history noise: a single stray recent word does not cross threshold", () => {
    // Recent context mentions '경찰' once (bridges to 징계 paragraph) but nothing
    // else relevant — a single recent hit must NOT be enough on its own.
    const selective = selectArchiveChunksSelective({
      archive: D11_ARCHIVE,
      userMessage: "편의점 단서를 정리하자",
      recentContext: "경찰에 연락해볼까요.",
      budgetChars: 1000,
    });
    // '편의점'/'단서' have no archive overlap; '경찰' is a single recent hit
    // → score 1 < threshold 2, and currentUserKeywordCount > 2 → not selected.
    assert.equal(selective.included, false);
  });

  it("fantasy parity: direct '봉인' keyword recall preserved", () => {
    // Mirrors the real D1 fantasy fixture: the archive paragraph echoes the
    // cue phrasing ("여는 자가 닫는 자가 된다"), so direct strict-substring
    // matching scores >= 2 without needing any recent-context bridge.
    const fantasyArchive = [
      "50년 전 알드레아 북부에서 발생한 봉인 주문 사건: 한 사제가 고대 봉인을 해제하려다 오히려 재봉인 주문을 발동해 마을 절반이 봉인에 휩쓸려 실종됐다. 기록에 따르면 해당 주문서는 '여는 자가 닫는 자가 된다'는 구절을 포함하고 있었다.",
      "아리안은 딸기를 좋아하며, 도서관 창가에서 햇살을 쬐는 것을 즐긴다.",
      "왕립 도서관 금서고 장서 목록: 봉인 주문서 12권, 소환 주문서 7권.",
    ].join("\n\n");
    const selective = selectArchiveChunksSelective({
      archive: fantasyArchive,
      userMessage: "'봉인을 여는 자는 닫는 자가 되리'라는 구절이 반복돼요. 이게 봉인을 여는 주문인가요?",
      budgetChars: 1000,
    });
    assert.equal(selective.included, true);
    assert.match(selective.selectedText, /봉인 주문 사건/);
    // 딸기 paragraph must not be selected
    assert.doesNotMatch(selective.selectedText, /딸기/);
  });

  it("chunkScores reports current vs recent provenance", () => {
    const selective = selectArchiveChunksSelective({
      archive: D11_ARCHIVE,
      userMessage: "오늘 아침 편의점 단서를 정리하자",
      recentContext: D11_RECENT,
      budgetChars: 1000,
    });
    const causal = selective.chunkScores.find((c) => c.index === 0);
    assert.ok(causal, "causal paragraph score entry exists");
    assert.ok(causal!.recentScore >= 2, "recent bridge drove the causal paragraph");
    assert.ok(causal!.currentScore === 0 || causal!.currentScore >= 0);
  });
});
