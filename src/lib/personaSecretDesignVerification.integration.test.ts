/**
 * Persona Secret System — READ-ONLY design verification (Scenarios 0–4, H–L).
 * Synthetic fixtures only; no production user data; no model calls.
 *
 * Baseline: #677 single-authority (49ee38e3) + #680 S3 attribution (ded3a2a0).
 */
import Module from "module";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { getActiveChatScene } from "@/lib/chatScenes";
import {
  buildDeterministicDisclosureIdempotencyKey,
  confirmPersonaSecretDisclosure,
  detectDeterministicDirectDisclosures,
} from "@/lib/personaSecretDirectDisclosure";
import { compileAndApplyPersonaSecrets } from "@/lib/personaSecretCompiler";
import { listExistingPersonaSecrets } from "@/lib/personaSecretCompilerApply";
import {
  buildCharacterKnownFactsBlock,
  buildPersonaKnowledgePromptBlock,
  getCharacterSecretKnowledge,
  getObserverSecretKnowledge,
  upsertObserverSecretKnowledge,
} from "@/lib/personaSecretKnowledge";
import {
  buildGenerationKnowledgeContext,
  resolvePersonaKnowledgePromptDecisionForChat,
  withEnsembleRedactedPromptAssembly,
} from "@/lib/personaKnowledgePromptPolicy";
import { formatPublicPersonaForPrompt } from "@/lib/personaSecretPrompt";
import { toPublicPersonaDescription } from "@/lib/personaSecretLegacyMarkers";
import { toPublicPersonaClientRow } from "@/lib/personaSecretSerialization";
import {
  createPersonaSecret,
  deactivatePersonaSecret,
  updatePersonaSecret,
} from "@/lib/personaSecrets";
import { bootstrapChatObservers } from "@/lib/observerBootstrap";
import { upsertChatObserver } from "@/lib/observerIdentity";
import { applyKnowledgeTransferAction } from "@/lib/knowledgeTransferApply";
import { runKnowledgeTransfersForTurn } from "@/lib/knowledgeTransfer";
import { buildSecretBlindDocumentTargetPayload } from "@/lib/investigationDocumentTargetPayload";
import {
  registerPresentedDocumentTarget,
} from "@/lib/investigationTargets";
import { runInvestigationDiscoveryForTurn } from "@/lib/investigationDiscovery";
import { insertChatPersonaSecretReveal } from "@/lib/personaSecretReveal";
import { extractAndPersistSceneEvidence } from "@/lib/sceneEvidence";
import { listSceneEvidenceEventsForChatTurn } from "@/lib/sceneEvidencePersist";
import { upsertScenePresence } from "@/lib/scenePresence";
import { runVisualDiscoveryForTurn } from "@/lib/visualDiscovery";
import { buildContext } from "@/services/contextBuilder";

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
    personaId: 990000 + n,
    chatId: 991000 + n,
    otherChatId: 992000 + n,
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

/** Synthetic secret contract needles — canonical vs projections. */
const CANONICAL_SECRET =
  "렌은 성채의 비밀 실험체 017이다.";
const CONFIRMED_PROJECTION =
  "렌이 성채 실험체 017이었다는 사실을 알고 있다.";
const SUSPECTED_PROJECTION =
  "렌이 성채 실험체와 관련되어 있을 가능성을 의심하고 있다.";
const VISUAL_CLUE = "렌의 목덜미에 017 식별 표식이 있다.";
const INVESTIGATION_CLUE = "렌의 소지품에 성채 실험기록 017 문서가 있다.";

