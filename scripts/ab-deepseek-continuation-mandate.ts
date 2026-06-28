/**
 * A/B — DeepSeek continuation mandate (env DEEPSEEK_CONTINUATION_MANDATE=1).
 * 10 mixed A/B/C scenarios (331/391/410–566 archetypes), baseline vs mandate.
 *
 * Usage:
 *   npx.cmd tsx scripts/ab-deepseek-continuation-mandate.ts --diff-only
 *   npx.cmd tsx scripts/ab-deepseek-continuation-mandate.ts
 */
import fs from "fs";
import path from "path";
import Module from "module";
import { loadEnvLocal } from "./load-env-local";
import {
  DEEPSEEK_CONTINUATION_MANDATE_BLOCK,
  DEEPSEEK_CONTINUATION_MANDATE_MARKER,
} from "../src/lib/deepseekPromptStructure";
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

const MODEL_ID = "deepseek/deepseek-v4-pro";
const FLOOR = 2200;
const TARGET_CHARS = 3300;
const DELAY_MS = 4000;
const MAX_ATTEMPTS = 5;
const ARMS = ["baseline", "mandate"] as const;
type Arm = typeof ARMS[number];

type Category = "A" | "B" | "C";

type Scenario = {
  id: string;
  category: Category;
  prodRef: string;
  userMessage: string;
  history: { role: "user" | "assistant"; content: string }[];
  assistantTail?: string;
};

