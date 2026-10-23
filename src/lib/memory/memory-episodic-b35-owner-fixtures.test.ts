import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectRelationshipLedgerOwnedFact,
  detectUnverifiedCanonicalization,
} from "@/lib/episodicMemoryFacts";
import {
  evaluateEpisodicFactEvidence,
  renderVerifiedEvidenceText,
  type EpisodicEvidenceSources,
} from "./memory-episodic-evidence";
import type { EpisodicExtractedFact } from "./memory-episodic-types";
import { REN_WOLFGANG_QUOTES } from "@/lib/test/renWolfgangSafeFixture";

type OwnedInput = Parameters<typeof detectRelationshipLedgerOwnedFact>[0];
type CanonInput = Parameters<typeof detectUnverifiedCanonicalization>[0];

function owned(
  attribute: string,
  fact_text: string,
  category: OwnedInput["category"] = "character",
  value = "value"
): OwnedInput {
  return { category, attribute, value, fact_text };
}

function claim(fact_text: string, evidence_type: CanonInput["evidence_type"], attribute = "order"): CanonInput {
  return { category: "character", attribute, value: "value", fact_text, evidence_type };
}

describe("B35 A1 — Relationship Ledger ownership vs information-disclosure events", () => {
  it("USER refusal to forward a statement is not ledger-owned for any transfer-flavoured attribute", () => {
    const text = "렌은 자신의 진술을 황실 감찰관에게 전달하는 데 동의하지 않았다.";
    for (const attribute of [
      "statement_consent",
      "consent_to_statement_transfer",
      "refused_statement_transfer",
      "statement_transferred",
      "statement_received_refusal",
    ]) {
      assert.equal(detectRelationshipLedgerOwnedFact(owned(attribute, text)), null, attribute);
      assert.equal(
        detectRelationshipLedgerOwnedFact(owned(attribute, text, "relationship")),
        null,
        `${attribute} (relationship)`
      );
    }
  });

  it("withdrawal of consent to disclose a record is not ledger-owned", () => {
    assert.equal(
      detectRelationshipLedgerOwnedFact(
        owned("record_disclosure_consent_transfer", "렌은 기록을 감찰관에게 공개하는 동의를 철회했다.")
      ),
      null
    );
  });

  it("real item handover/acquisition/loss stays with the Relationship Ledger", () => {
    const cases: Array<[string, string, OwnedInput["category"]]> = [
      ["item_transfer", "렌은 은반지를 볼프강에게 건넸다.", "item"],
      ["transfer", "렌은 단검을 볼프강에게 양도했다.", "character"],
      ["transferred", "렌의 열쇠가 병사에게 넘어갔다. 병사가 열쇠를 받았다.", "character"],
      ["received", "렌은 볼프강에게서 외투를 선물로 받았다.", "character"],
      ["inventory", "렌은 단검을 소지하고 있다.", "item"],
      ["possession", "렌이 기록철을 가지고 다닌다.", "character"],
      ["acquired", "렌은 지도를 획득했다.", "item"],
      ["lost", "렌은 반지를 잃었다.", "item"],
      // Ambiguous attribute with no information-disclosure text stays owned (unchanged behaviour).
      ["transfer", "렌은 은반지를 넘겼다.", "item"],
      ["transfer", "소유권이 이전되었다.", "item"],
    ];
    for (const [attribute, text, category] of cases) {
      assert.equal(
        detectRelationshipLedgerOwnedFact(owned(attribute, text, category)),
        "relationship_ledger_item",
        `${attribute}: ${text}`
      );
    }
  });

  it("a record handed over physically is still an item event (possession lexicon wins over information words)", () => {
    assert.equal(
      detectRelationshipLedgerOwnedFact(owned("transfer", "렌은 기록철을 볼프강에게 건넸다.")),
      "relationship_ledger_item"
    );
  });

  it("promise creation / cancellation stays with the Relationship Ledger", () => {
    assert.equal(
      detectRelationshipLedgerOwnedFact(owned("promise", "렌은 내일 돌아오겠다고 약속했다.")),
      "relationship_ledger_promise"
    );
    assert.equal(
      detectRelationshipLedgerOwnedFact(owned("pledge_cancelled", "렌은 약속을 취소했다.", "relationship")),
      "relationship_ledger_promise"
    );
    assert.equal(
      detectRelationshipLedgerOwnedFact(owned("statement_consent", "볼프강은 렌과 한 약속을 철회했다.")),
      "relationship_ledger_promise"
    );
    assert.equal(
      detectRelationshipLedgerOwnedFact(owned("statement_pledge", "렌은 진술을 전달하지 않겠다고 약속했다.")),
      "relationship_ledger_promise"
    );
  });
});

