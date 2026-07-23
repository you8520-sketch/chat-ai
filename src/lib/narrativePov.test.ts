import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildNarrativePovPrompt, resolveNarrativePov } from "./narrativePov";

describe("narrative POV owner", () => {
  it("defaults legacy rooms to third person", () => {
    const resolved = resolveNarrativePov({
      mode: undefined,
      mainCharacterName: "에녹",
      contentKind: "character",
    });
    assert.equal(resolved.mode, "third_person");
    assert.equal(resolved.povCharacterName, "에녹");
  });

  it("automatically uses the main character in a single-character room", () => {
    const resolved = resolveNarrativePov({
      mode: "first_person",
      mainCharacterName: "에녹",
      contentKind: "character",
      povCharacterName: "다른 이름",
    });
    assert.equal(resolved.povCharacterName, "에녹");
  });

  it("forces every multi-character simulation to third person", () => {
    const missing = resolveNarrativePov({
      mode: "first_person",
      mainCharacterName: "시뮬레이션 제목",
      contentKind: "simulation",
    });
    assert.equal(missing.mode, "third_person");
    assert.equal(missing.povCharacterName, "");

    const selected = resolveNarrativePov({
      mode: "first_person",
      mainCharacterName: "시뮬레이션 제목",
      contentKind: "simulation",
      povCharacterName: "권태현",
    });
    assert.equal(selected.mode, "third_person");
    assert.equal(selected.povCharacterName, "");
  });

  it("keeps address, knowledge, and agency rules independent", () => {
    const prompt = buildNarrativePovPrompt({ mode: "first_person", povCharacterName: "권태현" });
    assert.match(prompt, /권태현 자신만.*나\/내/);
    assert.match(prompt, /너\/당신 등으로 강제 치환하지 않는다/);
    assert.match(prompt, /알 수 없는 타인의 내면이나 장면 밖 사건은 서술하지 않는다/);
    assert.match(prompt, /다른 인물은 3인칭/);
    assert.match(prompt, /co-narration, Novel Mode, No Godmodding, Speech Lock/);
  });
});
