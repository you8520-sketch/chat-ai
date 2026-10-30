import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findAdultTermsInText } from "@/lib/characterAdultText";
import {
  buildCharacterExperienceSystem,
  buildCharacterExperienceUser,
} from "@/lib/officialSupply/authorPrompts";
import { generateOfficialCharacterExperience } from "@/lib/officialSupply/author";
import type { OfficialAuthorTransport } from "@/lib/officialSupply/author";
import { officialVoiceFieldsForQaCodes } from "@/lib/officialSupply/adminAuthorDraft";
import {
  OFFICIAL_ROFAN_GENRE,
  isFullyAutoAuthoringSelection,
  parseOfficialAuthoringAxes,
  recommendOfficialAuthoringDirection,
  resolveAdminAuthoringDirection,
  resolveAuthoringPlanAfterExperience,
  resolveOfficialAuthoringPlan,
} from "@/lib/officialSupply/genreProfile";

const MODERN = "현대/일상";

function fakeExperienceTransport(payload: Record<string, unknown>): OfficialAuthorTransport {
  return {
    label: "fake-experience",
    async completeJson() {
      return {
        text: JSON.stringify(payload),
        model: "fake",
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0,
        providerRequestId: null,
      };
    },
  };
}

const CANON = {
  desire: "조용한 곳에서 혼자 무언가를 고쳐 만드는 일을 끝까지 해내고 싶다.",
  contradiction: "남에게 부탁을 잘 못 하면서, 남이 자기 일을 알아주길 바란다.",
  behavior: "말수는 적지만 손은 빠르다. 상대가 말을 잃으면 도구를 건네며 다음 행동을 기다린다.",
  incident: "고치려던 물건이 오히려 더 망가져서, 처음으로 혼자 해결하지 못한 채 밤을 새웠다.",
  tension: "도움을 청하면 관계가 흐려질까 봐, 혼자 감당할 수 있는 데까지 버티려 한다.",
  daily: "공구를 크기순으로 정리하고, 쓰지 않는 부품을 버리지 못해 상자에 모아 둔다.",
  cost: "혼자 해내려는 고집이 시간을 잡아먹고, 결국 주변에 미안한 일을 만든다.",
  play: "말보다 손으로 먼저 움직이는 인물과 함께, 고장 난 것을 고치며 서로의 방식을 알아 가는 경험.",
  voice: "짧게 말하고 오래 듣는다. 대신 손이 먼저 나가서, 말이 끝나기 전에 도구를 집어 든다.",
  firstAction: "말없이 공구 상자를 열어 나사 하나를 골라 손바닥에 올려놓는다.",
};

const AXES = { tone: "dry", humor: "light", pacing: "narration", nameWordplay: "none" };

