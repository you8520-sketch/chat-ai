import assert from "node:assert/strict";
import { it } from "node:test";
import {
  buildEpisodicCandidateScope,
  detectRelationshipLedgerOwnedFact,
  evaluateEpisodicRetrievalGuard,
  fetchEpisodicMemoryCandidatesForDebug,
  getEpisodicMemoryForPrompt,
  inspectLexicalRelevanceForDebug,
  persistEpisodicMemoryFactsCore,
  reconcileGlobalStateLikeFacts,
  summarizeEpisodicFactPersistCandidates,
} from "@/lib/episodicMemoryFacts";
import { classifyEpisodicFactTemporalNature } from "@/lib/episodicMemoryTemporal";
import { formatMemoryMetaForPrompt, mergeMemoryMeta, parseMemoryMeta } from "@/lib/chatMemory";
import {
  openDb,
  seed,
  type Row,
} from "@/lib/memory/memory-rp-benchmark-suite";

const env = {
  MEMORY_FEATURE_ENABLED: "1",
  EPISODIC_MEMORY_RECALL_ENABLED: "1",
} as unknown as NodeJS.ProcessEnv;

const OWNER_LATEST = {
  category: "setting" as const,
  subject: "silverkey",
  attribute: "owner",
  value: "jun",
  importance: "normal" as const,
  fact_text: "은열쇠가 린에게서 준에게 넘어갔다.",
  evidence_type: "explicit_scene_event" as const,
};

const OWNER_STALE = {
  category: "setting" as const,
  subject: "silverkey",
  attribute: "owner",
  value: "rin",
  importance: "normal" as const,
  fact_text: "린이 은열쇠를 가지고 있다.",
  evidence_type: "explicit_scene_event" as const,
};

const HIGH_NOISE_TARGET = {
  category: "character" as const,
  subject: "rin",
  attribute: "hid_item",
  value: "red_scarf_lighthouse",
  importance: "normal" as const,
  fact_text: "린은 붉은 스카프를 등대 지하실에 숨겼다.",
};

const HIGH_NOISE_QUERY = "린이 붉은 스카프를 숨긴 곳을 묻는다";

function highNoiseDistractors(count: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    rows.push([
      40 + i,
      "setting",
      `crate${i}`,
      "hidden_at",
      `cellar${i}`,
      "normal",
      `${i}번째 상자를 지하실 구석에 숨겼다.`,
    ]);
  }
  return rows;
}

function seedHighNoise(distractorCount: number) {
  const db = openDb();
  const [answerId] = seed(db, [
    [
      30,
      HIGH_NOISE_TARGET.category,
      HIGH_NOISE_TARGET.subject,
      HIGH_NOISE_TARGET.attribute,
      HIGH_NOISE_TARGET.value,
      HIGH_NOISE_TARGET.importance,
      HIGH_NOISE_TARGET.fact_text,
    ],
  ]);
  seed(db, highNoiseDistractors(distractorCount));
  return { db, answerId: answerId! };
}

it("item-ownership: production persist rejects owner facts that seed() can insert", () => {
  assert.equal(detectRelationshipLedgerOwnedFact(OWNER_LATEST), "relationship_ledger_item");
  assert.equal(detectRelationshipLedgerOwnedFact(OWNER_STALE), "relationship_ledger_item");
  const summary = summarizeEpisodicFactPersistCandidates([OWNER_LATEST, OWNER_STALE]);
  assert.equal(summary.insertableCount, 0);
  assert.ok(summary.skippedReasons.some((reason) => reason.startsWith("relationship_ledger_owned")));

  const db = openDb();
  const persisted = persistEpisodicMemoryFactsCore(db, {
    chatId: 1,
    sourceTurn: 30,
    facts: [OWNER_LATEST],
    metadata: { memory_evidence_type: "explicit_scene_event", content_route: "safe" },
  });
  assert.equal(persisted, 0, "production persist must drop ledger-owned ownership facts");
  const seeded = seed(db, [
    [30, OWNER_LATEST.category, OWNER_LATEST.subject, OWNER_LATEST.attribute, OWNER_LATEST.value, OWNER_LATEST.importance, OWNER_LATEST.fact_text],
  ]);
  assert.equal(seeded.length, 1, "TEST_SUBSTITUTE seed bypasses persist filters");
  const row = db
    .prepare("SELECT * FROM episodic_memory_facts WHERE id=?")
    .get(seeded[0]) as Parameters<typeof evaluateEpisodicRetrievalGuard>[0];
  const guard = evaluateEpisodicRetrievalGuard(row);
  assert.equal(guard.allowed, false);
  assert.equal(guard.blockedReason, "relationship_ledger_item");
  db.close();
});

