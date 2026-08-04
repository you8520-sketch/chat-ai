/**
 * PR-S4D — Controlled Knowledge Transfer lean suite (10) + smoke pointers.
 */
import Module from "module";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  parseKnowledgeTransferActions,
  parseKnowledgeTransferAuthoritativeActions,
} from "@/lib/knowledgeTransferActions";
import { applyKnowledgeTransferAction } from "@/lib/knowledgeTransferApply";
import { ensureKnowledgeTransferSchema } from "@/lib/knowledgeTransferSchema";
import { runKnowledgeTransfersForTurn } from "@/lib/knowledgeTransfer";
import { bootstrapChatObservers } from "@/lib/observerBootstrap";
import { getChatObserver, upsertChatObserver } from "@/lib/observerIdentity";
import { getActiveChatScene } from "@/lib/chatScenes";
import {
  buildGenerationKnowledgeContext,
  resolvePersonaKnowledgePromptDecisionForChat,
} from "@/lib/personaKnowledgePromptPolicy";
import {
  buildPersonaKnowledgePromptBlock,
  getObserverSecretKnowledge,
  upsertObserverSecretKnowledge,
} from "@/lib/personaSecretKnowledge";
import { createPersonaSecret } from "@/lib/personaSecrets";
import { getScenePresence, upsertScenePresence } from "@/lib/scenePresence";
import type { PersonaSecretTransferAction } from "@/lib/knowledgeTransferTypes";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

const ENV_KEYS = [
  "PERSONA_SECRET_BOUNDARY_ENABLED",
  "PERSONA_SECRET_DISCOVERY_ENABLED",
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
    chatId: 770000 + n,
    otherChatId: 771000 + n,
    personaId: 772000 + n,
    locoId: 17,
    taehyunId: 29,
  };
}

function countTransfers(chatId: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM knowledge_transfer_events WHERE chat_id=?`
    )
    .get(chatId) as { c: number };
  return row.c;
}

function countEvidence(chatId: number, method = "KNOWLEDGE_TRANSFER"): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM persona_secret_evidence_events
       WHERE chat_id=? AND method=?`
    )
    .get(chatId, method) as { c: number };
  return row.c;
}

