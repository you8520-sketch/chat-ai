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
});
