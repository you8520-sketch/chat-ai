/**
 * Real Gemini 3.7 Flash GM length verification — one call per fixture, retry=0.
 * Run: node --conditions=react-server --import tsx scripts/trpg-gm-length-gemini-verify.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { callTrpgGm } from "../src/lib/trpg/gmCall";
import {
  assessGmCompletionIntegrity,
  completionIntegrityStatusLabel,
} from "../src/lib/trpg/gmCompletionIntegrity";
import {
  computeTrpgGmNarrationBudget,
  countTrpgNarrationChars,
  TRPG_GM_RICH_MIN_CHARS,
} from "../src/lib/trpg/gmNarrationBudget";
import { buildTrpgGmUserBlock, parseTrpgGmOutput, TRPG_GM_SYSTEM } from "../src/lib/trpg/gmPrompt";
import { reviewGmForwardMotionQuality } from "../src/lib/trpg/gmResolutionProbe";
import { TRPG_GM_MODEL } from "../src/lib/trpg/types";

function padRich(seed: string): string {
  let out = seed.trim();
  while (countTrpgNarrationChars(out) < TRPG_GM_RICH_MIN_CHARS) out += " 먼지가 인다.";
  return out;
}

type FixtureAction = Parameters<typeof buildTrpgGmUserBlock>[0]["actions"][number];

function buildFixture(name: "A" | "B" | "C", actions: FixtureAction[]) {
  const user = buildTrpgGmUserBlock({
    worldBrief:
      "지하 시설 — 포자층과 금속 통로. 경보등이 깜빡이는 복도 끝에 잠긴 문이 있다. 공기는 습하고 금속 냄새가 난다.",
    memoryBlock: "[TRPG STRUCTURED STATE]\nlocation=복도\nquests=우회로 확보",
    opening: false,
    gmSecret: "환풍구 뒤 숨겨진 우회로 — 아직 PC는 모른다.",
    sheetCanon: "[PARTY SHEETS]\n렌(str 10) · 유나(wis 9) · 솔(dex 8)",
    resolutionOrderBlock: "[RESOLUTION ORDER]\n1. 렌\n2. 유나\n3. 솔",
    mechanicsPacket: "[AUTHORITATIVE MECHANICS]\n(no HP changes this round)",
    actions,
  });
  const budget = computeTrpgGmNarrationBudget(actions.map((a) => a.body));
  return { name, user, budget, actions };
}

const sparseActions: FixtureAction[] = [
  {
    participantId: 1,
    name: "렌",
    body: "문을 연다.",
    participantKind: "human",
    statKey: "str",
    d20: 14,
    finalScore: 16,
    dc: 12,
    tier: "SUCCESS",
  },
  {
    participantId: 2,
    name: "유나",
    body: "창가를 본다.",
    participantKind: "ai_character",
    statKey: "wis",
    d20: 12,
    finalScore: 13,
    dc: 12,
    tier: "SUCCESS",
  },
  {
    participantId: 3,
    name: "솔",
    body: "뒤를 돌본다.",
    participantKind: "ai_character",
    statKey: "dex",
    d20: 8,
    finalScore: 9,
    dc: 12,
    tier: "FAILURE",
  },
];

const mixedActions: FixtureAction[] = sparseActions.map((a, i) =>
  i === 0
    ? a
    : {
        ...a,
        body:
          i === 1
            ? padRich("방패를 들고 전진하며 포자층 쪽 통로를 가로막으려 했다.")
            : padRich("검을 역수로 쥐고 측면 환풍구를 노려 발판을 찾으려 했다."),
      }
);

const richActions: FixtureAction[] = mixedActions.map((a) => ({ ...a, body: padRich(a.body) }));

const FIXTURES = [
  buildFixture("A", sparseActions),
  buildFixture("B", mixedActions),
  buildFixture("C", richActions),
];

async function runOne(fixture: ReturnType<typeof buildFixture>) {
  delete process.env.MOCK_MODE;
  const result = await callTrpgGm({
    system: TRPG_GM_SYSTEM,
    user: fixture.user,
    timeoutMs: 180_000,
  });
  const integrity = assessGmCompletionIntegrity(result.text, { finishReason: result.finishReason });
  const parsed = parseTrpgGmOutput(result.text);
  const narrationChars = countTrpgNarrationChars(parsed.narration);
  const quality = reviewGmForwardMotionQuality({
    narration: parsed.narration,
    actions: fixture.actions.map((a) => ({
      participantId: a.participantId,
      name: a.name,
      body: a.body,
      tier: a.tier ?? undefined,
    })),
  });
  return {
    FIXTURE: fixture.name,
    DENSITY: fixture.budget.density,
    COMPUTED_MIN_CHARS: fixture.budget.minChars,
    TARGET_RANGE: `${fixture.budget.targetMinChars}–${fixture.budget.targetMaxChars}`,
    ACTUAL_NARRATION_CHARS: narrationChars,
    TARGET_MET: narrationChars >= fixture.budget.targetMinChars,
    MINIMUM_MET: narrationChars >= fixture.budget.minChars,
    ACTION_REPLAY: quality.ACTION_REPLAY,
    PLAYER_AGENCY_VIOLATION: quality.PLAYER_AGENCY_VIOLATION,
    RESOLUTION_BLOAT: quality.RESOLUTION_BLOAT,
    FINISH_REASON: result.finishReason,
    COMPLETION_INTEGRITY: completionIntegrityStatusLabel(integrity),
    INPUT_TOKENS: result.usage?.promptTokens ?? null,
    OUTPUT_TOKENS: result.usage?.completionTokens ?? null,
    PROVIDER_CALLS: 1,
    RAW_OUTPUT_CHARS: result.text.length,
  };
}

async function main() {
  const key = process.env.CHEAPER_INFERENCE_API_KEY?.trim();
  if (!key || key.startsWith("your_")) {
    console.error("GEMINI_VERIFY_SKIPPED=true (no CHEAPER_INFERENCE_API_KEY)");
    process.exit(0);
  }

  const outDir = "/opt/cursor/artifacts/trpg-gm-length-gemini";
  mkdirSync(outDir, { recursive: true });

  const results = [];
  for (const fixture of FIXTURES) {
    console.info(`GEMINI_VERIFY_START fixture=${fixture.name} model=${TRPG_GM_MODEL}`);
    const row = await runOne(fixture);
    results.push(row);
    console.info(JSON.stringify(row));
    writeFileSync(join(outDir, `fixture-${fixture.name}.json`), JSON.stringify(row, null, 2));
  }

  writeFileSync(join(outDir, "summary.json"), JSON.stringify({ MODEL: TRPG_GM_MODEL, results }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
