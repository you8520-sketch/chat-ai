/**
 * Grader sheet for the synthetic harbor script.
 * Arm B may read the oracle text. Arm A and the probes must not import this module's sentences
 * except through the diagnostic oracle builder.
 */

export type AbFactId =
  | "promise"
  | "npc_old"
  | "world"
  | "relationship_new"
  | "latest_state"
  | "invalidated_relationship"
  | "unresolved_goal"
  | "never_given";

export type AbFactStatus = "current" | "invalidated" | "unresolved" | "never_given";

export type AbFailureBoundary =
  | "SUMMARY_LOSS"
  | "PERSISTENCE_LOSS"
  | "RETRIEVAL_MISS"
  | "INJECTION_LOSS"
  | "STALE_FACT_USED"
  | "MODEL_READING_FAILURE"
  | "UNSUPPORTED_INFERENCE"
  | "NOT_TESTED";

export type AbAnswerFact = {
  id: AbFactId;
  sourceTurn: number | null;
  latestValue: string;
  status: AbFactStatus;
  invalidated: boolean;
  oracleText: string | null;
  expectedBehavior: string;
  graderMustNotTreatAs: string;
};

export const AB_ANSWER_KEY: readonly AbAnswerFact[] = [
  {
    id: "promise",
    sourceTurn: 1,
    latestValue: "봄 밀물 전까지 셋째 창고 열쇠를 하라의 외투에 두고 시 의회에는 넘기지 않는다.",
    status: "current",
    invalidated: false,
    oracleText: "봄 밀물 전까지 셋째 창고 열쇠는 하라의 외투 안쪽에 둔다. 시 의회에는 넘기지 않는다.",
    expectedBehavior: "약속의 기한, 보관 장소, 넘기지 않을 대상을 현재 약속으로 말한다.",
    graderMustNotTreatAs: "이미 열쇠를 넘겼거나 약속이 끝났다고 단정하는 출력",
  },
  {
    id: "npc_old",
    sourceTurn: 21,
    latestValue: "그때 이안은 서린을 서기로만 대하고 이름을 부르지 않았다.",
    status: "invalidated",
    invalidated: true,
    oracleText: null,
    expectedBehavior: "과거 태도로만 기록할 수 있다. 현재 관계의 답으로 쓰면 안 된다.",
    graderMustNotTreatAs: "현재도 서린을 이름 없는 서기로만 대한다는 출력",
  },
  {
    id: "world",
    sourceTurn: 31,
    latestValue: "시 의회 공문으로 밤 나룻배가 멈추고 창고 유지비가 줄었다.",
    status: "current",
    invalidated: false,
    oracleText: "시 의회 공문으로 밤 나룻배는 멈추고 창고 유지비는 줄었다.",
    expectedBehavior: "공문에 적힌 두 변화만 세계 사실로 사용한다.",
    graderMustNotTreatAs: "공문에 없는 폐항, 추방, 창고 폐쇄를 확정 사실로 덧붙이는 출력",
  },
  {
    id: "relationship_new",
    sourceTurn: 41,
    latestValue: "이안은 서린의 이름을 부르고 예비 인장을 서린에게 맡겼다.",
    status: "current",
    invalidated: false,
    oracleText: "이안은 서린의 이름을 부르고 예비 인장을 서린에게 맡겼다.",
    expectedBehavior: "현재 관계는 이름을 부르는 사이이고 예비 인장의 보유자는 서린이다.",
    graderMustNotTreatAs: "인장을 이안이 아직 갖고 있거나 서린을 문 밖에만 두는 출력",
  },
  {
    id: "latest_state",
    sourceTurn: 46,
    latestValue: "깨끗한 붕대는 열아홉 장이고 열쇠는 아직 하라의 외투에 있다.",
    status: "current",
    invalidated: false,
    oracleText: "셋째 창고의 깨끗한 붕대는 열아홉 장이다. 열쇠는 아직 하라의 외투에 있다.",
    expectedBehavior: "가장 최근의 수량과 열쇠 위치를 현재 상태로 말한다.",
    graderMustNotTreatAs: "다른 수량이나 열쇠가 이미 옮겨졌다는 출력",
  },
  {
    id: "invalidated_relationship",
    sourceTurn: 43,
    latestValue: "이름을 부르지 않던 태도는 41턴 이후 폐기되었다.",
    status: "invalidated",
    invalidated: true,
    oracleText: "이름을 부르지 않던 예전 태도는 폐기되었다.",
    expectedBehavior: "폐기된 태도를 현재 상태처럼 사용하지 않는다.",
    graderMustNotTreatAs: "STALE_FACT_USED",
  },
  {
    id: "unresolved_goal",
    sourceTurn: 1,
    latestValue: "봄 밀물은 아직 오지 않았고 열쇠 약속은 끝나지 않았다.",
    status: "unresolved",
    invalidated: false,
    oracleText: "봄 밀물은 아직 오지 않았다. 열쇠 약속은 끝나지 않았다.",
    expectedBehavior: "약속을 이어 갈 일로 둔다. 완료된 임무처럼 닫지 않는다.",
    graderMustNotTreatAs: "약속을 이미 지켰다고 끝내는 출력",
  },
  {
    id: "never_given",
    sourceTurn: null,
    latestValue: "서린의 집, 하라와의 혈연, 봉인 상자 내용물은 원문에 없다.",
    status: "never_given",
    invalidated: false,
    oracleText: null,
    expectedBehavior: "원문에 없는 집, 혈연, 상자 내용물을 사실로 만들지 않는다.",
    graderMustNotTreatAs: "UNSUPPORTED_INFERENCE",
  },
];

