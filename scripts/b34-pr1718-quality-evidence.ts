/**
 * B34 PR #1718 — live Luna quality evidence (isolated DB, benchmark key only).
 * No production code changes. Writes under docs/evidence/b34-pr1718/.
 *
 * Usage (from repo root):
 *   node --conditions=react-server --import tsx scripts/b34-pr1718-quality-evidence.ts
 */
import Module from "module";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";

const ol = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return ol(request, parent, isMain);
} as typeof Module._load;

import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import type { EpisodicExtractedFact } from "@/lib/memory/memory-episodic-types";

const OUT_DIR = path.join(process.cwd(), "docs/evidence/b34-pr1718");
const RUNS_PATH = path.join(OUT_DIR, "live-runs-detailed.jsonl");
const FX = 1530 * 1.02;

const bench = process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY?.trim() ?? "";
if (!bench || bench === (process.env.CHEAPER_INFERENCE_API_KEY?.trim() ?? "")) {
  throw new Error("CHEAPER_INFERENCE_BENCHMARK_API_KEY must differ from production CHEAPER_INFERENCE_API_KEY");
}
process.env.CHEAPER_INFERENCE_API_KEY = bench;
delete process.env.OPENROUTER_API_KEY;
process.env.MEMORY_FEATURE_ENABLED = "1";
delete process.env.NODE_TEST_CONTEXT;

const N = Math.min(5, Math.max(1, Number(process.env.B34_EVIDENCE_N ?? "5")));

type DropStage =
  | "schema_rejected"
  | "contamination"
  | "relationship_ledger_owned"
  | "abstract_psychological_inference"
  | "unverified_canonicalization"
  | "unsupported_evidence"
  | "within_response_dedupe"
  | "parse_sanitizer_rejected"
  | "evidence_rejected_at_persist"
  | "insertable";

function auditPersistPipeline(
  fact: EpisodicExtractedFact,
  detect: {
    contamination: (f: EpisodicExtractedFact) => string | null;
    ledger: (f: EpisodicExtractedFact) => string | null;
    psychological: (f: EpisodicExtractedFact) => string | null;
    unverified: (f: EpisodicExtractedFact) => string | null;
    unsupported: (f: EpisodicExtractedFact) => boolean;
  }
): { stage: DropStage; detail: string | null } {
  const c = detect.contamination(fact);
  if (c) return { stage: "contamination", detail: c };
  const l = detect.ledger(fact);
  if (l) return { stage: "relationship_ledger_owned", detail: l };
  const p = detect.psychological(fact);
  if (p) return { stage: "abstract_psychological_inference", detail: p };
  const u = detect.unverified(fact);
  if (u) return { stage: "unverified_canonicalization", detail: u };
  if (detect.unsupported(fact)) return { stage: "unsupported_evidence", detail: "unsupported_evidence" };
  return { stage: "insertable", detail: null };
}

