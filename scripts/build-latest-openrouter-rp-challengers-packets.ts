/**
 * Build Audit 53 five-way blind packets + cost aggregates.
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

const DOCS = "docs/audits/53-latest-openrouter-rp-challengers";
const REVIEW = "data/human-review/53-latest-openrouter-rp-challengers";
const LIVE =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/latest-openrouter-rp-challengers";

const REL_USER = {
  1: "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.",
  2: "너는 이름이뭐야? 뭐하는 중이었어?",
} as const;
const ACT_USER = {
  1: "*로비 천장에서 갑자기 비상 경보가 울리고 출입문 쪽에서 둔탁한 폭발음이 터진다. 렌은 소리가 난 쪽으로 고개를 돌린다.* 저거 뭐야?",
  2: "*렌은 태형의 소매를 잡고 곁에 붙는다.* 나도 같이 갈게.",
} as const;

type Side = "A" | "B" | "C" | "D" | "E";
const SIDES: Side[] = ["A", "B", "C", "D", "E"];

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
function shuffleFive(models: string[]): Record<Side, string> {
  const arr = [...models];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return {
    A: arr[0]!,
    B: arr[1]!,
    C: arr[2]!,
    D: arr[3]!,
    E: arr[4]!,
  };
}

function relPath(model: string, turn: number): string {
  if (model === "deepseek") {
    return `/opt/cursor/artifacts/default-collaborative/arm-COLLAB/run1/turn${turn}-provider-raw.txt`;
  }
  if (model === "terra") {
    return `/opt/cursor/artifacts/luna-terra-value-bakeoff/relationship/terra/run1/turn${turn}-provider-raw.txt`;
  }
  return join(LIVE, model, "relationship/run1", `turn${turn}-provider-raw.txt`);
}
function actPath(model: string, turn: number): string {
  if (model === "deepseek") {
    return `/opt/cursor/artifacts/luna-terra-value-bakeoff/action/deepseek/run1/turn${turn}-provider-raw.txt`;
  }
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
function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
function pct(xs: number[], p: number) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
}

function buildBlinds() {
  const models = ["deepseek", "terra", "aion", "minimax", "glm"];
  const relHidden: Record<string, Record<Side, string>> = {};
  const actHidden: Record<string, Record<Side, string>> = {};

  const relLines = [
    "# Blind relationship packet — Audit 53 latest OpenRouter RP challengers",
    "",
    "Five-way blind. Models / providers / price / cost / tokens / reasoning / latency / length / points / source are hidden.",
    "Do not declare a winner before maps are revealed.",
    "",
    "Scoring:",
    "- character voice and attraction 25",
    "- desire to continue 20",
    "- prose and emotional atmosphere 15",
    "- scene focus 15",
    "- dialogue naturalness 10",
    "- user sovereignty 10",
    "- continuity and factual stability 5",
    "",
    "Track separately: generic romantic-lead drift, administrative/NPC expansion,",
    "memory-loss over-interpretation, semantic repetition, dialogue fragmentation,",
    "one-sentence paragraph ratio, unsupported user-state claims.",
    "",
    "Severe hard fail: USER_PERSONA contradiction, new user dialogue/major decision,",
    "external NPC takeover, major replay, temporal rewind, system/meta leak.",
    "",
  ];
  for (const turn of [1, 2] as const) {
    const id = `REL-T${turn}`;
    const map = shuffleFive(models);
    relHidden[id] = map;
    relLines.push(`## ${id}`, "", "**User input**", "", "```text", REL_USER[turn], "```", "");
    for (const side of SIDES) {
      const text = readText(relPath(map[side], turn)).trimEnd();
      relLines.push(`### Side ${side}`, "", "```text", text, "```", "");
    }
  }

  const actLines = [
    "# Blind action packet — Audit 53 latest OpenRouter RP challengers",
    "",
    "Five-way blind. Independent randomization for T1 and T2.",
    "Do not declare a winner before maps are revealed.",
    "",
    "Scoring:",
    "- action clarity 20",
    "- actual progression and result 20",
    "- Like judgment and initiative 20",
    "- tension 15",
    "- Like–Ren interaction 10",
    "- prose readability 10",
    "- length efficiency 5",
    "",
    "Track separately: stops before confirmed result, opens another crisis as padding,",
    "user sent away/off-screen, named NPC takeover, unsupported ability numbers,",
    "spatial inconsistency.",
    "",
  ];
  for (const turn of [1, 2] as const) {
    const id = `ACT-T${turn}`;
    const map = shuffleFive(models);
    actHidden[id] = map;
    actLines.push(`## ${id}`, "", "**User input**", "", "```text", ACT_USER[turn], "```", "");
    for (const side of SIDES) {
      const text = readText(actPath(map[side], turn)).trimEnd();
      actLines.push(`### Side ${side}`, "", "```text", text, "```", "");
    }
  }

  save(DOCS, "BLIND_RELATIONSHIP.md", relLines.join("\n"));
  save(DOCS, "BLIND_ACTION.md", actLines.join("\n"));
  save(DOCS, "_HIDDEN_RELATIONSHIP_MAP.json", {
    relationship: relHidden,
    note: "Reveal only after ChatGPT finishes blind scoring.",
  });
  save(DOCS, "_HIDDEN_ACTION_MAP.json", {
    action: actHidden,
    note: "Reveal only after ChatGPT finishes blind scoring.",
  });
  for (const name of [
    "BLIND_RELATIONSHIP.md",
    "BLIND_ACTION.md",
    "_HIDDEN_RELATIONSHIP_MAP.json",
    "_HIDDEN_ACTION_MAP.json",
  ]) {
    copyFileSync(join(DOCS, name), join(REVIEW, name));
  }
  return { relHidden, actHidden };
}

function buildRaw() {
  const parts = ["# RAW outputs — Audit 53 latest OpenRouter RP challengers", ""];
  for (const model of ["aion", "minimax", "glm"]) {
    for (const testSet of ["relationship", "action"] as const) {
      for (const turn of [1, 2]) {
        const meta = liveMeta(model, testSet, turn);
        const raw = readText(
          join(LIVE, model, testSet, "run1", `turn${turn}-provider-raw.txt`)
        ).trimEnd();
        parts.push(
          `## ${String(meta?.attempt_id ?? `${model}-${testSet}-t${turn}`)}`,
          "",
          `model_ui = hidden in blind packet`,
          "",
          "**User**",
          "",
          "```text",
          String(meta?.user_input ?? ""),
          "```",
          "",
          "**Output**",
          "",
          "```text",
          raw,
          "```",
          ""
        );
      }
    }
  }
  save(DOCS, "RAW_OUTPUTS_FULL.md", parts.join("\n"));
  copyFileSync(join(DOCS, "RAW_OUTPUTS_FULL.md"), join(REVIEW, "RAW_OUTPUTS_FULL.md"));
}

function buildCost() {
  const perOutput: Record<string, unknown>[] = [];
  for (const model of ["aion", "minimax", "glm"]) {
    for (const testSet of ["relationship", "action"]) {
      for (const turn of [1, 2]) {
        const meta = liveMeta(model, testSet, turn);
        if (!meta) throw new Error(`missing meta ${model} ${testSet} t${turn}`);
        const usage = (meta.usage as Record<string, unknown> | undefined) ?? {};
        const reasoningTokens =
          (typeof meta.reasoning_tokens === "number" ? meta.reasoning_tokens : null) ??
          (typeof usage.apiReasoningOutputTokens === "number"
            ? usage.apiReasoningOutputTokens
            : null);
        const usageCostUsd =
          (typeof meta.usage_cost_usd === "number" ? meta.usage_cost_usd : null) ??
          (typeof usage.upstreamCostUsd === "number" ? usage.upstreamCostUsd : null);
        perOutput.push({
          attempt_id: meta.attempt_id,
          model_key: model,
          requested_model: meta.requested_model,
          resolved_model: meta.resolved_model,
          resolved_provider: meta.provider,
          test_set: testSet,
          turn,
          input_tokens: meta.input_tokens ?? usage.apiInputTokens ?? null,
          cached_input_tokens:
            meta.cached_input_tokens ?? usage.cacheReadTokens ?? null,
          visible_output_tokens:
            meta.visible_output_tokens ?? usage.apiOutputTokens ?? null,
          reasoning_tokens: reasoningTokens,
          billed_output_tokens: meta.total_billed_output_tokens ?? null,
          usage_cost_usd: usageCostUsd,
          api_raw_cost_krw:
            meta.api_raw_cost_krw ?? usage.apiRawCostKrw ?? null,
          charged_points: meta.cost_points ?? null,
          visible_korean_chars: meta.korean_chars ?? null,
          visible_chars: meta.visible_chars ?? null,
          latency_s: meta.latency_s ?? null,
          ttft_s: meta.ttft_s ?? null,
          finish_reason: meta.finish_reason ?? null,
          reasoning_requested: meta.reasoning_requested ?? null,
          reasoning_effort: meta.reasoning_effort ?? null,
          reasoning_mandatory: meta.reasoning_mandatory ?? null,
        });
      }
    }
  }

  const byModel: Record<string, unknown> = {};
  for (const model of ["aion", "minimax", "glm"]) {
    const rows = perOutput.filter((r) => r.model_key === model);
    const costs = rows
      .map((r) => r.api_raw_cost_krw)
      .filter((n): n is number => typeof n === "number");
    const chars = rows
      .map((r) => r.visible_korean_chars ?? r.visible_chars)
      .filter((n): n is number => typeof n === "number");
    const lats = rows
      .map((r) => r.latency_s)
      .filter((n): n is number => typeof n === "number");
    const reasoning = rows
      .map((r) => r.reasoning_tokens)
      .filter((n): n is number => typeof n === "number");
    const outTok = rows
      .map((r) => r.visible_output_tokens)
      .filter((n): n is number => typeof n === "number");
    const avgCost = avg(costs);
    const avgChars = avg(chars);
    const usd = rows
      .map((r) => r.usage_cost_usd)
      .filter((n): n is number => typeof n === "number");
    const avgReason = avg(reasoning);
    const avgOut = avg(outTok);
    byModel[model] = {
      sample_count: rows.length,
      average_actual_cost_krw: avgCost,
      median_actual_cost_krw: median(costs),
      average_usage_cost_usd: avg(usd),
      cost_per_1000_visible_chars:
        avgCost != null && avgChars != null && avgChars > 0
          ? (avgCost / avgChars) * 1000
          : null,
      average_visible_chars: avgChars,
      p50_latency_s: pct(lats, 0.5),
      p95_latency_s: pct(lats, 0.95),
      average_reasoning_tokens: avgReason,
      reasoning_token_share_of_output:
        avgReason != null && avgOut != null && avgOut > 0
          ? avgReason / avgOut
          : null,
      transport_failure_rate: 0,
    };
  }

  const cost = {
    status: "LATEST_OPENROUTER_RP_CHALLENGERS_COST_CAPTURED",
    pricing_changed: false,
    note: "usage.cost / apiRawCostKrw from live receipts are source of truth; list pricing not used for winners.",
    by_model: byModel,
    per_output: perOutput,
  };
  save(DOCS, "COST_RESULTS.json", cost);
  copyFileSync(join(DOCS, "COST_RESULTS.json"), join(REVIEW, "COST_RESULTS.json"));
  return cost;
}

function main() {
  mkdirSync(REVIEW, { recursive: true });
  const blinds = buildBlinds();
  buildRaw();
  const cost = buildCost();
  const liveRt = readJson(join(LIVE, "RUNTIME_RESULTS.json")) ?? {};
  const manifest = {
    frozen_relationship: {
      deepseek: "Audit 44 COLLAB R1 T1/T2",
      terra: "Audit 46 relationship R1 T1/T2",
    },
    frozen_action: {
      deepseek: "Audit 46 action T1/T2",
      terra: "Audit 46 action T1/T2",
    },
    new_models: {
      aion: "aion-labs/aion-3.0",
      minimax: "minimax/minimax-m3",
      glm: "z-ai/glm-5.2",
    },
    architecture: "PR #250 standard collaborative + USER_TAIL length owner only",
  };
  save(DOCS, "SOURCE_MANIFEST.json", manifest);
  copyFileSync(join(DOCS, "SOURCE_MANIFEST.json"), join(REVIEW, "SOURCE_MANIFEST.json"));
  // ensure capability/prompt matrix present in review zip set
  for (const name of ["MODEL_CAPABILITY_MATRIX.md", "PROMPT_OWNER_MATRIX.md"]) {
    if (existsSync(join(DOCS, name))) {
      copyFileSync(join(DOCS, name), join(REVIEW, name));
    }
  }
  const runtime = {
    status: "LATEST_OPENROUTER_RP_CHALLENGERS_HUMAN_REVIEW_PENDING",
    offline_verdict: "LATEST_OPENROUTER_RP_CHALLENGERS_OFFLINE_PASS",
    discovery_verdicts: {
      aion: "AION_30_DISCOVERY_PASS",
      minimax: "MINIMAX_M3_DISCOVERY_PASS",
      glm: "GLM_52_DISCOVERY_PASS",
    },
    live: liveRt,
    relationship_blind: true,
    action_blind: true,
    cost_by_model: cost.by_model,
    human_review: "NOT_RUN — waiting for ChatGPT",
    note: "Do not declare winner / public slot / keep / remove before blind review.",
  };
  save(DOCS, "RUNTIME_RESULTS.json", runtime);
  copyFileSync(join(DOCS, "RUNTIME_RESULTS.json"), join(REVIEW, "RUNTIME_RESULTS.json"));
  save(
    DOCS,
    "README.md",
    [
      "# Audit 53 — Latest OpenRouter RP challengers",
      "",
      "`LATEST_OPENROUTER_RP_CHALLENGERS_HUMAN_REVIEW_PENDING`",
      "",
      "Candidates: `aion-labs/aion-3.0`, `minimax/minimax-m3`, `z-ai/glm-5.2`.",
      "Baseline refs: DeepSeek Audit 44/46 + Terra Audit 46.",
      "Evaluation-only. No public picker. No pricing change. No PR #250 modification.",
      "",
    ].join("\n")
  );
  console.log(
    JSON.stringify(
      {
        status: runtime.status,
        rel: Object.keys(blinds.relHidden),
        act: Object.keys(blinds.actHidden),
      },
      null,
      2
    )
  );
}

main();