function assertNoNeedles(
  blob: string,
  needles: string[],
  label: string
): void {
  for (const n of needles) {
    assert.doesNotMatch(
      blob,
      new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${label} leaked: ${n}`
    );
  }
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

function promptForObserver(opts: {
  chatId: number;
  personaId: number;
  characterId: number;
  contentKind?: "character" | "simulation";
  simulationCast?: string;
}) {
  const decision = resolvePersonaKnowledgePromptDecisionForChat(
    buildGenerationKnowledgeContext({
      contentKind: opts.contentKind ?? "character",
      simulationCast: opts.simulationCast,
      characterId: opts.characterId,
    }),
    { chatId: opts.chatId }
  );
  const knownFacts = buildPersonaKnowledgePromptBlock({
    decision,
    chatId: opts.chatId,
    personaId: opts.personaId,
    authority: "discovery",
  });
  const publicPersona = formatPublicPersonaForPrompt(
    "렌",
    "female",
    toPublicPersonaDescription("렌은 S급 가이드다.")
  );
  const built = buildContext({
    charName: "캐릭터",
    chunks: [
      {
        id: "c1",
        characterId: String(opts.characterId),
        content: "캐릭터 설정",
        category: "identity",
        importance: "CRITICAL",
        tokenCount: 10,
        keywords: [],
      },
    ],
    userNickname: "렌",
    userPersona: publicPersona,
    revealedPersonaFactsBlock: knownFacts ?? undefined,
    shortTermHistory: [],
    currentUserMessage: "안녕",
    nsfw: false,
    longTermMemory: "",
    modelId: "meta/muse-spark-1.1",
    provider: "openrouter",
  });
  const assembled = [
    built.systemPrompt ?? "",
    built.openRouterSystemSplit?.dynamicBlock ?? "",
    JSON.stringify(built.messages ?? []),
  ].join("\n");
  return { decision, knownFacts, assembled, publicPersona };
}

function setupTwoCharacterChat(opts: {
  chatId: number;
  charA: number;
  charB: number;
  charAVisual?: "NORMAL" | "BLIND";
  charBPresence?: "PRESENT" | "ABSENT";
  charBVisual?: "NORMAL" | "BLIND";
}) {
  bootstrapChatObservers({
    chatId: opts.chatId,
    characterId: opts.charA,
    displayName: "캐릭터A",
    turnNumber: 1,
  });
  upsertChatObserver({
    chatId: opts.chatId,
    observerType: "CHARACTER",
    observerId: String(opts.charB),
    canonicalSourceType: "PARTY_CHARACTER",
    displayName: "캐릭터B",
    createdTurn: 1,
  });
  const scene = getActiveChatScene(opts.chatId)!;
  upsertScenePresence({
    sceneId: scene.id,
    chatId: opts.chatId,
    observerType: "CHARACTER",
    observerId: String(opts.charA),
    presenceState: "PRESENT",
    awarenessState: "AWARE",
    visualCapability: opts.charAVisual ?? "NORMAL",
    auditoryCapability: "NORMAL",
    joinedTurn: 1,
    sourceType: "SERVER_SCENE_EVENT",
  });
  upsertScenePresence({
    sceneId: scene.id,
    chatId: opts.chatId,
    observerType: "CHARACTER",
    observerId: String(opts.charB),
    presenceState: opts.charBPresence ?? "PRESENT",
    awarenessState: "AWARE",
    visualCapability: opts.charBVisual ?? "NORMAL",
    auditoryCapability: "NORMAL",
    joinedTurn: 1,
    sourceType: "SERVER_SCENE_EVENT",
  });
}

function seedMainSecret(personaId: number) {
  const created = createPersonaSecret({
    personaId,
    secretKey: "fortress_experiment_017",
    ownerTitle: "실험체",
    canonicalSecretText: CANONICAL_SECRET,
    suspectedFactText: SUSPECTED_PROJECTION,
    confirmedFactText: CONFIRMED_PROJECTION,
    directDisclosureAliases: [
      "나는 성채 실험체 017이야",
      "나 사실 성채 실험체 017이었어",
    ],
  });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("secret create failed");
  return created.secret;
}

function insertVisualRule(secretId: string, factText: string, region = "upper_back") {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO persona_secret_discovery_rules (
       id, secret_id, method, rule_key, result_state, revealed_fact_text,
       conditions_json, priority, enabled
     ) VALUES (?,?,?,?,?,?,?,?,1)`
  ).run(
    randomUUID(),
    secretId,
    "VISUAL_DISCOVERY",
    `visual_${region}_017_mark`,
    "SUSPECTED",
    factText,
    JSON.stringify({
      evidenceKind: "BODY_REGION_EXPOSED",
      region,
      resultState: "SUSPECTED",
    }),
    0
  );
}

function insertInvestigationRule(secretId: string, factText: string) {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO persona_secret_discovery_rules (
       id, secret_id, method, rule_key, result_state, revealed_fact_text,
       conditions_json, priority, enabled
     ) VALUES (?,?,?,?,?,?,?,?,1)`
  ).run(
    randomUUID(),
    secretId,
    "INVESTIGATION_DISCOVERY",
    "investigation_doc_017",
    "CONFIRMED",
    factText,
    JSON.stringify({
      evidenceKind: "DOCUMENT_CONTENT_VERIFIED",
      resultTags: ["experiment_record_017", "subject_identity_match"],
      resultState: "CONFIRMED",
    }),
    0
  );
}

describe("Persona Secret design verification — synthetic integration", () => {
  let env: Record<string, string | undefined>;

  beforeEach(() => {
    env = saveEnv();
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "1";
  });
  afterEach(() => restoreEnv(env));

  it("Scenario 0 — secret stored, initially unknown to all observers", () => {
    const { personaId, chatId, charA, charB } = uniqueIds();
    const secret = seedMainSecret(personaId);
    setupTwoCharacterChat({ chatId, charA, charB });

    assert.equal(knowledge(chatId, personaId, charA, secret.id), null);
    assert.equal(knowledge(chatId, personaId, charB, secret.id), null);

    const promptA = promptForObserver({ chatId, personaId, characterId: charA });
    const promptB = promptForObserver({ chatId, personaId, characterId: charB });
    const ensembleDecision = resolvePersonaKnowledgePromptDecisionForChat(
      buildGenerationKnowledgeContext({
        contentKind: "simulation",
        simulationCast: "A, B",
        characterId: charA,
      }),
      { chatId }
    );
    const ensembleBlock = withEnsembleRedactedPromptAssembly(() =>
      buildPersonaKnowledgePromptBlock({
        decision: ensembleDecision,
        chatId,
        personaId,
      })
    );

    assert.equal(promptA.knownFacts, null);
    assert.equal(promptB.knownFacts, null);
    assert.equal(ensembleBlock, null);
    assertNoNeedles(
      [promptA.assembled, promptB.assembled, promptA.publicPersona ?? ""].join("\n"),
      [CANONICAL_SECRET, CONFIRMED_PROJECTION, SUSPECTED_PROJECTION],
      "scenario0"
    );

    const publicDto = toPublicPersonaClientRow({
      id: personaId,
      user_id: 1,
      name: "렌",
      memo: "",
      gender: "female",
      description: "공개",
      secret_description: CANONICAL_SECRET,
      speech_examples: "",
      image_url: "",
      image_focus_x: 0.5,
      image_focus_y: 0.5,
      created_at: "2026-01-01",
    });
    assert.equal("secret_description" in publicDto, false);
    assert.doesNotMatch(JSON.stringify(publicDto), /성채/);
  });

  it("Scenario 1 — S1 direct disclosure: A CONFIRMED, B UNKNOWN, no cross-observer leak", () => {
    const { personaId, chatId, otherChatId, charA, charB } = uniqueIds();
    const secret = seedMainSecret(personaId);
    setupTwoCharacterChat({ chatId, charA, charB });

    const msg = "나 사실 성채 실험체 017이었어.";
    const matches = detectDeterministicDirectDisclosures(msg, personaId);
    assert.equal(matches.length, 1);
    assert.doesNotMatch(matches[0]!.revealedFactText, /017이다|성채의 비밀/);

    confirmPersonaSecretDisclosure({
      chatId,
      personaId,
      secretId: secret.id,
      characterId: charA,
      turnNumber: 1,
      sourceMessageId: 101,
      sourceType: "USER_MESSAGE_DETERMINISTIC",
      revealedFactText: matches[0]!.revealedFactText,
      authority: "discovery",
      idempotencyKey: buildDeterministicDisclosureIdempotencyKey({
        chatId,
        personaId,
        secretId: secret.id,
        characterId: charA,
        sourceMessageId: 101,
        turnNumber: 1,
      }),
    });

    const kA = knowledge(chatId, personaId, charA, secret.id);
    assert.equal(kA?.knowledge_state, "CONFIRMED");
    assert.equal(kA?.fact_snapshot, CONFIRMED_PROJECTION);
    assert.equal(knowledge(chatId, personaId, charB, secret.id), null);
    assert.equal(knowledge(otherChatId, personaId, charA, secret.id), null);

    const revealRows = getDb()
      .prepare(
        `SELECT COUNT(*) AS c FROM chat_persona_secret_reveals WHERE chat_id=? AND persona_id=?`
      )
      .get(chatId, personaId) as { c: number };
    assert.equal(revealRows.c, 0, "Discovery ON: no legacy reveal dual-write");

    const tables = [
      "chat_character_secret_knowledge",
      "persona_secret_evidence_events",
      "chat_persona_secret_reveals",
    ] as const;
    const beforePrompt = Object.fromEntries(
      tables.map((t) => [t, countRows(t, `chat_id=${chatId}`)])
    ) as Record<(typeof tables)[number], number>;

    const promptA = promptForObserver({ chatId, personaId, characterId: charA });
    const promptB = promptForObserver({ chatId, personaId, characterId: charB });
    assert.match(promptA.knownFacts!, /CONFIRMED/);
    assert.match(promptA.knownFacts!, /017/);
    assert.equal(promptB.knownFacts, null, "B prompt must not receive A private facts");
    assertNoNeedles(promptA.assembled, [CANONICAL_SECRET], "S1 known observer");
    assertNoNeedles(promptB.assembled, [CANONICAL_SECRET], "S1 unknown observer canonical");

    for (const t of tables) {
      assert.equal(
        countRows(t, `chat_id=${chatId}`),
        beforePrompt[t],
        `${t} row count unchanged after prompt build`
      );
    }

    assert.equal(knowledge(chatId, personaId, charB, secret.id), null, "B remains UNKNOWN");
    assert.equal(
      getCharacterSecretKnowledge({
        chatId,
        personaId,
        secretId: secret.id,
        characterId: charB,
        db: getDb(),
      }),
      null,
      "B knowledge unchanged on fresh read"
    );

    const ensembleDecision = resolvePersonaKnowledgePromptDecisionForChat(
      buildGenerationKnowledgeContext({
        contentKind: "simulation",
        simulationCast: "A, B",
        characterId: charA,
      }),
      { chatId }
    );
    const ensembleBlock = withEnsembleRedactedPromptAssembly(() =>
      buildPersonaKnowledgePromptBlock({
        decision: ensembleDecision,
        chatId,
        personaId,
        authority: "discovery",
      })
    );
    assert.equal(ensembleBlock, null, "ensemble must not share private facts across observers");

    const kA2 = knowledge(chatId, personaId, charA, secret.id);
    assert.equal(kA2?.knowledge_state, "CONFIRMED");
  });

  it("Scenario 2 — S2 visual discovery without canonical input", () => {
    const { personaId, chatId, charA, charB } = uniqueIds();
    const compiled = compileAndApplyPersonaSecrets({
      personaId,
      source: "렌의 등에 실험체 시절 생긴 017 문신이 있다.\n\n017은 제7연구소 피험자 번호라는 의미다.",
    });
    assert.equal(compiled.ok, true);
    const secrets = listExistingPersonaSecrets(personaId).filter((s) => s.is_active === 1);
    const markSecret =
      secrets.find((s) => /017|표식|목덜미/.test(s.canonical_secret_text)) ?? secrets[0];
    assert.ok(markSecret);

    setupTwoCharacterChat({
      chatId,
      charA,
      charB,
      charBPresence: "ABSENT",
    });

    extractAndPersistSceneEvidence({
      chatId,
      characterId: charA,
      turnNumber: 1,
      sourceMessageId: 201,
      userMessage: "렌은 젖은 셔츠를 벗어 의자에 걸고 로코에게 등을 보였다.",
      publicPersonaId: personaId,
    });

    const result = runVisualDiscoveryForTurn({
      chatId,
      personaId,
      characterId: charA,
      turnNumber: 1,
      sourceMessageId: 201,
    });
    assert.ok(result.matchCount >= 1, "visual match expected");

    const kA = knowledge(chatId, personaId, charA, markSecret.id);
    assert.ok(kA);
    assert.ok(["SUSPECTED", "CONFIRMED"].includes(kA!.knowledge_state));
    assert.equal(knowledge(chatId, personaId, charB, markSecret.id), null);

    // Retry idempotency — no duplicate evidence
    const evidenceBefore = listSceneEvidenceEventsForChatTurn({
      chatId,
      turnNumber: 1,
    }).length;
    runVisualDiscoveryForTurn({
      chatId,
      personaId,
      characterId: charA,
      turnNumber: 1,
      sourceMessageId: 201,
    });
    const evidenceAfter = listSceneEvidenceEventsForChatTurn({
      chatId,
      turnNumber: 1,
    }).length;
    assert.equal(evidenceAfter, evidenceBefore);

    // Assistant prose alone does not create evidence/knowledge
    extractAndPersistSceneEvidence({
      chatId,
      characterId: charA,
      turnNumber: 2,
      sourceMessageId: 202,
      userMessage: "",
    });
    runVisualDiscoveryForTurn({
      chatId,
      personaId,
      characterId: charA,
      turnNumber: 2,
      sourceMessageId: 202,
    });
    assert.ok(kA);

    // Visual unavailable observer
    const { chatId: chat2, charA: charA2 } = uniqueIds();
    setupTwoCharacterChat({ chatId: chat2, charA: charA2, charB, charAVisual: "BLIND" });
    extractAndPersistSceneEvidence({
      chatId: chat2,
      characterId: charA2,
      turnNumber: 1,
      sourceMessageId: 301,
      userMessage: "렌은 젖은 셔츠를 벗어 의자에 걸고 로코에게 등을 보였다.",
      publicPersonaId: personaId,
    });
    runVisualDiscoveryForTurn({
      chatId: chat2,
      personaId,
      characterId: charA2,
      turnNumber: 1,
      sourceMessageId: 301,
    });
    assert.equal(knowledge(chat2, personaId, charA2, markSecret.id), null);

    const promptA = promptForObserver({ chatId, personaId, characterId: charA });
    assert.ok(promptA.knownFacts);
    assertNoNeedles(promptA.assembled, [CANONICAL_SECRET], "S2 prompt");
  });

  it("Scenario 3 — S3 investigation: document attribution + observer isolation (#680 baseline)", () => {
    const { personaId, chatId, otherChatId, charA, charB } = uniqueIds();
    compileAndApplyPersonaSecrets({
      personaId,
      source: "렌은 거액의 빚이 있다.",
    });
    const secrets = listExistingPersonaSecrets(personaId).filter((s) => s.is_active === 1);
    const debtSecret =
      secrets.find((s) => /빚|부채|채무/.test(s.canonical_secret_text)) ?? secrets[0];
    assert.ok(debtSecret);
    setupTwoCharacterChat({ chatId, charA, charB });

    assert.deepEqual(
      buildSecretBlindDocumentTargetPayload({ documentLabel: "독촉장" }).resultTags,
      ["debt_notice"],
      "plain document type must not imply debtor_identity_match"
    );
    assert.deepEqual(
      buildSecretBlindDocumentTargetPayload({
        documentLabel: "독촉장",
        documentSubject: "PERSONA_SELF",
      }).resultTags,
      ["debt_notice", "debtor_identity_match"]
    );

    registerPresentedDocumentTarget({
      chatId,
      documentLabel: "독촉장",
      payload: buildSecretBlindDocumentTargetPayload({ documentLabel: "독촉장" }),
    });

    const plainInv = runInvestigationDiscoveryForTurn({
      chatId,
      personaId,
      characterId: charA,
      turnNumber: 1,
      sourceMessageId: 401,
      explicitActions: [{ actionType: "READ_DOCUMENT", targetKey: "doc:독촉장" }],
    });
    assert.ok(plainInv.resultCount >= 1, "plain read produces investigation result");
    assert.equal(plainInv.changedCount, 0, "plain debt_notice alone must not CONFIRM debt secret");
    assert.equal(knowledge(chatId, personaId, charA, debtSecret.id), null);
    assert.equal(knowledge(chatId, personaId, charB, debtSecret.id), null);

    registerPresentedDocumentTarget({
      chatId,
      documentLabel: "독촉장",
      payload: buildSecretBlindDocumentTargetPayload({
        documentLabel: "독촉장",
        documentSubject: "PERSONA_SELF",
      }),
    });

    const selfInv = runInvestigationDiscoveryForTurn({
      chatId,
      personaId,
      characterId: charA,
      turnNumber: 2,
      sourceMessageId: 402,
      explicitActions: [{ actionType: "READ_DOCUMENT", targetKey: "doc:독촉장" }],
    });
    assert.ok(selfInv.changedCount >= 1, "self-attributed read may CONFIRM debt secret");
    assert.equal(
      knowledge(chatId, personaId, charA, debtSecret.id)?.knowledge_state,
      "CONFIRMED"
    );
    assert.equal(knowledge(chatId, personaId, charB, debtSecret.id), null);

    const crossChatInv = runInvestigationDiscoveryForTurn({
      chatId: otherChatId,
      personaId,
      characterId: charA,
      turnNumber: 1,
      sourceMessageId: 403,
      explicitActions: [{ actionType: "READ_DOCUMENT", targetKey: "doc:독촉장" }],
    });
    assert.equal(crossChatInv.resultCount, 0, "cross-chat target access must be 0");
    assert.equal(knowledge(otherChatId, personaId, charA, debtSecret.id), null);
  });

  it("Scenario 4 — S4 knowledge transfer with negative controls", () => {
    const { personaId, chatId, otherChatId, charA, charB } = uniqueIds();
    const secret = seedMainSecret(personaId);
    setupTwoCharacterChat({ chatId, charA, charB });

    upsertObserverSecretKnowledge({
      chatId,
      personaId,
      secretId: secret.id,
      observerType: "CHARACTER",
      observerId: String(charA),
      knowledgeState: "CONFIRMED",
      confidence: 100,
      factSnapshot: CONFIRMED_PROJECTION,
      confirmedTurn: 1,
      lastEvidenceEventId: "seed-s4",
    });

    const transferAction = {
      secretId: secret.id,
      sender: { observerType: "CHARACTER" as const, observerId: String(charA) },
      receiver: { observerType: "CHARACTER" as const, observerId: String(charB) },
      transferType: "DIRECT_STATEMENT" as const,
      sourceMessageId: 501,
    };

    const positive = runKnowledgeTransfersForTurn({
      chatId,
      personaId,
      characterId: charA,
      turnNumber: 2,
      userActions: [transferAction],
    });
    assert.equal(positive.changedCount, 1);
    assert.equal(
      getObserverSecretKnowledge({
        chatId,
        personaId,
        secretId: secret.id,
        observerType: "CHARACTER",
        observerId: String(charB),
      })?.knowledge_state,
      "CONFIRMED"
    );

    // Negative: SUSPECTED sender → receiver max SUSPECTED
    const { chatId: c2, charA: a2, charB: b2 } = uniqueIds();
    setupTwoCharacterChat({ chatId: c2, charA: a2, charB: b2 });
    upsertObserverSecretKnowledge({
      chatId: c2,
      personaId,
      secretId: secret.id,
      observerType: "CHARACTER",
      observerId: String(a2),
      knowledgeState: "SUSPECTED",
      confidence: 70,
      factSnapshot: SUSPECTED_PROJECTION,
      firstSuspectedTurn: 1,
      lastEvidenceEventId: "seed-s4-sus",
    });
    const susResult = applyKnowledgeTransferAction({
      chatId: c2,
      personaId,
      characterId: a2,
      turnNumber: 2,
      sourceType: "USER_EXPLICIT_TRANSFER",
      action: {
        secretId: secret.id,
        sender: { observerType: "CHARACTER", observerId: String(a2) },
        receiver: { observerType: "CHARACTER", observerId: String(b2) },
        transferType: "DIRECT_STATEMENT",
        sourceMessageId: 502,
      },
    });
    assert.equal(susResult.ok, true);
    if (susResult.ok) assert.equal(susResult.resultingState, "SUSPECTED");

    // Negative: UNKNOWN sender → rejected
    const { chatId: c3, charA: a3, charB: b3 } = uniqueIds();
    setupTwoCharacterChat({ chatId: c3, charA: a3, charB: b3 });
    const unknownResult = applyKnowledgeTransferAction({
      chatId: c3,
      personaId,
      characterId: a3,
      turnNumber: 2,
      sourceType: "USER_EXPLICIT_TRANSFER",
      action: {
        secretId: secret.id,
        sender: { observerType: "CHARACTER", observerId: String(a3) },
        receiver: { observerType: "CHARACTER", observerId: String(b3) },
        transferType: "DIRECT_STATEMENT",
        sourceMessageId: 503,
      },
    });
    assert.equal(unknownResult.ok, false);

    // Negative: receiver ABSENT
    const { chatId: c4, charA: a4, charB: b4 } = uniqueIds();
    setupTwoCharacterChat({ chatId: c4, charA: a4, charB: b4, charBPresence: "ABSENT" });
    upsertObserverSecretKnowledge({
      chatId: c4,
      personaId,
      secretId: secret.id,
      observerType: "CHARACTER",
      observerId: String(a4),
      knowledgeState: "CONFIRMED",
      confidence: 100,
      factSnapshot: CONFIRMED_PROJECTION,
      confirmedTurn: 1,
      lastEvidenceEventId: "seed-s4-abs",
    });
    const absentResult = applyKnowledgeTransferAction({
      chatId: c4,
      personaId,
      characterId: a4,
      turnNumber: 2,
      sourceType: "USER_EXPLICIT_TRANSFER",
      action: {
        secretId: secret.id,
        sender: { observerType: "CHARACTER", observerId: String(a4) },
        receiver: { observerType: "CHARACTER", observerId: String(b4) },
        transferType: "DIRECT_STATEMENT",
        sourceMessageId: 504,
      },
    });
    assert.equal(absentResult.ok, false);

    // Negative: other chat B
    assert.equal(
      getObserverSecretKnowledge({
        chatId: otherChatId,
        personaId,
        secretId: secret.id,
        observerType: "CHARACTER",
        observerId: String(charB),
      }),
      null
    );

    // Prose-only transfer attempt — no structured action → 0 writes
    const beforeEvidence = getDb()
      .prepare(
        `SELECT COUNT(*) AS c FROM persona_secret_evidence_events WHERE chat_id=? AND method='KNOWLEDGE_TRANSFER'`
      )
      .get(chatId) as { c: number };
    runKnowledgeTransfersForTurn({
      chatId,
      personaId,
      characterId: charA,
      turnNumber: 3,
      userActions: [],
    });
    const afterEvidence = getDb()
      .prepare(
        `SELECT COUNT(*) AS c FROM persona_secret_evidence_events WHERE chat_id=? AND method='KNOWLEDGE_TRANSFER'`
      )
      .get(chatId) as { c: number };
    assert.equal(afterEvidence.c, beforeEvidence.c);
  });

  it("Scenario H — persistence across fresh DB reads", () => {
    const { personaId, chatId, otherChatId, charA, charB } = uniqueIds();
    const secret = seedMainSecret(personaId);
    setupTwoCharacterChat({ chatId, charA, charB });
    confirmPersonaSecretDisclosure({
      chatId,
      personaId,
      secretId: secret.id,
      characterId: charA,
      turnNumber: 1,
      sourceType: "USER_MESSAGE_DETERMINISTIC",
      revealedFactText: CONFIRMED_PROJECTION,
      authority: "discovery",
      idempotencyKey: `persist-${chatId}-${secret.id}`,
    });

    const freshDb = getDb();
    const k = freshDb
      .prepare(
        `SELECT * FROM chat_character_secret_knowledge
         WHERE chat_id=? AND persona_id=? AND secret_id=? AND observer_id=?`
      )
      .get(chatId, personaId, secret.id, String(charA)) as {
      knowledge_state: string;
      fact_snapshot: string;
    };
    assert.equal(k.knowledge_state, "CONFIRMED");
    assert.equal(k.fact_snapshot, CONFIRMED_PROJECTION);
    assert.equal(
      getCharacterSecretKnowledge({
        chatId: otherChatId,
        personaId,
        secretId: secret.id,
        characterId: charA,
        db: freshDb,
      }),
      null
    );
    assert.equal(
      getCharacterSecretKnowledge({
        chatId,
        personaId,
        secretId: secret.id,
        characterId: charB,
        db: freshDb,
      }),
      null
    );
  });

  it("Scenario I — secret edit preserves existing observer fact_snapshot", () => {
    const { personaId, chatId, charA } = uniqueIds();
    const secret = seedMainSecret(personaId);
    setupTwoCharacterChat({ chatId, charA, charB: 29 });
    confirmPersonaSecretDisclosure({
      chatId,
      personaId,
      secretId: secret.id,
      characterId: charA,
      turnNumber: 1,
      sourceType: "USER_MESSAGE_DETERMINISTIC",
      revealedFactText: CONFIRMED_PROJECTION,
      authority: "discovery",
      idempotencyKey: `edit-${chatId}-${secret.id}`,
    });

    const updated = updatePersonaSecret({
      secretId: secret.id,
      personaId,
      canonicalSecretText: "렌은 실험체 017이 아니라 프로젝트 책임자였다.",
      confirmedFactText: "렌이 성채 프로젝트 책임자였다는 사실을 알고 있다.",
      suspectedFactText: "렌이 성채 프로젝트와 관련되어 있을 가능성을 의심하고 있다.",
    });
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.ok(updated.secret.revision >= 2);

    const k = knowledge(chatId, personaId, charA, secret.id);
    assert.equal(k?.knowledge_state, "CONFIRMED");
    assert.equal(k?.fact_snapshot, CONFIRMED_PROJECTION, "fact_snapshot preserved on edit");

    const block = buildCharacterKnownFactsBlock({ chatId, personaId, characterId: charA });
    assert.match(block!, /017/);
    assert.doesNotMatch(block!, /프로젝트 책임자/, "prompt uses stored snapshot not new canonical");
  });

  it("Scenario J — secret soft-delete preserves knowledge and prompt projection", () => {
    const { personaId, chatId, charA } = uniqueIds();
    const secret = seedMainSecret(personaId);
    setupTwoCharacterChat({ chatId, charA, charB: 29 });
    confirmPersonaSecretDisclosure({
      chatId,
      personaId,
      secretId: secret.id,
      characterId: charA,
      turnNumber: 1,
      sourceType: "USER_MESSAGE_DETERMINISTIC",
      revealedFactText: CONFIRMED_PROJECTION,
      authority: "discovery",
      idempotencyKey: `del-${chatId}-${secret.id}`,
    });

    assert.equal(deactivatePersonaSecret(personaId, secret.id), true);

    const k = knowledge(chatId, personaId, charA, secret.id);
    assert.ok(k, "knowledge row preserved after soft-delete");
    assert.equal(k!.fact_snapshot, CONFIRMED_PROJECTION);

    const evidenceCount = getDb()
      .prepare(
        `SELECT COUNT(*) AS c FROM persona_secret_evidence_events WHERE secret_id=?`
      )
      .get(secret.id) as { c: number };
    assert.ok(evidenceCount.c >= 1, "evidence history preserved");

    const block = buildCharacterKnownFactsBlock({ chatId, personaId, characterId: charA });
    assert.ok(block, "prompt still projects historical fact_snapshot after delete");
    assert.match(block!, /017/);
  });

  it("Scenario K — compiler path: canonical split, visual/investigation clues isolated", () => {
    const { personaId, chatId, charA } = uniqueIds();
    const compiled = compileAndApplyPersonaSecrets({
      personaId,
      source: `${CANONICAL_SECRET}\n\n${VISUAL_CLUE}\n\n${INVESTIGATION_CLUE}`,
    });
    assert.equal(compiled.ok, true);
    const secrets = listExistingPersonaSecrets(personaId).filter((s) => s.is_active === 1);
    assert.ok(secrets.length >= 1);
    setupTwoCharacterChat({ chatId, charA, charB: 29 });

    const prompt = promptForObserver({ chatId, personaId, characterId: charA });
    assert.equal(prompt.knownFacts, null);
    assertNoNeedles(
      prompt.assembled,
      secrets.map((s) => s.canonical_secret_text),
      "compiler pre-discovery"
    );
  });

  it("Invariant — legacy archive: Discovery ON skips reveal runtime authority", () => {
    const { personaId, chatId, charA } = uniqueIds();
    const secret = seedMainSecret(personaId);
    setupTwoCharacterChat({ chatId, charA, charB: 29 });

    insertChatPersonaSecretReveal({
      chatId,
      personaId,
      secretKey: secret.secretKey,
      revealedFactText: CONFIRMED_PROJECTION,
      revealedAtTurn: 1,
      source: "USER_AUTHORED_DISCLOSURE",
    });

    const tables = [
      "chat_character_secret_knowledge",
      "persona_secret_evidence_events",
    ] as const;
    const before = Object.fromEntries(
      tables.map((t) => [t, countRows(t, `chat_id=${chatId}`)])
    ) as Record<(typeof tables)[number], number>;

    const decision = resolvePersonaKnowledgePromptDecisionForChat(
      buildGenerationKnowledgeContext({ contentKind: "character", characterId: charA }),
      { chatId }
    );
    const block = buildPersonaKnowledgePromptBlock({
      decision,
      chatId,
      personaId,
      authority: "discovery",
    });
    assert.equal(block, null, "Discovery ON: legacy reveal must not project into prompt");

    for (const t of tables) {
      assert.equal(
        countRows(t, `chat_id=${chatId}`),
        before[t],
        `${t} unchanged — no auto legacy migration under discovery authority`
      );
    }
    assert.equal(knowledge(chatId, personaId, charA, secret.id), null);
  });

  it("Invariant — legacy archive: Discovery OFF preserves legacy projection", () => {
    const saved = saveEnv();
    process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "0";
    try {
      const { personaId, chatId, charA } = uniqueIds();
      const secret = seedMainSecret(personaId);

      insertChatPersonaSecretReveal({
        chatId,
        personaId,
        secretKey: secret.secretKey,
        revealedFactText: CONFIRMED_PROJECTION,
        revealedAtTurn: 1,
        source: "USER_AUTHORED_DISCLOSURE",
      });

      const block = buildCharacterKnownFactsBlock({
        chatId,
        personaId,
        characterId: charA,
        authority: "legacy",
      });
      assert.ok(block, "Discovery OFF: legacy authority may project archived reveals");
      assert.match(block!, /017/);
      assertNoNeedles(block!, [CANONICAL_SECRET], "legacy projection uses fact snapshot only");
    } finally {
      restoreEnv(saved);
    }
  });

  it("Scenario L — /api/chat route wiring static audit", () => {
    const route = readFileSync("src/app/api/chat/route.ts", "utf8");
    const checks: Array<[string, RegExp]> = [
      ["S1 detect", /detectDeterministicDirectDisclosures\s*\(/],
      ["S1 confirm", /confirmPersonaSecretDisclosure\s*\(/],
      ["S2/S3 home turn", /runHomeDiscoveryTurn\s*\(/],
      ["S2 evidence fallback", /extractAndPersistSceneEvidence\s*\(/],
      ["S4 transfer", /runKnowledgeTransfersForTurn\s*\(/],
      ["observer bootstrap", /bootstrapChatObservers\s*\(/],
      ["prompt decision", /resolvePersonaKnowledgePromptDecisionForChat\s*\(/],
      ["prompt block", /buildPersonaKnowledgePromptBlock\s*\(/],
      ["discovery gate", /discoveryWritesAllowed/],
      ["same-turn rebuild", /updatedKnownFacts !== revealedPersonaFactsBlock/],
    ];
    for (const [label, re] of checks) {
      assert.match(route, re, `${label} must be wired in chat route`);
    }
    const codeLines = route
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"));
    const codeBody = codeLines.join("\n");
    assert.doesNotMatch(
      codeBody,
      /body\.investigationOutcomes|body\.knowledgeTransferAuthoritativeActions/,
      "authoritative outcomes must not be read from public body"
    );
  });
});