describe("G5-3W A — auto axes come from the character, explicit choices win", () => {
  it("detects a fully auto selection and keeps any explicit choice", () => {
    assert.equal(isFullyAutoAuthoringSelection({}), true);
    assert.equal(
      isFullyAutoAuthoringSelection({ tone: "auto", humor: "auto", pacing: "auto", nameWordplay: "auto" }),
      true
    );
    assert.equal(isFullyAutoAuthoringSelection({ tone: "dry" }), false);
    assert.equal(isFullyAutoAuthoringSelection({ nameWordplay: "pun" }), false);
  });

  it("accepts only complete, valid model-chosen axes", () => {
    assert.deepEqual(parseOfficialAuthoringAxes(AXES), AXES);
    assert.equal(parseOfficialAuthoringAxes({ ...AXES, tone: "funny" }), null);
    assert.equal(parseOfficialAuthoringAxes({ ...AXES, humor: "sometimes" }), null);
    assert.equal(parseOfficialAuthoringAxes({ ...AXES, pacing: "fast" }), null);
    assert.equal(parseOfficialAuthoringAxes({ ...AXES, nameWordplay: "initials" }), null);
    assert.equal(parseOfficialAuthoringAxes({ tone: "dry" }), null);
    assert.equal(parseOfficialAuthoringAxes(null), null);
  });

  it("uses the model axes only on auto, and never overrides an explicit admin choice", () => {
    const direction = resolveAdminAuthoringDirection({ genre: MODERN });
    const auto = resolveAuthoringPlanAfterExperience({ direction, autoAxes: true, axes: AXES });
    assert.equal(auto.tone, "dry");
    assert.equal(auto.humor, "light");
    assert.equal(auto.pacing, "narration");
    assert.equal(auto.nameWordplay, "none");

    const explicit = resolveAuthoringPlanAfterExperience({
      direction: resolveAdminAuthoringDirection({ genre: MODERN, tone: "tragic" }),
      autoAxes: false,
      axes: AXES,
    });
    assert.equal(explicit.tone, "tragic");
    assert.equal(explicit.nameWordplay, "nickname");

    const fallback = resolveAuthoringPlanAfterExperience({
      direction,
      autoAxes: true,
      axes: null,
    });
    assert.equal(fallback.tone, direction.tone);
    assert.equal(fallback.humor, direction.humor);
  });

  it("keeps the 19-genre recommendation untouched for the resolver", () => {
    assert.equal(resolveAdminAuthoringDirection({ genre: MODERN }).tone, "light");
    assert.equal(resolveAdminAuthoringDirection({ genre: OFFICIAL_ROFAN_GENRE }).tone, "lyrical");
    assert.equal(resolveAdminAuthoringDirection({ genre: MODERN, humor: "none" }).humor, "none");
  });

  it("asks for axes in the same call only when they are auto", () => {
    const withAxes = buildCharacterExperienceSystem(true);
    assert.match(withAxes, /함께 axes를 고른다/);
    assert.match(withAxes, /axes는 이 인물에게 맞는 문체/);
    const without = buildCharacterExperienceSystem(false);
    assert.doesNotMatch(without, /axes/);
    assert.match(without, /10개|뿐이다/);

    const user = buildCharacterExperienceUser({
      genre: MODERN,
      gender: "female",
      castIntent: "",
      authoring: resolveOfficialAuthoringPlan(
        resolveAdminAuthoringDirection({ genre: MODERN })
      ),
      chooseAxes: true,
    });
    assert.match(user, /"axes":\{"tone":"","humor":"","pacing":"","nameWordplay":""\}/);
    assert.doesNotMatch(user, /문체: 경쾌/);
  });

  it("returns the chosen axes with the same experience call", async () => {
    const result = await generateOfficialCharacterExperience({
      transport: fakeExperienceTransport({ ...CANON, axes: AXES }),
      experience: {
        genre: MODERN,
        gender: "female",
        castIntent: "",
        authoring: resolveOfficialAuthoringPlan(
          resolveAdminAuthoringDirection({ genre: MODERN })
        ),
        chooseAxes: true,
      },
    });
    assert.deepEqual(result.axes, AXES);
    assert.equal(result.experience.desire, CANON.desire);

    const explicit = await generateOfficialCharacterExperience({
      transport: fakeExperienceTransport({ ...CANON, axes: AXES }),
      experience: {
        genre: MODERN,
        gender: "female",
        castIntent: "",
        authoring: resolveOfficialAuthoringPlan(
          resolveAdminAuthoringDirection({ genre: MODERN })
        ),
      },
    });
    assert.equal(explicit.axes, null);
  });
});

describe("G5-3W B — ordinary 사정 is not an adult term", () => {
  it("accepts the observed ordinary phrasing", () => {
    assert.deepEqual(findAdultTermsInText("당신이 이 자리에 있는 사정이나 생각을 먼저 정해 버리지는 않은 채"), []);
    assert.deepEqual(findAdultTermsInText("그 사정이나 사연은 나중에 듣겠습니다"), []);
    assert.deepEqual(findAdultTermsInText("사정이 있어 늦었다"), []);
    assert.deepEqual(findAdultTermsInText("사정은 듣지 못했다"), []);
    assert.deepEqual(findAdultTermsInText("사정도 모른 채 떠났다"), []);
    assert.deepEqual(findAdultTermsInText("사정을 공개하지 않았다"), []);
  });

  it("still catches sexual usage and evasion", () => {
    assert.ok(findAdultTermsInText("그는 사정을 했다").includes("사정"));
    assert.ok(findAdultTermsInText("사정을 참지 못했다").includes("사정"));
    assert.ok(findAdultTermsInText("사정했다").includes("사정"));
    assert.ok(findAdultTermsInText("사 정").includes("사정"));
    assert.ok(findAdultTermsInText("섹스").length > 0);
  });
});

describe("G5-3W C — the two band issues are the only repairable ones", () => {
  it("maps the band codes to speech/pitch and the adult-term code to no field", () => {
    assert.deepEqual(officialVoiceFieldsForQaCodes(["bible_speech_band"]), ["speech"]);
    assert.deepEqual(officialVoiceFieldsForQaCodes(["bible_pitch_band"]), ["publicDescription"]);
    assert.deepEqual(officialVoiceFieldsForQaCodes(["sfw_public_text_has_adult_terms"]), []);
    assert.deepEqual(
      officialVoiceFieldsForQaCodes(["bible_speech_band", "bible_pitch_band"]).sort(),
      ["publicDescription", "speech"]
    );
  });
});
