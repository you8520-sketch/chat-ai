import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import {
  applyDetectedTriggerCandidate,
  formatTriggerSentence,
  generateTriggerIds,
  KNOWLEDGE_LABELS,
  labelForStatusKey,
  normalizeTriggerDraft,
  OPERATOR_LABELS,
  statusKeyOptionsFromWidget,
  validationError,
  type StatusWidgetTriggerDraft,
} from "./StatusWidgetTriggerEditor";
import type { StatusWidget } from "@/lib/statusWidget/types";

const widget: StatusWidget = {
  version: 1,
  name: "테스트 상태창",
  htmlTemplate: "",
  placement: "bottom",
  fields: [
    { id: "d_day", label: "D-DAY", instruction: "" },
    { id: "affection", label: "호감도", instruction: "" },
    { id: "trust", label: "신뢰도", instruction: "" },
    { id: "custom_meter", label: "긴장도", instruction: "" },
  ],
};

describe("StatusWidgetTriggerEditor helpers", () => {
  it("auto-generates trigger_id and event_key from status condition", () => {
    const ids = generateTriggerIds({ status_key: "d_day", operator: "<=", value: 0 });

    assert.equal(ids.trigger_id, "d_day_lte_0");
    assert.equal(ids.event_key, "d_day_event");
  });

  it("appends numeric suffixes when generated IDs duplicate existing triggers", () => {
    const existing: StatusWidgetTriggerDraft[] = [
      normalizeTriggerDraft({
        status_key: "d_day",
        operator: "<=",
        value: 0,
        effect_text: "카운트가 끝나면 사건이 발생한다.",
      }),
    ];

    const ids = generateTriggerIds({ status_key: "d_day", operator: "<=", value: 0 }, existing);

    assert.equal(ids.trigger_id, "d_day_lte_0_2");
    assert.equal(ids.event_key, "d_day_event_2");
  });

  it("status label saves machine key internally", () => {
    const options = statusKeyOptionsFromWidget(widget);

    assert.ok(options.some((option) => option.key === "d_day" && option.label === "D-DAY"));
    assert.ok(options.some((option) => option.key === "affection" && option.label === "호감도"));
    assert.ok(options.some((option) => option.key === "trust" && option.label === "신뢰도"));
    assert.ok(options.some((option) => option.key === "custom_meter" && option.label === "긴장도"));
    assert.equal(labelForStatusKey("custom_meter", options), "긴장도");
  });

  it("Korean condition labels map to raw operators internally", () => {
    assert.equal(OPERATOR_LABELS["<="], "이하가 되면");
    assert.equal(OPERATOR_LABELS[">="], "이상이 되면");
    assert.equal(OPERATOR_LABELS["=="], "같아지면");
    assert.equal(OPERATOR_LABELS["!="], "달라지면");
    assert.equal(OPERATOR_LABELS["<"], "미만이 되면");
    assert.equal(OPERATOR_LABELS[">"], "초과가 되면");
  });

  it("formats a human-readable Korean summary sentence", () => {
    const trigger = normalizeTriggerDraft({
      status_key: "trust",
      operator: "<=",
      value: 20,
      effect_text: "신뢰가 무너지는 사건이 발생한다.",
    });

    assert.equal(
      formatTriggerSentence(trigger, statusKeyOptionsFromWidget(widget)),
      "신뢰도가 20 이하가 되면 다음 턴에 사건이 발생합니다."
    );
  });

  it("friendly validation messages are shown", () => {
    const missingStatus = normalizeTriggerDraft({
      status_key: "",
      operator: "<=",
      value: 0,
      effect_text: "사건이 발생한다.",
    });
    const missingValue = normalizeTriggerDraft({
      status_key: "d_day",
      operator: "<=",
      value: "",
      effect_text: "사건이 발생한다.",
    });
    const missingEvent = normalizeTriggerDraft({
      status_key: "d_day",
      operator: "<=",
      value: 0,
      effect_text: "",
    });
    const invalidStatus = normalizeTriggerDraft({
      status_key: "unknown_key",
      operator: "<=",
      value: 0,
      effect_text: "사건이 발생한다.",
    });

    assert.equal(validationError(missingStatus), "어떤 상태창 값을 기준으로 할지 선택해 주세요.");
    assert.equal(validationError(missingValue), "조건을 비교할 값을 입력해 주세요. 예: D-DAY 종료 조건이면 0");
    assert.equal(validationError(missingEvent), "조건이 만족되었을 때 발생할 사건을 적어 주세요.");
    assert.equal(
      validationError(invalidStatus, statusKeyOptionsFromWidget(widget)),
      "상태창에 실제로 존재하는 값을 선택해 주세요."
    );
  });

  it("auto-detected trigger candidate can be applied with one click semantics", () => {
    const trigger = applyDetectedTriggerCandidate({
      source_text: "호감도 80 이상이면 고백 이벤트가 발생한다.",
      status_key: "affection",
      operator: ">=",
      value: 80,
      effect_text: "고백 이벤트가 자연스럽게 발생한다.",
      character_knowledge: "revealed_on_trigger",
    });

    assert.equal(trigger.trigger_id, "affection_gte_80");
    assert.equal(trigger.event_key, "affection_event");
    assert.equal(trigger.character_knowledge, "revealed_on_trigger");
    assert.equal(trigger.is_enabled, true);
  });

  it("character knowledge labels do not expose raw enum values", () => {
    assert.equal(KNOWLEDGE_LABELS.unknown, "캐릭터는 모름");
    assert.equal(KNOWLEDGE_LABELS.known, "캐릭터도 알고 있음");
    assert.equal(KNOWLEDGE_LABELS.revealed_on_trigger, "사건이 발생하면 알게 됨");
  });
});

