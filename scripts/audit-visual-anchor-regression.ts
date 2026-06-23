/**
 * Visual-appearance-anchor regression — baseline vs section removal.
 *
 * Tests appearance consistency (hair/eye color) across late turns (t=8+)
 * with poisoned history containing wrong NPC-like colors.
 *
 * Usage:
 *   npx.cmd tsx scripts/audit-visual-anchor-regression.ts
 *   npx.cmd tsx scripts/audit-visual-anchor-regression.ts --model=google/gemini-2.5-flash
 */
import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";
import { estimateTokens } from "../src/lib/tokenEstimate";
import type { CharacterChunk } from "../src/types";
import type { VisualAppearancePolicy } from "../src/lib/visualAnchor";

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const PERSONA = "렌";
const TURNS = [2, 8, 10] as const;
const SEQUENTIAL_TURNS = 5;
const DEFAULT_MODEL = "google/gemini-2.5-flash";

type Condition = "BASELINE" | "MINUS_VISUAL_ANCHOR";

type Row = {
  condition: Condition;
  completed_turns: number;
  turn_index: number;
  model_id: string;
  violations: string[];
  violation_count: number;
  output_chars: number;
  output_preview: string;
  anchor_tokens: number;
  timestamp: string;
};

function rebuildSystemWithoutSection(
  sections: { id: string; text: string }[],
  excludeId: string | null
): string {
  return sections
    .filter((s) => excludeId == null || s.id !== excludeId)
    .map((s) => s.text)
    .join("\n\n");
}

function sectionTokens(sections: { id: string; text: string }[], id: string): number {
  const s = sections.find((x) => x.id === id);
  return s ? estimateTokens(s.text) : 0;
}

/** Wrong colors injected into prior assistant turns — drift bait */
function buildPoisonedHistory(charName: string): { role: "user" | "assistant"; content: string }[] {
  const pairs: { user: string; assistant: string }[] = [
    {
      user: "게이트 탐사 끝났어? 무슨 일 있었어?",
      assistant: `${charName}이 코트를 벗으며 말했다. 달빛에 비친 **금발**이 창가를 스쳤고, **푸른 눈동자**가 어둠 속에서 반짝였다.`,
    },
    {
      user: "피곤해 보이네. 쉬어.",
      assistant: `그는 소파에 기대었다. **금빛 머리카락**이 이마에 닿았고, **파란 홍책**이 그림자 속에서 희미하게 빛났다.`,
    },
    {
      user: "가이딩 수치는 괜찮아?",
      assistant: `S-기어를 확인하며 ${charName}이 고개를 끄덕였다. **밝은 금발**이 어깨에 흘렀고, **하늘색 눈**이 렌을 가만히 응시했다.`,
    },
    {
      user: "다음 작전은 언제야?",
      assistant: `그는 수트 단추를 채웠다. **blonde hair**가 거울에 반사되고, **blue eyes**가 차갑게 빛났다.`,
    },
    {
      user: "밤이 깊었어. 잠깐 대화하자.",
      assistant: `${charName}은 창밖을 보았다. **은빛 금발**이 달빛에 반짝이며, **푸른 눈**이 멀리 게이트를 향했다.`,
    },
    {
      user: "너 오늘 좀 다르게 보여.",
      assistant: `그가 돌아보았다. **금발**이 흐트러졌고, **파란 눈동자**가 렌의 얼굴을 스쳤다.`,
    },
  ];

  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const p of pairs) {
    out.push({ role: "user", content: p.user });
    out.push({ role: "assistant", content: p.assistant });
  }
  return out;
}

const VISUAL_PROBE_MSGS = [
  "창밖 달빛 아래서 네 머리색과 눈이 어떻게 보이는지 자세히 묘사해줘.",
  "거울에 비친 네 얼굴 — 머리카락 색, 눈 색, 체형까지 짧게 정리해줘.",
  "금발이 정말 예쁘다. 그 푸른 눈도… 네 외모를 한번 더 묘사해줘.",
  "전투 준비해. 네 외모 특징(머리·눈·체형)만 bullet 없이 서술해.",
  "렌이 ${charName}의 머리색과 눈색을 확인하며 말했다. \"색이 맞는지 봐줄래?\" — 이 상황으로 서술해.",
];

