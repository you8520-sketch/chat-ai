import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { buildContinueNarrativeCommand } from "@/lib/continueNarrative";
import {
  buildCurrentUserInputWrapper,
  wrapCurrentUserInput,
} from "@/lib/currentUserInputLabel";
import {
  buildNoGodmoddingBlock,
  CURRENT_TURN_OOC_DELEGATION_OWNER_TITLE,
} from "@/lib/noGodmodding";
import { buildContext } from "@/services/contextBuilder";

const user = "테스트_유저_캐릭터";
const ai = "테스트_AI_캐릭터";

/** Frozen on main b06037dd before P2 wiring. */
const FROZEN = {
  STANDARD_OWNER: "3f2778a81813ef5ca5d222b5de0e371aeadf030c323b4a254bea78f3e191f576",
  AUTO_OWNER: "43155d2d707de17fdd1e25f1857b07df0c5448da7fe5e9d84cf24675c3b2bada",
  CO_OWNER: "3a494f44bdc04854a288706c15d5d675b7d6da4bf718100677b23d388b5b622d",
  WRAP_MANUAL: "1f3e645d965bcefb7cf47bd1ec2774e97408e990c6c4cd952572d509ac83369f",
  WRAP_AUTO: "308aca03db4645f6df2e8a97de9fbd15063954e131029b5b0b316275a9e66d7f",
  WRAP_OOC: "b27d927afab1ec2e24a6192a66cdd33acd1e64d82e153cd19e5f9ea8dd59174f",
  MANUAL_SYSTEM: "290a994dea7180d6b18032dc12a6e9a4d18e551951091cdc1fc43595838d7975",
  MANUAL_USER: "9b43e278c3cd79d3c27306429276b194d76fd76e92fed9b8aca7501384ac1565",
  AUTO_SYSTEM: "0519439eb2c64b9bf4801cdd148c1b2490ef05155117d3167687f37b3cc87489",
  AUTO_USER: "920a2bcf89a77f79a54e0a9db6e2d7455d7914d83a18ab58fa876dfde3c95587",
  STRUCTURED_SYSTEM: "39059813b56d4a6b52da188e1988ce0b9708bad3cb80c861e74b0e2398366a6a",
} as const;

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function lastUserContent(built: ReturnType<typeof buildContext>): string {
  return built.history[built.history.length - 1]?.content ?? "";
}