function countKnowledge(chatId: number, personaId: number, secretId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM chat_character_secret_knowledge WHERE chat_id=? AND persona_id=? AND secret_id=?`
    )
    .get(chatId, personaId, secretId) as { c: number } | undefined;
  return row?.c ?? 0;
}

function seedSecret(opts: {
  personaId: number;
  secretKey: string;
  fact: string;
  canonical?: string;
}) {
  const created = createPersonaSecret({
    personaId: opts.personaId,
    secretKey: opts.secretKey,
    canonicalSecretText:
      opts.canonical ?? `HIDDEN CANONICAL ${opts.secretKey}`,
    confirmedFactText: opts.fact,
    suspectedFactText: opts.fact,
  });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("create failed");
  return created.secret;
}

function seedSenderKnowledge(opts: {
  chatId: number;
  personaId: number;
  secretId: string;
  observerType: "CHARACTER" | "NPC";
  observerId: string;
  state: "SUSPECTED" | "CONFIRMED";
  fact: string;
}) {
  upsertObserverSecretKnowledge({
    chatId: opts.chatId,
    personaId: opts.personaId,
    secretId: opts.secretId,
    observerType: opts.observerType,
    observerId: opts.observerId,
    knowledgeState: opts.state,
    confidence: opts.state === "CONFIRMED" ? 100 : 70,
    factSnapshot: opts.fact,
    confirmedTurn: opts.state === "CONFIRMED" ? 1 : null,
    firstSuspectedTurn: 1,
    lastEvidenceEventId: `seed-${opts.secretId}-${opts.observerId}`,
  });
}

/**
 * Common valid transfer fixture: chat/scene/observers created, sender
 * CONFIRMED knowledge, receiver PRESENT/AWARE/NORMAL, and a valid
 * DIRECT_STATEMENT userAction. Both positive and negative controls use this
 * so the negative control verifies Discovery OFF → no-op on transfer-capable input.
 * Requires Discovery=1 at call time (bootstrapChatObservers is Discovery-gated).
 */
function setupValidTransferFixture() {
  const n = Math.floor(Math.random() * 10000);
  const chatId = 770000 + n;
  const personaId = 772000 + n;
  const locoId = 17;
  const taehyunId = 29;
  bootstrapChatObservers({
    chatId,
    characterId: locoId,
    displayName: "로코",
    userId: 1,
  });
  upsertChatObserver({
    chatId,
    observerType: "CHARACTER",
    observerId: String(taehyunId),
    canonicalSourceType: "PARTY_CHARACTER",
    displayName: "태현",
    createdTurn: 1,
  });
  const scene = getActiveChatScene(chatId)!;
  upsertScenePresence({
    sceneId: scene.id,
    chatId,
    observerType: "CHARACTER",
    observerId: String(locoId),
    presenceState: "PRESENT",
    awarenessState: "AWARE",
    visualCapability: "NORMAL",
    auditoryCapability: "NORMAL",
    joinedTurn: 1,
    sourceType: "SERVER_SCENE_EVENT",
  });
  upsertScenePresence({
    sceneId: scene.id,
    chatId,
    observerType: "CHARACTER",
    observerId: String(taehyunId),
    presenceState: "PRESENT",
    awarenessState: "AWARE",
    visualCapability: "NORMAL",
    auditoryCapability: "NORMAL",
    joinedTurn: 1,
    sourceType: "SERVER_SCENE_EVENT",
  });
  const secret = seedSecret({
    personaId,
    secretKey: "s4d_valid_fixture",
    fact: "유효 전달 사실.",
  });
  seedSenderKnowledge({
    chatId,
    personaId,
    secretId: secret.id,
    observerType: "CHARACTER",
    observerId: String(locoId),
    state: "CONFIRMED",
    fact: "유효 전달 사실.",
  });
  const userAction: PersonaSecretTransferAction = {
    secretId: secret.id,
    sender: { observerType: "CHARACTER", observerId: String(locoId) },
    receiver: { observerType: "CHARACTER", observerId: String(taehyunId) },
    transferType: "DIRECT_STATEMENT",
    sourceMessageId: 1,
  };
  return { chatId, personaId, locoId, taehyunId, secret, scene, userAction };
}

/** Assert the fixture is fully transfer-capable (observers/scene/knowledge/action). */
function assertValidTransferFixture(
  fx: ReturnType<typeof setupValidTransferFixture>
): void {
  const senderObs = getChatObserver({
    chatId: fx.chatId,
    observerType: "CHARACTER",
    observerId: String(fx.locoId),
  });
  const receiverObs = getChatObserver({
    chatId: fx.chatId,
    observerType: "CHARACTER",
    observerId: String(fx.taehyunId),
  });
  assert.ok(senderObs, "sender observer exists");
  assert.ok(receiverObs, "receiver observer exists");
  assert.ok(fx.scene, "active scene exists");
  const senderKnow = getObserverSecretKnowledge({
    chatId: fx.chatId,
    personaId: fx.personaId,
    secretId: fx.secret.id,
    observerType: "CHARACTER",
    observerId: String(fx.locoId),
  });
  assert.equal(senderKnow?.knowledge_state, "CONFIRMED", "sender CONFIRMED knowledge");
  const receiverPresence = getScenePresence({
    sceneId: fx.scene.id,
    observerType: "CHARACTER",
    observerId: String(fx.taehyunId),
  });
  assert.equal(receiverPresence?.presence_state, "PRESENT", "receiver PRESENT");
  assert.equal(receiverPresence?.awareness_state, "AWARE", "receiver AWARE");
  assert.equal(
    receiverPresence?.auditory_capability,
    "NORMAL",
    "receiver auditory NORMAL"
  );
  assert.equal(fx.userAction.transferType, "DIRECT_STATEMENT");
  assert.equal(fx.userAction.secretId, fx.secret.id);
  assert.equal(fx.userAction.sourceMessageId, 1);
}

function setupObservers(opts: {
  chatId: number;
  locoId: number;
  taehyunId: number;
  taehyunPresence?: "PRESENT" | "ABSENT";
  taehyunAuditory?: "NORMAL" | "DEAF";
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
  upsertScenePresence({
    sceneId: scene.id,
    chatId: opts.chatId,
    observerType: "CHARACTER",
    observerId: String(opts.locoId),
    presenceState: "PRESENT",
    awarenessState: "AWARE",
    visualCapability: "NORMAL",
    auditoryCapability: "NORMAL",
    joinedTurn: 1,
    sourceType: "SERVER_SCENE_EVENT",
  });
  upsertScenePresence({
    sceneId: scene.id,
    chatId: opts.chatId,
    observerType: "CHARACTER",
    observerId: String(opts.taehyunId),
    presenceState: opts.taehyunPresence ?? "PRESENT",
    awarenessState: "AWARE",
    visualCapability: "NORMAL",
    auditoryCapability: opts.taehyunAuditory ?? "NORMAL",
    joinedTurn: 1,
    sourceType: "SERVER_SCENE_EVENT",
  });
}

describe("PR-S4D controlled knowledge transfer", () => {
  let envSnap: Record<string, string | undefined>;
  beforeEach(() => {
    envSnap = saveEnv();
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "1";
    ensureKnowledgeTransferSchema(getDb());
  });
  afterEach(() => restoreEnv(envSnap));

  it("0. fail-closed: Boundary=1 + Discovery unset → 0 transfers/evidence/knowledge writes", () => {
    // Build the same valid fixture while Discovery=1 (bootstrap is Discovery-gated).
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "1";
    const fx = setupValidTransferFixture();
    assertValidTransferFixture(fx);

    // Flip Discovery OFF immediately before the transfer call.
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    delete process.env.PERSONA_SECRET_DISCOVERY_ENABLED;

    const beforeTransfers = countTransfers(fx.chatId);
    const beforeEvidence = countEvidence(fx.chatId);
    const beforeKnowledge = countKnowledge(fx.chatId, fx.personaId, fx.secret.id);
    const result = runKnowledgeTransfersForTurn({
      chatId: fx.chatId,
      personaId: fx.personaId,
      characterId: fx.locoId,
      turnNumber: 1,
      userActions: [fx.userAction],
      authoritativeActions: [],
      userId: 1,
    });
    assert.equal(result.appliedCount, 0, "appliedCount 0 when Discovery off (valid fixture)");
    assert.equal(result.changedCount, 0, "changedCount 0 when Discovery off (valid fixture)");
    assert.equal(
      countTransfers(fx.chatId) - beforeTransfers,
      0,
      "transfer delta 0 when Discovery off (valid fixture)"
    );
    assert.equal(
      countEvidence(fx.chatId) - beforeEvidence,
      0,
      "evidence delta 0 when Discovery off (valid fixture)"
    );
    assert.equal(
      countKnowledge(fx.chatId, fx.personaId, fx.secret.id),
      beforeKnowledge,
      "no new knowledge rows when Discovery off (valid fixture)"
    );
    const receiver = getObserverSecretKnowledge({
      chatId: fx.chatId,
      personaId: fx.personaId,
      secretId: fx.secret.id,
      observerType: "CHARACTER",
      observerId: String(fx.taehyunId),
    });
    assert.equal(receiver, null, "receiver knowledge null when Discovery off");
  });

  it("0.5 positive control: Discovery=1 + valid DIRECT_STATEMENT userAction → transfer applied", () => {
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "1";
    // Same helper as the negative control — proves the fixture is transfer-capable.
    const fx = setupValidTransferFixture();
    assertValidTransferFixture(fx);

    const beforeTransfers = countTransfers(fx.chatId);
    const beforeEvidence = countEvidence(fx.chatId);
    const result = runKnowledgeTransfersForTurn({
      chatId: fx.chatId,
      personaId: fx.personaId,
      characterId: fx.locoId,
      turnNumber: 1,
      userActions: [fx.userAction],
      authoritativeActions: [],
      userId: 1,
    });
    assert.equal(result.appliedCount, 1, "appliedCount 1 when Discovery on + valid action");
    assert.equal(result.changedCount, 1, "changedCount 1 when Discovery on + valid action");
    assert.equal(
      countTransfers(fx.chatId) - beforeTransfers,
      1,
      "transfer delta 1"
    );
    assert.equal(
      countEvidence(fx.chatId) - beforeEvidence,
      1,
      "evidence delta 1"
    );
    const receiver = getObserverSecretKnowledge({
      chatId: fx.chatId,
      personaId: fx.personaId,
      secretId: fx.secret.id,
      observerType: "CHARACTER",
      observerId: String(fx.taehyunId),
    });
    assert.equal(receiver?.knowledge_state, "CONFIRMED", "receiver knowledge CONFIRMED");
  });



  it("1. CONFIRMED sender → receiver CONFIRMED", () => {
    const { chatId, personaId, locoId, taehyunId } = ids();
    setupObservers({ chatId, locoId, taehyunId });
    const fact = "렌의 등에 숫자 017 표식이 있다.";
    const secret = seedSecret({
      personaId,
      secretKey: "s4d_confirmed",
      fact,
    });
    seedSenderKnowledge({
      chatId,
      personaId,
      secretId: secret.id,
      observerType: "CHARACTER",
      observerId: String(locoId),
      state: "CONFIRMED",
      fact,
    });

    const result = applyKnowledgeTransferAction({
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
        sourceMessageId: 101,
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.changed, true);
    assert.equal(result.resultingState, "CONFIRMED");

    const receiver = getObserverSecretKnowledge({
      chatId,
      personaId,
      secretId: secret.id,
      observerType: "CHARACTER",
      observerId: String(taehyunId),
    });
    assert.equal(receiver?.knowledge_state, "CONFIRMED");
    assert.equal(receiver?.fact_snapshot, fact);
    assert.equal(countTransfers(chatId), 1);
    assert.equal(countEvidence(chatId), 1);
  });

  it("2. SUSPECTED sender → receiver max SUSPECTED", () => {
    const { chatId, personaId, locoId, taehyunId } = ids();
    setupObservers({ chatId, locoId, taehyunId });
    const fact = "렌 등에 이상한 숫자가 있는 것 같다.";
    const secret = seedSecret({
      personaId,
      secretKey: "s4d_suspected",
      fact,
    });
    seedSenderKnowledge({
      chatId,
      personaId,
      secretId: secret.id,
      observerType: "CHARACTER",
      observerId: String(locoId),
      state: "SUSPECTED",
      fact,
    });

    const result = applyKnowledgeTransferAction({
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
        sourceMessageId: 102,
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.resultingState, "SUSPECTED");
    const receiver = getObserverSecretKnowledge({
      chatId,
      personaId,
      secretId: secret.id,
      observerType: "CHARACTER",
      observerId: String(taehyunId),
    });
    assert.equal(receiver?.knowledge_state, "SUSPECTED");
  });

  it("3. UNKNOWN sender → transfer rejected, receiver unchanged", () => {
    const { chatId, personaId, locoId, taehyunId } = ids();
    setupObservers({ chatId, locoId, taehyunId });
    const secret = seedSecret({
      personaId,
      secretKey: "s4d_unknown",
      fact: "모르는 사실",
    });

    const result = applyKnowledgeTransferAction({
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
        sourceMessageId: 103,
      },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "SENDER_UNKNOWN");
    assert.equal(
      getObserverSecretKnowledge({
        chatId,
        personaId,
        secretId: secret.id,
        observerType: "CHARACTER",
        observerId: String(taehyunId),
      }),
      null
    );
    assert.equal(countTransfers(chatId), 0);
  });

  it("4. client-specified factSnapshot / resultingState rejected", () => {
    const parsed = parseKnowledgeTransferActions([
      {
        secretId: "sec-1",
        sender: { observerType: "CHARACTER", observerId: "17" },
        receiver: { observerType: "CHARACTER", observerId: "29" },
        transferType: "DIRECT_STATEMENT",
        factSnapshot: "밀수된 사실",
        resultingState: "CONFIRMED",
      },
    ]);
    assert.equal(parsed.length, 0);

    const auth = parseKnowledgeTransferAuthoritativeActions([
      {
        secretId: "sec-1",
        sourceType: "SERVER_STRUCTURED_TRANSFER",
        sender: { observerType: "CHARACTER", observerId: "17" },
        receiver: { observerType: "CHARACTER", observerId: "29" },
        transferType: "SERVER_DISCLOSURE",
        canonicalSecretText: "원문 누수",
      },
    ]);
    assert.equal(auth.length, 0);
  });

  it("5. receiver in other chat → rejected", () => {
    const { chatId, otherChatId, personaId, locoId, taehyunId } = ids();
    setupObservers({ chatId, locoId, taehyunId });
    bootstrapChatObservers({ chatId: otherChatId, characterId: taehyunId });
    const fact = "다른 채팅 수신자 거부";
    const secret = seedSecret({
      personaId,
      secretKey: "s4d_crosschat",
      fact,
    });
    seedSenderKnowledge({
      chatId,
      personaId,
      secretId: secret.id,
      observerType: "CHARACTER",
      observerId: String(locoId),
      state: "CONFIRMED",
      fact,
    });

    const result = applyKnowledgeTransferAction({
      chatId,
      personaId,
      characterId: locoId,
      turnNumber: 2,
      sourceType: "USER_EXPLICIT_TRANSFER",
      action: {
        secretId: secret.id,
        sender: { observerType: "CHARACTER", observerId: String(locoId) },
        // taehyun is present only as bootstrapped main in otherChat — not in chatId
        receiver: {
          observerType: "CHARACTER",
          observerId: String(taehyunId + 999),
        },
        transferType: "DIRECT_STATEMENT",
        sourceMessageId: 105,
      },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "INVALID_RECEIVER");
  });

  it("6. DIRECT_STATEMENT with ABSENT receiver → rejected", () => {
    const { chatId, personaId, locoId, taehyunId } = ids();
    setupObservers({
      chatId,
      locoId,
      taehyunId,
      taehyunPresence: "ABSENT",
    });
    const fact = "부재 수신자";
    const secret = seedSecret({
      personaId,
      secretKey: "s4d_absent",
      fact,
    });
    seedSenderKnowledge({
      chatId,
      personaId,
      secretId: secret.id,
      observerType: "CHARACTER",
      observerId: String(locoId),
      state: "CONFIRMED",
      fact,
    });

    const result = applyKnowledgeTransferAction({
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
        sourceMessageId: 106,
      },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "PRESENCE_BLOCKED");
    assert.equal(countTransfers(chatId), 0);
  });

  it("7. DIRECT_STATEMENT with DEAF receiver → rejected", () => {
    const { chatId, personaId, locoId, taehyunId } = ids();
    setupObservers({
      chatId,
      locoId,
      taehyunId,
      taehyunAuditory: "DEAF",
    });
    const fact = "청각 불가 수신자";
    const secret = seedSecret({
      personaId,
      secretKey: "s4d_deaf",
      fact,
    });
    seedSenderKnowledge({
      chatId,
      personaId,
      secretId: secret.id,
      observerType: "CHARACTER",
      observerId: String(locoId),
      state: "CONFIRMED",
      fact,
    });

    const result = applyKnowledgeTransferAction({
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
        sourceMessageId: 107,
      },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "CAPABILITY_BLOCKED");
  });

  it("8. assistant prose alone → transfer 0", () => {
    const { chatId, personaId, locoId, taehyunId } = ids();
    setupObservers({ chatId, locoId, taehyunId });
    const fact = "로코만 아는 사실";
    const secret = seedSecret({
      personaId,
      secretKey: "s4d_prose",
      fact,
    });
    seedSenderKnowledge({
      chatId,
      personaId,
      secretId: secret.id,
      observerType: "CHARACTER",
      observerId: String(locoId),
      state: "CONFIRMED",
      fact,
    });

    const assistantSaid =
      "로코는 태현에게 렌의 정체를 모두 말했다. 문신의 의미까지 알려줬다.";
    // No structured actions — prose must not create transfers.
    const fromProse = parseKnowledgeTransferActions(assistantSaid);
    assert.equal(fromProse.length, 0);
    const turn = runKnowledgeTransfersForTurn({
      chatId,
      personaId,
      characterId: locoId,
      turnNumber: 3,
      userActions: [],
      authoritativeActions: [],
    });
    assert.equal(turn.appliedCount, 0);
    assert.equal(countTransfers(chatId), 0);
    assert.equal(
      getObserverSecretKnowledge({
        chatId,
        personaId,
        secretId: secret.id,
        observerType: "CHARACTER",
        observerId: String(taehyunId),
      }),
      null
    );
  });

  it("9. retry → transfer/evidence/knowledge duplicate 0", () => {
    const { chatId, personaId, locoId, taehyunId } = ids();
    setupObservers({ chatId, locoId, taehyunId });
    const fact = "멱등 전달 사실";
    const secret = seedSecret({
      personaId,
      secretKey: "s4d_idem",
      fact,
    });
    seedSenderKnowledge({
      chatId,
      personaId,
      secretId: secret.id,
      observerType: "CHARACTER",
      observerId: String(locoId),
      state: "CONFIRMED",
      fact,
    });
    const action = {
      secretId: secret.id,
      sender: {
        observerType: "CHARACTER" as const,
        observerId: String(locoId),
      },
      receiver: {
        observerType: "CHARACTER" as const,
        observerId: String(taehyunId),
      },
      transferType: "DIRECT_STATEMENT" as const,
      sourceMessageId: 109,
    };

    const first = applyKnowledgeTransferAction({
      chatId,
      personaId,
      characterId: locoId,
      turnNumber: 2,
      sourceType: "USER_EXPLICIT_TRANSFER",
      action,
    });
    const second = applyKnowledgeTransferAction({
      chatId,
      personaId,
      characterId: locoId,
      turnNumber: 2,
      sourceType: "USER_EXPLICIT_TRANSFER",
      action,
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.reason, "DUPLICATE");
    assert.equal(second.changed, false);
    assert.equal(countTransfers(chatId), 1);
    assert.equal(countEvidence(chatId), 1);
  });

  it("10. ensemble: transfer updates DB but prompt facts stay redacted", () => {
    const { chatId, personaId, locoId, taehyunId } = ids();
    setupObservers({ chatId, locoId, taehyunId });
    const fact = "앙상블에서 DB만 갱신되는 사실";
    const secret = seedSecret({
      personaId,
      secretKey: "s4d_ensemble",
      fact,
    });
    seedSenderKnowledge({
      chatId,
      personaId,
      secretId: secret.id,
      observerType: "CHARACTER",
      observerId: String(locoId),
      state: "CONFIRMED",
      fact,
    });

    const applied = applyKnowledgeTransferAction({
      chatId,
      personaId,
      characterId: locoId,
      turnNumber: 2,
      sourceType: "SERVER_STRUCTURED_TRANSFER",
      action: {
        secretId: secret.id,
        sender: { observerType: "CHARACTER", observerId: String(locoId) },
        receiver: { observerType: "CHARACTER", observerId: String(taehyunId) },
        transferType: "SERVER_DISCLOSURE",
        actionId: "server-briefing-1",
      },
    });
    assert.equal(applied.ok, true);

    const receiver = getObserverSecretKnowledge({
      chatId,
      personaId,
      secretId: secret.id,
      observerType: "CHARACTER",
      observerId: String(taehyunId),
    });
    assert.equal(receiver?.knowledge_state, "CONFIRMED");
    assert.ok(receiver?.fact_snapshot.includes("앙상블"));

    const decision = resolvePersonaKnowledgePromptDecisionForChat(
      buildGenerationKnowledgeContext({
        contentKind: "simulation",
        simulationCast: "로코, 태현",
        characterId: locoId,
      }),
      { chatId }
    );
    assert.equal(decision.mode, "ENSEMBLE_REDACTED");
    const block = buildPersonaKnowledgePromptBlock({
      decision,
      chatId,
      personaId,
    });
    assert.equal(block, null);
  });
});