function scanAppearanceViolations(
  text: string,
  charName: string,
  policy: VisualAppearancePolicy
): string[] {
  const hits: string[] = [];
  const t = text;

  const hairWrong =
    policy.hair === "silver"
      ? [
          { re: /금발/g, label: "wrong_hair_금발" },
          { re: /(?:밝은|연)?금(?:색|빛)\s*머리/g, label: "wrong_hair_금색머리" },
          { re: /(?:blonde?|golden\s*hair)/gi, label: "wrong_hair_blonde_en" },
        ]
      : policy.hair === "blonde"
        ? [
            { re: /은발/g, label: "wrong_hair_은발" },
            { re: /(?:silver|platinum)\s*hair/gi, label: "wrong_hair_silver_en" },
          ]
        : [];

  for (const { re, label } of hairWrong) {
    if (re.test(t)) hits.push(label);
  }

  const expectsGoldEyes =
    policy.eyes === "gold" ||
    /금안|금빛\s*눈|황금\s*(?:눈|눈동자)|golden\s*eyes/i.test(policy.body ?? "");

  if (expectsGoldEyes) {
    const eyeWrong = [
      { re: /(?:푸른|파란|하늘(?:색)?)\s*(?:눈|눈동자|홍책)/g, label: "wrong_eye_blue_ko" },
      { re: /blue\s*eyes?/gi, label: "wrong_eye_blue_en" },
      { re: /(?:보라|자주|보랏)(?:색|빛)?\s*(?:눈|눈동자)/g, label: "wrong_eye_purple_ko" },
    ];
    for (const { re, label } of eyeWrong) {
      if (re.test(t)) hits.push(label);
    }
  }

  if (policy.eyes === "blue") {
    if (/(?:금(?:색|빛)|황금)\s*(?:눈|눈동자)|golden\s*eyes?/gi.test(t)) hits.push("wrong_eye_gold");
  }

  // Correct traits — sanity check model mentioned appearance at all on probe turns
  if (policy.hair === "silver" && !/은발|은빛|silver|platinum/i.test(t)) {
    hits.push("missing_expected_silver_hair");
  }
  if (expectsGoldEyes && !/금(?:안|빛|색)|황금|golden/i.test(t)) {
    hits.push("missing_expected_gold_eyes");
  }

  return [...new Set(hits)];
}

async function loadChar17Fixture() {
  const { getDb } = await import("../src/lib/db");
  const { loadCharacterChunks } = await import("../src/lib/characterChunks");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const { extractVisualAppearancePolicyFromChunks } = await import("../src/lib/visualAnchor");

  const row = getDb().prepare("SELECT * FROM characters WHERE id=17").get() as import("../src/lib/characterChunks").CharacterSettingRow;
  if (!row) throw new Error("character 17 not found");

  const chunks = loadCharacterChunks(row);
  const charName = row.name;
  const policy = extractVisualAppearancePolicyFromChunks(chunks, charName, { personaName: PERSONA });

  return {
    charName,
    chunks,
    policy,
    personaDisplayName: PERSONA,
    userPersona: formatSelectedPersonaForPrompt(PERSONA, "other", "20대. 반말 구어체."),
    userNote: formatUserNoteForPrompt(""),
    longTermMemory: "",
    memoryMeta: formatMemoryMetaForPrompt(
      parseMemoryMeta(JSON.stringify({ affection: 55, trust: 50 }))
    ),
    nsfw: true,
    gender: (row.gender as "male" | "female" | "other") ?? "male",
    userPersonaGender: "other" as const,
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 1800,
    genres: ["현대/일상"] as import("../src/lib/characterGenres").CharacterGenre[],
  };
}

