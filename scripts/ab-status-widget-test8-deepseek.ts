/**
 * TEST 8 — Widget vs Internal Planning load (DeepSeek, Phase2 baseline)
 *
 * Goal: Distinguish whether extra output in widget-enabled turns comes from
 * (A) the actual generation of widget values/JSON/HTML, or
 * (B) simply the cognitive load of a "multi-task" turn.
 *
 * Constraints:
 * - Phase2 prompt, length control, scene completion, etc. unchanged.
 * - DEEPSEEK_CONTINUATION_MANDATE must be OFF.
 * - Only the test script varies the task load presented to the model.
 *
 * Three arms (per scenario):
 *   A: RP only (no widget, no extra task)
 *   B: RP + INTERNAL invisible planning task (same conceptual fields as widget,
 *      but explicitly forbidden from appearing in output)
 *   C: RP + real widget value generation + JSON tail (current production widget path)
 *
 * Runs: 5 reps per arm per scenario (Action / Relationship / NSFW)
 *
 * Metrics:
 * - RP prose chars (widget tail stripped)
 * - goal/exchange proxies (beats, dialogue, protect-before-NSFW)
 * - terminal stop type
 * - planning depth proxy (internal-state narration paragraphs)
 * - token breakdown (total output tokens, estimated widget tail tokens for C)
 *
 * Key question:
 *   Does Arm B behave like Arm C in length/structure?
 *   - Yes → multi-task planning is the driver.
 *   - No  → actual widget value generation is responsible.
 *
 * Also reports widget "wasted" tokens in Arm C (output tokens for the JSON tail
 * that are not part of the displayed RP prose).
 *
 * Usage:
 *   npx.cmd tsx scripts/ab-status-widget-test8-deepseek.ts --reps=5
 *   npx.cmd tsx scripts/ab-status-widget-test8-deepseek.ts --reps=2 --scenarios=action,nsfw
 */

import fs from "fs";
import path from "path";
import Module from "module";
import { loadEnvLocal } from "./load-env-local";
import { estimateTokens } from "../src/lib/tokenEstimate";

const origLoad = Module._load;
// @ts-expect-error legacy hook
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  // @ts-expect-error legacy
  return origLoad(request, parent, isMain);
};

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

// === FORCE BASELINE ===
delete process.env.DEEPSEEK_CONTINUATION_MANDATE;

const MODEL_ID = "deepseek/deepseek-v4-pro";
const TARGET_CHARS = 3300;
const DELAY_MS = 4200;
const MAX_ATTEMPTS = 4;

type Arm = "A" | "B" | "C";
type ScenarioKey = "action" | "relationship" | "nsfw";

interface Sample {
  scenario: ScenarioKey;
  arm: Arm;
  run: number;
  rpChars: number;
  totalOutputTokens: number;
  estimatedRpTokens: number;
  estimatedWidgetTailTokens: number; // only meaningful for C
  beatCount: number;
  dialogueCount: number;
  internalStateBeats: number; // planning depth proxy
  terminal: string;
  priorityProtectBeforeNsfw: boolean | null;
  hasWidgetTail: boolean;
  finishReason: string;
  note?: string;
}

