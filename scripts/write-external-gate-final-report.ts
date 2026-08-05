import fs from "node:fs";
import path from "node:path";
import { computeDialogueMetrics } from "../src/lib/dialogueMetrics";

const dir =
  "/opt/cursor/artifacts/deepseek-common-root-audit/24-external-intervention-gate/early_external_intervention_gate_system";
const out = "/opt/cursor/artifacts/deepseek-common-root-audit/24-external-intervention-gate";

const rows = [];
for (const r of [1, 2, 3]) {
  for (const t of [1, 2]) {
    const raw = fs.readFileSync(`${dir}/run${r}/turn${t}-provider-raw.txt`, "utf8");
    const m = JSON.parse(fs.readFileSync(`${dir}/run${r}/turn${t}-metrics.json`, "utf8"));
    const pipe = JSON.parse(fs.readFileSync(`${dir}/run${r}/turn${t}-pipeline.json`, "utf8"));
    const dm = computeDialogueMetrics({ text: raw, primaryCharacterName: "라이크" });
    const adminAction =
      /(데스크|창구|접수실|의무실|확인실).{0,40}(부르|안내|등록|검사|접수|호출)/.test(raw) ||
      /(직원이|안내원이|담당자가|경비(?:원)?(?:가|이)).{0,30}(말했|물었|부르|안내)/.test(raw);
    const reaction = /([?？]|어때|할래|갈래|뭐\s*해|봐|여기|따라와|같이\s*가|골라|선택|믿어도|말해봐|괜찮)/.test(
      raw.slice(-320)
    );
    rows.push({
      id: `run${r}/turn${t}`,
      len: m.provider_raw_ws as number,
      npc: Boolean(m.npc_subplot),
      ext: Number(m.external_dialogue_blocks || 0),
      admin: adminAction ? 1 : 0,
      resume: Number(m.manual_resume_transitions || 0),
      frag: Number(m.manual_fragmentation_multiplier || 0),
      dlg: dm.dialogue_chars / Math.max(1, dm.dialogue_chars + dm.narration_chars),
      narr: dm.narration_chars / Math.max(1, dm.dialogue_chars + dm.narration_chars),
      reaction: reaction ? 1 : 0,
      gate: pipe?.integrity?.externalInterventionGateApplied,
      order: pipe?.integrity?.promptInjectionOrder,
    });
  }
}

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const npc = rows.filter((r) => r.npc).length;
const ext = rows.reduce((a, r) => a + r.ext, 0);
const admin = rows.reduce((a, r) => a + r.admin, 0);
const avgLen = avg(rows.map((r) => r.len));
const lt2400 = rows.filter((r) => r.len < 2400).length;
const ge2700 = rows.filter((r) => r.len >= 2700).length;
const drop = (3531.7 - avgLen) / 3531.7;
const resume = avg(rows.map((r) => (r.resume * 1000) / Math.max(1, r.len)));
const frag = avg(rows.map((r) => r.frag));
const dlg = avg(rows.map((r) => r.dlg));
const narr = avg(rows.map((r) => r.narr));
const reaction = rows.reduce((a, r) => a + r.reaction, 0);

const failures: string[] = [];
if (npc > 1 || ext > 2) failures.push("NPC_REDUCTION_INSUFFICIENT");
if (admin > 0) failures.push("NPC_REDUCTION_INSUFFICIENT_ADMIN");
if (avgLen < 3000 || lt2400 > 0 || ge2700 < 5 || drop > 0.1) {
  failures.push("CORE_SCENE_LENGTH_INVALID");
}
if (reaction < 5) failures.push("REACTION_POINT_REGRESSION");
const baseResume = 1.4;
const baseFrag = 1.52;
if (resume > baseResume * 1.1 || frag > baseFrag * 1.1) {
  failures.push("DIALOGUE_RHYTHM_REGRESSION");
}
if (dlg < 0.1 || dlg > 0.2 || narr < 0.8 || narr > 0.9) {
  failures.push("DIALOGUE_RHYTHM_REGRESSION_SHARE");
}

let active_verdict = "SYSTEM_EXTERNAL_GATE_ACTIVE_PASS";
if (failures.some((f) => f.startsWith("NPC_REDUCTION"))) {
  active_verdict = "NPC_REDUCTION_INSUFFICIENT";
} else if (failures.some((f) => f.startsWith("CORE_SCENE"))) {
  active_verdict = "CORE_SCENE_LENGTH_INVALID";
} else if (failures.some((f) => f.startsWith("DIALOGUE_RHYTHM"))) {
  active_verdict = "DIALOGUE_RHYTHM_REGRESSION";
} else if (failures.some((f) => f.startsWith("REACTION"))) {
  active_verdict = "REACTION_POINT_REGRESSION";
}

const offline = JSON.parse(
  fs.readFileSync(
    "/opt/cursor/artifacts/deepseek-common-root-audit/23-prompt-driver-audit/VERDICT.json",
    "utf8"
  )
);

const active = {
  n: 6,
  NPC: `${npc}/6`,
  external_dialogue: ext,
  administrative_subplot: admin,
  total_length: Number(avgLen.toFixed(1)),
  core_scene_length_approx: Number(avgLen.toFixed(1)),
  primary_resume_per_1000: Number(resume.toFixed(3)),
  fragmentation: Number(frag.toFixed(3)),
  dialogue_narration: `${(dlg * 100).toFixed(1)}% / ${(narr * 100).toFixed(1)}%`,
  reaction: `${reaction}/6`,
  count_lt_2400: lt2400,
  count_ge_2700: ge2700,
  length_drop_vs_baseline: Number(drop.toFixed(4)),
  gate_applied_6_6: rows.every((r) => r.gate === true),
  failures,
  active_verdict,
  rows,
};

const report = {
  prompt_driver_verdict: offline.prompt_driver_verdict,
  suspect_blocks: offline.suspect_blocks,
  active,
  stall_suite: { status: "NOT_RUN", reason: "Active suite did not pass", stall_verdict: null },
  quality_rubric: { average: null, minimum: null, status: "NOT_RUN" },
  next_isolated_issue:
    "System gate reduced speaking-NPC rate (harness 1/6) but collapsed length (avg 2871, 2×<2400) and reaction points (2/6). Next: isolate length/reaction regression from the system gate without strengthening gate wording — do not retry user-tail owners.",
  safety: {
    production_DB_apply: "NO",
    general_rollout: "NO",
    auto_merge: "NO",
    auto_deploy: "NO",
    canary_enabled_after_test: "NO",
    start_command: "npm run start",
  },
  pr_234: "closed without merge",
  pr_235: "draft canary record",
};

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "ACTIVE_SUITE_VERDICT.json"), JSON.stringify(active, null, 2));
fs.writeFileSync(path.join(out, "FINAL_REPORT.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