async function runProbe(
  condition: Condition,
  model_id: string,
  completed_turns: number,
  turn_index: number,
  shortTermHistory: { role: "user" | "assistant"; content: string }[],
  currentUserMessage: string,
  fixture: Awaited<ReturnType<typeof loadChar17Fixture>>
): Promise<Row> {
  const { buildContext } = await import("../src/services/contextBuilder");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { visibleAssistantDisplayCharCount } = await import("../src/lib/chatDisplayLength");

  const built = buildContext({
    charName: fixture.charName,
    personaDisplayName: fixture.personaDisplayName,
    chunks: fixture.chunks,
    userNickname: fixture.personaDisplayName,
    userPersona: fixture.userPersona,
    userNote: fixture.userNote,
    longTermMemory: fixture.longTermMemory,
    memoryMeta: fixture.memoryMeta,
    shortTermHistory,
    currentUserMessage,
    nsfw: fixture.nsfw,
    gender: fixture.gender,
    userPersonaGender: fixture.userPersonaGender,
    userImpersonation: fixture.userImpersonation,
    novelModeEnabled: fixture.novelModeEnabled,
    targetResponseChars: fixture.targetResponseChars,
    completedTurns: completed_turns,
    genres: fixture.genres,
    modelId: model_id,
    provider: "openrouter",
    promptDumpSource: "audit",
    promptDumpDetail: `visual-anchor-${condition}-t${completed_turns}`,
  });

  const sections = built.meta.trackedSections ?? [];
  const removeId = condition === "MINUS_VISUAL_ANCHOR" ? "visual-appearance-anchor" : null;
  const system = rebuildSystemWithoutSection(sections, removeId);
  const anchor_tokens = sectionTokens(sections, "visual-appearance-anchor");

  const historyForApi = built.history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const result = await callOpenRouterAdult(
    system,
    historyForApi,
    model_id,
    fixture.targetResponseChars,
    { charName: fixture.charName, personaName: fixture.personaDisplayName },
    { chargeTurnBudget: false, requestKind: `visual-anchor-${condition}-t${completed_turns}` }
  );

  const violations = scanAppearanceViolations(result.text, fixture.charName, fixture.policy);

  return {
    condition,
    completed_turns,
    turn_index,
    model_id,
    violations,
    violation_count: violations.length,
    output_chars: visibleAssistantDisplayCharCount(result.text),
    output_preview: result.text.slice(0, 280).replace(/\s+/g, " "),
    anchor_tokens,
    timestamp: new Date().toISOString(),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const modelArg = args.find((a) => a.startsWith("--model="));
  const model_id =
    modelArg?.slice("--model=".length) ??
    process.env.OPENROUTER_MODEL?.trim() ??
    DEFAULT_MODEL;

  const fixture = await loadChar17Fixture();
  const poisoned = buildPoisonedHistory(fixture.charName);

  const outDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const logPath = path.join(outDir, `visual-anchor-regression-${stamp}.jsonl`);
  const reportPath = path.join(outDir, `visual-anchor-regression-${stamp}.md`);

  console.log("=== Visual Anchor Regression ===");
  console.log("Character:", fixture.charName, "(id=17)");
  console.log("Policy:", fixture.policy);
  console.log("Model:", model_id);
  console.log("Log:", logPath);

  const rows: Row[] = [];
  const conditions: Condition[] = ["BASELINE", "MINUS_VISUAL_ANCHOR"];

  // Phase A — single-shot at late turns with poisoned history
  for (const condition of conditions) {
    for (const completed_turns of TURNS) {
      const probe =
        VISUAL_PROBE_MSGS[2].replace("${charName}", fixture.charName) ??
        VISUAL_PROBE_MSGS[2];
      console.log(`\n→ ${condition} poisoned t=${completed_turns} …`);
      const row = await runProbe(
        condition,
        model_id,
        completed_turns,
        0,
        poisoned,
        probe,
        fixture
      );
      rows.push(row);
      fs.appendFileSync(logPath, `${JSON.stringify(row)}\n`, "utf8");
      console.log(row);
    }
  }

  // Phase B — sequential 5 turns, poisoned history + live accumulation at t=8+
  for (const condition of conditions) {
    let history = [...poisoned];
    for (let i = 0; i < SEQUENTIAL_TURNS; i++) {
      const completed_turns = 8 + i;
      const userMsg =
        i < VISUAL_PROBE_MSGS.length
          ? VISUAL_PROBE_MSGS[i].replace("${charName}", fixture.charName)
          : VISUAL_PROBE_MSGS[0];
      console.log(`\n→ ${condition} sequential turn ${i + 1} completed_turns=${completed_turns} …`);
      const row = await runProbe(
        condition,
        model_id,
        completed_turns,
        i + 1,
        history,
        userMsg,
        fixture
      );
      rows.push(row);
      fs.appendFileSync(logPath, `${JSON.stringify(row)}\n`, "utf8");
      console.log(row);

      history = [
        ...history,
        { role: "user" as const, content: userMsg },
        { role: "assistant" as const, content: row.output_preview },
      ];
    }
  }

  const anchorTok = rows.find((r) => r.anchor_tokens > 0)?.anchor_tokens ?? 0;

  function summarize(condition: Condition) {
    const subset = rows.filter((r) => r.condition === condition);
    const wrongOnly = (v: string[]) =>
      v.filter((x) => x.startsWith("wrong_"));
    const totalWrong = subset.reduce(
      (n, r) => n + wrongOnly(r.violations).length,
      0
    );
    const rowsWithWrong = subset.filter((r) => wrongOnly(r.violations).length > 0);
    return {
      condition,
      probes: subset.length,
      total_wrong_hits: totalWrong,
      rows_with_wrong: rowsWithWrong.length,
      late_turn_wrong: subset
        .filter((r) => r.completed_turns >= 8)
        .filter((r) => wrongOnly(r.violations).length > 0).length,
    };
  }

  const baselineSum = summarize("BASELINE");
  const minusSum = summarize("MINUS_VISUAL_ANCHOR");

  const regression =
    minusSum.total_wrong_hits > baselineSum.total_wrong_hits ||
    minusSum.late_turn_wrong > baselineSum.late_turn_wrong;

  const md = [
    "# Visual-appearance-anchor regression",
    "",
    `- Character: ${fixture.charName} (id=17)`,
    `- Model: ${model_id}`,
    `- Anchor section tokens: **${anchorTok}**`,
    `- Policy: ${JSON.stringify(fixture.policy)}`,
    "",
    "## Summary",
    "",
    "| Condition | Probes | Wrong-color hits | Rows w/ wrong | Late-turn (t≥8) w/ wrong |",
    "|-----------|--------|------------------|---------------|---------------------------|",
    `| BASELINE | ${baselineSum.probes} | ${baselineSum.total_wrong_hits} | ${baselineSum.rows_with_wrong} | ${baselineSum.late_turn_wrong} |`,
    `| MINUS_VISUAL_ANCHOR | ${minusSum.probes} | ${minusSum.total_wrong_hits} | ${minusSum.rows_with_wrong} | ${minusSum.late_turn_wrong} |`,
    "",
    `**Regression signal (minus worse than baseline):** ${regression ? "YES" : "NO"}`,
    "",
    "## Recommendation",
    regression
      ? "KEEP anchor (or shrink to hair/eye only) — removal increased wrong-color hits."
      : `REMOVE anchor — saves ~${anchorTok} tokens; no appearance regression vs baseline in this audit.`,
    "",
    "## Detail",
    "",
    ...rows.map(
      (r) =>
        `- ${r.condition} t=${r.completed_turns} seq=${r.turn_index}: violations=${r.violations.join(", ") || "none"} · ${r.output_preview.slice(0, 120)}…`
    ),
  ].join("\n");

  fs.writeFileSync(reportPath, md, "utf8");
  console.log("\n── Summary ──");
  console.log(baselineSum);
  console.log(minusSum);
  console.log("Regression (minus worse):", regression);
  console.log("Report:", reportPath);
  console.log("Token savings if removed:", anchorTok);

  if (regression) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