const SCENARIOS: Record<ScenarioKey, {
  label: string;
  charName: string;
  persona: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
}> = {
  action: {
    label: "Action / gate-elevator",
    charName: "백하율",
    persona: "렌",
    history: [
      { role: "user", content: "자동진행" },
      {
        role: "assistant",
        content:
          '"가이드님. 지금 저랑 떨어져야 된다고 말씀하실 건가요?"\n\n렌의 연두색 눈동자가 흔들렸다. 백하율은 그 흔들림을 놓치지 않고 황금빛 동공을 가늘게 떴다.\n\n백하율은 한 걸음 더 가까이 들어와 렌의 손목을 엘리베이터 벽 쪽으로 더 세게 밀었다.',
      },
    ],
    userMessage: "정말 고장났나봐.... 나랑 떨어져야되는거아니야??",
  },
  relationship: {
    label: "Relationship / jealousy",
    charName: "백하율",
    persona: "렌",
    history: [
      { role: "user", content: "자동진행" },
      {
        role: "assistant",
        content:
          "백하율의 입꼬리가 잠깐 굳었다. 렌이 시선을 피하자 그는 한 박자 늦게 고개를 기울였다.\n\n\"그건 업무였어.\"\n\n말끝이 평소보다 낮게 가라앉았다.",
      },
    ],
    userMessage: "…왜 그 사람한테만 그렇게 웃어줬어?",
  },
  nsfw: {
    label: "NSFW / sofa",
    charName: "백하율",
    persona: "렌",
    history: [
      { role: "user", content: "자동진행" },
      {
        role: "assistant",
        content:
          "소파 위, 두 사람 사이의 거리가 거의 없었다. 백하율은 렌의 손끝이 닿는 순간을 기다리지 않고 손을 찾아갔다.\n\n\"무서워?\"\n\n그의 손가락은 천천히 렌의 손등 위를 덮었다.",
      },
    ],
    userMessage: "밤이 깊었어. 무서워서 손 잡아줄래? …다 알아요, 내 몸이 원하는 거 알아? 천천히 해줘.",
  },
};

const INVISIBLE_PLANNING_BLOCK = `[INTERNAL PLANNING TASK — invisible, do not output]
Before you finish this turn, silently determine for yourself (reasoning only):
- Current character physical/mental state (short)
- Dominant emotion right now (one phrase)
- Relationship dynamic / tension with the other person in this exact moment
- One-sentence scene summary of what is happening

Do NOT write these values in the response.
Do NOT append JSON, <<<STATUS_VALUES>>>, HTML, status lines, or any extra block.
The final output must be ONLY Korean RP prose and dialogue.
Perform the assessment internally and then continue with the scene.`;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function displayProseAndStripWidget(text: string): { rp: string; hadWidgetTail: boolean } {
  let s = text ?? "";
  const i = s.search(/<<<STATUS/i);
  let had = false;
  if (i >= 0) {
    had = true;
    s = s.slice(0, i);
  }
  // also strip bare sw-hud style or trailing STATUS blocks if any leaked
  const j = s.search(/sw-hud/i);
  if (j >= 0) {
    had = true;
    const divStart = s.lastIndexOf("<div", j);
    if (divStart >= 0) s = s.slice(0, divStart).trimEnd();
    else s = s.slice(0, j).trimEnd();
  }
  s = s.replace(/\n*(?:^|\n)STATUS[\s\S]*$/i, "").trim();
  return { rp: s.trim(), hadWidgetTail: had };
}

function countDialogues(prose: string): number {
  const m = prose.match(/"[^"]{3,}"/g);
  return m ? m.length : 0;
}

function classifyTerminal(block: string): string {
  const t = block.trim();
  if (!t) return "other";
  if (/[,…]\s*$/.test(t) || /(?:하지만|그런데|아직|더 |이어서|곧|멈추지|끝나지|걸려|파고들)/.test(t.slice(-80)))
    return "tension_continuation";
  if (/(?:기다리|지켜보|바라보|응시|말없이|고요히|가만히|멈춰|반응을 기다)/.test(t)) return "observer_wait_ending";
  if (/"[^"]{4,}"\s*[.!?…]?\s*$/.test(t)) return "dialogue_resolution";
  if (/(?:눈동자|시선|표정|입꼬리|미소|흔들|떨|긴장|동공|손목|숨|속으로|마음)/.test(t)) return "immediate_reaction";
  if (/(?:문이|문을|열리|닫히|나갔|들어|이동|복도|엘리베이터)/.test(t)) return "scene_state_transition";
  if (/(?:공기가|분위기|온도|밀폐|주변|철 상자)/.test(t) && !/"[^"]{4,}"\s*[.!?…]?\s*$/.test(t))
    return "atmosphere_block";
  return "other";
}

