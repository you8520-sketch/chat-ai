import Module from "module";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  compileAndApplyPersonaSecrets,
  hashPersonaSecretSource,
} from "@/lib/personaSecretCompiler";
import { compilePersonaSecretsDeterministic } from "@/lib/personaSecretCompilerDeterministic";
import { listExistingPersonaSecrets } from "@/lib/personaSecretCompilerApply";
import { validatePersonaSecretCompilerResult } from "@/lib/personaSecretCompilerValidate";
import { PERSONA_SECRET_COMPILER_VERSION } from "@/lib/personaSecretCompilerCatalog";
import {
  buildDeterministicDisclosureIdempotencyKey,
  confirmPersonaSecretDisclosure,
} from "@/lib/personaSecretDirectDisclosure";
import { getCharacterSecretKnowledge } from "@/lib/personaSecretKnowledge";

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

function uniquePersonaId(): number {
  return 890000 + Math.floor(Math.random() * 10000);
}

function baseSecret(overrides: Record<string, unknown> = {}) {
  return {
    sourceQuotes: ["등에 문신이 있다"],
    semanticKey: "tattoo_test01",
    title: "문신",
    category: "BODY_MARK",
    canonicalSecretText: "등에 문신이 있다",
    suspectedFactText: "등에 문신이 있다",
    confirmedFactText: "등에 문신이 있다",
    importance: "NORMAL",
    directDisclosureAliases: ["등에 문신이 있다"],
    discoveryRules: [
      {
        method: "DIRECT_DISCLOSURE",
        ruleKey: "default",
        resultState: "CONFIRMED",
        revealedFactText: "등에 문신이 있다",
        evidenceKinds: ["USER_EXPLICIT_DISCLOSURE"],
        dormant: false,
        conditions: {},
      },
    ],
    dependencies: [],
    confidence: 0.8,
    needsReview: false,
    warnings: [],
    ...overrides,
  };
}

