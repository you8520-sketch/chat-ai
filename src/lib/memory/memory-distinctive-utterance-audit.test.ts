import assert from "node:assert/strict";
import { it } from "node:test";
import {
  detectRelationshipLedgerOwnedFact,
  evaluateEpisodicRetrievalGuard,
  fetchEpisodicMemoryCandidatesForDebug,
  getEpisodicMemoryForPrompt,
  inspectLexicalRelevanceForDebug,
  persistEpisodicMemoryFactsCore,
  summarizeEpisodicFactPersistCandidates,
} from "@/lib/episodicMemoryFacts";
import {
  indexChatSynthetically,
  syntheticQuery,
} from "@/lib/memory/memory-episodic-semantic-synthetic.test";
import { openDb, saturate, seed } from "@/lib/memory/memory-rp-benchmark-suite";

const env = {
  MEMORY_FEATURE_ENABLED: "1",
  EPISODIC_MEMORY_RECALL_ENABLED: "1",
} as unknown as NodeJS.ProcessEnv;

const FACT = {
  category: "character" as const,
  subject: "rin",
  attribute: "utterance",
  value: "two_moons_return",
  importance: "normal" as const,
  fact_text: '린이 말했다: "달이 두 번 뜨는 밤에 돌아올게."',
  evidence_type: "explicit_scene_event" as const,
};

const PERSISTABLE_FACT = {
  ...FACT,
  fact_text: "린이 달이 두 번 뜨는 밤에 돌아오겠다고 말했다.",
};

const QUERY = "달이 두 번 뜨는 밤에 돌아온다던 린의 말을 묻는다";

function setupFixture() {
  const db = openDb();
  const [answerId] = seed(db, [
    [20, FACT.category, FACT.subject, FACT.attribute, FACT.value, FACT.importance, FACT.fact_text],
  ]);
  saturate(db, 60, 60);
  return { db, answerId: answerId! };
}

function relevanceHits(
  db: ReturnType<typeof openDb>,
  tokens: string[],
  minRecentTurn: number,
  targetId: number
) {
  const rows = db
    .prepare(
      `SELECT id, subject, attribute, value, fact_text
         FROM episodic_memory_facts
        WHERE source_turn < ?`
    )
    .all(minRecentTurn) as Array<{
    id: number;
    subject: string;
    attribute: string;
    value: string;
    fact_text: string;
  }>;
  const matched = rows.filter((row) => {
    const hay = `${row.subject} ${row.attribute} ${row.value} ${row.fact_text}`.toLowerCase();
    return tokens.some((token) => token.length >= 2 && hay.includes(token.toLowerCase()));
  });
  return {
    targetHit: matched.some((row) => row.id === targetId),
    candidateCount: matched.length,
    distractorCount: matched.filter((row) => row.id !== targetId).length,
  };
}

function morphologyPrefixTokens(tokens: string[]): string[] {
  const extra: string[] = [];
  for (const token of tokens) {
    if (token.length < 3) continue;
    extra.push(token.slice(0, token.length - 1));
    extra.push(token.slice(0, Math.max(2, token.length - 2)));
  }
  return [...new Set([...tokens, ...extra])].filter((token) => token.length >= 2).slice(0, 8);
}

function charBigramTokens(query: string): string[] {
  const hangul = query.replace(/[^가-힣]/g, "");
  const grams: string[] = [];
  for (let i = 0; i < hangul.length - 1 && grams.length < 8; i++) {
    grams.push(hangul.slice(i, i + 2));
  }
  return [...new Set(grams)];
}

