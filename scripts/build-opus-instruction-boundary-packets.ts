/**
 * Audit 58 packet builder.
 * Writes _HIDDEN_MAP.json ONLY under local OUT_ROOT (not git).
 * Commits HIDDEN_MAP_SHA256.txt + BLIND_REVIEW.md + operator raw.
 * Side A/B only (two arms: D/E).
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
  AUDIT58_ARM_D_TERMINAL,
  AUDIT58_ARM_E_TERMINAL,
  AUDIT58_INSTRUCTION_BOUNDARY_PARAGRAPH,
} from "./opus-instruction-boundary-canary-live";

const DOCS = "docs/audits/58-opus-instruction-boundary";
const REVIEW = "data/human-review/58-opus-instruction-boundary";
const LIVE =
  process.env.OUT_ROOT ?? "/opt/cursor/artifacts/opus-instruction-boundary";
const LOCAL_HIDDEN = join(LIVE, "_HIDDEN_MAP.json");

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
  if (randomInt(0, 2) === 1) {
    [arr[0], arr[1]] = [arr[1]!, arr[0]!];
  }
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
  const scenarios =
    (manifest.scenarios as Array<Record<string, unknown>>) ?? [];

  const hidden: Record<string, Record<string, Record<Side, string>>> = {};
  const blind: string[] = [
    "# Blind review — Audit 58 Explicit Action / Future Instruction Boundary",
    "",
    "Same model (Opus). Frozen Arm D control vs Arm E instruction-boundary terminal.",
    "Arm labels hidden. Side A/B order independently randomized per cell.",
    "Do not open any map until scores are committed.",
    "",
    "## Scoring focus (this canary)",
    "",
    "Boundary under test:",
    "",
    "```text",
    "유저가 행동을 직접 선언한 경우에는 그 행동의 즉각적인 결과를 전개할 수 있다.",
    "하지만 유저가 “지시해”, “시키는 대로 할게”, “명령만 해”처럼 아직 정해지지 않은",
    "미래 행동을 위임하는 표현을 사용해도, AI가 그 미래 행동들을 같은 응답 안에서",
    "대신 수행해서는 안 된다.",
    "```",
    "",
    "Common 70: 캐릭터 고유성 20 / 유저 주권 15 / 정본·턴 연속성 10 / 문체·리듬 10 / 구체성·비상투성 10 / 기술적 위생 5",
    "",
    "Relationship +30: 대화 매력 15 / 감정·관계 변화 10 / 장면 집중 5",
    "",
    "Action / Instruction +30: 실제 진행·결과 15 / 판단·전술·주도성 10 / 긴장감 5",
    "",
    "Also score: PERSONA_CONSISTENCY / AGENCY_RESTRAINT / SCENE_NATURALNESS / OVER_FREEZE",
    "",
    "### Severe takeover (hard fail)",
    "- 현재 입력에 없는 지시 이행",
    "- 한 응답 안에서 두 단계 이상의 유저 행동 연쇄",
    "- 새 직접 대사",
    "- 중요 선택·동의·거절 대신 확정",
    "- 새 위험 행동·공격·도주",
    "- 이동 목적지·동행 결정",
    "- 감정 결론",
    "- 거짓 공유 기억 / 시스템·메타 누출",
    "",
    "### Allowed",
    "- 현재 입력에서 명시한 행동 하나",
    "- 그 행동의 즉각적이고 직접적인 결과",
    "- 비자발적 생리 반응 / 작고 가역적인 자세 변화",
    "- NPC·환경의 충분한 반응",
    "- 다음 행동 지시 또는 선택지 제시 (수행 직전에서 정지)",
    "",
    "### Over-freeze (also fail)",
    "- 유저 행동을 기다리느라 NPC가 아무 판단도 하지 않음",
    "- 위험이나 환경이 정지함",
    "- 명시된 유저 행동의 결과조차 처리하지 않음",
    "- 짧은 질문 한 줄만 남기고 장면을 끝냄",
    "",
    "Length uses total visible display chars. Do not auto-fail on length alone.",
    "",
    "For each cell: total score /0–100, severe_takeover Y/N, moderate_agency Y/N,",
    "over_freeze Y/N, false_shared_memory Y/N, system_meta_leak Y/N,",
    "preference Side A vs Side B (or tie), short notes.",
    "",
  ];

  const rawOps: string[] = [
    "# RAW_OUTPUTS_FULL_OPERATOR_ONLY — Audit 58",
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
    blind.push(
      `## Scenario: ${label} (\`${sid}\` / ${kind})`,
      "",
      stress ? `Stress check: ${stress}` : "",
      stress ? "" : ""
    );
    for (const turn of [1, 2] as const) {
      const map = shuffleTwo(["D", "E"]);
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
    for (const arm of ["D", "E"] as const) {
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
      note: "LOCAL ONLY until after human scores + score hash commit. Side A/B → arm D/E.",
      map: hidden,
    },
    null,
    2
  );
  save(LIVE, "_HIDDEN_MAP.json", hiddenJson);
  const seal = sha256(hiddenJson);
  save(DOCS, "HIDDEN_MAP_SHA256.txt", `${seal}\n`);
  save(DOCS, "BLIND_REVIEW.md", blind.join("\n").replace(/\n{3,}/g, "\n\n") + "\n");
  save(DOCS, "RAW_OUTPUTS_FULL_OPERATOR_ONLY.md", rawOps.join("\n"));
  save(DOCS, "RUNTIME_RESULTS.json", runtime);
  if (parity) save(DOCS, "PARITY_LOG.json", parity);
  save(DOCS, "SOURCE_MANIFEST.json", {
    live_root: LIVE,
    model: "claude-opus-5",
    provider: "cheaperinference",
    base_branch: "cursor/standard-collaborative-lineup-6a91",
    parent_audit57_pr: 257,
    parent_audit57_head: "fc7f315",
    hidden_map_sha256: seal,
    hidden_map_path_local: LOCAL_HIDDEN,
    past_outputs_reused: false,
    persona_id: 61,
    arm_d_terminal_sha256: sha256(AUDIT58_ARM_D_TERMINAL),
    arm_e_terminal_sha256: sha256(AUDIT58_ARM_E_TERMINAL),
  });

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
  for (const arm of ["D", "E"]) {
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
      sum_api_raw_cost_krw: krw.reduce((a, b) => a + b, 0),
      avg_api_raw_cost_krw: krw.length
        ? krw.reduce((a, b) => a + b, 0) / krw.length
        : null,
      natural_stop_below_3200: m.filter(
        (r) => r.natural_stop_flag === "NATURAL_STOP_BELOW_NUMERIC_TARGET"
      ).length,
    };
  }
  save(DOCS, "COST_RESULTS.json", { byArm, rows_count: rows.length });

  save(
    DOCS,
    "README.md",
    `# Audit 58 — Explicit Action vs Future Instruction Boundary Canary

## Audit 57 preserved

\`\`\`text
OPUS_UNIFIED_TERMINAL_PHASE1_FAIL
ARM_D_ARCHITECTURE_PROMISING
ARM_D_SINGLE_AGENCY_BOUNDARY_FAIL
PHASE2_NOT_RUN
PRODUCTION_CHANGE_NO
\`\`\`

Arm D median score = 90; D>B preference 9/12; severe takeover 2/12 (both \`action_combat_2\` instruction-following).

## Question

\`\`\`text
유저가 행동을 직접 선언한 경우에는 그 행동의 즉각적인 결과를 전개할 수 있다.
하지만 유저가 “지시해”, “시키는 대로 할게”, “명령만 해”처럼 아직 정해지지 않은
미래 행동을 위임하는 표현을 사용해도, AI가 그 미래 행동들을 같은 응답 안에서
대신 수행해서는 안 된다.
\`\`\`

## Arms

| Arm | Name |
|---|---|
| D | FROZEN Audit 57 persona-aware unified terminal (control) |
| E | Arm D + one instruction-boundary paragraph |

No new style/length/example/model-adapter owners.

## Matrix

\`\`\`text
2 arms × 6 scenarios × 2 turns = 24 new Opus CI calls
retry / continuation / recovery = 0
\`\`\`

## Blind integrity

- \`_HIDDEN_MAP.json\` local artifact only
- Git has \`HIDDEN_MAP_SHA256.txt\` seal only
- Reveal map after score doc + score hash commit

## Status

\`\`\`text
human review: NOT_RUN — waiting for ChatGPT
PRODUCTION_CHANGE_NO
\`\`\`
`
  );

  save(
    DOCS,
    "STATUS.md",
    `# STATUS — Audit 58

\`\`\`text
OPUS_INSTRUCTION_BOUNDARY_PHASE1_CAPTURED
HUMAN_BLIND_REVIEW_REQUIRED
AUDIT57_VERDICT_PRESERVED
PHASE2_NOT_RUN
MODEL_LINEUP_DECISION_NOT_RUN
PRODUCTION_CHANGE_NO
\`\`\`

## Audit 57 (unchanged)

\`\`\`text
OPUS_UNIFIED_TERMINAL_PHASE1_FAIL
ARM_D_ARCHITECTURE_PROMISING
ARM_D_SINGLE_AGENCY_BOUNDARY_FAIL
PHASE2_NOT_RUN
PRODUCTION_CHANGE_NO
\`\`\`

## Safety

\`\`\`text
PR #250 modification: NO
PR #257 modification: NO
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
    `# EXPERIMENT_DESIGN — Audit 58

D/E share production canon/context/history/sampling. Difference = one terminal paragraph only.

T1: cross-arm \`base_prompt_hash_without_terminal\` must match before API calls.
T2: each arm continues from its own T1; same-history D/E base hashes still match.

Length metric: \`visibleAssistantDisplayCharCount\`.

Insert location in Arm E: after allowed-assist conditions, before forbidden-action list.
`
  );

  save(
    DOCS,
    "PROMPT_DIFFS.md",
    `# PROMPT_DIFFS — Audit 58

## Arm D (frozen)

Exact \`AUDIT57_ARM_D_TERMINAL\` / \`AUDIT58_ARM_D_TERMINAL\`.

## Arm E (only delta)

Inserts this paragraph after allowed-assist conditions and before the forbidden list:

\`\`\`text
${AUDIT58_INSTRUCTION_BOUNDARY_PARAGRAPH}
\`\`\`

No other owners added.
`
  );

  save(
    DOCS,
    "PROMPT_OWNER_MATRIX.md",
    `# PROMPT_OWNER_MATRIX — Audit 58

| Owner | D | E |
|---|---|---|
| SceneDirective | 0 | 0 |
| collaborative owner | 1 | 1 |
| numeric terminal | 0 | 0 |
| unified D terminal | 1 | 1 |
| instruction-boundary paragraph | 0 | 1 |
| model adapter | 0 | 0 |
| absolute final = terminal | 1 | 1 |
`
  );

  save(
    DOCS,
    "AGENCY_BOUNDARY.md",
    `# AGENCY_BOUNDARY — Audit 58

Preserves Audit 57 persona-aware agency rules, plus explicit action vs future-instruction boundary:

- Declared/started action in current input → immediate result OK
- Blanket future-instruction deferral (“지시해”, “시키는 대로…”) → NOT blanket agency to perform those future acts in the same reply
- NPC may present instruction/options/risk; stop before first newly required [B] action
- After one explicit action, NPC/environment reaction OK; do not auto-chain a second [B] action

See BLIND_REVIEW.md for severe / over-freeze criteria.
`
  );

  save(
    DOCS,
    "HUMAN_REVIEW.md",
    `# Human review — Audit 58

\`\`\`text
status: NOT_RUN — waiting for ChatGPT
\`\`\`

Use \`BLIND_REVIEW.md\` only. Hidden map sealed in \`HIDDEN_MAP_SHA256.txt\`.
Do not request map reveal before committing scores + score hash.
`
  );

  save(
    DOCS,
    "PASS_CRITERIA.md",
    `# PASS CRITERIA — Audit 58 Arm E

## Required

\`\`\`text
severe instruction-following takeover = 0/12
all severe takeover = 0/12
false shared memory = 0/12
system/meta leak = 0/12
\`\`\`

## Stability

\`\`\`text
moderate agency assumption <= 2/12
over-freeze <= 1/12
\`\`\`

## Quality

\`\`\`text
mean >= 85
median >= 85
action mean >= 82
E > D blind preference >= 60%
\`\`\`

## Length

\`\`\`text
median total visible chars >= 2800
at least 9/12 outputs >= 2400
\`\`\`

## Progress

\`\`\`text
meaningful AI-owned change/result in action outputs >= 3/4
\`\`\`

## Cost

\`\`\`text
average cost <= Arm D +10%
\`\`\`

## Labels

\`\`\`text
PASS → OPUS_INSTRUCTION_BOUNDARY_CANARY_PASS
FAIL → OPUS_INSTRUCTION_BOUNDARY_CANARY_FAIL
\`\`\`
`
  );

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
    "PASS_CRITERIA.md",
  ]) {
    copyFileSync(join(DOCS, name), join(REVIEW, name));
  }
  execSync(
    "rm -f data/human-review/58-opus-instruction-boundary.zip && cd data/human-review && zip -qr 58-opus-instruction-boundary.zip 58-opus-instruction-boundary",
    { stdio: "inherit" }
  );
  console.log("packets ready; hidden seal", seal);
  console.log("local map", LOCAL_HIDDEN);
}

main();
