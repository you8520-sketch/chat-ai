import Module from "module";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { compileAndApplyPersonaSecrets } from "@/lib/personaSecretCompiler";
import { listExistingPersonaSecrets } from "@/lib/personaSecretCompilerApply";
import {
  buildCharacterKnownFactsBlock,
  getCharacterSecretKnowledge,
} from "@/lib/personaSecretKnowledge";
import { extractAndPersistSceneEvidence } from "@/lib/sceneEvidence";
import { listSceneEvidenceEventsForChatTurn } from "@/lib/sceneEvidencePersist";
import { runVisualDiscoveryForTurn } from "@/lib/visualDiscovery";
import { listEligibleVisualDiscoveryRules } from "@/lib/visualDiscoveryEligibility";
import {
  buildVisualDiscoveryIdempotencyKey,
  matchVisualDiscoveryRule,
} from "@/lib/visualDiscoveryMatcher";
import type { SceneEvidenceEvent } from "@/lib/sceneEvidenceTypes";
import type { EligibleVisualRule } from "@/lib/visualDiscoveryEligibility";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

const ENV_KEYS = ["PERSONA_SECRET_BOUNDARY_ENABLED", "PERSONA_SECRET_DISCOVERY_ENABLED"] as const;
function saveEnv(): Record<string, string | undefined> {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}
function restoreEnv(s: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    if (s[k] === undefined) delete process.env[k];
    else process.env[k] = s[k];
  }
}

function uniqueIds() {
  const n = Math.floor(Math.random() * 10000);
  return {
    personaId: 930000 + n,
    chatId: 940000 + n,
    characterId: 17,
  };
}

function baseEvent(
  overrides: Partial<SceneEvidenceEvent> & Pick<SceneEvidenceEvent, "eventType" | "attributes">
): SceneEvidenceEvent {
  return {
    id: overrides.id ?? `evt-${Math.random().toString(36).slice(2, 10)}`,
    idempotencyKey: overrides.idempotencyKey ?? "k",
    chatId: overrides.chatId ?? 1,
    turnNumber: overrides.turnNumber ?? 1,
    sourceMessageId: overrides.sourceMessageId ?? 1,
    eventType: overrides.eventType,
    subjectType: "USER",
    subjectId: "persona-user",
    actorType: "USER",
    actorId: "persona-user",
    sourceType: overrides.sourceType ?? "USER_MESSAGE_DETERMINISTIC",
    confidence: overrides.confidence ?? 95,
    attributes: overrides.attributes,
    visibility: overrides.visibility ?? {
      mode: "CURRENT_CHARACTER",
      requiresLineOfSight: true,
    },
    extractorVersion: 1,
  };
}

