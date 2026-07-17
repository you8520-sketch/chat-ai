import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyEpisodicFactTemporalNature,
  looksLikeCompletedHistoricalEvent,
} from "@/lib/episodicMemoryTemporal";

describe("classifyEpisodicFactTemporalNature", () => {
  it("marks exact temporary attributes as clearly_temporary", () => {
    for (const attribute of [
      "emotional_state",
      "current_emotion",
      "current_action",
      "current_posture",
      "current_expression",
      "current_sensation",
      "facial_expression",
      "scene_state",
      "current_weather",
    ]) {
      assert.equal(
        classifyEpisodicFactTemporalNature({
          category: "character",
          attribute,
          value: "tense",
          fact_text: "캐릭터는 현재 불안해하고 있다.",
        }),
        "clearly_temporary",
        attribute
      );
    }
  });

  it("does not treat broad attributes as temporary by substring", () => {
    assert.equal(
      classifyEpisodicFactTemporalNature({
        category: "character",
        attribute: "physical_condition",
        value: "permanently_blind",
        fact_text: "캐릭터는 영구적인 시력 상실 상태를 유지한다.",
      }),
      "unknown"
    );
    assert.equal(
      classifyEpisodicFactTemporalNature({
        category: "location",
        attribute: "location",
        value: "new_base",
        fact_text: "일행은 새 거점으로 이전한 상태를 유지한다.",
      }),
      "unknown"
    );
    assert.equal(
      classifyEpisodicFactTemporalNature({
        category: "relationship",
        attribute: "trust_status",
        value: "allied",
        fact_text: "두 사람은 서로를 신뢰하는 관계를 유지한다.",
      }),
      "unknown"
    );
  });

  it("preserves completed historical events even on temporary attributes", () => {
    assert.equal(
      looksLikeCompletedHistoricalEvent(
        "캐릭터는 전투 중 부상을 입었으나 치료 후 회복했다."
      ),
      true
    );
    assert.equal(
      classifyEpisodicFactTemporalNature({
        category: "character",
        attribute: "emotional_state",
        value: "resolved_fear",
        fact_text: "캐릭터는 일시적인 공포 때문에 임무를 중단했다.",
      }),
      "historical_event"
    );
    assert.equal(
      classifyEpisodicFactTemporalNature({
        category: "location",
        attribute: "current_action",
        value: "relocated",
        fact_text: "캐릭터는 특정 장소에서 단서를 발견한 뒤 다른 장소로 이동했다.",
      }),
      "historical_event"
    );
  });

  it("does not mis-classify plain present states as historical events", () => {
    assert.equal(
      looksLikeCompletedHistoricalEvent("캐릭터는 현재 불안해하고 있다."),
      false
    );
    assert.equal(
      looksLikeCompletedHistoricalEvent("캐릭터는 지금 복도에 서 있다."),
      false
    );
    assert.equal(
      looksLikeCompletedHistoricalEvent("캐릭터는 창밖을 바라보는 중이다."),
      false
    );
  });

  it("marks preference facts as durable and unknown otherwise", () => {
    assert.equal(
      classifyEpisodicFactTemporalNature({
        category: "preference",
        attribute: "favorite_drink",
        value: "tea",
        fact_text: "사용자는 차를 선호한다.",
      }),
      "durable"
    );
    assert.equal(
      classifyEpisodicFactTemporalNature({
        category: "character",
        attribute: "secret_identity",
        value: "revealed",
        fact_text: "캐릭터의 정체가 상대에게 밝혀진 사실이 있다.",
      }),
      "unknown"
    );
  });
});
