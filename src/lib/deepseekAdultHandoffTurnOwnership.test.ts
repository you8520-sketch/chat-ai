import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { adaptCheaperInferenceChatBody } from "./cheaperInferenceConfig";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "./chatModels";
import {
  evaluateExperimentAFixtureProvenance,
  EXPERIMENT_A_SOURCE_RAW_SHA256,
  verifyCommittedExperimentASourceRaw,
} from "./deepseekAdultHandoffExperimentAProvenance";
import {
  appendDeepSeekTurnOwnershipBlock,
  countPromptOccurrences,
  DEEPSEEK_HANDOFF_TURN_OWNERSHIP,
  DEEPSEEK_HANDOFF_TURN_OWNERSHIP_HEADER,
  DEEPSEEK_TURN_OWNERSHIP_T1_CHALLENGER,
  DEEPSEEK_TURN_OWNERSHIP_T1_PRODUCTION,
} from "./deepseekAdultHandoffTurnOwnership";

describe("Turn Ownership T1 candidate", () => {
  it("locks the exact candidate wording and keeps production off", () => {
    assert.equal(
      DEEPSEEK_HANDOFF_TURN_OWNERSHIP,
      `${DEEPSEEK_HANDOFF_TURN_OWNERSHIP_HEADER}
현재 user 입력에 이미 명시된 행동·의사·요청은 확정된 것으로 받아들이고 불필요하게 다시 확인하지 않는다. 그 입력에 직접 이어지는 캐릭터의 행동과 자연스러운 결과·반응은 진행한다.
그러나 현재 user 입력에 없는 새로운 의미 있는 user 대사·의도·결정·동의·거절·관계 결정을 대신 만들지 않는다. user의 침묵·시선·표정·반사적인 신체 반응이나 assistant가 새로 서술한 user 반응을 새로운 선택의 근거로 확정하지 않는다.
현재 user가 시작한 상호작용의 직접적인 결과까지는 진행하되, 입력에서 정해지지 않은 새로운 상호작용 단계로 임의로 넘어가지 않는다.`
    );
    assert.equal(DEEPSEEK_TURN_OWNERSHIP_T1_PRODUCTION.applyTurnOwnership, false);
    assert.equal(DEEPSEEK_TURN_OWNERSHIP_T1_CHALLENGER.applyTurnOwnership, true);
    const baseline = appendDeepSeekTurnOwnershipBlock(
      "같이 갈래? *두리번*",
      DEEPSEEK_TURN_OWNERSHIP_T1_PRODUCTION.applyTurnOwnership
    );
    const challenger = appendDeepSeekTurnOwnershipBlock(
      "같이 갈래? *두리번*",
      DEEPSEEK_TURN_OWNERSHIP_T1_CHALLENGER.applyTurnOwnership
    );
    assert.equal(countPromptOccurrences(baseline, DEEPSEEK_HANDOFF_TURN_OWNERSHIP), 0);
    assert.equal(countPromptOccurrences(challenger, DEEPSEEK_HANDOFF_TURN_OWNERSHIP), 1);
    assert.equal(
      countPromptOccurrences(
        appendDeepSeekTurnOwnershipBlock(challenger, true),
        DEEPSEEK_HANDOFF_TURN_OWNERSHIP
      ),
      1
    );
    assert.equal(baseline.includes("Source Mirror"), false);
    assert.equal(challenger.includes("[DEEPSEEK HANDOFF — SCENE COMPLETION]"), false);
    assert.equal(challenger.includes("[HANDOFF ORIGIN]"), false);
  });

  it("does not change production DeepSeek transport", () => {
    const body = adaptCheaperInferenceChatBody({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hello" }],
      reasoning_effort: "high",
    });
    assert.equal(body.model, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.reasoning_effort, undefined);
  });

  it("is not imported or enabled by the production chat route", () => {
    const routePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../app/api/chat/route.ts"
    );
    const route = readFileSync(routePath, "utf8");
    assert.equal(route.includes("deepseekAdultHandoffTurnOwnership"), false);
    assert.equal(route.includes("DEEPSEEK HANDOFF — TURN OWNERSHIP"), false);
    assert.equal(route.includes("deepseekAdultHandoffExperimentAProvenance"), false);
  });
});

describe("Experiment A primary fixture provenance", () => {
  it("keeps the committed S3-A source RAW SHA and fails closed", () => {
    const raw = verifyCommittedExperimentASourceRaw();
    assert.equal(raw.matchesFrozenSha, true);
    assert.equal(raw.sha256, EXPERIMENT_A_SOURCE_RAW_SHA256);
    const provenance = evaluateExperimentAFixtureProvenance();
    assert.equal(provenance.PRIMARY_FIXTURE_PROVEN, false);
    assert.equal(provenance.PRIMARY_LIVE_CALLS, 0);
    assert.equal(provenance.ANTI_PASSIVITY_CALLS, 0);
    assert.equal(provenance.TOTAL_NEW_CALLS, 0);
    assert.equal(provenance.fields.sourceAssistantRaw, "proven");
    assert.equal(provenance.fields.matchingCurrentUser, "mismatched");
    assert.equal(provenance.fields.character, "stub");
    assert.equal(provenance.fields.speechLock, "missing");
    assert.equal(provenance.styleAdapters.TURN_OWNERSHIP, 0);
    assert.equal(provenance.styleAdapters.COMPLETION, 0);
    assert.equal(provenance.styleAdapters.SOURCE_MIRROR_PRODUCTION, false);
  });
});
