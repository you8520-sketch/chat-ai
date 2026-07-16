import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectUserPovTakeover } from "@/lib/userPovTakeoverDetector";

const userCharacterName = "테스트_유저_캐릭터";
const aiCharacterName = "테스트_AI_캐릭터";

describe("USER_POV_TAKEOVER detector", () => {
  it("flags repeated user-character internal narration", () => {
    const text = [
      `${userCharacterName}은 그 감정을 깨달았다. 마음속으로 자신도 몰랐던 욕망을 떠올렸다.`,
      "",
      `${userCharacterName}는 과거를 스스로 해석하며 결심했다. ${aiCharacterName}과의 미래를 원했다고 느꼈다.`,
      "",
      `속으로 "${userCharacterName}의 정체성을 이제 알았다"고 다짐했다.`,
    ].join("\n");

    const hit = detectUserPovTakeover(text, {
      mode: "auto_progression",
      userAliases: [userCharacterName, "[B]"],
    });
    assert.equal(hit.flagged, true);
    assert.equal(hit.reason, "USER_POV_TAKEOVER");
    assert.ok(hit.matchedCount >= 3);
  });

  it("does not flag ordinary external actions", () => {
    const text = [
      `${userCharacterName}이 문을 열고 안으로 들어갔다.`,
      "",
      `${aiCharacterName}이 서류를 펼치며 짧게 말했다. "이쪽이다."`,
      "",
      `창밖의 경보가 울리자 다른 NPC가 복도로 달려 나갔다.`,
    ].join("\n");

    const hit = detectUserPovTakeover(text, {
      mode: "auto_progression",
      userAliases: [userCharacterName, "[B]"],
    });
    assert.equal(hit.flagged, false);
  });

  it("ignores non-auto_progression modes", () => {
    const text = [
      `${userCharacterName}은 깨달았다.`,
      "",
      `${userCharacterName}는 결심했다. 원했다. 느꼈다.`,
    ].join("\n");
    const hit = detectUserPovTakeover(text, {
      mode: "interactive",
      userAliases: [userCharacterName],
    });
    assert.equal(hit.flagged, false);
  });

  it("does not hardcode production character names", () => {
    assert.doesNotMatch(
      String(detectUserPovTakeover),
      /백하율|체향|에카르트/
    );
  });
});
