/**
 * Build four-way blind human packet for Audit 42 (Length × Scene 2×2).
 * Combines frozen A/B with new C/D outputs.
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

const ROOT_CD =
  process.env.ROOT_CD ?? "/opt/cursor/artifacts/deepseek-length-scene-2x2";
const ROOT_AB =
  process.env.ROOT_AB ?? "/opt/cursor/artifacts/deepseek-single-owner-ab";
const ART =
  process.env.ART_ROOT ?? "data/human-review/42-deepseek-length-scene-2x2";
const DOCS =
  process.env.DOCS_DIR ?? "docs/audits/42-deepseek-length-scene-2x2";

type Arm = "A" | "B" | "C" | "D";
type Side = "W" | "X" | "Y" | "Z";

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
  alarms: string[];
  replacement: boolean;
  provider?: string;
  canary_variant?: string | null;
};

function save(dir: string, name: string, content: string | object) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

function loadArm(arm: Arm): Output[] {
  const root = arm === "A" || arm === "B" ? ROOT_AB : ROOT_CD;
  const dir = join(root, `arm-${arm}`);
  const out: Output[] = [];
  for (const run of [1, 2]) {
    for (const turn of [1, 2]) {
      const metaPath = join(dir, `run${run}`, `turn${turn}-meta.json`);
      const rawPath = join(dir, `run${run}`, `turn${turn}-provider-raw.txt`);
      if (!existsSync(metaPath) || !existsSync(rawPath)) {
        throw new Error(`missing ${arm} r${run}t${turn} under ${dir}`);
      }
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Output;
      meta.provider_raw = readFileSync(rawPath, "utf8");
      out.push(meta);
    }
  }
  return out;
}

function shuffleFour<T>(items: [T, T, T, T]): {
  ordered: T[];
  sides: Side[];
  map: Record<Side, Arm>;
} {
  const arms: Arm[] = ["A", "B", "C", "D"];
  const idxs = [0, 1, 2, 3];
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [idxs[i], idxs[j]] = [idxs[j]!, idxs[i]!];
  }
  const sides: Side[] = ["W", "X", "Y", "Z"];
  const ordered = idxs.map((i) => items[i]!);
  const map = {} as Record<Side, Arm>;
  for (let i = 0; i < 4; i++) {
    map[sides[i]!] = arms[idxs[i]!]!;
  }
  return { ordered, sides, map };
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
  const armA = loadArm("A");
  const armB = loadArm("B");
  const armC = loadArm("C");
  const armD = loadArm("D");
  const all = [...armA, ...armB, ...armC, ...armD];

  const idxC = JSON.parse(
    readFileSync(join(ROOT_CD, "arm-C", "outputs_index.json"), "utf8")
  ) as {
    new_calls: number;
    replacement_calls: number;
    exclusions: unknown[];
  };
  const idxD = JSON.parse(
    readFileSync(join(ROOT_CD, "arm-D", "outputs_index.json"), "utf8")
  ) as {
    new_calls: number;
    replacement_calls: number;
    exclusions: unknown[];
  };
  const idxA = JSON.parse(
    readFileSync(join(ROOT_AB, "arm-A", "outputs_index.json"), "utf8")
  ) as {
    new_calls: number;
    replacement_calls: number;
    exclusions: unknown[];
  };
  const idxB = JSON.parse(
    readFileSync(join(ROOT_AB, "arm-B", "outputs_index.json"), "utf8")
  ) as {
    new_calls: number;
    replacement_calls: number;
    exclusions: unknown[];
  };

  const sa = stats(armA);
  const sb = stats(armB);
  const sc = stats(armC);
  const sd = stats(armD);

  const runtime = {
    status: "DS_LENGTH_SCENE_2X2_HUMAN_REVIEW_PENDING",
    generated_at: new Date().toISOString(),
    offline_parity: "DS_LENGTH_X_SCENE_2X2_OFFLINE_PASS",
    frozen_arms: ["A", "B"],
    new_arms: ["C", "D"],
    arms: {
      A: {
        label: "TRIPLE_OWNER_SCENE_ON",
        frozen: true,
        attempts: idxA.new_calls,
        valid: sa.valid,
        replacement_calls: idxA.replacement_calls,
        exclusions: idxA.exclusions,
        ...sa,
      },
      B: {
        label: "SINGLE_OWNER_SCENE_ON",
        frozen: true,
        attempts: idxB.new_calls,
        valid: sb.valid,
        replacement_calls: idxB.replacement_calls,
        exclusions: idxB.exclusions,
        ...sb,
      },
      C: {
        label: "TRIPLE_OWNER_SCENE_OFF",
        frozen: false,
        attempts: idxC.new_calls,
        valid: sc.valid,
        replacement_calls: idxC.replacement_calls,
        exclusions: idxC.exclusions,
        ...sc,
      },
      D: {
        label: "SINGLE_OWNER_SCENE_OFF",
        frozen: false,
        attempts: idxD.new_calls,
        valid: sd.valid,
        replacement_calls: idxD.replacement_calls,
        exclusions: idxD.exclusions,
        ...sd,
      },
    },
    human_review: "NOT_RUN — waiting for ChatGPT",
    note: "Do not declare PASS / improved / root cause / best arm / production candidate before human review.",
  };

  const alarmCounts: Record<string, number> = {};
  const perAttempt = all.map((o) => {
    for (const a of o.alarms ?? []) {
      alarmCounts[a] = (alarmCounts[a] ?? 0) + 1;
    }
    return {
      attempt_id: o.attempt_id,
      arm: o.arm,
      run: o.run,
      turn: o.turn,
      finish_reason: o.finish_reason,
      raw_chars: o.raw_chars,
      alarms: o.alarms,
      canary_variant: o.canary_variant ?? null,
      provider: o.provider ?? null,
      diagnostic_only: true,
    };
  });

  const hidden: Record<string, unknown> = {
    status: "DS_LENGTH_SCENE_2X2_HUMAN_REVIEW_PENDING",
    note: "Reveal only after ChatGPT blind review of BLIND_2X2.md.",
    arms: {
      A: "TRIPLE_OWNER_SCENE_ON (production; length=3; SceneDirective ON) — FROZEN from audit 41",
      B: "SINGLE_OWNER_SCENE_ON (ds_single_terminal_length_owner; length=1; SceneDirective ON) — FROZEN from audit 41",
      C: "TRIPLE_OWNER_SCENE_OFF (ds_triple_owner_scene_off; length=3; SceneDirective OFF)",
      D: "SINGLE_OWNER_SCENE_OFF (ds_single_owner_scene_off; length=1; SceneDirective OFF)",
    },
    prior_ab_human_verdict: {
      source: "audit 41 ChatGPT blind",
      verdicts: [
        "DS_SINGLE_OWNER_SCREEN_FAIL",
        "SINGLE_OWNER_QUALITY_IMPROVEMENT_NOT_REPRODUCED",
        "REDUNDANT_LENGTH_STACK_IS_A_REAL_CONFIGURATION_BUG",
        "REDUNDANT_LENGTH_STACK_PRIMARY_CAUSE_NOT_CONFIRMED",
        "HARD_FAIL_DETECTOR_GENERALIZATION_FAIL",
      ],
      preferences: {
        "R1T1": "A > B",
        "R1T2": "A >>> B",
        "R2T1": "B > A",
        "R2T2": "B > A",
      },
      hard_fails: {
        A: ["A-R2T1 unsupported guide/ability", "A-R2T2 badge/uniform/guide invention"],
        B: ["B-R1T1 named-NPC intrusion", "B-R1T2 NPC/admin takeover + primary exit"],
      },
    },
    groups: {} as Record<string, unknown>,
  };

  const blind: string[] = [
    "# Blind 2×2 — DeepSeek length stack × SceneDirective\n",
    "Status: `DS_LENGTH_SCENE_2X2_HUMAN_REVIEW_PENDING`\n",
    "Same run·turn groups. Sides W / X / Y / Z are shuffled.\n",
    "Hidden: arm, owner count, SceneDirective status, length, alarm, latency, run.\n",
    "Quality reference: the user’s acceptable competing-site output.\n",
    "Do **not** declare PASS / improved / root cause / best arm / production candidate before ChatGPT blind read.\n",
    "\n## Scoring (after reading all sides)\n",
    "```text",
    "character voice and attraction       25",
    "scene focus and interaction          20",
    "user agency                          15",
    "readability and immersion            15",
    "natural dialogue                     10",
    "real scene movement                  10",
    "length efficiency                     5",
    "total                               100",
    "```\n",
    "Hard fail (zero the sample):\n",
    "```text",
    "new user dialogue/decision/active action by assistant",
    "unsupported user grade/ability/registration/equipment/backstory",
    "new NPC or administrative process takes ownership",
    "primary character leaves user for external event",
    "previous scene replay >30%",
    "temporal rewind",
    "meta/system leak",
    "```\n",
  ];

  let group = 0;
  for (const run of [1, 2]) {
    for (const turn of [1, 2]) {
      group += 1;
      const a = armA.find((o) => o.run === run && o.turn === turn)!;
      const b = armB.find((o) => o.run === run && o.turn === turn)!;
      const c = armC.find((o) => o.run === run && o.turn === turn)!;
      const d = armD.find((o) => o.run === run && o.turn === turn)!;
      const { ordered, sides, map } = shuffleFour([a, b, c, d]);
      (hidden.groups as Record<string, unknown>)[`group${group}`] = {
        turn,
        run,
        map,
        W: ordered[0]!.attempt_id,
        X: ordered[1]!.attempt_id,
        Y: ordered[2]!.attempt_id,
        Z: ordered[3]!.attempt_id,
      };
      let block =
        `\n---\n\n## Group ${group} — Turn ${turn}\n\n` +
        `### User input\n\n\`\`\`text\n${a.user_input}\n\`\`\`\n`;
      for (let i = 0; i < 4; i++) {
        const side = sides[i]!;
        const row = ordered[i]!;
        block +=
          `\n### Side ${side}\n\n\`\`\`text\n${row.provider_raw}\n\`\`\`\n`;
      }
      blind.push(block);
    }
  }

  const rawLines: string[] = [
    "# RAW outputs — DeepSeek length × scene 2×2\n",
    "Status: `DS_LENGTH_SCENE_2X2_HUMAN_REVIEW_PENDING`\n",
    "A/B frozen from audit 41. C/D newly generated.\n",
  ];
  for (const o of all) {
    rawLines.push(
      `\n---\n\n## ${o.attempt_id} · arm ${o.arm} · run${o.run} turn${o.turn}\n\n` +
        `- finish: ${o.finish_reason}\n` +
        `- raw_chars: ${o.raw_chars}\n` +
        `- canary: ${o.canary_variant ?? "(none)"}\n` +
        `- alarms (diagnostic only): ${(o.alarms ?? []).join(", ") || "(none)"}\n\n` +
        `### User\n\n\`\`\`text\n${o.user_input}\n\`\`\`\n\n` +
        `### Assistant\n\n\`\`\`text\n${o.provider_raw}\n\`\`\`\n`
    );
  }

  mkdirSync(DOCS, { recursive: true });
  mkdirSync(ART, { recursive: true });

  save(DOCS, "RUNTIME_RESULTS.json", runtime);
  save(DOCS, "HARD_FAIL_ALARMS.json", {
    note: "Automatic detector is diagnostic only — not a PASS owner. HARD_FAIL_DETECTOR_GENERALIZATION_FAIL from audit 41.",
    alarm_counts: alarmCounts,
    per_attempt: perAttempt,
  });
  save(DOCS, "_HIDDEN_ARM_MAP.json", hidden);
  save(DOCS, "BLIND_2X2.md", blind.join("\n"));
  save(DOCS, "RAW_OUTPUTS_FULL.md", rawLines.join("\n"));

  // Copy parity artifacts already written into DOCS
  for (const name of [
    "PROMPT_DIFF_MATRIX.md",
    "PROMPT_HASHES.json",
    "PARITY_VERDICT.json",
  ]) {
    const src = join(DOCS, name);
    if (!existsSync(src)) {
      console.warn(`missing parity artifact ${name}`);
    }
  }

  save(
    DOCS,
    "README.md",
    [
      "# 42 — DeepSeek length stack × SceneDirective 2×2",
      "",
      "## Offline",
      "",
      "```text",
      "DS_LENGTH_X_SCENE_2X2_OFFLINE_PASS",
      "A vs C: only SceneDirective / progression-owner differs",
      "B vs D: only SceneDirective / progression-owner differs",
      "A/C length owners (T1) = 3",
      "B/D length owners = 1",
      "```",
      "",
      "## Arms",
      "",
      "| Arm | Length | SceneDirective | Source |",
      "|---|---|---|---|",
      "| A | triple | ON | frozen audit 41 |",
      "| B | single | ON | frozen audit 41 |",
      `| C | triple | OFF | new · ${sc.avg}/${sc.min}/${sc.max} chars |`,
      `| D | single | OFF | new · ${sd.avg}/${sd.min}/${sd.max} chars |`,
      "",
      "## Status",
      "",
      "```text",
      "DS_LENGTH_SCENE_2X2_HUMAN_REVIEW_PENDING",
      "human review: NOT_RUN — waiting for ChatGPT",
      "```",
      "",
      "No PASS / improved / root-cause / best-arm / production-candidate claimed.",
      "",
    ].join("\n")
  );

  // Mirror into human-review folder
  for (const name of [
    "BLIND_2X2.md",
    "RAW_OUTPUTS_FULL.md",
    "_HIDDEN_ARM_MAP.json",
    "PROMPT_DIFF_MATRIX.md",
    "PROMPT_HASHES.json",
    "RUNTIME_RESULTS.json",
    "HARD_FAIL_ALARMS.json",
    "README.md",
  ]) {
    const src = join(DOCS, name);
    if (existsSync(src)) copyFileSync(src, join(ART, name));
  }

  try {
    execSync(
      `cd ${ART} && zip -q -r 42-deepseek-length-scene-2x2.zip BLIND_2X2.md RAW_OUTPUTS_FULL.md _HIDDEN_ARM_MAP.json PROMPT_DIFF_MATRIX.md PROMPT_HASHES.json RUNTIME_RESULTS.json HARD_FAIL_ALARMS.json README.md`,
      { stdio: "inherit" }
    );
  } catch (e) {
    console.warn("zip failed", e);
  }

  console.log(
    JSON.stringify(
      {
        status: runtime.status,
        A: sa,
        B: sb,
        C: sc,
        D: sd,
        docs: DOCS,
        art: ART,
      },
      null,
      2
    )
  );
}

main();
