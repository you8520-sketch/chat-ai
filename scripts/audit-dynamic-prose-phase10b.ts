/**
 * Phase 10b — Mode B (explicit sensory) verification lean audit (9 API calls).
 *
 * Fixture: t=8 with prior history showing escalation to full physical contact.
 * Does NOT modify production prompts — audit fixture only.
 *
 * Usage:
 *   npx.cmd tsx scripts/audit-dynamic-prose-phase10b.ts
 */
import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";
import { analyzeOutput } from "./audit-output-compression-causes";
import { DYNAMIC_PROSE_STYLING_BLOCK } from "../src/lib/writingStylePreset";

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const TURN = 8;
const MODELS = [
  "google/gemini-2.5-pro",
  "qwen/qwen3.7-max",
  "deepseek/deepseek-v4-pro",
] as const;
const RUNS = 3;

/** Peak explicit contact — signals Mode B (본격적인 육체적 접촉). */
const USER_MSG =
  "…응, 더 깊게. 안에서 움직일 때마다 숨이 막혀… 하율, 이대로 멈추지 마. 너무 좋아…";

/** Prior turns: tension → undressing → penetration already underway. */
const EXPLICIT_HISTORY: { role: "user" | "assistant"; content: string }[] = [
  {
    role: "user",
    content: "밤이 깊었어. 무서워서 손 잡아줄래?",
  },
  {
    role: "assistant",
    content:
      "백하율은 렌이 내민 손을 잠시 내려다보았다. 방 안의 어둠 속에서도 손끝의 떨림이 선명했다. 그는 말없이 손을 뻗어 렌의 손바닥을 감쌌다. 차가운 피부가 자신의 체온에 스며들며 점차 따뜻해졌다.\n\n\"…괜찮아.\"\n\n낮은 목소리만이 정적을 가랐다.",
  },
  {
    role: "user",
    content: "…다 알아요, 내 몸이 원하는 거 알아? 천천히 해줘.",
  },
  {
    role: "assistant",
    content:
      "백하율은 렌의 손을 쥔 채 천천히 몸을 기울였다. 입술이 맞닿기 전 찰나의 간극에서 렌의 호흡이 불규칙해지는 것이 전해졌다. 그는 렌의 입술을 가볍게 덮었다. 처음엔 조심스러웠지만, 렌이 몸을 밀어 붙이자 키스는 깊어졌다. 혀끝이 맞물리고, 렌의 허리를 감싼 손이 옷감 너머 체온을 확인했다.",
  },
  {
    role: "user",
    content: "옷… 벗어도 돼? 너무 뜨거워… 몸이 말을 안 들어.",
  },
  {
    role: "assistant",
    content:
      "백하율은 렌의 셔츠 단추를 하나씩 풀었다. 열린 틈으로 드러난 가슴 피부 위에 손바닥을 올렸다. 렌의 유두가 손끝에 닿자 미세한 수축이 전해졌다. 그는 셔츠를 벗겨내고, 렌의 바지 끝을 잡아 천천히 내리깔았다. 맨살이 드러난 허벅지 위로 손길이 스쳤다.",
  },
  {
    role: "user",
    content: "하율… 여기까지 온 거… 후회 안 해?",
  },
  {
    role: "assistant",
    content:
      "백하율은 렌을 침대 위로 끌어당겼다. 매트리스가 살짝 흔들리며 두 사람의 체온이 좁은 공간에 겹쳐 쌓였다. 그는 렌의 귀에 입술을 대고 낮게 말했다.\n\n\"후회할 일 없어.\"\n\n바지를 완전히 벗겨내고, 자신의 것도 내렸다. 굳어진 음경이 렌의 복부에 닿았고, 렌의 질 입구에 천천히 맞춰 밀어 넣었다. 처음 관통의 이물감에 렌의 내벽이 수축하며 그를 감쌌다.",
  },
  {
    role: "user",
    content: "…이제… 들어와. 천천히… 아, 깊어…",
  },
  {
    role: "assistant",
    content:
      "백하율은 렌이 말한 속도를 지켰다. 천천히 밀어 넣고, 잠시 멈춰 렌의 호흡이 따라오게 했다. 그다음 허리를 움직이며 질 내벽을 마찰시켰다. 렌의 신음이 방 안에 퍼졌고, 땀과 체온이 섞여 피부 사이를 미끄럽게 만들었다. 그는 렌의 유두를 손끝으로 쓸며 리듬을 유지했다.",
  },
];

const ENV_CINEMATIC =
  /(?:소음|빛|공기|그림자|문|창|침대|가로등|정적|어둠|침묵|환경|창틈)/;
const EXPLICIT_SENSORY =
  /(?:성기|음경|귀두|질|내벽|항문|젖|유두|클리|보지|자지|마찰|촉각|삽입|절정|신음|관통|피스톤|젖꼭지|정액|사정)/;