describe("B35 A2 — explicit character commands and permissions", () => {
  const accepted = [
    "볼프강은 렌이 허락하기 전까지 진술을 천막 밖으로 내보내지 말라고 병사에게 지시했다.",
    "볼프강은 병사에게 진술을 감찰관에게 전달하지 말라고 명령했다.",
    "볼프강은 렌이 기록철을 천막 안에서만 열람하고 필사하지 않도록 허락했다.",
    "볼프강은 렌에게 기록철 필사를 금지했다.",
    "볼프강은 렌이 기록철을 천막 안에서만 열람하도록 제한했다.",
    "볼프강은 새벽 보초 교대 전에 기록철을 반납하라고 요구했다.",
    "볼프강은 감찰관의 상대는 자신이 하겠으니 부르라고 했다.",
  ];

  it("direct commands, permissions and restrictions pass as attributed character claims", () => {
    for (const text of accepted) {
      assert.equal(detectUnverifiedCanonicalization(claim(text, "explicit_character_claim")), null, text);
    }
  });

  it("speculative inner states and unattributed canon about the character stay blocked", () => {
    const blocked = [
      "볼프강은 속으로 렌을 의심하고 있었다.",
      "볼프강은 본래 냉혹한 성격이다.",
      "볼프강은 렌에게 호감을 품고 있다.",
      "볼프강의 정체는 사실 황실의 첩자다.",
    ];
    for (const text of blocked) {
      assert.equal(
        detectUnverifiedCanonicalization(claim(text, "explicit_character_claim")),
        "unattributed_character_claim",
        text
      );
    }
  });

  it("character-claim attribution rule is unchanged for other evidence types", () => {
    assert.equal(
      detectUnverifiedCanonicalization(claim("볼프강은 렌에게 호감을 품고 있다.", "explicit_scene_event")),
      null
    );
  });
});

describe("B35 A2 — USER action must not be attributed to the character", () => {
  const sources: EpisodicEvidenceSources = {
    user: { id: 1, text: `*렌은 서약서를 받지 않았다.* ${REN_WOLFGANG_QUOTES.userRefusal}` },
    assistant: {
      id: 2,
      text: `볼프강이 말했다. "${REN_WOLFGANG_QUOTES.wolfgangForwardBan}" 렌은 서약서를 받지 않고 기록철에 손을 얹었다.`,
    },
  };

  function fact(overrides: Partial<EpisodicExtractedFact>): EpisodicExtractedFact {
    return {
      category: "character",
      subject: "wolfgang",
      attribute: "forwarding_ban_order",
      value: "no_forwarding",
      importance: "important",
      fact_text: "볼프강은 병사에게 진술을 감찰관에게 전달하지 말라고 명령했다.",
      evidence_type: "explicit_character_claim",
      evidence: { source_role: "assistant", source_quote: REN_WOLFGANG_QUOTES.wolfgangForwardBan },
      ...overrides,
    };
  }

  it("a verbatim character command is accepted as an unconfirmed CHARACTER_CLAIM", () => {
    const decision = evaluateEpisodicFactEvidence(fact({}), sources);
    assert.equal(decision.accepted, true);
    if (decision.accepted) assert.equal(decision.evidence.authority, "CHARACTER_CLAIM");
  });

  it("a character claim sourced from the USER message is rejected", () => {
    const decision = evaluateEpisodicFactEvidence(
      fact({ evidence: { source_role: "user", source_quote: REN_WOLFGANG_QUOTES.userRefusal } }),
      sources
    );
    assert.deepEqual(decision, { accepted: false, reason: "evidence_type_role_mismatch" });
  });

  it("assistant narration cannot authorize a USER action as a scene event", () => {
    const decision = evaluateEpisodicFactEvidence(
      fact({
        subject: "user",
        attribute: "pledge_refusal",
        fact_text: "렌은 서약서를 받지 않았다.",
        evidence_type: "explicit_scene_event",
        evidence: { source_role: "assistant", source_quote: "렌은 서약서를 받지 않고 기록철에 손을 얹었다." },
      }),
      sources
    );
    assert.deepEqual(decision, {
      accepted: false,
      reason: "assistant_evidence_cannot_authorize_user_action",
    });
  });

  it("a USER-sourced quote glossed as a character action is injected as the user's own words, never as the character's", () => {
    const decision = evaluateEpisodicFactEvidence(
      fact({
        attribute: "pledge_refusal",
        fact_text: "볼프강은 진술 전달에 동의하지 않았다.",
        evidence_type: "explicit_scene_event",
        evidence: { source_role: "user", source_quote: REN_WOLFGANG_QUOTES.userRefusal },
      }),
      sources
    );
    assert.equal(decision.accepted, true);
    if (!decision.accepted) return;
    assert.equal(decision.evidence.authority, "USER_EXPLICIT");
    assert.equal(
      renderVerifiedEvidenceText(decision.evidence),
      `[유저 입력 발췌] “${REN_WOLFGANG_QUOTES.userRefusal}”`
    );
  });

  it("a quote that is not in the source message is rejected", () => {
    const decision = evaluateEpisodicFactEvidence(
      fact({ evidence: { source_role: "assistant", source_quote: "이 진술은 황제에게 직접 전달하라." } }),
      sources
    );
    assert.deepEqual(decision, { accepted: false, reason: "evidence_quote_not_in_message" });
  });
});
