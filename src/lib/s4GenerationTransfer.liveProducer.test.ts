/**
 * S4 same-generation DIRECT_STATEMENT live producer — mock test matrix.
 * REAL_PROVIDER_CALLS = 0
 */
import Module from "module";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { estimateTokens } from "@/lib/tokenEstimate";
import { bootstrapChatObservers } from "@/lib/observerBootstrap";
import { upsertChatObserver } from "@/lib/observerIdentity";
import { getActiveChatScene } from "@/lib/chatScenes";
import {
  getObserverSecretKnowledge,
  upsertObserverSecretKnowledge,
} from "@/lib/personaSecretKnowledge";
import { createPersonaSecret } from "@/lib/personaSecrets";
import {
  upsertScenePresence,
} from "@/lib/scenePresence";
import {
  buildGenerationKnowledgeContext,
  resolvePersonaKnowledgePromptDecisionForChat,
} from "@/lib/personaKnowledgePromptPolicy";
import {
  buildPersonaKnowledgeWithS4ForTurn,
  buildS4GenerationTransferContext,
  isS4LiveProducerTurnAllowed,
} from "@/lib/s4GenerationTransfer/context";
import {
  buildKnownPersonaFactsProjectionForObserver,
  buildPersonaKnowledgePromptBlock,
} from "@/lib/personaSecretKnowledge";
import {
  captureS4TransferEnvelopeFromModelText,
  splitProseAndS4TransferEnvelope,
} from "@/lib/s4GenerationTransfer/controlChannel";
import { commitAcceptedAssistantS4Transfers } from "@/lib/s4GenerationTransfer/commit";
import { S4_TRANSFER_BLOCK, S4_TRANSFER_END } from "@/lib/s4GenerationTransfer/types";
import { stripS4ServerControlFromText } from "@/lib/controlChannel/serverControlStrip";
import {
  partitionModelStatusArtifacts,
  stripAllStatusWindowOutputArtifacts,
} from "@/lib/statusMeta/stripArtifacts";
import {
  captureStatusWidgetValuesFromModelText,
  STATUS_VALUES_BLOCK,
  STATUS_VALUES_END,
} from "@/lib/statusWidget/parseValues";
import { currentActiveKnowledgeTransferGenerationSequence } from "@/lib/knowledgeTransferVariant";
import { appendMessageVariant } from "@/lib/messageAlternates";
import {
  applyVariantScopedAuthoritativeKnowledgeTransfer,
  reconcileS4KnowledgeForVariantSwitch,
} from "@/lib/knowledgeTransferVariant";
import { ensureKnowledgeTransferSchema } from "@/lib/knowledgeTransferSchema";
import { isPersonaSecretS4LiveProducerEnabled } from "@/lib/personaSecretS4LiveProducerPolicy";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

