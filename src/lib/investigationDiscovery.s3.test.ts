import Module from "module";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  buildInvestigationAttemptIdempotencyKey,
  buildInvestigationDiscoveryIdempotencyKey,
  buildInvestigationResultIdempotencyKey,
} from "@/lib/investigationAttemptIdempotency";
import {
  parseInvestigationExplicitActions,
  runInvestigationDiscoveryForTurn,
} from "@/lib/investigationDiscovery";
import { listEligibleInvestigationDiscoveryRules } from "@/lib/investigationEligibility";
import { matchInvestigationDiscoveryRule } from "@/lib/investigationMatcher";
import { resolveInvestigationTurn } from "@/lib/investigationResolver";
import { ensureInvestigationSchema } from "@/lib/investigationSchema";
import { upsertInvestigationTarget } from "@/lib/investigationTargets";
import { compileAndApplyPersonaSecrets } from "@/lib/personaSecretCompiler";
import { listExistingPersonaSecrets } from "@/lib/personaSecretCompilerApply";
import {
  buildCharacterKnownFactsBlock,
  getCharacterSecretKnowledge,
} from "@/lib/personaSecretKnowledge";
import { extractAndPersistSceneEvidence } from "@/lib/sceneEvidence";
import { runVisualDiscoveryForTurn } from "@/lib/visualDiscovery";

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
    personaId: 950000 + n,
    chatId: 960000 + n,
    characterId: 17,
  };
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