describe("PR-S1.5 persona secret compiler", () => {
  let env: Record<string, string | undefined>;

  beforeEach(() => {
    env = saveEnv();
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
  });

  afterEach(() => restoreEnv(env));

  describe("compiler grounding", () => {
    it("rejects results without source quotes", () => {
      const source = "등에 문신이 있다";
      const bad = {
        schemaVersion: 1,
        compilerVersion: 1,
        secrets: [baseSecret({ sourceQuotes: [] })],
        unresolvedFragments: [],
        warnings: [],
      };
      const v = validatePersonaSecretCompilerResult(bad, source);
      assert.equal(v.ok, false);
    });

    it("rejects quotes not present in source", () => {
      const source = "등에 문신이 있다";
      const bad = {
        schemaVersion: 1,
        compilerVersion: 1,
        secrets: [baseSecret({ sourceQuotes: ["존재하지 않는 설정"] })],
        unresolvedFragments: [],
        warnings: [],
      };
      const v = validatePersonaSecretCompilerResult(bad, source);
      assert.equal(v.ok, false);
    });

    it("rejects invented evidence kinds", () => {
      const source = "등에 문신이 있다";
      const bad = {
        schemaVersion: 1,
        compilerVersion: 1,
        secrets: [
          baseSecret({
            discoveryRules: [
              {
                method: "VISUAL_DISCOVERY",
                ruleKey: "visual",
                resultState: "SUSPECTED",
                revealedFactText: "등에 문신이 있다",
                evidenceKinds: ["FAKE_EVIDENCE_KIND"],
                dormant: true,
                conditions: {},
              },
            ],
          }),
        ],
        unresolvedFragments: [],
        warnings: [],
      };
      const v = validatePersonaSecretCompilerResult(bad, source);
      assert.equal(v.ok, false);
    });

    it("rejects empty result for non-empty source", () => {
      const v = validatePersonaSecretCompilerResult(
        {
          schemaVersion: 1,
          compilerVersion: 1,
          secrets: [],
          unresolvedFragments: [],
          warnings: [],
        },
        "비밀이 있다"
      );
      assert.equal(v.ok, false);
      if (!v.ok) assert.equal(v.errorCode, "EMPTY_RESULT");
    });

    it("rejects invalid enums", () => {
      const source = "등에 문신이 있다";
      const bad = {
        schemaVersion: 1,
        compilerVersion: 1,
        secrets: [baseSecret({ category: "NOT_A_CATEGORY" })],
        unresolvedFragments: [],
        warnings: [],
      };
      const v = validatePersonaSecretCompilerResult(bad, source);
      assert.equal(v.ok, false);
    });
  });

  describe("atomic split", () => {
    const cases: Array<{ name: string; source: string; minSecrets: number }> = [
      {
        name: "정체 + 문신",
        source: "나는 이계 출신이다.\n\n등에 검은 문신이 있다.",
        minSecrets: 2,
      },
      {
        name: "능력 + 부작용",
        source: "치유 능력이 있다, 쓸 때마다 열이 나는 부작용이 있다.",
        minSecrets: 2,
      },
      {
        name: "문신 + 문신 의미",
        source: "등에 문신이 있다, 그 문신은 저주의 증거라는 의미다.",
        minSecrets: 2,
      },
      {
        name: "질병 + 증상",
        source: "희귀 질병을 앓고 있다, 밤에 기침하는 증상이 있다.",
        minSecrets: 2,
      },
      {
        name: "빚 + 빚 원인",
        source: "큰 빚이 있다, 도박 때문에 생겼다.",
        minSecrets: 2,
      },
      {
        name: "숨긴 아이템 + 아이템 의미",
        source: "가방에 낡은 목걸이를 숨긴다.\n\n그 목걸이는 과거 계약의 증거다.",
        minSecrets: 2,
      },
    ];

    for (const c of cases) {
      it(c.name, () => {
        const result = compilePersonaSecretsDeterministic(c.source);
        assert.ok(result.secrets.length >= c.minSecrets, `got ${result.secrets.length}`);
        const v = validatePersonaSecretCompilerResult(result, c.source);
        assert.equal(v.ok, true);
      });
    }
  });

  describe("no invention", () => {
    it("does not invent creditor or dunning letter from debt-only source", () => {
      const source = "큰 빚이 있다.";
      const result = compilePersonaSecretsDeterministic(source);
      const blob = JSON.stringify(result);
      assert.equal(/채권자|독촉장|사채업자/.test(blob), false);
      for (const s of result.secrets) {
        for (const q of s.sourceQuotes) assert.ok(source.includes(q));
      }
    });

    it("does not invent skill names from ability-only source", () => {
      const source = "치유 능력이 있다.";
      const result = compilePersonaSecretsDeterministic(source);
      const blob = JSON.stringify(result);
      assert.equal(/힐링 웨이브|아쿠아 힐|스킬명/.test(blob), false);
    });

    it("does not invent org names from past-event source", () => {
      const source = "과거에 큰 사고를 냈다.";
      const result = compilePersonaSecretsDeterministic(source);
      const blob = JSON.stringify(result);
      assert.equal(/천공기관|비밀결사|정보국/.test(blob), false);
    });

    it("does not invent organization meaning for tattoo-only source", () => {
      const source = "등에 문신이 있다.";
      const result = compilePersonaSecretsDeterministic(source);
      const blob = JSON.stringify(result);
      assert.equal(/조직의 낙인|암살단|소속 문신/.test(blob), false);
    });
  });

  describe("stable identity", () => {
    it("preserves secret id across paraphrase and reorder", () => {
      const personaId = uniquePersonaId();
      const source1 =
        "나는 이계 출신이다.\n\n등에 검은 문신이 있다.\n\n치유 능력이 있다.";
      const a = compileAndApplyPersonaSecrets({ personaId, source: source1 });
      assert.equal(a.ok, true);
      const before = listExistingPersonaSecrets(personaId).filter((s) => s.is_active === 1);
      assert.ok(before.length >= 2);
      const idsBefore = new Set(before.map((s) => s.id));

      const source2 =
        "등에 검은 문신이 있다.\n\n치유 능력이 있다.\n\n나는 이계 출신이다.";
      const b = compileAndApplyPersonaSecrets({ personaId, source: source2 });
      assert.equal(b.ok, true);
      const after = listExistingPersonaSecrets(personaId).filter((s) => s.is_active === 1);
      const preserved = after.filter((s) => idsBefore.has(s.id)).length;
      assert.ok(preserved >= Math.min(2, before.length));

      // Add a new secret — prior ids stay
      const source3 = `${source2}\n\n큰 빚이 있다.`;
      const c = compileAndApplyPersonaSecrets({ personaId, source: source3 });
      assert.equal(c.ok, true);
      const afterAdd = listExistingPersonaSecrets(personaId).filter((s) => s.is_active === 1);
      for (const id of idsBefore) {
        assert.ok(afterAdd.some((s) => s.id === id));
      }

      // Remove one paragraph — inactivated, not hard-deleted
      const source4 = "나는 이계 출신이다.\n\n등에 검은 문신이 있다.";
      const d = compileAndApplyPersonaSecrets({ personaId, source: source4 });
      assert.equal(d.ok, true);
      const inactive = listExistingPersonaSecrets(personaId).filter((s) => s.is_active === 0);
      assert.ok(inactive.length >= 1);
    });

    it("keeps prior knowledge snapshot after recompile", () => {
      const personaId = uniquePersonaId();
      const chatId = 910000 + Math.floor(Math.random() * 1000);
      const source = "나는 이계 출신이다.";
      const compiled = compileAndApplyPersonaSecrets({ personaId, source });
      assert.equal(compiled.ok, true);
      const secret = listExistingPersonaSecrets(personaId).find((s) => s.is_active === 1);
      assert.ok(secret);

      const disclosed = confirmPersonaSecretDisclosure({
        chatId,
        personaId,
        secretId: secret!.id,
        characterId: 1,
        turnNumber: 3,
        sourceMessageId: null,
        sourceType: "USER_MESSAGE_DETERMINISTIC",
        revealedFactText: secret!.confirmed_fact_text,
        idempotencyKey: buildDeterministicDisclosureIdempotencyKey({
          chatId,
          personaId,
          secretId: secret!.id,
          characterId: 1,
          turnNumber: 3,
        }),
      });
      assert.equal(disclosed.changed, true);

      const knowledgeBefore = getCharacterSecretKnowledge({
        chatId,
        personaId,
        secretId: secret!.id,
        characterId: 1,
      });
      assert.ok(knowledgeBefore);

      const source2 = "나는 이계 출신이다. 오래전부터 숨겨왔다.";
      const re = compileAndApplyPersonaSecrets({ personaId, source: source2 });
      assert.equal(re.ok, true);

      const knowledgeAfter = getCharacterSecretKnowledge({
        chatId,
        personaId,
        secretId: secret!.id,
        characterId: 1,
      });
      assert.ok(knowledgeAfter);
      assert.equal(knowledgeAfter!.fact_snapshot, knowledgeBefore!.fact_snapshot);
      assert.equal(knowledgeAfter!.knowledge_state, knowledgeBefore!.knowledge_state);
    });
  });

  describe("failure handling", () => {
    it("preserves prior compilation when validation would fail (empty after prior)", () => {
      const personaId = uniquePersonaId();
      const source = "등에 문신이 있다.";
      const ok = compileAndApplyPersonaSecrets({ personaId, source });
      assert.equal(ok.ok, true);
      const prior = listExistingPersonaSecrets(personaId).filter((s) => s.is_active === 1);
      assert.ok(prior.length >= 1);

      const empty = compileAndApplyPersonaSecrets({ personaId, source: "   " });
      assert.equal(empty.ok, false);
      if (!empty.ok) assert.equal(empty.preservedPrior, true);
      const after = listExistingPersonaSecrets(personaId).filter((s) => s.is_active === 1);
      assert.equal(after.length, prior.length);
      assert.equal(after[0]!.id, prior[0]!.id);
    });

    it("reuses successful compilation for same source hash + version", () => {
      const personaId = uniquePersonaId();
      const source = "희귀 질병을 앓고 있다.";
      const first = compileAndApplyPersonaSecrets({ personaId, source });
      assert.equal(first.ok, true);
      if (!first.ok) return;
      const second = compileAndApplyPersonaSecrets({ personaId, source });
      assert.equal(second.ok, true);
      if (!second.ok) return;
      assert.equal(second.reused, true);
      assert.equal(
        hashPersonaSecretSource(source).length,
        64
      );
      assert.equal(PERSONA_SECRET_COMPILER_VERSION, 1);
    });

    it("malformed JSON path is rejected by validator", () => {
      const v = validatePersonaSecretCompilerResult("not-json", "비밀");
      assert.equal(v.ok, false);
    });
  });

  describe("dormant discovery rules", () => {
    it("stores dormant visual/investigation rules without enabling them", () => {
      const personaId = uniquePersonaId();
      const source = "등에 문신이 있다.";
      const r = compileAndApplyPersonaSecrets({ personaId, source });
      assert.equal(r.ok, true);
      const secret = listExistingPersonaSecrets(personaId).find((s) => s.is_active === 1);
      assert.ok(secret);
      const rules = getDb()
        .prepare(`SELECT method, enabled, conditions_json FROM persona_secret_discovery_rules WHERE secret_id=?`)
        .all(secret!.id) as Array<{ method: string; enabled: number; conditions_json: string }>;
      assert.ok(rules.some((x) => x.method === "DIRECT_DISCLOSURE" && x.enabled === 1));
      const visual = rules.find((x) => x.method === "VISUAL_DISCOVERY");
      assert.ok(visual);
      assert.equal(visual!.enabled, 0);
      assert.ok(JSON.parse(visual!.conditions_json).dormant === true);
    });
  });
});