it("distinctive-utterance: exact 게-ending is schema-rejected; complete sentence persists", () => {
  assert.equal(detectRelationshipLedgerOwnedFact(FACT), null);
  const rejected = summarizeEpisodicFactPersistCandidates([FACT]);
  assert.equal(rejected.insertableCount, 0);
  assert.ok(rejected.skippedReasons.some((reason) => reason.startsWith("schema_rejected")));

  const accepted = summarizeEpisodicFactPersistCandidates([PERSISTABLE_FACT]);
  assert.equal(accepted.insertableCount, 1);

  const db = openDb();
  assert.equal(
    persistEpisodicMemoryFactsCore(db, {
      chatId: 1,
      sourceTurn: 20,
      facts: [FACT],
      metadata: { memory_evidence_type: "explicit_scene_event", content_route: "safe" },
    }),
    0
  );
  assert.equal(
    persistEpisodicMemoryFactsCore(db, {
      chatId: 1,
      sourceTurn: 20,
      facts: [PERSISTABLE_FACT],
      metadata: { memory_evidence_type: "explicit_scene_event", content_route: "safe" },
    }),
    1
  );
  db.close();
});

it("distinctive-utterance: 게-ending seed reaches candidates then retrieve-schema drops it", () => {
  const { db, answerId } = setupFixture();
  const input = { chatId: 1, currentTurn: 250, currentUserMessage: QUERY };
  const candidates = fetchEpisodicMemoryCandidatesForDebug(db, input, env);
  const lanes = candidates.laneById.get(answerId) ?? [];
  const final = getEpisodicMemoryForPrompt(db, input, env);
  const lexical = inspectLexicalRelevanceForDebug(FACT, QUERY);
  const guard = evaluateEpisodicRetrievalGuard(
    db.prepare("SELECT * FROM episodic_memory_facts WHERE id=?").get(answerId) as Parameters<
      typeof evaluateEpisodicRetrievalGuard
    >[0]
  );
  console.info(
    JSON.stringify({
      caseId: "distinctive-utterance-01-seed",
      targetInRecent: lanes.includes("recent"),
      targetInRelevance: lanes.includes("relevance"),
      targetInMilestone:
        lanes.includes("milestone_critical") || lanes.includes("milestone_important"),
      targetInMerged: candidates.rows.some((row) => row.id === answerId),
      final: final.facts.some((fact) => fact.id === answerId),
      guard,
      lexicalTokensAfterFirst5: lexical.tokensAfterFirst5,
    })
  );
  assert.equal(lanes.includes("recent"), false);
  assert.equal(lanes.includes("relevance"), true);
  assert.equal(candidates.rows.some((row) => row.id === answerId), true);
  assert.equal(guard.allowed, false);
  assert.equal(guard.blockedReason, "invalid_fact_schema");
  assert.equal(final.facts.some((fact) => fact.id === answerId), false);
  db.close();
});

it("distinctive-utterance: persistable complete sentence is candidate+final", () => {
  const db = openDb();
  const persisted = persistEpisodicMemoryFactsCore(db, {
    chatId: 1,
    sourceTurn: 20,
    facts: [PERSISTABLE_FACT],
    metadata: { memory_evidence_type: "explicit_scene_event", content_route: "safe" },
  });
  assert.equal(persisted, 1);
  saturate(db, 60, 60);
  const input = { chatId: 1, currentTurn: 250, currentUserMessage: QUERY };
  const candidates = fetchEpisodicMemoryCandidatesForDebug(db, input, env);
  const targetId = candidates.rows.find((row) => row.fact_text === PERSISTABLE_FACT.fact_text)?.id;
  assert.ok(targetId, "persistable distinctive line must enter candidates");
  const final = getEpisodicMemoryForPrompt(db, input, env);
  assert.equal(final.facts.some((fact) => fact.id === targetId), true);
  assert.equal(final.facts.length, 1);
  db.close();
});

