import Module from "module";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { bootstrapChatObservers } from "@/lib/observerBootstrap";
import { registerNpcObserver } from "@/lib/observerIdentity";
import { getDb } from "@/lib/db";
import {
  buildGenerationKnowledgeContext,
  personaKnowledgePromptDecisionMeta,
  resolvePersonaKnowledgePromptDecisionForChat,
  resolvePersonaKnowledgePromptPolicy,
  withEnsembleRedactedPromptAssembly,
} from "@/lib/personaKnowledgePromptPolicy";
import {
  buildKnownPersonaFactsForObserver,
  buildPersonaKnowledgePromptBlock,
  upsertObserverSecretKnowledge,
} from "@/lib/personaSecretKnowledge";
import { createPersonaSecret } from "@/lib/personaSecrets";
import {
  buildRevealedPersonaFactsBlock,
  type ChatPersonaSecretRevealRow,
} from "@/lib/personaSecretReveal";
import { extractAndPersistSceneEvidence } from "@/lib/sceneEvidence";
import { runVisualDiscoveryForTurn } from "@/lib/visualDiscovery";
import { compileAndApplyPersonaSecrets } from "@/lib/personaSecretCompiler";
import { buildContext } from "@/services/contextBuilder";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

const ENV_KEYS = ["PERSONA_SECRET_BOUNDARY_ENABLED"] as const;
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
    characterId: 42,
    personaId: 881000 + n,
    locoId: 42,
    taehyunId: 43,
  };
}

function seedFact(opts: {
  chatId: number;
  personaId: number;
  observerType: "CHARACTER" | "NPC";
  observerId: string;
  fact: string;
  secretKey: string;
}) {
  const created = createPersonaSecret({
    personaId: opts.personaId,
    secretKey: opts.secretKey,
    canonicalSecretText: `HIDDEN ${opts.secretKey} NEEDLE`,
    confirmedFactText: opts.fact,
  });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("create failed");
  upsertObserverSecretKnowledge({
    chatId: opts.chatId,
    personaId: opts.personaId,
    secretId: created.secret.id,
    observerType: opts.observerType,
    observerId: opts.observerId,
    knowledgeState: "CONFIRMED",
    confidence: 100,
    factSnapshot: opts.fact,
    confirmedTurn: 1,
    lastEvidenceEventId: `evt-${opts.secretKey}-${opts.observerId}`,
  });
  return created.secret;
}