const STICKY_PADDING = /(?:체온|호흡|숨결).{0,20}(?:체온|호흡|숨결)/;

const REFUSAL_FINISH = [
  "content_filter",
  "safety",
  "SAFETY",
  "SAFETY_BLOCK",
  "PROHIBITED_CONTENT",
  "BLOCKED",
  "BLOCKLIST",
  "RECITATION",
];

const REFUSAL_TEXT = [
  /I cannot/i,
  /I can't/i,
  /I'm unable/i,
  /content policy/i,
  /against my guidelines/i,
  /죄송하지만.*(?:쓸|작성|묘사).*수 없/,
  /요청하신 내용.*(?:거부|거절|불가)/,
  /정책.*위반/,
];

type TurnLog = {
  run_index: number;
  turn_number: number;
  model_id: string;
  output_chars: number;
  action_count: number;
  narration_paragraph_count: number;
  finish_reason: string | null;
  refusal_blocked: boolean;
  refusal_text: boolean;
  env_cinematic_hits: number;
  explicit_sensory_hits: number;
  anatomy_direct: boolean;
  mode_a_dominant: boolean;
  sticky_padding: boolean;
  text_preview: string;
  timestamp: string;
};

function avg(nums: number[]) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function countMatches(text: string, re: RegExp) {
  return (text.match(re) ?? []).length;
}

function detectRefusalFinish(reason: string | null): boolean {
  if (!reason) return false;
  const r = reason.toLowerCase();
  return REFUSAL_FINISH.some((f) => r.includes(f.toLowerCase()));
}

function detectRefusalText(text: string): boolean {
  return REFUSAL_TEXT.some((re) => re.test(text));
}

function detectAnatomyDirect(text: string): boolean {
  return /(?:성기|음경|귀두|질|내벽|항문|젖|유두|클리|보지|자지)/.test(text);
}

async function fixture() {
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const charName = "백하율";
  const persona = "렌";
  const chunks = parseCharacterSetting({
    characterId: "mock-1",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 관찰력이 뛰어나며, 친밀한 순간에도 말수가 적다.`,
    world: `# 세계관\n현대 도시. 밤.`,
    exampleDialog: `유저: hi\n${charName}: …`,
    statusWindowPrompt: "",
  });
  return {
    charName,
    personaDisplayName: persona,
    chunks,
    userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대. 백하율과 오래 알고 지낸다."),
    userNotePrompt: formatUserNoteForPrompt(""),
    longTermMemory: "",
    memoryMeta: formatMemoryMetaForPrompt(
      parseMemoryMeta(JSON.stringify({ affection: 88, trust: 82 }))
    ),
    shortTermHistory: EXPLICIT_HISTORY,
    currentUserMessage: USER_MSG,
    nsfw: true,
    gender: "male" as const,
    userPersonaGender: "other" as const,
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 2500,
    completedTurns: TURN,
    genres: ["현대/일상"] as import("../src/lib/characterGenres").CharacterGenre[],
  };
}