function factRow(f: EpisodicExtractedFact | Record<string, unknown>) {
  const fact = f as EpisodicExtractedFact;
  return {
    category: fact.category,
    subject: fact.subject,
    attribute: fact.attribute,
    value: fact.value,
    evidence_type: fact.evidence_type,
    fact_text: fact.fact_text,
    source_role: fact.evidence?.source_role ?? null,
    source_quote: fact.evidence?.source_quote ?? null,
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  installIsolatedTestDatabase();

  const {
    detectAbstractPsychologicalInference,
    detectEpisodicMemoryContamination,
    detectRelationshipLedgerOwnedFact,
    detectUnverifiedCanonicalization,
    detectUnsupportedEvidenceFact,
    summarizeEpisodicFactPersistCandidates,
  } = await import("@/lib/episodicMemoryFacts");
  const { sanitizeEpisodicExtractedFacts } = await import("@/lib/memory/memory-episodic-normalize");
  const { parseSharedEpisodicSection } = await import("@/lib/memory/memory-episodic-shared");
  const { BACKGROUND_OPENROUTER_MODEL, callBackgroundMemory } = await import("@/lib/ai");
  const { buildPostTurnSharedInitialResponseFormat } = await import("@/lib/postTurnSharedInitial/schema");
  const { runPostTurnSharedInitial } = await import("@/lib/postTurnSharedInitial/run");
  const { DEFAULT_STATUS_WIDGET } = await import("@/lib/statusWidget/defaultTemplate");
  const { collectWidgetJsonKeys } = await import("@/lib/statusWidget/prompt");
  const { REN_WOLFGANG_USER_TEXT: U, REN_WOLFGANG_ASSISTANT_TEXT: A } = await import(
    "@/lib/test/renWolfgangSafeFixture"
  );
  const { resolveActiveAssistantGenerationScope } = await import("@/lib/assistantGenerationScope");
  const { startIndependentEpisodicExtraction } = await import("@/lib/memory/memory-episodic-independent");
  const { scheduleMemoryUpdate } = await import("@/lib/memory/memory-manager");
  const { getOrCreateChatMemory } = await import("@/lib/memory/memory-db");
  const { getDb } = await import("@/lib/db");

  const detect = {
    contamination: (f: EpisodicExtractedFact) => detectEpisodicMemoryContamination(f),
    ledger: (f: EpisodicExtractedFact) => detectRelationshipLedgerOwnedFact(f),
    psychological: (f: EpisodicExtractedFact) =>
      detectAbstractPsychologicalInference(f) ? "abstract_psychological_inference" : null,
    unverified: (f: EpisodicExtractedFact) => detectUnverifiedCanonicalization(f),
    unsupported: (f: EpisodicExtractedFact) =>
      Boolean(detectUnsupportedEvidenceFact(f, U, undefined, null)),
  };

  const executionConditions = {
    model: BACKGROUND_OPENROUTER_MODEL,
    fixture: "src/lib/test/renWolfgangSafeFixture.ts (B32 렌/볼프강 SAFE wire)",
    userMessageChars: U.length,
    assistantMessageChars: A.length,
    database: "installIsolatedTestDatabase() temp SQLite (not production)",
    credential: "CHEAPER_INFERENCE_BENCHMARK_API_KEY (distinct from production key)",
    memoryFeature: "MEMORY_FEATURE_ENABLED=1",
    runsPerPath: N,
    codeHead: "f65c42e09fde958bc22985e322a417220052d8ba",
  };

  writeFileSync(path.join(OUT_DIR, "execution-conditions.json"), JSON.stringify(executionConditions, null, 2));

  const db = getDb();
  const USER = 934901;
  const CHAR = 934903;
  db.prepare(`INSERT OR IGNORE INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    "b34-evidence@test.local",
    "b34ev",
    "x"
  );
  db.prepare(`INSERT OR IGNORE INTO characters (id, name) VALUES (?,?)`).run(CHAR, "볼프강");

  let chatCounter = 0;
  function seedTurn() {
    chatCounter += 1;
    const chatId = 934900 + chatCounter * 10;
    const u = chatId * 10 + 1;
    const a = chatId * 10 + 2;
    db.prepare(`INSERT INTO chats (id, user_id, character_id, mode, memory_meta) VALUES (?,?,?,'safe','{}')`).run(
      chatId,
      USER,
      CHAR
    );
    getOrCreateChatMemory(chatId, USER, CHAR, "free");
    db.prepare(`INSERT INTO messages (id, chat_id, role, content) VALUES (?,?,?,?)`).run(u, chatId, "user", U);
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, model, alternates, active_variant)
       VALUES (?, ?, 'assistant', ?, ?, 'completed', 'live', '[]', 0)`
    ).run(a, chatId, A, u);
    return { chatId, u, a };
  }

  function auditRawFacts(rawFacts: unknown[]) {
    const sanitized = sanitizeEpisodicExtractedFacts(rawFacts, {
      requireEvidence: true,
      requireSourceQuote: true,
    });
    const sanitizedKeys = new Set(sanitized.map((f) => JSON.stringify(factRow(f))));
    return rawFacts.map((raw) => {
      const singleSan = sanitizeEpisodicExtractedFacts([raw], {
        requireEvidence: true,
        requireSourceQuote: true,
      });
      if (singleSan.length === 0) {
        return {
          ...factRow(raw as EpisodicExtractedFact),
          parse_valid: false,
          parse_drop: "schema_or_sanitizer_rejected",
          persist_stage: "parse_sanitizer_rejected" as DropStage,
          persist_detail: null,
          stored: false,
        };
      }
      const f = singleSan[0]!;
      const inParseSet = sanitizedKeys.has(JSON.stringify(factRow(f)));
      const pipe = auditPersistPipeline(f, detect);
      return {
        ...factRow(f),
        parse_valid: inParseSet,
        parse_drop: inParseSet ? null : "deduped_or_collapsed_in_batch",
        persist_stage: pipe.stage,
        persist_detail: pipe.detail,
        stored: false,
      };
    });
  }

  let totalUsd = 0;

  const prev: Record<string, string> = {};
  for (const k of collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET)) prev[k] = "(자리비움)";
  const sharedInput = {
    mode: "character" as const,
    charName: "볼프강",
    personaName: "렌",
    characterIdentity: "볼프강: 국경 야영지를 지휘하는 중년의 대장. 과묵하고 규정에 충실하다.",
    userPersona: null,
    personaDescription: null,
    personaSpeechExamples: null,
    userMessage: U,
    assistantProse: A,
    previousAssistantProse: "",
    characterWidget: DEFAULT_STATUS_WIDGET,
    userWidget: null,
    previousCharacterValues: prev,
    previousUserValues: null,
    primaryModelId: BACKGROUND_OPENROUTER_MODEL,
    includeSuggestions: true,
    includeRelationship: true,
    includeEpisodic: true,
    relationshipRegenContext: null,
    activePromises: [] as string[],
    episodicCorrectionCandidates: [] as const,
  };

  const sharedCaller = async (system: string, history: { role: string; content: string }[], opts: {
    requestKind: string;
    maxTokens?: number;
    temperature?: number;
    modelId?: string;
  }) =>
    callBackgroundMemory(system, history as never, undefined, opts.requestKind, {
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      modelId: opts.modelId,
      responseFormat: buildPostTurnSharedInitialResponseFormat(sharedInput),
    });

  for (let i = 0; i < N; i++) {
    const r = await runPostTurnSharedInitial(sharedInput, sharedCaller as never);
    const usd = r.usage?.cheaperInferenceBilledCostUsd ?? r.usage?.upstreamCostUsd ?? 0;
    totalUsd += usd;
    let parsedTop: unknown = null;
    let rawFacts: unknown[] = [];
    try {
      parsedTop = JSON.parse(r.text);
      const episodic = (parsedTop as { episodic?: { extracted_facts?: unknown[] } }).episodic;
      rawFacts = episodic?.extracted_facts ?? [];
    } catch {
      rawFacts = [];
    }
    const section = parseSharedEpisodicSection(
      (parsedTop as { episodic?: unknown } | null)?.episodic ?? null
    );
    const persist = summarizeEpisodicFactPersistCandidates(rawFacts, { sourceUserText: U });
    const factAudits = auditRawFacts(rawFacts);

    const rec = {
      path: "OLD_shared_status_on",
      run: i + 1,
      requestKind: "background-post-turn-shared-initial",
      inputTokens: r.usage?.inputTokens,
      outputTokens: r.usage?.outputTokens,
      usd,
      krw: usd * FX,
      transportOk: r.transportOk,
      finishReason: r.finishReason,
      providerText: r.text,
      sectionPresent: section.present,
      sectionValid: section.valid,
      rawFactCount: rawFacts.length,
      parseValidFactCount: section.facts.length,
      persistInsertableCount: persist.insertableCount,
      persistSkippedReasons: persist.skippedReasons,
      facts: factAudits,
    };
    appendFileSync(RUNS_PATH, JSON.stringify(rec) + "\n");
    console.log("OLD", i + 1, rawFacts.length, section.facts.length, usd);
  }

  const episodicOnlyInput = {
    charName: "볼프강",
    personaName: "렌",
    userMessage: U,
    assistantProse: A,
    primaryModelId: BACKGROUND_OPENROUTER_MODEL,
    includeSuggestions: false,
    includeRelationship: false,
    includeEpisodic: true,
    previousAssistantMessage: null,
    activePromises: [] as string[],
    episodicCorrectionCandidates: [] as const,
  };

  for (let i = 0; i < N; i++) {
    const turn = seedTurn();
    const scope = resolveActiveAssistantGenerationScope(turn.a)!;
    let capturedProviderText: string | null = null;
    let capturedUsage: { inputTokens?: number; outputTokens?: number; cheaperInferenceBilledCostUsd?: number; upstreamCostUsd?: number } | null =
      null;
    const capturingCaller = async (
      system: string,
      history: { role: string; content: string }[],
      opts: { requestKind: string; maxTokens?: number; temperature?: number; modelId?: string }
    ) => {
      const res = await callBackgroundMemory(system, history as never, undefined, opts.requestKind, {
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        modelId: opts.modelId,
        responseFormat: buildPostTurnSharedInitialResponseFormat({
          ...episodicOnlyInput,
          mode: "relationship_only",
          requestKind: "background-post-turn-shared-initial-episodic",
        } as never),
      });
      capturedProviderText = res.text;
      capturedUsage = res.usage;
      return res;
    };
    const outcomePromise = startIndependentEpisodicExtraction(
      {
        eligible: true,
        chatId: turn.chatId,
        assistantMessageId: turn.a,
        sourceUserMessageId: turn.u,
        generationScope: scope,
        charName: "볼프강",
        personaName: "렌",
        userMessage: U,
        assistantProse: A,
        correctionCandidates: [],
      },
      { caller: capturingCaller as never }
    );
    await scheduleMemoryUpdate({
      chatId: turn.chatId,
      userId: USER,
      characterId: CHAR,
      relationshipNames: { charName: "볼프강", userName: "렌" } as never,
      tier: "free",
      memoryCapacity: 10000,
      userMessage: U,
      assistantMessage: A,
      assistantMessageId: turn.a,
      sourceUserMessageId: turn.u,
      route: "safe",
      relationshipSharedAttempted: true,
      relationshipSharedParsed: false,
      generationScope: scope,
      episodicExtraction: outcomePromise,
    });
    const outcome = await outcomePromise;
    const rows = db
      .prepare(`SELECT fact_text, metadata FROM episodic_memory_facts WHERE chat_id=? ORDER BY id`)
      .all(turn.chatId) as { fact_text: string; metadata: string }[];
    const storedTexts = new Set(rows.map((r) => r.fact_text));

    let usd = 0;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    if (outcome.status === "extracted" && outcome.episodic) {
      const parsedFacts = outcome.episodic.facts;
      const persist = summarizeEpisodicFactPersistCandidates(parsedFacts, { sourceUserText: U });
      const factAudits = parsedFacts.map((f) => {
        const pipe = auditPersistPipeline(f, detect);
        return {
          ...factRow(f),
          parse_valid: true,
          parse_drop: null,
          persist_stage: pipe.stage,
          persist_detail: pipe.detail,
          stored: storedTexts.has(String(f.fact_text)),
        };
      });
      const { listProviderCostEventsForAssistantGeneration } = await import("@/lib/providerCostLedger");
      const ledgerRows = listProviderCostEventsForAssistantGeneration(turn.a, scope.generationSequence, db).filter(
        (row) => row.request_kind === "background-post-turn-shared-initial-episodic"
      );
      const ledger = ledgerRows[ledgerRows.length - 1];
      usd =
        capturedUsage?.cheaperInferenceBilledCostUsd ??
        capturedUsage?.upstreamCostUsd ??
        ledger?.upstream_cost_usd ??
        (ledger?.cost_krw != null ? ledger.cost_krw / FX : 0);
      inputTokens = capturedUsage?.inputTokens ?? ledger?.input_tokens;
      outputTokens = capturedUsage?.outputTokens ?? ledger?.output_tokens;
      totalUsd += usd;

      const rec = {
        path: "NEW_independent_episodic",
        run: i + 1,
        requestKind: "background-post-turn-shared-initial-episodic",
        independentStatus: outcome.status,
        inputTokens,
        outputTokens,
        usd,
        krw: usd * FX,
        providerText: capturedProviderText,
        sectionPresent: outcome.episodic.present,
        sectionValid: outcome.episodic.valid,
        rawFactCount: outcome.episodic.rawFactCount ?? parsedFacts.length,
        parseValidFactCount: parsedFacts.length,
        persistInsertableCount: persist.insertableCount,
        persistSkippedReasons: persist.skippedReasons,
        storedRowCount: rows.length,
        facts: factAudits,
      };
      appendFileSync(RUNS_PATH, JSON.stringify(rec) + "\n");
      console.log("NEW", i + 1, parsedFacts.length, rows.length, usd);
    } else {
      const rec = {
        path: "NEW_independent_episodic",
        run: i + 1,
        independentStatus: outcome.status,
        facts: [],
      };
      appendFileSync(RUNS_PATH, JSON.stringify(rec) + "\n");
    }
  }

  writeFileSync(
    path.join(OUT_DIR, "cost-summary.json"),
    JSON.stringify({ totalUsd, totalKrw: totalUsd * FX, fxEffectiveKrwPerUsd: FX, runsPerPath: N }, null, 2)
  );

  uninstallIsolatedTestDatabase();
  console.log("DONE totalUsd", totalUsd, "krw", totalUsd * FX);
}

main().catch((e) => {
  console.error(String(e?.stack ?? e).slice(0, 2000));
  process.exitCode = 1;
});