const SCENARIOS: Scenario[] = [
  {
    id: "s01-gate-elevator",
    category: "A",
    prodRef: "331",
    userMessage: "정말 고장났나봐.... 나랑 떨어져야되는거아니야??",
    history: [
      { role: "user", content: "자동진행" },
      {
        role: "assistant",
        content:
          '"가이드님. 지금 저랑 떨어져야 된다고 말씀하실 건가요?"\n\n렌의 연두색 눈동자가 흔들렸다. 백하율은 그 흔들림을 놓치지 않고 황금빛 동공을 가늘게 떴다.\n\n백하율은 한 걸음 더 가까이 들어와 렌의 손목을 엘리베이터 벽 쪽으로 더 세게 밀었다.',
      },
    ],
  },
  {
    id: "s02-combat-chase",
    category: "A",
    prodRef: "333",
    userMessage: "…숨이 차. 잠깐만, 저쪽 문은 잠겼어.",
    history: [
      { role: "user", content: "자동진행" },
      {
        role: "assistant",
        content:
          "백하율이 렌의 손을 잡아 채 복도 끝으로 끌었다. 뒤에서 금속성 발소리가 겹쳐지며 거리가 좁혀졌다.\n\n\"움직여. 여기서 멈추면 끝이야.\"\n\n렌은 발을 헛디뎌 넘어질 뻔했고, 백하율은 그 순간 허리를 받쳐 몸을 안쪽으로 돌렸다. 차가운 철문이 옆에서 울리며 잠금 장치가 작동했다.",
      },
    ],
  },
  {
    id: "s03-threat-shield",
    category: "A",
    prodRef: "329",
    userMessage: "위험해! …내 뒤에 숨어.",
    history: [
      { role: "user", content: "자동진행" },
      {
        role: "assistant",
        content:
          "복도 끝에서 붉은 경보등이 점멸했다. 백하율은 렌을 벽 쪽으로 밀어 넣고 자신의 몸으로 그 앞을 가렸다.\n\n\"움직이지 마.\"\n\n날카로운 파열음이 근처에서 터졌고, 먼지가 두 사람의 어깨에 내려앉았다.",
      },
    ],
  },
  {
    id: "s04-jealousy-short",
    category: "B",
    prodRef: "391",
    userMessage: "…왜 그 사람한테만 그렇게 웃어줬어?",
    history: [
      { role: "user", content: "자동진행" },
      {
        role: "assistant",
        content:
          "백하율의 입꼬리가 잠깐 굳었다. 렌이 시선을 피하자 그는 한 박자 늦게 고개를 기울였다.\n\n\"그건 업무였어.\"\n\n말끝이 평소보다 낮게 가라앉았다.",
      },
    ],
  },
  {
    id: "s05-confession-chase",
    category: "B",
    prodRef: "450",
    userMessage: "…도망치지 마. 말해. 왜 나를 피해?",
    history: [
      { role: "user", content: "자동진행" },
      {
        role: "assistant",
        content:
          "렌이 계단 아래로 내려가려다 발을 멈췄다. 백하율은 그 위에서 숨을 고르지 않고 내려왔다.\n\n\"피하는 게 아니야.\"\n\n그의 목소리는 거칠었지만, 손은 렌의 소매를 놓지 않았다.",
      },
    ],
  },
  {
    id: "s06-comfort-reassure",
    category: "B",
    prodRef: "555",
    userMessage: "무서워… 괜찮아? 나 때문에 다친 거 아니야?",
    history: [
      { role: "user", content: "자동진행" },
      {
        role: "assistant",
        content:
          "백하율은 렌의 떨리는 손을 내려다보았다. 상처는 얕았지만 붉게 번져 있었다.\n\n\"괜찮아.\"\n\n그는 말과 달리 렌의 손목을 더 단단히 감쌌다.",
      },
    ],
  },
  {
    id: "s07-sofa-hand-slow",
    category: "C",
    prodRef: "410",
    userMessage: "밤이 깊었어. 무서워서 손 잡아줄래? …다 알아요, 내 몸이 원하는 거 알아? 천천히 해줘.",
    history: [
      { role: "user", content: "자동진행" },
      {
        role: "assistant",
        content:
          "소파 위, 두 사람 사이의 거리가 거의 없었다. 백하율은 렌의 손끝이 닿는 순간을 기다리지 않고 손을 찾아갔다.\n\n\"무서워?\"\n\n그의 손가락은 천천히 렌의 손등 위를 덮었다.",
      },
    ],
  },
  {
    id: "s08-embrace-escalate",
    category: "C",
    prodRef: "566",
    userMessage: "…더 가까이 와. 놓지 마.",
    history: [
      { role: "user", content: "자동진행" },
      {
        role: "assistant",
        content:
          "백하율은 렌을 소파 깊숙이 안아 넣었다. 렌의 숨결이 그의 목덜미에 닿았고, 방 안 조명은 낮게만 깜빡였다.\n\n\"놓지 않을게.\"\n\n그의 손은 렌의 등을 따라 천천히 내려갔다.",
      },
    ],
  },
  {
    id: "s09-postcombat-emotion",
    category: "A",
    prodRef: "335",
    userMessage: "…이제 괜찮아? 너도 무서웠지?",
    history: [
      { role: "user", content: "자동진행" },
      {
        role: "assistant",
        content:
          "경보음이 멎자 복도는 순식간에 고요해졌다. 백하율은 여전히 렌의 앞에 서 있었고, 손에는 아직 먼지가 묻어 있었다.\n\n\"끝났어.\"\n\n말은 짧았지만, 그의 눈은 렌의 얼굴을 놓지 않았다.",
      },
    ],
  },
  {
    id: "s10-negotiate-intimate",
    category: "C",
    prodRef: "424",
    userMessage: "…조건 말해. 대신 천천히만 해줘.",
    history: [
      { role: "user", content: "자동진행" },
      {
        role: "assistant",
        content:
          "백하율은 렌의 말을 듣고 잠시 입을 다물었다. 그의 손은 여전히 렌의 허리에 있었고, 거리는 협상보다 훨씬 가까웠다.\n\n\"조건?\"\n\n그는 낮게 웃으며 렌의 이마에 입술을 잠깐 맞댔다.",
      },
    ],
  },
];

type Sample = {
  arm: Arm;
  scenarioId: string;
  category: Category;
  prodRef: string;
  chars: number;
  floorPass: boolean;
  finishReason?: string;
  awkwardHits: string[];
  protectIdx: number | null;
  nsfwIdx: number | null;
  priorityOk: boolean;
  excerptTail: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function displayProse(c: string): string {
  let s = c ?? "";
  const i = s.search(/<<<STATUS/i);
  if (i >= 0) s = s.slice(0, i);
  return s.trim();
}

const AWKWARD_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "and_again_chain", re: /그리고\s*(다시|또)/g },
  { name: "repeated_again", re: /(다시|또).{0,40}(다시|또)/g },
  { name: "ellipsis_chain", re: /(…|\.{3})\s*(그리고|다시|또)\s*(…|\.{3})/g },
];

