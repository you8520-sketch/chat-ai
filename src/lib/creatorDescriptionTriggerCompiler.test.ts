import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compileCreatorDescriptionTriggers,
  mergeDescriptionTriggerCandidates,
} from "./creatorDescriptionTriggerCompiler";
import type { StatusWidget } from "@/lib/statusWidget/types";

const widget: StatusWidget = {
  version: 1,
  name: "상태창",
  placement: "bottom",
  fields: [
    { id: "d_day", label: "D-DAY", instruction: "D-DAY를 표시한다." },
    { id: "affection", label: "호감도", instruction: "호감도를 표시한다." },
    { id: "corruption", label: "오염도", instruction: "오염도를 표시한다." },
  ],
  htmlTemplate: "{{d_day}}{{affection}}{{corruption}}",
};

describe("creatorDescriptionTriggerCompiler", () => {
  it("creates a d_day <= 0 trigger candidate", () => {
    const compiled = compileCreatorDescriptionTriggers({
      description: "D-DAY가 0이 되면 캐릭터가 사망한다.",
      statusWidget: widget,
    });

    assert.equal(compiled.trigger_candidates.length, 1);
    assert.equal(compiled.trigger_candidates[0]?.status_key, "d_day");
    assert.equal(compiled.trigger_candidates[0]?.operator, "<=");
    assert.equal(compiled.trigger_candidates[0]?.value, 0);
  });

  it("does not inject trigger line into public_canon", () => {
    const line = "D-DAY가 0이 되면 캐릭터가 사망한다.";
    const compiled = compileCreatorDescriptionTriggers({ description: line, statusWidget: widget });

    assert.deepEqual(compiled.public_canon, []);
    assert.ok(compiled.hidden_event_notes.includes(line));
  });

  it("extracts status widget display instruction candidates", () => {
    const compiled = compileCreatorDescriptionTriggers({
      description: "D-DAY는 항상 상태창 마지막에 표시한다.",
      statusWidget: widget,
    });

    assert.deepEqual(compiled.status_widget_instruction_candidates, [
      "D-DAY를 상태창에 표시한다.",
    ]);
  });

  it("captures hidden knowledge notes and marks trigger as unknown", () => {
    const compiled = compileCreatorDescriptionTriggers({
      description:
        "D-DAY가 0이 되면 캐릭터가 사망한다. 캐릭터는 이 사실을 모른다.",
      statusWidget: widget,
    });

    assert.equal(compiled.trigger_candidates[0]?.character_knowledge, "unknown");
    assert.ok(compiled.hidden_event_notes.some((line) => line.includes("이 사실을 모른다")));
  });

  it("creates affection >= 80 trigger candidate", () => {
    const compiled = compileCreatorDescriptionTriggers({
      description: "호감도 80 이상이면 고백 이벤트가 발생한다.",
      statusWidget: widget,
    });

    assert.equal(compiled.trigger_candidates[0]?.status_key, "affection");
    assert.equal(compiled.trigger_candidates[0]?.operator, ">=");
    assert.equal(compiled.trigger_candidates[0]?.value, 80);
  });

  it("creates corruption >= 100 trigger candidate", () => {
    const compiled = compileCreatorDescriptionTriggers({
      description: "오염도 100에 도달하면 폭주한다.",
      statusWidget: widget,
    });

    assert.equal(compiled.trigger_candidates[0]?.status_key, "corruption");
    assert.equal(compiled.trigger_candidates[0]?.operator, ">=");
    assert.equal(compiled.trigger_candidates[0]?.value, 100);
  });

  it("routes speech rule text to speech_control, not public_canon", () => {
    const compiled = compileCreatorDescriptionTriggers({
      description: "평소에는 해요체를 쓰고 군대식 다나까체를 섞는다.",
      statusWidget: widget,
    });

    assert.equal(compiled.speech_control.length, 1);
    assert.deepEqual(compiled.public_canon, []);
  });

  it("keeps a personality sentence that starts with 평소에는 whole in public_canon", () => {
    const sentence =
      "평소에는 웃는 얼굴과 가벼운 농담으로 상대의 경계를 낮추고, 말보다 손버릇·시선·퇴로부터 본다.";
    const compiled = compileCreatorDescriptionTriggers({ description: sentence, statusWidget: null });

    assert.deepEqual(compiled.speech_control, []);
    assert.deepEqual(compiled.public_canon, [sentence]);
  });

  it("does not cut a sentence after a mid-clause 다/요 followed by a space", () => {
    const description =
      "그는 주요 지역을 돌며 거래를 중개한다. 필요 없으면 아무것도 묻지 않고 조용히 떠난다. 그래도 요 며칠은 다르다.";
    const compiled = compileCreatorDescriptionTriggers({ description, statusWidget: null });

    assert.deepEqual(compiled.public_canon, [
      "그는 주요 지역을 돌며 거래를 중개한다.",
      "필요 없으면 아무것도 묻지 않고 조용히 떠난다.",
      "그래도 요 며칠은 다르다.",
    ]);
    assert.deepEqual(compiled.speech_control, []);
  });

  it("keeps unpunctuated clauses on one line until a terminator or newline", () => {
    const line = "그는 말수가 적다 하지만 필요할 때는 먼저 움직인다";
    const compiled = compileCreatorDescriptionTriggers({ description: line, statusWidget: null });

    assert.deepEqual(compiled.public_canon, [line]);
  });

  it("still routes 평소에는 with an address or register cue to speech_control", () => {
    const compiled = compileCreatorDescriptionTriggers({
      description:
        "평소에는 상대를 이름 대신 직함으로 부른다. 평소에는 높임말을 유지하며 어조를 낮춘다.",
      statusWidget: null,
    });

    assert.equal(compiled.speech_control.length, 2);
    assert.deepEqual(compiled.public_canon, []);
  });

  it("does not treat generic 대답한다 / 답한다 / 부른다 action narration after 평소에는 as a speech rule", () => {
    const lines = [
      "평소에는 위협에는 침묵으로 대답한다.",
      "평소에는 도발에 주먹으로 답한다.",
      "평소에는 폭풍을 부른다.",
      "평소에는 말수가 적고 질문에 짧게 대답한다.",
    ];
    const compiled = compileCreatorDescriptionTriggers({ description: lines.join("\n"), statusWidget: null });

    assert.deepEqual(compiled.speech_control, []);
    assert.deepEqual(compiled.public_canon, lines);
  });

  it("still routes a 평소에는 address-term rule to speech_control", () => {
    const compiled = compileCreatorDescriptionTriggers({
      description: "평소에는 상대를 이름 대신 직함으로 부른다.",
      statusWidget: null,
    });

    assert.equal(compiled.speech_control.length, 1);
    assert.deepEqual(compiled.public_canon, []);
  });

  it("keeps speech, status display, trigger, and hidden-knowledge routing in one mixed description", () => {
    const personality = "평소에는 웃는 얼굴로 경계를 낮추고, 말보다 손버릇부터 본다.";
    const compiled = compileCreatorDescriptionTriggers({
      description: [
        personality,
        "말투는 존댓말을 쓰되 화가 날수록 낮고 공손해진다.",
        "D-DAY는 항상 상태창 마지막에 표시한다.",
        "D-DAY가 0이 되면 캐릭터가 사망한다. 캐릭터는 이 사실을 모른다.",
      ].join("\n"),
      statusWidget: widget,
    });

    assert.deepEqual(compiled.public_canon, [personality]);
    assert.equal(compiled.speech_control.length, 1);
    assert.deepEqual(compiled.status_widget_instruction_candidates, ["D-DAY를 상태창에 표시한다."]);
    assert.equal(compiled.trigger_candidates.length, 1);
    assert.ok(compiled.hidden_event_notes.some((n) => /캐릭터는 이 사실을 모른다/.test(n)));
  });

  it("runtime-safe public canon omits hidden trigger consequences before trigger fires", () => {
    const compiled = compileCreatorDescriptionTriggers({
      description:
        "북부 기사단 출신이다. D-DAY가 0이 되면 캐릭터가 사망한다.",
      statusWidget: widget,
    });
    const publicRuntimeText = compiled.public_canon.join("\n");

    assert.match(publicRuntimeText, /북부 기사단 출신/);
    assert.doesNotMatch(publicRuntimeText, /사망/);
  });

  it("existing Phase B queued event is the only path for effect_text injection", () => {
    const compiled = compileCreatorDescriptionTriggers({
      description: "D-DAY가 0이 되면 캐릭터가 사망한다.",
      statusWidget: widget,
    });

    assert.equal(compiled.public_canon.includes(compiled.trigger_candidates[0]!.effect_text), false);
    assert.match(compiled.trigger_candidates[0]!.effect_text, /카운트가 끝났다/);
  });

  it("preserves original creator raw description outside compiler output", () => {
    const raw = "D-DAY가 0이 되면 캐릭터가 사망한다.";
    compileCreatorDescriptionTriggers({ description: raw, statusWidget: widget });

    assert.equal(raw, "D-DAY가 0이 되면 캐릭터가 사망한다.");
  });

  it("does not duplicate existing manually configured trigger", () => {
    const existing = {
      trigger_id: "d_day_lte_0",
      status_key: "d_day",
      operator: "<=" as const,
      value: 0,
      fire_once: true,
      event_key: "manual_event",
      effect_text: "수동 트리거가 실행된다.",
      character_knowledge: "unknown" as const,
      is_enabled: true,
    };
    const compiled = compileCreatorDescriptionTriggers({
      description: "D-DAY가 0이 되면 캐릭터가 사망한다.",
      statusWidget: widget,
      existingTriggers: [existing],
    });
    const merged = mergeDescriptionTriggerCandidates([existing], compiled);

    assert.equal(compiled.trigger_candidates.length, 0);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.event_key, "manual_event");
  });

  it("recognizes 호감 threshold parity with 호감도", () => {
    const compiled = compileCreatorDescriptionTriggers({
      description: "호감 70 이상이면 과거 고백 트리거. 캐릭터는 모른다.",
      statusWidget: widget,
    });
    assert.equal(compiled.trigger_candidates.length, 1);
    assert.equal(compiled.trigger_candidates[0]?.status_key, "affection");
    assert.equal(compiled.trigger_candidates[0]?.value, 70);
    assert.equal(compiled.trigger_candidates[0]?.character_knowledge, "unknown");
  });

  it("routes hidden knowledge with 캐릭터는 모른다 to hidden_event_notes", () => {
    const line = "호감 70 이상이면 과거 고백 트리거. 캐릭터는 모른다.";
    const compiled = compileCreatorDescriptionTriggers({ description: line, statusWidget: widget });
    assert.ok(compiled.hidden_event_notes.some((n) => n.includes("호감 70")));
    assert.ok(compiled.hidden_event_notes.some((n) => /캐릭터(?:는|가)\s*(?:이를\s*)?모른다/.test(n)));
    assert.deepEqual(compiled.public_canon, []);
  });
});