describe("PR-S2B visual discovery matcher", () => {
  let env: Record<string, string | undefined>;
  beforeEach(() => {
    env = saveEnv();
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "1";  });
  afterEach(() => restoreEnv(env));

  describe("body mark atomic boundary", () => {
    it("exposes upper_back → mark existence CONFIRMED; meaning stays UNKNOWN", () => {
      const { personaId, chatId, characterId } = uniqueIds();
      const source =
        "렌의 등에 실험체 시절 생긴 017 문신이 있다.\n\n017은 제7연구소 피험자 번호라는 의미다.";
      const compiled = compileAndApplyPersonaSecrets({ personaId, source });
      assert.equal(compiled.ok, true);

      const secrets = listExistingPersonaSecrets(personaId).filter((s) => s.is_active === 1);
      assert.ok(secrets.length >= 2);

      extractAndPersistSceneEvidence({
        chatId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 101,
        userMessage: "렌은 젖은 셔츠를 벗어 의자에 걸고 로코에게 등을 보였다.",
        publicPersonaId: personaId,
      });
      const result = runVisualDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 101,
      });
      assert.ok(result.matchCount >= 1);

      const meaning = secrets.find((s) => /의미|연구소|번호/.test(s.confirmed_fact_text));
      const existence = secrets.find((s) => s.id !== meaning?.id);
      assert.ok(existence);

      const existenceKnowledge = getCharacterSecretKnowledge({
        chatId,
        personaId,
        secretId: existence!.id,
        characterId,
      });
      assert.ok(existenceKnowledge);
      assert.equal(existenceKnowledge!.knowledge_state, "CONFIRMED");

      if (meaning) {
        const meaningKnowledge = getCharacterSecretKnowledge({
          chatId,
          personaId,
          secretId: meaning.id,
          characterId,
        });
        assert.equal(meaningKnowledge, null);
      }

      const block = buildCharacterKnownFactsBlock({
        chatId,
        personaId,
        characterId,
      });
      assert.ok(block);
      assert.match(block!, /CONFIRMED/);
      assert.doesNotMatch(block!, /제7연구소/);
      assert.doesNotMatch(block!, /천공의 권능|엘리시온/);
    });

    it("wrong region forearm → no unlock for back tattoo", () => {
      const { personaId, chatId, characterId } = uniqueIds();
      compileAndApplyPersonaSecrets({
        personaId,
        source: "등에 017 문신이 있다.",
      });
      extractAndPersistSceneEvidence({
        chatId,
        characterId,
        turnNumber: 2,
        sourceMessageId: 102,
        userMessage: "렌은 소매를 걷어 올려 팔을 내보였다.",
        publicPersonaId: personaId,
      });
      const before = listExistingPersonaSecrets(personaId).filter((s) => s.is_active === 1);
      runVisualDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 2,
        sourceMessageId: 102,
      });
      for (const s of before) {
        assert.equal(
          getCharacterSecretKnowledge({
            chatId,
            personaId,
            secretId: s.id,
            characterId,
          }),
          null
        );
      }
    });
  });

  describe("ability / symptom separation", () => {
    it("gravity manifestation confirms ability; name/cost stay unknown", () => {
      const { personaId, chatId, characterId } = uniqueIds();
      compileAndApplyPersonaSecrets({
        personaId,
        source:
          "중력에 간섭할 수 있다.\n\n그 능력의 정식 명칭은 천공의 권능이다.\n\n쓸 때마다 내상이 생기는 부작용이 있다.",
      });
      extractAndPersistSceneEvidence({
        chatId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 201,
        userMessage: "렌은 손을 뻗어 무너지는 철골의 중력을 뒤집었다.",
        publicPersonaId: personaId,
      });
      runVisualDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 201,
      });

      const secrets = listExistingPersonaSecrets(personaId).filter((s) => s.is_active === 1);
      const gravity = secrets.find((s) => /중력/.test(s.confirmed_fact_text));
      const name = secrets.find((s) => /천공의 권능|정식/.test(s.confirmed_fact_text));
      const cost = secrets.find((s) => /부작용|내상/.test(s.confirmed_fact_text));
      assert.ok(gravity);
      assert.equal(
        getCharacterSecretKnowledge({
          chatId,
          personaId,
          secretId: gravity!.id,
          characterId,
        })?.knowledge_state,
        "CONFIRMED"
      );
      if (name) {
        assert.equal(
          getCharacterSecretKnowledge({
            chatId,
            personaId,
            secretId: name.id,
            characterId,
          }),
          null
        );
      }
      if (cost) {
        assert.equal(
          getCharacterSecretKnowledge({
            chatId,
            personaId,
            secretId: cost.id,
            characterId,
          }),
          null
        );
      }
    });

    it("coughing blood → ability-cost SUSPECTED not CONFIRMED", () => {
      const { personaId, chatId, characterId } = uniqueIds();
      compileAndApplyPersonaSecrets({
        personaId,
        source: "능력 사용 시 내상을 입는 부작용이 있다.",
      });
      extractAndPersistSceneEvidence({
        chatId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 202,
        userMessage: "렌은 갑자기 피를 토했다.",
        publicPersonaId: personaId,
      });
      runVisualDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 202,
      });
      const secret = listExistingPersonaSecrets(personaId).find((s) => s.is_active === 1);
      assert.ok(secret);
      const k = getCharacterSecretKnowledge({
        chatId,
        personaId,
        secretId: secret!.id,
        characterId,
      });
      assert.equal(k?.knowledge_state, "SUSPECTED");
      const block = buildCharacterKnownFactsBlock({ chatId, personaId, characterId });
      assert.ok(block);
      assert.match(block!, /SUSPECTED/);
    });
  });

  describe("observer / visibility negatives", () => {
    it("UNKNOWN visibility → no match", () => {
      const rules = [
        {
          id: "r1",
          secret_id: "s1",
          method: "VISUAL_DISCOVERY" as const,
          rule_key: "visual_body_region_exposed",
          result_state: "CONFIRMED" as const,
          revealed_fact_text: "등에 표식이 있다",
          conditions_json: "{}",
          priority: 0,
          enabled: 0,
          created_at: "",
          updated_at: "",
          conditions: {
            evidenceKind: "BODY_REGION_EXPOSED" as const,
            region: "upper_back",
            resultState: "CONFIRMED" as const,
          },
          secret: {
            id: "s1",
            persona_id: 1,
            secret_key: "mark",
            owner_title: "",
            category: "OTHER" as const,
            importance: "NORMAL" as const,
            canonical_secret_text: "HIDDEN",
            suspected_fact_text: "",
            confirmed_fact_text: "등에 표식이 있다",
            discoverability: "DISCOVERABLE" as const,
            chat_scope_policy: "CHAT_ONLY" as const,
            is_active: 1,
            revision: 1,
            created_at: "",
            updated_at: "",
          },
        } satisfies EligibleVisualRule,
      ];
      const event = baseEvent({
        eventType: "BODY_REGION_EXPOSED",
        attributes: { region: "upper_back" },
        visibility: { mode: "UNKNOWN" },
      });
      assert.equal(matchVisualDiscoveryRule(event, rules[0]!, 17), null);
    });

    it("SCENE_PARTICIPANTS without list → no match", () => {
      const rule = {
        id: "r1",
        secret_id: "s1",
        method: "VISUAL_DISCOVERY" as const,
        rule_key: "k",
        result_state: "CONFIRMED" as const,
        revealed_fact_text: "등에 표식",
        conditions_json: "{}",
        priority: 0,
        enabled: 0,
        created_at: "",
        updated_at: "",
        conditions: {
          evidenceKind: "BODY_REGION_EXPOSED" as const,
          region: "upper_back",
        },
        secret: {
          id: "s1",
          persona_id: 1,
          secret_key: "mark",
          owner_title: "",
          category: "OTHER" as const,
          importance: "NORMAL" as const,
          canonical_secret_text: "x",
          suspected_fact_text: "",
          confirmed_fact_text: "등에 표식",
          discoverability: "DISCOVERABLE" as const,
          chat_scope_policy: "CHAT_ONLY" as const,
          is_active: 1,
          revision: 1,
          created_at: "",
          updated_at: "",
        },
      } satisfies EligibleVisualRule;
      const event = baseEvent({
        eventType: "BODY_REGION_EXPOSED",
        attributes: { region: "upper_back" },
        visibility: { mode: "SCENE_PARTICIPANTS" },
      });
      assert.equal(matchVisualDiscoveryRule(event, rule, 17), null);
    });
  });

  describe("idempotency + transitions", () => {
    it("retry same turn → one knowledge row; CONFIRMED not downgraded", () => {
      const { personaId, chatId, characterId } = uniqueIds();
      compileAndApplyPersonaSecrets({
        personaId,
        source: "등에 문신이 있다.",
      });
      const input = {
        chatId,
        characterId,
        turnNumber: 3,
        sourceMessageId: 303,
        userMessage: "렌은 셔츠를 벗어 등을 드러냈다.",
        publicPersonaId: personaId,
      };
      extractAndPersistSceneEvidence(input);
      runVisualDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 3,
        sourceMessageId: 303,
      });
      runVisualDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 3,
        sourceMessageId: 303,
      });
      const secret = listExistingPersonaSecrets(personaId).find((s) => s.is_active === 1)!;
      const k = getCharacterSecretKnowledge({
        chatId,
        personaId,
        secretId: secret.id,
        characterId,
      });
      assert.equal(k?.knowledge_state, "CONFIRMED");

      const events = getDb()
        .prepare(
          `SELECT COUNT(*) AS c FROM persona_secret_evidence_events
           WHERE chat_id=? AND secret_id=? AND method='VISUAL_DISCOVERY'`
        )
        .get(chatId, secret.id) as { c: number };
      assert.equal(events.c, 1);

      const key = buildVisualDiscoveryIdempotencyKey({
        sceneEvidenceEventId: listSceneEvidenceEventsForChatTurn({
          chatId,
          turnNumber: 3,
        })[0]!.id,
        discoveryRuleId: listEligibleVisualDiscoveryRules(personaId)[0]!.id,
        observerId: String(characterId),
      });
      assert.match(key, /^visual-discovery:/);
    });

    it("cross-chat isolation", () => {
      const { personaId, chatId, characterId } = uniqueIds();
      const chatB = chatId + 1;
      compileAndApplyPersonaSecrets({
        personaId,
        source: "등에 문신이 있다.",
      });
      extractAndPersistSceneEvidence({
        chatId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 1,
        userMessage: "렌은 셔츠를 벗어 등을 드러냈다.",
        publicPersonaId: personaId,
      });
      runVisualDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 1,
      });
      const secret = listExistingPersonaSecrets(personaId).find((s) => s.is_active === 1)!;
      assert.ok(
        getCharacterSecretKnowledge({
          chatId,
          personaId,
          secretId: secret.id,
          characterId,
        })
      );
      assert.equal(
        getCharacterSecretKnowledge({
          chatId: chatB,
          personaId,
          secretId: secret.id,
          characterId,
        }),
        null
      );
    });
  });

  describe("eligibility", () => {
    it("needsReview / low confidence visual rules are not eligible", () => {
      const { personaId } = uniqueIds();
      // OTHER category → needsReview + low confidence
      compileAndApplyPersonaSecrets({
        personaId,
        source: "이상한 비밀이 하나 있다.",
      });
      const eligible = listEligibleVisualDiscoveryRules(personaId);
      assert.equal(eligible.length, 0);
    });
  });
});
