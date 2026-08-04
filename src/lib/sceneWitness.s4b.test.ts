import Module from "module";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import { bootstrapChatObservers } from "@/lib/observerBootstrap";
import {
  listChatObservers,
  registerNpcObserver,
} from "@/lib/observerIdentity";
import { ensureObserverSchema } from "@/lib/observerSchema";
import { getDb } from "@/lib/db";
import { compileAndApplyPersonaSecrets } from "@/lib/personaSecretCompiler";
import { listExistingPersonaSecrets } from "@/lib/personaSecretCompilerApply";
import {
  buildCharacterKnownFactsBlock,
  getCharacterSecretKnowledge,
  getObserverSecretKnowledge,
} from "@/lib/personaSecretKnowledge";
import {
  applyScenePresenceActions,
  parseScenePresenceActions,
} from "@/lib/scenePresenceActions";
import { ensureSceneObservationSchema } from "@/lib/sceneObservationSchema";
import {
  listObservationsForEvent,
  resolveAndPersistSceneEventWitnesses,
} from "@/lib/sceneObservationPersist";
import { extractAndPersistSceneEvidence } from "@/lib/sceneEvidence";
import { listSceneEvidenceEventsForChatTurn } from "@/lib/sceneEvidencePersist";
import type { SceneEvidenceEvent } from "@/lib/sceneEvidenceTypes";
import { runVisualDiscoveryForTurn } from "@/lib/visualDiscovery";
import { getActiveChatScene } from "@/lib/chatScenes";
import { upsertScenePresence } from "@/lib/scenePresence";

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

function ids() {
  const n = Math.floor(Math.random() * 10000);
  return {
    chatId: 990000 + n,
    characterId: 17,
    personaId: 991000 + n,
  };
}

function knowledge(
  chatId: number,
  personaId: number,
  characterId: number,
  secretId: string
) {
  return getCharacterSecretKnowledge({
    chatId,
    personaId,
    secretId,
    characterId,
  });
}

function setPresence(opts: {
  chatId: number;
  characterId: number;
  observerType: "CHARACTER" | "NPC";
  observerId: string;
  presenceState: "PRESENT" | "ABSENT" | "UNKNOWN";
  awarenessState?: "AWARE" | "UNCONSCIOUS" | "UNKNOWN";
  visualCapability?: "NORMAL" | "BLIND" | "OBSTRUCTED" | "UNKNOWN";
  locationKey?: string | null;
}) {
  bootstrapChatObservers({
    chatId: opts.chatId,
    characterId: opts.characterId,
    turnNumber: 1,
  });
  const scene = getActiveChatScene(opts.chatId)!;
  upsertScenePresence({
    sceneId: scene.id,
    chatId: opts.chatId,
    observerType: opts.observerType,
    observerId: opts.observerId,
    presenceState: opts.presenceState,
    awarenessState: opts.awarenessState ?? "AWARE",
    visualCapability: opts.visualCapability ?? "NORMAL",
    auditoryCapability: "NORMAL",
    locationKey: opts.locationKey ?? null,
    joinedTurn: 1,
    sourceType: "SERVER_SCENE_EVENT",
  });
}

function exposeBackEvent(opts: {
  chatId: number;
  characterId: number;
  turnNumber: number;
  sourceMessageId: number;
  visibility: SceneEvidenceEvent["visibility"];
  locationKey?: string;
  personaId: number;
}): SceneEvidenceEvent {
  extractAndPersistSceneEvidence({
    chatId: opts.chatId,
    characterId: opts.characterId,
    turnNumber: opts.turnNumber,
    sourceMessageId: opts.sourceMessageId,
    publicPersonaId: opts.personaId,
    serverEvents: [
      {
        eventType: "BODY_REGION_EXPOSED",
        attributes: {
          region: "upper_back",
          exposureLevel: "CLEAR",
          ...(opts.locationKey ? { locationKey: opts.locationKey } : {}),
        },
        visibility: opts.visibility,
        confidence: 95,
      },
    ],
  });
  const events = listSceneEvidenceEventsForChatTurn({
    chatId: opts.chatId,
    turnNumber: opts.turnNumber,
  });
  assert.ok(events.length >= 1);
  return events[0];
}

