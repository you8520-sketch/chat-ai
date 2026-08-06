/**
 * Build Muse value bake-off blind packets (relationship frozen + action Muse/frozen).
 * Does not declare winner / public candidate.
 */
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { createHash, randomInt } from "node:crypto";

const DOCS = "docs/audits/52-muse-value-bakeoff";
const REVIEW = "data/human-review/52-muse-value-bakeoff";
const MUSE_ACTION_ROOT =
  process.env.MUSE_ACTION_ROOT ??
  "/opt/cursor/artifacts/muse-value-bakeoff-action";

const REL_TURNS = [
  {
    id: "REL-R1T1",
    run: 1,
    turn: 1,
    user:
      "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.",
  },
  {
    id: "REL-R1T2",
    run: 1,
    turn: 2,
    user: "너는 이름이뭐야? 뭐하는 중이었어?",
  },
  {
    id: "REL-R2T1",
    run: 2,
    turn: 1,
    user:
      "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.",
  },
  {
    id: "REL-R2T2",
    run: 2,
    turn: 2,
    user: "너는 이름이뭐야? 뭐하는 중이었어?",
  },
] as const;

const ACT_TURNS = [
  {
    id: "ACT-T1",
    turn: 1,
    user:
      "*로비 천장에서 갑자기 비상 경보가 울리고 출입문 쪽에서 둔탁한 폭발음이 터진다. 렌은 소리가 난 쪽으로 고개를 돌린다.* 저거 뭐야?",
  },
  {
    id: "ACT-T2",
    turn: 2,
    user: "*렌은 태형의 소매를 잡고 곁에 붙는다.* 나도 같이 갈게.",
  },
] as const;

type SideMap = Record<"A" | "B" | "C", string>;

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

function shuffleThree(seedModels: [string, string, string]): SideMap {
  const arr = [...seedModels];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return { A: arr[0]!, B: arr[1]!, C: arr[2]! };
}

function relPath(model: string, run: number, turn: number): string {
  if (model === "deepseek") {
    return `/opt/cursor/artifacts/default-collaborative/arm-COLLAB/run${run}/turn${turn}-provider-raw.txt`;
  }
  if (model === "terra") {
    return `/opt/cursor/artifacts/luna-terra-value-bakeoff/relationship/terra/run${run}/turn${turn}-provider-raw.txt`;
  }
  if (model === "muse") {
    return `/opt/cursor/artifacts/muse-spark-baseline/run${run}/turn${turn}-provider-raw.txt`;
  }
  throw new Error(`unknown rel model ${model}`);
}

function actPath(model: string, turn: number): string {
  if (model === "deepseek") {
    return `/opt/cursor/artifacts/luna-terra-value-bakeoff/action/deepseek/run1/turn${turn}-provider-raw.txt`;
  }
  if (model === "terra") {
    return `/opt/cursor/artifacts/luna-terra-value-bakeoff/action/terra/run1/turn${turn}-provider-raw.txt`;
  }
  if (model === "muse") {
    return join(MUSE_ACTION_ROOT, `run1/turn${turn}-provider-raw.txt`);
  }
  throw new Error(`unknown act model ${model}`);
}

function actMeta(model: string, turn: number): Record<string, unknown> | null {
  if (model === "deepseek") {
    return readJson(
      `/opt/cursor/artifacts/luna-terra-value-bakeoff/action/deepseek/run1/turn${turn}-meta.json`
    );
  }
  if (model === "terra") {
    return readJson(
      `/opt/cursor/artifacts/luna-terra-value-bakeoff/action/terra/run1/turn${turn}-meta.json`
    );
  }
  if (model === "muse") {
    return readJson(join(MUSE_ACTION_ROOT, `run1/turn${turn}-meta.json`));
  }
  return null;
}

