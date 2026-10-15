import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import {
  formatSpeechSectionAsMetadata,
  isSpeechMetadataSection,
  SPEECH_METADATA_INVISIBLE_RULE,
} from "@/lib/speechMetadataPolicy";

describe("speechMetadataPolicy", () => {
  it("detects speech sections by title and register context lines", () => {
    assert.equal(isSpeechMetadataSection("[말투]", "평소 해요체"), true);
    assert.equal(
      isSpeechMetadataSection(
        "레온의 말투",
        "공적인 자리: 다나까체\n유저와 둘만: 해요체"
      ),
      true
    );
    assert.equal(isSpeechMetadataSection("[외형]", "키 180cm"), false);
  });

  it("rewrites natural-language speech into structured metadata", () => {
    const body = [
      "공적인 자리: 건조한 군대식 다나까체",
      "유저와 둘만 있을 때: 해요체",
      '예시: "신경 쓰지 마십시오."',
    ].join("\n");

    const out = formatSpeechSectionAsMetadata("레온의 말투", body);
    assert.match(out, /말투 — GENERATION METADATA · NEVER NARRATE/);
    assert.match(out, /register_by_context:/);
    assert.match(out, /공적인 자리 → 건조한 군대식 다나까체/);
    assert.match(out, /유저와 둘만 있을 때 → 해요체/);
    assert.match(out, /dialogue_examples/);
    assert.doesNotMatch(out, /사라졌/);
  });

  it("defines invisible speech metadata rule text", () => {
    assert.match(SPEECH_METADATA_INVISIBLE_RULE, /SPEECH METADATA — INVISIBLE INSTRUCTIONS/);
    assert.match(SPEECH_METADATA_INVISIBLE_RULE, /Never narrate or describe inside the story/);
    assert.match(SPEECH_METADATA_INVISIBLE_RULE, /honorific level/);
    assert.match(SPEECH_METADATA_INVISIBLE_RULE, /해요체로 바뀌었다/);
    assert.match(SPEECH_METADATA_INVISIBLE_RULE, /같은 상대에게는 한 턴 안에서 register를 이유 없이 섞지 않는다/);
    assert.match(SPEECH_METADATA_INVISIBLE_RULE, /제작자가 상대·상황별로 다른 말투를 명시하면 그 조건을 따른다/);
  });

  it("keeps situational register conditions instead of collapsing to one token", () => {
    const body = [
      "구어체: 공식 심문·작전 중에는 딱딱한 존댓말과 명령형을 쓴다. 부하와 오래된 동료에게는 짧은 반말이 섞인다.",
      "어휘: 보급·경계·증거·책임 같은 실무 어휘를 즐겨 쓴다.",
    ].join("\n");
    const out = formatSpeechSectionAsMetadata("[말투 — 특징]", body);
    assert.match(out, /register_by_context:/);
    assert.match(out, /공식 심문·작전 중에는 딱딱한 존댓말/);
    assert.match(out, /부하와 오래된 동료에게는 짧은 반말/);
    assert.doesNotMatch(out, /구어체 → 반말\s*$/m);
    assert.doesNotMatch(out, /구어체 → 존댓말\s*$/m);
    assert.ok(!out.includes("…") || out.includes("공식 심문"));
  });

  it("does not pick a single default_register when formal and informal both appear", () => {
    const body =
      "존댓말은 예의라기보다 심문의 틀로 쓰고, 부하나 오랜 동료에게는 군더더기 없는 반말이 섞인다.";
    const out = formatSpeechSectionAsMetadata("[말투 — 성격]", body);
    assert.doesNotMatch(out, /default_register:\s*반말/);
    assert.doesNotMatch(out, /default_register:\s*존댓말/);
    assert.match(out, /심문의 틀/);
    assert.match(out, /반말이 섞인다/);
  });

  it("does not treat a negated banmal mention as the default register", () => {
    const out = formatSpeechSectionAsMetadata(
      "[말투 — 성격]",
      "평소에는 낮고 단정한 존댓말이다. 반말은 하지 않는다."
    );
    assert.match(out, /default_register:\s*존댓말/);
    assert.doesNotMatch(out, /default_register:\s*반말/);
  });
});