function findAwkward(prose: string): string[] {
  const hits: string[] = [];
  for (const { name, re } of AWKWARD_PATTERNS) {
    if (re.test(prose)) hits.push(name);
  }
  return hits;
}

const PROTECT_RE =
  /(?:위험|보호|가리|막|숨어|안전|경보|피해|다치|쓰러|공격|방어|맞서|받아|가로막)/;
const NSFW_RE =
  /(?:입술|키스|안아|허리|가슴|몸|천천히|더 가까|뜨거|숨결|살결|밀착|손끝|스킨십|속삭|끌어당|파고들|욕망|원해)/;

function priorityOrderCheck(prose: string): {
  protectIdx: number | null;
  nsfwIdx: number | null;
  priorityOk: boolean;
} {
  const protectIdx = prose.search(PROTECT_RE);
  const nsfwIdx = prose.search(NSFW_RE);
  const priorityOk =
    protectIdx < 0 ||
    nsfwIdx < 0 ||
    protectIdx <= nsfwIdx;
  return {
    protectIdx: protectIdx >= 0 ? protectIdx : null,
    nsfwIdx: nsfwIdx >= 0 ? nsfwIdx : null,
    priorityOk,
  };
}

async function buildFixture(scenario: Scenario, arm: Arm) {
  const mandateOn = arm === "mandate";
  if (mandateOn) {
    process.env.DEEPSEEK_CONTINUATION_MANDATE = "1";
  } else {
    delete process.env.DEEPSEEK_CONTINUATION_MANDATE;
  }

  const { messagesToTurns, rawRecentTurnsToHistory } = await import("../src/lib/hybridMemory");
  const { resolveRawRecentTurnWindowForHistory } = await import("../src/lib/contextTrack");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");

  const charName = "백하율";
  const persona = "렌";
  const historyMessages = [
    ...scenario.history,
    { role: "user" as const, content: scenario.userMessage },
  ];
  const turns = messagesToTurns(historyMessages.map((m) => ({ ...m, model: "assistant" })));
  const historyRaw = rawRecentTurnsToHistory(
    turns,
    0,
    resolveRawRecentTurnWindowForHistory(MODEL_ID, "openrouter", turns.length)
  );
  const chunks = parseCharacterSetting({
    characterId: "bc-mandate",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 집요하다.`,
    world: `# 세계관\n현대 도시, 밀폐 공간 긴장.`,
    exampleDialog: `유저: hi\n${charName}: …`,
    statusWindowPrompt: "",
  });
  const built = buildContext({
    charName,
    chunks,
    userNickname: persona,
    userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
    userNote: formatUserNoteForPrompt("검증", persona),
    longTermMemory: "[요약] 백하율과 렌 사이 긴장이 누적된 상태.",
    shortTermHistory: historyRaw,
    currentUserMessage: scenario.userMessage,
    nsfw: true,
    gender: "male",
    memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta('{"relationship":"acquaintance"}')),
    modelId: MODEL_ID,
    provider: "openrouter",
    personaDisplayName: persona,
    targetResponseChars: TARGET_CHARS,
    completedTurns: 9,
    userPersonaGender: "other",
    statusWidgetActive: false,
  });

  const split = built.openRouterSystemSplit!;
  const mandatePresent = split.dynamicBlock.includes(DEEPSEEK_CONTINUATION_MANDATE_MARKER);
  if (mandateOn && !mandatePresent) {
    throw new Error("mandate arm but block missing from dynamicBlock");
  }
  if (!mandateOn && mandatePresent) {
    throw new Error("baseline arm but mandate block present");
  }

  const history = built.history
    .slice(0, -1)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  return {
    charName,
    history,
    userMessage: scenario.userMessage,
    split,
    systemTokens: estimateTokens(
      [split.systemRulesBlock, split.characterSettingsBlock, split.dynamicBlock]
        .filter(Boolean)
        .join("\n\n")
    ),
    mandatePresent,
  };
}

