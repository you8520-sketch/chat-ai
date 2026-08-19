import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ADULT_SCENE_MIN_AGE,
  deriveAdultStatusFromParticipantMinAge,
  parseParticipantMinAgeInput,
  resolveParticipantMinAgeForSave,
  validateNsfwParticipantAgeContract,
  validateParticipantMinAgeValue,
} from "./participantMinAge";

describe("participantMinAge validation", () => {
  it("V1 negative age => reject", () => {
    assert.equal(validateParticipantMinAgeValue(-1), "나이는 1 이상이어야 합니다.");
  });

  it("V2 zero => reject", () => {
    assert.equal(validateParticipantMinAgeValue(0), "나이는 1 이상이어야 합니다.");
  });

  it("V3 decimal => reject", () => {
    assert.equal(parseParticipantMinAgeInput(17.5).ok, false);
    assert.equal(parseParticipantMinAgeInput("17.5").ok, false);
  });

  it("V4 non-number => reject", () => {
    assert.equal(parseParticipantMinAgeInput("abc").ok, false);
  });

  it("V5 absurd/out-of-range => reject", () => {
    assert.equal(validateParticipantMinAgeValue(1000), "나이는 999 이하여야 합니다.");
  });

  it("V6 missing required official form age => reject", () => {
    const result = resolveParticipantMinAgeForSave({
      bodyValue: "",
      requireStructuredAge: true,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /나이/);
    }
  });
});

describe("participantMinAge NSFW contract", () => {
  it("S1 nsfw never auto-confirms missing age", () => {
    assert.equal(
      validateNsfwParticipantAgeContract({ nsfw: true, participantMinAge: null }),
      "성인용 캐릭터로 설정하려면 나이를 입력해 주세요."
    );
  });

  it("A2 age=18, nsfw=true => reject", () => {
    assert.equal(
      validateNsfwParticipantAgeContract({ nsfw: true, participantMinAge: 18 }),
      "성인용 캐릭터/시뮬레이션은 성인 장면 참여 가능 인물이 모두 만 19세 이상이어야 합니다."
    );
  });

  it("A1 age=28, nsfw=true => allowed", () => {
    assert.equal(
      validateNsfwParticipantAgeContract({ nsfw: true, participantMinAge: 28 }),
      null
    );
  });
});

describe("participantMinAge adult_status derivation", () => {
  it("A1 age=28 => confirmed", () => {
    assert.equal(deriveAdultStatusFromParticipantMinAge(28), "confirmed");
  });

  it("A3 age=18 => minor", () => {
    assert.equal(deriveAdultStatusFromParticipantMinAge(18), "minor");
  });

  it("uses ADULT_SCENE_MIN_AGE threshold 19", () => {
    assert.equal(ADULT_SCENE_MIN_AGE, 19);
    assert.equal(deriveAdultStatusFromParticipantMinAge(19), "confirmed");
    assert.equal(deriveAdultStatusFromParticipantMinAge(18), "minor");
  });
});