it("distinctive-utterance: one-gate counterfactuals A-E", async () => {
  const { db, answerId } = setupFixture();
  const input = { chatId: 1, currentTurn: 250, currentUserMessage: QUERY };
  const candidates = fetchEpisodicMemoryCandidatesForDebug(db, input, env);
  const recentTurns = candidates.rows
    .filter((row) => (candidates.laneById.get(row.id) ?? []).includes("recent"))
    .map((row) => row.source_turn);
  const minRecentTurn = recentTurns.length > 0 ? Math.min(...recentTurns) : 250;

  const strippedOnly = ["돌아온다던", "묻는다"];
  const surfaceTokens = QUERY.split(/[^a-z0-9가-힣_]+/i)
    .map((raw) => raw.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter((token) => token.length >= 2);
  const A = relevanceHits(db, strippedOnly.slice(0, 5), minRecentTurn, answerId);
  const B = relevanceHits(db, strippedOnly, minRecentTurn, answerId);
  const C = relevanceHits(db, morphologyPrefixTokens(strippedOnly), minRecentTurn, answerId);
  const D = relevanceHits(db, charBigramTokens(QUERY), minRecentTurn, answerId);
  const surface = relevanceHits(db, surfaceTokens, minRecentTurn, answerId);

  await indexChatSynthetically(db, 1);
  const semantic = fetchEpisodicMemoryCandidatesForDebug(
    db,
    { ...input, semanticQuery: await syntheticQuery(QUERY) },
    env
  );
  const E = {
    targetHit: semantic.rows.some((row) => row.id === answerId),
    candidateCount: semantic.rows.length,
    distractorCount: semantic.rows.filter((row) => row.id !== answerId).length,
    semanticAdded: semantic.stats.semantic?.added ?? 0,
  };

  console.info(
    JSON.stringify({
      caseId: "distinctive-utterance-counterfactual",
      minRecentTurn,
      A_currentStrippedFirst5: { tokens: strippedOnly.slice(0, 5), ...A },
      B_allStrippedNoFirst5: { tokens: strippedOnly, ...B },
      C_morphologyOnStrippedOnly: { tokens: morphologyPrefixTokens(strippedOnly), ...C },
      D_charBigrams: { tokens: charBigramTokens(QUERY), ...D },
      surfaceTokensKeep: { tokens: surfaceTokens, ...surface },
      E_syntheticSemantic: E,
    })
  );

  assert.equal(A.targetHit, false);
  assert.equal(B.targetHit, false);
  assert.equal(C.targetHit, false);
  assert.equal(D.targetHit, true);
  assert.equal(surface.targetHit, true);
  assert.equal(surface.distractorCount, 0);
  assert.equal(E.semanticAdded, 0);
  db.close();
});

it("held-out Korean surface overlap: quoted line enters candidates", () => {
  const db = openDb();
  const [answerId] = seed(db, [
    [20, "character", "sol", "utterance", "first_snow", "normal", "솔이 첫눈 오는 날 다시 만나자고 말했다."],
  ]);
  saturate(db, 60, 60);
  const query = "첫눈 오는 날 다시 만난다고 말했던 내용을 묻는다";
  const input = { chatId: 1, currentTurn: 250, currentUserMessage: query };
  const candidates = fetchEpisodicMemoryCandidatesForDebug(db, input, env);
  const final = getEpisodicMemoryForPrompt(db, input, env);
  assert.equal(candidates.rows.some((row) => row.id === answerId), true);
  assert.equal(final.facts.some((fact) => fact.id === answerId), true);
  assert.equal(final.facts.length, 1);
  db.close();
});

it("held-out Korean surface overlap: entrusted place is not ledger-owned", () => {
  const fact = {
    category: "setting" as const,
    subject: "lighthouse_key",
    attribute: "stored_at",
    value: "third_drawer",
    importance: "normal" as const,
    fact_text: "낡은 등대 열쇠는 서랍 셋째 칸에 맡겨두었다.",
    evidence_type: "explicit_scene_event" as const,
  };
  assert.equal(detectRelationshipLedgerOwnedFact(fact), null);
  const db = openDb();
  const [answerId] = seed(db, [
    [20, fact.category, fact.subject, fact.attribute, fact.value, fact.importance, fact.fact_text],
  ]);
  saturate(db, 60, 60);
  const input = {
    chatId: 1,
    currentTurn: 250,
    currentUserMessage: "낡은 등대 열쇠를 맡겨둔 곳을 묻는다",
  };
  const candidates = fetchEpisodicMemoryCandidatesForDebug(db, input, env);
  const final = getEpisodicMemoryForPrompt(db, input, env);
  assert.equal(candidates.rows.some((row) => row.id === answerId), true);
  assert.equal(final.facts.some((fact) => fact.id === answerId), true);
  db.close();
});
