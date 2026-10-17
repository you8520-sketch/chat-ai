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

  it("keeps ongoing current states as clearly_temporary (no 지만+이동 false positive)", () => {
    const ongoing = [
      "캐릭터는 불안하지만 복도로 이동 중이다.",
      "캐릭터는 그때의 공포를 지금도 느끼고 있다.",
      "캐릭터는 부상을 치료 중이다.",
    ];
    for (const fact_text of ongoing) {
      assert.equal(looksLikeCompletedHistoricalEvent(fact_text), false, fact_text);
      assert.equal(
        classifyEpisodicFactTemporalNature({
          category: "character",
          attribute: "emotional_state",
          value: "ongoing",
          fact_text,
        }),
        "clearly_temporary",
        fact_text
      );
    }
  });

  it("marks new current_* psychological attributes as clearly_temporary", () => {
    for (const attribute of [
      "current_attitude",
      "current_hostility",
      "current_aggression",
      "current_possessiveness",
      "current_jealousy",
      "current_control_intent",
      "current_attachment",
      "current_relationship_tension",
    ]) {
      assert.equal(
        classifyEpisodicFactTemporalNature({
          category: "character",
          attribute,
          value: "high",
          fact_text: "캐릭터는 현재 일시적인 상태다.",
        }),
        "clearly_temporary",
        attribute
      );
    }
  });

  it("marks explicit_scene_event scene_event with completed morphology as historical_event", () => {
    assert.equal(
      classifyEpisodicFactTemporalNature({
        category: "relationship",
        attribute: "scene_event",
        value: "a_led_b",
        fact_text: "그 장면에서 A가 B에게 구체적인 지시를 내렸고 B가 이를 따랐다.",
        evidence_type: "explicit_scene_event",
      }),
      "historical_event"
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

describe("verified scene occurrence under a free-form attribute", () => {
  function verified(authority: string, role = "assistant"): string {
    return JSON.stringify({
      memory_evidence_type: "explicit_scene_event",
      evidence: { role, message_id: 61, quote: "발톱이 태형의 왼쪽 옆구리를 꿰뚫었다.", authority, match: "normalized_exact" },
    });
  }
  function classify(factText: string, metadata: string | null, overrides: Record<string, string> = {}) {
    return classifyEpisodicFactTemporalNature({
      category: "character",
      attribute: "injury",
      value: "v",
      fact_text: factText,
      evidence_type: "explicit_scene_event",
      metadata,
      ...overrides,
    });
  }

  it("a verified past action or change is history whatever its key", () => {
    for (const text of [
      "태형은 진화형 크리처의 발톱에 왼쪽 옆구리를 찔렸다.",
      "태형은 순찰 중 계단에서 미끄러져 오른쪽 발목을 접질렀다.",
      "그날 태형의 왼쪽 옆구리는 열네 바늘 봉합되었다.",
      "유저는 에녹의 요구를 거절했다.",
    ]) {
      assert.equal(classify(text, verified("CURRENT_SCENE")), "historical_event", text);
    }
    assert.equal(classify("유저는 문을 열었다.", verified("USER_EXPLICIT", "user")), "historical_event");
  });

  it("a legacy row, a character claim or another evidence type is not promoted", () => {
    const text = "태형은 진화형 크리처의 발톱에 왼쪽 옆구리를 찔렸다.";
    assert.equal(classify(text, null), "unknown");
    assert.equal(classify(text, JSON.stringify({ memory_evidence_type: "explicit_scene_event" })), "unknown");
    assert.equal(classify(text, verified("CHARACTER_CLAIM")), "unknown");
    assert.equal(
      classify("유저는 카페에서 일했다.", verified("USER_EXPLICIT", "user"), { evidence_type: "explicit_user_statement" }),
      "unknown"
    );
  });

  it("state-shaped glosses keep latest-wins even with a verified source", () => {
    for (const text of [
      "태형은 권총 두 자루를 허리춤에 차고 다닌다.",
      "붕대 가장자리가 누렇게 변해 있었다.",
      "태형은 연구국 인턴이었다.",
      "태형은 조리장으로 일한다.",
      "태형은 지금도 통증을 느끼고 있다.",
      "에녹은 카페 안쪽 자리에 앉아 있다.",
      "태형은 내일 다시 오겠다.",
      "태형은 오른쪽 발목을 치료 중이다.",
      "옆구리에 상처가 없었다.",
    ]) {
      assert.equal(classify(text, verified("CURRENT_SCENE")), "unknown", text);
    }
  });

  it("durable and temporary attributes keep their nature", () => {
    const metadata = verified("CURRENT_SCENE");
    assert.equal(
      classify("사용자는 딸기우유를 좋아하게 되었다.", metadata, { category: "preference", attribute: "favorite_drink" }),
      "durable"
    );
    assert.equal(
      classify("태형은 순간 얼굴을 찡그렸다.", metadata, { attribute: "facial_expression" }),
      "clearly_temporary"
    );
  });
});
