/**
 * Build Audit 46 blind + cost packets from live capture.
 * Does NOT declare winner / PASS / production candidate.
 */
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  cpSync,
} from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

const ART =
  process.env.OUT_ROOT ?? "/opt/cursor/artifacts/luna-terra-value-bakeoff";
const DOCS = "docs/audits/46-luna-terra-value-bakeoff";
const REVIEW = "data/human-review/46-luna-terra-value-bakeoff";

type ValidRow = {
  attempt_id: string;
  model_key: "deepseek" | "luna" | "terra";
  model_ui: string;
  test_set: "relationship" | "action";
  run: number;
  turn: number;
  user_input: string;
  provider_raw: string;
  finish_reason: string | null;
  latency_s: number;
  visible_chars: number;
  korean_chars: number;
  replacement: boolean;
  raw_hash: string;
  resolved_model?: string;
  provider?: string;
  cost_points: number | null;
  total_points_cost: number | null;
  upstream_cost_usd: number | null;
  api_raw_cost_krw: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  total_billed_output_tokens: number | null;
  usage: Record<string, unknown> | null;
};

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
function save(dir: string, name: string, content: string | object) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
function p95(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
}

function structuralStats(text: string) {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const dialogueBlocks = paras.filter((p) => /["“「『]/.test(p) && p.length < 200);
  let maxConsec = 0;
  let cur = 0;
  for (const p of paras) {
    const isDlg = /["“「『]/.test(p) && ![...p].length;
    // dialogue-ish: starts with quote or is short quoted line
    const dlg =
      /^\s*["“「『]/.test(p) ||
      (p.includes('"') && [...p].length < 80);
    if (dlg) {
      cur += 1;
      maxConsec = Math.max(maxConsec, cur);
    } else cur = 0;
  }
  const oneSentence = paras.filter((p) => (p.match(/[.!?。…]/g) || []).length <= 1);
  const narrChars = paras
    .filter((p) => !/^\s*["“「『]/.test(p))
    .reduce((n, p) => n + [...p].length, 0);
  const total = Math.max(1, [...text].length);
  return {
    paragraph_count: paras.length,
    dialogue_block_count: dialogueBlocks.length,
    maximum_consecutive_dialogue_blocks: maxConsec,
    one_sentence_paragraph_ratio: paras.length
      ? oneSentence.length / paras.length
      : 0,
    narration_ratio: narrChars / total,
  };
}

function main() {
  const rowsPath = join(ART, "all_valid_rows.json");
  if (!existsSync(rowsPath)) throw new Error(`missing ${rowsPath}`);
  const rows = JSON.parse(readFileSync(rowsPath, "utf8")) as ValidRow[];
  const idx = JSON.parse(
    readFileSync(join(ART, "outputs_index.json"), "utf8")
  ) as Record<string, unknown>;
  const offlineHashes = existsSync(
    "docs/audits/46-luna-terra-value-bakeoff/PROMPT_HASHES.json"
  )
    ? JSON.parse(
        readFileSync(
          "docs/audits/46-luna-terra-value-bakeoff/PROMPT_HASHES.json",
          "utf8"
        )
      )
    : null;

  const seed = randomBytes(4).readUInt32BE(0);
  const rng = mulberry32(seed);
  const sides = ["A", "B", "C"] as const;

  // Relationship blind: for each run×turn, shuffle three models into A/B/C
  const relMap: Record<string, Record<string, string>> = {};
  const relSections: string[] = [
    "# Blind relationship packet — Audit 46",
    "",
    "Models hidden. Prefer Side A / B / C per pair. Do not declare winner/PASS here.",
    "",
    "Scoring axes (relationship):",
    "- 캐릭터 매력·목소리 25",
    "- 계속 대화하고 싶은 정도 20",
    "- 장면 중심·몰입감 15",
    "- 대사 자연스러움·절제 15",
    "- 문단·서술 리듬 10",
    "- 유저 주권 10",
    "- 반복·분량 효율 5",
    "",
  ];

  for (const run of [1, 2]) {
    for (const turn of [1, 2]) {
      const byModel = (["deepseek", "luna", "terra"] as const).map((k) => {
        const r = rows.find(
          (x) =>
            x.test_set === "relationship" &&
            x.model_key === k &&
            x.run === run &&
            x.turn === turn
        );
        if (!r) throw new Error(`missing relationship ${k} R${run}T${turn}`);
        return r;
      });
      const order = shuffle([...byModel], rng);
      const pairKey = `REL-R${run}T${turn}`;
      relMap[pairKey] = {};
      const userInput = byModel[0]!.user_input;
      relSections.push(`## ${pairKey}`);
      relSections.push("");
      relSections.push(`**User input**`);
      relSections.push("");
      relSections.push("```text");
      relSections.push(userInput);
      relSections.push("```");
      relSections.push("");
      for (let i = 0; i < 3; i++) {
        const side = sides[i]!;
        const row = order[i]!;
        relMap[pairKey]![side] = row.model_key;
        relSections.push(`### Side ${side}`);
        relSections.push("");
        relSections.push("```text");
        relSections.push(row.provider_raw.trimEnd());
        relSections.push("```");
        relSections.push("");
      }
    }
  }

  // Action blind: for each turn, shuffle three models
  const actMap: Record<string, Record<string, string>> = {};
  const actSections: string[] = [
    "# Blind action packet — Audit 46",
    "",
    "Models hidden. Prefer Side A / B / C per turn. Do not declare winner/PASS here.",
    "",
    "Scoring axes (action):",
    "- 행동의 명료성 20",
    "- 실제 진행과 결과 20",
    "- 캐릭터 판단·주도성 20",
    "- 장면 긴장감 15",
    "- 유저와의 상호작용 10",
    "- 문체·가독성 10",
    "- 분량 효율 5",
    "",
  ];
  for (const turn of [1, 2]) {
    const byModel = (["deepseek", "luna", "terra"] as const).map((k) => {
      const r = rows.find(
        (x) => x.test_set === "action" && x.model_key === k && x.turn === turn
      );
      if (!r) throw new Error(`missing action ${k} T${turn}`);
      return r;
    });
    const order = shuffle([...byModel], rng);
    const pairKey = `ACT-T${turn}`;
    actMap[pairKey] = {};
    actSections.push(`## ${pairKey}`);
    actSections.push("");
    actSections.push(`**User input**`);
    actSections.push("");
    actSections.push("```text");
    actSections.push(byModel[0]!.user_input);
    actSections.push("```");
    actSections.push("");
    for (let i = 0; i < 3; i++) {
      const side = sides[i]!;
      const row = order[i]!;
      actMap[pairKey]![side] = row.model_key;
      actSections.push(`### Side ${side}`);
      actSections.push("");
      actSections.push("```text");
      actSections.push(row.provider_raw.trimEnd());
      actSections.push("```");
      actSections.push("");
    }
  }

  // RAW full (labeled — for operators, not blind)
  const rawLines: string[] = [
    "# RAW outputs — Audit 46 Luna/Terra value bake-off",
    "",
    "Labeled full outputs (not for blind review).",
    "",
  ];
  for (const row of rows) {
    rawLines.push(`## ${row.attempt_id}`);
    rawLines.push("");
    rawLines.push(
      `- model_ui: \`${row.model_ui}\` · set: ${row.test_set} · chars: ${row.visible_chars} · finish: ${row.finish_reason}`
    );
    rawLines.push("");
    rawLines.push("```text");
    rawLines.push(row.provider_raw.trimEnd());
    rawLines.push("```");
    rawLines.push("");
  }

  // Cost aggregates — prefer usage.apiRawCostKrw (provider money). usage.cost = charged points.
  const costByModel: Record<string, unknown> = {};
  for (const mk of ["deepseek", "luna", "terra"] as const) {
    const withKrw = rows.filter(
      (r) => r.model_key === mk && r.api_raw_cost_krw != null
    );
    const allModel = rows.filter((r) => r.model_key === mk);
    const costsKrw = withKrw
      .map((r) => r.api_raw_cost_krw!)
      .filter((n) => Number.isFinite(n));
    const points = allModel
      .map((r) => r.total_points_cost ?? r.cost_points)
      .filter((n): n is number => typeof n === "number");
    const lat = allModel
      .filter((r) => !(r.test_set === "relationship" && r.model_key === "deepseek"))
      .map((r) => r.latency_s)
      .filter((n) => n > 0);
    const chars = allModel.map((r) => r.visible_chars);
    const costPer1k = withKrw
      .filter((r) => r.visible_chars > 0)
      .map((r) => (r.api_raw_cost_krw! / r.visible_chars) * 1000);
    const avgCost = avg(costsKrw);
    const avgPoints = avg(points);
    costByModel[mk] = {
      model_ui: allModel[0]?.model_ui,
      n_valid: allModel.length,
      n_with_actual_cost: withKrw.length,
      actual_cost_unit: "KRW (usage.apiRawCostKrw)",
      average_actual_cost_krw: avgCost,
      median_actual_cost_krw: median(costsKrw),
      average_charged_points: avgPoints,
      // rough margin proxy: points charged vs KRW raw — not production pricing decision
      gross_margin_proxy_points_minus_krw:
        avgPoints != null && avgCost != null ? avgPoints - avgCost : null,
      cost_per_1000_visible_chars_krw: avg(costPer1k),
      p50_latency_s: median(lat),
      p95_latency_s: p95(lat),
      average_visible_chars: avg(chars),
      transport_failure_rate_note:
        "see RUNTIME_RESULTS.exclusions (per-model×set replacement budget)",
      rows: allModel.map((r) => ({
        attempt_id: r.attempt_id,
        test_set: r.test_set,
        visible_chars: r.visible_chars,
        korean_chars: r.korean_chars,
        latency_s: r.latency_s,
        input_tokens: r.input_tokens,
        output_tokens: r.output_tokens,
        reasoning_tokens: r.reasoning_tokens,
        total_billed_output_tokens: r.total_billed_output_tokens,
        upstream_cost_usd: r.upstream_cost_usd,
        api_raw_cost_krw: r.api_raw_cost_krw,
        charged_points_usage_cost: r.cost_points,
        total_points_cost: r.total_points_cost,
        provider: r.provider,
        resolved_model: r.resolved_model,
        finish_reason: r.finish_reason,
        replacement: r.replacement,
        structural: structuralStats(r.provider_raw),
      })),
    };
  }

  const hidden = {
    seed,
    relationship: relMap,
    action: actMap,
    note: "Reveal only after ChatGPT finishes blind scoring.",
  };

  const runtime = {
    status: "LUNA_TERRA_VALUE_BAKEOFF_HUMAN_REVIEW_PENDING",
    generated_at: new Date().toISOString(),
    architecture: "PR #248 collaborative interactive; model terminal length owners only",
    offline_verdict: offlineHashes?.verdict ?? null,
    attempts: idx.attempts,
    replacement_calls: idx.replacement_calls,
    exclusions: idx.exclusions,
    frozen_deepseek_relationship: 4,
    counts: {
      deepseek_relationship_valid: rows.filter(
        (r) => r.model_key === "deepseek" && r.test_set === "relationship"
      ).length,
      luna_relationship_valid: rows.filter(
        (r) => r.model_key === "luna" && r.test_set === "relationship"
      ).length,
      terra_relationship_valid: rows.filter(
        (r) => r.model_key === "terra" && r.test_set === "relationship"
      ).length,
      deepseek_action_valid: rows.filter(
        (r) => r.model_key === "deepseek" && r.test_set === "action"
      ).length,
      luna_action_valid: rows.filter(
        (r) => r.model_key === "luna" && r.test_set === "action"
      ).length,
      terra_action_valid: rows.filter(
        (r) => r.model_key === "terra" && r.test_set === "action"
      ).length,
    },
    human_review: "NOT_RUN — waiting for ChatGPT",
    note: "Do not declare winner / PASS / best value / production candidate before blind review.",
  };

  mkdirSync(DOCS, { recursive: true });
  mkdirSync(REVIEW, { recursive: true });

  // Preserve offline artifacts if present
  for (const name of [
    "PROMPT_OWNER_MATRIX.md",
    "PROMPT_HASHES.json",
    "OFFLINE_VERDICT.json",
  ]) {
    const p = join(DOCS, name);
    if (existsSync(p)) {
      // keep
    }
  }

  save(DOCS, "RAW_OUTPUTS_FULL.md", rawLines.join("\n"));
  save(DOCS, "BLIND_RELATIONSHIP.md", relSections.join("\n"));
  save(DOCS, "BLIND_ACTION.md", actSections.join("\n"));
  save(DOCS, "_HIDDEN_MODEL_MAP.json", hidden);
  save(DOCS, "RUNTIME_RESULTS.json", runtime);
  save(DOCS, "COST_RESULTS.json", {
    status: "COST_CAPTURED",
    prefer: "usage.cost / upstreamCostUsd over estimated token tables",
    by_model: costByModel,
    note: "Cost/model/latency hidden from blind packets.",
  });
  save(
    DOCS,
    "README.md",
    [
      "# Audit 46 — Luna / Terra value bake-off",
      "",
      "```text",
      "LUNA_TERRA_VALUE_BAKEOFF_HUMAN_REVIEW_PENDING",
      "```",
      "",
      "Shared architecture = PR #248 collaborative default.",
      "Model difference = existing terminal length owner only.",
      "",
      "- DeepSeek relationship: frozen Audit 44 COLLAB (0 new calls)",
      "- Luna/Terra relationship: 2 chats × T1→T2 each",
      "- Action: all three models × 1 chat × T1→T2",
      "",
      "Blind: `BLIND_RELATIONSHIP.md`, `BLIND_ACTION.md`",
      "Map: `_HIDDEN_MODEL_MAP.json` (reveal after scoring)",
      "",
    ].join("\n")
  );

  // Mirror for human-review zip folder
  for (const f of [
    "RAW_OUTPUTS_FULL.md",
    "BLIND_RELATIONSHIP.md",
    "BLIND_ACTION.md",
    "_HIDDEN_MODEL_MAP.json",
    "PROMPT_HASHES.json",
    "PROMPT_OWNER_MATRIX.md",
    "RUNTIME_RESULTS.json",
    "COST_RESULTS.json",
    "README.md",
  ]) {
    const src = join(DOCS, f);
    if (existsSync(src)) {
      writeFileSync(join(REVIEW, f), readFileSync(src));
    }
  }

  // Also copy into artifacts
  cpSync(DOCS, join(ART, "docs-packet"), { recursive: true });

  console.log(
    JSON.stringify(
      {
        status: runtime.status,
        seed,
        rel_pairs: Object.keys(relMap).length,
        act_pairs: Object.keys(actMap).length,
        docs: DOCS,
        review: REVIEW,
      },
      null,
      2
    )
  );
}

main();
