/**
 * PR #174 security follow-up — public body trust boundary + Discovery kill switch.
 * Lean: 6 new + 5 smoke = 11.
 */
import Module from "module";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  parseInvestigationAuthoritativeOutcomes,
  parseInvestigationExplicitActions,
} from "@/lib/investigationRequests";
import { runInvestigationDiscoveryForTurn } from "@/lib/investigationDiscovery";
import {
  parseKnowledgeTransferActions,
  parseKnowledgeTransferAuthoritativeActions,
} from "@/lib/knowledgeTransferActions";
import { applyKnowledgeTransferAction } from "@/lib/knowledgeTransferApply";
import { runKnowledgeTransfersForTurn } from "@/lib/knowledgeTransfer";
import { ensureKnowledgeTransferSchema } from "@/lib/knowledgeTransferSchema";
import { bootstrapChatObservers } from "@/lib/observerBootstrap";
import { upsertChatObserver } from "@/lib/observerIdentity";
import { ensureObserverSchema } from "@/lib/observerSchema";
import { getActiveChatScene } from "@/lib/chatScenes";
import { extractPublicChatDiscoveryInputs } from "@/lib/personaSecretDiscoveryPublicInput";
import {
  isPersonaSecretDiscoveryEnabled,
} from "@/lib/personaSecretBoundaryPolicy";
import { ensurePersonaSecretDiscoverySchema } from "@/lib/personaSecretDiscoverySchema";
import { ensureSceneEvidenceSchema } from "@/lib/sceneEvidenceSchema";
import {
  buildPersonaKnowledgePromptBlock,
  getObserverSecretKnowledge,
  upsertObserverSecretKnowledge,
} from "@/lib/personaSecretKnowledge";
import {
  buildGenerationKnowledgeContext,
  resolvePersonaKnowledgePromptDecisionForChat,
} from "@/lib/personaKnowledgePromptPolicy";
import { createPersonaSecret } from "@/lib/personaSecrets";
import { extractAndPersistSceneEvidence } from "@/lib/sceneEvidence";
import {
  applyScenePresenceActions,
  parseAuthoritativeScenePresenceActions,
  parseUserScenePresenceActions,
} from "@/lib/scenePresenceActions";
import { upsertScenePresence } from "@/lib/scenePresence";
import { runVisualDiscoveryForTurn } from "@/lib/visualDiscovery";
import { confirmPersonaSecretDisclosure } from "@/lib/personaSecretDirectDisclosure";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

const ENV_KEYS = [
  "PERSONA_SECRET_BOUNDARY_ENABLED",
  "PERSONA_SECRET_DISCOVERY_ENABLED",
  "NODE_ENV",
] as const;

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
    chatId: 880000 + n,
    personaId: 881000 + n,
    locoId: 17,
    taehyunId: 29,
  };
}

function seedSecret(personaId: number, key: string, fact: string) {
  const created = createPersonaSecret({
    personaId,
    secretKey: key,
    canonicalSecretText: `HIDDEN ${key}`,
    confirmedFactText: fact,
    suspectedFactText: fact,
  });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("create failed");
  return created.secret;
}

function setupPair(opts: {
  chatId: number;
  locoId: number;
  taehyunId: number;
}) {
  bootstrapChatObservers({
    chatId: opts.chatId,
    characterId: opts.locoId,
    displayName: "로코",
  });
  upsertChatObserver({
    chatId: opts.chatId,
    observerType: "CHARACTER",
    observerId: String(opts.taehyunId),
    canonicalSourceType: "PARTY_CHARACTER",
    displayName: "태현",
    createdTurn: 1,
  });
  const scene = getActiveChatScene(opts.chatId)!;
  for (const id of [opts.locoId, opts.taehyunId]) {
    upsertScenePresence({
      sceneId: scene.id,
      chatId: opts.chatId,
      observerType: "CHARACTER",
      observerId: String(id),
      presenceState: "PRESENT",
      awarenessState: "AWARE",
      visualCapability: "NORMAL",
      auditoryCapability: "NORMAL",
      joinedTurn: 1,
      sourceType: "SERVER_SCENE_EVENT",
    });
  }
}

