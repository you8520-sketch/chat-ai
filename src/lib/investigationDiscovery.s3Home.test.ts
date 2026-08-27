/**
 * PR-S3 home path — USER-authored DOCUMENT_PRESENTED → chat target → investigation → knowledge.
 * Uses runHomeDiscoveryTurn (same ordering as POST /api/chat discovery slice).
 */
import Module from "module";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { buildSecretBlindDocumentTargetPayload } from "@/lib/investigationDocumentTargetPayload";
import {
  findInvestigationTarget,
  parseTargetPayload,
  registerPresentedDocumentTarget,
} from "@/lib/investigationTargets";
import { ensureInvestigationSchema } from "@/lib/investigationSchema";
import { compileAndApplyPersonaSecrets } from "@/lib/personaSecretCompiler";
import { listExistingPersonaSecrets } from "@/lib/personaSecretCompilerApply";
import { extractPublicChatDiscoveryInputs } from "@/lib/personaSecretDiscoveryPublicInput";
import { getCharacterSecretKnowledge } from "@/lib/personaSecretKnowledge";
import { registerInvestigationTargetsFromPresentedDocuments } from "@/lib/investigationTargetFromSceneEvidence";
import { runHomeDiscoveryTurn } from "@/lib/personaSecretDiscoveryHomeTurn";
import { ensureSceneEvidenceSchema } from "@/lib/sceneEvidenceSchema";
import type { SceneEvidenceEvent } from "@/lib/sceneEvidenceTypes";
import { SCENE_EVIDENCE_EXTRACTOR_VERSION } from "@/lib/sceneEvidenceTypes";

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
    personaId: 860000 + n,
    chatId: 870000 + n,
    chat2: 871000 + n,
    characterId: 17,
    otherCharacterId: 99,
  };
}

function debtSecretId(personaId: number): string {
  const secrets = listExistingPersonaSecrets(personaId).filter((s) =>
    /빚|부채|채무/.test(s.canonical_secret_text)
  );
  assert.ok(secrets.length >= 1);
  return secrets[0]!.id;
}