it("item-ownership: candidate can include seeded owner facts; final guard drops them", () => {
  const db = openDb();
  const [staleId, latestId] = seed(db, [
    [10, "setting", "silverkey", "owner", "rin", "normal", "린이 은열쇠를 가지고 있다."],
    [30, "setting", "silverkey", "owner", "jun", "normal", "은열쇠가 린에게서 준에게 넘어갔다."],
  ]);
  const input = {
    chatId: 1,
    currentTurn: 70,
    currentUserMessage: "은열쇠를 누가 가지고 있는지 묻는다",
  };
  const candidates = fetchEpisodicMemoryCandidatesForDebug(db, input, env);
  const candidateIds = candidates.rows.map((row) => row.id);
  assert.equal(candidateIds.includes(latestId!), true, "seeded owner fact is visible to candidate discovery");
  const result = getEpisodicMemoryForPrompt(db, input, env);
  assert.equal(result.facts.some((fact) => fact.id === latestId), false);
  assert.equal(result.facts.some((fact) => fact.id === staleId), false);
  assert.equal(result.facts.length, 0, "episodic final must stay empty for ledger-owned owner facts");
  console.info(
    JSON.stringify({
      caseId: "item-ownership-01",
      candidateIncludesTarget: true,
      candidateCount: candidateIds.length,
      finalIncludesTarget: false,
      injectedCount: result.facts.length,
      staleInFinal: false,
      guard: evaluateEpisodicRetrievalGuard(
        db.prepare("SELECT * FROM episodic_memory_facts WHERE id=?").get(latestId) as Parameters<
          typeof evaluateEpisodicRetrievalGuard
        >[0]
      ),
    })
  );
  db.close();
});

it("item-ownership: Relationship Ledger has writer, reader, and prompt consumer", () => {
  const meta = mergeMemoryMeta(parseMemoryMeta(null), {
    items: ["준: 은열쇠"],
    itemsRemove: ["린: 은열쇠"],
  });
  assert.ok(meta.items.some((item) => item.includes("은열쇠")));
  const packed = formatMemoryMetaForPrompt(meta);
  assert.ok(packed && packed.includes("소지품") && packed.includes("은열쇠"));
});

it("high-noise: default reconcile order drops the target; preferred key order keeps it", () => {
  const { db, answerId } = seedHighNoise(120);
  const input = { chatId: 1, currentTurn: 200, currentUserMessage: HIGH_NOISE_QUERY };
  const candidates = fetchEpisodicMemoryCandidatesForDebug(db, input, env);
  const targetCandidate = candidates.rows.find((row) => row.id === answerId);
  assert.ok(targetCandidate, "candidate includes target");
  assert.equal(evaluateEpisodicRetrievalGuard(targetCandidate).allowed, true);
  assert.equal(classifyEpisodicFactTemporalNature(HIGH_NOISE_TARGET), "unknown");
  const lexical = inspectLexicalRelevanceForDebug(HIGH_NOISE_TARGET, HIGH_NOISE_QUERY);
  assert.equal(lexical.relevanceScore, 1);
  const scope = buildEpisodicCandidateScope(db, input, env);
  assert.ok(scope);
  const defaultReconcile = reconcileGlobalStateLikeFacts(db, scope, candidates.rows);
  assert.equal(
    defaultReconcile.rows.some((row) => row.id === answerId),
    false,
    "recent-first key order spends the cap on distractors"
  );
  const preferredReconcile = reconcileGlobalStateLikeFacts(db, scope, candidates.rows, {
    preferRowIds: new Set([answerId]),
  });
  assert.equal(
    preferredReconcile.rows.some((row) => row.id === answerId),
    true,
    "single-gate: prefer the target key and it survives the same cap"
  );
  console.info(
    JSON.stringify({
      caseId: "high-noise-reconcile-order",
      candidateLanes: candidates.laneById.get(answerId) ?? [],
      defaultReconciled: defaultReconcile.rows.length,
      defaultHasTarget: false,
      preferredHasTarget: true,
      keysDroppedDueToCap: defaultReconcile.stats.keysDroppedDueToCap,
      lexical,
    })
  );
  db.close();
});