/** Diagnostic memory for arm B. Not a production memory owner. */
export function buildOracleDiagnosticMemory(): string {
  const lines = AB_ANSWER_KEY.map((fact) => fact.oracleText).filter((line): line is string => !!line);
  return [
    "[진단 메모]",
    "같은 원문에서 채점표로 확인한 현재 사실만 적는다. 운영 요약문이 아니다.",
    ...lines,
  ].join("\n");
}

export const AB_CALL_PLAN = Object.freeze({
  paidPostsExecutedInThisPrep: 0,
  summaryModelDefault: "gpt-6-luna",
  summaryProvider: "cheaperinference",
  summaryPlannedCalls: 10,
  summaryAttemptsPerBatchInUnmodifiedOwner: 3,
  summaryMaxCallsIfUnmodifiedOwner: 30,
  relationshipExtractCalls: 0,
  episodicEmbedCalls: 0,
  semanticEpisodic: "NOT_TESTED",
  probes: 8,
  arms: 2,
  rpModels: 4,
  rpPlannedCalls: 64,
  plannedPostsIfSingleAttempt: 74,
  maxPostsIfUnmodifiedSummaryRetry: 94,
  approvedRunnerRetry: 0,
  approvedRunnerFallback: 0,
  useChatRoute: false,
  useProductionKey: false,
  outputAimChars: 3200,
  outputHardCap: "NONE",
});

export const AB_SYSTEM_DELTA = [
  {
    id: "processHybridMemory",
    classification: "FOLLOW-UP",
    note: "src/lib/hybridMemoryProcessor.ts has no in-repo reader. It calls the older summarizeTurnBatch in src/lib/ai.ts. The live seal owner is processRollingSummaryBatch.",
  },
  {
    id: "main-model-relationship-tail",
    classification: "KEEP",
    note: "mainModelOwnsRelationshipExtract is false. The four live picker ids are outside isMainModelRelationshipSelfExtractModel.",
  },
  {
    id: "nested-relationship-tail-parser",
    classification: "FOLLOW-UP",
    note: "extractTrailingRelationshipJsonObject starts at the last brace, so a nested promisesAdd object does not parse. The live picker does not use that tail.",
  },
  {
    id: "live-like-ren-source-text",
    classification: "FOLLOW-UP",
    note: "The last committed live-row proof is hashes at deploy 2f5cb0b4, not current main. Persona and character source text are not in the repo, and the historical dump hashes do not match that proof.",
  },
] as const;