async function printPromptDiff() {
  const scenario = SCENARIOS[0];
  const baseline = await buildFixture(scenario, "baseline");
  const mandate = await buildFixture(scenario, "mandate");

  const lines: string[] = [];
  lines.push("=== PROMPT DIFF (scenario s01-gate-elevator) ===");
  lines.push("");
  lines.push(`Baseline dynamic tokens: ${estimateTokens(baseline.split.dynamicBlock)}`);
  lines.push(`Mandate dynamic tokens: ${estimateTokens(mandate.split.dynamicBlock)}`);
  lines.push(
    `Delta: +${estimateTokens(mandate.split.dynamicBlock) - estimateTokens(baseline.split.dynamicBlock)} tokens`
  );
  lines.push("");
  lines.push("--- ADDED BLOCK (mandate arm only) ---");
  lines.push(DEEPSEEK_CONTINUATION_MANDATE_BLOCK);
  lines.push("");
  lines.push("--- INJECTION POINT ---");
  lines.push(
    "contextBuilder.ts after rule-length-control, section id deepseek-continuation-mandate, dynamic cache block, DeepSeek model only, DEEPSEEK_CONTINUATION_MANDATE=1"
  );
  lines.push("");
  lines.push("--- baseline dynamic tail (last 400 chars) ---");
  lines.push(baseline.split.dynamicBlock.slice(-400));
  lines.push("");
  lines.push("--- mandate dynamic tail (last 900 chars) ---");
  lines.push(mandate.split.dynamicBlock.slice(-900));

  const text = lines.join("\n");
  console.log(text);
  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "deepseek-continuation-mandate-prompt-diff.txt"), text, "utf8");
}

function loadDone(jsonlPath: string): Set<string> {
  if (!fs.existsSync(jsonlPath)) return new Set();
  const done = new Set<string>();
  for (const line of fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean)) {
    const j = JSON.parse(line) as Sample & { error?: string };
    if (typeof j.chars === "number") done.add(`${j.arm}|${j.scenarioId}`);
  }
  return done;
}

function loadSamples(jsonlPath: string): Sample[] {
  const byKey = new Map<string, Sample>();
  if (!fs.existsSync(jsonlPath)) return [];
  for (const line of fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean)) {
    const s = JSON.parse(line) as Sample;
    if (typeof s.chars !== "number") continue;
    byKey.set(`${s.arm}|${s.scenarioId}`, s);
  }
  return [...byKey.values()];
}

function mean(a: number[]) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

function buildReport(samples: Sample[]): string {
  const lines: string[] = [];
  lines.push("=== DeepSeek Continuation Mandate A/B ===");
  lines.push(`Scenarios: ${SCENARIOS.length} (A/B/C mixed, prod refs 331/391/410–566 archetypes)`);
  lines.push(`Arms: baseline (mandate OFF) vs mandate (DEEPSEEK_CONTINUATION_MANDATE=1)`);
  lines.push("");

  for (const arm of ARMS) {
    const armSamples = samples.filter((s) => s.arm === arm);
    lines.push(`--- ${arm} n=${armSamples.length} ---`);
    lines.push(`mean chars: ${mean(armSamples.map((s) => s.chars)).toFixed(0)}`);
    lines.push(
      `floor pass (${FLOOR}+): ${armSamples.filter((s) => s.floorPass).length}/${armSamples.length}`
    );
    lines.push(
      `awkward pattern hits: ${armSamples.filter((s) => s.awkwardHits.length > 0).length}`
    );
    lines.push(
      `priority fail (protect after nsfw): ${armSamples.filter((s) => !s.priorityOk).length}`
    );
    lines.push("");
  }

  const paired = SCENARIOS.map((sc) => {
    const b = samples.find((s) => s.arm === "baseline" && s.scenarioId === sc.id);
    const m = samples.find((s) => s.arm === "mandate" && s.scenarioId === sc.id);
    return { sc, b, m };
  });

  lines.push("--- Per-scenario paired ---");
  for (const { sc, b, m } of paired) {
    lines.push(
      `${sc.id} [${sc.category}] ref=${sc.prodRef} | baseline=${b?.chars ?? "?"} mandate=${m?.chars ?? "?"} Δ=${b && m ? m.chars - b.chars : "?"} awkward_b=${b?.awkwardHits.join(",") ?? "-"} awkward_m=${m?.awkwardHits.join(",") ?? "-"} prio_b=${b?.priorityOk ?? "?"} prio_m=${m?.priorityOk ?? "?"}`
    );
  }
  lines.push("");

  const awkwardMandate = samples.filter((s) => s.arm === "mandate" && s.awkwardHits.length > 0);
  if (awkwardMandate.length > 0) {
    lines.push("--- AWKWARD MANDATE SAMPLES (revert candidate) ---");
    for (const s of awkwardMandate) {
      lines.push(`${s.scenarioId}: ${s.awkwardHits.join(",")}`);
      lines.push(s.excerptTail.slice(-500));
      lines.push("");
    }
  }

  const prioFail = samples.filter((s) => !s.priorityOk);
  if (prioFail.length > 0) {
    lines.push("--- PRIORITY FAILURES ---");
    for (const s of prioFail) {
      lines.push(
        `${s.arm}/${s.scenarioId} protect@${s.protectIdx} nsfw@${s.nsfwIdx}`
      );
    }
  }

  const mandateLonger = paired.filter(
    (p) => p.b && p.m && p.m.chars > p.b.chars + 200
  ).length;
  lines.push("");
  lines.push(`Mandate longer by >200ch: ${mandateLonger}/${SCENARIOS.length} scenarios`);
  lines.push(
    "FAIL if awkward chain patterns dominate mandate arm — do not strengthen; revert mandate."
  );

  return lines.join("\n");
}

