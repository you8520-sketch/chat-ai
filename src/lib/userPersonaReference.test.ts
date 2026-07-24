import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildUserPersonaReferencePrompt } from "./userPersonaReference";

describe("user persona reference owner", () => {
  it("uses male references for a male persona", () => {
    const prompt = buildUserPersonaReferencePrompt("렌", "male");
    assert.match(prompt, /이름\/호칭: 렌\. 확정 성별: 남성/);
    assert.match(prompt, /"그", "그는", "그가", "그를", "그의"/);
    assert.match(prompt, /반대 성별 대명사 "그녀".*금지/);
  });

  it("uses female references for a female persona", () => {
    const prompt = buildUserPersonaReferencePrompt("라빈", "female");
    assert.match(prompt, /이름\/호칭: 라빈\. 확정 성별: 여성/);
    assert.match(prompt, /"그녀", "그녀는", "그녀가", "그녀를", "그녀의"/);
    assert.match(prompt, /반대 성별 대명사 "그".*금지/);
  });

  it("does not force binary pronouns for an other-gender persona", () => {
    const prompt = buildUserPersonaReferencePrompt("세온", "other");
    assert.match(prompt, /확정 성별: 기타/);
    assert.match(prompt, /설정에 없는 "그\/그녀"를 임의로 고정하지 않는다/);
  });

  it("discourages generic 상대 labels without changing user agency or speech", () => {
    const prompt = buildUserPersonaReferencePrompt("렌", "male");
    assert.match(prompt, /"상대", "상대방", "유저", "사용자".*기본 호칭으로 쓰지 않는다/);
    assert.match(prompt, /캐릭터 말투·관계·Speech Lock·확립된 애칭/);
    assert.match(prompt, /Narrative POV, co-narration, Novel Mode, No Godmodding/);
  });
});
