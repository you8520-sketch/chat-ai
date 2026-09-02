/**
 * Forensic Gemini GM verification — saves raw provider output + envelope markers.
 *
 * Usage:
 *   TRPG_PROMPT_ROOT=/path/to/checkout node --conditions=react-server --import tsx \
 *     scripts/trpg-gm-length-forensic.ts --label main-baseline
 *
 * retry=0 (single callTrpgGm per fixture; no continuation/recovery in script).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { callTrpgGm } from "../src/lib/trpg/gmCall";
import {
  assessGmCompletionIntegrity,
  completionIntegrityStatusLabel,
} from "../src/lib/trpg/gmCompletionIntegrity";
import {
  countTrpgNarrationChars,
  TRPG_GM_RICH_MIN_CHARS,
} from "../src/lib/trpg/gmNarrationBudget";
import {
  parseTrpgGmEnvelopeJson,
  parseTrpgGmOutput,
  TRPG_GM_DELTA_OPEN,
  TRPG_GM_NARRATION_OPEN,
} from "../src/lib/trpg/gmPrompt";
import { reviewGmForwardMotionQuality } from "../src/lib/trpg/gmResolutionProbe";
import { TRPG_GM_MODEL } from "../src/lib/trpg/types";

type FixtureAction = {
  participantId: number;
  name: string;
  body: string;
  participantKind?: "human" | "ai_character";
  statKey: string;
  d20: number | null;
  finalScore: number | null;
  dc: number | null;
  tier: string | null;
};

type GmPromptModule = {
  TRPG_GM_SYSTEM: string;
  buildTrpgGmUserBlock: (opts: {
    worldBrief: string;
    memoryBlock: string;
    opening: boolean;
    gmSecret?: string;
    sheetCanon?: string;
    resolutionOrderBlock?: string;
    mechanicsPacket?: string;
    actions: FixtureAction[];
  }) => string;
};

type BudgetModule = {
  computeTrpgGmNarrationBudget: (bodies: readonly string[]) => {
    density: string;
    minChars: number;
    targetMinChars: number;
    targetMaxChars: number;
  };
};

function parseLabel(argv: string[]): string {
  const idx = argv.indexOf("--label");
  if (idx < 0 || !argv[idx + 1]) {
    throw new Error("Missing required --label <name>");
  }
  return argv[idx + 1]!;
}

function padRich(seed: string): string {
  let out = seed.trim();
  while (countTrpgNarrationChars(out) < TRPG_GM_RICH_MIN_CHARS) out += " 먼지가 인다.";
  return out;
}

function countMarker(text: string, marker: string): number {
  if (!marker) return 0;
  let count = 0;
  let pos = 0;
  while (true) {
    const at = text.indexOf(marker, pos);
    if (at < 0) break;
    count += 1;
    pos = at + marker.length;
  }
  return count;
}

export type EnvelopeMalformedKind =
  | "HEALTHY"
  | "MISSING_NARRATION_MARKER"
  | "MISSING_DELTA_MARKER"
  | "DELTA_BEFORE_NARRATION"
  | "MALFORMED_DELTA_JSON"
  | "OTHER";

export function classifyEnvelopeMalformed(raw: string): EnvelopeMalformedKind {
  const narCount = countMarker(raw, TRPG_GM_NARRATION_OPEN);
  const deltaCount = countMarker(raw, TRPG_GM_DELTA_OPEN);
  const narIdx = raw.indexOf(TRPG_GM_NARRATION_OPEN);
  const deltaIdx = raw.indexOf(TRPG_GM_DELTA_OPEN);

  if (narCount === 0 && deltaCount === 0) return "OTHER";
  if (narCount === 0) return "MISSING_NARRATION_MARKER";
  if (deltaCount === 0) return "MISSING_DELTA_MARKER";
  if (deltaIdx < narIdx) return "DELTA_BEFORE_NARRATION";
  const deltaRaw = raw.slice(deltaIdx + TRPG_GM_DELTA_OPEN.length);
  const parsed = parseTrpgGmEnvelopeJson(deltaRaw);
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "MALFORMED_DELTA_JSON";
  }
  return "HEALTHY";
}

function fixtureActions(): { sparse: FixtureAction[]; mixed: FixtureAction[]; rich: FixtureAction[] } {
  const sparse: FixtureAction[] = [
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
  const mixed = sparse.map((a, i) =>
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
  const rich = mixed.map((a) => ({ ...a, body: padRich(a.body) }));
  return { sparse, mixed, rich };
}

async function loadPromptModules(promptRoot: string): Promise<{ gm: GmPromptModule; budget: BudgetModule }> {
  const gmUrl = pathToFileURL(resolve(promptRoot, "src/lib/trpg/gmPrompt.ts")).href;
  const budgetUrl = pathToFileURL(resolve(promptRoot, "src/lib/trpg/gmNarrationBudget.ts")).href;
  const gm = (await import(gmUrl)) as GmPromptModule;
  const budget = (await import(budgetUrl)) as BudgetModule;
  return { gm, budget };
}

function buildUserBlock(gm: GmPromptModule, actions: FixtureAction[]): string {
  return gm.buildTrpgGmUserBlock({
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
}

async function runFixture(opts: {
  label: string;
  fixtureId: "A" | "B" | "C";
  actions: FixtureAction[];
  gm: GmPromptModule;
  budget: BudgetModule;
  outDir: string;
}) {
  delete process.env.MOCK_MODE;
  const user = buildUserBlock(opts.gm, opts.actions);
  const budget = opts.budget.computeTrpgGmNarrationBudget(opts.actions.map((a) => a.body));

  const result = await callTrpgGm({
    system: opts.gm.TRPG_GM_SYSTEM,
    user,
    timeoutMs: 180_000,
  });

  const raw = result.text;
  const integrity = assessGmCompletionIntegrity(raw, { finishReason: result.finishReason });
  const envelopeKind = classifyEnvelopeMalformed(raw);
  const parsed = parseTrpgGmOutput(raw);
  const narrationChars = countTrpgNarrationChars(parsed.narration);
  const quality = reviewGmForwardMotionQuality({
    narration: parsed.narration,
    actions: opts.actions.map((a) => ({
      participantId: a.participantId,
      name: a.name,
      body: a.body,
      tier: a.tier ?? undefined,
    })),
  });

  const narIdx = raw.indexOf(TRPG_GM_NARRATION_OPEN);
  const deltaIdx = raw.indexOf(TRPG_GM_DELTA_OPEN);
  const deltaRaw = deltaIdx >= 0 ? raw.slice(deltaIdx + TRPG_GM_DELTA_OPEN.length) : "";
  const deltaParseable = deltaRaw ? parseTrpgGmEnvelopeJson(deltaRaw) != null : false;

  const prefix = `${opts.label}-fixture-${opts.fixtureId}`;
  const rawFile = join(opts.outDir, `${prefix}-raw.txt`);
  writeFileSync(rawFile, raw, "utf8");

  const row = {
    LABEL: opts.label,
    FIXTURE: opts.fixtureId,
    DENSITY: budget.density,
    COMPUTED_MIN_CHARS: budget.minChars,
    TARGET_RANGE: `${budget.targetMinChars}–${budget.targetMaxChars}`,
    FINISH_REASON: result.finishReason,
    RAW_OUTPUT_CHARS: raw.length,
    RAW_OUTPUT_FILE: rawFile,
    NARRATION_MARKER_COUNT: countMarker(raw, TRPG_GM_NARRATION_OPEN),
    DELTA_MARKER_COUNT: countMarker(raw, TRPG_GM_DELTA_OPEN),
    NARRATION_MARKER_INDEX: narIdx,
    DELTA_MARKER_INDEX: deltaIdx,
    DELTA_JSON_PARSEABLE: deltaParseable,
    PARSED_NARRATION_CHARS: narrationChars,
    MINIMUM_MET: narrationChars >= budget.minChars,
    INTEGRITY_STATUS: completionIntegrityStatusLabel(integrity),
    ENVELOPE_MALFORMED_KIND: envelopeKind,
    ACTION_REPLAY: quality.ACTION_REPLAY,
    RESOLUTION_BLOAT: quality.RESOLUTION_BLOAT,
    PLAYER_AGENCY_VIOLATION: quality.PLAYER_AGENCY_VIOLATION,
    PROVIDER_CALLS: 1,
    MODEL: TRPG_GM_MODEL,
    PROMPT_ROOT: process.env.TRPG_PROMPT_ROOT ?? process.cwd(),
    GM_SYSTEM_CHARS: opts.gm.TRPG_GM_SYSTEM.length,
  };

  writeFileSync(join(opts.outDir, `${prefix}.json`), JSON.stringify(row, null, 2));
  return row;
}

async function main() {
  const label = parseLabel(process.argv);
  const key = process.env.CHEAPER_INFERENCE_API_KEY?.trim();
  if (!key || key.startsWith("your_")) {
    console.error("GEMINI_FORENSIC_SKIPPED=true (no CHEAPER_INFERENCE_API_KEY)");
    process.exit(0);
  }

  const promptRoot = resolve(process.env.TRPG_PROMPT_ROOT ?? process.cwd());
  const outDir = resolve(
    process.env.TRPG_FORENSIC_OUT_DIR ?? `/opt/cursor/artifacts/trpg-gm-length-forensic/${label}`
  );
  mkdirSync(outDir, { recursive: true });

  const { gm, budget } = await loadPromptModules(promptRoot);
  const { sparse, mixed, rich } = fixtureActions();

  const fixtures: Array<{ id: "A" | "B" | "C"; actions: FixtureAction[] }> = [
    { id: "A", actions: sparse },
    { id: "B", actions: mixed },
    { id: "C", actions: rich },
  ];

  const results = [];
  for (const fixture of fixtures) {
    console.info(`FORENSIC_START label=${label} fixture=${fixture.id} model=${TRPG_GM_MODEL}`);
    const row = await runFixture({
      label,
      fixtureId: fixture.id,
      actions: fixture.actions,
      gm,
      budget,
      outDir,
    });
    results.push(row);
    console.info(JSON.stringify(row));
  }

  writeFileSync(
    join(outDir, "summary.json"),
    JSON.stringify({ label, promptRoot, gmSystemChars: gm.TRPG_GM_SYSTEM.length, results }, null, 2)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
