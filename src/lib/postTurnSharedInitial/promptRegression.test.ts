import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget/defaultTemplate";
import {
  buildCombinedDualWidgetExtractSystem,
  buildWidgetExtractSystem,
} from "@/lib/statusWidget/extractNormalize";
import { collectWidgetJsonKeys } from "@/lib/statusWidget/prompt";
import type { StatusWidget } from "@/lib/statusWidget/types";
import { STATUS_WIDGET_NO_EPISODIC_OWNERSHIP_INSTRUCTIONS } from "@/lib/memory/memory-episodic-prompt";
import {
  buildPostTurnSharedInitialSystem,
  buildPostTurnSharedInitialUserBlock,
} from "./prompt";
import type { PostTurnSharedInitialInput } from "./types";
import { POST_TURN_SHARED_INITIAL_REQUEST_KIND } from "./types";
import { runPostTurnRelationshipOnlyInitial } from "./run";

const USER_WIDGET: StatusWidget = {
  ...DEFAULT_STATUS_WIDGET,
  fields: [{ id: "my_note", label: "메모", instruction: "표시용 메모" }],
};

function dualInput(overrides: Partial<PostTurnSharedInitialInput> = {}): PostTurnSharedInitialInput {
  return {
    mode: "dual",
    charName: "레온",
    characterIdentity: "캐릭터 정체성",
    characterCriticalContext: "중요 설정",
    personaName: "렌",
    userMessage: "커피에 시럽을 두 번 넣어.",
    assistantProse: "알겠어, 두 번 넣어줄게.",
    previousAssistantProse: "이전 턴 assistant prose",
    characterWidget: DEFAULT_STATUS_WIDGET,
    userWidget: USER_WIDGET,
    primaryModelId: "gpt-5.6-luna",
    includeSuggestions: false,
    includeRelationship: true,
    includeEpisodic: true,
    relationshipRegenContext: null,
    ...overrides,
  };
}

const SHARED_STATUS_SCOPE_MARKER =
  "statusWidget section — current-turn UI snapshot only (field values)";

