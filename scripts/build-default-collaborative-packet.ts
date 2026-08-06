/**
 * Blind packet: frozen Audit 42 ARM D vs new collaborative-default candidate.
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

const ROOT_D =
  process.env.ROOT_D ?? "/opt/cursor/artifacts/deepseek-length-scene-2x2/arm-D";
const ROOT_C =
  process.env.ROOT_C ?? "/opt/cursor/artifacts/default-collaborative/arm-COLLAB";
const ART =
  process.env.ART_ROOT ?? "data/human-review/44-default-collaborative";
const DOCS = process.env.DOCS_DIR ?? "docs/audits/44-default-collaborative";

type Output = {
  attempt_id: string;
  arm: string;
  run: number;
  turn: number;
  user_input: string;
  provider_raw: string;
  finish_reason: string | null;
  latency_s: number;
  raw_chars: number;
  replacement?: boolean;
  provider?: string;
};

function save(dir: string, name: string, content: string | object) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

function loadArm(root: string, armLabel: string): Output[] {
  const out: Output[] = [];
  for (const run of [1, 2]) {
    for (const turn of [1, 2]) {
      const metaPath = join(root, `run${run}`, `turn${turn}-meta.json`);
      const rawPath = join(root, `run${run}`, `turn${turn}-provider-raw.txt`);
      if (!existsSync(metaPath) || !existsSync(rawPath)) {
        throw new Error(`missing ${armLabel} r${run}t${turn}`);
      }
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Output;
      meta.provider_raw = readFileSync(rawPath, "utf8");
      meta.arm = armLabel;
      out.push(meta);
    }
  }
  return out;
}

function shufflePair<T>(a: T, b: T): [T, T, "X_is_D" | "X_is_COLLAB"] {
  if (randomInt(2) === 0) return [a, b, "X_is_D"];
  return [b, a, "X_is_COLLAB"];
}

function stats(rows: Output[]) {
  const chars = rows.map((o) => o.raw_chars);
  return {
    valid: rows.length,
    chars,
    avg: Math.round(chars.reduce((s, n) => s + n, 0) / chars.length),
    min: Math.min(...chars),
    max: Math.max(...chars),
  };
}

function main() {
  const armD = loadArm(ROOT_D, "D");
  const armC = loadArm(ROOT_C, "COLLAB");
  // Normalize D attempt ids if needed
  for (const o of armD) {
    if (!o.attempt_id?.startsWith("D-")) {
      o.attempt_id = `D-R${o.run}T${o.turn}`;
    }
  }

  const idxC = JSON.parse(
    readFileSync(join(ROOT_C, "outputs_index.json"), "utf8")
  ) as { new_calls: number; replacement_calls: number; exclusions: unknown[] };
  const idxD = existsSync(join(ROOT_D, "outputs_index.json"))
    ? (JSON.parse(readFileSync(join(ROOT_D, "outputs_index.json"), "utf8")) as {
        new_calls: number;
        replacement_calls: number;
        exclusions: unknown[];
      })
    : { new_calls: 4, replacement_calls: 1, exclusions: [] };

  const sd = stats(armD);
  const sc = stats(armC);

  const runtime = {
    status: "DEFAULT_COLLABORATIVE_HUMAN_REVIEW_PENDING",
    generated_at: new Date().toISOString(),
    offline_parity: "DEFAULT_AND_AUTO_MODE_UNIFICATION_OFFLINE_PASS",
    persona_correction:
      "렌 S급 가이드 = SOURCE_BACKED_USER_PERSONA (unsupported invention withdrawn)",
    arms: {
      D: {
        label: "FROZEN_AUDIT42_ARM_D_SINGLE_OWNER_SCENE_OFF",
        frozen: true,
        attempts: idxD.new_calls,
        valid: sd.valid,
        replacement_calls: idxD.replacement_calls,
        exclusions: idxD.exclusions,
        ...sd,
      },
      COLLAB: {
        label: "COLLABORATIVE_DEFAULT_CANDIDATE",
        frozen: false,
        attempts: idxC.new_calls,
        valid: sc.valid,
        replacement_calls: idxC.replacement_calls,
        exclusions: idxC.exclusions,
        ...sc,
      },
    },
    human_review: "NOT_RUN — waiting for ChatGPT",
    auto_progression: "NOT_RUN unless standard human screen passes",
  };

  const hidden: Record<string, unknown> = {
    status: "DEFAULT_COLLABORATIVE_HUMAN_REVIEW_PENDING",
    note: "Reveal only after ChatGPT blind review.",
    arms: {
      D: "Frozen Audit 42 ARM D (single length + Scene OFF; canary-era)",
      COLLAB:
        "New production collaborative default (single length + Scene OFF + collaborative interactive owner)",
    },
    pairs: {} as Record<string, unknown>,
  };

  const blind: string[] = [
    "# Blind — Frozen ARM D vs collaborative default candidate\n",
    "Status: `DEFAULT_COLLABORATIVE_HUMAN_REVIEW_PENDING`\n",
    "Same run·turn pairs. Side X / Side Y are shuffled.\n",
    "Hidden: arm, length, latency, run, alarms.\n",
    "Quality reference: acceptable competing-site output.\n",
    "Persona note for reviewers: 렌 is a 신규 S급 가이드 in USER_PERSONA — that is SOURCE_BACKED_CANON, not invention.\n",
    "Do **not** declare PASS / improved / root cause / production candidate before ChatGPT blind read.\n",
    "\n## Scoring\n",
    "```text",
    "캐릭터 매력·목소리             30",
    "계속 대화하고 싶은 정도         20",
    "장면 중심·몰입감               15",
    "유저 주권                      15",
    "실제 행동·관계 변화             10",
    "문체·반복 효율                 10",
    "```\n",
  ];

  let pair = 0;
  for (const run of [1, 2]) {
    for (const turn of [1, 2]) {
      pair += 1;
      const d = armD.find((o) => o.run === run && o.turn === turn)!;
      const c = armC.find((o) => o.run === run && o.turn === turn)!;
      const [x, y, map] = shufflePair(d, c);
      (hidden.pairs as Record<string, unknown>)[`pair${pair}`] = {
        turn,
        run,
        map,
        X: x.attempt_id,
        Y: y.attempt_id,
      };
      blind.push(
        `\n---\n\n## Pair ${pair} — Turn ${turn}\n\n` +
          `### User input\n\n\`\`\`text\n${d.user_input}\n\`\`\`\n\n` +
          `### Side X\n\n\`\`\`text\n${x.provider_raw}\n\`\`\`\n\n` +
          `### Side Y\n\n\`\`\`text\n${y.provider_raw}\n\`\`\`\n`
      );
    }
  }

  const rawLines: string[] = [
    "# RAW outputs — ARM D (frozen) vs collaborative default\n",
    "Status: `DEFAULT_COLLABORATIVE_HUMAN_REVIEW_PENDING`\n",
  ];
  for (const o of [...armD, ...armC]) {
    rawLines.push(
      `\n---\n\n## ${o.attempt_id} · arm ${o.arm} · run${o.run} turn${o.turn}\n\n` +
        `- finish: ${o.finish_reason}\n` +
        `- raw_chars: ${o.raw_chars}\n\n` +
        `### User\n\n\`\`\`text\n${o.user_input}\n\`\`\`\n\n` +
        `### Assistant\n\n\`\`\`text\n${o.provider_raw}\n\`\`\`\n`
    );
  }

  const promptDiff = [
    "# Prompt diff — frozen D canary vs collaborative production candidate",
    "",
    "## Shared with ARM D",
    "",
    "- single terminal length owner (`USER_TAIL` only)",
    "- SceneDirective / BASE_SCENE_ENGINE OFF (standard interactive)",
    "- DeepSeek style-only reminder + opening peel",
    "",
    "## New on collaborative candidate",
    "",
    "- `[USER CONTROL — COLLABORATIVE INTERACTIVE]` replaces nested standard/interactive/Luna A1 stack",
    "- SOURCE_BACKED_CANON sentence for USER_PERSONA / creator facts",
    "- Production path (not fail-closed canary)",
    "",
    "## Offline",
    "",
    "```text",
    "DEFAULT_AND_AUTO_MODE_UNIFICATION_OFFLINE_PASS",
    "```",
    "",
  ].join("\n");

  mkdirSync(DOCS, { recursive: true });
  mkdirSync(ART, { recursive: true });
  save(DOCS, "RUNTIME_RESULTS.json", runtime);
  save(DOCS, "_HIDDEN_PAIR_MAP.json", hidden);
  save(DOCS, "BLIND_D_VS_COLLABORATIVE.md", blind.join("\n"));
  save(DOCS, "RAW_OUTPUTS_FULL.md", rawLines.join("\n"));
  save(DOCS, "PROMPT_DIFF.md", promptDiff);
  save(
    DOCS,
    "README.md",
    [
      "# 44 — Default collaborative vs frozen ARM D",
      "",
      "```text",
      "DEFAULT_COLLABORATIVE_HUMAN_REVIEW_PENDING",
      "human review: NOT_RUN — waiting for ChatGPT",
      "auto-progression: NOT_RUN unless standard human screen passes",
      "```",
      "",
    ].join("\n")
  );

  for (const name of [
    "BLIND_D_VS_COLLABORATIVE.md",
    "RAW_OUTPUTS_FULL.md",
    "_HIDDEN_PAIR_MAP.json",
    "PROMPT_DIFF.md",
    "RUNTIME_RESULTS.json",
    "README.md",
  ]) {
    copyFileSync(join(DOCS, name), join(ART, name));
  }
  try {
    execSync(
      `cd ${ART} && zip -q -r 44-default-collaborative.zip BLIND_D_VS_COLLABORATIVE.md RAW_OUTPUTS_FULL.md _HIDDEN_PAIR_MAP.json PROMPT_DIFF.md RUNTIME_RESULTS.json README.md`,
      { stdio: "inherit" }
    );
  } catch {
    /* ignore */
  }
  console.log(JSON.stringify({ status: runtime.status, D: sd, COLLAB: sc }, null, 2));
}

main();
