import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyNovelParagraph, novelParagraphSpacingClass } from "@/lib/novelParagraphs";
import {
  classifyTrpgSceneBeatParagraphKind,
  trpgSceneBeatSpacingClass,
} from "./trpgSceneBeatSpacing";
import type { TrpgSpeechBeat } from "./sceneSpeech";

function beat(speaker: string | null, text: string): TrpgSpeechBeat {
  return { speaker, text };
}

describe("trpgSceneBeatSpacing", () => {
  it("A — unlabeled dialogue-only beat delegates to shared classifier", () => {
    assert.equal(classifyTrpgSceneBeatParagraphKind(beat(null, '"정말 갈 거야?"')), "dialogue");
  });

  it("B — unlabeled narration beat delegates to shared classifier", () => {
    assert.equal(classifyTrpgSceneBeatParagraphKind(beat(null, "문이 천천히 열린다.")), "narration");
  });

  it("C — unlabeled mixed beat uses shared NovelParagraphKind semantics", () => {
    const text = '태현이 고개를 들었다. "멈춰."';
    assert.equal(
      classifyTrpgSceneBeatParagraphKind(beat(null, text)),
      classifyNovelParagraph(text)
    );
  });

  it("D — narration → unlabeled dialogue uses AI dialogue-transition spacing", () => {
    const cls = trpgSceneBeatSpacingClass(beat(null, '"정말 갈 거야?"'), beat(null, "문이 열렸다."));
    assert.equal(
      cls,
      novelParagraphSpacingClass("dialogue", "narration", "ai")
    );
    assert.match(cls, /mt-\[calc\(1\.5em/);
  });

  it("E — unlabeled dialogue → narration uses AI dialogue-transition spacing", () => {
    const cls = trpgSceneBeatSpacingClass(beat(null, "문이 닫혔다."), beat(null, '"정말 갈 거야?"'));
    assert.equal(
      cls,
      novelParagraphSpacingClass("narration", "dialogue", "ai")
    );
    assert.match(cls, /mt-\[calc\(1\.5em/);
  });

  it("F — named speaker → named speaker spacing unchanged", () => {
    const cls = trpgSceneBeatSpacingClass(
      beat("권태현", '"오른쪽."'),
      beat("강이현", '"왼쪽."')
    );
    assert.equal(
      cls,
      novelParagraphSpacingClass("dialogue", "dialogue", "ai")
    );
    assert.match(cls, /mt-\[calc\(1em/);
  });

  it("G — scene → GM table-talk spacing preserved", () => {
    const cls = trpgSceneBeatSpacingClass(
      beat("GM", "판정 설명"),
      beat(null, "장면 지문")
    );
    assert.equal(
      cls,
      novelParagraphSpacingClass("narration", "narration", "ai")
    );
    assert.match(cls, /mt-\[calc\(1em/);
  });

  it("delegates inter-beat spacing to shared AI policy without leading gap", () => {
    assert.equal(trpgSceneBeatSpacingClass(beat(null, "a"), null), "");
  });

  it("classifies named speakers and GM table-talk beats", () => {
    assert.equal(classifyTrpgSceneBeatParagraphKind(beat("강이현", '"대사"')), "dialogue");
    assert.equal(classifyTrpgSceneBeatParagraphKind(beat("GM", "table talk")), "narration");
  });
});
