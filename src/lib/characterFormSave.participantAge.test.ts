import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import type { parseCharacterFormBody as ParseCharacterFormBodyFn } from "@/lib/characterFormSave";

let parseCharacterFormBody: typeof ParseCharacterFormBodyFn;

const adultUser = { id: 1, nickname: "creator", is_adult: 1 as const };

function minimalCharacterBody(overrides: Record<string, unknown> = {}) {
  const speech = "x".repeat(500);
  const promptBlock = "y".repeat(600);
  return {
    content_kind: "character",
    name: "테스트",
    tagline: "한 줄 소개",
    description: "공개 소개",
    greeting: "안녕",
    system_prompt: promptBlock,
    world: promptBlock,
    speech_personality: speech,
    speech_traits: speech,
    speech_examples: speech,
    speech_forbidden: "",
    genres: ["로맨스"],
    gender: "male",
    nsfw: false,
    participant_min_age: 28,
    assets: [{ url: "/uploads/test.png", tag: "neutral" }],
    ...overrides,
  };
}

before(async () => {
  ({ parseCharacterFormBody } = await import("@/lib/characterFormSave"));
});

describe("parseCharacterFormBody structured participant age", () => {
  it("A1 age=28, nsfw=true => confirmed", () => {
    const parsed = parseCharacterFormBody(
      minimalCharacterBody({ nsfw: true, participant_min_age: 28 }),
      adultUser
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.data.participantMinAge, 28);
      assert.equal(parsed.data.adultStatus, "confirmed");
    }
  });

  it("A2 age=18, nsfw=true => reject", () => {
    const parsed = parseCharacterFormBody(
      minimalCharacterBody({ nsfw: true, participant_min_age: 18 }),
      adultUser
    );
    assert.equal(parsed.ok, false);
  });

  it("A3 age=18, nsfw=false => minor", () => {
    const parsed = parseCharacterFormBody(
      minimalCharacterBody({ nsfw: false, participant_min_age: 18 }),
      adultUser
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.data.adultStatus, "minor");
    }
  });

  it("A4 age missing, nsfw=true => reject", () => {
    const parsed = parseCharacterFormBody(
      minimalCharacterBody({ nsfw: true, participant_min_age: "" }),
      adultUser
    );
    assert.equal(parsed.ok, false);
  });

  it("A5 age=32, nsfw=true, lore mentions 7살 딸 => confirmed", () => {
    const parsed = parseCharacterFormBody(
      minimalCharacterBody({
        nsfw: true,
        participant_min_age: 32,
        description: "32세 아버지. 7살 딸이 있다.",
        system_prompt: "y".repeat(600) + " 7살 딸이 있다.",
        world: "y".repeat(600) + " 어린이 NPC",
      }),
      adultUser
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.data.participantMinAge, 32);
      assert.equal(parsed.data.adultStatus, "confirmed");
    }
  });

  it("A7 age=17 with adult audience copy => minor", () => {
    const parsed = parseCharacterFormBody(
      minimalCharacterBody({
        nsfw: false,
        participant_min_age: 17,
        description: "성인인증 후 확인하세요.",
      }),
      adultUser
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.data.adultStatus, "minor");
    }
  });

  it("E1 edit legacy: supplied age 28 => confirmed", () => {
    const parsed = parseCharacterFormBody(
      minimalCharacterBody({ participant_min_age: 28 }),
      adultUser,
      { existingParticipantMinAge: null, requireStructuredAge: false }
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.data.participantMinAge, 28);
      assert.equal(parsed.data.adultStatus, "confirmed");
    }
  });

  it("E2 edit age 17 + nsfw=true => reject", () => {
    const parsed = parseCharacterFormBody(
      minimalCharacterBody({ nsfw: true, participant_min_age: 17 }),
      adultUser,
      { existingParticipantMinAge: 28, requireStructuredAge: false }
    );
    assert.equal(parsed.ok, false);
  });

  it("E7 lore change without age body preserves existing age on edit", () => {
    const parsed = parseCharacterFormBody(
      minimalCharacterBody({
        participant_min_age: undefined,
        description: "7살 딸이 있는 32세 아버지",
      }),
      adultUser,
      { existingParticipantMinAge: 32, requireStructuredAge: false }
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.data.participantMinAge, 32);
      assert.equal(parsed.data.adultStatus, "confirmed");
    }
  });

  it("M1 simulation minimum 24 with child NPC lore => allowed adult mode", () => {
    const speech = "x".repeat(500);
    const promptBlock = "y".repeat(600);
    const parsed = parseCharacterFormBody(
      {
        content_kind: "simulation",
        name: "멀티 시뮬",
        tagline: "한 줄 소개",
        description: "공개 소개",
        greeting: "안녕",
        simulation_cast: promptBlock,
        simulation_rules: "",
        world: promptBlock,
        speech_personality: speech,
        speech_traits: speech,
        speech_examples: speech,
        genres: ["로맨스"],
        nsfw: true,
        participant_min_age: 24,
        assets: [{ url: "/uploads/test.png", tag: "neutral" }],
      },
      adultUser
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.data.participantMinAge, 24);
      assert.equal(parsed.data.adultStatus, "confirmed");
    }
  });
});
