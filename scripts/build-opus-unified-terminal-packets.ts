/**
 * Audit 57 packet builder.
 * Writes _HIDDEN_MAP.json ONLY under local OUT_ROOT (not git).
 * Commits HIDDEN_MAP_SHA256.txt + BLIND_REVIEW.md + operator raw.
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

const DOCS = "docs/audits/57-opus-unified-terminal-contract";
const REVIEW = "data/human-review/57-opus-unified-terminal-contract";
const LIVE =
  process.env.OUT_ROOT ?? "/opt/cursor/artifacts/opus-unified-terminal";
const LOCAL_HIDDEN = join(LIVE, "_HIDDEN_MAP.json");

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
function readText(p: string) {
  if (!existsSync(p)) throw new Error(`missing ${p}`);
  return readFileSync(p, "utf8");
}
function readJson(p: string) {
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
}
function shuffleThree(arms: string[]): Record<Side, string> {
  const arr = [...arms];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return { A: arr[0]!, B: arr[1]!, C: arr[2]! };
}
function sha256(t: string) {
  return createHash("sha256").update(t).digest("hex");
}

function main() {
  const manifest = readJson(join(LIVE, "SCENARIO_MANIFEST.json"));
  const runtime = readJson(join(LIVE, "RUNTIME_RESULTS.json"));
  if (!manifest || !runtime) throw new Error("missing live results");
  const scenarios = (manifest.scenarios as Array<Record<string, unknown>>) ?? [];

  const hidden: Record<string, Record<string, Record<Side, string>>> = {};
  const blind: string[] = [
    "# Blind review — Audit 57 Unified Terminal Contract",
    "",
    "Same model (Opus). Only the terminal owner arm differs (labels hidden).",
    "Do not open any map until scores are committed.",
    "",
    "## Scoring",
    "",
    "Common 70: 캐릭터 고유성 20 / 유저 주권 15 / 정본·턴 연속성 10 / 문체·리듬 10 / 구체성·비상투성 10 / 기술적 위생 5",
    "",
    "Relationship +30: 대화 매력 15 / 감정·관계 변화 10 / 장면 집중 5",
    "",
    "Action +30: 실제 진행·결과 15 / 판단·전술·주도성 10 / 긴장감 5",
    "",
    "Also score: PERSONA_CONSISTENCY / AGENCY_RESTRAINT / SCENE_NATURALNESS",
    "",
    "### Severe user takeover (hard fail)",
    "새 유저 직접 대사; 중요 선택·동의·거절; 고백·키스·성적 행동; 공격·도주·위험 감수;",
    "동행·퇴장·이동 목적지; 구매·선물·계약; 비밀 공개; 감정 결론; 2단계+ 행동 연쇄;",
    "페르소나 근거로 유저 목표 신규 생성; USER_PERSONA 모순; 거짓 공유 기억; 대규모 재서술; NPC 탈취; 시스템 누출",
    "",
    "### Moderate agency assumption (감점, not auto severe)",
    "입력에 직접 시작되지 않은 짧은 의도적 행동; 따라 몇 걸음; 물건 받아 보관; 새 위치 앉기/일어서기; 약한 관심/호감 추정",
    "",
    "### Minor persona-consistent continuation (no penalty if all conditions met)",
    "이미 시작한 행동의 즉각 마무리; 가역 반걸음; 비자발 생리 반응; 작은 자세/시선; 짧은 손가락·호흡·어깨 반응",
    "",
    "Avoid OVER-TAKEOVER and OVER-FREEZE extremes.",
    "",
    "Length uses total visible display chars (not Hangul-only). Do not auto-fail on length alone; flag NATURAL_STOP_BELOW_NUMERIC_TARGET separately.",
    "",
  ];

  const rawOps: string[] = [
    "# RAW_OUTPUTS_FULL_OPERATOR_ONLY — Audit 57",
    "",
    "Operator-only. Arm labels visible. Not for blind reviewers.",
    "",
  ];

  for (const sc of scenarios) {
    const sid = String(sc.id);
    const turns = sc.turns as [string, string];
    const label = String(sc.label);
    const kind = String(sc.kind);
    hidden[sid] = {};
    blind.push(`## Scenario: ${label} (\`${sid}\` / ${kind})`, "");
    for (const turn of [1, 2] as const) {
      const map = shuffleThree(["A", "B", "D"]);
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
          join(LIVE, "live", sid, `arm-${arm}`, "run1", `turn${turn}-provider-raw.txt`)
        ).trimEnd();
        blind.push(`#### Side ${side}`, "", "```text", text, "```", "");
      }
    }
    for (const arm of ["A", "B", "D"] as const) {
      for (const turn of [1, 2] as const) {
        const meta = readJson(
          join(LIVE, "live", sid, `arm-${arm}`, "run1", `turn${turn}-meta.json`)
        );
        const text = readText(
          join(LIVE, "live", sid, `arm-${arm}`, "run1", `turn${turn}-provider-raw.txt`)
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
              base_prompt_hash_without_terminal: meta?.base_prompt_hash_without_terminal,
              terminal_hash: meta?.terminal_hash,
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
      note: "LOCAL ONLY until after human scores + score hash commit. Side A/B/C → arm A/B/D.",
      map: hidden,
    },
    null,
    2
  );
  // Local artifact only — NOT written under docs/ for git
  save(LIVE, "_HIDDEN_MAP.json", hiddenJson);
  const seal = sha256(hiddenJson);
  save(DOCS, "HIDDEN_MAP_SHA256.txt", `${seal}\n`);
  save(DOCS, "BLIND_REVIEW.md", blind.join("\n") + "\n");
  save(DOCS, "RAW_OUTPUTS_FULL_OPERATOR_ONLY.md", rawOps.join("\n"));
  save(DOCS, "RUNTIME_RESULTS.json", runtime);
  save(DOCS, "SOURCE_MANIFEST.json", {
    live_root: LIVE,
    model: "claude-opus-5",
    provider: "cheaperinference",
    base_branch: "cursor/standard-collaborative-lineup-6a91",
    hidden_map_sha256: seal,
    hidden_map_path_local: LOCAL_HIDDEN,
    past_outputs_reused: false,
    persona_id: 61,
  });

  // Cost (operator; not in review zip)
  const rows: Record<string, unknown>[] = [];
  for (const sc of readdirSync(join(LIVE, "live"))) {
    for (const armDir of readdirSync(join(LIVE, "live", sc))) {
      for (const turn of [1, 2] as const) {
        const meta = readJson(
          join(LIVE, "live", sc, armDir, "run1", `turn${turn}-meta.json`)
        );
        if (meta) rows.push(meta);
      }
    }
  }
  const byArm: Record<string, unknown> = {};
  for (const arm of ["A", "B", "D"]) {
    const m = rows.filter((r) => r.arm === arm);
    const chars = m
      .map((r) => r.total_visible_chars)
      .filter((x): x is number => typeof x === "number");
    const krw = m
      .map((r) => r.api_raw_cost_krw)
      .filter((x): x is number => typeof x === "number");
    const sorted = [...chars].sort((a, b) => a - b);
    byArm[arm] = {
      outputs: m.length,
      median_total_visible_chars: sorted.length
        ? sorted[Math.floor((sorted.length - 1) / 2)]
        : null,
      avg_total_visible_chars: chars.length
        ? chars.reduce((a, b) => a + b, 0) / chars.length
        : null,
      ge_2400: chars.filter((c) => c >= 2400).length,
      in_2800_4200_median_band_count: chars.filter(
        (c) => c >= 2800 && c <= 4200
      ).length,
      sum_api_raw_cost_krw: krw.reduce((a, b) => a + b, 0),
      avg_api_raw_cost_krw: krw.length
        ? krw.reduce((a, b) => a + b, 0) / krw.length
        : null,
      natural_stop_below_3200: m.filter(
        (r) => r.natural_stop_flag === "NATURAL_STOP_BELOW_NUMERIC_TARGET"
      ).length,
    };
  }
  save(DOCS, "COST_RESULTS.json", { byArm, rows });

  // Design docs
  save(
    DOCS,
    "README.md",
    `# Audit 57 — Opus Unified Terminal Contract Canary

## Question

\`\`\`text
현재 production canon/context를 유지하면서,
장문 분량과 유저 주권을 하나의 terminal owner로 결합하면
Opus의 90점대 상한을 안정적으로 유지할 수 있는가?
\`\`\`

## Arms

| Arm | Name |
|---|---|
| A | CURRENT_STANDARD_CONTROL |
| B | QUALITATIVE_SAFE_SHORT_CONTROL |
| D | UNIFIED_LENGTH_AGENCY_TERMINAL (persona-aware) |

Arm C from Audit 56 is **not** used.

## Blind integrity

- \`_HIDDEN_MAP.json\` is stored **only** under local artifact root
- Git has \`HIDDEN_MAP_SHA256.txt\` seal only
- Reveal map after score doc + score hash commit

## Status

\`\`\`text
human review: NOT_RUN — waiting for ChatGPT
MODEL_LINEUP_DECISION_NOT_RUN
PRODUCTION_CHANGE_NO
\`\`\`
`
  );
  save(
    DOCS,
    "STATUS.md",
    `# STATUS — Audit 57

\`\`\`text
OPUS_UNIFIED_TERMINAL_PHASE1_CAPTURED
HUMAN_BLIND_REVIEW_REQUIRED
MODEL_LINEUP_DECISION_NOT_RUN
PRODUCTION_CHANGE_NO
\`\`\`

## Audit 56 linkage

\`\`\`text
AUDIT56_HUMAN_BLIND_COMPROMISED
AUDIT56_NON_BLIND_EXPERT_DIAGNOSTIC_COMPLETE
AUDIT56_ORIGINAL_PHASE2_CANCELLED
AUDIT56_LENGTH_METRIC_BUG
\`\`\`

## Safety

\`\`\`text
production DB apply: NO
general rollout: NO
public picker change: NO
pricing change: NO
PR #250 modification: NO
PR #251 modification: NO
auto merge: NO
auto deploy: NO
\`\`\`
`
  );
  save(
    DOCS,
    "EXPERIMENT_DESIGN.md",
    `# EXPERIMENT_DESIGN — Audit 57

A/B/D share production canon/context/history/sampling. Difference = terminal owner string only.

T1: cross-arm \`base_prompt_hash_without_terminal\` must match before API calls.
T2: each arm continues from its own T1 (history differs by design).

Length metric: \`visibleAssistantDisplayCharCount\` (total display chars).

Agency evaluation uses persona-aware boundary (severe / moderate / minor). See BLIND_REVIEW.md.
`
  );
  save(
    DOCS,
    "PROMPT_DIFFS.md",
    `# PROMPT_DIFFS — Audit 57

## Shared base

PR #250 standard collaborative assemble via \`buildContext\` + \`assemblePrimaryRpRequest\`.

## Terminal only

- **A:** production \`USER_TAIL_LENGTH_OWNER_SENTENCE\` (3,200~4,200)
- **B:** qualitative stop sentence (Audit 56 Arm B)
- **D:** persona-aware unified length+agency terminal (see live script \`AUDIT57_ARM_D_TERMINAL\`)

Collaborative owner retained on all arms. SceneDirective=0. No model adapter.
`
  );
  save(
    DOCS,
    "PROMPT_OWNER_MATRIX.md",
    `# PROMPT_OWNER_MATRIX — Audit 57

| Owner | A | B | D |
|---|---|---|---|
| SceneDirective | 0 | 0 | 0 |
| collaborative owner | 1 | 1 | 1 |
| numeric terminal | 1 | 0 | 0 |
| qualitative terminal | 0 | 1 | 0 |
| unified D terminal | 0 | 0 | 1 |
| model adapter | 0 | 0 | 0 |
| absolute final = terminal | 1 | 1 | 1 |
`
  );
  save(
    DOCS,
    "AGENCY_BOUNDARY.md",
    `# AGENCY_BOUNDARY — Audit 57 (persona-aware)

Priority:

1. Explicit current user action/dialogue/intent
2. Action already started in current input
3. Repeated recent user behavior
4. User persona traits
5. Generic human reaction

Lower priority must not override higher priority.

See BLIND_REVIEW.md for severe / moderate / minor classifications and pass criteria.
`
  );
  save(
    DOCS,
    "HUMAN_REVIEW.md",
    `# Human review — Audit 57

\`\`\`text
status: NOT_RUN — waiting for ChatGPT
\`\`\`

Use \`BLIND_REVIEW.md\` only. Hidden map is sealed in \`HIDDEN_MAP_SHA256.txt\`.
Do not request map reveal before committing scores + score hash.
`
  );

  // Review zip: blind only — no map, cost, length aggregates, arm labels
  mkdirSync(REVIEW, { recursive: true });
  for (const name of [
    "README.md",
    "STATUS.md",
    "EXPERIMENT_DESIGN.md",
    "PROMPT_DIFFS.md",
    "PROMPT_OWNER_MATRIX.md",
    "AGENCY_BOUNDARY.md",
    "HUMAN_REVIEW.md",
    "BLIND_REVIEW.md",
    "HIDDEN_MAP_SHA256.txt",
    "SOURCE_MANIFEST.json",
    "RUNTIME_RESULTS.json",
  ]) {
    copyFileSync(join(DOCS, name), join(REVIEW, name));
  }
  execSync(
    "rm -f data/human-review/57-opus-unified-terminal-contract.zip && cd data/human-review && zip -qr 57-opus-unified-terminal-contract.zip 57-opus-unified-terminal-contract",
    { stdio: "inherit" }
  );
  console.log("packets ready; hidden seal", seal);
  console.log("local map", LOCAL_HIDDEN);
}

main();