function analyzeStop(prose: string) {
  const paragraphs = prose.trim().split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const terminal = paragraphs.length ? classifyTerminal(paragraphs[paragraphs.length - 1]) : "other";
  return { beatCount: paragraphs.length, terminal };
}

const PROTECT_RE = /(?:위험|보호|가리|막아|숨|안전|경보|피해|다치|쓰러|공격|방어|가로막)/i;
const NSFW_RE = /(?:입술|키스|안아|허리|가슴|몸|더 가까|뜨거|숨결|밀착|손끝|스킨|속삭|끌어당|욕망|파고|원해|벗|스치)/i;

function priorityCheck(prose: string): boolean | null {
  const p = prose.search(PROTECT_RE);
  const n = prose.search(NSFW_RE);
  if (p < 0 && n < 0) return null;
  if (p < 0) return false;
  if (n < 0) return true;
  return p <= n;
}

const INTERNAL_STATE_RE =
  /(?:속으로|마음속|생각|의심|욕망|계산|떠올|결심|갈등|충동|끓어|의구심|속마음|감정|두려움|기쁨|설렘|미안|화|질투|사랑|애정)/;

function countInternalStateBeats(prose: string): number {
  const paras = prose.trim().split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  return paras.filter((p) => INTERNAL_STATE_RE.test(p)).length;
}

async function buildArm(
  scenario: ScenarioKey,
  arm: Arm,
  baseHistory: Array<{ role: "user" | "assistant"; content: string }>
) {
  const sc = SCENARIOS[scenario];
  const { buildContext } = await import("../src/services/contextBuilder");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");

  // Start from clean history (no widget leakage)
  let history = baseHistory.map((m) => {
    if (m.role !== "assistant") return m;
    const { rp } = displayProseAndStripWidget(m.content);
    return { ...m, content: rp };
  });

  let statusWidgetActive = false;
  let statusWidgetPromptBlock = "";
  let note = "";

  if (arm === "A") {
    statusWidgetActive = false;
    statusWidgetPromptBlock = "";
    note = "A: RP only — no widget, no extra task";
  }

  if (arm === "B") {
    statusWidgetActive = false;
    statusWidgetPromptBlock = "";
    note = "B: RP + invisible internal planning (same fields as widget, no output allowed)";
  }

  if (arm === "C") {
    statusWidgetActive = true;
    // Use a production-style instruction so the model actually emits the JSON tail.
    statusWidgetPromptBlock = [
      "[STATUS WIDGET — values only, NO HTML]",
      "Do NOT output status window HTML. Do NOT duplicate status in prose.",
      "Use Korean for values unless scene is otherwise. Unknown → \"—\".",
      "After the RP prose, append exactly one JSON block using the markers below.",
      "",
      "Append format:",
      "<<<STATUS_VALUES char>>>",
      '{"시간":"<scene value>","장소":"<scene value>","속마음":"<scene value>","현재상황":"<scene value>"}',
      "<<<END_STATUS>>>",
      "",
      "Fill every key with a scene-accurate value. Never copy placeholders.",
    ].join("\n");
    note = "C: RP + real widget value generation + JSON tail";
  }

  const chunks = parseCharacterSetting({
    characterId: "bc-test8",
    characterName: sc.charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 집요하며 상황 판단이 빠르다.`,
    world: `# 세계관\n현대. 밀폐된 공간 또는 친밀한 장면에서 긴장이 고조된다.`,
    exampleDialog: `유저: hi\n${sc.charName}: …`,
    statusWindowPrompt: "",
  });

  const built = buildContext({
    charName: sc.charName,
    chunks,
    userNickname: sc.persona,
    userPersona: formatSelectedPersonaForPrompt(sc.persona, "other", "20대."),
    userNote: formatUserNoteForPrompt("검증", sc.persona),
    longTermMemory: "[요약] 백하율과 렌 사이에 긴장과 감정이 쌓여 있는 상태.",
    shortTermHistory: history.slice(0, -1),
    currentUserMessage: history[history.length - 1].content,
    nsfw: true,
    gender: "male",
    memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta('{"relationship":"tense"}')),
    modelId: MODEL_ID,
    provider: "openrouter",
    personaDisplayName: sc.persona,
    targetResponseChars: TARGET_CHARS,
    completedTurns: 8,
    userPersonaGender: "other",
    statusWidgetActive,
    statusWidgetPromptBlock: statusWidgetPromptBlock || undefined,
  });

  let system = [built.openRouterSystemSplit!.systemRulesBlock, built.openRouterSystemSplit!.characterSettingsBlock, built.openRouterSystemSplit!.dynamicBlock]
    .filter(Boolean)
    .join("\n\n");

  // For Arm B, append the invisible multi-task instruction to simulate planning load
  // without producing any visible artifact.
  if (arm === "B") {
    system = system + "\n\n" + INVISIBLE_PLANNING_BLOCK;
  }

  const apiHistory = built.history.slice(0, -1).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const currentUser = history[history.length - 1].content;

  return { system, apiHistory, currentUser, note };
}

