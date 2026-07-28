import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasExplicitLegacySecretMarkers,
  preserveLegacySecretBlocksOnPublicDescriptionUpdate,
  toPublicPersonaDescription,
} from "@/lib/personaSecretLegacyMarkers";

describe("toPublicPersonaDescription legacy marker strip", () => {
  it("strips explicit NPC-unknown bracket markers and keeps surrounding public prose", () => {
    const raw = `렌은 신입 S급 가이드다.
[NPC들은 모르는 비밀설정: 천공의 권능 / 공간 조작]
주변 동료들은 그녀를 신입으로만 안다.`;
    const pub = toPublicPersonaDescription(raw);
    assert.match(pub, /신입 S급 가이드/);
    assert.match(pub, /주변 동료들은 그녀를 신입으로만 안다/);
    assert.doesNotMatch(pub, /천공의 권능/);
    assert.doesNotMatch(pub, /공간 조작/);
    assert.doesNotMatch(pub, /NPC들은 모르는/);
  });

  it("supports parenthetical and character-unknown variants", () => {
    const cases = [
      "(NPC들은 모르는 비밀설정: 중력 간섭)",
      "[NPC가 모르는 비밀설정: 중력 간섭]",
      "[캐릭터들은 모르는 설정: 중력 간섭]",
      "[캐릭터는 모르는 비밀: 중력 간섭]",
      "[NPC들은 모르는 비밀설정(관련 서술금지): 중력 간섭]",
    ];
    for (const marker of cases) {
      const pub = toPublicPersonaDescription(`공개 문장. ${marker} 뒤 문장.`);
      assert.match(pub, /공개 문장/);
      assert.match(pub, /뒤 문장/);
      assert.doesNotMatch(pub, /중력 간섭/);
    }
  });

  it("does not strip ambiguous non-NPC markers (false-positive protection)", () => {
    const raw = `렌은 가이드다.
[비밀]
실은 과거에 전투를 했다.
숨겨진 정체를 조사한다.
과거의 비밀을 떠올린다.`;
    const pub = toPublicPersonaDescription(raw);
    assert.match(pub, /\[비밀\]/);
    assert.match(pub, /실은 과거에/);
    assert.match(pub, /숨겨진 정체/);
    assert.match(pub, /과거의 비밀/);
  });

  it("returns only public string — no fragment payload", () => {
    const pub = toPublicPersonaDescription("[NPC들은 모르는 비밀설정: X] 공개");
    assert.equal(typeof pub, "string");
    assert.match(pub, /^공개$/);
    assert.equal(Object.getOwnPropertyNames(Object(pub)).includes("extractedSecretFragments"), false);
  });
});

describe("legacy secret marker preservation on public description update", () => {
  it("detects explicit markers and ignores ambiguous phrases", () => {
    assert.equal(
      hasExplicitLegacySecretMarkers("공개 A\n[NPC들은 모르는 비밀설정: LEGACY_SECRET_NEEDLE]"),
      true
    );
    assert.equal(hasExplicitLegacySecretMarkers("공개 A\n[비밀]\n실은 숨겨진 정체"), false);
  });

  it("preserves opaque legacy blocks when public prose is rewritten", () => {
    const existing = `공개 A
[NPC들은 모르는 비밀설정: LEGACY_SECRET_NEEDLE]`;
    const next = preserveLegacySecretBlocksOnPublicDescriptionUpdate(existing, "공개 B 이름만 바꿈");
    assert.match(next, /공개 B 이름만 바꿈/);
    assert.match(next, /LEGACY_SECRET_NEEDLE/);
    assert.match(next, /NPC들은 모르는 비밀설정/);

    const pub = toPublicPersonaDescription(next);
    assert.match(pub, /공개 B 이름만 바꿈/);
    assert.doesNotMatch(pub, /LEGACY_SECRET_NEEDLE/);
  });

  it("leaves descriptions without markers unchanged", () => {
    assert.equal(
      preserveLegacySecretBlocksOnPublicDescriptionUpdate("공개만", "새 공개"),
      "새 공개"
    );
  });
});
