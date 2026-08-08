/**
 * Build Audit 56 blind packets + docs from live capture.
 * Hides arm names; excludes _HIDDEN_MAP from review zip.
 */
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomInt } from "node:crypto";
import { execSync } from "node:child_process";

const DOCS = "docs/audits/56-opus-quality-anchor";
const REVIEW = "data/human-review/56-opus-quality-anchor";
const LIVE =
  process.env.OUT_ROOT ?? "/opt/cursor/artifacts/opus-quality-anchor";

type Side = "A" | "B" | "C";
const SIDES: Side[] = ["A", "B", "C"];

function save(dir: string, name: string, content: string | object) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}
function readText(path: string): string {
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  return readFileSync(path, "utf8");
}
function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}
function shuffleThree(arms: string[]): Record<Side, string> {
  const arr = [...arms];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return { A: arr[0]!, B: arr[1]!, C: arr[2]! };
}

function main() {
  const manifest = readJson(join(LIVE, "SCENARIO_MANIFEST.json"));
  const runtime = readJson(join(LIVE, "RUNTIME_RESULTS.json"));
  const rows = (readJson(join(LIVE, "all_valid_rows.json")) as unknown as
    | Array<Record<string, unknown>>
    | null) ?? [];
  if (!manifest || !runtime) throw new Error("missing live manifest/runtime");
  if (rows.length < 36) {
    console.warn(`warning: expected 36 rows, got ${rows.length}`);
  }

  const scenarios = (manifest.scenarios as Array<Record<string, unknown>>) ?? [];
  const hidden: Record<string, Record<string, Record<Side, string>>> = {};
  const blindLines = [
    "# Blind review — Audit 56 Opus Quality Anchor / Common Prompt Health",
    "",
    "All outputs are the **same model**. Only the prompt arm differs.",
    "Arm labels / prompt / length / tokens / cost / latency / source are hidden.",
    "Score each side independently. Do not declare a lineup winner.",
    "",
    "## Scoring",
    "",
    "Common (70):",
    "- 캐릭터 고유성 20",
    "- 유저 주권 15",
    "- 정본·턴 연속성 10",
    "- 문체·리듬 10",
    "- 구체성·비상투성 10",
    "- 기술적 위생 5",
    "",
    "Relationship add-on (30):",
    "- 대화 매력·캐릭터다운 반응 15",
    "- 감정·관계의 실제 변화 10",
    "- 장면 집중 5",
    "",
    "Action add-on (30):",
    "- 실제 진행·결과 15",
    "- 판단·전술·주도성 10",
    "- 긴장감 5",
    "",
    "Hard fails: new user dialogue; substituted user choice/consent/refusal;",
    "USER_PERSONA contradiction; false shared memory; rewind/major rewrite;",
    "NPC scene takeover; system leak; clear refusal of allowed scene; broken/foreign-language mix.",
    "",
    "Also mark NATURAL_STOP_BELOW_NUMERIC_TARGET separately — do not auto-fail on length alone.",
    "",
  ];

  const rawLines = [
    "# RAW_OUTPUTS_FULL — Audit 56",
    "",
    "Arm labels visible here for operators. Blind packet uses shuffled sides.",
    "",
  ];

  for (const sc of scenarios) {
    const sid = String(sc.id);
    const kind = String(sc.kind);
    const label = String(sc.label);
    const turns = sc.turns as [string, string];
    hidden[sid] = {};
    blindLines.push(`## Scenario: ${label} (\`${sid}\` / ${kind})`, "");

    for (const turn of [1, 2] as const) {
      const mapKey = `${sid}-T${turn}`;
      const map = shuffleThree(["arm-A", "arm-B", "arm-C"]);
      hidden[sid][`T${turn}`] = {
        A: map.A.replace("arm-", ""),
        B: map.B.replace("arm-", ""),
        C: map.C.replace("arm-", ""),
      };
      blindLines.push(
        `### ${mapKey}`,
        "",
        "**User input**",
        "",
        "```text",
        turns[turn - 1]!,
        "```",
        ""
      );
      for (const side of SIDES) {
        const arm = map[side]; // arm-A etc
        const text = readText(
          join(LIVE, "live", sid, arm, "run1", `turn${turn}-provider-raw.txt`)
        ).trimEnd();
        blindLines.push(`#### Side ${side}`, "", "```text", text, "```", "");
      }
    }

    for (const arm of ["A", "B", "C"] as const) {
      for (const turn of [1, 2] as const) {
        const meta = readJson(
          join(LIVE, "live", sid, `arm-${arm}`, "run1", `turn${turn}-meta.json`)
        );
        const text = readText(
          join(LIVE, "live", sid, `arm-${arm}`, "run1", `turn${turn}-provider-raw.txt`)
        ).trimEnd();
        rawLines.push(
          `## ${sid} / Arm ${arm} / T${turn}`,
          "",
          "```text",
          text,
          "```",
          "",
          "```json",
          JSON.stringify(
            {
              finish_reason: meta?.finish_reason,
              visible_korean_chars: meta?.visible_korean_chars,
              natural_stop_flag: meta?.natural_stop_flag,
              input_tokens: meta?.input_tokens,
              reasoning_tokens: meta?.reasoning_tokens,
              api_raw_cost_krw: meta?.api_raw_cost_krw,
              latency_s: meta?.latency_s,
              prompt_owner_counts: meta?.prompt_owner_counts,
              reasoning_effort: meta?.reasoning_effort,
              temperature: meta?.temperature,
            },
            null,
            2
          ),
          "```",
          ""
        );
      }
    }
  }

  save(DOCS, "BLIND_REVIEW.md", blindLines.join("\n") + "\n");
  save(DOCS, "RAW_OUTPUTS_FULL.md", rawLines.join("\n"));
  save(DOCS, "_HIDDEN_MAP.json", {
    note: "Maps blind Side A/B/C → prompt arm A/B/C per scenario turn. Reveal only after scoring.",
    map: hidden,
  });
  save(DOCS, "RUNTIME_RESULTS.json", runtime);
  save(DOCS, "SOURCE_MANIFEST.json", {
    live_root: LIVE,
    model: "claude-opus-5",
    provider: "cheaperinference",
    base_branch: "cursor/standard-collaborative-lineup-6a91",
    audit55_untouched: true,
    past_outputs_reused: false,
    persona_id: 61,
    scenarios: manifest.scenarios,
  });

  // Cost aggregate
  const byArm: Record<string, Record<string, unknown>> = {};
  for (const arm of ["A", "B", "C"]) {
    const mrows = rows.filter((r) => r.arm === arm);
    const krw = mrows
      .map((r) => r.api_raw_cost_krw)
      .filter((x): x is number => typeof x === "number");
    const korean = mrows
      .map((r) => r.visible_korean_chars)
      .filter((x): x is number => typeof x === "number");
    const natural = mrows.filter(
      (r) => r.natural_stop_flag === "NATURAL_STOP_BELOW_NUMERIC_TARGET"
    ).length;
    byArm[arm] = {
      outputs: mrows.length,
      sum_api_raw_cost_krw: krw.reduce((a, b) => a + b, 0),
      avg_api_raw_cost_krw: krw.length ? krw.reduce((a, b) => a + b, 0) / krw.length : null,
      avg_visible_korean_chars: korean.length
        ? korean.reduce((a, b) => a + b, 0) / korean.length
        : null,
      natural_stop_below_numeric_target_count: natural,
    };
  }
  save(DOCS, "COST_RESULTS.json", {
    basis:
      "Prefer provider usage.cost when present; else catalog rates × tokens × FX. Not a price-card estimate for ranking.",
    byArm,
    rows: rows.map((r) => ({
      id: r.attempt_id,
      arm: r.arm,
      scenario_id: r.scenario_id,
      turn: r.turn,
      input_tokens: r.input_tokens,
      cached_input_tokens: r.cached_input_tokens,
      visible_output_tokens: r.visible_output_tokens,
      reasoning_tokens: r.reasoning_tokens,
      usage_cost_usd: r.usage_cost_usd,
      api_raw_cost_krw: r.api_raw_cost_krw,
      visible_korean_chars: r.visible_korean_chars,
      natural_stop_flag: r.natural_stop_flag,
      latency_s: r.latency_s,
      ttft_s: r.ttft_s,
      finish_reason: r.finish_reason,
      reasoning_effort: r.reasoning_effort,
      temperature: r.temperature,
    })),
  });

  // Static docs
  save(
    DOCS,
    "README.md",
    `# Audit 56 — Opus Quality Anchor / Common Prompt Health

## Purpose

This audit is **not** a model ranking exercise. It answers one question:

\`\`\`text
우리 사이트의 현재 공통 RP 프롬프트가 Claude Opus 5의 실제 RP 품질을 억압하고 있는가?
\`\`\`

Opus is not treated as an automatic winner or 100-point anchor. The same Opus model is run under three prompt structures to isolate prompt causality.

## Audit 55 correction (status only — Audit 55 artifacts untouched)

\`\`\`text
AUDIT55_MODEL_RANKING_NOT_DECISION_GRADE
COMMON_PROMPT_HEALTH_UNVERIFIED
OPUS_QUALITY_ANCHOR_REQUIRED
CURRENT_TWO_MODEL_LINEUP_PROVISIONAL
NO_PRODUCTION_CHANGE
\`\`\`

## Arms

| Arm | Name |
|---|---|
| A | CURRENT_STANDARD_EXACT |
| B | CURRENT_WITHOUT_NUMERIC_LENGTH |
| C | OPUS_NATIVE_MINIMAL |

Model: \`claude-opus-5\` / Cheaper Inference only.

## Phase-1 status

\`\`\`text
OPUS_PROMPT_HEALTH_SCREEN_CAPTURED
HUMAN_BLIND_REVIEW_REQUIRED
MODEL_LINEUP_DECISION_NOT_RUN
PRODUCTION_CHANGE_NO
\`\`\`

Phase-2 confirmation runs are **not** started before human blind review.
`
  );

  save(
    DOCS,
    "STATUS.md",
    `# STATUS — Audit 56

\`\`\`text
OPUS_PROMPT_HEALTH_SCREEN_CAPTURED
HUMAN_BLIND_REVIEW_REQUIRED
MODEL_LINEUP_DECISION_NOT_RUN
PRODUCTION_CHANGE_NO
\`\`\`

## Audit 55 correction (do not mutate Audit 55 files)

\`\`\`text
AUDIT55_MODEL_RANKING_NOT_DECISION_GRADE
COMMON_PROMPT_HEALTH_UNVERIFIED
OPUS_QUALITY_ANCHOR_REQUIRED
CURRENT_TWO_MODEL_LINEUP_PROVISIONAL
NO_PRODUCTION_CHANGE
\`\`\`

## Forbidden / not done

- PR #250 modified: NO
- production DB apply: NO
- public picker change: NO
- pricing change: NO
- DeepSeek/Terra removed: NO
- Opus public add: NO
- Opus adapter added: NO
- auto merge / deploy: NO
- Audit 55 results edited: NO
- past outputs reused as baseline: NO
- final winner declared before human blind: NO

## Provider parity

\`\`\`text
OPUS_PROVIDER_PARITY_UNVERIFIED
\`\`\`

No alternate Anthropic/OpenRouter Opus path was configured for a safe parallel A/B in this environment.
`
  );

}

