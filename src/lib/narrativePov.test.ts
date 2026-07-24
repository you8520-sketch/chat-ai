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
    assert.match(prompt, /직전 AI 본문의 시점과 무관하게.*1인칭으로 전환/);
    assert.match(prompt, /너\/당신 등으로 강제 치환하지 않는다/);
    assert.match(prompt, /알 수 없는 타인의 내면이나 장면 밖 사건은 서술하지 않는다/);
    assert.match(prompt, /다른 인물은 이름 또는 3인칭/);
    assert.match(prompt, /co-narration, Novel Mode, No Godmodding, Speech Lock/);
  });

  it("explicitly switches third-person prose even after first-person history", () => {
    const prompt = buildNarrativePovPrompt({ mode: "third_person", povCharacterName: "권태현" });
    assert.match(prompt, /직전 AI 본문의 시점과 무관하게.*3인칭 소설형으로 전환/);
    assert.match(prompt, /과거 본문의 1인칭 문체를 이어 쓰거나 모방하지 않는다/);
    assert.match(prompt, /나\/나는\/내가\/나를\/내\/나의 등의 1인칭 자기지칭을 사용하지 않는다/);
    assert.match(prompt, /따옴표 안의 대사.*1인칭.*허용/);
    assert.match(prompt, /나도\/나만\/나에게\/내게.*1인칭 자기지칭이 0개인지 확인/);
    assert.match(prompt, /"나도 모르게 웃음이 나왔다"가 아니라 "권태현도 모르게/);
  });
});
