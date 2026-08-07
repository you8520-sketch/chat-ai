/**
 * Audit 59 Stage packet builder.
 * Local _HIDDEN_MAP.json only; git gets HIDDEN_MAP_SHA256.txt.
 * Review zip excludes arm labels/map/cost/length/token/latency.
 */
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  copyFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { createHash, randomInt } from "node:crypto";
import { execSync } from "node:child_process";
import {
  AUDIT59_ARM_E_TERMINAL,
  AUDIT59_ARM_F_TERMINAL,
} from "./opus-agency-safe-length-recovery-live";

const DOCS = "docs/audits/59-opus-agency-safe-length-recovery";
const STAGE = (process.env.AUDIT59_STAGE ?? "1") as "1" | "2";
const REVIEW = `data/human-review/59-opus-agency-safe-length-recovery-stage${STAGE}`;
const LIVE =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/opus-agency-safe-length-recovery";
const LOCAL_HIDDEN = join(LIVE, `_HIDDEN_MAP_STAGE${STAGE}.json`);

type Side = "A" | "B";
const SIDES: Side[] = ["A", "B"];

function save(dir: string, name: string, content: string | object) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}
function readText(p: string) {
  if (!existsSync(p)) throw new Error(`missing ${p}`);
  return readFileSync(p, "utf8");
}
function readJson(p: string) {
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
}
function shuffleTwo(arms: string[]): Record<Side, string> {
  const arr = [...arms];
  if (randomInt(0, 2) === 1) [arr[0], arr[1]] = [arr[1]!, arr[0]!];
  return { A: arr[0]!, B: arr[1]! };
}
function sha256(t: string) {
  return createHash("sha256").update(t).digest("hex");
}

