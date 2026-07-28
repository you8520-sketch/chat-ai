/**
 * PR-S2B qualification fixtures — matcher unit / negative / atomic boundaries.
 */
import Module from "module";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EligibleVisualRule } from "@/lib/visualDiscoveryEligibility";
import { matchVisualDiscoveryRule } from "@/lib/visualDiscoveryMatcher";
import type { SceneEvidenceEvent } from "@/lib/sceneEvidenceTypes";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

function rule(
  partial: Partial<EligibleVisualRule> & {
    conditions: EligibleVisualRule["conditions"];
    revealed_fact_text: string;
  }
): EligibleVisualRule {
  return {
    id: partial.id ?? "rule-1",
    secret_id: partial.secret_id ?? "secret-1",
    method: "VISUAL_DISCOVERY",
    rule_key: partial.rule_key ?? "visual",
    result_state: partial.result_state ?? "CONFIRMED",
    revealed_fact_text: partial.revealed_fact_text,
    conditions_json: "{}",
    priority: 0,
    enabled: 0,
    created_at: "",
    updated_at: "",
    conditions: partial.conditions,
    secret: {
      id: partial.secret_id ?? "secret-1",
      persona_id: 1,
      secret_key: "k",
      owner_title: "",
      category: "OTHER",
      importance: "NORMAL",
      canonical_secret_text: "NEEDLE_CANONICAL_SHOULD_NOT_MATCH",
      suspected_fact_text: "",
      confirmed_fact_text: partial.revealed_fact_text,
      discoverability: "DISCOVERABLE",
      chat_scope_policy: "CHAT_ONLY",
      is_active: 1,
      revision: 1,
      created_at: "",
      updated_at: "",
    },
  };
}

function event(
  partial: Pick<SceneEvidenceEvent, "eventType" | "attributes"> &
    Partial<SceneEvidenceEvent>
): SceneEvidenceEvent {
  return {
    id: partial.id ?? "e1",
    idempotencyKey: "k",
    chatId: 1,
    turnNumber: 1,
    sourceMessageId: 1,
    eventType: partial.eventType,
    subjectType: "USER",
    subjectId: "persona-user",
    actorType: "USER",
    actorId: "persona-user",
    sourceType: partial.sourceType ?? "USER_MESSAGE_DETERMINISTIC",
    confidence: partial.confidence ?? 95,
    attributes: partial.attributes,
    visibility: partial.visibility ?? { mode: "CURRENT_CHARACTER" },
    extractorVersion: 1,
  };
}

