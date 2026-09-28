import fs from "node:fs";
import path from "node:path";

import {
  callJevDecisions,
  type JevDecisionQuestions,
} from "@/lib/jevDecisions";
import {
  AUTHORIAL_HABIT_JEV_CORPUS,
  type AuthorialHabitSemanticVerdict,
} from "@/lib/authorialHabitJevCorpus";
import {
  buildAuthorialHabitJevQuestions,
  buildAuthorialHabitJevState,
  evaluateAuthorialHabitCandidate,
  parseAuthorialHabitJevVerdict,
} from "@/lib/authorialHabitJevJudge";
import {
  buildCompletionIntegrityJevQaQuestions,
  buildCompletionIntegrityJevQaState,
  parseCompletionIntegrityJevVerdict,
  type CompletionIntegrityJevVerdict,
} from "@/lib/completionIntegrityJevQa";
import {
  buildSceneBoundaryJevQaQuestions,
  buildSceneBoundaryJevQaState,
  type SceneBoundaryJevVerdict,
} from "@/lib/sceneBoundaryJevQa";
import type { BoundaryExecutionContract } from "@/lib/sceneDirectiveV2";
import {
  OPENROUTER_JEV_BENCHMARK_ENV,
  sanitizeAuthorialHabitBenchmarkCredentialText,
  withIsolatedAuthorialHabitBenchmarkOpenRouterKey,
} from "./lib/authorialHabitJevBenchmarkCredential";

const MODELS = [
  "typesafe/jev-1.13",
  "respan/span-01-lite",
  "respan/span-01",
] as const;

type ModelId = (typeof MODELS)[number];
type Expected = AuthorialHabitSemanticVerdict | CompletionIntegrityJevVerdict | SceneBoundaryJevVerdict;

type Row = {
  suite: "authorial_habit" | "completion_integrity" | "scene_boundary";
  fixtureId: string;
  model: ModelId;
  expected: Expected;
  verdict: string | null;
  correct: boolean;
  criticalPositive: boolean;
  criticalMiss: boolean;
  malformed: boolean;
  failure: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  confidence: number | null;
  probabilities: Record<string, number> | null;
  servedModel: string | null;
};

const COMPLETION_FIXTURES: Array<{
  id: string;
  expected: CompletionIntegrityJevVerdict;
  finalProse: string;
  candidateReasons: Array<"endsIncomplete" | "needsResponseLengthFix" | "tokenLimitFinish" | "localRecoveryApplied" | "missingFinishReasonIncomplete">;
  finishReason: string | null;
}> = [
  { id: "CI_ABRUPT_01", expected: "ABRUPT_CUT", finalProse: "서린은 민의 손목을 잡은 채 조금 더 끌", candidateReasons: ["endsIncomplete", "tokenLimitFinish"], finishReason: "MAX_TOKENS" },
  { id: "CI_ABRUPT_02", expected: "ABRUPT_CUT", finalProse: "그가 입술을 열었다. \"잠깐, 그건 내가", candidateReasons: ["endsIncomplete"], finishReason: null },
  { id: "CI_ABRUPT_03", expected: "ABRUPT_CUT", finalProse: "문이 열리자 그는 뒤를 돌아보며 손을", candidateReasons: ["endsIncomplete"], finishReason: null },
  { id: "CI_COMPLETE_01", expected: "COMPLETE", finalProse: "서린은 창문을 닫고 천천히 소파에 앉았다.", candidateReasons: ["tokenLimitFinish"], finishReason: "LENGTH" },
  { id: "CI_COMPLETE_02", expected: "COMPLETE", finalProse: "그는 마지막 문장을 다 쓰고 펜을 내려놓았다.", candidateReasons: ["tokenLimitFinish"], finishReason: "MAX_TOKENS" },
  { id: "CI_COMPLETE_03", expected: "COMPLETE", finalProse: "그는 대답 대신 창밖을 바라보았다.", candidateReasons: ["localRecoveryApplied"], finishReason: "STOP" },
  { id: "CI_UNCERTAIN_01", expected: "UNCERTAIN", finalProse: "그 순간—", candidateReasons: ["endsIncomplete"], finishReason: null },
  { id: "CI_UNCERTAIN_02", expected: "UNCERTAIN", finalProse: "아직.", candidateReasons: ["localRecoveryApplied"], finishReason: "STOP" },
  { id: "CI_UNCERTAIN_03", expected: "UNCERTAIN", finalProse: "그리고 다시, 침묵.", candidateReasons: ["localRecoveryApplied"], finishReason: "STOP" },
];