async function runOne(scenario: ScenarioKey, arm: Arm, run: number): Promise<Sample> {
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { splitProseAndStatusWidgetValuesDeepSeek } = await import("../src/lib/statusWidget/deepseekCapture");

  const sc = SCENARIOS[scenario];
  const { system, apiHistory, currentUser, note } = await buildArm(scenario, arm, sc.history);

  const result = await callOpenRouterAdult(
    system,
    [...apiHistory, { role: "user", content: currentUser }],
    MODEL_ID,
    TARGET_CHARS,
    { charName: sc.charName },
    { chargeTurnBudget: false, requestKind: `status-widget-test8-${scenario}-${arm}` }
  );

  const raw = result.text ?? "";
  const usage = result.usage;
  const totalOut = usage?.outputTokens ?? estimateTokens(raw);

  let rp = raw;
  let hadWidgetTail = false;
  let widgetTailTokens = 0;

  if (arm === "C") {
    // Separate real widget tail
    const split = splitProseAndStatusWidgetValuesDeepSeek(raw);
    rp = split.prose || raw;
    hadWidgetTail = !!(split.values && (split.values.character || split.values.user));
    const tailStart = rp.length;
    const tail = raw.slice(tailStart).trim();
    widgetTailTokens = tail ? estimateTokens(tail) : 0;
  } else {
    const stripped = displayProseAndStripWidget(raw);
    rp = stripped.rp;
    hadWidgetTail = stripped.hadWidgetTail;
  }

  const rpChars = rp.length;
  const estRpTokens = Math.max(0, totalOut - widgetTailTokens);

  const { beatCount, terminal } = analyzeStop(rp);
  const dialogueCount = countDialogues(rp);
  const internalStateBeats = countInternalStateBeats(rp);
  const prio = priorityCheck(rp);

  return {
    scenario,
    arm,
    run,
    rpChars,
    totalOutputTokens: totalOut,
    estimatedRpTokens: estRpTokens,
    estimatedWidgetTailTokens: widgetTailTokens,
    beatCount,
    dialogueCount,
    internalStateBeats,
    terminal,
    priorityProtectBeforeNsfw: prio,
    hasWidgetTail: hadWidgetTail,
    finishReason: String(usage?.finishReason ?? "unknown"),
    note,
  };
}

function loadDone(jsonlPath: string): Set<string> {
  if (!fs.existsSync(jsonlPath)) return new Set();
  const done = new Set<string>();
  for (const line of fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean)) {
    try {
      const j = JSON.parse(line);
      if (typeof j.rpChars === "number") done.add(`${j.scenario}|${j.arm}|${j.run}`);
    } catch {}
  }
  return done;
}

