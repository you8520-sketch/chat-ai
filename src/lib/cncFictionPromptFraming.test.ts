import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADULT_CONTENT_POLICY_CNC_FICTION_FRAME,
  detectCoerciveCncDirectorMeta,
  frameCoerciveCncDirectorUserMessage,
  resolvePromptActiveConsentMode,
} from "@/lib/cncFictionPromptFraming";
import { buildAdultContentPolicyBlock } from "@/lib/advancedProseNsfwGuidelines";

describe("cncFictionPromptFraming", () => {
  it("adds fiction frame block only for cnc_opt_in wire policy", () => {
    assert.ok(buildAdultContentPolicyBlock("standard").includes("허구 RP"));
    assert.ok(!buildAdultContentPolicyBlock("standard").includes("[CNC FICTION FRAME]"));
    assert.ok(buildAdultContentPolicyBlock("cnc_opt_in").includes(ADULT_CONTENT_POLICY_CNC_FICTION_FRAME));
  });

  it("wraps coercive director user line when adult ON", () => {
    const raw =
      "싫다고 하는데 억지로 밀어붙인다. 옷을 벗기고 삽입하는 성인 장면을 이어간다.";
    const framed = frameCoerciveCncDirectorUserMessage(raw, {
      nsfwEnabled: true,
      activeConsentMode: "standard",
    });
    assert.match(framed, /^OOC:/);
    assert.match(framed, /RED\/레드/);
    assert.ok(framed.includes(raw));
  });

  it("uses stronger CNC prefix when cnc_opt_in active", () => {
    const raw = "동의 없이 성인 장면을 이어가.";
    const framed = frameCoerciveCncDirectorUserMessage(raw, {
      nsfwEnabled: true,
      activeConsentMode: "cnc_opt_in",
    });
    assert.match(framed, /사전 합의 CNC/);
  });

  it("promotes wire consent for one turn without changing persisted mode semantics", () => {
    const coercive =
      "싫다고 하는데 억지로 밀어붙인다. 옷을 벗기고 삽입하는 성인 장면을 이어간다.";
    assert.equal(detectCoerciveCncDirectorMeta(coercive), true);
    assert.equal(
      resolvePromptActiveConsentMode({
        persistedConsentMode: "standard",
        currentInput: coercive,
        allowedConsentModes: ["standard", "cnc_opt_in"],
        adultRpEnabled: true,
      }),
      "cnc_opt_in"
    );
    assert.equal(
      resolvePromptActiveConsentMode({
        persistedConsentMode: "standard",
        currentInput: coercive,
        allowedConsentModes: ["standard"],
        adultRpEnabled: true,
      }),
      "standard"
    );
    assert.equal(
      resolvePromptActiveConsentMode({
        persistedConsentMode: "standard",
        currentInput: "차 마시자",
        allowedConsentModes: ["standard", "cnc_opt_in"],
        adultRpEnabled: true,
      }),
      "standard"
    );
  });

  it("does not wrap safe romance or existing OOC", () => {
    assert.equal(
      frameCoerciveCncDirectorUserMessage("오늘 밤 차 한 잔 마시자.", {
        nsfwEnabled: true,
        activeConsentMode: "cnc_opt_in",
      }),
      "오늘 밤 차 한 잔 마시자."
    );
    const ooc = "OOC: CNC 강압 역할극에 사전 동의한다. 세이프워드는 레드다.";
    assert.equal(
      frameCoerciveCncDirectorUserMessage(ooc, {
        nsfwEnabled: true,
        activeConsentMode: "standard",
      }),
      ooc
    );
  });
});