function writeDesignDocs() {
  save(
    DOCS,
    "EXPERIMENT_DESIGN.md",
    `# EXPERIMENT_DESIGN — Audit 56

## Question

Does the current common RP prompt suppress Claude Opus 5's actual RP quality?

## Design

- Single model: \`claude-opus-5\` (Cheaper Inference)
- Three prompt arms (A/B/C), identical character/persona/inputs within each scenario
- 6 scenarios × 2 turns × 3 arms × 1 run = 36 outputs
- No reuse of prior audit outputs as baselines
- Length and quality scored separately (\`NATURAL_STOP_BELOW_NUMERIC_TARGET\` is a flag, not auto-fail)

## Arms

### A — CURRENT_STANDARD_EXACT
PR #250 standard collaborative payload via \`buildContext\` + \`assemblePrimaryRpRequest\`.

Owners:
- SceneDirective = 0
- collaborative owner = 1
- legacy novel owner = 0
- terminal length owner = 1 (numeric 3,200~4,200)
- model adapter = 0

### B — CURRENT_WITHOUT_NUMERIC_LENGTH
Identical to A except numeric length sentence replaced once with qualitative stop sentence.

### C — OPUS_NATIVE_MINIMAL
Audit-only minimal payload: character canon + persona + world + recent history + user input + minimal RP contract.
Excludes numeric length, SceneDirective, DeepSeek XML, Terra/Luna/Muse adapters, extra prose/density/anti-rep lists, legacy novel, auto-continue, recovery.

## Sampling

Arm A/B use production wire generation params for Opus (including temperature from Claude production path).
Arm C uses the same production Opus generation params with minimal messages.
\`reasoning_effort\` remains production wire (unset for Opus). No invented top_p.

## Phase-1 decision rules (after human blind)

- C mean ≥ A mean + 7 OR blind preference C>A ≥ 65% → \`COMMON_PROMPT_SUPPRESSION_CONFIRMED\`
- B mean ≥ A mean + 5 OR blind preference B>A ≥ 60% → \`NUMERIC_LENGTH_OWNER_HARMS_OPUS\`
- All arm means within 3 points and preference ≤ 55% → \`PROMPT_NOT_PRIMARY_CAUSE\` + \`PROVIDER_OR_MODEL_ROUTE_AUDIT_REQUIRED\`

Phase-2 (top 2 arms, 12 scenarios, 2 runs) starts only after human blind review.
`
  );

  save(
    DOCS,
    "PROMPT_DIFFS.md",
    `# PROMPT_DIFFS — Audit 56

## Arm A → Arm B

Remove exactly:

\`\`\`text
이번 응답은 한국어 3,200~4,200자 범위의 하나의 밀도 있는 장면으로 전개한다. 현재 상호작용을 요약하거나 성급히 닫지 말고, 관찰·행동·대사·감각·심리가 서로 다음 변화를 일으키도록 충분히 전개한다.
\`\`\`

Replace with exactly:

\`\`\`text
현재 장면에서 하나 이상의 의미 있는 변화와 그에 대한 인물의 반응까지 전개하고, 유저가 다음 행동을 선택할 수 있는 지점에서 멈춘다. 요약·예고·메타 해설은 쓰지 않는다.
\`\`\`

No other owners added.

## Arm A → Arm C

Drop production scaffolding (Korean prose top, contamination guard, prose-style XML, layout system blocks, numeric length, collaborative title block as production-shaped, etc.).

Keep:
1. character core canon
2. selected persona
3. needed world canon
4. recent dialogue
5. current user input
6. minimal RP contract (see live script constant \`AUDIT56_OPUS_NATIVE_MINIMAL_CONTRACT\`)

## Hashes

Per-turn \`prompt_hash\` / \`recent_history_hash\` / \`setting_hash\` / \`greeting_hash\` are stored in live meta JSON under \`/opt/cursor/artifacts/opus-quality-anchor/live/\`.
`
  );

  save(
    DOCS,
    "PROMPT_OWNER_MATRIX.md",
    `# PROMPT_OWNER_MATRIX — Audit 56

| Owner | Arm A | Arm B | Arm C |
|---|---|---|---|
| SceneDirective | 0 | 0 | 0 |
| collaborative owner (prod title) | 1 | 1 | 0* |
| legacy novel owner | 0 | 0 | 0 |
| terminal length numeric 3,200~4,200 | 1 | 0 | 0 |
| terminal length qualitative | 0 | 1 | 0 |
| model adapter | 0 | 0 | 0 |
| Opus native minimal contract | 0 | 0 | 1 |

\\* Arm C encodes user sovereignty inside the minimal RP contract instead of the production collaborative title block.

## Reasoning / sampling (production Opus wire)

| Field | Value |
|---|---|
| reasoning_effort | unset |
| temperature | production Claude path (0.82) |
| top_p | not set after CI adapt |
`
  );

  save(
    DOCS,
    "HUMAN_REVIEW.md",
    `# Human review — Audit 56

\`\`\`text
status: HUMAN_BLIND_REVIEW_REQUIRED
\`\`\`

Use \`BLIND_REVIEW.md\` only. Do not open \`_HIDDEN_MAP.json\` before scoring.

This is a **prompt health** review, not a model lineup decision.
`
  );
}

function syncReview() {
  mkdirSync(REVIEW, { recursive: true });
  for (const name of [
    "README.md",
    "STATUS.md",
    "EXPERIMENT_DESIGN.md",
    "PROMPT_DIFFS.md",
    "PROMPT_OWNER_MATRIX.md",
    "SOURCE_MANIFEST.json",
    "RUNTIME_RESULTS.json",
    "COST_RESULTS.json",
    "BLIND_REVIEW.md",
    "RAW_OUTPUTS_FULL.md",
    "HUMAN_REVIEW.md",
  ]) {
    const src = join(DOCS, name);
    if (existsSync(src)) copyFileSync(src, join(REVIEW, name));
  }
  // zip without hidden map
  const zip = "data/human-review/56-opus-quality-anchor.zip";
  try {
    execSync(`rm -f ${zip} && cd data/human-review && zip -qr 56-opus-quality-anchor.zip 56-opus-quality-anchor`, {
      stdio: "inherit",
    });
  } catch (e) {
    console.warn("zip failed", e);
  }
}

writeDesignDocs();
main();
syncReview();
console.log("Audit 56 packets written");