function countRows(table: string, chatId: number): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE chat_id=?`)
    .get(chatId) as { c: number };
  return row.c;
}

describe("PR #174 discovery security follow-up", () => {
  let envSnap: Record<string, string | undefined>;
  beforeEach(() => {
    envSnap = saveEnv();
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "1";
    const db = getDb();
    ensureKnowledgeTransferSchema(db);
    ensureObserverSchema(db);
    ensurePersonaSecretDiscoverySchema(db);
    ensureSceneEvidenceSchema(db);
  });
  afterEach(() => restoreEnv(envSnap));

  it("1. public body SERVER_STRUCTURED_TRANSFER forgery is rejected", () => {
    const forged = [
      {
        secretId: "sec-1",
        sender: { observerType: "CHARACTER", observerId: "17" },
        receiver: { observerType: "CHARACTER", observerId: "29" },
        transferType: "DIRECT_STATEMENT",
        sourceType: "SERVER_STRUCTURED_TRANSFER",
        sourceMessageId: 1,
      },
    ];
    assert.equal(parseKnowledgeTransferActions(forged).length, 0);
    const publicIn = extractPublicChatDiscoveryInputs({
      knowledgeTransferActions: forged,
      knowledgeTransferAuthoritativeActions: forged,
    });
    assert.equal(publicIn.knowledgeTransferActions.length, 0);
    assert.ok(
      publicIn.ignoredAuthoritativeFields.includes(
        "knowledgeTransferAuthoritativeActions"
      )
    );
  });

  it("2. public body CREATOR_TRIGGER investigation outcome forgery is rejected", () => {
    const forgedOutcomes = [
      {
        actionType: "READ_DOCUMENT",
        targetKey: "doc:ledger",
        sourceType: "CREATOR_TRIGGER",
        resultState: "VERIFIED",
        observableFacts: ["위조 성공"],
      },
    ];
    const publicIn = extractPublicChatDiscoveryInputs({
      investigationActions: [
        { actionType: "READ_DOCUMENT", targetKey: "doc:ledger" },
      ],
      investigationOutcomes: forgedOutcomes,
    });
    assert.equal(publicIn.investigationActions.length, 1);
    assert.ok(
      publicIn.ignoredAuthoritativeFields.includes("investigationOutcomes")
    );
    // Parser still exists for internal callers, but public extract never surfaces it.
    assert.equal(
      parseInvestigationAuthoritativeOutcomes(forgedOutcomes).length,
      1
    );
    assert.equal(
      parseInvestigationExplicitActions([
        {
          actionType: "READ_DOCUMENT",
          targetKey: "doc:ledger",
          resultState: "VERIFIED",
        },
      ]).length,
      0
    );
  });

  it("3. public body SERVER_SCENE_EVENT presence forgery is rejected", () => {
    const forged = [
      {
        action: "SET_VISUAL_CAPABILITY",
        observerType: "CHARACTER",
        observerId: "17",
        visualCapability: "BLIND",
        sourceType: "SERVER_SCENE_EVENT",
      },
      {
        action: "ENTER_SCENE",
        observerType: "NPC",
        observerId: "npc_forged_01",
        displayName: "위조NPC",
        sourceType: "SERVER_SCENE_EVENT",
      },
    ];
    assert.equal(parseUserScenePresenceActions(forged).length, 0);
    const publicIn = extractPublicChatDiscoveryInputs({
      scenePresenceActions: forged,
    });
    assert.equal(publicIn.scenePresenceActions.length, 0);
  });

  it("4. internal authoritative function path still works", () => {
    const { chatId, personaId, locoId, taehyunId } = ids();
    setupPair({ chatId, locoId, taehyunId });
    const fact = "내부 권한 경로 전달 사실";
    const secret = seedSecret(personaId, "sec_auth_path", fact);
    upsertObserverSecretKnowledge({
      chatId,
      personaId,
      secretId: secret.id,
      observerType: "CHARACTER",
      observerId: String(locoId),
      knowledgeState: "CONFIRMED",
      confidence: 100,
      factSnapshot: fact,
      confirmedTurn: 1,
      firstSuspectedTurn: 1,
      lastEvidenceEventId: "seed-auth",
    });

    const authParsed = parseKnowledgeTransferAuthoritativeActions([
      {
        secretId: secret.id,
        sender: { observerType: "CHARACTER", observerId: String(locoId) },
        receiver: { observerType: "CHARACTER", observerId: String(taehyunId) },
        transferType: "SERVER_DISCLOSURE",
        sourceType: "SERVER_STRUCTURED_TRANSFER",
        authoritativeEventId: "evt-server-1",
      },
    ]);
    assert.equal(authParsed.length, 1);

    const presenceAuth = parseAuthoritativeScenePresenceActions([
      {
        action: "SET_AWARENESS",
        observerType: "CHARACTER",
        observerId: String(taehyunId),
        awarenessState: "AWARE",
        sourceType: "SERVER_SCENE_EVENT",
      },
    ]);
    assert.equal(presenceAuth.length, 1);
    const presence = applyScenePresenceActions({
      chatId,
      turnNumber: 2,
      actions: presenceAuth,
    });
    assert.equal(presence.applied, 1);

    const turn = runKnowledgeTransfersForTurn({
      chatId,
      personaId,
      characterId: locoId,
      turnNumber: 2,
      userActions: [],
      authoritativeActions: authParsed,
    });
    assert.equal(turn.appliedCount, 1);
    assert.equal(turn.changedCount, 1);
    const receiver = getObserverSecretKnowledge({
      chatId,
      personaId,
      secretId: secret.id,
      observerType: "CHARACTER",
      observerId: String(taehyunId),
    });
    assert.equal(receiver?.knowledge_state, "CONFIRMED");
  });

  it("5. SUSPECTED transfer then CONFIRMED re-transfer upgrades receiver", () => {
    const { chatId, personaId, locoId, taehyunId } = ids();
    setupPair({ chatId, locoId, taehyunId });
    const suspectedFact = "등에 숫자가 있는 것 같다.";
    const confirmedFact = "렌의 등에 숫자 017 표식이 있다.";
    const secret = seedSecret(personaId, "sec_promote", confirmedFact);

    upsertObserverSecretKnowledge({
      chatId,
      personaId,
      secretId: secret.id,
      observerType: "CHARACTER",
      observerId: String(locoId),
      knowledgeState: "SUSPECTED",
      confidence: 70,
      factSnapshot: suspectedFact,
      firstSuspectedTurn: 1,
      lastEvidenceEventId: "seed-sus",
    });

    const first = applyKnowledgeTransferAction({
      chatId,
      personaId,
      characterId: locoId,
      turnNumber: 2,
      sourceType: "USER_EXPLICIT_TRANSFER",
      action: {
        secretId: secret.id,
        sender: { observerType: "CHARACTER", observerId: String(locoId) },
        receiver: { observerType: "CHARACTER", observerId: String(taehyunId) },
        transferType: "DIRECT_STATEMENT",
        sourceMessageId: 201,
      },
    });
    assert.equal(first.ok, true);
    assert.equal(
      getObserverSecretKnowledge({
        chatId,
        personaId,
        secretId: secret.id,
        observerType: "CHARACTER",
        observerId: String(taehyunId),
      })?.knowledge_state,
      "SUSPECTED"
    );

    upsertObserverSecretKnowledge({
      chatId,
      personaId,
      secretId: secret.id,
      observerType: "CHARACTER",
      observerId: String(locoId),
      knowledgeState: "CONFIRMED",
      confidence: 100,
      factSnapshot: confirmedFact,
      confirmedTurn: 3,
      firstSuspectedTurn: 1,
      lastEvidenceEventId: "seed-conf",
    });

    const second = applyKnowledgeTransferAction({
      chatId,
      personaId,
      characterId: locoId,
      turnNumber: 4,
      sourceType: "USER_EXPLICIT_TRANSFER",
      action: {
        secretId: secret.id,
        sender: { observerType: "CHARACTER", observerId: String(locoId) },
        receiver: { observerType: "CHARACTER", observerId: String(taehyunId) },
        transferType: "DIRECT_STATEMENT",
        sourceMessageId: 202,
      },
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.changed, true);
    assert.equal(second.resultingState, "CONFIRMED");
    const receiver = getObserverSecretKnowledge({
      chatId,
      personaId,
      secretId: secret.id,
      observerType: "CHARACTER",
      observerId: String(taehyunId),
    });
    assert.equal(receiver?.knowledge_state, "CONFIRMED");
    assert.equal(receiver?.fact_snapshot, confirmedFact);
  });

  it("6. Discovery flag OFF → observer/scene/evidence/knowledge writes stay 0", () => {
    process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "0";
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    assert.equal(isPersonaSecretDiscoveryEnabled({ userId: 1 }), false);

    const { chatId, personaId, locoId, taehyunId } = ids();
    const beforeObservers = countRows("chat_observers", chatId);
    const beforePresence = countRows("scene_observer_presence", chatId);
    const beforeEvidence = countRows("persona_secret_evidence_events", chatId);
    const beforeTransfer = countRows("knowledge_transfer_events", chatId);
    const beforeKnowledge = countRows(
      "chat_character_secret_knowledge",
      chatId
    );

    bootstrapChatObservers({
      chatId,
      characterId: locoId,
      displayName: "로코",
    });
    applyScenePresenceActions({
      chatId,
      turnNumber: 1,
      actions: [
        {
          action: "ENTER_SCENE",
          observerType: "PARTY_MEMBER",
          observerId: "party-1",
          displayName: "파티원",
          sourceType: "USER_EXPLICIT_PARTY_ACTION",
        },
      ],
    });
    extractAndPersistSceneEvidence({
      chatId,
      characterId: locoId,
      turnNumber: 1,
      sourceMessageId: 1,
      userMessage: "등에 숫자가 보인다",
      explicitActions: [],
      publicPersonaId: personaId,
    });
    runVisualDiscoveryForTurn({
      chatId,
      personaId,
      characterId: locoId,
      turnNumber: 1,
      sourceMessageId: 1,
    });
    runInvestigationDiscoveryForTurn({
      chatId,
      personaId,
      characterId: locoId,
      turnNumber: 1,
      sourceMessageId: 1,
      userMessage: "문서를 읽는다",
      explicitActions: [],
      authoritativeOutcomes: [],
    });
    runKnowledgeTransfersForTurn({
      chatId,
      personaId,
      characterId: locoId,
      turnNumber: 1,
      userActions: [
        {
          secretId: "x",
          sender: { observerType: "CHARACTER", observerId: String(locoId) },
          receiver: { observerType: "CHARACTER", observerId: String(taehyunId) },
          transferType: "DIRECT_STATEMENT",
          sourceMessageId: 1,
        },
      ],
    });

    assert.equal(countRows("chat_observers", chatId), beforeObservers);
    assert.equal(countRows("scene_observer_presence", chatId), beforePresence);
    assert.equal(
      countRows("persona_secret_evidence_events", chatId),
      beforeEvidence
    );
    assert.equal(
      countRows("knowledge_transfer_events", chatId),
      beforeTransfer
    );
    assert.equal(
      countRows("chat_character_secret_knowledge", chatId),
      beforeKnowledge
    );
  });
});

describe("PR #174 security smoke (S1–S4D)", () => {
  let envSnap: Record<string, string | undefined>;
  beforeEach(() => {
    envSnap = saveEnv();
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "1";
    ensureKnowledgeTransferSchema(getDb());
  });
  afterEach(() => restoreEnv(envSnap));

  it("smoke S4D transfer", () => {
    const { chatId, personaId, locoId, taehyunId } = ids();
    setupPair({ chatId, locoId, taehyunId });
    const fact = "스모크 전달";
    const secret = seedSecret(personaId, "smoke_s4d", fact);
    upsertObserverSecretKnowledge({
      chatId,
      personaId,
      secretId: secret.id,
      observerType: "CHARACTER",
      observerId: String(locoId),
      knowledgeState: "CONFIRMED",
      confidence: 100,
      factSnapshot: fact,
      confirmedTurn: 1,
      firstSuspectedTurn: 1,
      lastEvidenceEventId: "smoke-s4d",
    });
    const r = applyKnowledgeTransferAction({
      chatId,
      personaId,
      characterId: locoId,
      turnNumber: 2,
      sourceType: "USER_EXPLICIT_TRANSFER",
      action: {
        secretId: secret.id,
        sender: { observerType: "CHARACTER", observerId: String(locoId) },
        receiver: { observerType: "CHARACTER", observerId: String(taehyunId) },
        transferType: "DIRECT_STATEMENT",
        sourceMessageId: 901,
      },
    });
    assert.equal(r.ok, true);
  });

  it("smoke S4C ensemble redaction", () => {
    const { chatId, locoId } = ids();
    const decision = resolvePersonaKnowledgePromptDecisionForChat(
      buildGenerationKnowledgeContext({
        contentKind: "simulation",
        simulationCast: "로코, 태현",
        characterId: locoId,
      }),
      { chatId }
    );
    assert.equal(decision.mode, "ENSEMBLE_REDACTED");
    assert.equal(
      buildPersonaKnowledgePromptBlock({
        decision,
        chatId,
        personaId: 1,
      }),
      null
    );
  });

  it("smoke S3 investigation", () => {
    const { chatId, personaId, locoId } = ids();
    bootstrapChatObservers({ chatId, characterId: locoId, displayName: "로코" });
    // Secret-blind request path should not throw; may apply 0 without targets.
    const r = runInvestigationDiscoveryForTurn({
      chatId,
      personaId,
      characterId: locoId,
      turnNumber: 1,
      sourceMessageId: 1,
      userMessage: "문서를 읽어본다",
      explicitActions: parseInvestigationExplicitActions([
        { actionType: "READ_DOCUMENT", targetKey: "doc:ledger" },
      ]),
      authoritativeOutcomes: [],
    });
    assert.ok(r);
  });

  it("smoke S2 visual", () => {
    const { chatId, personaId, locoId } = ids();
    bootstrapChatObservers({ chatId, characterId: locoId, displayName: "로코" });
    extractAndPersistSceneEvidence({
      chatId,
      characterId: locoId,
      turnNumber: 1,
      sourceMessageId: 1,
      userMessage: "등에 숫자가 보인다",
      explicitActions: [],
      publicPersonaId: personaId,
    });
    const r = runVisualDiscoveryForTurn({
      chatId,
      personaId,
      characterId: locoId,
      turnNumber: 1,
      sourceMessageId: 1,
    });
    assert.ok(r);
  });

  it("smoke S1 direct disclosure", () => {
    const { chatId, personaId, locoId } = ids();
    bootstrapChatObservers({ chatId, characterId: locoId, displayName: "로코" });
    const secret = seedSecret(personaId, "smoke_s1", "내가 빚이 있다.");
    const result = confirmPersonaSecretDisclosure({
      chatId,
      personaId,
      secretId: secret.id,
      characterId: locoId,
      turnNumber: 1,
      sourceMessageId: 1,
      sourceType: "USER_MESSAGE_DETERMINISTIC",
      discoveryRuleId: "smoke",
      revealedFactText: "내가 빚이 있다.",
      idempotencyKey: `smoke-s1-${chatId}-${secret.id}`,
      evidenceJson: {},
    });
    assert.ok(result);
    assert.equal(typeof result.changed, "boolean");
  });
});