function main() {
  const manifest = readJson(join(LIVE, "SCENARIO_MANIFEST.json"));
  const runtime = readJson(join(LIVE, "RUNTIME_RESULTS.json"));
  const parity = readJson(join(LIVE, "PARITY_LOG.json"));
  if (!manifest || !runtime) throw new Error("missing live results");
  if (Number(manifest.stage) !== Number(STAGE)) {
    throw new Error(
      `manifest stage ${manifest.stage} != AUDIT59_STAGE ${STAGE}`
    );
  }
  const scenarios =
    (manifest.scenarios as Array<Record<string, unknown>>) ?? [];

  const hidden: Record<string, Record<string, Record<Side, string>>> = {};
  const blind: string[] = [
    `# Blind review — Audit 59 Stage ${STAGE} Agency-Safe Length Recovery`,
    "",
    "Same model (Opus). Frozen Arm E control vs Arm F one-sentence stop recovery.",
    "Arm labels hidden. Side A/B independently randomized per cell.",
    "Do not open any map until scores are committed.",
    "",
    "## Question",
    "",
    "```text",
    "Arm E의 유저 주권 경계를 그대로 유지하면서,",
    "과도하게 이른 종료만 완화해 중앙 분량을 회복할 수 있는가?",
    "```",
    "",
    "## Scoring",
    "",
    "Common 70: 캐릭터 고유성 20 / 유저 주권 15 / 정본·턴 연속성 10 / 문체·리듬 10 / 구체성·비상투성 10 / 기술적 위생 5",
    "",
    "Relationship +30: 대화 매력 15 / 감정·관계 변화 10 / 장면 집중 5",
    "",
    "Action / Instruction +30: 실제 진행·결과 15 / 판단·전술·주도성 10 / 긴장감 5",
    "",
    "Also: PERSONA_CONSISTENCY / AGENCY_RESTRAINT / SCENE_NATURALNESS / OVER_FREEZE",
    "",
    "### Severe takeover",
    "현재 입력에 없는 지시 이행; 두 단계+ 유저 행동 연쇄; 새 직접 대사;",
    "중요 선택·동의·거절 확정; 새 위험 행동·공격·도주; 동행·이동 목적지;",
    "구매·선물·관계 결정; 감정 결론; 거짓 공유 기억; 시스템·메타 누출",
    "",
    "### Allowed",
    "선언된 행동 하나와 즉각 결과; 비자발 생리 반응; 작고 가역적 자세;",
    "NPC·환경의 독립 행동; 위험·사건 외부 변화; 다음 지시/선택지 제시",
    "",
    "### Over-freeze",
    "NPC 무판단; 환경·위험 정지; 선언 행동 결과 미처리; 한 줄 질문/지시만 종료;",
    "유저 행동 없이도 가능한 외부 진행 생략",
    "",
    "Style note (observe only, not a new rule): same-speaker dialogue may stay in one paragraph;",
    "do not require one spoken sentence per blank-line block.",
    "",
    "For each cell: score /100, severe Y/N, moderate Y/N, over_freeze Y/N,",
    "false_shared_memory Y/N, system_meta_leak Y/N, preference Side A vs B, notes.",
    "",
  ];

  const rawOps: string[] = [
    `# RAW_OUTPUTS_FULL_OPERATOR_ONLY — Audit 59 Stage ${STAGE}`,
    "",
    "Operator-only. Arm labels visible. Not for blind reviewers.",
    "",
  ];

  for (const sc of scenarios) {
    const sid = String(sc.id);
    const turns = sc.turns as [string, string];
    const label = String(sc.label);
    const kind = String(sc.kind);
    const stress = String(sc.stress ?? "");
    hidden[sid] = {};
    blind.push(`## Scenario: ${label} (\`${sid}\` / ${kind})`, "");
    if (stress) blind.push(`Stress check: ${stress}`, "");
    for (const turn of [1, 2] as const) {
      const map = shuffleTwo(["E", "F"]);
      hidden[sid][`T${turn}`] = map;
      blind.push(
        `### ${sid}-T${turn}`,
        "",
        "**User input**",
        "",
        "```text",
        turns[turn - 1]!,
        "```",
        ""
      );
      for (const side of SIDES) {
        const arm = map[side];
        const text = readText(
          join(
            LIVE,
            "live",
            sid,
            `arm-${arm}`,
            "run1",
            `turn${turn}-provider-raw.txt`
          )
        ).trimEnd();
        blind.push(`#### Side ${side}`, "", "```text", text, "```", "");
      }
    }
    for (const arm of ["E", "F"] as const) {
      for (const turn of [1, 2] as const) {
        const meta = readJson(
          join(LIVE, "live", sid, `arm-${arm}`, "run1", `turn${turn}-meta.json`)
        );
        const text = readText(
          join(
            LIVE,
            "live",
            sid,
            `arm-${arm}`,
            "run1",
            `turn${turn}-provider-raw.txt`
          )
        ).trimEnd();
        rawOps.push(
          `## ${sid} / Arm ${arm} / T${turn}`,
          "",
          "```text",
          text,
          "```",
          "",
          "```json",
          JSON.stringify(
            {
              total_visible_chars: meta?.total_visible_chars,
              natural_stop_flag: meta?.natural_stop_flag,
              finish_reason: meta?.finish_reason,
              base_prompt_hash_without_terminal:
                meta?.base_prompt_hash_without_terminal,
              terminal_hash: meta?.terminal_hash,
              full_prompt_hash: meta?.full_prompt_hash,
              input_tokens: meta?.input_tokens,
              api_raw_cost_krw: meta?.api_raw_cost_krw,
              latency_s: meta?.latency_s,
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

  const hiddenJson = JSON.stringify(
    {
      note: `LOCAL ONLY until after human scores. Stage ${STAGE}. Side A/B → arm E/F.`,
      stage: Number(STAGE),
      map: hidden,
    },
    null,
    2
  );
  save(LIVE, `_HIDDEN_MAP_STAGE${STAGE}.json`, hiddenJson);
  const seal = sha256(hiddenJson);
  save(DOCS, `HIDDEN_MAP_STAGE${STAGE}_SHA256.txt`, `${seal}\n`);
  // Convenience alias for Stage 1 primary seal filename
  if (STAGE === "1") {
    save(DOCS, "HIDDEN_MAP_SHA256.txt", `${seal}\n`);
  }
  save(DOCS, `BLIND_REVIEW_STAGE${STAGE}.md`, blind.join("\n") + "\n");
  if (STAGE === "1") {
    save(DOCS, "BLIND_REVIEW.md", blind.join("\n") + "\n");
  }
  save(
    DOCS,
    `RAW_OUTPUTS_FULL_OPERATOR_ONLY_STAGE${STAGE}.md`,
    rawOps.join("\n")
  );
  save(DOCS, "RUNTIME_RESULTS.json", runtime);
  if (parity) save(DOCS, "PARITY_LOG.json", parity);
  save(DOCS, "SOURCE_MANIFEST.json", {
    live_root: LIVE,
    stage: Number(STAGE),
    model: "claude-opus-5",
    provider: "cheaperinference",
    base_branch: "cursor/standard-collaborative-lineup-6a91",
    parent_audit58_pr: 258,
    hidden_map_sha256: seal,
    hidden_map_path_local: LOCAL_HIDDEN,
    past_outputs_reused: false,
    persona_id: 61,
    arm_e_terminal_sha256: sha256(AUDIT59_ARM_E_TERMINAL),
    arm_f_terminal_sha256: sha256(AUDIT59_ARM_F_TERMINAL),
    exact_sentence_replacement: true,
  });

  const rows: Record<string, unknown>[] = [];
  for (const sc of readdirSync(join(LIVE, "live"))) {
    for (const armDir of readdirSync(join(LIVE, "live", sc))) {
      for (const turn of [1, 2] as const) {
        const meta = readJson(
          join(LIVE, "live", sc, armDir, "run1", `turn${turn}-meta.json`)
        );
        if (meta && Number(meta.stage) === Number(STAGE)) rows.push(meta);
      }
    }
  }
  const byArm: Record<string, unknown> = {};
  for (const arm of ["E", "F"]) {
    const m = rows.filter((r) => r.arm === arm);
    const chars = m
      .map((r) => r.total_visible_chars)
      .filter((x): x is number => typeof x === "number")
      .sort((a, b) => a - b);
    const krw = m
      .map((r) => r.api_raw_cost_krw)
      .filter((x): x is number => typeof x === "number");
    byArm[arm] = {
      outputs: m.length,
      median_total_visible_chars: chars.length
        ? chars[Math.floor((chars.length - 1) / 2)]
        : null,
      avg_total_visible_chars: chars.length
        ? chars.reduce((a, b) => a + b, 0) / chars.length
        : null,
      ge_2400: chars.filter((c) => c >= 2400).length,
      sum_api_raw_cost_krw: krw.reduce((a, b) => a + b, 0),
      avg_api_raw_cost_krw: krw.length
        ? krw.reduce((a, b) => a + b, 0) / krw.length
        : null,
      natural_stop_below_3200: m.filter(
        (r) => r.natural_stop_flag === "NATURAL_STOP_BELOW_NUMERIC_TARGET"
      ).length,
    };
  }
  save(DOCS, `COST_RESULTS_STAGE${STAGE}.json`, {
    stage: Number(STAGE),
    byArm,
    rows_count: rows.length,
  });
  if (STAGE === "1") {
    save(DOCS, "COST_RESULTS.json", {
      stage: 1,
      byArm,
      rows_count: rows.length,
    });
  }

  const eMed = (byArm.E as { median_total_visible_chars: number | null })
    .median_total_visible_chars;
  const fMed = (byArm.F as { median_total_visible_chars: number | null })
    .median_total_visible_chars;
  const lengthDelta =
    eMed != null && fMed != null ? fMed - eMed : null;

  save(
    DOCS,
    "README.md",
    `# Audit 59 — Cost-Capped Agency-Safe Length Recovery Canary

## Audit 58 preserved

\`\`\`text
OPUS_INSTRUCTION_BOUNDARY_AGENCY_PASS
OPUS_INSTRUCTION_BOUNDARY_CANARY_OVERALL_FAIL_LENGTH
AGENCY_BOUNDARY_SOLVED
LENGTH_RECOVERY_REQUIRED
\`\`\`

## Question

\`\`\`text
Arm E의 유저 주권 경계를 그대로 유지하면서,
과도하게 이른 종료만 완화해 중앙 분량을 회복할 수 있는가?
\`\`\`

## Arms

| Arm | Name |
|---|---|
| E | Frozen Audit 58 Arm E |
| F | Arm E with exact one stop-sentence replacement |

No new style/length/agency/layout owners. No SceneDirective. No retry/continuation/recovery.

## Cost-capped stages

\`\`\`text
Stage 1: s2 + s6 → 8 calls
Stage 2: s5 → 4 calls (only if Stage 1 passes)
Maximum: 12
\`\`\`

## Status

\`\`\`text
STAGE${STAGE}_CAPTURED
human review: NOT_RUN — waiting for ChatGPT
Stage 2: ${STAGE === "1" ? "NOT_RUN unless Stage 1 passes" : "CAPTURED"}
PRODUCTION_CHANGE_NO
\`\`\`
`
  );

  save(
    DOCS,
    "STATUS.md",
    `# STATUS — Audit 59

\`\`\`text
OPUS_AGENCY_SAFE_LENGTH_RECOVERY_STAGE${STAGE}_CAPTURED
HUMAN_BLIND_REVIEW_REQUIRED
AUDIT58_VERDICT_PRESERVED
STAGE2_${STAGE === "1" ? "NOT_RUN" : "CAPTURED"}
PHASE2_NOT_RUN
MODEL_LINEUP_DECISION_NOT_RUN
PRODUCTION_CHANGE_NO
\`\`\`

## Audit 58 (unchanged)

\`\`\`text
OPUS_INSTRUCTION_BOUNDARY_AGENCY_PASS
OPUS_INSTRUCTION_BOUNDARY_CANARY_OVERALL_FAIL_LENGTH
AGENCY_BOUNDARY_SOLVED
LENGTH_RECOVERY_REQUIRED
\`\`\`

## Operator length preview (Stage ${STAGE}, not a verdict)

\`\`\`text
Arm E median visible chars: ${eMed}
Arm F median visible chars: ${fMed}
F − E median delta: ${lengthDelta}
\`\`\`

## Safety

\`\`\`text
PR #250 modification: NO
PR #257 modification: NO
PR #258 modification: NO
production DB apply: NO
general rollout: NO
public picker change: NO
pricing change: NO
auto merge: NO
auto deploy: NO
model lineup decision: NO
\`\`\`
`
  );

  save(
    DOCS,
    "EXPERIMENT_DESIGN.md",
    `# EXPERIMENT_DESIGN — Audit 59

E/F share production canon/context/history/sampling.
Difference = exact one stop-sentence replacement in the instruction-boundary paragraph.

\`\`\`text
from: 첫 번째로 새롭게 요구되는 [B]의 행동 직전에 멈춘다.
to:   [B]에게 새로운 행동이 요구되더라도 그 행동을 수행한 것으로 서술하지 않은 채, …
\`\`\`

Stage 1 fail-closed length preview: F median must exceed E median by ≥200 before Stage 2 is even considered (human agency gates also required).
`
  );

  save(
    DOCS,
    "PROMPT_DIFFS.md",
    `# PROMPT_DIFFS — Audit 59

## Arm E (frozen)

Exact Audit 58 Arm E terminal.

## Arm F (only delta)

Replaces this single sentence inside the instruction-boundary paragraph:

\`\`\`text
첫 번째로 새롭게 요구되는 [B]의 행동 직전에 멈춘다.
\`\`\`

with:

\`\`\`text
[B]에게 새로운 행동이 요구되더라도 그 행동을 수행한 것으로 서술하지 않은 채, [A]·NPC·환경이 독립적으로 만들 수 있는 판단·행동·위험 변화와 그 결과를 계속 전개하고, [B]의 실제 선택이나 수행 없이는 더 이상 의미 있는 진행이 불가능한 지점에서 멈춘다.
\`\`\`
`
  );

  save(
    DOCS,
    "PROMPT_OWNER_MATRIX.md",
    `# PROMPT_OWNER_MATRIX — Audit 59

| Owner | E | F |
|---|---|---|
| SceneDirective | 0 | 0 |
| collaborative owner | 1 | 1 |
| unified D core | 1 | 1 |
| instruction-boundary paragraph | 1 | 1 |
| old early-stop sentence | 1 | 0 |
| length-recovery stop sentence | 0 | 1 |
| model adapter | 0 | 0 |
| absolute final = terminal | 1 | 1 |
`
  );

  save(
    DOCS,
    "AGENCY_BOUNDARY.md",
    `# AGENCY_BOUNDARY — Audit 59

Preserves Audit 58 agency boundary. Only the early-stop sentence is relaxed so NPC/environment may continue progressing without narrating new [B] execution.

Style/dialogue fragmentation rules are not added in this canary.
`
  );

  save(
    DOCS,
    "HUMAN_REVIEW.md",
    `# Human review — Audit 59 Stage ${STAGE}

\`\`\`text
status: NOT_RUN — waiting for ChatGPT
\`\`\`

Use \`BLIND_REVIEW.md\` / \`BLIND_REVIEW_STAGE${STAGE}.md\` only.
Hidden map sealed in \`HIDDEN_MAP_STAGE${STAGE}_SHA256.txt\`.
Do not request map reveal before committing scores + score hash.
Stage 2 API calls must not run until Stage 1 human pass is recorded.
`
  );

  save(
    DOCS,
    "PASS_CRITERIA.md",
    `# PASS CRITERIA — Audit 59 (cost-capped)

## Stage 1 immediate fail

\`\`\`text
Arm F severe takeover >= 1
Arm F over-freeze >= 1
Arm F median visible chars <= Arm E median
Arm F mean score < Arm E mean - 3
action meaningful AI-owned change/result lost
→ AUDIT59_STAGE1_FAIL / STAGE2_NOT_RUN
\`\`\`

## Stage 1 pass (then Stage 2)

\`\`\`text
F severe = 0
F over-freeze = 0
F median chars >= E + 200
F mean score >= E - 2
action meaningful AI-owned change/result kept
\`\`\`

## Full canary pass (Stage 1 + 2)

\`\`\`text
OPUS_AGENCY_SAFE_LENGTH_RECOVERY_CANARY_PASS
OPUS_TERMINAL_CANDIDATE_F_READY_FOR_LARGER_CONFIRMATION
PHASE2_NOT_RUN
PRODUCTION_CHANGE_NO
\`\`\`
`
  );

  // Review zip: blind only — no map, cost, length aggregates, arm labels, tokens, latency
  mkdirSync(REVIEW, { recursive: true });
  const reviewFiles = [
    "README.md",
    "STATUS.md",
    "EXPERIMENT_DESIGN.md",
    "PROMPT_DIFFS.md",
    "PROMPT_OWNER_MATRIX.md",
    "AGENCY_BOUNDARY.md",
    "HUMAN_REVIEW.md",
    "PASS_CRITERIA.md",
    `BLIND_REVIEW_STAGE${STAGE}.md`,
    `HIDDEN_MAP_STAGE${STAGE}_SHA256.txt`,
    "SOURCE_MANIFEST.json",
    "RUNTIME_RESULTS.json",
  ];
  if (STAGE === "1") {
    reviewFiles.push("BLIND_REVIEW.md", "HIDDEN_MAP_SHA256.txt");
  }
  for (const name of reviewFiles) {
    if (existsSync(join(DOCS, name))) {
      copyFileSync(join(DOCS, name), join(REVIEW, name));
    }
  }
  // Strip length preview from STATUS copy in review? User asked exclude length from zip.
  // Rewrite a review-safe STATUS without operator length numbers.
  writeFileSync(
    join(REVIEW, "STATUS.md"),
    `# STATUS — Audit 59 Stage ${STAGE} (review packet)

\`\`\`text
OPUS_AGENCY_SAFE_LENGTH_RECOVERY_STAGE${STAGE}_CAPTURED
HUMAN_BLIND_REVIEW_REQUIRED
STAGE2_${STAGE === "1" ? "NOT_RUN" : "CAPTURED"}
PHASE2_NOT_RUN
PRODUCTION_CHANGE_NO
\`\`\`

Operator length/cost metrics are excluded from this review packet.
`,
    "utf8"
  );
  // RUNTIME without length_preview for review
  const runtimeReview = { ...runtime };
  delete runtimeReview.length_preview;
  writeFileSync(
    join(REVIEW, "RUNTIME_RESULTS.json"),
    JSON.stringify(runtimeReview, null, 2),
    "utf8"
  );

  const zipName = `59-opus-agency-safe-length-recovery-stage${STAGE}.zip`;
  execSync(
    `rm -f data/human-review/${zipName} && cd data/human-review && zip -qr ${zipName} 59-opus-agency-safe-length-recovery-stage${STAGE}`,
    { stdio: "inherit" }
  );
  console.log("packets ready; stage", STAGE, "hidden seal", seal);
  console.log("local map", LOCAL_HIDDEN);
  console.log("length preview", { eMed, fMed, lengthDelta });
}

main();