function knowledgeOf(
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

/** Simulates extractPublicChatDiscoveryInputs + home discovery turn (no manual target upsert). */
function runHomeChatDiscoveryTurn(opts: {
  chatId: number;
  personaId: number;
  characterId: number;
  turnNumber: number;
  sourceMessageId: number;
  userMessage: string;
  body?: Record<string, unknown>;
}) {
  const publicIn = extractPublicChatDiscoveryInputs(opts.body ?? {});
  return runHomeDiscoveryTurn({
    chatId: opts.chatId,
    characterId: opts.characterId,
    personaId: opts.personaId,
    turnNumber: opts.turnNumber,
    sourceMessageId: opts.sourceMessageId,
    userMessage: opts.userMessage,
    explicitSceneActions: publicIn.sceneActions,
    investigationActions: publicIn.investigationActions,
  });
}

function targetPayloadTags(chatId: number, targetKey: string): string[] {
  const target = findInvestigationTarget({
    ownerScope: "CHAT",
    ownerId: String(chatId),
    targetKey,
  });
  if (!target) return [];
  return parseTargetPayload(target).resultTags ?? [];
}

function makeDocumentPresentedEvent(opts: {
  chatId: number;
  sourceType: SceneEvidenceEvent["sourceType"];
  documentLabel?: string;
  documentSubject?: "PERSONA_SELF";
}): SceneEvidenceEvent {
  return {
    id: "fixture-event",
    idempotencyKey: "fixture-key",
    chatId: opts.chatId,
    turnNumber: 1,
    eventType: "DOCUMENT_PRESENTED",
    subjectType: "USER",
    subjectId: "persona-user",
    actorType: "USER",
    actorId: "persona-user",
    sourceType: opts.sourceType,
    confidence: 95,
    attributes: {
      documentLabel: opts.documentLabel ?? "독촉장",
      ...(opts.documentSubject ? { documentSubject: opts.documentSubject } : {}),
    },
    visibility: { mode: "CURRENT_CHARACTER", requiresLineOfSight: true },
    extractorVersion: SCENE_EVIDENCE_EXTRACTOR_VERSION,
  };
}

describe("PR-S3 home live investigation path", () => {
  let env: Record<string, string | undefined>;
  beforeEach(() => {
    env = saveEnv();
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "1";
    ensureInvestigationSchema(getDb());
    ensureSceneEvidenceSchema(getDb());
  });
  afterEach(() => restoreEnv(env));

  it("target bridge module stays secret-blind", () => {
    const dir = path.join(process.cwd(), "src", "lib");
    const files = [
      "investigationTargetFromSceneEvidence.ts",
      "investigationDocumentTargetPayload.ts",
      "personaSecretDiscoveryHomeTurn.ts",
    ];
    const forbiddenImport =
      /from\s+["']@\/lib\/personaSecret(?!BoundaryPolicy)|require\(["']@\/lib\/personaSecret(?!BoundaryPolicy)/;
    for (const f of files) {
      const src = readFileSync(path.join(dir, f), "utf8");
      assert.equal(forbiddenImport.test(src), false, `${f} must not import persona secret modules`);
    }
  });

  it("payload: document type alone must not emit debtor_identity_match", () => {
    const plain = buildSecretBlindDocumentTargetPayload({ documentLabel: "독촉장" });
    assert.deepEqual(plain.resultTags, ["debt_notice"]);
    const selfOwned = buildSecretBlindDocumentTargetPayload({
      documentLabel: "독촉장",
      documentSubject: "PERSONA_SELF",
    });
    assert.deepEqual(selfOwned.resultTags, ["debt_notice", "debtor_identity_match"]);
  });

  it("A. plain 독촉장 → target + read → no identity match → debt NOT CONFIRMED", () => {
    const { personaId, chatId, characterId } = uniqueIds();
    compileAndApplyPersonaSecrets({
      personaId,
      source: "렌은 거액의 빚이 있다.",
    });
    const secretId = debtSecretId(personaId);

    runHomeChatDiscoveryTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 101,
      userMessage: "렌은 독촉장을 꺼내 건넸다.",
    });
    assert.deepEqual(targetPayloadTags(chatId, "doc:독촉장"), ["debt_notice"]);

    const inv = runHomeChatDiscoveryTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 2,
      sourceMessageId: 102,
      userMessage: "독촉장 내용을 확인한다.",
      body: {
        investigationActions: [
          { actionType: "READ_DOCUMENT", targetKey: "doc:독촉장" },
        ],
      },
    });
    assert.ok(inv.investigation.resultCount >= 1);
    assert.equal(knowledgeOf(chatId, personaId, characterId, secretId), null);
  });

  it("B. self-owned 독촉장 → target + read → identity match → debt CONFIRMED", () => {
    const { personaId, chatId, characterId } = uniqueIds();
    compileAndApplyPersonaSecrets({
      personaId,
      source: "렌은 거액의 빚이 있다.",
    });
    const secretId = debtSecretId(personaId);

    runHomeChatDiscoveryTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 201,
      userMessage: "렌은 내 앞으로 온 독촉장을 꺼내 건넸다.",
    });
    assert.deepEqual(targetPayloadTags(chatId, "doc:독촉장"), [
      "debt_notice",
      "debtor_identity_match",
    ]);

    const inv = runHomeChatDiscoveryTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 2,
      sourceMessageId: 202,
      userMessage: "독촉장 내용을 확인한다.",
      body: {
        investigationActions: [
          { actionType: "READ_DOCUMENT", targetKey: "doc:독촉장" },
        ],
      },
    });
    assert.ok(inv.investigation.changedCount >= 1);
    assert.equal(
      knowledgeOf(chatId, personaId, characterId, secretId)?.knowledge_state,
      "CONFIRMED"
    );
  });

  it("C. pure prose two-turn — no investigationActions → S3 CONFIRMED", () => {
    const { personaId, chatId, characterId } = uniqueIds();
    compileAndApplyPersonaSecrets({
      personaId,
      source: "렌은 거액의 빚이 있다.",
    });
    const secretId = debtSecretId(personaId);

    runHomeChatDiscoveryTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 301,
      userMessage: "내 앞으로 온 독촉장을 꺼내 건넸다.",
    });

    const inv = runHomeChatDiscoveryTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 2,
      sourceMessageId: 302,
      userMessage: "독촉장 내용을 확인해 봐.",
    });
    assert.ok(inv.investigation.changedCount >= 1);
    assert.equal(
      knowledgeOf(chatId, personaId, characterId, secretId)?.knowledge_state,
      "CONFIRMED"
    );
  });

  it("C'. same-turn pure prose — presentation + investigation without body actions", () => {
    const { personaId, chatId, characterId } = uniqueIds();
    compileAndApplyPersonaSecrets({
      personaId,
      source: "렌은 거액의 빚이 있다.",
    });
    const secretId = debtSecretId(personaId);

    const turn = runHomeChatDiscoveryTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 311,
      userMessage:
        "내 앞으로 온 독촉장을 꺼내 건네며 독촉장 내용을 확인해 보라고 했다.",
    });
    assert.ok(turn.documentTargets.registered >= 1);
    assert.ok(turn.investigation.changedCount >= 1);
    assert.equal(
      knowledgeOf(chatId, personaId, characterId, secretId)?.knowledge_state,
      "CONFIRMED"
    );
  });

  it("D. SERVER_SCENE_EVENT DOCUMENT_PRESENTED → registered=0, target=0", () => {
    const { personaId, chatId } = uniqueIds();
    compileAndApplyPersonaSecrets({ personaId, source: "렌은 거액의 빚이 있다." });

    const reg = registerInvestigationTargetsFromPresentedDocuments({
      chatId,
      events: [
        makeDocumentPresentedEvent({
          chatId,
          sourceType: "SERVER_SCENE_EVENT",
        }),
      ],
    });
    assert.equal(reg.registered, 0);
    assert.equal(
      findInvestigationTarget({
        ownerScope: "CHAT",
        ownerId: String(chatId),
        targetKey: "doc:독촉장",
      }),
      null
    );
  });

  it("E. USER_MESSAGE_DETERMINISTIC DOCUMENT_PRESENTED → target=1", () => {
    const { personaId, chatId } = uniqueIds();
    compileAndApplyPersonaSecrets({ personaId, source: "렌은 거액의 빚이 있다." });

    const reg = registerInvestigationTargetsFromPresentedDocuments({
      chatId,
      events: [
        makeDocumentPresentedEvent({
          chatId,
          sourceType: "USER_MESSAGE_DETERMINISTIC",
        }),
      ],
    });
    assert.equal(reg.registered, 1);
    assert.ok(
      findInvestigationTarget({
        ownerScope: "CHAT",
        ownerId: String(chatId),
        targetKey: "doc:독촉장",
      })
    );
  });

  it("F. unrelated document presentation → investigation 0 for debt secret", () => {
    const { personaId, chatId, characterId } = uniqueIds();
    compileAndApplyPersonaSecrets({
      personaId,
      source: "렌은 거액의 빚이 있다.",
    });

    runHomeChatDiscoveryTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 401,
      userMessage: "렌은 진단서를 꺼내 건넸다.",
    });

    const inv = runHomeChatDiscoveryTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 2,
      sourceMessageId: 402,
      userMessage: "진단서를 읽는다.",
      body: {
        investigationActions: [
          { actionType: "READ_DOCUMENT", targetKey: "doc:진단서" },
        ],
      },
    });
    assert.equal(inv.investigation.changedCount, 0);
    assert.equal(knowledgeOf(chatId, personaId, characterId, debtSecretId(personaId)), null);
  });

  it("G. duplicate presentation is idempotent (one target row)", () => {
    const { personaId, chatId, characterId } = uniqueIds();
    compileAndApplyPersonaSecrets({ personaId, source: "렌은 거액의 빚이 있다." });

    const msg = "렌은 독촉장을 꺼내 테이블에 놓았다.";
    runHomeChatDiscoveryTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 501,
      userMessage: msg,
    });
    runHomeChatDiscoveryTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 2,
      sourceMessageId: 502,
      userMessage: msg,
    });

    const count = getDb()
      .prepare(
        `SELECT COUNT(*) AS c FROM investigation_targets
         WHERE owner_scope='CHAT' AND owner_id=? AND target_key='doc:독촉장'`
      )
      .get(String(chatId)) as { c: number };
    assert.equal(count.c, 1);
  });

  it("H. cross-chat isolation — target in chat A invisible to chat B", () => {
    const { personaId, chatId, chat2, characterId } = uniqueIds();
    compileAndApplyPersonaSecrets({ personaId, source: "렌은 거액의 빚이 있다." });

    runHomeChatDiscoveryTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 601,
      userMessage: "내 앞으로 온 독촉장을 꺼내 건넸다.",
    });

    const invB = runHomeChatDiscoveryTurn({
      chatId: chat2,
      personaId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 602,
      userMessage: "독촉장을 읽는다.",
      body: {
        investigationActions: [
          { actionType: "READ_DOCUMENT", targetKey: "doc:독촉장" },
        ],
      },
    });
    assert.equal(invB.investigation.resultCount, 0);
    assert.equal(knowledgeOf(chat2, personaId, characterId, debtSecretId(personaId)), null);
  });

  it("I. observer isolation — investigating character only receives knowledge", () => {
    const { personaId, chatId, characterId, otherCharacterId } = uniqueIds();
    compileAndApplyPersonaSecrets({ personaId, source: "렌은 거액의 빚이 있다." });
    const secretId = debtSecretId(personaId);

    runHomeChatDiscoveryTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 701,
      userMessage: "내 앞으로 온 독촉장을 꺼내 건넸다.",
    });
    runHomeChatDiscoveryTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 2,
      sourceMessageId: 702,
      userMessage: "독촉장을 읽는다.",
      body: {
        investigationActions: [
          { actionType: "READ_DOCUMENT", targetKey: "doc:독촉장" },
        ],
      },
    });

    assert.equal(
      knowledgeOf(chatId, personaId, characterId, secretId)?.knowledge_state,
      "CONFIRMED"
    );
    assert.equal(knowledgeOf(chatId, personaId, otherCharacterId, secretId), null);
  });

  it("J. wrong action type on document target → rejected / result 0", () => {
    const { personaId, chatId, characterId } = uniqueIds();
    compileAndApplyPersonaSecrets({ personaId, source: "렌은 거액의 빚이 있다." });

    runHomeChatDiscoveryTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 801,
      userMessage: "렌은 독촉장을 꺼내 건넸다.",
    });

    const inv = runHomeChatDiscoveryTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 2,
      sourceMessageId: 802,
      userMessage: "의료 검사를 받는다.",
      body: {
        investigationActions: [
          { actionType: "RUN_MEDICAL_EXAM", targetKey: "doc:독촉장" },
        ],
      },
    });
    assert.equal(inv.investigation.resultCount, 0);
    assert.equal(knowledgeOf(chatId, personaId, characterId, debtSecretId(personaId)), null);
  });

  it("registerPresentedDocumentTarget keeps document action access contract", () => {
    const { chatId } = uniqueIds();
    const row = registerPresentedDocumentTarget({
      chatId,
      documentLabel: "독촉장",
      payload: buildSecretBlindDocumentTargetPayload({ documentLabel: "독촉장" }),
    });
    const payload = parseTargetPayload(row);
    assert.equal(payload.requiredAccess?.requiresPresentedDocument, true);
    assert.deepEqual(payload.requiredAccess?.allowedActions, [
      "READ_DOCUMENT",
      "VERIFY_DOCUMENT",
    ]);
  });

  it("route.ts references runHomeDiscoveryTurn (home wiring)", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src", "app", "api", "chat", "route.ts"),
      "utf8"
    );
    assert.match(src, /runHomeDiscoveryTurn\(/);
    assert.doesNotMatch(src, /registerPresentedDocumentTarget\(/);
  });
});
