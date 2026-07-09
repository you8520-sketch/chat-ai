import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import type { buildCompiledCreatorDescriptionForSave as BuildCompiledCreatorDescriptionForSaveFn } from "@/lib/characterFormSave";
import { parseCreatorDescriptionCompiled } from "@/lib/creatorDescriptionTriggerCompiler";

let buildCompiledCreatorDescriptionForSave: typeof BuildCompiledCreatorDescriptionForSaveFn;

before(async () => {
  ({ buildCompiledCreatorDescriptionForSave } = await import("@/lib/characterFormSave"));
});

describe("buildCompiledCreatorDescriptionForSave", () => {
  it("prepares persisted compiled sections and preserves raw creator text", () => {
    const result = buildCompiledCreatorDescriptionForSave({
      description: "공개 프로필 소개.",
      world: "북부 기사단 출신이다.",
      systemPrompt: [
        "평소에는 다나까체, 단둘이 있을 때는 해요체를 사용한다.",
        "D-DAY가 0이 되면 캐릭터가 사망한다.",
      ].join(" "),
      statusWidgetJson: "",
      statusWidgetTriggers: [],
    });
    const parsed = parseCreatorDescriptionCompiled(result.compiledDescriptionJson);

    assert.match(result.creatorRawDescription, /공개 프로필 소개/);
    assert.match(result.creatorRawDescription, /D-DAY가 0이 되면/);
    assert.ok(parsed);
    assert.match(result.safeRuntimeCanon, /북부 기사단 출신/);
    assert.doesNotMatch(result.safeRuntimeCanon, /공개 프로필 소개/);
    assert.doesNotMatch(result.safeRuntimeCanon, /해요체|다나까체|D-DAY|사망/);
    assert.equal(parsed!.speech_control.length, 1);
    assert.ok(parsed!.hidden_event_notes.length >= 1);
    assert.ok(parsed!.trigger_candidates.length >= 1);
  });

  it("keeps rich public description content out of runtime canon", () => {
    const result = buildCompiledCreatorDescriptionForSave({
      description:
        '<div><strong>하율은 조용한 관찰자다.</strong></div><div><span style="color:#fda4af">밤에는 기록을 남긴다.</span></div>',
      world: "",
      systemPrompt: "",
      statusWidgetJson: "",
      statusWidgetTriggers: [],
    });

    assert.match(result.creatorRawDescription, /<strong>/);
    assert.match(result.creatorRawDescription, /style=/);
    assert.doesNotMatch(result.safeRuntimeCanon, /하율은 조용한 관찰자다/);
    assert.doesNotMatch(result.safeRuntimeCanon, /밤에는 기록을 남긴다/);
    assert.doesNotMatch(result.safeRuntimeCanon, /<strong>|<span|style=/);
  });
});
