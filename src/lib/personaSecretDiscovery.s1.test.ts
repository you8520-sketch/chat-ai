import Module from "module";
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  createPersonaSecret,
  deactivatePersonaSecret,
  listPersonaSecretsForEditor,
  updatePersonaSecret,
} from "@/lib/personaSecrets";
import {
  buildDeterministicDisclosureIdempotencyKey,
  confirmPersonaSecretDisclosure,
  detectDeterministicDirectDisclosures,
} from "@/lib/personaSecretDirectDisclosure";
import {
  buildCharacterKnownFactsBlock,
  getCharacterSecretKnowledge,
  listConfirmedCharacterSecretKnowledge,
} from "@/lib/personaSecretKnowledge";
import { insertChatPersonaSecretReveal } from "@/lib/personaSecretReveal";
import type { buildContext as BuildContextFn } from "@/services/contextBuilder";

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
  return 880000 + Math.floor(Math.random() * 10000);
}

let buildContext: typeof BuildContextFn;

describe("PR-S1 persona secret discovery core", () => {
  let env: Record<string, string | undefined>;

  before(async () => {
    ({ buildContext } = await import("@/services/contextBuilder"));
  });

  beforeEach(() => {
    env = saveEnv();
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
  });

  afterEach(() => restoreEnv(env));

  it("creates secrets with stable keys and rejects duplicates", () => {
    const personaId = uniquePersonaId();
    const a = createPersonaSecret({
      personaId,
      secretKey: "origin_otherworld",
      ownerTitle: "출신",
      canonicalSecretText: "렌은 이계에서 왔다. 천공의 권능을 숨긴다.",
      confirmedFactText: "렌이 이계에서 왔다는 사실을 직접 고백했다.",
      directDisclosureAliases: ["나는 이계에서 왔어", "난 다른 세계에서 왔어"],
    });
    assert.equal(a.ok, true);
    if (!a.ok) return;
    const dup = createPersonaSecret({
      personaId,
      secretKey: "origin_otherworld",
      canonicalSecretText: "다른 원문",
      confirmedFactText: "다른 fact",
    });
    assert.equal(dup.ok, false);
    const listed = listPersonaSecretsForEditor(personaId);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.secretKey, "origin_otherworld");
    assert.ok(listed[0]!.id);
  });

  it("soft-deactivates secrets and keeps id stable across edits", () => {
    const personaId = uniquePersonaId();
    const created = createPersonaSecret({
      personaId,
      secretKey: "celestial_authority",
      canonicalSecretText: "천공의 권능 원문",
      confirmedFactText: "렌이 공간과 중력에 간섭하는 능력을 지녔다.",
      directDisclosureAliases: ["이 문신은 실험체였을 때 생긴 거야"],
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const id = created.secret.id;
    const updated = updatePersonaSecret({
      secretId: id,
      personaId,
      confirmedFactText: "렌이 실험체였던 과거를 직접 밝혔다.",
      directDisclosureAliases: ["이 문신은 실험체였을 때 생긴 거야"],
    });
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.equal(updated.secret.id, id);
    assert.ok(updated.secret.revision >= 2);
    assert.equal(deactivatePersonaSecret(personaId, id), true);
    assert.equal(
      listPersonaSecretsForEditor(personaId).find((s) => s.id === id)?.isActive,
      false
    );
  });

  it("deterministic detector confirms assertive first-person aliases only", () => {
    const personaId = uniquePersonaId();
    const created = createPersonaSecret({
      personaId,
      secretKey: "origin_otherworld",
      canonicalSecretText: "원문 천공의 권능 / 엘리시온 브레이크",
      confirmedFactText: "렌이 이계에서 왔다는 사실을 직접 고백했다.",
      directDisclosureAliases: [
        "나는 이계에서 왔어",
        "나 사실 다른 세계 출신이야",
      ],
    });
    assert.equal(created.ok, true);

    const positives = [
      "나는 이계에서 왔어.",
      "나 사실 다른 세계 출신이야.",
    ];
    for (const msg of positives) {
      const hits = detectDeterministicDirectDisclosures(msg, personaId);
      assert.equal(hits.length, 1, msg);
      assert.doesNotMatch(hits[0]!.revealedFactText, /천공의 권능|엘리시온/);
    }

    const negatives = [
      "내가 이계에서 왔다면?",
      "내가 이계 출신 같아?",
      "이계에서 온 사람을 만났어.",
      "나는 이계에서 온 게 아니야.",
      "소설 설정으로는 내가 이계 출신이야.",
    ];
    for (const msg of negatives) {
      assert.equal(detectDeterministicDirectDisclosures(msg, personaId).length, 0, msg);
    }
  });

  it("confirm disclosure is transactional, idempotent, and chat/character scoped", () => {
    const db = getDb();
    const personaId = uniquePersonaId();
    const chatA = 770001;
    const chatB = 770002;
    const charA = 42;
    const charB = 43;
    db.prepare("DELETE FROM persona_secret_evidence_events WHERE persona_id=?").run(personaId);
    db.prepare("DELETE FROM chat_character_secret_knowledge WHERE persona_id=?").run(personaId);

    const created = createPersonaSecret({
      personaId,
      secretKey: "origin_otherworld",
      canonicalSecretText: "HIDDEN CANONICAL NEEDLE celestial_authority",
      confirmedFactText: "렌이 이계에서 왔다는 사실을 직접 고백했다.",
      directDisclosureAliases: ["나는 이계에서 왔어"],
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const key = buildDeterministicDisclosureIdempotencyKey({
      chatId: chatA,
      personaId,
      secretId: created.secret.id,
      characterId: charA,
      turnNumber: 3,
    });
    const first = confirmPersonaSecretDisclosure({
      chatId: chatA,
      personaId,
      secretId: created.secret.id,
      characterId: charA,
      turnNumber: 3,
      sourceType: "USER_MESSAGE_DETERMINISTIC",
      revealedFactText: created.secret.confirmedFactText,
      idempotencyKey: key,
    });
    assert.equal(first.changed, true);

    const second = confirmPersonaSecretDisclosure({
      chatId: chatA,
      personaId,
      secretId: created.secret.id,
      characterId: charA,
      turnNumber: 3,
      sourceType: "USER_MESSAGE_DETERMINISTIC",
      revealedFactText: created.secret.confirmedFactText,
      idempotencyKey: key,
    });
    assert.equal(second.changed, false);

    assert.equal(
      listConfirmedCharacterSecretKnowledge({
        chatId: chatA,
        personaId,
        characterId: charA,
      }).length,
      1
    );
    assert.equal(
      getCharacterSecretKnowledge({
        chatId: chatB,
        personaId,
        secretId: created.secret.id,
        characterId: charA,
      }),
      null
    );
    assert.equal(
      getCharacterSecretKnowledge({
        chatId: chatA,
        personaId,
        secretId: created.secret.id,
        characterId: charB,
      }),
      null
    );

    const block = buildCharacterKnownFactsBlock({
      chatId: chatA,
      personaId,
      characterId: charA,
    });
    assert.ok(block);
    assert.match(block!, /CHARACTER-KNOWN FACTS/);
    assert.match(block!, /이계에서 왔/);
    assert.doesNotMatch(block!, /HIDDEN CANONICAL NEEDLE|celestial_authority/);
  });

  it("runtime block never includes UNKNOWN canonical secrets; novel still safe", () => {
    const personaId = uniquePersonaId();
    const chatId = 770010;
    const characterId = 99;
    createPersonaSecret({
      personaId,
      secretKey: "hidden_debt",
      canonicalSecretText: "엘리시온 브레이크 원문",
      confirmedFactText: "렌이 숨겨둔 부채가 있다는 사실을 직접 말했다.",
      directDisclosureAliases: ["나 사실 빚이 있어"],
    });

    const before = buildCharacterKnownFactsBlock({
      chatId,
      personaId,
      characterId,
    });
    assert.equal(before, null);

    const built = buildContext({
      charName: "로코",
      chunks: [
        {
          id: "c1",
          characterId: "99",
          content: "로코",
          category: "identity",
          importance: "CRITICAL",
          tokenCount: 1,
          keywords: [],
        },
      ],
      userNickname: "렌",
      userPersona: "렌은 가이드다.",
      revealedPersonaFactsBlock: before,
      novelModeEnabled: true,
      shortTermHistory: [],
      currentUserMessage: "안녕",
      nsfw: false,
      longTermMemory: "",
      modelId: "meta/muse-spark-1.1",
      provider: "openrouter",
    });
    const full = `${built.systemPrompt ?? ""}\n${built.openRouterSystemSplit?.dynamicBlock ?? ""}`;
    assert.doesNotMatch(full, /엘리시온 브레이크|PRIVATE USER PERSONA SECRET/);
  });

  it("rejects assistant-like evidence source types", () => {
    const personaId = uniquePersonaId();
    const created = createPersonaSecret({
      personaId,
      secretKey: "back_tattoo",
      canonicalSecretText: "문신 원문",
      confirmedFactText: "렌의 등에 실험 문신이 있다.",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const rejected = confirmPersonaSecretDisclosure({
      chatId: 1,
      personaId,
      secretId: created.secret.id,
      characterId: 1,
      turnNumber: 1,
      sourceType: "ASSISTANT_ACK" as "USER_EXPLICIT_UI",
      revealedFactText: created.secret.confirmedFactText,
      idempotencyKey: "bad-assistant",
    });
    assert.equal(rejected.changed, false);
    assert.equal(
      getCharacterSecretKnowledge({
        chatId: 1,
        personaId,
        secretId: created.secret.id,
        characterId: 1,
      }),
      null
    );
  });

  it("legacy reveal compatibility merges without canonical text", () => {
    const db = getDb();
    const personaId = uniquePersonaId();
    const chatId = 770020;
    const characterId = 7;
    const created = createPersonaSecret({
      personaId,
      secretKey: "origin_otherworld",
      canonicalSecretText: "원문-needle-이계탈출",
      confirmedFactText: "렌이 이계에서 왔다는 사실을 알고 있다.",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    insertChatPersonaSecretReveal(
      {
        chatId,
        personaId,
        secretKey: "origin_otherworld",
        revealedFactText: "렌이 이계에서 왔다는 사실을 알고 있다.",
        revealedAtTurn: 2,
        source: "USER_AUTHORED_DISCLOSURE",
      },
      db
    );

    const block = buildCharacterKnownFactsBlock({
      chatId,
      personaId,
      characterId,
    });
    assert.ok(block);
    assert.match(block!, /이계에서 왔/);
    assert.doesNotMatch(block!, /원문-needle-이계탈출/);
    assert.ok(
      getCharacterSecretKnowledge({
        chatId,
        personaId,
        secretId: created.secret.id,
        characterId,
      })
    );
  });
});