describe("PR-S3 investigation discovery", () => {
  let env: Record<string, string | undefined>;
  beforeEach(() => {
    env = saveEnv();
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "1";    process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "1";
    ensureInvestigationSchema(getDb());
  });
  afterEach(() => restoreEnv(env));

  describe("S3A secret-blind invariant", () => {
    it("resolver/request/target/persist modules do not import persona secret storage", () => {
      const dir = path.join(process.cwd(), "src", "lib");
      const files = readdirSync(dir).filter(
        (f) =>
          /^investigation(Resolver|Requests|Targets|Persist|Schema|Catalog|AttemptIdempotency|Types)\.ts$/.test(
            f
          )
      );
      assert.ok(files.length >= 6);
      const forbiddenImport =
        /from\s+["']@\/lib\/personaSecret|require\(["']@\/lib\/personaSecret/;
      for (const f of files) {
        const src = readFileSync(path.join(dir, f), "utf8");
        assert.equal(
          forbiddenImport.test(src),
          false,
          `${f} must not import persona secret modules`
        );
      }
    });
  });

  describe("S3A secret-blind resolver", () => {
    it("request without concrete target → REJECTED, no result", () => {
      const { chatId, characterId } = uniqueIds();
      const r = resolveInvestigationTurn({
        chatId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 1,
        explicitActions: [
          { actionType: "READ_DOCUMENT", targetKey: "doc:독촉장" },
        ],
      });
      assert.equal(r.resultCount, 0);
      assert.ok(r.rejectedCount >= 1);
      const attempts = getDb()
        .prepare(
          `SELECT status, failure_code FROM investigation_attempts WHERE chat_id=?`
        )
        .all(chatId) as Array<{ status: string; failure_code: string }>;
      assert.ok(attempts.some((a) => a.failure_code === "TARGET_NOT_FOUND"));
    });

    it("does not invent targets from secrets existing for persona", () => {
      const { personaId, chatId, characterId } = uniqueIds();
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌은 거액의 빚이 있다.",
      });
      const r = resolveInvestigationTurn({
        chatId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 2,
        personaId,
        userMessage: "렌의 금융 기록을 조회한다.",
      });
      assert.equal(r.resultCount, 0);
    });

    it("succeeds only when target exists with payload", () => {
      const { chatId, characterId } = uniqueIds();
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
          observableFacts: ["채무 금액과 채무자 이름이 기재되어 있다."],
          requiredAccess: { allowedActions: ["READ_DOCUMENT"] },
        },
      });
      const r = resolveInvestigationTurn({
        chatId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 3,
        explicitActions: [
          { actionType: "READ_DOCUMENT", targetKey: "doc:독촉장" },
        ],
      });
      assert.equal(r.resultCount, 1);
      assert.equal(r.results[0].result_type, "DOCUMENT_CONTENT_VERIFIED");
    });

    it("rejects user-smuggled result payloads in explicit actions", () => {
      const parsed = parseInvestigationExplicitActions([
        {
          actionType: "READ_DOCUMENT",
          targetKey: "doc:x",
          resultType: "DEBT_RECORD_CONFIRMED",
          secret_description: "leak",
        },
      ]);
      assert.equal(parsed.length, 0);
    });

    it("assistant prose is never a source — empty candidates from blank", () => {
      const { chatId, characterId } = uniqueIds();
      const r = resolveInvestigationTurn({
        chatId,
        characterId,
        turnNumber: 1,
        userMessage: "",
      });
      assert.equal(r.attemptCount, 0);
    });
  });

  describe("debt atomic path", () => {
    it("document presented only (visual) does not CONFIRM debt via investigation", () => {
      const { personaId, chatId, characterId } = uniqueIds();
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌은 거액의 빚이 있다.",
      });
      extractAndPersistSceneEvidence({
        chatId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 10,
        userMessage: "렌은 구겨진 봉투를 탁자 위에 올려놓았다.",
        publicPersonaId: personaId,
      });
      runVisualDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 10,
      });
      const inv = runInvestigationDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 10,
        userMessage: "렌은 구겨진 봉투를 탁자 위에 올려놓았다.",
      });
      assert.equal(inv.resultCount, 0);
      const secrets = listExistingPersonaSecrets(personaId).filter((s) => s.is_active);
      for (const s of secrets) {
        assert.equal(knowledgeOf(chatId, personaId, characterId, s.id), null);
      }
    });

    it("DOCUMENT_CONTENT_VERIFIED with debt tags → debt CONFIRMED", () => {
      const { personaId, chatId, characterId } = uniqueIds();
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌은 거액의 빚이 있다.",
      });
      upsertInvestigationTarget({
        ownerScope: "CHAT",
        ownerId: String(chatId),
        targetType: "DOCUMENT",
        targetKey: "doc:독촉장",
        payload: {
          resultType: "DOCUMENT_CONTENT_VERIFIED",
          resultState: "VERIFIED",
          resultTags: ["debt_notice", "debtor_identity_match"],
          observableFacts: ["독촉장에 채무자 이름과 금액이 있다."],
          requiredAccess: { allowedActions: ["READ_DOCUMENT"] },
        },
      });
      const inv = runInvestigationDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 2,
        sourceMessageId: 11,
        explicitActions: [
          { actionType: "READ_DOCUMENT", targetKey: "doc:독촉장" },
        ],
      });
      assert.ok(inv.changedCount >= 1);
      const secrets = listExistingPersonaSecrets(personaId).filter((s) =>
        /빚|부채|채무/.test(s.canonical_secret_text)
      );
      assert.ok(secrets.length >= 1);
      const k = knowledgeOf(chatId, personaId, characterId, secrets[0].id);
      assert.equal(k?.knowledge_state, "CONFIRMED");
    });

    it("DEBT_RECORD_CONFIRMED → debt CONFIRMED", () => {
      const { personaId, chatId, characterId } = uniqueIds();
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌은 거액의 빚이 있다.",
      });
      upsertInvestigationTarget({
        ownerScope: "CHAT",
        ownerId: String(chatId),
        targetType: "FINANCIAL_RECORD",
        targetKey: "financial_record",
        payload: {
          resultType: "DEBT_RECORD_CONFIRMED",
          resultState: "VERIFIED",
          resultTags: ["debtor_identity_match"],
          observableFacts: ["공식 원장에 채무가 확인된다."],
          requiredAccess: { allowedActions: ["CHECK_FINANCIAL_RECORDS"] },
        },
      });
      const inv = runInvestigationDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 3,
        sourceMessageId: 12,
        explicitActions: [
          {
            actionType: "CHECK_FINANCIAL_RECORDS",
            targetKey: "financial_record",
          },
        ],
      });
      assert.ok(inv.changedCount >= 1);
      const secrets = listExistingPersonaSecrets(personaId).filter((s) =>
        /빚|부채|채무/.test(s.canonical_secret_text)
      );
      assert.equal(
        knowledgeOf(chatId, personaId, characterId, secrets[0].id)?.knowledge_state,
        "CONFIRMED"
      );
    });
  });

  describe("identity atomic boundaries", () => {
    it("IDENTITY_RECORD_MISMATCH forged does not unlock otherworld origin", () => {
      const { personaId, chatId, characterId } = uniqueIds();
      compileAndApplyPersonaSecrets({
        personaId,
        source:
          "렌의 현재 신분은 위조됐다.\n\n렌은 다른 세계에서 왔다.",
      });
      upsertInvestigationTarget({
        ownerScope: "CHAT",
        ownerId: String(chatId),
        targetType: "IDENTITY_RECORD",
        targetKey: "identity_record",
        payload: {
          resultType: "IDENTITY_RECORD_MISMATCH",
          resultState: "PARTIAL",
          resultTags: ["identity_forged"],
          observableFacts: ["신분 정보와 공식 기록이 일치하지 않는다."],
          requiredAccess: { allowedActions: ["VERIFY_IDENTITY"] },
        },
      });
      runInvestigationDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 20,
        explicitActions: [
          { actionType: "VERIFY_IDENTITY", targetKey: "identity_record" },
        ],
      });
      const secrets = listExistingPersonaSecrets(personaId).filter((s) => s.is_active);
      const forged = secrets.find((s) => /위조/.test(s.canonical_secret_text));
      const origin = secrets.find((s) => /다른\s*세계/.test(s.canonical_secret_text));
      assert.ok(forged);
      assert.ok(origin);
      assert.ok(
        knowledgeOf(chatId, personaId, characterId, forged!.id)?.knowledge_state
      );
      assert.equal(
        knowledgeOf(chatId, personaId, characterId, origin!.id),
        null
      );
    });

    it("no_birth_record → origin SUSPECTED only, not CONFIRMED", () => {
      const { personaId, chatId, characterId } = uniqueIds();
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌은 다른 세계에서 왔다.",
      });
      upsertInvestigationTarget({
        ownerScope: "CHAT",
        ownerId: String(chatId),
        targetType: "IDENTITY_RECORD",
        targetKey: "identity_record",
        payload: {
          resultType: "IDENTITY_RECORD_MISMATCH",
          resultState: "PARTIAL",
          resultTags: ["no_birth_record"],
          observableFacts: ["공식 출생 기록이 없다."],
          requiredAccess: { allowedActions: ["VERIFY_IDENTITY"] },
        },
      });
      runInvestigationDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 21,
        explicitActions: [
          { actionType: "VERIFY_IDENTITY", targetKey: "identity_record" },
        ],
      });
      const origin = listExistingPersonaSecrets(personaId).find((s) =>
        /다른\s*세계/.test(s.canonical_secret_text)
      );
      assert.equal(
        knowledgeOf(chatId, personaId, characterId, origin!.id)?.knowledge_state,
        "SUSPECTED"
      );
    });

    it("IDENTITY_ORIGIN_CONFIRMED → otherworld CONFIRMED", () => {
      const { personaId, chatId, characterId } = uniqueIds();
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌은 다른 세계에서 왔다.",
      });
      upsertInvestigationTarget({
        ownerScope: "CHAT",
        ownerId: String(chatId),
        targetType: "IDENTITY_RECORD",
        targetKey: "identity_record",
        payload: {
          resultType: "IDENTITY_ORIGIN_CONFIRMED",
          resultState: "VERIFIED",
          resultTags: ["nonlocal_origin_confirmed"],
          observableFacts: ["차원 이동 기록이 확인됐다."],
          requiredAccess: { allowedActions: ["VERIFY_IDENTITY", "QUERY_DATABASE"] },
        },
      });
      runInvestigationDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 22,
        explicitActions: [
          { actionType: "VERIFY_IDENTITY", targetKey: "identity_record" },
        ],
      });
      const origin = listExistingPersonaSecrets(personaId).find((s) =>
        /다른\s*세계/.test(s.canonical_secret_text)
      );
      assert.equal(
        knowledgeOf(chatId, personaId, characterId, origin!.id)?.knowledge_state,
        "CONFIRMED"
      );
    });
  });

  describe("mark meaning vs presence", () => {
    it("wrong mark tag unlocks 0", () => {
      const { personaId, chatId, characterId } = uniqueIds();
      compileAndApplyPersonaSecrets({
        personaId,
        source:
          "렌의 등에 실험체 시절 생긴 017 문신이 있다.\n\n017은 제7연구소 피험자 번호라는 의미다.",
      });
      upsertInvestigationTarget({
        ownerScope: "CHAT",
        ownerId: String(chatId),
        targetType: "ORGANIZATION_RECORD",
        targetKey: "mark_meaning_record",
        payload: {
          resultType: "MARK_MEANING_IDENTIFIED",
          resultState: "VERIFIED",
          resultTags: ["mark_016", "subject_identifier"],
          observableFacts: ["016 기록"],
          requiredAccess: { allowedActions: ["QUERY_DATABASE"] },
        },
      });
      const inv = runInvestigationDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 30,
        explicitActions: [
          { actionType: "QUERY_DATABASE", targetKey: "mark_meaning_record" },
        ],
      });
      assert.equal(inv.changedCount, 0);
      const meaning = listExistingPersonaSecrets(personaId).find((s) =>
        /의미|피험자|연구소/.test(s.canonical_secret_text)
      );
      assert.equal(
        knowledgeOf(chatId, personaId, characterId, meaning!.id),
        null
      );
    });

    it("mark_017 + subject_identifier → meaning CONFIRMED; formal ability names stay unknown", () => {
      const { personaId, chatId, characterId } = uniqueIds();
      compileAndApplyPersonaSecrets({
        personaId,
        source:
          "렌의 등에 실험체 시절 생긴 017 문신이 있다.\n\n017은 제7연구소 피험자 번호라는 의미다.",
      });
      upsertInvestigationTarget({
        ownerScope: "CHAT",
        ownerId: String(chatId),
        targetType: "ORGANIZATION_RECORD",
        targetKey: "mark_meaning_record",
        payload: {
          resultType: "MARK_MEANING_IDENTIFIED",
          resultState: "VERIFIED",
          resultTags: ["mark_017", "subject_identifier"],
          observableFacts: ["017은 피험자 식별 번호다."],
          requiredAccess: { allowedActions: ["QUERY_DATABASE"] },
        },
      });
      runInvestigationDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 31,
        explicitActions: [
          { actionType: "QUERY_DATABASE", targetKey: "mark_meaning_record" },
        ],
      });
      const meaning = listExistingPersonaSecrets(personaId).find((s) =>
        /의미|피험자|연구소/.test(s.canonical_secret_text)
      );
      assert.equal(
        knowledgeOf(chatId, personaId, characterId, meaning!.id)?.knowledge_state,
        "CONFIRMED"
      );
    });
  });

  describe("ability cost medical confirmation", () => {
    it("ABILITY_COST_CONFIRMED upgrades visual SUSPECTED → CONFIRMED", () => {
      const { personaId, chatId, characterId } = uniqueIds();
      compileAndApplyPersonaSecrets({
        personaId,
        source: "능력 사용 뒤 내부 장기가 손상되는 부작용이 있다.",
      });
      extractAndPersistSceneEvidence({
        chatId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 40,
        userMessage: "렌은 갑자기 피를 토했다.",
        publicPersonaId: personaId,
      });
      runVisualDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 40,
      });
      const cost = listExistingPersonaSecrets(personaId).find((s) =>
        /부작용|손상|대가/.test(s.canonical_secret_text)
      );
      assert.ok(cost, "ability-cost secret should compile");
      const before = knowledgeOf(chatId, personaId, characterId, cost.id);
      assert.ok(
        !before || before.knowledge_state === "SUSPECTED",
        "visual may set SUSPECTED"
      );

      upsertInvestigationTarget({
        ownerScope: "CHAT",
        ownerId: String(chatId),
        targetType: "MEDICAL_RECORD",
        targetKey: "medical_exam",
        payload: {
          resultType: "ABILITY_COST_CONFIRMED",
          resultState: "VERIFIED",
          resultTags: ["internal_injury_after_manifestation"],
          observableFacts: ["능력 사용 후 내부 손상이 확인됐다."],
          requiredAccess: { allowedActions: ["RUN_MEDICAL_EXAM"] },
        },
      });
      runInvestigationDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 2,
        sourceMessageId: 41,
        explicitActions: [
          { actionType: "RUN_MEDICAL_EXAM", targetKey: "medical_exam" },
        ],
      });
      assert.equal(
        knowledgeOf(chatId, personaId, characterId, cost.id)?.knowledge_state,
        "CONFIRMED"
      );
      const facts = buildCharacterKnownFactsBlock({
        chatId,
        personaId,
        characterId,
        legacySecretDescription: "",
      });
      assert.ok(facts);
      assert.ok(!/엘리시온|천공의 권능/.test(facts ?? ""));
    });
  });

  describe("negatives / side-channel", () => {
    it("observer mismatch → no knowledge change", () => {
      const { personaId, chatId } = uniqueIds();
      const characterId = 17;
      const otherCharacter = 99;
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌은 거액의 빚이 있다.",
      });
      upsertInvestigationTarget({
        ownerScope: "CHAT",
        ownerId: String(chatId),
        targetType: "FINANCIAL_RECORD",
        targetKey: "financial_record",
        payload: {
          resultType: "DEBT_RECORD_CONFIRMED",
          resultState: "VERIFIED",
          resultTags: ["debtor_identity_match"],
          observableFacts: ["ok"],
          requiredAccess: { allowedActions: ["CHECK_FINANCIAL_RECORDS"] },
        },
      });
      const resolved = resolveInvestigationTurn({
        chatId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 50,
        explicitActions: [
          {
            actionType: "CHECK_FINANCIAL_RECORDS",
            targetKey: "financial_record",
          },
        ],
      });
      assert.equal(resolved.resultCount, 1);
      const rules = listEligibleInvestigationDiscoveryRules(personaId);
      let matched = 0;
      for (const result of resolved.results) {
        for (const rule of rules) {
          const m = matchInvestigationDiscoveryRule({
            result,
            rule,
            characterId: otherCharacter,
            personaId,
          });
          if (m) matched++;
        }
      }
      assert.equal(matched, 0);
      const debt = listExistingPersonaSecrets(personaId).find((s) =>
        /빚/.test(s.canonical_secret_text)
      );
      assert.equal(
        knowledgeOf(chatId, personaId, otherCharacter, debt!.id),
        null
      );
    });

    it("cross-chat isolation", () => {
      const { personaId, chatId, characterId } = uniqueIds();
      const chat2 = chatId + 1;
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌은 거액의 빚이 있다.",
      });
      upsertInvestigationTarget({
        ownerScope: "CHAT",
        ownerId: String(chatId),
        targetType: "FINANCIAL_RECORD",
        targetKey: "financial_record",
        payload: {
          resultType: "DEBT_RECORD_CONFIRMED",
          resultState: "VERIFIED",
          resultTags: ["debtor_identity_match"],
          observableFacts: ["ok"],
          requiredAccess: { allowedActions: ["CHECK_FINANCIAL_RECORDS"] },
        },
      });
      runInvestigationDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 60,
        explicitActions: [
          {
            actionType: "CHECK_FINANCIAL_RECORDS",
            targetKey: "financial_record",
          },
        ],
      });
      const debt = listExistingPersonaSecrets(personaId).find((s) =>
        /빚/.test(s.canonical_secret_text)
      );
      assert.equal(
        knowledgeOf(chatId, personaId, characterId, debt!.id)?.knowledge_state,
        "CONFIRMED"
      );
      assert.equal(
        knowledgeOf(chat2, personaId, characterId, debt!.id),
        null
      );
    });

    it("eligible investigation rules stay dormant in DB (enabled=0)", () => {
      const { personaId } = uniqueIds();
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌은 거액의 빚이 있다.",
      });
      const eligible = listEligibleInvestigationDiscoveryRules(personaId);
      assert.ok(eligible.length >= 1);
      for (const r of eligible) {
        assert.equal(r.enabled, 0);
      }
    });

    it("idempotent attempt/result/discovery keys are stable", () => {
      assert.equal(
        buildInvestigationAttemptIdempotencyKey({
          chatId: 1,
          sourceMessageId: 2,
          actionType: "READ_DOCUMENT",
          targetKey: "doc:x",
        }),
        buildInvestigationAttemptIdempotencyKey({
          chatId: 1,
          sourceMessageId: 2,
          actionType: "READ_DOCUMENT",
          targetKey: "doc:x",
        })
      );
      assert.equal(
        buildInvestigationResultIdempotencyKey({
          attemptId: "a",
          resultType: "DEBT_RECORD_CONFIRMED",
          resultTags: ["b", "a"],
        }),
        buildInvestigationResultIdempotencyKey({
          attemptId: "a",
          resultType: "DEBT_RECORD_CONFIRMED",
          resultTags: ["a", "b"],
        })
      );
      assert.equal(
        buildInvestigationDiscoveryIdempotencyKey({
          investigationResultId: "r",
          discoveryRuleId: "d",
          observerId: "17",
        }),
        buildInvestigationDiscoveryIdempotencyKey({
          investigationResultId: "r",
          discoveryRuleId: "d",
          observerId: "17",
        })
      );
    });

    it("retry same investigation does not duplicate evidence events", () => {
      const { personaId, chatId, characterId } = uniqueIds();
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌은 거액의 빚이 있다.",
      });
      upsertInvestigationTarget({
        ownerScope: "CHAT",
        ownerId: String(chatId),
        targetType: "FINANCIAL_RECORD",
        targetKey: "financial_record",
        payload: {
          resultType: "DEBT_RECORD_CONFIRMED",
          resultState: "VERIFIED",
          resultTags: ["debtor_identity_match"],
          observableFacts: ["ok"],
          requiredAccess: { allowedActions: ["CHECK_FINANCIAL_RECORDS"] },
        },
      });
      const action = {
        actionType: "CHECK_FINANCIAL_RECORDS" as const,
        targetKey: "financial_record",
      };
      runInvestigationDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 70,
        explicitActions: [action],
      });
      runInvestigationDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 70,
        explicitActions: [action],
      });
      const count = getDb()
        .prepare(
          `SELECT COUNT(*) AS c FROM persona_secret_evidence_events
           WHERE chat_id=? AND method='INVESTIGATION_DISCOVERY'`
        )
        .get(chatId) as { c: number };
      assert.equal(count.c, 1);
    });
  });

  describe("same-turn known facts", () => {
    it("rebuilds known facts after investigation unlock", () => {
      const { personaId, chatId, characterId } = uniqueIds();
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌은 거액의 빚이 있다.",
      });
      const before = buildCharacterKnownFactsBlock({
        chatId,
        personaId,
        characterId,
        legacySecretDescription: "",
      });
      upsertInvestigationTarget({
        ownerScope: "CHAT",
        ownerId: String(chatId),
        targetType: "FINANCIAL_RECORD",
        targetKey: "financial_record",
        payload: {
          resultType: "DEBT_RECORD_CONFIRMED",
          resultState: "VERIFIED",
          resultTags: ["debtor_identity_match"],
          observableFacts: ["ok"],
          requiredAccess: { allowedActions: ["CHECK_FINANCIAL_RECORDS"] },
        },
      });
      runInvestigationDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 80,
        explicitActions: [
          {
            actionType: "CHECK_FINANCIAL_RECORDS",
            targetKey: "financial_record",
          },
        ],
      });
      const after = buildCharacterKnownFactsBlock({
        chatId,
        personaId,
        characterId,
        legacySecretDescription: "",
      });
      assert.notEqual(after, before);
      assert.ok(after && /빚|채무|부채/.test(after));
    });
  });
});