describe("PR-S2B matcher fixtures", () => {
  const positives: Array<{
    name: string;
    rule: EligibleVisualRule;
    event: SceneEvidenceEvent;
    state: "SUSPECTED" | "CONFIRMED";
  }> = [
    {
      name: "back expose confirms mark existence",
      rule: rule({
        revealed_fact_text: "등에 숫자 표식이 있다",
        conditions: {
          evidenceKind: "BODY_REGION_EXPOSED",
          region: "upper_back",
          resultState: "CONFIRMED",
        },
      }),
      event: event({
        eventType: "BODY_REGION_EXPOSED",
        attributes: { region: "upper_back" },
      }),
      state: "CONFIRMED",
    },
    {
      name: "gravity ability confirmed",
      rule: rule({
        revealed_fact_text: "중력에 간섭하는 현상을 일으켰다",
        conditions: {
          evidenceKind: "ABILITY_MANIFESTED",
          manifestationTags: ["gravity_alteration"],
          matchMode: "ANY",
          resultState: "CONFIRMED",
        },
      }),
      event: event({
        eventType: "ABILITY_MANIFESTED",
        attributes: { manifestation: "gravity_alteration" },
      }),
      state: "CONFIRMED",
    },
    {
      name: "symptom suspected",
      rule: rule({
        result_state: "SUSPECTED",
        revealed_fact_text: "피를 토하는 것을 보았다",
        conditions: {
          evidenceKind: "PHYSICAL_SYMPTOM_DISPLAYED",
          symptomTags: ["coughing_blood"],
          matchMode: "ANY",
          resultState: "SUSPECTED",
        },
      }),
      event: event({
        eventType: "PHYSICAL_SYMPTOM_DISPLAYED",
        attributes: { symptom: "coughing_blood" },
      }),
      state: "SUSPECTED",
    },
    {
      name: "item presented confirms possession",
      rule: rule({
        revealed_fact_text: "붉은 반지를 가지고 있다",
        conditions: {
          evidenceKind: "VISIBLE_ITEM_PRESENTED",
          itemTags: ["반지"],
          matchMode: "ANY",
          resultState: "CONFIRMED",
        },
      }),
      event: event({
        eventType: "VISIBLE_ITEM_PRESENTED",
        attributes: { itemLabel: "반지" },
      }),
      state: "CONFIRMED",
    },
    {
      name: "mark shown maps from VISIBLE_MARK_SHOWN",
      rule: rule({
        revealed_fact_text: "문신을 보여줬다",
        conditions: {
          evidenceKind: "VISIBLE_MARK_SHOWN",
          markTags: ["문신"],
          matchMode: "ANY",
          resultState: "CONFIRMED",
        },
      }),
      event: event({
        eventType: "VISIBLE_MARK_PRESENTED",
        attributes: { markLabel: "문신" },
      }),
      state: "CONFIRMED",
    },
  ];

  const negatives: Array<{ name: string; rule: EligibleVisualRule; event: SceneEvidenceEvent }> = [
    {
      name: "wrong region",
      rule: rule({
        revealed_fact_text: "등 표식",
        conditions: { evidenceKind: "BODY_REGION_EXPOSED", region: "upper_back" },
      }),
      event: event({
        eventType: "BODY_REGION_EXPOSED",
        attributes: { region: "forearm" },
      }),
    },
    {
      name: "partial exposure blocked by CLEAR",
      rule: rule({
        revealed_fact_text: "등 표식",
        conditions: {
          evidenceKind: "BODY_REGION_EXPOSED",
          region: "upper_back",
          minimumExposure: "CLEAR",
        },
      }),
      event: event({
        eventType: "BODY_REGION_EXPOSED",
        attributes: { region: "upper_back", exposureLevel: "PARTIAL" },
      }),
    },
    {
      name: "wrong manifestation",
      rule: rule({
        revealed_fact_text: "중력",
        conditions: {
          evidenceKind: "ABILITY_MANIFESTED",
          manifestationTags: ["gravity_alteration"],
          matchMode: "ANY",
        },
      }),
      event: event({
        eventType: "ABILITY_MANIFESTED",
        attributes: { manifestation: "spatial_distortion" },
      }),
    },
    {
      name: "wrong item tag",
      rule: rule({
        revealed_fact_text: "반지",
        conditions: {
          evidenceKind: "VISIBLE_ITEM_PRESENTED",
          itemTags: ["반지"],
          matchMode: "ANY",
        },
      }),
      event: event({
        eventType: "VISIBLE_ITEM_PRESENTED",
        attributes: { itemLabel: "열쇠" },
      }),
    },
    {
      name: "low confidence event",
      rule: rule({
        revealed_fact_text: "등",
        conditions: { evidenceKind: "BODY_REGION_EXPOSED", region: "upper_back" },
      }),
      event: event({
        eventType: "BODY_REGION_EXPOSED",
        attributes: { region: "upper_back" },
        confidence: 40,
      }),
    },
    {
      name: "canonical keyword coincidence does not unlock",
      rule: rule({
        revealed_fact_text: "관찰 사실",
        conditions: {
          evidenceKind: "ABILITY_MANIFESTED",
          manifestationTags: ["gravity_alteration"],
          matchMode: "ANY",
        },
      }),
      event: event({
        // Different event type — even if attributes somehow mentioned needles
        eventType: "DOCUMENT_PRESENTED",
        attributes: { documentLabel: "천공의 권능" },
      }),
    },
  ];

  it(`has positive and negative fixture coverage (pos=${positives.length}, neg=${negatives.length})`, () => {
    assert.ok(positives.length >= 5);
    assert.ok(negatives.length >= 6);
  });

  for (const p of positives) {
    it(`PASS: ${p.name}`, () => {
      const m = matchVisualDiscoveryRule(p.event, p.rule, 17);
      assert.ok(m);
      assert.equal(m!.resultState, p.state);
      assert.doesNotMatch(JSON.stringify(m), /NEEDLE_CANONICAL|천공의 권능/);
    });
  }

  for (const n of negatives) {
    it(`FAIL: ${n.name}`, () => {
      assert.equal(matchVisualDiscoveryRule(n.event, n.rule, 17), null);
    });
  }
});
