/**
 * Beat Count Ablation — input scene beats only, Phase2 prompt unchanged, DeepSeek only.
 * Max 20 API calls (5 per arm × 4 arms).
 * Usage: npx.cmd tsx scripts/ab-beat-count-deepseek.ts
 */
import fs from "fs";
import path from "path";
import Module from "module";
import { loadEnvLocal } from "./load-env-local";

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
const RUNS = 5;
const ARMS = ["A", "B", "C", "D"] as const;
const MAX_CALLS = 20;
const DELAY_MS = 4000;
const MAX_ATTEMPTS = 5;
const TARGET_CHARS = 3300;

type Arm = typeof ARMS[number];

type StopStructure =
  | "dialogue_resolution"
  | "immediate_reaction"
  | "observer_wait_ending"
  | "atmosphere_block"
  | "tension_continuation"
  | "scene_state_transition"
  | "other";

type TerminalCategory =
  | "dialogue_resolution"
  | "reaction_only"
  | "atmosphere"
  | "internal_state"
  | "tension_shift"
  | "followup_interaction"
  | "other";

type Sample = {
  arm: Arm;
  run: number;
  inputBeats: number;
  chars: number;
  floorPass: boolean;
  blockCount: number;
  stopAfter: StopStructure;
  terminalStructure: StopStructure;
  terminalCategory: TerminalCategory;
};

const BEAT_DIALOGUE = `"가이드님. 지금 저랑 떨어져야 된다고 말씀하실 건가요?"`;
const BEAT_REACTION =
  "렌의 연두색 눈동자가 흔들렸다. 백하율은 그 흔들림을 놓치지 않고 황금빛 동공을 가늘게 떴다.";
const BEAT_FOLLOWUP =
  "백하율은 한 걸음 더 가까이 들어와 렌의 손목을 엘리베이터 벽 쪽으로 더 세게 밀었다.";
const BEAT_ENV =
  "좁은 철 상자 안 온도가 뒤센 채로 무거워졌고, 형광등이 불규칙하게 깜빡며 그들의 어깨를 차가르는 빛과 그림자로 나눴다.";
const BEAT_TENSION =
  "아직 말해지지 않은 질문이 백하율의 목젖 위에 걸려 있었다. 떨어져야 한다는 조건 뒤에 숨은 의도를 그는 아직 풀지 않은 채 렌의 반응을 기다리지 않고 다음 수를 계산했다.";

const USER_AUTO = "자동진행";
const USER_CURRENT = "정말 고장났나봐.... 나랑 떨어져야되는거아니야??";

function armAssistantContent(arm: Arm): string {
  const parts = [BEAT_DIALOGUE, BEAT_REACTION];
  if (arm === "B" || arm === "C" || arm === "D") parts.push(BEAT_FOLLOWUP);
  if (arm === "C" || arm === "D") parts.push(BEAT_ENV);
  if (arm === "D") parts.push(BEAT_TENSION);
  return parts.join("\n\n");
}

function armInputBeats(arm: Arm): number {
  if (arm === "A") return 2;
  if (arm === "B") return 3;
  if (arm === "C") return 4;
  return 5;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function displayProse(c: string): string {
  let s = c ?? "";
  const i = s.search(/<<<STATUS/i);
  if (i >= 0) s = s.slice(0, i);
  return s.trim();
}

function mean(a: number[]) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

function pct(n: number, t: number) {
  return t ? `${((n / t) * 100).toFixed(1)}%` : "0%";
}

function classifyBlockStructure(block: string): StopStructure {
  const t = block.trim();
  if (!t) return "other";
  const endsUnresolved =
    /[,…]\s*$/.test(t) ||
    /(?:하지만|그런데|아직|더 |이어서|곧|잠시 후|멈추지|끝나지|걸려|파고들|말해지지|끝맺지)/.test(
      t.slice(-100)
    );
  if (endsUnresolved) return "tension_continuation";
  if (
    /(?:문이|문을|열리|닫히|나갔|들어|이동|걸어|달려|뛰|회전|돌아|장면이|다른 층|복도|밖으로|안으로|층|방으로)/.test(
      t
    )
  )
    return "scene_state_transition";
  if (
    /(?:공기가|분위기|향기|조명|어둠|달빛|정적|고요|온도|밀폐|실내|주변|철 상자|엘리베이터 안)/.test(
      t
    ) &&
    !/"[^"]{4,}"\s*[.!?…]?\s*$/.test(t)
  )
    return "atmosphere_block";
  if (
    /(?:기다리|지켜보|바라보|응시|말없이|고요히|가만히|멈춰|확인하며|시선을 고정|반응을 기다|대답을 기다)/.test(
      t
    )
  )
    return "observer_wait_ending";
  if (/"[^"]{4,}"\s*[.!?…]?\s*$/.test(t) || /^"[^"]{4,}"$/.test(t))
    return "dialogue_resolution";
  if (
    /(?:눈동자|시선|표정|입꼬리|미소|흔들|떨|당황|긴장|연두색|황금|동공|손목|손가락|입술|숨)/.test(
      t
    )
  )
    return "immediate_reaction";
  return "other";
}