it("high-noise: 24 distractors inject the target; 120 inject after relevance-key priority", () => {
  const atCap = seedHighNoise(24);
  const atCapInput = { chatId: 1, currentTurn: 200, currentUserMessage: HIGH_NOISE_QUERY };
  const atCapResult = getEpisodicMemoryForPrompt(atCap.db, atCapInput, env);
  assert.equal(
    atCapResult.facts.some((fact) => fact.id === atCap.answerId),
    true,
    "counterfactual: cap not exceeded → target injects"
  );
  assert.equal(atCapResult.facts.length, 1);
  atCap.db.close();

  const noisy = seedHighNoise(120);
  const input = { chatId: 1, currentTurn: 200, currentUserMessage: HIGH_NOISE_QUERY };
  const candidates = fetchEpisodicMemoryCandidatesForDebug(noisy.db, input, env);
  const result = getEpisodicMemoryForPrompt(noisy.db, input, env);
  const debug = result.debug.find((row) => row.id === noisy.answerId);
  assert.equal(candidates.rows.some((row) => row.id === noisy.answerId), true);
  assert.equal(result.facts.some((fact) => fact.id === noisy.answerId), true);
  assert.equal(result.facts.length, 1, "distractors must stay out of the prompt");
  assert.ok(debug);
  assert.equal(debug.relevance_pass, true);
  assert.equal(debug.would_inject, true);
  assert.equal(debug.blocked_reason, null);
  assert.equal(debug.duplicate_reason, null);
  console.info(
    JSON.stringify({
      caseId: "high-noise-distractors-01",
      candidateIncludesTarget: true,
      finalIncludesTarget: true,
      injectedCount: result.facts.length,
      targetDebug: debug,
      counts: {
        candidateRows: candidates.rows.length,
        debugRows: result.debug.length,
        relevancePass: result.debug.filter((row) => row.relevance_pass).length,
        ranked: result.debug.filter((row) => row.final_rank != null).length,
        budgetedOut: result.debug.filter((row) => row.budget_reason).length,
        injected: result.facts.length,
      },
    })
  );
  noisy.db.close();
});

it("high-noise extra budget or empty query alone do not explain the miss", () => {
  const { db, answerId } = seedHighNoise(120);
  const base = { chatId: 1, currentTurn: 200, currentUserMessage: HIGH_NOISE_QUERY };
  const extraBudget = getEpisodicMemoryForPrompt(
    db,
    { ...base, maxFacts: 32, maxChars: 4000, candidateLimit: 500 },
    env
  );
  const noQuery = getEpisodicMemoryForPrompt(db, { chatId: 1, currentTurn: 200, currentUserMessage: "" }, env);
  assert.equal(extraBudget.facts.some((fact) => fact.id === answerId), true);
  assert.equal(noQuery.facts.some((fact) => fact.id === answerId), false);
  console.info(
    JSON.stringify({
      caseId: "high-noise-counterfactual",
      extraBudgetHasTarget: true,
      emptyQueryBrowseHasTarget: false,
      extraBudgetInjected: extraBudget.facts.length,
      emptyQueryInjected: noQuery.facts.length,
    })
  );
  db.close();
});