const BOUNDARY_CONTRACT: BoundaryExecutionContract = {
  lifecycle: "temporary_quiet",
  noContactKind: "temporary_quiet",
  blocksPhysicalApproach: true,
  blocksRemoteContact: true,
  blocksGiftOrDropOff: true,
  blocksBoundaryNegotiation: true,
  blocksFutureMeetingInitiative: true,
  allowsIndependentRoutine: true,
  allowsInternalAftereffect: true,
};

const SCENE_FIXTURES: Array<{
  id: string;
  expected: SceneBoundaryJevVerdict;
  prose: string;
  signals: Array<"physical_revisit" | "remote_contact" | "gift_drop_off" | "future_meeting_request" | "boundary_clarification" | "relationship_closure_demand">;
}> = [
  { id: "SB_VIOLATION_01", expected: "VIOLATION", prose: "서린은 민에게 메시지를 전송했다.", signals: ["remote_contact"] },
  { id: "SB_VIOLATION_02", expected: "VIOLATION", prose: "서린은 다시 민의 현관문 앞으로 돌아갔다. 초인종을 눌렀다.", signals: ["physical_revisit"] },
  { id: "SB_VIOLATION_03", expected: "VIOLATION", prose: "서린은 민의 문 앞에 작은 봉투를 내려놓고 돌아섰다.", signals: ["gift_drop_off"] },
  { id: "SB_VIOLATION_04", expected: "VIOLATION", prose: "서린은 내일 다시 만나자고 민에게 제안했다.", signals: ["future_meeting_request"] },
  { id: "SB_VIOLATION_05", expected: "VIOLATION", prose: "서린은 왜 연락하지 말라는 건지 이유를 민에게 물었다.", signals: ["boundary_clarification"] },
  { id: "SB_COMPLIANT_01", expected: "COMPLIANT", prose: "메시지를 보내고 싶은 충동은 남았지만, 서린은 휴대폰을 뒤집어 놓고 자기 집으로 들어갔다.", signals: ["remote_contact"] },
  { id: "SB_COMPLIANT_02", expected: "COMPLIANT", prose: "민의 집 쪽으로 향할 생각이 스쳤다. 서린은 그 생각을 접고 반대편 골목으로 걸었다.", signals: ["physical_revisit"] },
  { id: "SB_COMPLIANT_03", expected: "COMPLIANT", prose: "왜 그런지 묻고 싶었다. 하지만 그 이유를 캐묻는 것 역시 선을 넘는 일이라 입을 다물었다.", signals: ["boundary_clarification"] },
  { id: "SB_UNCERTAIN_01", expected: "INSUFFICIENT_CONTEXT", prose: "서린은 휴대폰 화면에 떠 있는 민의 이름을 오래 바라보았다.", signals: ["remote_contact"] },
  { id: "SB_UNCERTAIN_02", expected: "INSUFFICIENT_CONTEXT", prose: "내일이라는 단어가 메모장 한쪽에 남아 있었다.", signals: ["future_meeting_request"] },
];

function toSpanCompatibleState(
  suite: Row["suite"],
  rawState: string | Record<string, unknown> | string[]
): Record<string, unknown> {
  if (typeof rawState === "string" || Array.isArray(rawState)) {
    return {
      input: [{ role: "system", content: "Evaluate the assistant output under the supplied benchmark task." }],
      output: { role: "assistant", content: typeof rawState === "string" ? rawState : rawState.join("\n") },
    };
  }
  const state = { ...rawState };
  let outputText = "";
  if (suite === "authorial_habit") {
    outputText = typeof state.excerpt === "string" ? state.excerpt : "";
    delete state.excerpt;
  } else if (suite === "completion_integrity") {
    outputText = typeof state.finalProseTail === "string" ? state.finalProseTail : "";
    delete state.finalProseTail;
  } else {
    outputText =
      typeof state.assistantOutputUnderReview === "string"
        ? state.assistantOutputUnderReview
        : "";
    delete state.assistantOutputUnderReview;
  }
  return {
    input: [
      {
        role: "system",
        content:
          "Benchmark task metadata and canonical constraints:\n" +
          JSON.stringify(state),
      },
    ],
    output: { role: "assistant", content: outputText },
  };
}

