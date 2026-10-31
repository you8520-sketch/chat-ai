/**
 * TRPG R0 — JEV semantic-classification comparison on 20 real Korean cases.
 *
 * The gold labels are authored in the fixture BEFORE any JEV call. This script
 * only compares labels; numbers, permissions, AP, HP, and DB writes stay with
 * the server and are not delegated to JEV.
 *
 * Dry run (no provider call):
 *   node --conditions=react-server --import tsx scripts/trpg-jev-20-case-comparison.ts --dry-run
 *
 * Live run (three Decisions requests, one per dimension):
 *   node --conditions=react-server --import tsx scripts/trpg-jev-20-case-comparison.ts --live
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  callJevDecisions,
  type JevDecisionAnswer,
  type JevDecisionQuestions,
} from "../src/lib/jevDecisions";
import {
  classifyActionClause,
  classifyChallengeKind,
  committedActionText,
  committedItemConsumptionSpans,
  committedItemTakeSpans,
  hasIndependentItemAction,
  isConditionalCommitment,
  isDeclinedCommitment,
  stripQuotedDialogue,
} from "../src/lib/trpg/actionSemantics";
import { isTalkOnlyAction, resolveTrpgActionCheckDecision } from "../src/lib/trpg/actionCheck";
import { declaresLiveFacilityExit, parseMovementDeclaration } from "../src/lib/trpg/movementDeclaration";
import { loadEnvLocal } from "./load-env-local";

type Dimension = "action" | "commitment" | "ending";
type Labels = Record<Dimension, string>;

type CaseItem = {
  id: string;
  source: string;
  context: string;
  text: string;
  gold: Labels;
  rationale: string;
};

type Fixture = {
  schema: string;
  labelSource: string;
  dimensions: Record<Dimension, string[]>;
  items: CaseItem[];
};

const DIMENSIONS: Dimension[] = ["action", "commitment", "ending"];

const CRITERIA: Record<Dimension, Record<string, string>> = {
  action: {
    move: "The actor commits to changing location. A named destination or a live departure counts.",
    wait_stay: "The actor stays, waits, breathes, rests, or deliberately remains in place.",
    observe: "The actor perceives, watches, listens, searches without committing to a risky attempt, or notices another person's action.",
    talk: "The committed act is speech, a question, or quoted dialogue. No physical act is committed.",
    social_gesture: "A non-risky social or bodily gesture: showing empty hands, nodding, bowing, offering a hand, smiling.",
    force_attempt: "A committed physical attempt with uncertain success: break, attack, defend, force, climb, cross a hazard.",
    social_attempt: "A committed deception, persuasion, intimidation, or contested social attempt.",
    item_take: "The actor receives, picks up, or accepts a specific item.",
    item_use: "The actor consumes, applies, drinks, eats, or otherwise uses a carried item.",
    mixed_move_item: "One input contains both a committed move and a committed item action. Do not collapse it to only one.",
    ambiguous: "The act is too underspecified for its stakes and needs one clarification before resolution.",
  },
  commitment: {
    committed: "The named act is actually performed or attempted this turn.",
    conditional: "The act is held behind a condition and is not performed this turn.",
    negated: "The input explicitly negates the first named act (for example, not drawing a sword, not leaving), even if a different remainder act is committed.",
    quoted_only: "The only act is quoted speech or reported speech; the quoted content is not a committed act.",
    mentioned: "The act belongs to another person, or is mentioned/observed rather than performed by the actor.",
  },
  ending: {
    farewell_end: "The input explicitly says goodbye, takes leave, or clearly closes this scene as an ending.",
    continue_play: "The input stays in the scene or explicitly continues the interaction; it is not an ending.",
    no_ending_signal: "The input neither closes the scene nor explicitly continues it. Do not infer an ending from movement alone.",
  },
};

function readFixture(): Fixture {
  const path = resolve("docs/architecture/trpg-vnext/fixtures/jev-20-korean-trpg-cases.json");
  return JSON.parse(readFileSync(path, "utf8")) as Fixture;
}

function clauses(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?。！？])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function currentCommitment(text: string): string {
  const kinds = clauses(text).map((clause) => classifyActionClause(clause).kind);
  if (kinds.length > 0 && kinds.every((kind) => kind === "conditional" || kind === "empty") && kinds.includes("conditional")) {
    return "conditional";
  }
  if (!stripQuotedDialogue(text).trim()) return "quoted_only";
  if (isDeclinedCommitment(text)) return "negated";
  if (isConditionalCommitment(text)) return "conditional";
  // The current owner rewrites `X하지 않고 Y` to the positive remainder Y, so
  // the negated first act is not represented as a separate commitment label.
  return "committed";
}

function currentAction(text: string): { label: string; evidence: Record<string, unknown> } {
  const committed = committedActionText(text);
  const movement = parseMovementDeclaration(text);
  const itemUse = committedItemConsumptionSpans(text).length > 0;
  const itemTake = committedItemTakeSpans(text).length > 0;
  const independentItem = hasIndependentItemAction(text);
  const talk = isTalkOnlyAction(text);
  const decision = resolveTrpgActionCheckDecision({ body: text });
  const kind = classifyChallengeKind(committed || text);
  const surface = committed || text;

  let label = "no_label";
  if (talk) label = "talk";
  else if (itemUse && movement.live) label = "mixed_move_item";
  else if (itemUse) label = "item_use";
  else if (itemTake) label = "item_take";
  else if (movement.live && independentItem) label = "mixed_move_item";
  else if (movement.live) label = "move";
  else if (kind === "contested") label = "social_attempt";
  else if (kind === "challenge" || kind === "hazard") label = "force_attempt";
  else if (/기다|남아|머문|숨을 고르|지켜|서 있|머무/.test(surface)) label = "wait_stay";
  else if (/알아차|보다|살펴|듣|관찰|응시/.test(surface)) label = "observe";
  else if (/손을 펼|고개를 끄덕|미소|악수|포옹|몸을 숙/.test(surface)) label = "social_gesture";
  else if (/처리한다/.test(text)) label = "ambiguous";

  return {
    label,
    evidence: {
      committedText: committed,
      movementLive: movement.live,
      movementGoals: movement.goals,
      itemUse,
      itemTake,
      independentItem,
      talk,
      challengeKind: kind,
      needsCheck: decision.needsCheck,
      checkReason: decision.reason,
      facilityExit: declaresLiveFacilityExit(text),
    },
  };
}

function currentEnding(text: string): string {
  const movement = parseMovementDeclaration(text);
  const farewell = /작별|잘\s*가|안녕|이제\s*돌아|끝내|마침표/.test(text);
  if ((movement.live || declaresLiveFacilityExit(text)) && farewell) return "farewell_end";
  if (/기다|남아|머문|숨을 고르|지켜|계속|서 있|머무/.test(text)) return "continue_play";
  return "no_ending_signal";
}

function classifyCurrent(item: CaseItem): {
  labels: Labels;
  evidence: Record<string, unknown>;
} {
  const action = currentAction(item.text);
  return {
    labels: {
      action: action.label,
      commitment: currentCommitment(item.text),
      ending: currentEnding(item.text),
    },
    evidence: action.evidence,
  };
}

function buildQuestions(fixture: Fixture, dimension: Dimension): JevDecisionQuestions {
  const questions: JevDecisionQuestions = {};
  for (const item of fixture.items) {
    questions[`${item.id}_${dimension}`] = {
      type: "choice",
      instructions: [
        `TRPG 한국어 입력의 ${dimension} 의미를 분류하세요.`,
        `사례 ID: ${item.id}`,
        `문맥: ${item.context}`,
        `입력: ${item.text}`,
        "라벨 하나만 고르세요. 문장에 두 행동이 있으면 주된 행동과 보조 행동을 모두 고려하되, 제공된 라벨 중 가장 정확한 하나를 고르세요.",
      ].join("\n"),
      criteria: CRITERIA[dimension],
    };
  }
  return questions;
}

function normalizeAnswer(answer: JevDecisionAnswer | undefined): string | null {
  if (!answer) return null;
  if (answer.type === "choice") return answer.choice;
  return null;
}

function normalizeNoul(answer: JevDecisionAnswer | undefined): number | null {
  if (!answer || answer.type !== "noul") return null;
  return answer.noul;
}

async function runEndingBinary(fixture: Fixture) {
  loadEnvLocal();
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error("OPENROUTER_API_KEY is not configured; live JEV ending probe cannot run.");
  }
  const questions: JevDecisionQuestions = {};
  for (const item of fixture.items) {
    questions[`${item.id}_ending_binary`] = {
      type: "noul",
      instructions: [
        "다음 한국어 TRPG 입력이 이 장면을 명시적으로 끝내는지 판정하세요.",
        "작별 인사, 떠남을 명시한 작별, 장면을 닫는 선언만 true입니다.",
        "단순 이동, 문을 나서는 행동만으로는 true가 아닙니다.",
        `사례 ID: ${item.id}`,
        `문맥: ${item.context}`,
        `입력: ${item.text}`,
      ].join("\n"),
      criteria: {
        true: "명시적인 작별 인사 또는 장면 종료 선언이 있다.",
        false: "명시적인 작별/종료 선언이 없거나, 이동·대화·머무름일 뿐이다.",
      },
    };
  }
  const result = await callJevDecisions({
    state: {
      task: "20개 한국어 TRPG 사례의 명시적 장면 종료 여부 이진 판정",
      rule: "이동만으로 종료를 추론하지 않는다. 작별/종료 선언만 true.",
      cases: fixture.items.map((item) => ({ id: item.id, context: item.context, text: item.text })),
    },
    questions,
    ledger: null,
    timeoutMs: 180_000,
  });
  const rows = fixture.items.map((item) => {
    const noul = normalizeNoul(result.answers[`${item.id}_ending_binary`]);
    const predicted = noul != null && noul >= 0.5 ? "farewell_end" : "no_ending_signal";
    const goldBinary = item.gold.ending === "farewell_end" ? "farewell_end" : "not_farewell_end";
    const predictedBinary = predicted === "farewell_end" ? "farewell_end" : "not_farewell_end";
    return {
      id: item.id,
      gold: item.gold.ending,
      goldBinary,
      noul,
      predicted,
      predictedBinary,
      match: goldBinary === predictedBinary,
    };
  });
  console.log(
    JSON.stringify({
      responseModel: result.responseModel,
      usage: result.usage,
      correct: rows.filter((row) => row.match).length,
      total: rows.length,
    })
  );
  return {
    responseModel: result.responseModel,
    usage: result.usage,
    rows,
    correct: rows.filter((row) => row.match).length,
    total: rows.length,
  };
}

async function runLive(fixture: Fixture) {
  loadEnvLocal();
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error("OPENROUTER_API_KEY is not configured; live JEV comparison cannot run.");
  }

  const state = {
    task: "20개 한국어 TRPG 실제 사례의 의미 분류 비교",
    rule: "제공된 입력만 읽고 라벨을 고른다. 숫자·권한·DB 변경은 서버 소유이며 여기서 결정하지 않는다.",
    cases: fixture.items.map((item) => ({
      id: item.id,
      context: item.context,
      text: item.text,
    })),
  };

  const answers: Record<string, string | null> = {};
  const calls: Array<Record<string, unknown>> = [];
  for (const dimension of DIMENSIONS) {
    const result = await callJevDecisions({
      state,
      questions: buildQuestions(fixture, dimension),
      ledger: null,
      timeoutMs: 180_000,
    });
    for (const item of fixture.items) {
      answers[`${item.id}_${dimension}`] = normalizeAnswer(result.answers[`${item.id}_${dimension}`]);
    }
    calls.push({
      dimension,
      responseModel: result.responseModel,
      usage: result.usage,
      answerCount: Object.keys(result.answers).length,
    });
    console.log(
      JSON.stringify({
        dimension,
        responseModel: result.responseModel,
        usage: result.usage,
      })
    );
  }
  return { answers, calls };
}

function computeComparison(fixture: Fixture, jevAnswers: Record<string, string | null> | null) {
  const rows = fixture.items.map((item) => {
    const current = classifyCurrent(item);
    const jev = jevAnswers
      ? {
          action: jevAnswers[`${item.id}_action`] ?? null,
          commitment: jevAnswers[`${item.id}_commitment`] ?? null,
          ending: jevAnswers[`${item.id}_ending`] ?? null,
        }
      : null;
    const currentMatch = Object.fromEntries(
      DIMENSIONS.map((dimension) => [dimension, current.labels[dimension] === item.gold[dimension]])
    ) as Record<Dimension, boolean>;
    const jevMatch = jev
      ? (Object.fromEntries(
          DIMENSIONS.map((dimension) => [dimension, jev[dimension] === item.gold[dimension]])
        ) as Record<Dimension, boolean>)
      : null;
    return {
      id: item.id,
      source: item.source,
      text: item.text,
      gold: item.gold,
      current: current.labels,
      currentEvidence: current.evidence,
      currentMatch,
      jev,
      jevMatch,
      rationale: item.rationale,
    };
  });

  const accuracy = (which: "current" | "jev") => {
    const out: Record<Dimension, { correct: number; total: number; accuracy: number | null }> = {
      action: { correct: 0, total: 0, accuracy: null },
      commitment: { correct: 0, total: 0, accuracy: null },
      ending: { correct: 0, total: 0, accuracy: null },
    };
    for (const row of rows) {
      for (const dimension of DIMENSIONS) {
        const match = which === "current" ? row.currentMatch[dimension] : row.jevMatch?.[dimension];
        if (match == null) continue;
        out[dimension].total += 1;
        if (match) out[dimension].correct += 1;
      }
    }
    for (const dimension of DIMENSIONS) {
      const row = out[dimension];
      row.accuracy = row.total > 0 ? Math.round((row.correct / row.total) * 1000) / 10 : null;
    }
    return out;
  };

  const mismatches = rows.flatMap((row) =>
    DIMENSIONS.filter((dimension) => !row.currentMatch[dimension] || (row.jevMatch && !row.jevMatch[dimension])).map(
      (dimension) => ({
        id: row.id,
        dimension,
        gold: row.gold[dimension],
        current: row.current[dimension],
        jev: row.jev?.[dimension] ?? null,
        currentMatch: row.currentMatch[dimension],
        jevMatch: row.jevMatch?.[dimension] ?? null,
        text: row.text,
      })
    )
  );

  return {
    schema: "trpg-r0.jev-20-comparison.v1",
    fixtureSchema: fixture.schema,
    labelSource: fixture.labelSource,
    dimensions: fixture.dimensions,
    rows,
    accuracy: {
      current: accuracy("current"),
      jev: jevAnswers ? accuracy("jev") : null,
    },
    mismatches,
    conclusion: jevAnswers
      ? "JEV labels are compared against pre-authored gold labels. Any adoption must replace a named current semantic owner; JEV is not an additional gate."
      : "Dry run only. No JEV call was made and no semantic adoption is claimed.",
  };
}

async function main() {
  const endingBinaryOnly = process.argv.includes("--ending-binary-only");
  const live = process.argv.includes("--live") || endingBinaryOnly;
  const fixture = readFixture();
  if (fixture.items.length !== 20) {
    throw new Error(`Expected 20 cases, found ${fixture.items.length}`);
  }
  for (const item of fixture.items) {
    for (const dimension of DIMENSIONS) {
      if (!fixture.dimensions[dimension].includes(item.gold[dimension])) {
        throw new Error(`${item.id}: gold ${dimension} label ${item.gold[dimension]} is not in the taxonomy`);
      }
    }
  }

  if (endingBinaryOnly) {
    const endingBinary = await runEndingBinary(fixture);
    const outDir = resolve("tmp/trpg-jev-20");
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, "jev-20-ending-binary.json");
    writeFileSync(outPath, JSON.stringify({ schema: "trpg-r0.jev-20-ending-binary.v1", ...endingBinary }, null, 2), "utf8");
    console.log(JSON.stringify({ mode: "ending-binary-only", outPath, correct: endingBinary.correct, total: endingBinary.total }));
    return;
  }

  const liveResult = live ? await runLive(fixture) : null;
  const comparison = computeComparison(fixture, liveResult?.answers ?? null);
  const outDir = resolve("tmp/trpg-jev-20");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, live ? "jev-20-comparison-live.json" : "jev-20-comparison-dry.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        ...comparison,
        mode: live ? "live" : "dry-run",
        calls: liveResult?.calls ?? [],
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        mode: live ? "live" : "dry-run",
        outPath,
        accuracy: comparison.accuracy,
        mismatches: comparison.mismatches.length,
        calls: liveResult?.calls?.length ?? 0,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