function analyzeStop(prose: string) {
  const paragraphs = prose
    .trim()
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const blocks = paragraphs.map(classifyBlockStructure);
  const terminal = blocks[blocks.length - 1] ?? "other";
  const stopAfter = blocks.length >= 2 ? blocks[blocks.length - 2] : terminal;
  const terminalText = paragraphs[paragraphs.length - 1] ?? "";
  return { blocks, terminal, stopAfter, blockCount: blocks.length, terminalText };
}

function mapTerminalCategory(terminal: StopStructure, terminalText: string): TerminalCategory {
  if (terminal === "dialogue_resolution") return "dialogue_resolution";
  if (terminal === "immediate_reaction") return "reaction_only";
  if (terminal === "atmosphere_block") return "atmosphere";
  if (terminal === "tension_continuation") return "tension_shift";
  if (terminal === "scene_state_transition") return "followup_interaction";
  if (
    /(?:속으로|마음속|생각|의심|욕망|계산|떠올|결심|갈등|충동|끓어|의구심|속마음)/.test(
      terminalText
    )
  )
    return "internal_state";
  return "other";
}

async function buildFixture(arm: Arm) {
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
    { role: "user" as const, content: USER_AUTO },
    { role: "assistant" as const, content: armAssistantContent(arm) },
    { role: "user" as const, content: USER_CURRENT },
  ];
  const turns = messagesToTurns(historyMessages.map((m) => ({ ...m, model: "assistant" })));
  const historyRaw = rawRecentTurnsToHistory(
    turns,
    0,
    resolveRawRecentTurnWindowForHistory(MODEL_ID, "openrouter", turns.length)
  );
  const chunks = parseCharacterSetting({
    characterId: "bc-1",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분.`,
    world: `# 세계관\n현대.`,
    exampleDialog: `유저: hi\n${charName}: …`,
    statusWindowPrompt: "",
  });
  const built = buildContext({
    charName,
    chunks,
    userNickname: persona,
    userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
    userNote: formatUserNoteForPrompt("검증", persona),
    longTermMemory: "[요약] 엘리베이터에서 긴장된 분위기가 이어졌다.",
    shortTermHistory: historyRaw,
    currentUserMessage: USER_CURRENT,
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
  const history = built.history
    .slice(0, -1)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  return { charName, history, userMessage: USER_CURRENT, split };
}

function loadDone(jsonlPath: string): Set<string> {
  if (!fs.existsSync(jsonlPath)) return new Set();
  const done = new Set<string>();
  for (const line of fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean)) {
    const j = JSON.parse(line) as Sample & { error?: string };
    if (typeof j.chars === "number") done.add(`${j.arm}|${j.run}`);
  }
  return done;
}

