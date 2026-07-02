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
    assert.match(out, /공적인 자리 → 다나까체/);
    assert.match(out, /유저와 둘만 있을 때 → 해요체/);
    assert.match(out, /dialogue_examples/);
    assert.doesNotMatch(out, /사라졌/);
  });

  it("defines invisible speech metadata rule text", () => {
    assert.match(SPEECH_METADATA_INVISIBLE_RULE, /SPEECH METADATA — INVISIBLE INSTRUCTIONS/);
    assert.match(SPEECH_METADATA_INVISIBLE_RULE, /Never narrate or describe inside the story/);
    assert.match(SPEECH_METADATA_INVISIBLE_RULE, /honorific level/);
    assert.match(SPEECH_METADATA_INVISIBLE_RULE, /해요체로 바뀌었다/);
    assert.match(SPEECH_METADATA_INVISIBLE_RULE, /한 캐릭터는 한 턴 안에서 register를 섞지 않는다/);
  });
});
