/**
 * P0 — Single authority chain: Discovery ON blocks legacy paths;
 * prompt build is read-only; observer isolation; stale rule regression.
 */
import Module from "module";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { getActiveChatScene } from "@/lib/chatScenes";
import {
  buildDeterministicDisclosureIdempotencyKey,
  confirmPersonaSecretDisclosure,
} from "@/lib/personaSecretDirectDisclosure";
import { compileAndApplyPersonaSecrets } from "@/lib/personaSecretCompiler";
import { listExistingPersonaSecrets } from "@/lib/personaSecretCompilerApply";
import {
  buildCharacterKnownFactsBlock,
  buildPersonaKnowledgePromptBlock,
  getCharacterSecretKnowledge,
} from "@/lib/personaSecretKnowledge";
import {
  buildGenerationKnowledgeContext,
  resolvePersonaKnowledgePromptDecisionForChat,
} from "@/lib/personaKnowledgePromptPolicy";
import { createPersonaSecret } from "@/lib/personaSecrets";
import { bootstrapChatObservers } from "@/lib/observerBootstrap";
import { upsertChatObserver } from "@/lib/observerIdentity";
import { upsertScenePresence } from "@/lib/scenePresence";
import { extractAndPersistSceneEvidence } from "@/lib/sceneEvidence";
import { runVisualDiscoveryForTurn } from "@/lib/visualDiscovery";
import { upsertInvestigationTarget } from "@/lib/investigationTargets";
import { runInvestigationDiscoveryForTurn } from "@/lib/investigationDiscovery";
import { listEligibleVisualDiscoveryRules } from "@/lib/visualDiscoveryEligibility";
import { listEligibleInvestigationDiscoveryRules } from "@/lib/investigationEligibility";

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

function uniqueIds() {
  const n = Math.floor(Math.random() * 10000);
  return {
    personaId: 995000 + n,
    chatId: 996000 + n,
    charA: 17,
    charB: 29,
  };
}