function loadSamples(jsonlPath: string): Sample[] {
  const byKey = new Map<string, Sample>();
  if (!fs.existsSync(jsonlPath)) return [];
  for (const line of fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean)) {
    const s = JSON.parse(line) as Sample;
    if (typeof s.chars !== "number") continue;
    byKey.set(`${s.arm}|${s.run}`, s);
  }
  return [...byKey.values()];
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY missing");
    process.exit(2);
  }

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonlPath = path.join(outDir, "beat-count-ablation.jsonl");
  const reportPath = path.join(outDir, "beat-count-ablation-report.txt");
  const done = loadDone(jsonlPath);
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");

  let apiCalls = 0;
  for (const arm of ARMS) {
    const { charName, history, userMessage, split } = await buildFixture(arm);
    const system = [split.systemRulesBlock, split.characterSettingsBlock, split.dynamicBlock]
      .filter(Boolean)
      .join("\n\n");
    console.log(`\n=== Arm ${arm} inputBeats=${armInputBeats(arm)} historyChars=${armAssistantContent(arm).length} ===`);

    for (let run = 1; run <= RUNS; run++) {
      const key = `${arm}|${run}`;
      if (done.has(key)) {
        console.log(`Arm ${arm} run ${run}/${RUNS} skip (done)`);
        continue;
      }
      if (apiCalls >= MAX_CALLS) {
        console.error(`MAX_CALLS ${MAX_CALLS} reached`);
        process.exit(3);
      }
      process.stdout.write(`Arm ${arm} run ${run}/${RUNS}\n`);
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
            { chargeTurnBudget: false, requestKind: "beat-count-ablation" }
          );
          const prose = displayProse(result.text);
          const { terminal, stopAfter, blockCount, terminalText } = analyzeStop(prose);
          const sample: Sample = {
            arm,
            run,
            inputBeats: armInputBeats(arm),
            chars: prose.length,
            floorPass: prose.length >= FLOOR,
            blockCount,
            stopAfter,
            terminalStructure: terminal,
            terminalCategory: mapTerminalCategory(terminal, terminalText),
          };
          fs.appendFileSync(jsonlPath, JSON.stringify(sample) + "\n", "utf8");
          done.add(key);
          console.log(
            `  ok ${sample.chars}ch floor=${sample.floorPass} blocks=${blockCount} stopAfter=${stopAfter} terminal=${terminal} cat=${sample.terminalCategory}`
          );
          ok = true;
          break;
        } catch (e) {
          console.log(`  err att${att}: ${(e as Error).message.slice(0, 100)}`);
          await sleep(DELAY_MS * att);
        }
      }
      if (!ok) {
        fs.appendFileSync(jsonlPath, JSON.stringify({ arm, run, error: "failed" }) + "\n", "utf8");
      }
    }
  }

  const samples = loadSamples(jsonlPath);
  const lines: string[] = [
    "BEAT COUNT ABLATION — DeepSeek V4 Pro",
    `generated: ${new Date().toISOString()}`,
    `model: ${MODEL_ID} · FLOOR=${FLOOR} · runs=${RUNS}/arm · apiCalls=${apiCalls}`,
    "prompt: Phase2 baseline (unchanged) · input scene beats varied only",
    "",
    "Arms:",
    "  A = dialogue + reaction (2 beats)",
    "  B = + follow-up action (3)",
    "  C = + environment shift (4)",
    "  D = + new tension (5)",
    "",
  ];

  for (const arm of ARMS) {
    const sub = samples.filter((s) => s.arm === arm);
    const chars = sub.map((s) => s.chars);
    const floorN = sub.filter((s) => s.floorPass).length;
    lines.push(`### Arm ${arm} (${armInputBeats(arm)} input beats, n=${sub.length})`);
    lines.push(`  mean=${mean(chars).toFixed(0)}ch  FLOOR=${pct(floorN, sub.length)}  meanBlocks=${mean(sub.map((s) => s.blockCount)).toFixed(1)}`);

    const stopDist: Record<string, number> = {};
    const termDist: Record<string, number> = {};
    for (const s of sub) {
      stopDist[s.stopAfter] = (stopDist[s.stopAfter] ?? 0) + 1;
      termDist[s.terminalCategory] = (termDist[s.terminalCategory] ?? 0) + 1;
    }
    lines.push(`  stopAfter: ${Object.entries(stopDist).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    lines.push(`  terminal: ${Object.entries(termDist).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    lines.push("");
  }

  const report = lines.join("\n");
  fs.writeFileSync(reportPath, report, "utf8");
  console.log("\n" + report);
  console.log(`Wrote ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