function museRelMeta(run: number, turn: number) {
  return readJson(
    `/opt/cursor/artifacts/muse-spark-baseline/run${run}/turn${turn}-meta.json`
  );
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function buildRelationship() {
  const hidden: Record<string, SideMap> = {};
  const manifest: Record<string, unknown> = {
    deepseek: {
      audit: 44,
      arm: "COLLAB",
      root: "/opt/cursor/artifacts/default-collaborative/arm-COLLAB",
    },
    terra: {
      audit: 46,
      root: "/opt/cursor/artifacts/luna-terra-value-bakeoff/relationship/terra",
    },
    muse: {
      audit: 49,
      root: "/opt/cursor/artifacts/muse-spark-baseline",
    },
    inputs: {
      turn1:
        "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.",
      turn2: "너는 이름이뭐야? 뭐하는 중이었어?",
    },
  };

  const lines: string[] = [
    "# Blind relationship packet — Audit 52 Muse value bake-off",
    "",
    "Models / providers / length / points / cost / latency / source audit are hidden.",
    "Score Side A / B / C only. Do not declare winner / PASS / public candidate here.",
    "",
    "Scoring axes (relationship):",
    "- character voice and attraction 25",
    "- desire to continue chatting 20",
    "- prose and emotional atmosphere 20",
    "- scene focus 15",
    "- dialogue naturalness 10",
    "- continuity and factual stability 5",
    "- length efficiency 5",
    "",
    "Record separately: semantic repetition, generic-romance-lead drift,",
    "memory-loss over-interpretation, unsupported scene-detail invention,",
    "dialogue fragmentation, one-sentence paragraph ratio.",
    "",
    "Hard fail only: USER_PERSONA contradiction, new user dialogue/major decision,",
    "external NPC takeover, major replay, temporal rewind, system/meta leak.",
    "",
  ];

  for (const t of REL_TURNS) {
    const map = shuffleThree(["deepseek", "terra", "muse"]);
    hidden[t.id] = map;
    lines.push(`## ${t.id}`, "", "**User input**", "", "```text", t.user, "```", "");
    for (const side of ["A", "B", "C"] as const) {
      const model = map[side];
      const text = readText(relPath(model, t.run, t.turn)).trimEnd();
      lines.push(`### Side ${side}`, "", "```text", text, "```", "");
    }
  }

  save(DOCS, "BLIND_RELATIONSHIP.md", lines.join("\n"));
  save(DOCS, "_HIDDEN_RELATIONSHIP_MAP.json", {
    seed_note: "per-pair independent shuffle",
    relationship: hidden,
    note: "Reveal only after ChatGPT finishes blind scoring.",
  });
  save(DOCS, "RELATIONSHIP_SOURCE_MANIFEST.json", manifest);
  save(REVIEW, "BLIND_RELATIONSHIP.md", lines.join("\n"));
  save(REVIEW, "_HIDDEN_RELATIONSHIP_MAP.json", {
    seed_note: "per-pair independent shuffle",
    relationship: hidden,
    note: "Reveal only after ChatGPT finishes blind scoring.",
  });
  save(REVIEW, "RELATIONSHIP_SOURCE_MANIFEST.json", manifest);
  return hidden;
}

function buildAction() {
  const hidden: Record<string, SideMap> = {};
  const museRawParts: string[] = ["# Muse action RAW — Audit 52", ""];
  const lines: string[] = [
    "# Blind action packet — Audit 52 Muse value bake-off",
    "",
    "Models randomized independently for T1 and T2.",
    "Score Side A / B / C only. Do not declare winner / PASS / public candidate here.",
    "",
    "Scoring axes (action):",
    "- action clarity 20",
    "- actual progression and result 20",
    "- Like judgment and initiative 20",
    "- tension 15",
    "- Like–Ren interaction 10",
    "- prose readability 10",
    "- length efficiency 5",
    "",
  ];

  for (const t of ACT_TURNS) {
    const map = shuffleThree(["deepseek", "terra", "muse"]);
    hidden[t.id] = map;
    const museText = readText(actPath("muse", t.turn)).trimEnd();
    museRawParts.push(
      `## MUSE-ACT-R1T${t.turn}`,
      "",
      "**User**",
      "",
      "```text",
      t.user,
      "```",
      "",
      "**Output**",
      "",
      "```text",
      museText,
      "```",
      ""
    );
    lines.push(`## ${t.id}`, "", "**User input**", "", "```text", t.user, "```", "");
    for (const side of ["A", "B", "C"] as const) {
      const model = map[side];
      const text = readText(actPath(model, t.turn)).trimEnd();
      lines.push(`### Side ${side}`, "", "```text", text, "```", "");
    }
  }

  save(DOCS, "BLIND_ACTION.md", lines.join("\n"));
  save(DOCS, "_HIDDEN_ACTION_MAP.json", {
    action: hidden,
    note: "Reveal only after ChatGPT finishes blind scoring.",
  });
  save(DOCS, "RAW_MUSE_ACTION.md", museRawParts.join("\n"));
  save(REVIEW, "BLIND_ACTION.md", lines.join("\n"));
  save(REVIEW, "_HIDDEN_ACTION_MAP.json", {
    action: hidden,
    note: "Reveal only after ChatGPT finishes blind scoring.",
  });
  save(REVIEW, "RAW_MUSE_ACTION.md", museRawParts.join("\n"));
  return hidden;
}

function buildCost() {
  const perOutput: unknown[] = [];
  let relationshipCostIncomplete = false;

  for (const t of REL_TURNS) {
    const meta = museRelMeta(t.run, t.turn);
    if (!meta) {
      relationshipCostIncomplete = true;
      continue;
    }
    const hasUsageCost =
      typeof meta.usage_cost === "number" ||
      (meta.usage &&
        typeof (meta.usage as Record<string, unknown>).cost === "number");
    const hasTokenBreakdown =
      typeof meta.input_tokens === "number" ||
      typeof meta.visible_output_tokens === "number";
    if (!hasUsageCost || !hasTokenBreakdown) {
      relationshipCostIncomplete = true;
    }
    perOutput.push({
      attempt_id: meta.attempt_id ?? `MUSE-REL-R${t.run}T${t.turn}`,
      test_set: "relationship",
      source: "audit49_frozen",
      input_tokens: meta.input_tokens ?? null,
      visible_output_tokens: meta.visible_output_tokens ?? meta.output_tokens ?? null,
      reasoning_tokens: meta.reasoning_tokens ?? null,
      total_billed_output_tokens: meta.total_billed_output_tokens ?? null,
      usage_cost: meta.usage_cost ?? null,
      apiRawCostKrw: meta.api_raw_cost_krw ?? null,
      charged_points: meta.cost_points ?? null,
      visible_korean_chars: meta.visible_chars ?? null,
      latency_s: meta.latency_s ?? null,
      resolved_provider: meta.provider ?? "openrouter",
      finish_reason: meta.finish_reason ?? null,
      note: "Frozen Audit 49 metas lack usage.cost / token breakdown",
    });
  }

  for (const t of ACT_TURNS) {
    const meta = actMeta("muse", t.turn);
    if (!meta) throw new Error(`missing muse action meta turn${t.turn}`);
    perOutput.push({
      attempt_id: meta.attempt_id ?? `MUSE-ACT-R1T${t.turn}`,
      test_set: "action",
      source: "audit52_live",
      input_tokens: meta.input_tokens ?? null,
      visible_output_tokens:
        meta.visible_output_tokens ?? meta.output_tokens ?? null,
      reasoning_tokens: meta.reasoning_tokens ?? null,
      total_billed_output_tokens: meta.total_billed_output_tokens ?? null,
      usage_cost:
        meta.usage_cost ??
        (meta.usage && typeof (meta.usage as Record<string, unknown>).cost === "number"
          ? (meta.usage as Record<string, unknown>).cost
          : null),
      apiRawCostKrw: meta.api_raw_cost_krw ?? null,
      charged_points: meta.cost_points ?? null,
      visible_korean_chars: meta.korean_chars ?? meta.visible_chars ?? null,
      latency_s: meta.latency_s ?? null,
      resolved_provider: meta.provider ?? "openrouter",
      finish_reason: meta.finish_reason ?? null,
    });
  }

  const actualCosts = perOutput
    .map((r) => (r as { apiRawCostKrw: number | null }).apiRawCostKrw)
    .filter((n): n is number => typeof n === "number");
  const points = perOutput
    .map((r) => (r as { charged_points: number | null }).charged_points)
    .filter((n): n is number => typeof n === "number");
  const latencies = perOutput
    .map((r) => (r as { latency_s: number | null }).latency_s)
    .filter((n): n is number => typeof n === "number")
    .sort((a, b) => a - b);
  const chars = perOutput
    .map((r) => (r as { visible_korean_chars: number | null }).visible_korean_chars)
    .filter((n): n is number => typeof n === "number");

  const avg = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const avgCost = avg(actualCosts);
  const avgPoints = avg(points);
  const avgChars = avg(chars);
  const grossMargin =
    avgCost != null && avgPoints != null && avgPoints > 0
      ? (avgPoints - avgCost) / avgPoints
      : null;
  const costPer1000 =
    avgCost != null && avgChars != null && avgChars > 0
      ? (avgCost / avgChars) * 1000
      : null;

  const actionRuntime = readJson(join(MUSE_ACTION_ROOT, "RUNTIME_RESULTS.json"));
  const exclusions = Array.isArray(actionRuntime?.exclusions)
    ? actionRuntime!.exclusions
    : [];
  const attempts = typeof actionRuntime?.attempts === "number" ? actionRuntime.attempts : null;
  const valid = typeof actionRuntime?.valid === "number" ? actionRuntime.valid : null;
  const errorRate =
    attempts != null && attempts > 0 ? exclusions.length / attempts : null;

  const aggregate = {
    actual_cost_sample_count: actualCosts.length,
    average_actual_cost_krw: avgCost,
    median_actual_cost_krw: median(actualCosts),
    average_charged_points: avgPoints,
    gross_margin: grossMargin,
    cost_per_1000_visible_chars: costPer1000,
    p50_latency_s: percentile(latencies, 0.5),
    p95_latency_s: percentile(latencies, 0.95),
    exclusion_or_429_rate: errorRate,
    relationship_cost_incomplete: relationshipCostIncomplete,
    flags: relationshipCostIncomplete
      ? ["MUSE_RELATIONSHIP_COST_INCOMPLETE"]
      : [],
  };

  const costResults = {
    status: "MUSE_VALUE_BAKEOFF_COST_CAPTURED",
    pricing_changed: false,
    aggregate,
    per_output: perOutput,
  };
  save(DOCS, "COST_RESULTS.json", costResults);
  save(REVIEW, "COST_RESULTS.json", costResults);

  const sanity = [
    "# Muse pricing sanity — Audit 52",
    "",
    "Do **not** change production pricing from this bake-off.",
    "",
    "```text",
    `actual-cost sample count = ${aggregate.actual_cost_sample_count}`,
    `average actual cost KRW = ${aggregate.average_actual_cost_krw}`,
    `median actual cost KRW = ${aggregate.median_actual_cost_krw}`,
    `average charged points = ${aggregate.average_charged_points}`,
    `gross margin = ${aggregate.gross_margin}`,
    `cost per 1000 visible chars = ${aggregate.cost_per_1000_visible_chars}`,
    `p50 latency = ${aggregate.p50_latency_s}`,
    `p95 latency = ${aggregate.p95_latency_s}`,
    `429/error rate (action attempts) = ${aggregate.exclusion_or_429_rate}`,
    relationshipCostIncomplete
      ? "MUSE_RELATIONSHIP_COST_INCOMPLETE"
      : "relationship cost fields present",
    "```",
    "",
    "Actual cost uses `apiRawCostKrw` from provider receipts — not inferred from charged points.",
    "Frozen Audit 49 relationship metas store api_raw_cost_krw + points but lack usage.cost / token splits.",
    "",
  ].join("\n");
  save(DOCS, "MUSE_PRICING_SANITY.md", sanity);
  save(REVIEW, "MUSE_PRICING_SANITY.md", sanity);
  return { aggregate, relationshipCostIncomplete, actionRuntime };
}

function main() {
  const relHidden = buildRelationship();
  const actHidden = buildAction();
  const cost = buildCost();
  const actionRuntime = cost.actionRuntime ?? {};
  const runtime = {
    status: "MUSE_VALUE_BAKEOFF_HUMAN_REVIEW_PENDING",
    offline_verdict: "MUSE_VALUE_BAKEOFF_OFFLINE_PASS",
    relationship_blind: true,
    action_blind: true,
    action_attempts: actionRuntime.attempts ?? null,
    action_valid: actionRuntime.valid ?? null,
    action_replacement_calls: actionRuntime.replacement_calls ?? null,
    action_exclusions: actionRuntime.exclusions ?? [],
    muse_aggregate: cost.aggregate,
    human_review: "NOT_RUN — waiting for ChatGPT",
    note: "Do not declare winner / public candidate / keep / remove / best value before blind review.",
  };
  save(DOCS, "RUNTIME_RESULTS.json", runtime);
  save(REVIEW, "RUNTIME_RESULTS.json", runtime);
  save(
    DOCS,
    "README.md",
    [
      "# Audit 52 — Muse Spark 1.2 value bake-off",
      "",
      "`MUSE_VALUE_BAKEOFF_HUMAN_REVIEW_PENDING`",
      "",
      "Frozen relationship: DeepSeek Audit 44 COLLAB + Terra Audit 46 + Muse Audit 49.",
      "Action: Muse new live + DeepSeek/Terra frozen Audit 46.",
      "No Muse adapter. No public picker exposure. No pricing change.",
      "",
    ].join("\n")
  );

  // Zip-friendly copy of blinds
  for (const name of [
    "BLIND_RELATIONSHIP.md",
    "BLIND_ACTION.md",
    "RAW_MUSE_ACTION.md",
    "MUSE_PRICING_SANITY.md",
  ]) {
    const src = join(DOCS, name);
    if (existsSync(src)) copyFileSync(src, join(REVIEW, name));
  }

  console.log(
    JSON.stringify(
      {
        relationship_pairs: Object.keys(relHidden).length,
        action_pairs: Object.keys(actHidden).length,
        status: runtime.status,
        relationship_cost_incomplete: cost.relationshipCostIncomplete,
        hash: createHash("sha256")
          .update(JSON.stringify({ relHidden, actHidden }))
          .digest("hex")
          .slice(0, 12),
      },
      null,
      2
    )
  );
}

main();
