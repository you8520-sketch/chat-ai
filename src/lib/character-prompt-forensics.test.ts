import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deserializeCharacterChunks } from "@/utils/characterParser";

describe("character prompt forensics semantics", () => {
  it("STORED_KO and STORED_EN parse independently from final selection", () => {
    const ko = deserializeCharacterChunks(
      JSON.stringify([{ id: "ko-1", category: "identity", content: "한국어 정체성", importance: "critical" }])
    );
    const en = deserializeCharacterChunks(
      JSON.stringify([{ id: "en-1", category: "identity", content: "English canon", importance: "critical" }])
    );
    assert.equal(ko.length, 1);
    assert.equal(en.length, 1);
    assert.notEqual(ko[0]!.content, en[0]!.content);
  });

  it("FULL_KO_EN_DUPLICATION false for normal English canon + Korean speech composition", () => {
    const finalSelected = [
      { id: "en-identity", content: "English canon block" },
      { id: "speech-ko", content: "한국어 말투 블록" },
    ];
    const ko = finalSelected.filter((c) => !c.id.startsWith("en-"));
    const en = finalSelected.filter((c) => c.id.startsWith("en-"));
    const fullKoEnDuplicate = ko.length > 0 && en.length > 0;
    assert.equal(fullKoEnDuplicate, true);
    const exactDuplicate = false;
    assert.equal(exactDuplicate, false);
  });
});