async function main() {
  const diffOnly = process.argv.includes("--diff-only");
  await printPromptDiff();
  if (diffOnly) return;

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY missing");
    process.exit(2);
  }

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonlPath = path.join(outDir, "deepseek-continuation-mandate.jsonl");
  const reportPath = path.join(outDir, "deepseek-continuation-mandate-report.txt");
  const done = loadDone(jsonlPath);
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");

  let apiCalls = 0;
  const maxCalls = SCENARIOS.length * ARMS.length;

  for (const arm of ARMS) {
    for (const scenario of SCENARIOS) {
      const key = `${arm}|${scenario.id}`;
      if (done.has(key)) {
        console.log(`skip ${key} (done)`);
        continue;
      }
      if (apiCalls >= maxCalls) break;

      const { charName, history, userMessage, split } = await buildFixture(scenario, arm);
      const system = [split.systemRulesBlock, split.characterSettingsBlock, split.dynamicBlock]
        .filter(Boolean)
        .join("\n\n");

      console.log(`\n=== ${arm} ${scenario.id} [${scenario.category}] ref=${scenario.prodRef} ===`);
      let ok = false;
      for (let att = 1; att <= MAX_ATTEMPTS; att++) {
        await sleep(DELAY_MS);
        apiCalls++;
        try {
          const result = await callOpenRouterAdult(
            system,
            [...history, { role: "user", content: userMessage }],
            MODEL_ID,
            TARGET_CHARS,
            { charName, systemSplit: split },
            { chargeTurnBudget: false, requestKind: "deepseek-mandate-ablation" }
          );
          const prose = displayProse(result.text);
          const awkwardHits = findAwkward(prose);
          const { protectIdx, nsfwIdx, priorityOk } = priorityOrderCheck(prose);
          const sample: Sample = {
            arm,
            scenarioId: scenario.id,
            category: scenario.category,
            prodRef: scenario.prodRef,
            chars: prose.length,
            floorPass: prose.length >= FLOOR,
            finishReason: result.finishReason,
            awkwardHits,
            protectIdx,
            nsfwIdx,
            priorityOk,
            excerptTail: prose.slice(-800),
          };
          fs.appendFileSync(jsonlPath, JSON.stringify(sample) + "\n", "utf8");
          done.add(key);
          console.log(
            `ok ${sample.chars}ch floor=${sample.floorPass} awkward=${awkwardHits.join(",") || "none"} prio=${priorityOk}`
          );
          ok = true;
          break;
        } catch (e) {
          console.log(`err att${att}: ${(e as Error).message.slice(0, 120)}`);
          await sleep(DELAY_MS * att);
        }
      }
      if (!ok) console.error(`FAILED ${key}`);
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
