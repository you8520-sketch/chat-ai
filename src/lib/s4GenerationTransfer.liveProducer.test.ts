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
  canObserveAuditorily,
  upsertScenePresence,
} from "@/lib/scenePresence";
import {
  buildGenerationKnowledgeContext,
  resolvePersonaKnowledgePromptDecisionForChat,
} from "@/lib/personaKnowledgePromptPolicy";
import {
  buildPersonaKnowledgeWithS4ForTurn,
  buildS4GenerationTransferContext,
} from "@/lib/s4GenerationTransfer/context";
import {
  captureS4TransferEnvelopeFromModelText,
  splitProseAndS4TransferEnvelope,
  stripIncompleteS4TransferTail,
} from "@/lib/s4GenerationTransfer/controlChannel";
import { commitAcceptedAssistantS4Transfers } from "@/lib/s4GenerationTransfer/commit";
import { S4_TRANSFER_BLOCK, S4_TRANSFER_END } from "@/lib/s4GenerationTransfer/types";
import { stripAllStatusWindowOutputArtifacts } from "@/lib/statusMeta/stripArtifacts";
import { appendMessageVariant } from "@/lib/messageAlternates";
import {
  applyVariantScopedAuthoritativeKnowledgeTransfer,
  reconcileS4KnowledgeForVariantSwitch,
} from "@/lib/knowledgeTransferVariant";
import { ensureKnowledgeTransferSchema } from "@/lib/knowledgeTransferSchema";

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
      generationSequence: 0,
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
      generationSequence: 0,
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
        generationSequence: 0,
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
      generationSequence: 0,
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
      generationSequence: 0,
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
      generationSequence: 0,
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

  it("Y/Z/AA — stream strip: truncated/partial/chunk split leak 0", () => {
    const korean = "한국어 RP 본문입니다.";
    const partial = `${korean}\n<<<S4_KNOWLEDGE`;
    assert.equal(stripIncompleteS4TransferTail(partial), korean);
    assert.equal(stripIncompleteS4TransferTail(`${korean}\n<<<S4_KNOWLEDGE_TRANSFER>>>`), korean);

    const chunks = ["한국", "어 RP\n<<<S4_", "KNOWLEDGE_TRANSFER>>>\n{\"nonce"];
    let acc = "";
    for (const c of chunks) {
      acc += c;
      acc = stripIncompleteS4TransferTail(acc);
    }
    assert.ok(!acc.includes("<<<S4"));
    assert.ok(acc.startsWith("한국어"));

    const full = `${korean}\n${S4_TRANSFER_BLOCK}\n{"nonce":"x"}\n${S4_TRANSFER_END}`;
    const stripped = stripAllStatusWindowOutputArtifacts(full);
    assert.equal(stripped, korean);
    assert.ok(!stripped.includes(S4_TRANSFER_BLOCK));
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
      generationSequence: 0,
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