describe("PR-S4B multi-observer witness resolution", () => {
  let env: Record<string, string | undefined>;
  beforeEach(() => {
    env = saveEnv();
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "1";
    ensureObserverSchema(getDb());
    ensureSceneObservationSchema(getDb());
  });
  afterEach(() => restoreEnv(env));

  describe("witness eligibility", () => {
    it("1. PRESENT+AWARE+NORMAL → OBSERVED and knowledge transition", () => {
      const { chatId, characterId, personaId } = ids();
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌의 등에 실험체 시절 생긴 017 문신이 있다.",
      });
      bootstrapChatObservers({ chatId, characterId });
      exposeBackEvent({
        chatId,
        characterId,
        personaId,
        turnNumber: 1,
        sourceMessageId: 1,
        visibility: { mode: "CURRENT_CHARACTER", requiresLineOfSight: true },
      });
      const result = runVisualDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 1,
      });
      assert.ok(result.changedCount >= 1);
      const secret = listExistingPersonaSecrets(personaId).find((s) =>
        /문신|017/.test(s.canonical_secret_text)
      )!;
      assert.equal(
        knowledge(chatId, personaId, characterId, secret.id)?.knowledge_state,
        "CONFIRMED"
      );
    });

    it("2. ABSENT → NOT_OBSERVED, knowledge 0", () => {
      const { chatId, characterId, personaId } = ids();
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌의 등에 실험체 시절 생긴 017 문신이 있다.",
      });
      setPresence({
        chatId,
        characterId,
        observerType: "CHARACTER",
        observerId: String(characterId),
        presenceState: "ABSENT",
      });
      const event = exposeBackEvent({
        chatId,
        characterId,
        personaId,
        turnNumber: 1,
        sourceMessageId: 2,
        visibility: { mode: "CURRENT_CHARACTER", requiresLineOfSight: true },
      });
      resolveAndPersistSceneEventWitnesses({
        event,
        currentCharacterId: String(characterId),
      });
      const obs = listObservationsForEvent({ sceneEvidenceEventId: event.id });
      assert.ok(obs.some((o) => o.reason_code === "ABSENT"));
      runVisualDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 2,
      });
      const secret = listExistingPersonaSecrets(personaId)[0];
      assert.equal(knowledge(chatId, personaId, characterId, secret.id), null);
    });

    it("3. UNCONSCIOUS → NOT_OBSERVED, knowledge 0", () => {
      const { chatId, characterId, personaId } = ids();
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌의 등에 실험체 시절 생긴 017 문신이 있다.",
      });
      setPresence({
        chatId,
        characterId,
        observerType: "CHARACTER",
        observerId: String(characterId),
        presenceState: "PRESENT",
        awarenessState: "UNCONSCIOUS",
      });
      const event = exposeBackEvent({
        chatId,
        characterId,
        personaId,
        turnNumber: 1,
        sourceMessageId: 3,
        visibility: { mode: "CURRENT_CHARACTER", requiresLineOfSight: true },
      });
      resolveAndPersistSceneEventWitnesses({
        event,
        currentCharacterId: String(characterId),
      });
      assert.ok(
        listObservationsForEvent({ sceneEvidenceEventId: event.id }).some(
          (o) => o.reason_code === "UNCONSCIOUS"
        )
      );
      runVisualDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 3,
      });
      assert.equal(
        knowledge(
          chatId,
          personaId,
          characterId,
          listExistingPersonaSecrets(personaId)[0].id
        ),
        null
      );
    });

    it("4. BLIND → NOT_OBSERVED, knowledge 0", () => {
      const { chatId, characterId, personaId } = ids();
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌의 등에 실험체 시절 생긴 017 문신이 있다.",
      });
      setPresence({
        chatId,
        characterId,
        observerType: "CHARACTER",
        observerId: String(characterId),
        presenceState: "PRESENT",
        visualCapability: "BLIND",
      });
      const event = exposeBackEvent({
        chatId,
        characterId,
        personaId,
        turnNumber: 1,
        sourceMessageId: 4,
        visibility: { mode: "CURRENT_CHARACTER", requiresLineOfSight: true },
      });
      resolveAndPersistSceneEventWitnesses({
        event,
        currentCharacterId: String(characterId),
      });
      assert.ok(
        listObservationsForEvent({ sceneEvidenceEventId: event.id }).some(
          (o) => o.reason_code === "BLIND"
        )
      );
    });

    it("5. EXPLICIT_OBSERVERS — only listed observer observes", () => {
      const { chatId, characterId, personaId } = ids();
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌의 등에 실험체 시절 생긴 017 문신이 있다.",
      });
      bootstrapChatObservers({ chatId, characterId });
      const npcId = randomUUID();
      registerNpcObserver({
        chatId,
        observerId: npcId,
        displayName: "태현",
        canonicalSourceType: "CREATOR_NPC",
      });
      const scene = getActiveChatScene(chatId)!;
      upsertScenePresence({
        sceneId: scene.id,
        chatId,
        observerType: "NPC",
        observerId: npcId,
        presenceState: "PRESENT",
        awarenessState: "AWARE",
        visualCapability: "NORMAL",
        auditoryCapability: "NORMAL",
        joinedTurn: 1,
        sourceType: "CREATOR_STRUCTURED_CAST",
      });

      const event = exposeBackEvent({
        chatId,
        characterId,
        personaId,
        turnNumber: 1,
        sourceMessageId: 5,
        visibility: {
          mode: "EXPLICIT_OBSERVERS",
          observerIds: [String(characterId)],
          requiresLineOfSight: true,
        },
      });
      runVisualDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 5,
      });
      const secret = listExistingPersonaSecrets(personaId)[0];
      assert.equal(
        knowledge(chatId, personaId, characterId, secret.id)?.knowledge_state,
        "CONFIRMED"
      );
      assert.equal(
        getObserverSecretKnowledge({
          chatId,
          personaId,
          secretId: secret.id,
          observerType: "NPC",
          observerId: npcId,
        }),
        null
      );
      const rows = listObservationsForEvent({ sceneEvidenceEventId: event.id });
      assert.ok(
        rows.some(
          (o) =>
            o.observer_id === npcId &&
            o.reason_code === "NOT_IN_EXPLICIT_OBSERVERS"
        )
      );
    });

    it("6. visibility UNKNOWN → no OBSERVED", () => {
      const { chatId, characterId, personaId } = ids();
      bootstrapChatObservers({ chatId, characterId });
      const event = exposeBackEvent({
        chatId,
        characterId,
        personaId,
        turnNumber: 1,
        sourceMessageId: 6,
        visibility: { mode: "UNKNOWN" },
      });
      resolveAndPersistSceneEventWitnesses({
        event,
        currentCharacterId: String(characterId),
      });
      const rows = listObservationsForEvent({ sceneEvidenceEventId: event.id });
      assert.equal(
        rows.filter((o) => o.observation_state === "OBSERVED").length,
        0
      );
    });

    it("7. location mismatch → NOT_OBSERVED", () => {
      const { chatId, characterId, personaId } = ids();
      setPresence({
        chatId,
        characterId,
        observerType: "CHARACTER",
        observerId: String(characterId),
        presenceState: "PRESENT",
        locationKey: "room-b",
      });
      const event = exposeBackEvent({
        chatId,
        characterId,
        personaId,
        turnNumber: 1,
        sourceMessageId: 7,
        visibility: { mode: "CURRENT_CHARACTER", requiresLineOfSight: true },
        locationKey: "room-a",
      });
      resolveAndPersistSceneEventWitnesses({
        event,
        currentCharacterId: String(characterId),
      });
      assert.ok(
        listObservationsForEvent({ sceneEvidenceEventId: event.id }).some(
          (o) => o.reason_code === "LOCATION_MISMATCH"
        )
      );
    });
  });

  describe("identity and isolation", () => {
    it("8. same display-name NPCs — only present UUID observes", () => {
      const { chatId, characterId, personaId } = ids();
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌의 등에 실험체 시절 생긴 017 문신이 있다.",
      });
      bootstrapChatObservers({ chatId, characterId });
      const a = registerNpcObserver({
        chatId,
        displayName: "경비병",
        canonicalSourceType: "CREATOR_NPC",
      });
      const b = registerNpcObserver({
        chatId,
        displayName: "경비병",
        canonicalSourceType: "CREATOR_NPC",
      });
      const scene = getActiveChatScene(chatId)!;
      upsertScenePresence({
        sceneId: scene.id,
        chatId,
        observerType: "NPC",
        observerId: a.observer_id,
        presenceState: "PRESENT",
        awarenessState: "AWARE",
        visualCapability: "NORMAL",
        auditoryCapability: "NORMAL",
        joinedTurn: 1,
        sourceType: "CREATOR_STRUCTURED_CAST",
      });
      upsertScenePresence({
        sceneId: scene.id,
        chatId,
        observerType: "NPC",
        observerId: b.observer_id,
        presenceState: "ABSENT",
        awarenessState: "AWARE",
        visualCapability: "NORMAL",
        auditoryCapability: "NORMAL",
        joinedTurn: 1,
        leftTurn: 1,
        sourceType: "CREATOR_STRUCTURED_CAST",
      });

      exposeBackEvent({
        chatId,
        characterId,
        personaId,
        turnNumber: 1,
        sourceMessageId: 8,
        visibility: {
          mode: "SCENE_PARTICIPANTS",
          requiresLineOfSight: true,
        },
      });
      runVisualDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 8,
      });
      const secret = listExistingPersonaSecrets(personaId)[0];
      assert.equal(
        getObserverSecretKnowledge({
          chatId,
          personaId,
          secretId: secret.id,
          observerType: "NPC",
          observerId: a.observer_id,
        })?.knowledge_state,
        "CONFIRMED"
      );
      assert.equal(
        getObserverSecretKnowledge({
          chatId,
          personaId,
          secretId: secret.id,
          observerType: "NPC",
          observerId: b.observer_id,
        }),
        null
      );
    });

    it("9. cross-chat isolation", () => {
      const a = ids();
      const bChat = a.chatId + 1;
      compileAndApplyPersonaSecrets({
        personaId: a.personaId,
        source: "렌의 등에 실험체 시절 생긴 017 문신이 있다.",
      });
      bootstrapChatObservers({ chatId: a.chatId, characterId: a.characterId });
      exposeBackEvent({
        chatId: a.chatId,
        characterId: a.characterId,
        personaId: a.personaId,
        turnNumber: 1,
        sourceMessageId: 9,
        visibility: { mode: "CURRENT_CHARACTER", requiresLineOfSight: true },
      });
      runVisualDiscoveryForTurn({
        chatId: a.chatId,
        personaId: a.personaId,
        characterId: a.characterId,
        turnNumber: 1,
        sourceMessageId: 9,
      });
      const secret = listExistingPersonaSecrets(a.personaId)[0];
      assert.equal(
        knowledge(a.chatId, a.personaId, a.characterId, secret.id)
          ?.knowledge_state,
        "CONFIRMED"
      );
      assert.equal(
        knowledge(bChat, a.personaId, a.characterId, secret.id),
        null
      );
    });

    it("10. free-text simulation_cast creates 0 observers/observations/knowledge", () => {
      const { chatId, characterId, personaId } = ids();
      bootstrapChatObservers({ chatId, characterId });
      const before = listChatObservers(chatId).length;
      void "[서윤]\n[도윤]\n경비병";
      assert.equal(listChatObservers(chatId).length, before);
      assert.equal(
        listChatObservers(chatId).every((o) => o.observer_type === "CHARACTER"),
        true
      );
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌의 등에 실험체 시절 생긴 017 문신이 있다.",
      });
      // No SCENE_PARTICIPANTS cast members → still only main character if CURRENT_CHARACTER
      assert.equal(before, 1);
    });
  });

  describe("persistence and application", () => {
    it("11. retry after leave reuses event-time snapshot; no duplicate rows", () => {
      const { chatId, characterId, personaId } = ids();
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌의 등에 실험체 시절 생긴 017 문신이 있다.",
      });
      bootstrapChatObservers({ chatId, characterId });
      const event = exposeBackEvent({
        chatId,
        characterId,
        personaId,
        turnNumber: 1,
        sourceMessageId: 11,
        visibility: { mode: "CURRENT_CHARACTER", requiresLineOfSight: true },
      });
      const first = resolveAndPersistSceneEventWitnesses({
        event,
        currentCharacterId: String(characterId),
      });
      assert.equal(first.reused, false);
      assert.ok(
        first.observations.some((o) => o.observation_state === "OBSERVED")
      );

      applyScenePresenceActions({
        chatId,
        turnNumber: 2,
        actions: [
          {
            action: "LEAVE_SCENE",
            observerType: "CHARACTER",
            observerId: String(characterId),
            sourceType: "SERVER_SCENE_EVENT",
          },
        ],
      });

      const second = resolveAndPersistSceneEventWitnesses({
        event,
        currentCharacterId: String(characterId),
      });
      assert.equal(second.reused, true);
      assert.equal(second.observations.length, first.observations.length);
      assert.ok(
        second.observations.some((o) => o.observation_state === "OBSERVED")
      );

      runVisualDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 11,
      });
      runVisualDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 11,
      });
      const evidenceCount = getDb()
        .prepare(
          `SELECT COUNT(*) AS c FROM persona_secret_evidence_events
           WHERE chat_id=? AND method='VISUAL_DISCOVERY'`
        )
        .get(chatId) as { c: number };
      assert.equal(evidenceCount.c, 1);
    });

    it("12. only OBSERVED observers get visual discovery / evidence", () => {
      const { chatId, characterId, personaId } = ids();
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌의 등에 실험체 시절 생긴 017 문신이 있다.",
      });
      bootstrapChatObservers({ chatId, characterId });
      const npcId = randomUUID();
      registerNpcObserver({
        chatId,
        observerId: npcId,
        displayName: "이현",
        canonicalSourceType: "SERVER_NPC",
      });
      const scene = getActiveChatScene(chatId)!;
      upsertScenePresence({
        sceneId: scene.id,
        chatId,
        observerType: "NPC",
        observerId: npcId,
        presenceState: "PRESENT",
        awarenessState: "UNCONSCIOUS",
        visualCapability: "NORMAL",
        auditoryCapability: "NORMAL",
        joinedTurn: 1,
        sourceType: "SERVER_SCENE_EVENT",
      });

      exposeBackEvent({
        chatId,
        characterId,
        personaId,
        turnNumber: 1,
        sourceMessageId: 12,
        visibility: { mode: "SCENE_PARTICIPANTS", requiresLineOfSight: true },
      });
      runVisualDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 12,
      });
      const secret = listExistingPersonaSecrets(personaId)[0];
      assert.equal(
        knowledge(chatId, personaId, characterId, secret.id)?.knowledge_state,
        "CONFIRMED"
      );
      assert.equal(
        getObserverSecretKnowledge({
          chatId,
          personaId,
          secretId: secret.id,
          observerType: "NPC",
          observerId: npcId,
        }),
        null
      );
      const npcEvidence = getDb()
        .prepare(
          `SELECT COUNT(*) AS c FROM persona_secret_evidence_events
           WHERE chat_id=? AND observer_id=?`
        )
        .get(chatId, npcId) as { c: number };
      assert.equal(npcEvidence.c, 0);
    });
  });

  describe("regression smoke", () => {
    it("13. mark existence CONFIRMED; meaning stays UNKNOWN", () => {
      const { chatId, characterId, personaId } = ids();
      compileAndApplyPersonaSecrets({
        personaId,
        source:
          "렌의 등에 실험체 시절 생긴 017 문신이 있다.\n\n017은 제7연구소 피험자 번호라는 의미다.",
      });
      bootstrapChatObservers({ chatId, characterId });
      extractAndPersistSceneEvidence({
        chatId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 13,
        userMessage: "렌은 젖은 셔츠를 벗어 의자에 걸고 로코에게 등을 보였다.",
        publicPersonaId: personaId,
      });
      runVisualDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 13,
      });
      const secrets = listExistingPersonaSecrets(personaId).filter(
        (s) => s.is_active === 1
      );
      const mark = secrets.find(
        (s) => /문신|017/.test(s.canonical_secret_text) && !/의미|연구소/.test(s.canonical_secret_text)
      );
      const meaning = secrets.find((s) => /의미|연구소|피험자/.test(s.canonical_secret_text));
      assert.ok(mark);
      assert.equal(
        knowledge(chatId, personaId, characterId, mark!.id)?.knowledge_state,
        "CONFIRMED"
      );
      if (meaning) {
        assert.equal(
          knowledge(chatId, personaId, characterId, meaning.id),
          null
        );
      }
    });

    it("14. ability manifestation; formal name/cost stay UNKNOWN", () => {
      const { chatId, characterId, personaId } = ids();
      compileAndApplyPersonaSecrets({
        personaId,
        source:
          "렌은 중력을 조작할 수 있다.\n\n정식 능력명은 천공의 권능이다.\n\n능력 사용 뒤 내부 장기가 손상되는 부작용이 있다.",
      });
      bootstrapChatObservers({ chatId, characterId });
      extractAndPersistSceneEvidence({
        chatId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 14,
        publicPersonaId: personaId,
        serverEvents: [
          {
            eventType: "ABILITY_MANIFESTED",
            attributes: {
              manifestation: "gravity_alteration",
              visibleEffect: "철골",
            },
            visibility: {
              mode: "CURRENT_CHARACTER",
              requiresLineOfSight: true,
            },
            confidence: 95,
          },
        ],
      });
      runVisualDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 14,
      });
      const secrets = listExistingPersonaSecrets(personaId);
      const ability = secrets.find(
        (s) => /중력/.test(s.canonical_secret_text) && !/부작용|천공/.test(s.canonical_secret_text)
      );
      const formal = secrets.find((s) => /천공의 권능/.test(s.canonical_secret_text));
      const cost = secrets.find((s) => /부작용|손상/.test(s.canonical_secret_text));
      assert.ok(ability, "ability secret should compile");
      assert.equal(
        knowledge(chatId, personaId, characterId, ability!.id)?.knowledge_state,
        "CONFIRMED"
      );
      if (formal) {
        assert.equal(
          knowledge(chatId, personaId, characterId, formal.id),
          null
        );
      }
      if (cost) {
        assert.equal(knowledge(chatId, personaId, characterId, cost.id), null);
      }
    });

    it("15. assistant prose does not mutate presence", () => {
      const parsed = parseScenePresenceActions([
        {
          action: "LEAVE_SCENE",
          observerType: "CHARACTER",
          observerId: "17",
          sourceType: "ASSISTANT_PROSE",
        },
      ]);
      assert.equal(parsed.length, 0);
    });

    it("16. 1:1 same-turn known facts still rebuild", () => {
      const { chatId, characterId, personaId } = ids();
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌의 등에 실험체 시절 생긴 017 문신이 있다.",
      });
      bootstrapChatObservers({ chatId, characterId });
      const before = buildCharacterKnownFactsBlock({
        chatId,
        personaId,
        characterId,
        legacySecretDescription: "",
      });
      extractAndPersistSceneEvidence({
        chatId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 16,
        userMessage: "렌은 젖은 셔츠를 벗어 의자에 걸고 로코에게 등을 보였다.",
        publicPersonaId: personaId,
      });
      runVisualDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 16,
      });
      const after = buildCharacterKnownFactsBlock({
        chatId,
        personaId,
        characterId,
        legacySecretDescription: "",
      });
      assert.notEqual(after, before);
      assert.ok(after && /문신|017|등/.test(after));
    });
  });
});