function loadSamples(jsonlPath: string): Sample[] {
  const out: Sample[] = [];
  if (!fs.existsSync(jsonlPath)) return out;
  for (const line of fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean)) {
    try {
      const s = JSON.parse(line);
      if (typeof s.rpChars === "number") out.push(s);
    } catch {}
  }
  return out;
}

function mean(a: number[]) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

function buildReport(samples: Sample[]): string {
  const lines: string[] = [];
  lines.push("=== TEST 8 — Widget Value Generation vs Internal Multi-Task Planning (DeepSeek) ===");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("Phase2 baseline. Continuation mandate OFF. Only task load varied.");
  lines.push("");

  const scenarios: ScenarioKey[] = ["action", "relationship", "nsfw"];

  for (const sc of scenarios) {
    lines.push(`--- ${SCENARIOS[sc].label} ---`);
    for (const arm of ["A", "B", "C"] as Arm[]) {
      const s = samples.filter((x) => x.scenario === sc && x.arm === arm);
      if (!s.length) {
        lines.push(`${arm}: (no data)`);
        continue;
      }
      const rp = mean(s.map((x) => x.rpChars));
      const outTok = mean(s.map((x) => x.totalOutputTokens));
      const rpTok = mean(s.map((x) => x.estimatedRpTokens));
      const wTok = mean(s.map((x) => x.estimatedWidgetTailTokens));
      const beats = mean(s.map((x) => x.beatCount));
      const dlg = mean(s.map((x) => x.dialogueCount));
      const internal = mean(s.map((x) => x.internalStateBeats));
      const terms = Array.from(new Set(s.map((x) => x.terminal))).join(",");
      const prioTrue = s.filter((x) => x.priorityProtectBeforeNsfw === true).length;
      const withTail = s.filter((x) => x.hasWidgetTail).length;

      lines.push(
        `${arm}: rp=${rp.toFixed(0)}ch outTok=${outTok.toFixed(0)} rpTok≈${rpTok.toFixed(0)} ` +
        `widgetTok≈${wTok.toFixed(0)} beats=${beats.toFixed(1)} dlg=${dlg.toFixed(1)} internalBeats=${internal.toFixed(1)} ` +
        `term=[${terms}] prioProtect=${prioTrue}/${s.length} widgetTail=${withTail}/${s.length}`
      );
    }
    lines.push("");
  }

  // Cross-arm comparison per scenario
  lines.push("=== B vs C comparison (does invisible planning match real widget generation?) ===");
  for (const sc of scenarios) {
    const b = samples.filter((x) => x.scenario === sc && x.arm === "B");
    const c = samples.filter((x) => x.scenario === sc && x.arm === "C");
    if (!b.length || !c.length) continue;
    const bRp = mean(b.map((x) => x.rpChars));
    const cRp = mean(c.map((x) => x.rpChars));
    const bTok = mean(b.map((x) => x.totalOutputTokens));
    const cTok = mean(c.map((x) => x.totalOutputTokens));
    const deltaRp = cRp - bRp;
    const deltaTok = cTok - bTok;
    const closer = Math.abs(deltaRp) < 200 && Math.abs(deltaTok) < 150;
    lines.push(
      `${sc}: B→${bRp.toFixed(0)}ch / ${bTok.toFixed(0)}tok   C→${cRp.toFixed(0)}ch / ${cTok.toFixed(0)}tok   ` +
      `Δrp=${deltaRp.toFixed(0)} Δtok=${deltaTok.toFixed(0)}   ${closer ? "B ≈ C (planning load dominant)" : "B ≠ C (widget generation itself adds cost)"}`
    );
  }
  lines.push("");

  // Widget waste summary (Arm C only)
  const cAll = samples.filter((x) => x.arm === "C");
  if (cAll.length) {
    const avgWidgetTok = mean(cAll.map((x) => x.estimatedWidgetTailTokens));
    const avgTotal = mean(cAll.map((x) => x.totalOutputTokens));
    const pct = avgTotal > 0 ? (avgWidgetTok / avgTotal) * 100 : 0;
    lines.push("=== Arm C widget tail cost (tokens that do not appear in displayed RP) ===");
    lines.push(`Average widget-related output tokens per turn: ${avgWidgetTok.toFixed(0)}`);
    lines.push(`Average total output tokens: ${avgTotal.toFixed(0)}`);
    lines.push(`Widget tail share of output tokens: ${pct.toFixed(1)}%`);
    lines.push("");
  }

  lines.push("=== Interpretation ===");
  lines.push("If B is close to C in rpChars / tokens / structure → multi-task planning is the main driver of extra length.");
  lines.push("If B stays close to A while C is markedly larger → the act of generating the widget JSON/values is responsible.");
  lines.push("Widget tail tokens in C are the portion of the model's output that is stripped before showing RP to the user.");
  return lines.join("\n");
}