function toSpanNoulQuestions(questions: JevDecisionQuestions): JevDecisionQuestions {
  const out: JevDecisionQuestions = {};
  for (const [questionId, spec] of Object.entries(questions)) {
    if (spec.type !== "choice" || !spec.criteria || Array.isArray(spec.criteria)) {
      throw new Error("span_benchmark_requires_single_choice_question");
    }
    for (const [label, definition] of Object.entries(spec.criteria as Record<string, string>)) {
      out[`${questionId}__${label}`] = {
        type: "noul",
        instructions:
          `Behavior label ${label}. ${definition} "Judge whether this label is the best semantic description of the assistant output under the supplied constraints. " +
          "Treat competing labels as alternatives; return the probability this label applies.",
      };
    }
  }
  return out;
}

function parseSpanArgmax(
  originalQuestions: JevDecisionQuestions,
  answers: Record<string, { type?: string; noul?: number }>
): { verdict: string | null; probabilities: Record<string, number> | null } {
  const entry = Object.entries(originalQuestions)[0];
  if (!entry) return { verdict: null, probabilities: null };
  const [questionId, spec] = entry;
  if (spec.type !== "choice" || !spec.criteria || Array.isArray(spec.criteria)) {
    return { verdict: null, probabilities: null };
  }
  const probabilities: Record<string, number> = {};
  for (const label of Object.keys(spec.criteria as Record<string, string>)) {
    const answer = answers[`${questionId}__${label}`];
    if (!answer || answer.type !== "noul" || typeof answer.noul !== "number") {
      return { verdict: null, probabilities: null };
    }
    probabilities[label] = answer.noul;
  }
  const ranked = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  return { verdict: ranked[0]?.[0] ?? null, probabilities };
}

function parseSceneVerdict(answers: Record<string, { type?: string; choice?: string }>): SceneBoundaryJevVerdict | null {
  const row = answers.boundary_verdict;
  const choice = row?.type === "choice" && typeof row.choice === "string" ? row.choice.trim() : "";
  return choice === "VIOLATION" || choice === "COMPLIANT" || choice === "INSUFFICIENT_CONTEXT"
    ? choice
    : null;
}

async function callOne(input: {
  benchmarkKey: string;
  model: ModelId;
  suite: Row["suite"];
  fixtureId: string;
  expected: Expected;
  criticalPositive: boolean;
  state: string | Record<string, unknown> | string[];
  questions: JevDecisionQuestions;
  parse: (answers: Record<string, { type?: string; choice?: string }>) => string | null;
}): Promise<Row> {
  const started = performance.now();
  try {
    const result = await withIsolatedAuthorialHabitBenchmarkOpenRouterKey(
      input.benchmarkKey,
      () =>
        callJevDecisions({
          model: input.model,
          state: input.model.startsWith("respan/")
            ? toSpanCompatibleState(input.suite, input.state)
            : input.state,
          questions: input.model.startsWith("respan/")
            ? toSpanNoulQuestions(input.questions)
            : input.questions,
          ledger: null,
          timeoutMs: 60_000,
        })
    );
    const spanParsed = input.model.startsWith("respan/")
      ? parseSpanArgmax(
          input.questions,
          result.answers as Record<string, { type?: string; noul?: number }>
        )
      : null;
    const verdict = spanParsed
      ? spanParsed.verdict
      : input.parse(result.answers as Record<string, { type?: string; choice?: string }>);
    const answer = Object.values(result.answers)[0];
    const probabilities = spanParsed
      ? spanParsed.probabilities
      : answer && "probabilities" in answer && answer.probabilities && typeof answer.probabilities === "object"
        ? answer.probabilities as Record<string, number>
        : null;
    const confidence = spanParsed && spanParsed.probabilities
      ? Math.max(...Object.values(spanParsed.probabilities))
      : answer && "confidence" in answer && typeof answer.confidence === "number"
        ? answer.confidence
        : null;
    return {
      suite: input.suite,
      fixtureId: input.fixtureId,
      model: input.model,
      expected: input.expected,
      verdict,
      correct: verdict === input.expected,
      criticalPositive: input.criticalPositive,
      criticalMiss: input.criticalPositive && verdict !== input.expected,
      malformed: verdict == null,
      failure: verdict == null ? "unmappable_verdict" : null,
      latencyMs: Math.round((performance.now() - started) * 10) / 10,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costUsd: result.usage.upstreamCostUsd ?? null,
      confidence,
      probabilities,
      servedModel: result.responseModel,
    };
  } catch (error) {
    return {
      suite: input.suite,
      fixtureId: input.fixtureId,
      model: input.model,
      expected: input.expected,
      verdict: null,
      correct: false,
      criticalPositive: input.criticalPositive,
      criticalMiss: input.criticalPositive,
      malformed: true,
      failure: sanitizeAuthorialHabitBenchmarkCredentialText((error as Error).message || "provider_error").slice(0, 300),
      latencyMs: Math.round((performance.now() - started) * 10) / 10,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      confidence: null,
      probabilities: null,
      servedModel: null,
    };
  }
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? null;
}

function summarize(rows: Row[]) {
  return MODELS.map((model) => {
    const modelRows = rows.filter((row) => row.model === model);
    const bySuite = ["authorial_habit", "completion_integrity", "scene_boundary"].map((suite) => {
      const suiteRows = modelRows.filter((row) => row.suite === suite);
      return {
        suite,
        total: suiteRows.length,
        correct: suiteRows.filter((row) => row.correct).length,
        accuracy: suiteRows.length ? suiteRows.filter((row) => row.correct).length / suiteRows.length : null,
        criticalMisses: suiteRows.filter((row) => row.criticalMiss).length,
        malformed: suiteRows.filter((row) => row.malformed).length,
        failures: suiteRows.filter((row) => row.failure != null).length,
      };
    });
    const latencies = modelRows.filter((row) => row.failure == null).map((row) => row.latencyMs);
    const costs = modelRows.map((row) => row.costUsd).filter((value): value is number => value != null);
    return {
      model,
      total: modelRows.length,
      correct: modelRows.filter((row) => row.correct).length,
      accuracy: modelRows.length ? modelRows.filter((row) => row.correct).length / modelRows.length : null,
      criticalMisses: modelRows.filter((row) => row.criticalMiss).length,
      malformed: modelRows.filter((row) => row.malformed).length,
      failures: modelRows.filter((row) => row.failure != null).length,
      inputTokens: modelRows.reduce((sum, row) => sum + row.inputTokens, 0),
      outputTokens: modelRows.reduce((sum, row) => sum + row.outputTokens, 0),
      reportedCostUsd: costs.length === modelRows.length ? costs.reduce((a, b) => a + b, 0) : null,
      latencyMs: {
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        max: latencies.length ? Math.max(...latencies) : null,
      },
      bySuite,
    };
  });
}

async function main() {
  if (process.env.REGULAR_TEST_REAL_PROVIDER_CALLS !== "1" || process.env.REAL_SPAN_JEV_COMPARISON !== "1") {
    console.log("NOT_RUN — explicit live benchmark opt-in absent; provider calls=0");
    return;
  }
  const benchmarkKey = process.env[OPENROUTER_JEV_BENCHMARK_ENV]?.trim();
  if (!benchmarkKey) throw new Error("OPENROUTER_JEV_BENCHMARK_API_KEY is required");

  const rows: Row[] = [];
  for (const model of MODELS) {
    for (const fixture of AUTHORIAL_HABIT_JEV_CORPUS) {
      const evaluated = evaluateAuthorialHabitCandidate(fixture);
      if (!evaluated.candidate) continue;
      rows.push(await callOne({
        benchmarkKey,
        model,
        suite: "authorial_habit",
        fixtureId: fixture.id,
        expected: fixture.expectedVerdict,
        criticalPositive: fixture.expectedVerdict === "HABIT_PRESENT",
        state: buildAuthorialHabitJevState({ fixture, signals: evaluated.signals }),
        questions: buildAuthorialHabitJevQuestions(),
        parse: (answers) => parseAuthorialHabitJevVerdict(answers),
      }));
    }

    for (const fixture of COMPLETION_FIXTURES) {
      rows.push(await callOne({
        benchmarkKey,
        model,
        suite: "completion_integrity",
        fixtureId: fixture.id,
        expected: fixture.expected,
        criticalPositive: fixture.expected === "ABRUPT_CUT",
        state: buildCompletionIntegrityJevQaState({
          candidateReasons: fixture.candidateReasons,
          finishReason: fixture.finishReason,
          localRecoveryApplied: fixture.candidateReasons.includes("localRecoveryApplied"),
          localRecoveryActions: [],
          finalProse: fixture.finalProse,
        }),
        questions: buildCompletionIntegrityJevQaQuestions(),
        parse: (answers) => parseCompletionIntegrityJevVerdict(answers),
      }));
    }

    for (const fixture of SCENE_FIXTURES) {
      rows.push(await callOne({
        benchmarkKey,
        model,
        suite: "scene_boundary",
        fixtureId: fixture.id,
        expected: fixture.expected,
        criticalPositive: fixture.expected === "VIOLATION",
        state: buildSceneBoundaryJevQaState({
          boundaryExecution: BOUNDARY_CONTRACT,
          suspicionSignals: fixture.signals,
          assistantProse: fixture.prose,
        }),
        questions: buildSceneBoundaryJevQaQuestions(),
        parse: parseSceneVerdict,
      }));
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    productionMutationEnabled: false,
    runtimeModelPinChanged: false,
    models: MODELS,
    summary: summarize(rows),
    disagreements: rows.filter((row) => !row.correct),
    rows,
  };
  const outDir = path.join(process.cwd(), "artifacts", "decision-classifier-comparison");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary, null, 2));
}

void main();