const ENV_KEYS = [
  "PERSONA_SECRET_BOUNDARY_ENABLED",
  "PERSONA_SECRET_DISCOVERY_ENABLED",
  "PERSONA_SECRET_S4_LIVE_PRODUCER_ENABLED",
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

function seedSecret(personaId: number, key: string, fact: string) {
  const created = createPersonaSecret({
    personaId,
    secretKey: `${key}_${randomUUID().slice(0, 8)}`,
    canonicalSecretText: `HIDDEN ${key}`,
    confirmedFactText: fact,
    suspectedFactText: fact,
  });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("secret create failed");
  return created.secret;
}

type Fixture = {
  chatId: number;
  personaId: number;
  senderId: number;
  receiverId: number;
  secretId: string;
  fact: string;
};

function setupFixture(): Fixture {
  const n = Math.floor(Math.random() * 10000);
  const chatId = 890000 + n;
  const personaId = 891000 + n;
  const senderId = 17;
  const receiverId = 29;
  const fact = "비밀 사실을 직접 말함.";
  bootstrapChatObservers({
    chatId,
    characterId: senderId,
    displayName: "로코",
    userId: 1,
  });
  upsertChatObserver({
    chatId,
    observerType: "CHARACTER",
    observerId: String(receiverId),
    canonicalSourceType: "PARTY_CHARACTER",
    displayName: "태현",
    createdTurn: 1,
  });
  const scene = getActiveChatScene(chatId)!;
  for (const observerId of [String(senderId), String(receiverId)]) {
    upsertScenePresence({
      sceneId: scene.id,
      chatId,
      observerType: "CHARACTER",
      observerId,
      presenceState: "PRESENT",
      awarenessState: "AWARE",
      visualCapability: "NORMAL",
      auditoryCapability: "NORMAL",
      joinedTurn: 1,
      sourceType: "SERVER_SCENE_EVENT",
    });
  }
  const secret = seedSecret(personaId, `s4live_${n}`, fact);
  upsertObserverSecretKnowledge({
    chatId,
    personaId,
    secretId: secret.id,
    observerType: "CHARACTER",
    observerId: String(senderId),
    knowledgeState: "CONFIRMED",
    confidence: 100,
    factSnapshot: fact,
    confirmedTurn: 1,
    firstSuspectedTurn: 1,
    lastEvidenceEventId: `seed-${secret.id}`,
  });
  return { chatId, personaId, senderId, receiverId, secretId: secret.id, fact };
}

function prepareDb() {
  ensureKnowledgeTransferSchema(getDb());
}

function insertAssistantWithVariant(
  db: ReturnType<typeof getDb>,
  chatId: number,
  content: string,
  generationSequence = 0
): number {
  const asstMsg = db
    .prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status, alternates, active_variant)
       VALUES (?,?,?,?,?,?,?)`
    )
    .run(
      chatId,
      "assistant",
      content,
      "test",
      "completed",
      JSON.stringify([
        {
          content,
          model: "test",
          usage: null,
          created_at: "",
          generationSequence,
        },
      ]),
      0
    );
  return Number(asstMsg.lastInsertRowid);
}

function setAssistantVariants(
  assistantMessageId: number,
  variants: Array<{ content: string; model: string; generationSequence: number }>,
  activeVariant: number
) {
  const db = getDb();
  const active = variants[activeVariant]!;
  db.prepare(
    `UPDATE messages SET content=?, alternates=?, active_variant=? WHERE id=?`
  ).run(
    active.content,
    JSON.stringify(
      variants.map((v) => ({
        content: v.content,
        model: v.model,
        usage: null,
        created_at: "",
        generationSequence: v.generationSequence,
      }))
    ),
    activeVariant,
    assistantMessageId
  );
}

function buildCtx(f: Fixture) {
  const decision = resolvePersonaKnowledgePromptDecisionForChat(
    buildGenerationKnowledgeContext({
      contentKind: "character",
      simulationCast: null,
      characterId: f.senderId,
    }),
    { chatId: f.chatId }
  );
  const ctx = buildS4GenerationTransferContext({
    decision,
    chatId: f.chatId,
    personaId: f.personaId,
  });
  assert.ok(ctx);
  return ctx!;
}

function envelopeJson(ctx: ReturnType<typeof buildCtx>, events: object[]) {
  return `${S4_TRANSFER_BLOCK}\n${JSON.stringify({ nonce: ctx.nonce, events })}\n${S4_TRANSFER_END}`;
}

describe("S4 live producer", () => {
  let env: Record<string, string | undefined>;
  beforeEach(() => {
    env = saveEnv();
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "1";
    process.env.PERSONA_SECRET_S4_LIVE_PRODUCER_ENABLED = "1";
    prepareDb();
  });
  afterEach(() => restoreEnv(env));

  it("A — valid direct disclosure → receiver learns", () => {
    const f = setupFixture();
    const db = getDb();
    const ctx = buildCtx(f);
    const visible = `로코가 태현에게 속삭였다. "${f.fact}"`;
    const raw = `${visible}\n${envelopeJson(ctx, [
      {
        factRef: "K1",
        receiverRef: "R1",
        transferType: "DIRECT_STATEMENT",
        completed: true,
        proofText: f.fact,
      },
    ])}`;
    const assistantMessageId = insertAssistantWithVariant(db, f.chatId, visible, 0);
    const result = commitAcceptedAssistantS4Transfers({
      rawModelText: raw,
      finalVisibleText: visible,
      ctx,
      chatId: f.chatId,
      personaId: f.personaId,
      characterId: f.senderId,
      turnNumber: 2,
      assistantMessageId,
      db,
    });
    assert.equal(result.applied, 1);
    const learned = getObserverSecretKnowledge({
      chatId: f.chatId,
      personaId: f.personaId,
      secretId: f.secretId,
      observerType: "CHARACTER",
      observerId: String(f.receiverId),
      db,
    });
    assert.ok(learned);
    assert.equal(learned!.knowledge_state, "CONFIRMED");
  });

  it("B — user intent only, no event → receiver UNKNOWN", () => {
    const f = setupFixture();
    const db = getDb();
    const ctx = buildCtx(f);
    const visible = "태현에게 말해줘.";
    const raw = visible;
    commitAcceptedAssistantS4Transfers({
      rawModelText: raw,
      finalVisibleText: visible,
      ctx,
      chatId: f.chatId,
      personaId: f.personaId,
      characterId: f.senderId,
      turnNumber: 2,
      assistantMessageId: 1,
      db,
    });
    const learned = getObserverSecretKnowledge({
      chatId: f.chatId,
      personaId: f.personaId,
      secretId: f.secretId,
      observerType: "CHARACTER",
      observerId: String(f.receiverId),
      db,
    });
    assert.equal(learned, null);
  });

  it("D/E — invented K999/R999 → reject", () => {
    const f = setupFixture();
    const db = getDb();
    const ctx = buildCtx(f);
    const visible = f.fact;
    for (const events of [
      [{ factRef: "K999", receiverRef: "R1", transferType: "DIRECT_STATEMENT", completed: true, proofText: f.fact }],
      [{ factRef: "K1", receiverRef: "R999", transferType: "DIRECT_STATEMENT", completed: true, proofText: f.fact }],
    ]) {
      const raw = `${visible}\n${envelopeJson(ctx, events)}`;
      const r = commitAcceptedAssistantS4Transfers({
        rawModelText: raw,
        finalVisibleText: visible,
        ctx,
        chatId: f.chatId,
        personaId: f.personaId,
        characterId: f.senderId,
        turnNumber: 2,
        assistantMessageId: 1,
        db,
      });
      assert.equal(r.applied, 0);
    }
  });

  it("F — wrong nonce → reject", () => {
    const f = setupFixture();
    const db = getDb();
    const ctx = buildCtx(f);
    const visible = f.fact;
    const raw = `${visible}\n${S4_TRANSFER_BLOCK}\n${JSON.stringify({
      nonce: "wrong-nonce",
      events: [{ factRef: "K1", receiverRef: "R1", transferType: "DIRECT_STATEMENT", completed: true, proofText: f.fact }],
    })}\n${S4_TRANSFER_END}`;
    const r = commitAcceptedAssistantS4Transfers({
      rawModelText: raw,
      finalVisibleText: visible,
      ctx,
      chatId: f.chatId,
      personaId: f.personaId,
      characterId: f.senderId,
      turnNumber: 2,
      assistantMessageId: 1,
      db,
    });
    assert.equal(r.applied, 0);
  });

  it("G — proofText not in visible → reject", () => {
    const f = setupFixture();
    const db = getDb();
    const ctx = buildCtx(f);
    const visible = "다른 내용만 말함.";
    const raw = `${visible}\n${envelopeJson(ctx, [
      { factRef: "K1", receiverRef: "R1", transferType: "DIRECT_STATEMENT", completed: true, proofText: f.fact },
    ])}`;
    const r = commitAcceptedAssistantS4Transfers({
      rawModelText: raw,
      finalVisibleText: visible,
      ctx,
      chatId: f.chatId,
      personaId: f.personaId,
      characterId: f.senderId,
      turnNumber: 2,
      assistantMessageId: 1,
      db,
    });
    assert.equal(r.applied, 0);
  });

  it("H — prose disclosure without structured event → write 0", () => {
    const f = setupFixture();
    const db = getDb();
    const ctx = buildCtx(f);
    const visible = f.fact;
    commitAcceptedAssistantS4Transfers({
      rawModelText: visible,
      finalVisibleText: visible,
      ctx,
      chatId: f.chatId,
      personaId: f.personaId,
      characterId: f.senderId,
      turnNumber: 2,
      assistantMessageId: 1,
      db,
    });
    assert.equal(
      getObserverSecretKnowledge({
        chatId: f.chatId,
        personaId: f.personaId,
        secretId: f.secretId,
        observerType: "CHARACTER",
        observerId: String(f.receiverId),
        db,
      }),
      null
    );
  });

  it("Q — no S4 candidates → prompt delta 0", () => {
    const f = setupFixture();
    const decision = resolvePersonaKnowledgePromptDecisionForChat(
      buildGenerationKnowledgeContext({
        contentKind: "character",
        simulationCast: null,
        characterId: f.senderId,
      }),
      { chatId: f.chatId }
    );
    const db = getDb();
    db.prepare(
      `DELETE FROM chat_character_secret_knowledge
       WHERE chat_id=? AND persona_id=? AND observer_type='CHARACTER' AND observer_id=?`
    ).run(f.chatId, f.personaId, String(f.senderId));
    const without = buildPersonaKnowledgeWithS4ForTurn({
      decision,
      chatId: f.chatId,
      personaId: f.personaId,
      authority: "discovery",
      db,
    });
    assert.equal(without.s4Context, null);
    assert.equal(without.block, null);
  });

  it("Y/Z/AA — stream strip: raw+=chunk visible=strip leak 0", () => {
    const korean = "한국어 RP 본문입니다.";
    let rawBuffer = korean;
    const chunks = ["\n<<<S4_KNOWLEDGE_TRANS", "FER>>>", "\npartial"];
    for (const chunk of chunks) {
      rawBuffer += chunk;
      const visible = stripS4ServerControlFromText(rawBuffer);
      assert.ok(!visible.includes("<<<"));
      assert.ok(!visible.includes(S4_TRANSFER_BLOCK));
    }
    assert.equal(stripS4ServerControlFromText(rawBuffer), korean);

    const full = `${korean}\n${S4_TRANSFER_BLOCK}\n{"nonce":"x"}\n${S4_TRANSFER_END}`;
    assert.equal(stripAllStatusWindowOutputArtifacts(full), korean);
  });

  it("X — malformed metadata preserves visible prose", () => {
    const visible = "본문만.";
    const raw = `${visible}\n${S4_TRANSFER_BLOCK}\n{not-json\n${S4_TRANSFER_END}`;
    const split = splitProseAndS4TransferEnvelope(raw);
    assert.equal(split.prose.trim(), visible);
    assert.equal(split.envelope, null);
  });

  it("S/T — regen variant projection", () => {
    const f = setupFixture();
    const db = getDb();
    const ctx = buildCtx(f);
    const visible0 = f.fact;
    const assistantMessageId = insertAssistantWithVariant(db, f.chatId, visible0, 0);
    commitAcceptedAssistantS4Transfers({
      rawModelText: `${visible0}\n${envelopeJson(ctx, [
        { factRef: "K1", receiverRef: "R1", transferType: "DIRECT_STATEMENT", completed: true, proofText: f.fact },
      ])}`,
      finalVisibleText: visible0,
      ctx,
      chatId: f.chatId,
      personaId: f.personaId,
      characterId: f.senderId,
      turnNumber: 2,
      assistantMessageId,
      db,
    });
    assert.ok(
      getObserverSecretKnowledge({
        chatId: f.chatId,
        personaId: f.personaId,
        secretId: f.secretId,
        observerType: "CHARACTER",
        observerId: String(f.receiverId),
        db,
      })
    );

    const { variants } = appendMessageVariant(
      [
        {
          content: visible0,
          model: "test",
          generationSequence: 0,
        },
      ],
      {
        content: "gen1 no transfer",
        model: "test",
        generationSequence: 1,
      }
    );
    setAssistantVariants(
      assistantMessageId,
      [
        { content: visible0, model: "test", generationSequence: 0 },
        { content: "gen1 no transfer", model: "test", generationSequence: 1 },
      ],
      1
    );
    reconcileS4KnowledgeForVariantSwitch(db, { chatId: f.chatId, assistantMessageId });
    assert.equal(
      getObserverSecretKnowledge({
        chatId: f.chatId,
        personaId: f.personaId,
        secretId: f.secretId,
        observerType: "CHARACTER",
        observerId: String(f.receiverId),
        db,
      }),
      null
    );

    setAssistantVariants(
      assistantMessageId,
      [
        { content: visible0, model: "test", generationSequence: 0 },
        { content: "gen1 no transfer", model: "test", generationSequence: 1 },
        { content: "gen2 transfer", model: "test", generationSequence: 2 },
      ],
      2
    );
    applyVariantScopedAuthoritativeKnowledgeTransfer({
      chatId: f.chatId,
      personaId: f.personaId,
      characterId: f.senderId,
      turnNumber: 3,
      sourceAssistantMessageId: assistantMessageId,
      sourceGenerationSequence: 2,
      action: {
        secretId: f.secretId,
        sender: { observerType: "CHARACTER", observerId: String(f.senderId) },
        receiver: { observerType: "CHARACTER", observerId: String(f.receiverId) },
        transferType: "DIRECT_STATEMENT",
      },
      db,
    });
    reconcileS4KnowledgeForVariantSwitch(db, { chatId: f.chatId, assistantMessageId });
    assert.ok(
      getObserverSecretKnowledge({
        chatId: f.chatId,
        personaId: f.personaId,
        secretId: f.secretId,
        observerType: "CHARACTER",
        observerId: String(f.receiverId),
        db,
      })
    );
  });

  it("prompt token delta — no candidate 0; 1 fact 1 receiver > 0", () => {
    const f = setupFixture();
    const decision = resolvePersonaKnowledgePromptDecisionForChat(
      buildGenerationKnowledgeContext({
        contentKind: "character",
        simulationCast: null,
        characterId: f.senderId,
      }),
      { chatId: f.chatId }
    );
    const baseOnly = buildPersonaKnowledgeWithS4ForTurn({
      decision,
      chatId: f.chatId,
      personaId: f.personaId,
      authority: "discovery",
    });
    const scene = getActiveChatScene(f.chatId)!;
    upsertScenePresence({
      sceneId: scene.id,
      chatId: f.chatId,
      observerType: "CHARACTER",
      observerId: String(f.receiverId),
      presenceState: "ABSENT",
      awarenessState: "AWARE",
      visualCapability: "NORMAL",
      auditoryCapability: "NORMAL",
      joinedTurn: 1,
      sourceType: "SERVER_SCENE_EVENT",
    });
    const noReceiver = buildPersonaKnowledgeWithS4ForTurn({
      decision,
      chatId: f.chatId,
      personaId: f.personaId,
      authority: "discovery",
    });
    const deltaTokens =
      estimateTokens(baseOnly.block ?? "") - estimateTokens(noReceiver.block ?? "");
    assert.ok(baseOnly.block?.includes("[K1]"));
    assert.ok(baseOnly.block?.includes("S4 DIRECT STATEMENT"));
    assert.equal(noReceiver.s4Context, null);
    assert.ok(deltaTokens > 0);
    const contractOnly = (baseOnly.block ?? "").slice((baseOnly.block ?? "").indexOf("[S4 DIRECT STATEMENT]"));
    assert.ok(contractOnly.length <= 550, `contract chars=${contractOnly.length}`);
  });

  it("K authority == projected prompt facts (exact set equality)", () => {
    const f = setupFixture();
    const db = getDb();
    for (let i = 0; i < 10; i++) {
      const s = seedSecret(f.personaId, `bulk_${i}`, `fact-${i}-${"x".repeat(i === 9 ? 400 : 20)}`);
      upsertObserverSecretKnowledge({
        chatId: f.chatId,
        personaId: f.personaId,
        secretId: s.id,
        observerType: "CHARACTER",
        observerId: String(f.senderId),
        knowledgeState: i % 3 === 0 ? "SUSPECTED" : "CONFIRMED",
        confidence: 80,
        factSnapshot: `fact-${i}-${"x".repeat(i === 9 ? 400 : 20)}`,
        confirmedTurn: 1,
        firstSuspectedTurn: 1,
        lastEvidenceEventId: `bulk-${s.id}`,
        db,
      });
    }
    const decision = resolvePersonaKnowledgePromptDecisionForChat(
      buildGenerationKnowledgeContext({
        contentKind: "character",
        simulationCast: null,
        characterId: f.senderId,
      }),
      { chatId: f.chatId }
    );
    const built = buildPersonaKnowledgeWithS4ForTurn({
      decision,
      chatId: f.chatId,
      personaId: f.personaId,
      authority: "discovery",
      db,
    });
    assert.ok(built.s4Context);
    const ctxIds = new Set([...built.s4Context!.facts.values()].map((x) => x.secretId));
    const projection = buildKnownPersonaFactsProjectionForObserver({
      chatId: f.chatId,
      personaId: f.personaId,
      observerType: "CHARACTER",
      observerId: String(f.senderId),
      authority: "discovery",
      factRefBySecretId: new Map(
        [...built.s4Context!.facts.values()].map((e) => [e.secretId, e.factRef])
      ),
      db,
    });
    const projectedIds = new Set(projection.projectedFacts.map((p) => p.secretId));
    assert.deepEqual(ctxIds, projectedIds);
    for (const ref of built.s4Context!.facts.keys()) {
      assert.match(built.block ?? "", new RegExp(`\\[${ref}\\]`));
    }
  });

  it("known facts + no eligible receiver → byte-equal prompt block", () => {
    const f = setupFixture();
    const decision = resolvePersonaKnowledgePromptDecisionForChat(
      buildGenerationKnowledgeContext({
        contentKind: "character",
        simulationCast: null,
        characterId: f.senderId,
      }),
      { chatId: f.chatId }
    );
    const scene = getActiveChatScene(f.chatId)!;
    upsertScenePresence({
      sceneId: scene.id,
      chatId: f.chatId,
      observerType: "CHARACTER",
      observerId: String(f.receiverId),
      presenceState: "ABSENT",
      awarenessState: "AWARE",
      visualCapability: "NORMAL",
      auditoryCapability: "NORMAL",
      joinedTurn: 1,
      sourceType: "SERVER_SCENE_EVENT",
    });
    const plain = buildPersonaKnowledgePromptBlock({
      decision,
      chatId: f.chatId,
      personaId: f.personaId,
      authority: "discovery",
    });
    const withAttempt = buildPersonaKnowledgeWithS4ForTurn({
      decision,
      chatId: f.chatId,
      personaId: f.personaId,
      authority: "discovery",
    });
    assert.equal(withAttempt.s4Context, null);
    assert.equal(withAttempt.block, plain);
  });

  it("D — rollout OFF keeps ordinary knowledge prompt byte-equivalent and S4 context null", () => {
    const f = setupFixture();
    const db = getDb();
    const writesBefore = (
      db
        .prepare(`SELECT COUNT(*) AS count FROM knowledge_transfer_events WHERE chat_id=?`)
        .get(f.chatId) as { count: number }
    ).count;
    const decision = resolvePersonaKnowledgePromptDecisionForChat(
      buildGenerationKnowledgeContext({
        contentKind: "character",
        simulationCast: null,
        characterId: f.senderId,
      }),
      { chatId: f.chatId }
    );
    process.env.PERSONA_SECRET_S4_LIVE_PRODUCER_ENABLED = "0";
    const plain = buildPersonaKnowledgePromptBlock({
      decision,
      chatId: f.chatId,
      personaId: f.personaId,
      authority: "discovery",
    });
    const gated = buildPersonaKnowledgeWithS4ForTurn({
      decision,
      chatId: f.chatId,
      personaId: f.personaId,
      authority: "discovery",
      allowS4:
        isPersonaSecretS4LiveProducerEnabled() &&
        isS4LiveProducerTurnAllowed({}),
    });
    assert.equal(gated.block, plain);
    assert.equal(gated.s4Context, null);
    assert.doesNotMatch(gated.block ?? "", /\[K\d+\]|\[R\d+\]|S4 DIRECT STATEMENT/);
    assert.doesNotMatch(gated.block ?? "", /nonce|S4_KNOWLEDGE_TRANSFER/);
    const writesAfter = (
      db
        .prepare(`SELECT COUNT(*) AS count FROM knowledge_transfer_events WHERE chat_id=?`)
        .get(f.chatId) as { count: number }
    ).count;
    assert.equal(writesAfter, writesBefore);
  });

  it("E — rollout ON preserves current K/R contract behavior", () => {
    const f = setupFixture();
    const decision = resolvePersonaKnowledgePromptDecisionForChat(
      buildGenerationKnowledgeContext({
        contentKind: "character",
        simulationCast: null,
        characterId: f.senderId,
      }),
      { chatId: f.chatId }
    );
    process.env.PERSONA_SECRET_S4_LIVE_PRODUCER_ENABLED = "1";
    const enabled = buildPersonaKnowledgeWithS4ForTurn({
      decision,
      chatId: f.chatId,
      personaId: f.personaId,
      authority: "discovery",
      allowS4:
        isPersonaSecretS4LiveProducerEnabled() &&
        isS4LiveProducerTurnAllowed({}),
    });
    assert.ok(enabled.s4Context);
    assert.match(enabled.block ?? "", /\[K1\]/);
    assert.match(enabled.block ?? "", /\[R1\]/);
    assert.match(enabled.block ?? "", /S4 DIRECT STATEMENT/);
  });

  it("F — rollout flag has zero effect on ordinary S1/S2/S3 knowledge projection", () => {
    const f = setupFixture();
    const decision = resolvePersonaKnowledgePromptDecisionForChat(
      buildGenerationKnowledgeContext({
        contentKind: "character",
        simulationCast: null,
        characterId: f.senderId,
      }),
      { chatId: f.chatId }
    );
    process.env.PERSONA_SECRET_S4_LIVE_PRODUCER_ENABLED = "0";
    const projectionOff = buildPersonaKnowledgePromptBlock({
      decision,
      chatId: f.chatId,
      personaId: f.personaId,
      authority: "discovery",
    });
    process.env.PERSONA_SECRET_S4_LIVE_PRODUCER_ENABLED = "1";
    const projectionOn = buildPersonaKnowledgePromptBlock({
      decision,
      chatId: f.chatId,
      personaId: f.personaId,
      authority: "discovery",
    });
    assert.equal(projectionOff, projectionOn);
    assert.match(projectionOff ?? "", /비밀 사실을 직접 말함/);
  });

  it("OOC turns disable S4 context and commit", () => {
    assert.equal(isS4LiveProducerTurnAllowed({ oocHtmlMode: true }), false);
    assert.equal(isS4LiveProducerTurnAllowed({ oocSceneRenderTurn: true }), false);
    assert.equal(isS4LiveProducerTurnAllowed({ htmlFlashOnlyTurn: true }), false);
    const f = setupFixture();
    const decision = resolvePersonaKnowledgePromptDecisionForChat(
      buildGenerationKnowledgeContext({
        contentKind: "character",
        simulationCast: null,
        characterId: f.senderId,
      }),
      { chatId: f.chatId }
    );
    const gated = buildPersonaKnowledgeWithS4ForTurn({
      decision,
      chatId: f.chatId,
      personaId: f.personaId,
      authority: "discovery",
      allowS4: false,
    });
    assert.equal(gated.s4Context, null);
    assert.ok(!gated.block?.includes("S4 DIRECT STATEMENT"));
  });

  it("V1 — missing generationSequence on active variant → write 0", () => {
    const f = setupFixture();
    const db = getDb();
    const ctx = buildCtx(f);
    const visible = f.fact;
    const asst = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, generation_status, alternates, active_variant)
         VALUES (?,?,?,?,?,?,?)`
      )
      .run(f.chatId, "assistant", visible, "test", "completed", "[]", 0);
    const assistantMessageId = Number(asst.lastInsertRowid);
    const r = commitAcceptedAssistantS4Transfers({
      rawModelText: `${visible}\n${envelopeJson(ctx, [
        { factRef: "K1", receiverRef: "R1", transferType: "DIRECT_STATEMENT", completed: true, proofText: f.fact },
      ])}`,
      finalVisibleText: visible,
      ctx,
      chatId: f.chatId,
      personaId: f.personaId,
      characterId: f.senderId,
      turnNumber: 2,
      assistantMessageId,
      db,
    });
    assert.equal(r.applied, 0);
  });

  it("OOC HTML save path strips S4 markers", () => {
    const prose = "<div>html</div>";
    const raw = `${prose}\n${S4_TRANSFER_BLOCK}\n{"nonce":"n"}\n${S4_TRANSFER_END}`;
    assert.equal(stripS4ServerControlFromText(raw), prose);
  });

  it("OOC HTML incomplete S4 block — stream leak 0, commit 0", () => {
    const prose = "<p>html</p>";
    let rawBuffer = prose;
    for (const chunk of ["\n<<<S4_KNOWLEDGE", "_TRANSFER>>>"]) {
      rawBuffer += chunk;
      assert.ok(!stripS4ServerControlFromText(rawBuffer).includes("<<<"));
    }
    const f = setupFixture();
    const ctx = buildCtx(f);
    const r = commitAcceptedAssistantS4Transfers({
      rawModelText: rawBuffer,
      finalVisibleText: prose,
      ctx,
      chatId: f.chatId,
      personaId: f.personaId,
      characterId: f.senderId,
      turnNumber: 2,
      assistantMessageId: 1,
      db: getDb(),
    });
    assert.equal(r.applied, 0);
  });

  it("lowercase/mixed-case complete S4 is hidden but gains no commit authority", () => {
    const f = setupFixture();
    const db = getDb();
    const ctx = buildCtx(f);
    const visible = f.fact;
    const assistantMessageId = insertAssistantWithVariant(db, f.chatId, visible, 0);
    const payload = JSON.stringify({
      nonce: ctx.nonce,
      events: [
        {
          factRef: "K1",
          receiverRef: "R1",
          transferType: "DIRECT_STATEMENT",
          completed: true,
          proofText: f.fact,
        },
      ],
    });
    const malformedMarkers = [
      [S4_TRANSFER_BLOCK.toLowerCase(), S4_TRANSFER_END.toLowerCase()],
      ["<<<s4_Knowledge_Transfer>>>", "<<<End_S4>>>"],
    ] as const;

    for (const [start, end] of malformedMarkers) {
      const raw = `${visible}\n${start}\n${payload}\n${end}`;
      assert.equal(stripS4ServerControlFromText(raw), visible);
      const result = commitAcceptedAssistantS4Transfers({
        rawModelText: raw,
        finalVisibleText: visible,
        ctx,
        chatId: f.chatId,
        personaId: f.personaId,
        characterId: f.senderId,
        turnNumber: 2,
        assistantMessageId,
        db,
      });
      assert.equal(result.applied, 0);
      assert.equal(result.attempted, 0);
    }
  });

  it("V2 — active variant index 1 without generationSequence → write 0 (no index inference)", () => {
    const f = setupFixture();
    const db = getDb();
    const ctx = buildCtx(f);
    const visible = f.fact;
    const asst = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, generation_status, alternates, active_variant)
         VALUES (?,?,?,?,?,?,?)`
      )
      .run(
        f.chatId,
        "assistant",
        visible,
        "test",
        "completed",
        JSON.stringify([
          {
            content: visible,
            model: "test",
            usage: null,
            created_at: "",
            generationSequence: 0,
          },
          { content: "regen", model: "test", usage: null, created_at: "" },
        ]),
        1
      );
    const assistantMessageId = Number(asst.lastInsertRowid);
    assert.equal(
      currentActiveKnowledgeTransferGenerationSequence(db, f.chatId, assistantMessageId),
      null
    );
    const r = commitAcceptedAssistantS4Transfers({
      rawModelText: `${visible}\n${envelopeJson(ctx, [
        { factRef: "K1", receiverRef: "R1", transferType: "DIRECT_STATEMENT", completed: true, proofText: f.fact },
      ])}`,
      finalVisibleText: visible,
      ctx,
      chatId: f.chatId,
      personaId: f.personaId,
      characterId: f.senderId,
      turnNumber: 2,
      assistantMessageId,
      db,
    });
    assert.equal(r.applied, 0);
  });

  it("V3 — explicit generationSequence 0 → PASS", () => {
    const f = setupFixture();
    const db = getDb();
    const ctx = buildCtx(f);
    const visible = f.fact;
    const assistantMessageId = insertAssistantWithVariant(db, f.chatId, visible, 0);
    assert.equal(
      currentActiveKnowledgeTransferGenerationSequence(db, f.chatId, assistantMessageId),
      0
    );
    const r = commitAcceptedAssistantS4Transfers({
      rawModelText: `${visible}\n${envelopeJson(ctx, [
        { factRef: "K1", receiverRef: "R1", transferType: "DIRECT_STATEMENT", completed: true, proofText: f.fact },
      ])}`,
      finalVisibleText: visible,
      ctx,
      chatId: f.chatId,
      personaId: f.personaId,
      characterId: f.senderId,
      turnNumber: 2,
      assistantMessageId,
      db,
    });
    assert.equal(r.applied, 1);
  });

  it("V4 — explicit regen generationSequence 1 → PASS", () => {
    const f = setupFixture();
    const db = getDb();
    const ctx = buildCtx(f);
    const visible = f.fact;
    const assistantMessageId = insertAssistantWithVariant(db, f.chatId, "gen0", 0);
    setAssistantVariants(
      assistantMessageId,
      [
        { content: "gen0", model: "test", generationSequence: 0 },
        { content: visible, model: "test", generationSequence: 1 },
      ],
      1
    );
    assert.equal(
      currentActiveKnowledgeTransferGenerationSequence(db, f.chatId, assistantMessageId),
      1
    );
    const r = commitAcceptedAssistantS4Transfers({
      rawModelText: `${visible}\n${envelopeJson(ctx, [
        { factRef: "K1", receiverRef: "R1", transferType: "DIRECT_STATEMENT", completed: true, proofText: f.fact },
      ])}`,
      finalVisibleText: visible,
      ctx,
      chatId: f.chatId,
      personaId: f.personaId,
      characterId: f.senderId,
      turnNumber: 2,
      assistantMessageId,
      db,
    });
    assert.equal(r.applied, 1);
  });

  it("V5 — same generation replay → idempotent (0 additional)", () => {
    const f = setupFixture();
    const db = getDb();
    const ctx = buildCtx(f);
    const visible = f.fact;
    const assistantMessageId = insertAssistantWithVariant(db, f.chatId, visible, 0);
    const raw = `${visible}\n${envelopeJson(ctx, [
      { factRef: "K1", receiverRef: "R1", transferType: "DIRECT_STATEMENT", completed: true, proofText: f.fact },
    ])}`;
    const opts = {
      rawModelText: raw,
      finalVisibleText: visible,
      ctx,
      chatId: f.chatId,
      personaId: f.personaId,
      characterId: f.senderId,
      turnNumber: 2,
      assistantMessageId,
      db,
    };
    assert.equal(commitAcceptedAssistantS4Transfers(opts).applied, 1);
    assert.equal(commitAcceptedAssistantS4Transfers(opts).applied, 0);
  });

  it("AB — failed attempt S4 metadata ignored when accepted final has no proof", () => {
    const f = setupFixture();
    const db = getDb();
    const ctx = buildCtx(f);
    const failedRaw = `${f.fact}\n${envelopeJson(ctx, [
      { factRef: "K1", receiverRef: "R1", transferType: "DIRECT_STATEMENT", completed: true, proofText: f.fact },
    ])}`;
    const acceptedVisible = "fallback prose without disclosure.";
    const assistantMessageId = insertAssistantWithVariant(db, f.chatId, acceptedVisible, 0);
    const r = commitAcceptedAssistantS4Transfers({
      rawModelText: failedRaw,
      finalVisibleText: acceptedVisible,
      ctx,
      chatId: f.chatId,
      personaId: f.personaId,
      characterId: f.senderId,
      turnNumber: 2,
      assistantMessageId,
      db,
    });
    assert.equal(r.applied, 0);
    assert.equal(
      getObserverSecretKnowledge({
        chatId: f.chatId,
        personaId: f.personaId,
        secretId: f.secretId,
        observerType: "CHARACTER",
        observerId: String(f.receiverId),
        db,
      }),
      null
    );
  });

  it("AC — accepted fallback with valid S4 event → exactly one transfer", () => {
    const f = setupFixture();
    const db = getDb();
    const ctx = buildCtx(f);
    const visible = f.fact;
    const acceptedRaw = `${visible}\n${envelopeJson(ctx, [
      { factRef: "K1", receiverRef: "R1", transferType: "DIRECT_STATEMENT", completed: true, proofText: f.fact },
    ])}`;
    const assistantMessageId = insertAssistantWithVariant(db, f.chatId, visible, 0);
    const r = commitAcceptedAssistantS4Transfers({
      rawModelText: acceptedRaw,
      finalVisibleText: visible,
      ctx,
      chatId: f.chatId,
      personaId: f.personaId,
      characterId: f.senderId,
      turnNumber: 2,
      assistantMessageId,
      db,
    });
    assert.equal(r.applied, 1);
    assert.equal(r.attempted, 1);
  });

  it("AD — interrupted partial S4 block → transfer 0", () => {
    const f = setupFixture();
    const db = getDb();
    const ctx = buildCtx(f);
    const visible = f.fact;
    const partialRaw = `${visible}\n${S4_TRANSFER_BLOCK}\n{"nonce":"${ctx.nonce}"`;
    const assistantMessageId = insertAssistantWithVariant(db, f.chatId, visible, 0);
    const r = commitAcceptedAssistantS4Transfers({
      rawModelText: partialRaw,
      finalVisibleText: visible,
      ctx,
      chatId: f.chatId,
      personaId: f.personaId,
      characterId: f.senderId,
      turnNumber: 2,
      assistantMessageId,
      db,
    });
    assert.equal(r.applied, 0);
  });

  it("AE — duplicate finalize → 0 additional transfer", () => {
    const f = setupFixture();
    const db = getDb();
    const ctx = buildCtx(f);
    const visible = f.fact;
    const assistantMessageId = insertAssistantWithVariant(db, f.chatId, visible, 0);
    const opts = {
      rawModelText: `${visible}\n${envelopeJson(ctx, [
        { factRef: "K1", receiverRef: "R1", transferType: "DIRECT_STATEMENT", completed: true, proofText: f.fact },
      ])}`,
      finalVisibleText: visible,
      ctx,
      chatId: f.chatId,
      personaId: f.personaId,
      characterId: f.senderId,
      turnNumber: 2,
      assistantMessageId,
      db,
    };
    assert.equal(commitAcceptedAssistantS4Transfers(opts).applied, 1);
    const second = commitAcceptedAssistantS4Transfers(opts);
    assert.equal(second.applied, 0);
    assert.ok(second.results.some((x) => x.reason === "DUPLICATE"));
  });

  it("stored/client leak — saved prose and alternates contain no S4 control", () => {
    const f = setupFixture();
    const db = getDb();
    const ctx = buildCtx(f);
    const visible = f.fact;
    const raw = `${visible}\n${S4_TRANSFER_BLOCK}\n${JSON.stringify({
      nonce: ctx.nonce,
      events: [{ factRef: "K1", receiverRef: "R1", transferType: "DIRECT_STATEMENT", completed: true, proofText: f.fact }],
    })}\n${S4_TRANSFER_END}`;
    const saved = stripS4ServerControlFromText(raw);
    assert.equal(saved, visible);
    assert.doesNotMatch(saved, /S4_KNOWLEDGE/);
    assert.doesNotMatch(saved, /<<<END_S4>>>/);
    assert.doesNotMatch(saved, new RegExp(ctx.nonce));
    const assistantMessageId = insertAssistantWithVariant(db, f.chatId, saved, 0);
    commitAcceptedAssistantS4Transfers({
      rawModelText: raw,
      finalVisibleText: saved,
      ctx,
      chatId: f.chatId,
      personaId: f.personaId,
      characterId: f.senderId,
      turnNumber: 2,
      assistantMessageId,
      db,
    });
    const row = db
      .prepare(`SELECT content, alternates FROM messages WHERE id=?`)
      .get(assistantMessageId) as { content: string; alternates: string };
    assert.doesNotMatch(row.content, /S4_KNOWLEDGE/);
    assert.doesNotMatch(row.alternates, /S4_KNOWLEDGE/);
    assert.doesNotMatch(row.content, /K1|R1/);
  });
});

describe("STATUS + S4 coexistence", () => {
  it("A — status + S4 valid → both captured, saved prose clean, S4 applies", () => {
    const f = setupFixture();
    const db = getDb();
    const ctx = buildCtx(f);
    const visible = f.fact;
    const statusJson = `${STATUS_VALUES_BLOCK}\n{"시간":"14:30"}\n${STATUS_VALUES_END}`;
    const s4Json = envelopeJson(ctx, [
      { factRef: "K1", receiverRef: "R1", transferType: "DIRECT_STATEMENT", completed: true, proofText: f.fact },
    ]);
    const raw = `${visible}\n\n${statusJson}\n\n${s4Json}`;
    const partitioned = partitionModelStatusArtifacts(raw);
    assert.equal(partitioned.prose.trim(), visible);
    assert.ok(partitioned.capturedStatusWidgetValues?.character?.["시간"]);
    assert.equal(partitioned.capturedS4TransferEnvelope?.nonce, ctx.nonce);
    assert.ok(captureStatusWidgetValuesFromModelText(raw));
    const saved = stripAllStatusWindowOutputArtifacts(raw);
    assert.equal(saved.trim(), visible);
    const assistantMessageId = insertAssistantWithVariant(db, f.chatId, saved, 0);
    const r = commitAcceptedAssistantS4Transfers({
      rawModelText: raw,
      finalVisibleText: saved,
      ctx,
      chatId: f.chatId,
      personaId: f.personaId,
      characterId: f.senderId,
      turnNumber: 2,
      assistantMessageId,
      db,
    });
    assert.equal(r.applied, 1);
  });

  it("B — reversed malformed ordering → visible control leak 0, S4 write 0", () => {
    const f = setupFixture();
    const db = getDb();
    const ctx = buildCtx(f);
    const visible = "본문.";
    const statusJson = `${STATUS_VALUES_BLOCK}\n{"시간":"14:30"}\n${STATUS_VALUES_END}`;
    const s4Json = envelopeJson(ctx, [
      { factRef: "K1", receiverRef: "R1", transferType: "DIRECT_STATEMENT", completed: true, proofText: "missing" },
    ]);
    const raw = `${visible}\n\n${s4Json}\n\n${statusJson}`;
    const saved = stripAllStatusWindowOutputArtifacts(raw);
    assert.doesNotMatch(saved, /S4_KNOWLEDGE/);
    assert.doesNotMatch(saved, /STATUS_VALUES/);
    const assistantMessageId = insertAssistantWithVariant(db, f.chatId, saved, 0);
    const r = commitAcceptedAssistantS4Transfers({
      rawModelText: raw,
      finalVisibleText: saved,
      ctx,
      chatId: f.chatId,
      personaId: f.personaId,
      characterId: f.senderId,
      turnNumber: 2,
      assistantMessageId,
      db,
    });
    assert.equal(r.applied, 0);
  });

  it("C — status valid / S4 malformed → status survives, S4 write 0", () => {
    const f = setupFixture();
    const db = getDb();
    const ctx = buildCtx(f);
    const visible = "본문.";
    const statusJson = `${STATUS_VALUES_BLOCK}\n{"시간":"14:30"}\n${STATUS_VALUES_END}`;
    const raw = `${visible}\n\n${statusJson}\n\n${S4_TRANSFER_BLOCK}\n{bad-json\n${S4_TRANSFER_END}`;
    const partitioned = partitionModelStatusArtifacts(raw);
    assert.equal(partitioned.prose.trim(), visible);
    assert.ok(partitioned.capturedStatusWidgetValues?.character?.["시간"]);
    assert.equal(partitioned.capturedS4TransferEnvelope, null);
    const assistantMessageId = insertAssistantWithVariant(db, f.chatId, visible, 0);
    assert.equal(
      commitAcceptedAssistantS4Transfers({
        rawModelText: raw,
        finalVisibleText: visible,
        ctx,
        chatId: f.chatId,
        personaId: f.personaId,
        characterId: f.senderId,
        turnNumber: 2,
        assistantMessageId,
        db,
      }).applied,
      0
    );
  });

  it("D — S4 valid / status malformed → S4 binds when proof valid", () => {
    const f = setupFixture();
    const db = getDb();
    const ctx = buildCtx(f);
    const visible = f.fact;
    const badStatus = `${STATUS_VALUES_BLOCK}\n{not-json\n${STATUS_VALUES_END}`;
    const s4Json = envelopeJson(ctx, [
      { factRef: "K1", receiverRef: "R1", transferType: "DIRECT_STATEMENT", completed: true, proofText: f.fact },
    ]);
    const raw = `${visible}\n\n${badStatus}\n\n${s4Json}`;
    const saved = stripAllStatusWindowOutputArtifacts(raw);
    assert.equal(saved.trim(), visible);
    const assistantMessageId = insertAssistantWithVariant(db, f.chatId, saved, 0);
    assert.equal(
      commitAcceptedAssistantS4Transfers({
        rawModelText: raw,
        finalVisibleText: saved,
        ctx,
        chatId: f.chatId,
        personaId: f.personaId,
        characterId: f.senderId,
        turnNumber: 2,
        assistantMessageId,
        db,
      }).applied,
      1
    );
  });
});

describe("S4 control capture", () => {
  it("captures envelope from model text", () => {
    const env = captureS4TransferEnvelopeFromModelText(
      `prose\n${S4_TRANSFER_BLOCK}\n{"nonce":"n1","events":[]}\n${S4_TRANSFER_END}`
    );
    assert.equal(env?.nonce, "n1");
  });
});