function parseArgs() {
  const args = process.argv.slice(2);
  let reps = 5;
  let scenarios: ScenarioKey[] = ["action", "relationship", "nsfw"];
  for (const a of args) {
    if (a.startsWith("--reps=")) reps = parseInt(a.split("=")[1], 10) || 5;
    if (a.startsWith("--scenarios=")) {
      const list = a.split("=")[1].split(",").map((s) => s.trim().toLowerCase()) as ScenarioKey[];
      scenarios = list.filter((s): s is ScenarioKey => ["action", "relationship", "nsfw"].includes(s));
    }
    if (a === "--help" || a === "-h") {
      console.log("Usage: npx.cmd tsx scripts/ab-status-widget-test8-deepseek.ts [--reps=5] [--scenarios=action,relationship,nsfw]");
      process.exit(0);
    }
  }
  return { reps, scenarios };
}

async function main() {
  const { reps, scenarios } = parseArgs();
  console.log(`[test8] mandate=${process.env.DEEPSEEK_CONTINUATION_MANDATE || "(unset)"} reps=${reps} scenarios=${scenarios.join(",")}`);

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonlPath = path.join(outDir, "status-widget-test8-deepseek.jsonl");
  const reportPath = path.join(outDir, "status-widget-test8-deepseek-report.txt");
  const done = loadDone(jsonlPath);

  const arms: Arm[] = ["A", "B", "C"];

  for (const sc of scenarios) {
    for (const arm of arms) {
      for (let r = 1; r <= reps; r++) {
        const key = `${sc}|${arm}|${r}`;
        if (done.has(key)) {
          console.log(`skip ${key}`);
          continue;
        }
        process.stdout.write(`${sc} ${arm} r${r}/${reps} ... `);
        let ok = false;
        for (let att = 1; att <= MAX_ATTEMPTS; att++) {
          await sleep(DELAY_MS);
          try {
            const sample = await runOne(sc, arm, r);
            fs.appendFileSync(jsonlPath, JSON.stringify(sample) + "\n", "utf8");
            console.log(
              `rp=${sample.rpChars}ch tok=${sample.totalOutputTokens} wTok=${sample.estimatedWidgetTailTokens} beats=${sample.beatCount} int=${sample.internalStateBeats} tail=${sample.hasWidgetTail}`
            );
            ok = true;
            break;
          } catch (e) {
            console.log(`err att${att}: ${(e as Error).message.slice(0, 100)}`);
            await sleep(DELAY_MS * att);
          }
        }
        if (!ok) {
          fs.appendFileSync(jsonlPath, JSON.stringify({ scenario: sc, arm, run: r, error: true }) + "\n", "utf8");
        }
      }
    }
  }

  const samples = loadSamples(jsonlPath);
  const report = buildReport(samples);
  fs.writeFileSync(reportPath, report, "utf8");
  console.log("\n" + report);
  console.log(`\nWrote ${jsonlPath}`);
  console.log(`Wrote ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