describe("StatusWidgetTriggerEditor source policy", () => {
  const source = fs.readFileSync("src/components/StatusWidgetTriggerEditor.tsx", "utf8");
  const renderBody = source.slice(source.indexOf("return ("));

  it("normal UI does not render internal developer labels", () => {
    assert.doesNotMatch(renderBody, />\s*trigger_id\s*</);
    assert.doesNotMatch(renderBody, />\s*event_key\s*</);
    assert.doesNotMatch(renderBody, />\s*status_key\s*</);
    assert.doesNotMatch(renderBody, />\s*operator\s*</);
    assert.doesNotMatch(renderBody, />\s*raw status key\s*</i);
    assert.doesNotMatch(renderBody, />\s*raw operator\s*</i);
    assert.doesNotMatch(renderBody, />\s*조건 ID\s*</);
    assert.doesNotMatch(renderBody, />\s*사건 ID\s*</);
    assert.doesNotMatch(renderBody, />\s*고급 설정\s*</);
  });

  it("normal UI does not render machine generated ids or JSON/debug previews", () => {
    assert.doesNotMatch(renderBody, /trust_lte_20/);
    assert.doesNotMatch(renderBody, /d_day_lte_0/);
    assert.doesNotMatch(renderBody, /d_day_event/);
    assert.doesNotMatch(renderBody, /JSON/);
    assert.doesNotMatch(renderBody, /sampleJson/);
    assert.doesNotMatch(renderBody, /미리보기/);
    assert.doesNotMatch(renderBody, /실행 예상/);
  });

  it("condition name is not editable in normal UI", () => {
    assert.doesNotMatch(renderBody, /조건 이름/);
    assert.doesNotMatch(renderBody, /name="trigger_id"/);
  });

  it("normal UI exposes only creator-facing card fields", () => {
    assert.match(renderBody, /상태창 사건 조건/);
    assert.match(renderBody, /상태값/);
    assert.match(renderBody, /조건/);
    assert.match(renderBody, /비교값/);
    assert.match(renderBody, /발생할 사건/);
    assert.match(renderBody, /한 번만 실행/);
    assert.match(renderBody, /캐릭터가 이 조건을 아는지/);
    assert.match(renderBody, /현재 설정:/);
  });

  it("preset buttons fill simple Korean cards", () => {
    assert.match(source, /D-DAY가 0 이하가 되면/);
    assert.match(source, /호감도가 80 이상이 되면/);
    assert.match(source, /신뢰도가 20 이하가 되면/);
    assert.match(source, /오염도가 100 이상이 되면/);
    assert.match(source, /루트 플래그가 true가 되면/);
  });

  it("auto-detected candidate review card is friendly", () => {
    assert.match(renderBody, /자동 감지된 사건 조건/);
    assert.match(renderBody, /원문:/);
    assert.match(renderBody, /추천 조건:/);
    assert.match(renderBody, /적용/);
    assert.match(renderBody, /수정/);
    assert.match(renderBody, /무시/);
  });
});
