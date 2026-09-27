/**
 * Prompt budget gate for the Legacy Main RP prose owner.
 *
 * Deterministic assembly checks on buildContext() output for every active Main RP
 * model — no model output, no provider calls.
 */
import Module from "module";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { buildContext } from "@/services/contextBuilder";
import { estimateTokens } from "@/lib/tokenEstimate";
import {
  COMMON_PROSE_BLOCK,
  PROSE_STYLE_SECTION,
} from "@/lib/advancedProseNsfwGuidelines";
import { SCENE_FLOW_BLOCK } from "@/lib/generationProcessBeatFlow";
import { MAIN_RP_MODEL_IDS, isGemini31ProModel } from "@/lib/chatModels";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
import { GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE } from "@/lib/gemini31UserAgencyAdapter";
import { buildCompactTerminalLayoutRecencyLine } from "@/lib/webnovelOutputFormat";

/** Agreed cap for the single common prose owner (local estimateTokens). */
const COMMON_PROSE_TOKEN_CAP = 600;

const RETIRED_LEGACY_PROSE_HEADERS = [
  "[NARRATION REGISTER]",
  "[RHYTHM]",
  "[SENSATION]",
  "[IMMERSIVE PROSE]",
  "[WEBNOVEL BREATH]",
] as const;

const FIXTURE_INPUT = {
  charName: "백하율",
  contentKind: "character" as const,
  chunks: [],
  userNickname: "렌",
  userPersona: "PERSONA_FIXTURE",
  userNote: "",
  longTermMemory: "LTM_FIXTURE",
  archiveMemory: null,
  shortTermHistory: [
    { role: "user" as const, content: "밖이 시끄러워서… 여기 창가 쪽이 제일 조용하네." },
    { role: "assistant" as const, content: "백하율은 창틀에 손을 올린 채 잠시 거리를 내려다보았다." },
  ],
  currentUserMessage: "…잠깐만. 이 자리, 조금만 더 있어도 돼?",
  nsfw: false,
  gender: "male" as const,
  userId: 1,
  chatId: 1,
  targetResponseChars: 3200,
  completedTurns: 2,
  provider: "cheaperinference" as const,
  personaDisplayName: "렌",
  userPersonaGender: null,
};

function forceProdProseEnv() {
  for (const k of [
    "SHARED_NOVEL_PROSE_V2_ENABLED",
    "SHARED_NOVEL_PROSE_V2_USER_IDS",
    "PROSE_VNEXT_ENABLED",
    "PROSE_VNEXT_ROLLOUT_ENABLED",
    "PROSE_VNEXT_ROLLOUT_MODEL_IDS",
    "GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY",
  ]) {
    delete process.env[k];
  }
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function assemble(modelId: string) {
  forceProdProseEnv();
  const built = buildContext({ ...FIXTURE_INPUT, modelId });
  const system = built.systemPrompt ?? "";
  const lastUser = String(built.history[built.history.length - 1]?.content ?? "");
  return { system, lastUser };
}

describe("Legacy Main RP common prose budget gate", () => {
  it("common prose owner stays within the agreed token cap", () => {
    const tokens = estimateTokens(COMMON_PROSE_BLOCK);
    assert.ok(tokens <= COMMON_PROSE_TOKEN_CAP, `common prose ${tokens} > ${COMMON_PROSE_TOKEN_CAP}`);
  });

  it("prose style section = common owner + scene-flow pacing anchor only", () => {
    assert.equal(PROSE_STYLE_SECTION, `${COMMON_PROSE_BLOCK}\n\n${SCENE_FLOW_BLOCK}`);
    for (const header of RETIRED_LEGACY_PROSE_HEADERS) {
      assert.equal(count(PROSE_STYLE_SECTION, header), 0, header);
    }
  });

  for (const modelId of MAIN_RP_MODEL_IDS) {
    it(`${modelId}: one common prose owner, no retired prose headers`, () => {
      const { system } = assemble(modelId);
      assert.equal(count(system, "[COMMON PROSE]"), 1);
      assert.equal(count(system, COMMON_PROSE_BLOCK), 1);
      for (const header of RETIRED_LEGACY_PROSE_HEADERS) {
        assert.equal(count(system, header), 0, header);
      }
    });

    it(`${modelId}: layout and length owners unchanged`, () => {
      const { system, lastUser } = assemble(modelId);
      assert.equal(count(system, "[OUTPUT LAYOUT]"), 1);
      assert.equal(count(system, "[DIALOGUE & NARRATION]"), 1);
      assert.equal(count(lastUser, buildCompactTerminalLayoutRecencyLine()), 1);
      assert.equal(count(lastUser, USER_TAIL_LENGTH_OWNER_SENTENCE), 1);
      assert.ok(lastUser.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
      assert.equal(count(system, USER_TAIL_LENGTH_OWNER_SENTENCE), 0);
    });

    it(`${modelId}: Gemini 3.1 agency adapter only on Gemini 3.1`, () => {
      const { system } = assemble(modelId);
      assert.equal(
        count(system, GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE),
        isGemini31ProModel(modelId) ? 1 : 0
      );
    });
  }
});
