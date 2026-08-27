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
import { findInvestigationTarget } from "@/lib/investigationTargets";
import { ensureInvestigationSchema } from "@/lib/investigationSchema";
import { compileAndApplyPersonaSecrets } from "@/lib/personaSecretCompiler";
import { listExistingPersonaSecrets } from "@/lib/personaSecretCompilerApply";
import { extractPublicChatDiscoveryInputs } from "@/lib/personaSecretDiscoveryPublicInput";
import { getCharacterSecretKnowledge } from "@/lib/personaSecretKnowledge";
import { registerInvestigationTargetsFromPresentedDocuments } from "@/lib/investigationTargetFromSceneEvidence";
import { runHomeDiscoveryTurn } from "@/lib/personaSecretDiscoveryHomeTurn";
import { ensureSceneEvidenceSchema } from "@/lib/sceneEvidenceSchema";
import { extractAndPersistSceneEvidence } from "@/lib/sceneEvidence";

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

  it("A. user presents document → target created → same-turn read → debt CONFIRMED", () => {
    const { personaId, chatId, characterId } = uniqueIds();
    compileAndApplyPersonaSecrets({
      personaId,
      source: "렌은 거액의 빚이 있다.",
    });

    const turn = runHomeChatDiscoveryTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 101,
      userMessage: "렌은 구겨진 독촉장을 꺼내 테이블 위에 놓았다.",
      body: {
        investigationActions: [
          { actionType: "READ_DOCUMENT", targetKey: "doc:독촉장" },
        ],
      },
    });

    assert.ok(turn.documentTargets.registered >= 1);
    assert.ok(
      turn.sceneEvidence.inserted.some((e) => e.eventType === "DOCUMENT_PRESENTED")
    );
    const target = findInvestigationTarget({
      ownerScope: "CHAT",
      ownerId: String(chatId),
      targetKey: "doc:독촉장",
    });
    assert.ok(target, "chat-scoped target must exist after presentation");
    assert.ok(turn.investigation.changedCount >= 1);

    const secretId = debtSecretId(personaId);
    assert.equal(
      knowledgeOf(chatId, personaId, characterId, secretId)?.knowledge_state,
      "CONFIRMED"
    );
  });

  it("B. presentation turn 1 → investigation turn 2 → S3 discovery", () => {
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
      sourceMessageId: 201,
      userMessage: "렌은 독촉장을 꺼내 건넸다.",
    });

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
      knowledgeOf(chatId, personaId, characterId, debtSecretId(personaId))
        ?.knowledge_state,
      "CONFIRMED"
    );
  });

  it("C. assistant-style prose without user presentation does not create trusted target", () => {
    const { personaId, chatId, characterId } = uniqueIds();
    compileAndApplyPersonaSecrets({
      personaId,
      source: "렌은 거액의 빚이 있다.",
    });

    const scene = extractAndPersistSceneEvidence({
      chatId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 301,
      userMessage: "책상 위에 파일이 있었다.",
      publicPersonaId: personaId,
    });
    const reg = registerInvestigationTargetsFromPresentedDocuments({
      chatId,
      events: [...scene.inserted, ...scene.reused],
    });
    assert.equal(reg.registered, 0);
    assert.equal(
      findInvestigationTarget({
        ownerScope: "CHAT",
        ownerId: String(chatId),
        targetKey: "doc:파일",
      }),
      null
    );
  });

  it("D. unrelated document presentation → investigation 0 for debt secret", () => {
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

  it("E. duplicate presentation is idempotent (one target row)", () => {
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

  it("F. cross-chat isolation — target in chat A invisible to chat B", () => {
    const { personaId, chatId, chat2, characterId } = uniqueIds();
    compileAndApplyPersonaSecrets({ personaId, source: "렌은 거액의 빚이 있다." });

    runHomeChatDiscoveryTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 601,
      userMessage: "렌은 독촉장을 꺼내 건넸다.",
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

  it("G. observer isolation — investigating character only receives knowledge", () => {
    const { personaId, chatId, characterId, otherCharacterId } = uniqueIds();
    compileAndApplyPersonaSecrets({ personaId, source: "렌은 거액의 빚이 있다." });
    const secretId = debtSecretId(personaId);

    runHomeChatDiscoveryTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 701,
      userMessage: "렌은 독촉장을 꺼내 건넸다.",
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

  it("route.ts references runHomeDiscoveryTurn (home wiring)", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src", "app", "api", "chat", "route.ts"),
      "utf8"
    );
    assert.match(src, /runHomeDiscoveryTurn\(/);
    assert.doesNotMatch(src, /registerPresentedDocumentTarget\(/);
  });
});