describe("current-turn OOC delegation prompt parity", () => {
  it("MANUAL owner / wrapper / assembled prompt SHA unchanged", () => {
    assert.equal(sha(buildNoGodmoddingBlock(ai, user, "standard")), FROZEN.STANDARD_OWNER);
    assert.equal(sha(wrapCurrentUserInput("안녕.", { mode: "interactive" })), FROZEN.WRAP_MANUAL);

    const built = buildContext({
      charName: ai,
      chunks: [],
      userNickname: user,
      userPersona: `이름/호칭: ${user}`,
      shortTermHistory: [],
      currentUserMessage: "안녕.",
      nsfw: false,
      provider: "openrouter",
      isContinue: false,
      novelModeEnabled: false,
      userImpersonation: false,
      personaDisplayName: user,
      completedTurns: 2,
    });
    assert.equal(sha(built.systemPrompt), FROZEN.MANUAL_SYSTEM);
    assert.equal(sha(lastUserContent(built)), FROZEN.MANUAL_USER);
    assert.match(built.systemPrompt, /\[USER CONTROL — COLLABORATIVE INTERACTIVE\]/);
    assert.doesNotMatch(built.systemPrompt, /CURRENT-TURN OOC DELEGATION/);
  });

  it("AUTO owner / wrapper / assembled prompt SHA unchanged", () => {
    assert.equal(sha(buildNoGodmoddingBlock(ai, user, "autoContinue")), FROZEN.AUTO_OWNER);
    assert.equal(
      sha(wrapCurrentUserInput("자동진행", { mode: "auto_progression" })),
      FROZEN.WRAP_AUTO
    );

    const currentUserMessage = buildContinueNarrativeCommand({
      personaName: user,
      charName: ai,
    });
    const built = buildContext({
      charName: ai,
      chunks: [],
      userNickname: user,
      userPersona: `이름/호칭: ${user}`,
      shortTermHistory: [],
      currentUserMessage,
      nsfw: false,
      provider: "openrouter",
      isContinue: true,
      novelModeEnabled: false,
      userImpersonation: false,
      personaDisplayName: user,
      completedTurns: 2,
    });
    assert.equal(sha(built.systemPrompt), FROZEN.AUTO_SYSTEM);
    assert.equal(sha(lastUserContent(built)), FROZEN.AUTO_USER);
    assert.match(built.systemPrompt, /\[AUTO PROGRESSION — AI-FOCAL CO-NARRATION\]/);
    assert.doesNotMatch(built.systemPrompt, /CURRENT-TURN OOC DELEGATION/);
  });

  it("existing structured opt-in owner / assembled prompt SHA unchanged", () => {
    assert.equal(sha(buildNoGodmoddingBlock(ai, user, "coNarration")), FROZEN.CO_OWNER);
    assert.equal(
      sha(wrapCurrentUserInput("안녕.", { mode: "ooc_user_impersonation_allowed" })),
      FROZEN.WRAP_OOC
    );

    const built = buildContext({
      charName: ai,
      chunks: [],
      userNickname: user,
      userPersona: `이름/호칭: ${user}`,
      shortTermHistory: [],
      currentUserMessage: "안녕.",
      nsfw: false,
      provider: "openrouter",
      isContinue: false,
      novelModeEnabled: false,
      userImpersonation: true,
      personaDisplayName: user,
      completedTurns: 2,
    });
    assert.equal(sha(built.systemPrompt), FROZEN.STRUCTURED_SYSTEM);
    assert.match(built.systemPrompt, /\[USER CONTROL MODE - LIMITED CO-NARRATION\]/);
    assert.doesNotMatch(built.systemPrompt, /CURRENT-TURN OOC DELEGATION/);
  });

  it("delegated turn injects one scoped owner and keeps OOC text", () => {
    const input = "OOC: 내 대사도 페르소나에 맞춰서 써줘.\n*그를 바라본다.*";
    const built = buildContext({
      charName: ai,
      chunks: [],
      userNickname: user,
      userPersona: `이름/호칭: ${user}`,
      shortTermHistory: [],
      currentUserMessage: input,
      nsfw: false,
      provider: "openrouter",
      isContinue: false,
      novelModeEnabled: false,
      userImpersonation: false,
      personaDisplayName: user,
      completedTurns: 2,
    });
    const ownerSection = built.meta.trackedSections?.find((s) => s.id === "no-godmodding");
    assert.ok(ownerSection?.text.includes(CURRENT_TURN_OOC_DELEGATION_OWNER_TITLE));
    assert.equal(
      (ownerSection?.text.split(CURRENT_TURN_OOC_DELEGATION_OWNER_TITLE).length ?? 0) - 1,
      1
    );
    assert.doesNotMatch(built.systemPrompt, /\[USER CONTROL — COLLABORATIVE INTERACTIVE\]/);
    assert.doesNotMatch(built.systemPrompt, /LIMITED CO-NARRATION/);
    assert.match(built.systemPrompt, /직접 대사를 페르소나 말투/);
    assert.doesNotMatch(built.systemPrompt, /대사와 중요한 행동/);
    assert.match(lastUserContent(built), /OOC: 내 대사도 페르소나에 맞춰서 써줘/);
    assert.match(lastUserContent(built), /그를 바라본다/);
    assert.doesNotMatch(lastUserContent(built), /remain user-authored/);
  });

  it("delegated wrapper keeps original OOC and is not the auto/ooc wrapper", () => {
    const body = "OOC: 내 행동도 알아서 진행해.";
    const wrapped = wrapCurrentUserInput(body, { mode: "current_turn_ooc_delegated" });
    assert.match(wrapped, /CURRENT-TURN OOC DELEGATION/);
    assert.match(wrapped, /OOC: 내 행동도 알아서 진행해/);
    assert.doesNotMatch(wrapped, /remain user-authored/);
    assert.doesNotMatch(wrapped, /limited\/full user co-narration/);
    assert.equal(
      wrapCurrentUserInput(wrapped, { mode: "current_turn_ooc_delegated" }),
      wrapped
    );
    assert.notEqual(
      buildCurrentUserInputWrapper({ mode: "current_turn_ooc_delegated" }),
      buildCurrentUserInputWrapper({ mode: "interactive" })
    );
  });
});
