/**
 * Build Audit 55 three-way blind packets + cost aggregates.
 * Relationship: DeepSeek / Gemini 3.1 / Opus 5
 * Action: Terra / Gemini 3.1 / Opus 5
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

const DOCS = "docs/audits/55-gemini31-opus5-minimal-screen";
const REVIEW = "data/human-review/55-gemini31-opus5-minimal-screen";
const LIVE =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/gemini31-opus5-minimal-screen";

const REL_USER = {
  1: "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.",
  2: "너는 이름이뭐야? 뭐하는 중이었어?",
} as const;
const ACT_USER = {
  1: "*로비 천장에서 갑자기 비상 경보가 울리고 출입문 쪽에서 둔탁한 폭발음이 터진다. 렌은 소리가 난 쪽으로 고개를 돌린다.* 저거 뭐야?",
  2: "*렌은 태형의 소매를 잡고 곁에 붙는다.* 나도 같이 갈게.",
} as const;

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
function shuffleThree(models: string[]): Record<Side, string> {
  const arr = [...models];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return { A: arr[0]!, B: arr[1]!, C: arr[2]! };
}

function relPath(model: string, turn: number): string {
  if (model === "deepseek") {
    return `/opt/cursor/artifacts/default-collaborative/arm-COLLAB/run1/turn${turn}-provider-raw.txt`;
  }
  return join(LIVE, model, "relationship/run1", `turn${turn}-provider-raw.txt`);
}
function actPath(model: string, turn: number): string {
  if (model === "terra") {
    return `/opt/cursor/artifacts/luna-terra-value-bakeoff/action/terra/run1/turn${turn}-provider-raw.txt`;
  }
  return join(LIVE, model, "action/run1", `turn${turn}-provider-raw.txt`);
}
function liveMeta(model: string, testSet: string, turn: number) {
  return readJson(join(LIVE, model, testSet, "run1", `turn${turn}-meta.json`));
}

function avg(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function buildBlinds() {
  const relModels = ["deepseek", "gemini31", "opus5"];
  const actModels = ["terra", "gemini31", "opus5"];
  const relHidden: Record<string, Record<Side, string>> = {};
  const actHidden: Record<string, Record<Side, string>> = {};

  const relLines = [
    "# Blind relationship packet — Audit 55 Gemini 3.1 Pro vs Claude Opus 5",
    "",
    "Three-way blind (DeepSeek baseline / Gemini 3.1 Pro / Opus 5).",
    "Models / providers / price / cost / tokens / reasoning / latency / length / points / source are hidden.",
    "Do not declare a winner before maps are revealed.",
    "",
    "Scoring:",
    "- 캐릭터성 30",
    "- 대화 매력 25",
    "- 문체·감정선 20",
    "- 장면 집중 15",
    "- 유저 주권 10",
    "- 총점 100",
    "",
    "Hard fail: new user dialogue/major action, USER_PERSONA contradiction,",
    "NPC scene takeover, temporal rewind/major replay, system instruction leak,",
    "clear refusal of allowed adult scene.",
    "",
  ];
  for (const turn of [1, 2] as const) {
    const id = `REL-T${turn}`;
    const map = shuffleThree(relModels);
    relHidden[id] = map;
    relLines.push(
      `## ${id}`,
      "",
      "**User input**",
      "",
      "```text",
      REL_USER[turn],
      "```",
      ""
    );
    for (const side of SIDES) {
      const text = readText(relPath(map[side], turn)).trimEnd();
      relLines.push(`### Side ${side}`, "", "```text", text, "```", "");
    }
  }

  const actLines = [
    "# Blind action packet — Audit 55 Gemini 3.1 Pro vs Claude Opus 5",
    "",
    "Three-way blind (Terra baseline / Gemini 3.1 Pro / Opus 5).",
    "Independent randomization for T1 and T2.",
    "Do not declare a winner before maps are revealed.",
    "",
    "Scoring:",
    "- 실제 진행·결과 30",
    "- 판단·주도성 25",
    "- 긴장감 20",
    "- 인물 상호작용 15",
    "- 가독성 10",
    "- 총점 100",
    "",
    "Hard fail: new user dialogue/major action, USER_PERSONA contradiction,",
    "NPC scene takeover, temporal rewind/major replay, system instruction leak,",
    "clear refusal of allowed adult scene.",
    "",
  ];
  for (const turn of [1, 2] as const) {
    const id = `ACT-T${turn}`;
    const map = shuffleThree(actModels);
    actHidden[id] = map;
    actLines.push(
      `## ${id}`,
      "",
      "**User input**",
      "",
      "```text",
      ACT_USER[turn],
      "```",
      ""
    );
    for (const side of SIDES) {
      const text = readText(actPath(map[side], turn)).trimEnd();
      actLines.push(`### Side ${side}`, "", "```text", text, "```", "");
    }
  }

  save(DOCS, "BLIND_RELATIONSHIP.md", relLines.join("\n") + "\n");
  save(DOCS, "BLIND_ACTION.md", actLines.join("\n") + "\n");
  save(DOCS, "_HIDDEN_MAP.json", {
    relationship: relHidden,
    action: actHidden,
    note: "Reveal only after human scoring. Relationship baselines: DeepSeek=Audit44 COLLAB. Action baselines: Terra=Audit46.",
  });
}

function buildRawAndCost() {
  const rows: Record<string, unknown>[] = [];
  const rawLines = [
    "# RAW_OUTPUTS_FULL — Audit 55 Gemini 3.1 Pro vs Claude Opus 5",
    "",
    "Live challengers only. Baselines are referenced in SOURCE_MANIFEST / blinds.",
    "",
  ];

  for (const model of ["gemini31", "opus5"] as const) {
    for (const testSet of ["relationship", "action"] as const) {
      for (const turn of [1, 2] as const) {
        const meta = liveMeta(model, testSet, turn);
        const text = readText(
          join(LIVE, model, testSet, "run1", `turn${turn}-provider-raw.txt`)
        ).trimEnd();
        const id = `${model.toUpperCase()}-${testSet === "relationship" ? "REL" : "ACT"}-T${turn}`;
        rawLines.push(
          `## ${id}`,
          "",
          "```text",
          text,
          "```",
          "",
          "```json",
          JSON.stringify(
            {
              model: meta?.model_ui,
              finish_reason: meta?.finish_reason,
              visible_chars: meta?.visible_chars,
              input_tokens: meta?.input_tokens,
              cached_input_tokens: meta?.cached_input_tokens,
              visible_output_tokens: meta?.visible_output_tokens,
              reasoning_tokens: meta?.reasoning_tokens,
              usage_cost_usd: meta?.usage_cost_usd,
              api_raw_cost_krw: meta?.api_raw_cost_krw,
              latency_s: meta?.latency_s,
              ttft_s: meta?.ttft_s,
              reasoning_effort: meta?.reasoning_effort,
            },
            null,
            2
          ),
          "```",
          ""
        );
        if (meta) rows.push({ ...meta, provider_raw: text });
      }
    }
  }
  save(DOCS, "RAW_OUTPUTS_FULL.md", rawLines.join("\n"));

  const byModel: Record<string, Record<string, unknown>> = {};
  for (const model of ["gemini31", "opus5"]) {
    const mrows = rows.filter((r) => r.model_key === model);
    const usd = mrows
      .map((r) => r.usage_cost_usd)
      .filter((x): x is number => typeof x === "number");
    const krw = mrows
      .map((r) => r.api_raw_cost_krw)
      .filter((x): x is number => typeof x === "number");
    const reason = mrows
      .map((r) => r.reasoning_tokens)
      .filter((x): x is number => typeof x === "number");
    const chars = mrows
      .map((r) => r.visible_chars)
      .filter((x): x is number => typeof x === "number");
    byModel[model] = {
      outputs: mrows.length,
      avg_usage_cost_usd: avg(usd),
      sum_usage_cost_usd: usd.length ? usd.reduce((a, b) => a + b, 0) : null,
      avg_api_raw_cost_krw: avg(krw),
      sum_api_raw_cost_krw: krw.length ? krw.reduce((a, b) => a + b, 0) : null,
      avg_reasoning_tokens: avg(reason),
      avg_visible_chars: avg(chars),
      turns: mrows.map((r) => ({
        id: r.attempt_id,
        test_set: r.test_set,
        turn: r.turn,
        input_tokens: r.input_tokens,
        cached_input_tokens: r.cached_input_tokens,
        visible_output_tokens: r.visible_output_tokens,
        reasoning_tokens: r.reasoning_tokens,
        usage_cost_usd: r.usage_cost_usd,
        api_raw_cost_krw: r.api_raw_cost_krw,
        visible_chars: r.visible_chars,
        latency_s: r.latency_s,
        ttft_s: r.ttft_s,
        finish_reason: r.finish_reason,
        reasoning_effort: r.reasoning_effort,
      })),
    };
  }

  save(DOCS, "COST_RESULTS.json", {
    basis: "actual usage.cost / upstreamCostUsd / apiRawCostKrw from live SSE done events — not catalog price estimates",
    byModel,
    rows,
  });

  const runtime = readJson(join(LIVE, "RUNTIME_RESULTS.json"));
  save(DOCS, "RUNTIME_RESULTS.json", runtime ?? { status: "MISSING_LIVE" });
  save(DOCS, "SOURCE_MANIFEST.json", {
    relationship_baseline_deepseek:
      "/opt/cursor/artifacts/default-collaborative/arm-COLLAB/run1 (Audit 44 COLLAB)",
    action_baseline_terra:
      "/opt/cursor/artifacts/luna-terra-value-bakeoff/action/terra/run1 (Audit 46)",
    live_challengers: LIVE,
    character_id: 18,
    persona_id: 61,
  });
}

function buildOwnerMatrix() {
  const md = `# PROMPT_OWNER_MATRIX — Audit 55

Pure standard collaborative baseline. No model-specific adapters.

| Owner | Value | Notes |
|---|---|---|
| SceneDirective | 0 | Not injected for standard interactive |
| collaborative owner | 1 | Hardwired COLLABORATIVE_INTERACTIVE_OWNER_BLOCK |
| legacy novel owner | 0 | Novel prose owner off |
| terminal length owner | 1 | USER_TAIL_LENGTH_OWNER_SENTENCE (non-Terra/Luna) |

Forbidden for this screen:

- model-specific adapters
- DeepSeek-only XML
- Terra-only contract
- extra length instructions
- extra style instructions
- sampling tuning beyond production wire

Reasoning (production CI wire, documented in AVAILABILITY.json):

| Model | Applied |
|---|---|
| gemini-3.1-pro-preview | reasoning_effort=low |
| claude-opus-5 | reasoning_effort unset |

End state:

\`\`\`text
human review: NOT_RUN — waiting for ChatGPT
production DB apply: NO
public picker exposure: NO
pricing change: NO
auto merge: NO
auto deploy: NO
\`\`\`
`;
  save(DOCS, "PROMPT_OWNER_MATRIX.md", md);
}

function buildReadme() {
  const md = `# Audit 55 — Gemini 3.1 Pro vs Claude Opus 5 minimal RP screen

Base: \`cursor/standard-collaborative-lineup-6a91\` (PR #250). Does **not** modify PR #250 / #251.

## Models (Cheaper Inference)

- \`gemini-3.1-pro-preview\`
- \`claude-opus-5\`

Availability checked via CI \`/v1/models\` before live calls.

## Prompt

Standard collaborative baseline only:

\`\`\`text
SceneDirective = 0
collaborative owner = 1
legacy novel owner = 0
terminal length owner = 1
\`\`\`

## Outputs

4 per model (relationship T1→T2 + action T1→T2) = 8 total.  
retry = 0 / continuation = 0 / recovery = 0.

## Blind packs

- Relationship: DeepSeek / Gemini 3.1 / Opus 5
- Action: Terra / Gemini 3.1 / Opus 5

## Status

\`\`\`text
human review: NOT_RUN — waiting for ChatGPT
production DB apply: NO
public picker exposure: NO
pricing change: NO
auto merge: NO
auto deploy: NO
\`\`\`
`;
  save(DOCS, "README.md", md);
}

function syncReview() {
  mkdirSync(REVIEW, { recursive: true });
  for (const name of [
    "README.md",
    "BLIND_RELATIONSHIP.md",
    "BLIND_ACTION.md",
    "RAW_OUTPUTS_FULL.md",
    "PROMPT_OWNER_MATRIX.md",
    "RUNTIME_RESULTS.json",
    "COST_RESULTS.json",
    "SOURCE_MANIFEST.json",
    // keep map out of human-facing zip? include for operators but README says hidden until scoring
    "_HIDDEN_MAP.json",
  ]) {
    const src = join(DOCS, name);
    if (existsSync(src)) copyFileSync(src, join(REVIEW, name));
  }
}

function main() {
  buildBlinds();
  buildRawAndCost();
  buildOwnerMatrix();
  buildReadme();
  const avail = join(LIVE, "AVAILABILITY.json");
  if (existsSync(avail)) copyFileSync(avail, join(DOCS, "AVAILABILITY.json"));
  syncReview();
  console.log("Audit 55 packets written to", DOCS, "and", REVIEW);
}

main();