function assertSharedEpisodicPromptClean(system: string) {
  const scopeRuleMatches = system.match(
    new RegExp(SHARED_STATUS_SCOPE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
  );
  assert.equal(
    scopeRuleMatches?.length ?? 0,
    1,
    "shared status scope ownership rule appears exactly once"
  );
  const episodicRuleMatches =
    system.match(/Structured facts for long-term episodic memory/g) ?? [];
  assert.equal(episodicRuleMatches.length, 1, "episodic semantic rules appear exactly once");
  const standaloneNoEpisodicMatches =
    system.match(/Do not produce long-term episodic memory facts/g) ?? [];
  assert.equal(
    standaloneNoEpisodicMatches.length,
    0,
    "standalone no-episodic instruction must not appear in Shared Initial"
  );
  assert.doesNotMatch(
    system,
    /If the JSON schema includes "extracted_facts", output exactly "extracted_facts": \[\]/
  );
  assert.match(system, /statusWidget section — current-turn UI snapshot only/);
}

function assertStatusOnRegenUserBlock(
  userBlock: string,
  opts: {
    userMessage: string;
    canonicalAssistant: string;
    rejectedDraft: string;
  }
) {
  const rejectedDraftLabel =
    /\[REJECTED ASSISTANT DRAFT — RELATIONSHIP COMPARISON ONLY; NOT EPISODIC EVIDENCE\]/g;
  assert.equal(
    userBlock.match(rejectedDraftLabel)?.length ?? 0,
    1,
    "rejected draft block appears exactly once"
  );
  assert.match(userBlock, new RegExp(`\\[USER MESSAGE\\]\\n${opts.userMessage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(
    userBlock,
    new RegExp(
      `\\[ASSISTANT REPLY — current turn prose only\\]\\n${opts.canonicalAssistant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
    )
  );
  assert.match(userBlock, /STATUS CONTINUITY ONLY; NOT EPISODIC EVIDENCE/);
  assert.match(userBlock, /RELATIONSHIP COMPARISON ONLY; NOT EPISODIC EVIDENCE/);
  assert.match(userBlock, new RegExp(opts.rejectedDraft.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(
    userBlock,
    /\[THIS TURN — USER\][\s\S]*\[THIS TURN — USER\]/
  );
}

describe("Shared Initial prompt regression P1–P8", () => {
  it("P1 Status ON dual: no prompt conflict", () => {
    assertSharedEpisodicPromptClean(buildPostTurnSharedInitialSystem(dualInput()));
  });

  it("P2 Status ON character: no prompt conflict", () => {
    assertSharedEpisodicPromptClean(
      buildPostTurnSharedInitialSystem(
        dualInput({ mode: "character", userWidget: null })
      )
    );
  });

  it("P3 Status ON user: no prompt conflict", () => {
    assertSharedEpisodicPromptClean(
      buildPostTurnSharedInitialSystem(
        dualInput({ mode: "user", characterWidget: null, userWidget: USER_WIDGET })
      )
    );
  });

  it("P4 standalone Status Widget: old no-episodic rule preserved", () => {
    const standalone = buildWidgetExtractSystem(
      DEFAULT_STATUS_WIDGET,
      collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET),
      "character"
    );
    assert.match(standalone, /Do not produce long-term episodic memory facts/);
    assert.ok(standalone.includes(STATUS_WIDGET_NO_EPISODIC_OWNERSHIP_INSTRUCTIONS));
  });

  it("P5 Status OFF regen: current user message present", () => {
    const userBlock = buildPostTurnSharedInitialUserBlock({
      mode: "relationship_only",
      charName: "c",
      personaName: "u",
      userMessage: "커피에 시럽을 두 번 넣어.",
      assistantProse: "new canonical reply",
      primaryModelId: "gpt-5.6-luna",
      includeSuggestions: false,
      includeRelationship: true,
      includeEpisodic: true,
      relationshipRegenContext: { previousAssistantMessage: "rejected draft text" },
    });
    assert.match(userBlock, /\[THIS TURN — USER\]\n커피에 시럽을 두 번 넣어\./);
  });

  it("P6 rejected draft: relationship comparison only, not episodic evidence", () => {
    const userBlock = buildPostTurnSharedInitialUserBlock({
      mode: "relationship_only",
      charName: "c",
      personaName: "u",
      userMessage: "user says hi",
      assistantProse: "canonical",
      primaryModelId: "gpt-5.6-luna",
      includeSuggestions: false,
      includeRelationship: true,
      includeEpisodic: true,
      relationshipRegenContext: { previousAssistantMessage: "old draft" },
    });
    assert.match(userBlock, /RELATIONSHIP COMPARISON ONLY; NOT EPISODIC EVIDENCE/);
    const system = buildPostTurnSharedInitialSystem({
      mode: "relationship_only",
      charName: "c",
      personaName: "u",
      userMessage: "user says hi",
      assistantProse: "canonical",
      primaryModelId: "gpt-5.6-luna",
      includeSuggestions: false,
      includeRelationship: true,
      includeEpisodic: true,
      relationshipRegenContext: { previousAssistantMessage: "old draft" },
    });
    assert.match(system, /Do NOT copy facts from the rejected assistant draft/);
  });

  it("P7 previous assistant: status continuity only, not episodic evidence", () => {
    const userBlock = buildPostTurnSharedInitialUserBlock(dualInput());
    assert.match(userBlock, /STATUS CONTINUITY ONLY; NOT EPISODIC EVIDENCE/);
    const system = buildPostTurnSharedInitialSystem(dualInput());
    assert.match(system, /STATUS CONTINUITY ONLY — NOT episodic evidence/);
  });

  it("P8 new canonical assistant: episodic evidence allowed", () => {
    const userBlock = buildPostTurnSharedInitialUserBlock(dualInput());
    assert.match(userBlock, /\[ASSISTANT REPLY — current turn prose only\]/);
    const system = buildPostTurnSharedInitialSystem(dualInput());
    assert.match(system, /current USER message \+ current canonical ASSISTANT prose only/);
  });

  it("P12 Status ON dual regen: rejected draft present without duplicating current turn", () => {
    const input = dualInput({
      relationshipRegenContext: { previousAssistantMessage: "rejected dual draft" },
    });
    assertStatusOnRegenUserBlock(buildPostTurnSharedInitialUserBlock(input), {
      userMessage: input.userMessage,
      canonicalAssistant: input.assistantProse,
      rejectedDraft: "rejected dual draft",
    });
  });

  it("P13 Status ON character regen: rejected draft present without duplicating current turn", () => {
    const input = dualInput({
      mode: "character",
      userWidget: null,
      relationshipRegenContext: { previousAssistantMessage: "rejected character draft" },
    });
    assertStatusOnRegenUserBlock(buildPostTurnSharedInitialUserBlock(input), {
      userMessage: input.userMessage,
      canonicalAssistant: input.assistantProse,
      rejectedDraft: "rejected character draft",
    });
  });

  it("P14 Status ON user regen: rejected draft present without duplicating current turn", () => {
    const input = dualInput({
      mode: "user",
      characterWidget: null,
      userWidget: USER_WIDGET,
      relationshipRegenContext: { previousAssistantMessage: "rejected user draft" },
    });
    assertStatusOnRegenUserBlock(buildPostTurnSharedInitialUserBlock(input), {
      userMessage: input.userMessage,
      canonicalAssistant: input.assistantProse,
      rejectedDraft: "rejected user draft",
    });
  });
});

describe("Shared Initial prompt regression P9–P11", () => {
  it("P9 shared physical call: still exactly 1", async () => {
    const calls: string[] = [];
    await runPostTurnRelationshipOnlyInitial(
      {
        charName: "c",
        personaName: "u",
        userMessage: "m",
        assistantProse: "a",
        primaryModelId: "gpt-5.6-luna",
        includeRelationship: true,
        includeEpisodic: true,
      },
      async (_s, _h, opts) => {
        calls.push(opts.requestKind);
        return { text: "{}", usage: { inputTokens: 1, outputTokens: 1, estimated: true } };
      }
    );
    assert.deepEqual(calls, [POST_TURN_SHARED_INITIAL_REQUEST_KIND]);
  });

  it("P10 separate episodic provider: 0 in rolling summary production path", () => {
    const rolling = readFileSync(
      new URL("../memory/memory-rolling-summary.ts", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(rolling, /extractAndPersistEpisodicFactsForSealedBatch/);
    assert.doesNotMatch(rolling, /background-episodic-extract/);
  });

  it("P11 dead automatic seal branch: physically removed", () => {
    const rolling = readFileSync(
      new URL("../memory/memory-rolling-summary.ts", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(rolling, /EPISODIC_SEAL_BATCH_EXTRACT_ENABLED/);
    assert.doesNotMatch(rolling, /selectEpisodicEligibleTurnEntries/);
  });

  it("standalone dual extract still uses no-episodic ownership", () => {
    const standalone = buildCombinedDualWidgetExtractSystem(
      DEFAULT_STATUS_WIDGET,
      USER_WIDGET
    );
    assert.match(standalone, /Do not produce long-term episodic memory facts/);
  });
});
