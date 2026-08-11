import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildChatImagePairGenderLock,
  buildChatImageSubjectGenderLock,
  genderWordForImagePrompt,
  resolveChatImageGenderPair,
  resolveImagePromptGender,
} from "./chatImageGender";

describe("chatImageGender", () => {
  it("resolves DB gender strings for every image mode", () => {
    assert.equal(resolveImagePromptGender("male"), "male");
    assert.equal(resolveImagePromptGender("female"), "female");
    assert.equal(resolveImagePromptGender("other"), "other");
    assert.equal(resolveImagePromptGender(""), "other");
    assert.equal(resolveImagePromptGender(null), "other");
  });

  it("builds a required pair lock used by comic / SD / emoticon / LD tabs", () => {
    const lock = buildChatImagePairGenderLock({
      characterName: "라이크",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
    });
    assert.match(lock, /GENDER LOCK/);
    assert.match(lock, /chat character 라이크: confirmed MALE/);
    assert.match(lock, /user persona 렌: confirmed MALE/);
    assert.match(lock, /must NOT be interpreted as female/);
  });

  it("builds a single-subject lock for persona portrait generation", () => {
    const lock = buildChatImageSubjectGenderLock({
      label: "user persona",
      name: "라온",
      gender: "female",
    });
    assert.match(lock, /user persona 라온: confirmed FEMALE/);
    assert.match(lock, /must NOT be interpreted as male/);
  });

  it("exposes gender words for planner / reference captions", () => {
    assert.equal(genderWordForImagePrompt("male"), "male");
    assert.equal(genderWordForImagePrompt("female"), "female");
    assert.equal(genderWordForImagePrompt("other"), "gender-unspecified");
  });

  it("resolves character + persona genders together for route contexts", () => {
    assert.deepEqual(
      resolveChatImageGenderPair({
        characterName: " 라이크 ",
        characterGender: "male",
        personaName: " 렌 ",
        personaGender: "female",
      }),
      {
        characterName: "라이크",
        characterGender: "male",
        personaName: "렌",
        personaGender: "female",
      }
    );
  });
});
