import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterTurnsForMemorySummary,
  isTurnEligibleForMemoryRecord,
  stripOocFromMemorySummary,
} from "./memory-ooc-filter";

describe("isTurnEligibleForMemoryRecord", () => {
  it("excludes rp_unrelated OOC (Twitter inbox mock)", () => {
    assert.equal(
      isTurnEligibleForMemoryRecord(
        "(OOC: 트위터 익명 메시지함 형식으로 PC와 NPC에 대한 팬들의 반응을 보여줘)"
      ),
      false
    );
  });

  it("excludes isolated OOC scene-render samples", () => {
    assert.equal(
      isTurnEligibleForMemoryRecord(
        "OOC: 본편과 별개로 이 상황을 샘플 장면으로 한 번 보여줘."
      ),
      false
    );
  });

  it("includes rp_continuing OOC", () => {
    assert.equal(
      isTurnEligibleForMemoryRecord(
        "(OOC: 다음 장면에서 둘이 다시 만나게 해줘 — RP 이어짐)"
      ),
      true
    );
  });

  it("includes normal RP user messages", () => {
    assert.equal(isTurnEligibleForMemoryRecord("카페에 앉아 커피를 마신다."), true);
  });

  it("excludes hard-stop OOC and keeps scene-reset OOC", () => {
    assert.equal(
      isTurnEligibleForMemoryRecord("OOC: 여기서 RP 끝. 더 이상 장면 진행하지 마."),
      false
    );
    assert.equal(
      isTurnEligibleForMemoryRecord(
        "OOC: 기존 RP 종료. 새로운 에피소드 시작. 카페에서 다시 만난다."
      ),
      true
    );
  });
});

describe("filterTurnsForMemorySummary", () => {
  it("drops rp_unrelated turns from batch", () => {
    const turns = [
      { user: "카페에 들어간다.", assistant: "문을 연다." },
      {
        user: "(OOC: HTML로 SNS UI mockup 보여줘)",
        assistant: "div mockup response",
      },
      { user: "다음 날 아침.", assistant: "해가 뜬다." },
    ];
    assert.equal(filterTurnsForMemorySummary(turns).length, 2);
  });

  it("keeps adopted assistant-only canon events", () => {
    const turns = [
      { user: "카페에 들어간다.", assistant: "문을 연다." },
      {
        user: "",
        assistant: "호텔에서 키스했다.",
        assistantOnly: true,
      },
    ];
    const filtered = filterTurnsForMemorySummary(turns);
    assert.equal(filtered.length, 2);
    assert.equal(filtered[1]!.assistant, "호텔에서 키스했다.");
  });
});

describe("stripOocFromMemorySummary", () => {
  it("removes parenthetical OOC blocks from summary", () => {
    const input =
      "카페에서 만남 → (OOC: 트위터 익명 메시지함 형식으로 PC와 NPC에 대한 팬들의 다양한 반응과 해석이 제시되었다.) → 다음 날";
    assert.equal(stripOocFromMemorySummary(input), "카페에서 만남 → 다음 날");
  });

  it("returns empty when summary is only OOC meta", () => {
    assert.equal(
      stripOocFromMemorySummary(
        "(OOC: 트위터 익명 메시지함 형식으로 팬 반응이 제시되었다.)"
      ),
      ""
    );
  });

  it("keeps RP event segments", () => {
    assert.equal(
      stripOocFromMemorySummary("카페에서 대화 → 관계가 가까워짐"),
      "카페에서 대화 → 관계가 가까워짐"
    );
  });
});