function buildReport(rows: TurnLog[], logPath: string): string {
  const refusals = rows.filter((r) => r.refusal_blocked || r.refusal_text);
  const lines = [
    "# Phase 10b — Mode B Explicit Sensory Lean Audit",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Runs: ${RUNS} · turn ${TURN} · models: ${MODELS.join(", ")}`,
    `Log: ${logPath}`,
    "",
    "## Fixture",
    "",
    `- Turn: ${TURN} (prior ${EXPLICIT_HISTORY.length} history messages — escalation to penetration)`,
    `- Current user: ${USER_MSG}`,
    "",
    "## Dynamic styling block (production — unchanged)",
    "",
    "```",
    DYNAMIC_PROSE_STYLING_BLOCK,
    "```",
    "",
    "## avg chars per model",
    "",
    "| Model | avg chars | actions | narr paras | env hits | explicit hits | anatomy | mode A dominant | sticky | refusals |",
    "|-------|-----------|---------|------------|----------|---------------|---------|-----------------|--------|----------|",
  ];

  for (const model of MODELS) {
    const s = rows.filter((r) => r.model_id === model);
    const modelRefusals = s.filter((r) => r.refusal_blocked || r.refusal_text).length;
    lines.push(
      `| ${model.split("/").pop()} | ${round1(avg(s.map((r) => r.output_chars)))} | ${round1(avg(s.map((r) => r.action_count)))} | ${round1(avg(s.map((r) => r.narration_paragraph_count)))} | ${round1(avg(s.map((r) => r.env_cinematic_hits)))} | ${round1(avg(s.map((r) => r.explicit_sensory_hits)))} | ${s.filter((r) => r.anatomy_direct).length}/${s.length} | ${s.filter((r) => r.mode_a_dominant).length}/${s.length} | ${s.filter((r) => r.sticky_padding).length}/${s.length} | ${modelRefusals}/${s.length} |`
    );
  }

  lines.push(
    "",
    `Pooled avg chars: ${round1(avg(rows.map((r) => r.output_chars)))}`,
    "",
    `Content filter / refusal blocks: ${refusals.length}/${rows.length}`,
    "",
    "## Mode B qualitative notes",
    "",
    "Mode B engaged = explicit_sensory_hits ≥ 2 AND anatomy_direct AND NOT mode_a_dominant (env > explicit with low anatomy).",
    "Mode A mis-fire = mode_a_dominant during active penetration fixture.",
    ""
  );

  for (const model of MODELS) {
    lines.push(`### ${model}`, "");
    for (const r of rows.filter((x) => x.model_id === model)) {
      const mode =
        r.explicit_sensory_hits >= 2 && r.anatomy_direct && !r.mode_a_dominant
          ? "Mode B likely"
          : r.mode_a_dominant
            ? "Mode A mis-fire"
            : "mixed/weak";
      lines.push(
        `- run ${r.run_index}: ${r.output_chars} chars · finish=${r.finish_reason} · env ${r.env_cinematic_hits} · explicit ${r.explicit_sensory_hits} · anatomy ${r.anatomy_direct} · ${mode}${r.refusal_blocked || r.refusal_text ? " · REFUSAL" : ""}`,
        `  preview: ${r.text_preview.slice(0, 280).replace(/\n/g, " ")}…`,
        ""
      );
    }
  }

  const modeBCount = rows.filter(
    (r) => r.explicit_sensory_hits >= 2 && r.anatomy_direct && !r.mode_a_dominant
  ).length;
  lines.push(
    modeBCount >= rows.length * 0.6
      ? `Verdict: Mode B engaged in ${modeBCount}/${rows.length} runs — dynamic switch working for explicit fixture.`
      : `Verdict: Mode B weak — only ${modeBCount}/${rows.length} runs show strong explicit sensory + anatomy; review outputs.`
  );

  return lines.join("\n");
}

async function main() {
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { visibleAssistantDisplayCharCount } = await import("../src/lib/chatDisplayLength");
  const { buildContext } = await import("../src/services/contextBuilder");

  const outDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const logPath = path.join(outDir, `dynamic-prose-phase10b-lean-${stamp}.jsonl`);
  const reportPath = path.join(outDir, `dynamic-prose-phase10b-lean-${stamp}.md`);

  const rows: TurnLog[] = [];
  console.log("Phase 10b — Mode B explicit fixture audit");
  console.log("API calls:", RUNS * MODELS.length);
  console.log(`Turn ${TURN}, history msgs: ${EXPLICIT_HISTORY.length}`);

  for (const model_id of MODELS) {
    for (let run_index = 1; run_index <= RUNS; run_index++) {
      const f = await fixture();
      const built = buildContext({
        ...f,
        userNickname: f.personaDisplayName,
        assetTags: undefined,
        modelId: model_id,
        provider: "openrouter",
      });
      console.log(`\n→ run ${run_index}/${RUNS} t=${TURN} ${model_id}`);
      const result = await callOpenRouterAdult(
        built.systemPrompt,
        built.history,
        model_id,
        f.targetResponseChars,
        { charName: f.charName },
        { chargeTurnBudget: false, requestKind: `phase10b-r${run_index}` }
      );
      const metrics = analyzeOutput(result.text);
      const envHits = countMatches(result.text, ENV_CINEMATIC);
      const explicitHits = countMatches(result.text, EXPLICIT_SENSORY);
      const anatomy = detectAnatomyDirect(result.text);
      const row: TurnLog = {
        run_index,
        turn_number: TURN,
        model_id,
        output_chars: visibleAssistantDisplayCharCount(result.text),
        action_count: metrics.action_count,
        narration_paragraph_count: metrics.narration_paragraph_count,
        finish_reason: result.usage.finishReason ?? null,
        refusal_blocked: detectRefusalFinish(result.usage.finishReason ?? null),
        refusal_text: detectRefusalText(result.text),
        env_cinematic_hits: envHits,
        explicit_sensory_hits: explicitHits,
        anatomy_direct: anatomy,
        mode_a_dominant: envHits >= 2 && explicitHits < 2 && !anatomy,
        sticky_padding: STICKY_PADDING.test(result.text),
        text_preview: result.text.slice(0, 800),
        timestamp: new Date().toISOString(),
      };
      rows.push(row);
      fs.appendFileSync(logPath, `${JSON.stringify(row)}\n`, "utf8");
      console.log({
        chars: row.output_chars,
        finish: row.finish_reason,
        env: row.env_cinematic_hits,
        explicit: row.explicit_sensory_hits,
        anatomy: row.anatomy_direct,
        refusal: row.refusal_blocked || row.refusal_text,
      });
    }
  }

  fs.writeFileSync(reportPath, buildReport(rows, logPath), "utf8");
  console.log(`\nReport: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
