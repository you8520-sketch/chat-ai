/**
 * UNI-01..13 — User Note focus-zone persistent constraint prompt hardening.
 * Deterministic final-prompt fixtures; no live provider calls.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildIdentityAndRulesBlock } from "@/lib/corePrompt";
import {
  MANDATORY_RULES_BOUNDED_AUTHORITY_SHORT_REF,
  MANDATORY_RULES_BOUNDED_ROLE_DIRECTION_PRECEDENCE,
  MANDATORY_RULES_PERSISTENT_CONSTRAINT_SEMANTIC,
} from "@/lib/userNoteMandatoryRulesPolicy";
import { AUTO_PROGRESSION_BLOCK_TITLE } from "@/lib/autoProgressionRules";
import {
  buildNoGodmoddingBlock,
  COLLABORATIVE_INTERACTIVE_OWNER_TITLE,
  CURRENT_TURN_OOC_DELEGATION_OWNER_TITLE,
} from "@/lib/noGodmodding";
import { wrapCurrentUserInput } from "@/lib/currentUserInputLabel";
import { MAIN_RP_USER_SELECTABLE_OPTIONS } from "@/lib/chatModels";
import {
  mergeUserNoteBodyFromEditor,
  USER_NOTE_ZONE_SEPARATOR,
} from "@/lib/userNoteStatusWindow";
import { buildContext } from "@/services/contextBuilder";

const user = "테스트_유저";
const ai = "테스트_AI";

const FOCUS_ROLE_INVARIANT = "유저캐는 항상 탑 포지션이다. 리버스는 하지 않는다.";
const FOCUS_COAT = "현재 검은 코트를 입고 있다.";
const FOCUS_HISTORICAL_ROLE = "예전에 탑으로 진행한 적이 있다.";
const FOCUS_NONEXCLUSIVE = "탑도 괜찮다.";
const FOCUS_NAME_INVARIANT = "이 캐릭터는 절대로 본명을 밝히지 않는다.";

function focusOnlyNote(text: string): string {
  return text;
}

function referenceOnlyNote(text: string): string {
  return mergeUserNoteBodyFromEditor("", text);
}

function buildBase(
  opts: Partial<Parameters<typeof buildContext>[0]> = {}
) {
  return buildContext({
    charName: ai,
    chunks: [],
    userNickname: user,
    userPersona: `이름/호칭: ${user}`,
    shortTermHistory: [],
    currentUserMessage: "앞으로 어떻게 할까?",
    nsfw: false,
    provider: "openrouter",
    isContinue: false,
    novelModeEnabled: false,
    userImpersonation: false,
    personaDisplayName: user,
    completedTurns: 4,
    ...opts,
  });
}

function sectionText(
  built: ReturnType<typeof buildContext>,
  id: string
): string {
  const section = built.meta.trackedSections?.find((s) => s.id === id);
  return section?.text ?? "";
}

function identityBlock(built: ReturnType<typeof buildContext>): string {
  return sectionText(built, "identity-and-rules");
}

function ownerBlock(built: ReturnType<typeof buildContext>): string {
  return sectionText(built, "no-godmodding");
}

describe("UNI — User Note persistent invariant (focus zone)", () => {
  it("UNI-01 FOCUS HARD ROLE: mandatory note + persistent contract exactly once", () => {
    const built = buildBase({ userNote: focusOnlyNote(FOCUS_ROLE_INVARIANT) });
    const identity = identityBlock(built);
    assert.equal(identity.split("[MANDATORY_RULES]").length - 1, 1);
    assert.equal(identity.split(FOCUS_ROLE_INVARIANT).length - 1, 1);
    assert.equal(
      identity.split(MANDATORY_RULES_PERSISTENT_CONSTRAINT_SEMANTIC).length - 1,
      1
    );
    assert.ok(identity.includes("[IDENTITY_AND_RULES]"));
  });

  it("UNI-02 STALE ASSISTANT CONTRADICTION: mandatory contract bounds history", () => {
    const built = buildBase({
      userNote: focusOnlyNote(FOCUS_ROLE_INVARIANT),
      shortTermHistory: [
        { role: "user", content: "계속." },
        {
          role: "assistant",
          content: "렌은 [B]를 바텀으로 눕히고 리버스로 진행했다.",
        },
      ],
    });
    const identity = identityBlock(built);
    assert.ok(identity.includes(FOCUS_ROLE_INVARIANT));
    assert.ok(identity.includes(MANDATORY_RULES_PERSISTENT_CONSTRAINT_SEMANTIC));
    assert.match(identity, /history, memory, current scene/);
  });

  it("UNI-03 AUTO PROGRESSION: co-narration bounded by mandatory rules short ref", () => {
    const built = buildBase({
      userNote: focusOnlyNote(FOCUS_ROLE_INVARIANT),
      isContinue: true,
      currentUserMessage: "...",
    });
    const owner = ownerBlock(built);
    assert.ok(owner.includes(AUTO_PROGRESSION_BLOCK_TITLE));
    assert.ok(owner.includes(MANDATORY_RULES_BOUNDED_AUTHORITY_SHORT_REF));
    assert.ok(identityBlock(built).includes(FOCUS_ROLE_INVARIANT));
  });

  it("UNI-04 AUTO→MANUAL: #940 reset preserved; mandatory note still authoritative", () => {
    const built = buildBase({
      userNote: focusOnlyNote(FOCUS_ROLE_INVARIANT),
      shortTermHistory: [
        { role: "user", content: "계속." },
        { role: "assistant", content: '"[B]가 말했다." 리버스로 진행했다.' },
      ],
    });
    const owner = ownerBlock(built);
    assert.ok(owner.includes(COLLABORATIVE_INTERACTIVE_OWNER_TITLE));
    assert.equal(owner.includes(AUTO_PROGRESSION_BLOCK_TITLE), false);
    const wrapped = wrapCurrentUserInput("그를 바라본다.", { mode: "interactive" });
    assert.match(wrapped, /Prior auto-progression co-narration does not carry over/);
    assert.ok(identityBlock(built).includes(FOCUS_ROLE_INVARIANT));
  });

  it("UNI-05 REGEN: mandatory note injected; rejected draft not canonical", () => {
    const built = buildBase({
      userNote: focusOnlyNote(FOCUS_ROLE_INVARIANT),
      regenerate: true,
      rejectedAssistantDraft: "렌은 [B]를 바텀으로 눕혔다.",
      currentUserMessage: "[SYSTEM: REGENERATE — rewrite ONLY the last assistant message]",
    });
    assert.ok(identityBlock(built).includes(FOCUS_ROLE_INVARIANT));
    assert.match(built.systemPrompt, /REGENERATE.*MANDATORY DIVERGENCE/i);
    assert.match(built.systemPrompt, /바텀으로 눕/);
    assert.doesNotMatch(built.systemPrompt, /\[Rejected draft — do NOT repeat/i);
  });

  it("UNI-06 CURRENT-TURN OOC DELEGATION: authoring grant bounded by mandatory rules", () => {
    const built = buildBase({
      userNote: focusOnlyNote(FOCUS_ROLE_INVARIANT),
      currentUserMessage: "(OOC: 이번 턴 내 대사와 행동도 써줘.) 앞으로 가자.",
      currentTurnAuthoringDelegation: {
        active: true,
        allowDialogue: true,
        allowMajorActions: true,
        source: "explicit_ooc",
      },
    });
    const owner = ownerBlock(built);
    assert.ok(owner.includes(CURRENT_TURN_OOC_DELEGATION_OWNER_TITLE));
    assert.ok(owner.includes(MANDATORY_RULES_BOUNDED_AUTHORITY_SHORT_REF));
    assert.ok(identityBlock(built).includes(FOCUS_ROLE_INVARIANT));
  });

  it("UNI-07 LEGACY REFERENCE ZONE: expansion text is not injected after retirement", () => {
    const note = `${USER_NOTE_ZONE_SEPARATOR}${FOCUS_ROLE_INVARIANT}`;
    const built = buildBase({
      userNote: note,
      currentUserMessage: "오늘 날씨 좋다.",
    });
    const identity = identityBlock(built);
    assert.equal(identity.includes(FOCUS_ROLE_INVARIANT), false);
    assert.equal(sectionText(built, "user-lorebook"), "");
    assert.ok(
      !(built.meta?.trackedSections ?? []).some((section) => section.id === "user-note-reference")
    );
  });

  it("UNI-08 DESCRIPTIVE FACT: semantic targets explicit fixed/prohibited only", () => {
    const built = buildBase({ userNote: focusOnlyNote(FOCUS_COAT) });
    const identity = identityBlock(built);
    assert.ok(identity.includes(FOCUS_COAT));
    assert.ok(identity.includes("고정·지속·금지"));
    assert.doesNotMatch(identity, /모든.*focus|전체.*고집중.*변경.*금지/i);
  });

  it("UNI-09 HISTORICAL ROLE: does not semantically lock always-top", () => {
    const block = buildIdentityAndRulesBlock(user, FOCUS_HISTORICAL_ROLE);
    assert.ok(block);
    assert.ok(block!.includes(FOCUS_HISTORICAL_ROLE));
    assert.doesNotMatch(block!, /항상 탑|리버스 금지/);
  });

  it("UNI-10 NON-EXCLUSIVE PREFERENCE: does not become reverse forbidden", () => {
    const block = buildIdentityAndRulesBlock(user, FOCUS_NONEXCLUSIVE);
    assert.ok(block);
    assert.ok(block!.includes(FOCUS_NONEXCLUSIVE));
    assert.doesNotMatch(block!, /리버스.*금지|reverse forbidden/i);
  });

  it("UNI-11 GENERIC NONSEXUAL INVARIANT: same mechanism, not top/bottom hack", () => {
    const built = buildBase({ userNote: focusOnlyNote(FOCUS_NAME_INVARIANT) });
    const identity = identityBlock(built);
    assert.ok(identity.includes(FOCUS_NAME_INVARIANT));
    assert.ok(identity.includes(MANDATORY_RULES_PERSISTENT_CONSTRAINT_SEMANTIC));
    assert.doesNotMatch(identity, /top|bottom|리버스|탑 포지션/i);
  });

  it("UNI-12 FINAL PROMPT MATRIX: production model paths — single invariant owner", () => {
    for (const model of MAIN_RP_USER_SELECTABLE_OPTIONS) {
      const standard = buildBase({
        modelId: model.id,
        userNote: focusOnlyNote(FOCUS_ROLE_INVARIANT),
      });
      const auto = buildBase({
        modelId: model.id,
        userNote: focusOnlyNote(FOCUS_ROLE_INVARIANT),
        isContinue: true,
        currentUserMessage: "...",
      });
      const regen = buildBase({
        modelId: model.id,
        userNote: focusOnlyNote(FOCUS_ROLE_INVARIANT),
        regenerate: true,
        rejectedAssistantDraft: "draft",
        currentUserMessage: "[SYSTEM: REGENERATE]",
      });
      const delegated = buildBase({
        modelId: model.id,
        userNote: focusOnlyNote(FOCUS_ROLE_INVARIANT),
        currentTurnAuthoringDelegation: {
          active: true,
          allowDialogue: true,
          allowMajorActions: false,
          source: "explicit_ooc",
        },
      });

      for (const built of [standard, auto, regen, delegated]) {
        const identity = identityBlock(built);
        assert.equal(
          identity.split(MANDATORY_RULES_PERSISTENT_CONSTRAINT_SEMANTIC).length - 1,
          1,
          `${model.id}: persistent contract once`
        );
        assert.equal(
          identity.split(FOCUS_ROLE_INVARIANT).length - 1,
          1,
          `${model.id}: focus invariant once`
        );
        assert.doesNotMatch(identity, /TOP_RE|BOTTOM_RE|REVERSE_RE|SEX_ROLE_LOCK/i);
      }
    }
  });

  it("UNI-13 MEMORY MUST NOT OVERRIDE: mandatory constraint above inferred memory", () => {
    const built = buildBase({
      userNote: focusOnlyNote("리버스 금지."),
      longTermMemory:
        "과거 요약: 유저는 바텀 포지션으로 역할극을 진행했고 AI가 탑으로 진행했다.",
    });
    const identity = identityBlock(built);
    assert.ok(identity.includes("리버스 금지"));
    assert.ok(identity.includes(MANDATORY_RULES_PERSISTENT_CONSTRAINT_SEMANTIC));
    assert.match(identity, /memory.*제약 안에서|memory, current scene/);
    assert.match(built.systemPrompt, /바텀 포지션/);
  });

  it("UNI-14 NO MANDATORY RULES: empty focus — no phantom constraint, role update allowed", () => {
    const built = buildBase({
      userNote: "",
      currentUserMessage: "*[B]가 [A]에게 물건을 건넨다.*",
    });
    const identity = identityBlock(built);
    assert.equal(identity.includes("[MANDATORY_RULES]"), false);
    assert.equal(
      identity.includes(MANDATORY_RULES_PERSISTENT_CONSTRAINT_SEMANTIC),
      false
    );

    const owner = ownerBlock(built);
    assert.ok(owner.includes(MANDATORY_RULES_BOUNDED_ROLE_DIRECTION_PRECEDENCE));
    assert.match(owner, /\[MANDATORY_RULES\]가 있는 경우/);
    assert.doesNotMatch(owner, /top|bottom|리버스|탑 포지션/i);
    assert.equal(owner.includes(MANDATORY_RULES_BOUNDED_AUTHORITY_SHORT_REF), false);
    assert.doesNotMatch(
      owner,
      /역할·대상·방향 전환을 명시하면 가장 최신 입력의 관계를 기준으로 갱신/
    );
  });
});

describe("UNI — owner conflict replacement", () => {
  it("standard owner role-direction precedence is bounded by MANDATORY_RULES when present", () => {
    const owner = buildNoGodmoddingBlock(ai, user, "standard");
    assert.ok(owner.includes(MANDATORY_RULES_BOUNDED_ROLE_DIRECTION_PRECEDENCE));
    assert.doesNotMatch(
      owner,
      /역할·대상·방향 전환을 명시하면 가장 최신 입력의 관계를 기준으로 갱신/
    );
  });
});
