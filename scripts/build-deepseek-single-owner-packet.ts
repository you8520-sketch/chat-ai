/**
 * Build blind human packet for DeepSeek triple vs single owner A/B.
 */
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { createHash, randomInt } from "node:crypto";

const ROOT =
  process.env.OUT_ROOT ?? "/opt/cursor/artifacts/deepseek-single-owner-ab";
const ART =
  process.env.ART_ROOT ?? "data/human-review/41-deepseek-single-owner-ab";
const DOCS =
  process.env.DOCS_DIR ?? "docs/audits/41-deepseek-single-owner-ab";

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

function loadArm(arm: "A" | "B"): Output[] {
  const dir = join(ROOT, `arm-${arm}`);
  const out: Output[] = [];
  for (const run of [1, 2]) {
    for (const turn of [1, 2]) {
      const metaPath = join(dir, `run${run}`, `turn${turn}-meta.json`);
      const rawPath = join(dir, `run${run}`, `turn${turn}-provider-raw.txt`);
      if (!existsSync(metaPath) || !existsSync(rawPath)) {
        throw new Error(`missing ${arm} r${run}t${turn}`);
      }
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Output;
      meta.provider_raw = readFileSync(rawPath, "utf8");
      out.push(meta);
    }
  }
  return out;
}

function shufflePair<T>(a: T, b: T): [T, T, "X_is_A" | "X_is_B"] {
  if (randomInt(2) === 0) return [a, b, "X_is_A"];
  return [b, a, "X_is_B"];
}

function main() {
  const armA = loadArm("A");
  const armB = loadArm("B");
  const all = [...armA, ...armB];

  const idxA = JSON.parse(
    readFileSync(join(ROOT, "arm-A", "outputs_index.json"), "utf8")
  ) as {
    new_calls: number;
    replacement_calls: number;
    exclusions: unknown[];
  };
  const idxB = JSON.parse(
    readFileSync(join(ROOT, "arm-B", "outputs_index.json"), "utf8")
  ) as {
    new_calls: number;
    replacement_calls: number;
    exclusions: unknown[];
  };

  const runtime = {
    status: "DS_SINGLE_OWNER_HUMAN_REVIEW_PENDING",
    generated_at: new Date().toISOString(),
    offline_parity: "DS_SINGLE_OWNER_FULL_PAYLOAD_PARITY_PASS",
    arms: {
      A: {
        label: "PRODUCTION_TRIPLE_OWNER",
        attempts: idxA.new_calls,
        valid: armA.length,
        replacement_calls: idxA.replacement_calls,
        exclusions: idxA.exclusions,
        chars: armA.map((o) => o.raw_chars),
        avg: Math.round(
          armA.reduce((s, o) => s + o.raw_chars, 0) / armA.length
        ),
        min: Math.min(...armA.map((o) => o.raw_chars)),
        max: Math.max(...armA.map((o) => o.raw_chars)),
      },
      B: {
        label: "SINGLE_TERMINAL_OWNER",
        attempts: idxB.new_calls,
        valid: armB.length,
        replacement_calls: idxB.replacement_calls,
        exclusions: idxB.exclusions,
        chars: armB.map((o) => o.raw_chars),
        avg: Math.round(
          armB.reduce((s, o) => s + o.raw_chars, 0) / armB.length
        ),
        min: Math.min(...armB.map((o) => o.raw_chars)),
        max: Math.max(...armB.map((o) => o.raw_chars)),
      },
    },
    human_review: "NOT_RUN — waiting for ChatGPT",
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
    };
  });

  const hidden: Record<string, unknown> = {
    status: "DS_SINGLE_OWNER_HUMAN_REVIEW_PENDING",
    note: "Reveal only after ChatGPT blind review.",
    arms: {
      A: "PRODUCTION_TRIPLE_OWNER (canary OFF, length owners=3)",
      B: "SINGLE_TERMINAL_OWNER (ds_single_terminal_length_owner, length owners=1)",
    },
    pairs: {} as Record<string, unknown>,
  };

  const blind: string[] = [
    "# Blind — DeepSeek triple length owner vs single terminal owner\n",
    "Status: `DS_SINGLE_OWNER_HUMAN_REVIEW_PENDING`\n",
    "Same run·turn pairs. Side X / Side Y are shuffled.\n",
    "Hidden: production/canary, length, alarm, latency, run.\n",
    "Do **not** declare PASS / improved / root cause / production candidate before ChatGPT blind read.\n",
  ];

  let pair = 0;
  for (const run of [1, 2]) {
    for (const turn of [1, 2]) {
      pair += 1;
      const a = armA.find((o) => o.run === run && o.turn === turn)!;
      const b = armB.find((o) => o.run === run && o.turn === turn)!;
      const [x, y, map] = shufflePair(a, b);
      (hidden.pairs as Record<string, unknown>)[`pair${pair}`] = {
        turn,
        // run intentionally omitted from blind; stored in hidden map only for reveal
        run,
        map,
        X: x.attempt_id,
        Y: y.attempt_id,
      };
      blind.push(
        `\n---\n\n## Pair ${pair} — Turn ${turn}\n\n` +
          `### User input\n\n\`\`\`text\n${a.user_input}\n\`\`\`\n\n` +
          `### Side X\n\n\`\`\`text\n${x.provider_raw}\n\`\`\`\n\n` +
          `### Side Y\n\n\`\`\`text\n${y.provider_raw}\n\`\`\`\n`
      );
    }
  }

  const rawLines: string[] = [
    "# RAW outputs — DeepSeek triple vs single owner\n",
    "Status: `DS_SINGLE_OWNER_HUMAN_REVIEW_PENDING`\n",
  ];
  for (const o of all) {
    rawLines.push(
      `\n---\n\n## ${o.attempt_id} · arm ${o.arm} · run${o.run} turn${o.turn}\n\n` +
        `- finish: ${o.finish_reason}\n` +
        `- raw_chars: ${o.raw_chars}\n` +
        `- canary: ${o.canary_variant ?? "(none)"}\n` +
        `- alarms: ${(o.alarms ?? []).join(", ") || "(none)"}\n\n` +
        `### User\n\n\`\`\`text\n${o.user_input}\n\`\`\`\n\n` +
        `### Assistant\n\n\`\`\`text\n${o.provider_raw}\n\`\`\`\n`
    );
  }

  const promptDiffSrc = join(DOCS, "PRODUCTION_VS_CANARY_PROMPT_DIFF.md");
  const promptDiff = existsSync(promptDiffSrc)
    ? readFileSync(promptDiffSrc, "utf8")
    : "(missing offline diff)";

  for (const dir of [ART, DOCS]) {
    save(dir, "RAW_OUTPUTS_FULL.md", rawLines.join("\n"));
    save(dir, "BLIND_TRIPLE_VS_SINGLE.md", blind.join("\n"));
    save(dir, "_HIDDEN_PAIR_MAP.json", hidden);
    save(dir, "RUNTIME_RESULTS.json", runtime);
    save(dir, "HARD_FAIL_ALARMS.json", {
      generated_at: new Date().toISOString(),
      status: "DS_SINGLE_OWNER_HUMAN_REVIEW_PENDING",
      note: "Detector alarms only — not a PASS/FAIL quality verdict.",
      per_attempt: perAttempt,
      alarm_counts: alarmCounts,
    });
    save(dir, "PROMPT_DIFF.md", promptDiff);
  }

  save(ROOT, "RUNTIME_RESULTS.json", runtime);
  console.log("PACKET_DONE", {
    art: ART,
    a_avg: runtime.arms.A.avg,
    b_avg: runtime.arms.B.avg,
  });
}

main();