describe("PR-S4C persona knowledge prompt isolation", () => {
  let envSnap: Record<string, string | undefined>;
  beforeEach(() => {
    envSnap = saveEnv();
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    getDb();
  });
  afterEach(() => restoreEnv(envSnap));

  it("1. authoritative single speaker → OBSERVER_SPECIFIC with facts", () => {
    const { chatId, characterId, personaId } = ids();
    bootstrapChatObservers({ chatId, characterId });
    seedFact({
      chatId,
      personaId,
      observerType: "CHARACTER",
      observerId: String(characterId),
      fact: "렌이 등에 실험 문신이 있다는 사실을 확인했다.",
      secretKey: "tattoo_s4c_1",
    });
    const decision = resolvePersonaKnowledgePromptDecisionForChat(
      buildGenerationKnowledgeContext({
        contentKind: "character",
        characterId,
      }),
      { chatId }
    );
    assert.equal(decision.mode, "OBSERVER_SPECIFIC");
    assert.equal(decision.reasonCode, "AUTHORITATIVE_SINGLE_SPEAKER");
    assert.equal(decision.observerId, String(characterId));
    const block = buildPersonaKnowledgePromptBlock({
      decision,
      chatId,
      personaId,
    });
    assert.ok(block);
    assert.match(block!, /CHARACTER-KNOWN FACTS/);
    assert.match(block!, /문신/);
    assert.doesNotMatch(block!, /HIDDEN tattoo_s4c_1 NEEDLE/);
  });

  it("2. simulation ensemble → ENSEMBLE_REDACTED, no known-facts block", () => {
    const { chatId, characterId, personaId } = ids();
    bootstrapChatObservers({ chatId, characterId });
    seedFact({
      chatId,
      personaId,
      observerType: "CHARACTER",
      observerId: String(characterId),
      fact: "렌이 이계에서 왔다는 사실을 확인했다.",
      secretKey: "origin_s4c_2",
    });
    const ctx = buildGenerationKnowledgeContext({
      contentKind: "simulation",
      simulationCast: "의사, 경비병",
      characterId,
    });
    const decision = resolvePersonaKnowledgePromptDecisionForChat(ctx, { chatId });
    assert.equal(decision.mode, "ENSEMBLE_REDACTED");
    assert.equal(decision.reasonCode, "SIMULATION_ENSEMBLE");
    const block = buildPersonaKnowledgePromptBlock({
      decision,
      chatId,
      personaId,
    });
    assert.equal(block, null);
  });

  it("3. multiple speakers possible → ENSEMBLE_REDACTED", () => {
    const decision = resolvePersonaKnowledgePromptPolicy({
      isSimulationEnsemble: false,
      mayGenerateMultipleSpeakers: true,
      usesFreeTextCast: false,
      authoritativeSpeaker: {
        observerType: "CHARACTER",
        observerId: "1",
      },
    });
    assert.equal(decision.mode, "ENSEMBLE_REDACTED");
    assert.equal(decision.reasonCode, "MULTIPLE_SPEAKERS_POSSIBLE");
  });

  it("4. free-text cast → ENSEMBLE_REDACTED", () => {
    const decision = resolvePersonaKnowledgePromptPolicy({
      isSimulationEnsemble: false,
      mayGenerateMultipleSpeakers: false,
      usesFreeTextCast: true,
      authoritativeSpeaker: {
        observerType: "CHARACTER",
        observerId: "1",
      },
    });
    assert.equal(decision.mode, "ENSEMBLE_REDACTED");
    assert.equal(decision.reasonCode, "FREE_TEXT_CAST");
  });

  it("5. missing speaker → ENSEMBLE_REDACTED, no main-character fallback", () => {
    const { chatId, characterId, personaId } = ids();
    bootstrapChatObservers({ chatId, characterId });
    seedFact({
      chatId,
      personaId,
      observerType: "CHARACTER",
      observerId: String(characterId),
      fact: "대표 캐릭터만 아는 비밀 사실이다.",
      secretKey: "fallback_s4c_5",
    });
    const decision = resolvePersonaKnowledgePromptPolicy({
      isSimulationEnsemble: false,
      mayGenerateMultipleSpeakers: false,
      usesFreeTextCast: false,
      // no authoritativeSpeaker
    });
    assert.equal(decision.mode, "ENSEMBLE_REDACTED");
    assert.equal(decision.reasonCode, "MISSING_AUTHORITATIVE_SPEAKER");
    const block = buildPersonaKnowledgePromptBlock({
      decision,
      chatId,
      personaId,
    });
    assert.equal(block, null);
  });

  it("6. loco-only secret: loco 1:1 has fact; taehyun 1:1 does not", () => {
    const { chatId, personaId, locoId, taehyunId } = ids();
    bootstrapChatObservers({ chatId, characterId: locoId, displayName: "로코" });
    // Register second observer without seeding its knowledge.
    registerNpcObserver({
      chatId,
      observerId: String(taehyunId),
      displayName: "태현",
      canonicalSourceType: "SERVER_NPC",
    });
    seedFact({
      chatId,
      personaId,
      observerType: "CHARACTER",
      observerId: String(locoId),
      fact: "로코만 확인한 문신 사실이다.",
      secretKey: "loco_only_s4c_6",
    });

    const locoDecision = resolvePersonaKnowledgePromptDecisionForChat(
      buildGenerationKnowledgeContext({ contentKind: "character", characterId: locoId }),
      { chatId }
    );
    const locoBlock = buildPersonaKnowledgePromptBlock({
      decision: locoDecision,
      chatId,
      personaId,
    });
    assert.ok(locoBlock && /로코만 확인한 문신/.test(locoBlock));

    const taehyunDecision = {
      mode: "OBSERVER_SPECIFIC" as const,
      observerType: "CHARACTER" as const,
      observerId: String(taehyunId),
      reasonCode: "AUTHORITATIVE_SINGLE_SPEAKER" as const,
    };
    const taehyunBlock = buildPersonaKnowledgePromptBlock({
      decision: taehyunDecision,
      chatId,
      personaId,
    });
    assert.equal(taehyunBlock, null);
  });

  it("7. shared ensemble: neither loco nor taehyun facts injected", () => {
    const { chatId, personaId, locoId, taehyunId } = ids();
    bootstrapChatObservers({ chatId, characterId: locoId });
    registerNpcObserver({
      chatId,
      observerId: String(taehyunId),
      displayName: "태현",
      canonicalSourceType: "SERVER_NPC",
    });
    seedFact({
      chatId,
      personaId,
      observerType: "CHARACTER",
      observerId: String(locoId),
      fact: "로코 전용 비밀 사실 A.",
      secretKey: "ens_loco_s4c_7",
    });
    seedFact({
      chatId,
      personaId,
      observerType: "NPC",
      observerId: String(taehyunId),
      fact: "태현 전용 비밀 사실 B.",
      secretKey: "ens_tae_s4c_7",
    });
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

    const built = buildContext({
      charName: "시뮬",
      contentKind: "simulation",
      chunks: [
        {
          id: "c1",
          characterId: String(locoId),
          content: "시뮬",
          category: "identity",
          importance: "CRITICAL",
          tokenCount: 1,
          keywords: [],
        },
      ],
      userNickname: "렌",
      // Accidental leak attempt — contextBuilder must drop for simulation.
      revealedPersonaFactsBlock: "로코 전용 비밀 사실 A.\n태현 전용 비밀 사실 B.",
      shortTermHistory: [],
      currentUserMessage: "장면 진행",
      nsfw: false,
      longTermMemory: "",
      modelId: "meta/muse-spark-1.1",
      provider: "openrouter",
    });
    const full = `${built.systemPrompt ?? ""}\n${built.openRouterSystemSplit?.dynamicBlock ?? ""}`;
    assert.doesNotMatch(full, /로코 전용 비밀|태현 전용 비밀|CHARACTER-KNOWN FACTS/);
  });

  it("8. same request decision reused for main/recovery/model-picker meta", () => {
    const decision = resolvePersonaKnowledgePromptPolicy({
      isSimulationEnsemble: true,
      mayGenerateMultipleSpeakers: true,
      usesFreeTextCast: true,
    });
    const mainMeta = personaKnowledgePromptDecisionMeta(decision);
    const recoveryMeta = personaKnowledgePromptDecisionMeta(decision);
    const pickerMeta = personaKnowledgePromptDecisionMeta(decision);
    assert.deepEqual(mainMeta, recoveryMeta);
    assert.deepEqual(mainMeta, pickerMeta);
    assert.equal(mainMeta.personaKnowledgePromptMode, "ENSEMBLE_REDACTED");
    assert.equal(mainMeta.includedObserverFacts, false);
    assert.equal(mainMeta.reasonCode, "SIMULATION_ENSEMBLE");
  });

  it("9. 1:1 same-turn Visual Discovery still projects into known facts", () => {
    const { chatId, characterId, personaId } = ids();
    compileAndApplyPersonaSecrets({
      personaId,
      source: "렌의 등에 실험체 시절 생긴 017 문신이 있다.",
    });
    bootstrapChatObservers({ chatId, characterId });
    const decision = resolvePersonaKnowledgePromptDecisionForChat(
      buildGenerationKnowledgeContext({ contentKind: "character", characterId }),
      { chatId }
    );
    assert.equal(decision.mode, "OBSERVER_SPECIFIC");
    const before = buildPersonaKnowledgePromptBlock({
      decision,
      chatId,
      personaId,
    });
    extractAndPersistSceneEvidence({
      chatId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 901,
      userMessage: "렌은 젖은 셔츠를 벗어 의자에 걸고 로코에게 등을 보였다.",
      publicPersonaId: personaId,
    });
    runVisualDiscoveryForTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 901,
    });
    const after = buildPersonaKnowledgePromptBlock({
      decision,
      chatId,
      personaId,
    });
    assert.notEqual(after, before);
    assert.ok(after && /문신|017|등/.test(after));
  });

  it("10. legacy reveal block cannot bypass ensemble redaction scope", () => {
    const legacyRow: ChatPersonaSecretRevealRow = {
      id: 1,
      chat_id: 1,
      persona_id: 1,
      secret_key: "legacy_key",
      revealed_fact_text: "레거시 공개 사실 바늘",
      revealed_at_turn: 1,
      source: "USER_AUTHORED_DISCLOSURE",
      created_at: new Date().toISOString(),
    };
    assert.throws(
      () =>
        withEnsembleRedactedPromptAssembly(() =>
          buildRevealedPersonaFactsBlock([legacyRow])
        ),
      /PERSONA_KNOWLEDGE_QUERY_FORBIDDEN_IN_ENSEMBLE_REDACTED_SCOPE/
    );
    assert.throws(
      () =>
        withEnsembleRedactedPromptAssembly(() =>
          buildKnownPersonaFactsForObserver({
            chatId: 1,
            personaId: 1,
            observerType: "CHARACTER",
            observerId: "1",
          })
        ),
      /PERSONA_KNOWLEDGE_QUERY_FORBIDDEN_IN_ENSEMBLE_REDACTED_SCOPE/
    );
  });
});