function countRows(table: string, where = ""): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM ${table}${where ? ` WHERE ${where}` : ""}`)
    .get() as { c: number };
  return row.c;
}

function setupTwoCharacterChat(opts: {
  chatId: number;
  charA: number;
  charB: number;
}) {
  bootstrapChatObservers({
    chatId: opts.chatId,
    characterId: opts.charA,
    displayName: "A",
    turnNumber: 1,
  });
  upsertChatObserver({
    chatId: opts.chatId,
    observerType: "CHARACTER",
    observerId: String(opts.charB),
    canonicalSourceType: "PARTY_CHARACTER",
    displayName: "B",
    createdTurn: 1,
  });
  const scene = getActiveChatScene(opts.chatId)!;
  for (const id of [opts.charA, opts.charB]) {
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

describe("P0 persona secret single authority", () => {
  let env: Record<string, string | undefined>;

  beforeEach(() => {
    env = saveEnv();
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "1";
  });
  afterEach(() => restoreEnv(env));

  it("S1: A CONFIRMED, B UNKNOWN before and after B prompt build + reload simulation", () => {
    const { personaId, chatId, charA, charB } = uniqueIds();
    const created = createPersonaSecret({
      personaId,
      secretKey: "fortress_experiment_017",
      canonicalSecretText: "렌은 성채의 비밀 실험체 017이다.",
      confirmedFactText: "렌이 성채 실험체 017이었다는 사실을 알고 있다.",
      directDisclosureAliases: ["나 사실 성채 실험체 017이었어"],
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    setupTwoCharacterChat({ chatId, charA, charB });

    confirmPersonaSecretDisclosure({
      chatId,
      personaId,
      secretId: created.secret.id,
      characterId: charA,
      turnNumber: 1,
      sourceType: "USER_MESSAGE_DETERMINISTIC",
      revealedFactText: created.secret.confirmedFactText,
      idempotencyKey: buildDeterministicDisclosureIdempotencyKey({
        chatId,
        personaId,
        secretId: created.secret.id,
        characterId: charA,
        turnNumber: 1,
      }),
    });

    assert.equal(
      getCharacterSecretKnowledge({
        chatId,
        personaId,
        secretId: created.secret.id,
        characterId: charA,
      })?.knowledge_state,
      "CONFIRMED"
    );
    assert.equal(
      getCharacterSecretKnowledge({
        chatId,
        personaId,
        secretId: created.secret.id,
        characterId: charB,
      }),
      null
    );

    const revealRows = getDb()
      .prepare(
        `SELECT COUNT(*) AS c FROM chat_persona_secret_reveals WHERE chat_id=? AND persona_id=?`
      )
      .get(chatId, personaId) as { c: number };
    assert.equal(revealRows.c, 0, "Discovery ON: no legacy reveal dual-write");

    const decisionB = resolvePersonaKnowledgePromptDecisionForChat(
      buildGenerationKnowledgeContext({ contentKind: "character", characterId: charB }),
      { chatId }
    );
    const blockB = buildPersonaKnowledgePromptBlock({
      decision: decisionB,
      chatId,
      personaId,
      authority: "discovery",
    });
    assert.equal(blockB, null, "B prompt has no private facts");

    assert.equal(
      getCharacterSecretKnowledge({
        chatId,
        personaId,
        secretId: created.secret.id,
        characterId: charB,
      }),
      null,
      "B knowledge unchanged after prompt build"
    );

    const freshDb = getDb();
    assert.equal(
      getCharacterSecretKnowledge({
        chatId,
        personaId,
        secretId: created.secret.id,
        characterId: charB,
        db: freshDb,
      }),
      null,
      "B knowledge unchanged on fresh read (reload simulation)"
    );
  });

  it("prompt build authority=discovery produces zero DB row delta", () => {
    const { personaId, chatId, charA } = uniqueIds();
    const created = createPersonaSecret({
      personaId,
      secretKey: "prompt_delta_check",
      canonicalSecretText: "HIDDEN",
      confirmedFactText: "렌이 확인한 사실.",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    setupTwoCharacterChat({ chatId, charA, charB: 29 });
    confirmPersonaSecretDisclosure({
      chatId,
      personaId,
      secretId: created.secret.id,
      characterId: charA,
      turnNumber: 1,
      sourceType: "USER_MESSAGE_DETERMINISTIC",
      revealedFactText: created.secret.confirmedFactText,
      idempotencyKey: "delta-check",
    });

    const tables = [
      "chat_character_secret_knowledge",
      "persona_secret_evidence_events",
      "chat_persona_secret_reveals",
    ] as const;
    const before = Object.fromEntries(
      tables.map((t) => [t, countRows(t, `chat_id=${chatId}`)])
    ) as Record<(typeof tables)[number], number>;

    const decision = resolvePersonaKnowledgePromptDecisionForChat(
      buildGenerationKnowledgeContext({ contentKind: "character", characterId: charA }),
      { chatId }
    );
    buildPersonaKnowledgePromptBlock({
      decision,
      chatId,
      personaId,
      authority: "discovery",
    });
    buildCharacterKnownFactsBlock({
      chatId,
      personaId,
      characterId: charA,
      authority: "discovery",
    });

    for (const t of tables) {
      assert.equal(
        countRows(t, `chat_id=${chatId}`),
        before[t],
        `${t} row count unchanged after prompt build`
      );
    }
  });

  it("stale VISUAL rule: recompile disables; same evidence yields 0 discovery", () => {
    const { personaId, chatId, charA } = uniqueIds();
    const markSource = "렌의 등에 실험체 시절 생긴 017 문신이 있다.";
    assert.equal(compileAndApplyPersonaSecrets({ personaId, source: markSource }).ok, true);
    setupTwoCharacterChat({ chatId, charA, charB: 29 });

    extractAndPersistSceneEvidence({
      chatId,
      characterId: charA,
      turnNumber: 1,
      sourceMessageId: 1,
      userMessage: "렌은 젖은 셔츠를 벗어 의자에 걸고 로코에게 등을 보였다.",
      publicPersonaId: personaId,
    });
    const first = runVisualDiscoveryForTurn({
      chatId,
      personaId,
      characterId: charA,
      turnNumber: 1,
      sourceMessageId: 1,
    });
    assert.ok(first.matchCount >= 1);

    assert.equal(
      compileAndApplyPersonaSecrets({ personaId, source: "렌은 평범한 가이드다." }).ok,
      true
    );
    const enabledVisual = listEligibleVisualDiscoveryRules(personaId);
    assert.equal(enabledVisual.length, 0, "stale visual rules not eligible");

    const second = runVisualDiscoveryForTurn({
      chatId,
      personaId,
      characterId: charA,
      turnNumber: 2,
      sourceMessageId: 2,
    });
    assert.equal(second.matchCount, 0);
    assert.equal(second.changedCount, 0);
  });

  it("stale INVESTIGATION rule: recompile disables; investigation yields 0", () => {
    const { personaId, chatId, charA } = uniqueIds();
    assert.equal(
      compileAndApplyPersonaSecrets({ personaId, source: "렌은 거액의 빚이 있다." }).ok,
      true
    );
    setupTwoCharacterChat({ chatId, charA, charB: 29 });
    upsertInvestigationTarget({
      ownerScope: "CHAT",
      ownerId: String(chatId),
      targetType: "DOCUMENT",
      targetKey: "doc:독촉장",
      displayLabel: "독촉장",
      payload: {
        resultType: "DOCUMENT_CONTENT_VERIFIED",
        resultState: "VERIFIED",
        resultTags: ["debt_notice", "debtor_identity_match"],
        observableFacts: ["독촉장"],
        requiredAccess: { allowedActions: ["READ_DOCUMENT"] },
      },
    });
    const first = runInvestigationDiscoveryForTurn({
      chatId,
      personaId,
      characterId: charA,
      turnNumber: 1,
      sourceMessageId: 1,
      explicitActions: [{ actionType: "READ_DOCUMENT", targetKey: "doc:독촉장" }],
    });
    assert.ok(first.changedCount >= 1);

    assert.equal(
      compileAndApplyPersonaSecrets({ personaId, source: "렌은 평범한 가이드다." }).ok,
      true
    );
    assert.equal(listEligibleInvestigationDiscoveryRules(personaId).length, 0);

    const second = runInvestigationDiscoveryForTurn({
      chatId,
      personaId,
      characterId: charA,
      turnNumber: 2,
      sourceMessageId: 2,
      explicitActions: [{ actionType: "READ_DOCUMENT", targetKey: "doc:독촉장" }],
    });
    assert.equal(second.changedCount, 0);
  });
});
