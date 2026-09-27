/**
 * Subject-aware hair policy + sanitizer reproduction matrix.
 * Run: node --conditions=react-server --import tsx --test src/lib/bodyHairRules.subjectPolicy.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildHairSanitizeContext,
  parseFacialHairFromText,
  parseBodyHairFromText,
  resolveCharacterSubjectHairPolicy,
  resolveUserPersonaSubjectHairPolicy,
  sanitizeHairDescriptions,
} from "@/lib/bodyHairRules";

function ctx(
  overrides: Partial<{
    charName: string;
    setting: string;
    personaName: string;
    personaText: string;
    charGender: "male" | "female" | "other";
    userGender: "male" | "female" | "other";
  }> = {}
) {
  return buildHairSanitizeContext({
    characterName: overrides.charName ?? "하율",
    characterGender: overrides.charGender ?? "male",
    characterAppearanceText: overrides.setting ?? "키 178cm, 검은 머리.",
    personaName: overrides.personaName ?? "렌",
    personaText: overrides.personaText ?? "20대 남성.",
    userGender: overrides.userGender ?? "male",
  });
}

describe("presence / absence parsing", () => {
  it("B: explicit absence — 수염 없음 is absent, not present", () => {
    const facial = parseFacialHairFromText("수염 없음. 깔끔한 턱.", "male");
    assert.equal(facial.presence, "absent");
    assert.equal(facial.evidence, "explicit_absent");
    assert.equal(
      resolveCharacterSubjectHairPolicy("male", "수염 없음").facialHair,
      "absent"
    );
  });

  it("explicit presence — 턱수염이 있다", () => {
    const facial = parseFacialHairFromText("턱수염이 있다.", "male");
    assert.equal(facial.presence, "present");
    assert.equal(facial.evidence, "explicit_present");
  });

  it("no mention defaults to absent for male character", () => {
    assert.equal(parseFacialHairFromText("키 180cm", "male").presence, "absent");
    assert.equal(parseBodyHairFromText("키 180cm").presence, "absent");
  });

  it("explicit canon outranks gender defaults", () => {
    assert.equal(parseFacialHairFromText("턱수염이 있다", "female").presence, "present");
    assert.equal(parseFacialHairFromText("키 170cm", "female").presence, "absent");
  });
});

describe("subject-aware sanitizer", () => {
  it("A: drops AI character beard, preserves USER_PERSONA beard", () => {
    const input =
      "하율은 고개를 돌렸다. 하율의 턱수염이 거칠었다. 렌의 턱수염이 스치듯 닿았다. 둘은 웃었다.";
    const out = sanitizeHairDescriptions(
      input,
      ctx({
        personaText: "30대 남성 형사. 짧게 기른 턱수염.",
      })
    );
    assert.doesNotMatch(out, /하율의 턱수염/);
    assert.match(out, /렌의 턱수염/);
    assert.match(out, /둘은 웃었다/);
  });

  it("D: preserves NPC beard when character has no beard", () => {
    const input =
      "옆 테이블의 김 형사는 턱수염을 쓰다듬었다. 하율은 고개를 끄덕였다.";
    const out = sanitizeHairDescriptions(input, ctx());
    assert.match(out, /김 형사는 턱수염/);
    assert.match(out, /하율은 고개를 끄덕/);
  });

  it("one-syllable persona alias does not match inside unrelated words", () => {
    const input =
      "렌즈 옆의 김 형사는 턱수염을 쓰다듬었다. 하율은 고개를 끄덕였다.";
    const out = sanitizeHairDescriptions(input, ctx({ personaName: "렌" }));
    assert.match(out, /김 형사는 턱수염/);
  });

  it("C: ambiguous beard dropped when both primary subjects disallow", () => {
    const input = "턱수염이 거칠게 자라 있었다. 그는 고개를 돌렸다.";
    const out = sanitizeHairDescriptions(input, ctx());
    assert.doesNotMatch(out, /턱수염/);
    assert.match(out, /고개를 돌렸다/);
  });

  it("ambiguous beard kept when persona allows beard", () => {
    const input = "턱수염이 스치듯 닿았다. 숨이 가빠졌다.";
    const out = sanitizeHairDescriptions(
      input,
      ctx({ personaText: "턱수염이 짧게 자란 30대 남성." })
    );
    assert.match(out, /턱수염/);
  });

  it("stubble on character removed when facial hair absent", () => {
    const input = "하율의 턱선이 까칠하게 스쳤다. 렌은 숨을 삼켰다.";
    const out = sanitizeHairDescriptions(input, ctx());
    assert.doesNotMatch(out, /까칠/);
    assert.match(out, /렌은 숨을/);
  });

  it("stubble on persona preserved when persona has beard canon", () => {
    const input = "렌의 턱선이 까칠하게 스쳤다. 하율은 미소 지었다.";
    const out = sanitizeHairDescriptions(
      input,
      ctx({ personaText: "짧은 턱수염을 기른 남성." })
    );
    assert.match(out, /까칠/);
  });
});

describe("required matrix — explicit character vs persona sentences", () => {
  const cases: Array<{
    label: string;
    charBeard: boolean;
    userBeard: boolean;
    sentence: string;
    expectDrop: boolean;
  }> = [
    {
      label: "char explicit beard / char absent",
      charBeard: false,
      userBeard: false,
      sentence: "하율의 수염이 짙었다. 하율은 고개를 돌렸다.",
      expectDrop: true,
    },
    {
      label: "persona explicit beard / user present",
      charBeard: false,
      userBeard: true,
      sentence: "렌의 수염이 짙었다. 하율은 지켜봤다.",
      expectDrop: false,
    },
    {
      label: "persona explicit / user absent",
      charBeard: true,
      userBeard: false,
      sentence: "렌의 수염이 짙었다. 하율은 지켜봤다.",
      expectDrop: true,
    },
    {
      label: "char explicit / char present",
      charBeard: true,
      userBeard: false,
      sentence: "하율의 수염이 짙었다. 하율은 미소 지었다.",
      expectDrop: false,
    },
  ];

  for (const c of cases) {
    it(c.label, () => {
      const setting = c.charBeard ? "턱수염이 있다." : "수염 없음.";
      const personaText = c.userBeard ? "턱수염이 짧다." : "20대 남성.";
      const out = sanitizeHairDescriptions(
        c.sentence,
        ctx({ setting, personaText })
      );
      if (c.expectDrop) assert.doesNotMatch(out, /수염/);
      else assert.match(out, /수염/);
    });
  }
});

describe("user persona policy resolver", () => {
  it("reads beard from persona description", () => {
    const p = resolveUserPersonaSubjectHairPolicy(
      "male",
      "30대 형사. 짧게 기른 턱수염."
    );
    assert.equal(p.facialHair, "present");
  });
});
