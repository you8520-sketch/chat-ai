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
  hasAutoAuthoringAxis,
  parseAuthoringAxesForMask,
  resolveAdminAuthoringDirection,
  resolveAuthoringAxisMask,
  resolveAuthoringPlanAfterExperience,
  resolveOfficialAuthoringPlan,
} from "@/lib/officialSupply/genreProfile";

const MODERN = "현대/일상";
const ALL_AUTO = resolveAuthoringAxisMask({});

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

const MODEL_AXES = { tone: "dry", humor: "light", pacing: "narration", nameWordplay: "none" };

function planFor(selection: Parameters<typeof resolveAdminAuthoringDirection>[0]) {
  return resolveOfficialAuthoringPlan(resolveAdminAuthoringDirection(selection));
}

describe("G5-3W-A per-axis auto", () => {
  it("masks exactly the axes the admin left on auto", () => {
    assert.deepEqual(resolveAuthoringAxisMask({}), {
      tone: true,
      humor: true,
      pacing: true,
      nameWordplay: true,
    });
    assert.deepEqual(resolveAuthoringAxisMask({ tone: "serious" }), {
      tone: false,
      humor: true,
      pacing: true,
      nameWordplay: true,
    });
    assert.deepEqual(resolveAuthoringAxisMask({ humor: "none" }), {
      tone: true,
      humor: false,
      pacing: true,
      nameWordplay: true,
    });
    assert.deepEqual(resolveAuthoringAxisMask({ nameWordplay: "nickname" }), {
      tone: true,
      humor: true,
      pacing: true,
      nameWordplay: false,
    });
    assert.equal(
      hasAutoAuthoringAxis(resolveAuthoringAxisMask({ tone: "serious", humor: "none" })),
      true
    );
    assert.equal(
      hasAutoAuthoringAxis(
        resolveAuthoringAxisMask({
          tone: "serious",
          humor: "none",
          pacing: "dialogue",
          nameWordplay: "pun",
        })
      ),
      false
    );
  });

  it("applies model values only to auto axes and keeps explicit ones", () => {
    // tone fixed, the rest auto
    const toneFixed = resolveAuthoringPlanAfterExperience({
      direction: resolveAdminAuthoringDirection({ genre: MODERN, tone: "serious" }),
      mask: resolveAuthoringAxisMask({ tone: "serious" }),
      axes: MODEL_AXES,
    });
    assert.equal(toneFixed.tone, "serious");
    assert.equal(toneFixed.humor, "light");
    assert.equal(toneFixed.pacing, "narration");
    assert.equal(toneFixed.nameWordplay, "none");

    // humor fixed only
    const humorFixed = resolveAuthoringPlanAfterExperience({
      direction: resolveAdminAuthoringDirection({ genre: MODERN, humor: "none" }),
      mask: resolveAuthoringAxisMask({ humor: "none" }),
      axes: MODEL_AXES,
    });
    assert.equal(humorFixed.humor, "none");
    assert.equal(humorFixed.tone, "dry");

    // nameWordplay fixed only
    const nameFixed = resolveAuthoringPlanAfterExperience({
      direction: resolveAdminAuthoringDirection({ genre: MODERN, nameWordplay: "nickname" }),
      mask: resolveAuthoringAxisMask({ nameWordplay: "nickname" }),
      axes: MODEL_AXES,
    });
    assert.equal(nameFixed.nameWordplay, "nickname");
    assert.equal(nameFixed.tone, "dry");
    assert.equal(nameFixed.humor, "light");

    // all explicit: model answer is ignored
    const explicit = resolveAuthoringPlanAfterExperience({
      direction: resolveAdminAuthoringDirection({
        genre: MODERN,
        tone: "tragic",
        humor: "central",
        pacing: "balanced",
        nameWordplay: "pun",
      }),
      mask: resolveAuthoringAxisMask({
        tone: "tragic",
        humor: "central",
        pacing: "balanced",
        nameWordplay: "pun",
      }),
      axes: MODEL_AXES,
    });
    assert.equal(explicit.tone, "tragic");
    assert.equal(explicit.humor, "central");
    assert.equal(explicit.pacing, "balanced");
    assert.equal(explicit.nameWordplay, "pun");
  });

  it("falls back to the genre recommendation per axis when the model answer is missing or invalid", () => {
    const direction = resolveAdminAuthoringDirection({ genre: MODERN });
    const partial = resolveAuthoringPlanAfterExperience({
      direction,
      mask: ALL_AUTO,
      axes: parseAuthoringAxesForMask({ tone: "dry", humor: "sometimes" }, ALL_AUTO),
    });
    assert.equal(partial.tone, "dry");
    assert.equal(partial.humor, direction.humor);
    assert.equal(partial.pacing, direction.pacing);

    const empty = resolveAuthoringPlanAfterExperience({
      direction,
      mask: ALL_AUTO,
      axes: {},
    });
    assert.equal(empty.tone, direction.tone);
    assert.equal(empty.nameWordplay, direction.nameWordplay);
  });

  it("validates only the masked axes", () => {
    const mask = resolveAuthoringAxisMask({ tone: "serious" });
    assert.deepEqual(parseAuthoringAxesForMask({ ...MODEL_AXES, tone: "light" }, mask), {
      humor: "light",
      pacing: "narration",
      nameWordplay: "none",
    });
    assert.deepEqual(parseAuthoringAxesForMask({ tone: "dry" }, mask), {});
    assert.deepEqual(parseAuthoringAxesForMask({ ...MODEL_AXES, humor: "often" }, mask), {
      pacing: "narration",
      nameWordplay: "none",
    });
    assert.deepEqual(parseAuthoringAxesForMask(null, ALL_AUTO), {});
  });

  it("keeps the 19-genre recommendation untouched and explicit choices first-class", () => {
    assert.equal(resolveAdminAuthoringDirection({ genre: MODERN }).tone, "light");
    assert.equal(resolveAdminAuthoringDirection({ genre: OFFICIAL_ROFAN_GENRE }).tone, "lyrical");
    assert.equal(resolveAdminAuthoringDirection({ genre: MODERN, humor: "none" }).humor, "none");
  });

  it("asks the model for auto axes only, and never treats axes as 12~180-char prose", () => {
    const system = buildCharacterExperienceSystem(ALL_AUTO);
    assert.match(system, /함께 axes를 고른다/);
    assert.match(system, /axes 값은 문장이 아니라 아래 enum 중 하나다/);
    assert.match(system, /desire부터 firstAction까지 각 값은 12~180자/);

    const mixed = buildCharacterExperienceSystem(resolveAuthoringAxisMask({ tone: "serious" }));
    assert.match(mixed, /axes에는 자동인 축만 고른다\(유머·전개·작명\)/);
    assert.match(mixed, /지정된 축\(문체\)은 바꾸지 않는다/);

    const none = buildCharacterExperienceSystem();
    assert.doesNotMatch(none, /axes/);
    assert.match(none, /10개|뿐이다/);
  });

  it("passes fixed axes as constraints and lists only auto axes in the skeleton", () => {
    const user = buildCharacterExperienceUser({
      genre: MODERN,
      gender: "female",
      castIntent: "",
      authoring: planFor({ genre: MODERN, tone: "serious" }),
      autoAxes: resolveAuthoringAxisMask({ tone: "serious" }),
    });
    assert.match(user, /문체: 진지하게 쓴다/);
    assert.match(user, /자동 선택 축: 유머·전개·작명/);
    assert.match(user, /\{"axes":\{"humor":"","pacing":"","nameWordplay":""\}/);
    assert.doesNotMatch(user, /"tone":""/);

    const all = buildCharacterExperienceUser({
      genre: MODERN,
      gender: "female",
      castIntent: "",
      authoring: planFor({ genre: MODERN }),
      autoAxes: ALL_AUTO,
    });
    assert.match(all, /\{"axes":\{"tone":"","humor":"","pacing":"","nameWordplay":""\}/);
  });

  it("returns only the masked axes with the same experience call", async () => {
    const mask = resolveAuthoringAxisMask({ tone: "serious" });
    const result = await generateOfficialCharacterExperience({
      transport: fakeExperienceTransport({ ...CANON, axes: MODEL_AXES }),
      experience: {
        genre: MODERN,
        gender: "female",
        castIntent: "",
        authoring: planFor({ genre: MODERN, tone: "serious" }),
        autoAxes: mask,
      },
    });
    assert.deepEqual(result.axes, { humor: "light", pacing: "narration", nameWordplay: "none" });
    assert.equal(result.experience.desire, CANON.desire);

    const explicit = await generateOfficialCharacterExperience({
      transport: fakeExperienceTransport({ ...CANON, axes: MODEL_AXES }),
      experience: {
        genre: MODERN,
        gender: "female",
        castIntent: "",
        authoring: planFor({ genre: MODERN }),
      },
    });
    assert.deepEqual(explicit.axes, {});
  });
});

describe("G5-3W-B ordinary 사정 stays safe", () => {
  it("accepts the normal phrasings", () => {
    assert.deepEqual(findAdultTermsInText("당신이 이 자리에 있는 사정이나 생각을 먼저 정해 버리지는 않은 채"), []);
    assert.deepEqual(findAdultTermsInText("그 사정이나 사연은 나중에 듣겠습니다"), []);
    assert.deepEqual(findAdultTermsInText("사정이 있어 늦었다"), []);
    assert.deepEqual(findAdultTermsInText("사정은 듣지 못했다"), []);
    assert.deepEqual(findAdultTermsInText("사정도 모른 채 떠났다"), []);
    assert.deepEqual(findAdultTermsInText("사정을 공개하지 않았다"), []);
  });

  it("still catches the verbal and sexual uses", () => {
    for (const text of [
      "사정이나 해",
      "사정이나 했어",
      "사정이라도 해",
      "사정을 참지 못했다",
      "사정했다",
      "사 정",
    ]) {
      assert.ok(findAdultTermsInText(text).includes("사정"), text);
    }
    assert.ok(findAdultTermsInText("섹스").length > 0);
  });
});

describe("G5-3W-C repairable mapping", () => {
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
