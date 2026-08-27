import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyTrpgSceneBeatParagraphKind,
  trpgSceneBeatSpacingClass,
} from "./trpgSceneBeatSpacing";
import type { TrpgSpeechBeat } from "./sceneSpeech";

function beat(speaker: string | null, text: string): TrpgSpeechBeat {
  return { speaker, text };
}

describe("trpgSceneBeatSpacing", () => {
  it("classifies unlabeled narration and named speakers for spacing", () => {
    assert.equal(classifyTrpgSceneBeatParagraphKind(beat(null, "지문")), "narration");
    assert.equal(classifyTrpgSceneBeatParagraphKind(beat("강이현", '"대사"')), "dialogue");
    assert.equal(classifyTrpgSceneBeatParagraphKind(beat("GM", "table talk")), "narration");
  });

  it("delegates inter-beat spacing to shared AI policy without leading gap", () => {
    assert.equal(trpgSceneBeatSpacingClass(beat(null, "a"), null), "");
  });

  it("applies narration-to-narration spacing between beats", () => {
    const cls = trpgSceneBeatSpacingClass(
      beat(null, "둘째 지문"),
      beat(null, "첫 지문")
    );
    assert.match(cls, /mt-\[calc\(1em/);
  });

  it("applies narration-to-dialogue spacing between beats", () => {
    const cls = trpgSceneBeatSpacingClass(
      beat("강이현", '"대사"'),
      beat(null, "첫 지문")
    );
    assert.match(cls, /mt-\[calc\(1\.5em/);
  });

  it("applies dialogue-to-dialogue spacing between named beats", () => {
    const cls = trpgSceneBeatSpacingClass(
      beat("권태현", '"오른쪽."'),
      beat("강이현", '"왼쪽."')
    );
    assert.match(cls, /mt-\[calc\(1em/);
  });

  it("applies dialogue-to-narration spacing between beats", () => {
    const cls = trpgSceneBeatSpacingClass(
      beat(null, "다음 지문"),
      beat("강이현", '"대사"')
    );
    assert.match(cls, /mt-\[calc\(1\.5em/);
  });

  it("applies scene-to-GM-table-talk spacing", () => {
    const cls = trpgSceneBeatSpacingClass(
      beat("GM", "판정 설명"),
      beat(null, "장면 지문")
    );
    assert.match(cls, /mt-\[calc\(1em/);
  });
});
