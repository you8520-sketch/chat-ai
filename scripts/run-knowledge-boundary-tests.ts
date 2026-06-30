/**
 * Knowledge boundary live API tests (Leon chat 39 · DeepSeek v4).
 * Tests 1–4 only (test 5 = 20-turn manual).
 *
 * Usage: npx tsx scripts/run-knowledge-boundary-tests.ts [--chat-id=39]
 */
import fs from "fs";
import path from "path";
import Module from "module";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

type Verdict = "PASS" | "FAIL" | "WARN";

type TestCase = {
  id: string;
  name: string;
  userMessage: string;
  failIf: RegExp[];
  passIf?: RegExp[];
  notes?: string;
};

const TESTS: TestCase[] = [
  {
    id: "test1",
    name: "회귀 — 유저: 우리 전에 만난 적 있었지?",
    userMessage: "우리 전에 만난 적 있었지?",
    failIf: [
      /두\s*번(?:째)?\s*삶/i,
      /회귀/,
      /전생/,
      /past\s*life/i,
      /third\s*regression/i,
      /지난\s*(?:두\s*번|이\s*전)\s*(?:의\s*)?(?:삶|번)/,
      /기억(?:하고|해)\s*있(?:었|어)/,
    ],
    passIf: [/기시감|데자뷔|d[ée]j[àa]/i, /기억(?:이\s*)?(?:나지\s*않|없|못)|처음\s*(?:보|만)/],
    notes: "정상: 데자뷔·기억 없음. 실패: 회귀/과거 생 언급.",
  },
  {
    id: "test2",
    name: "미래 — 유저: 내일 황태자가 죽을 거야.",
    userMessage: "내일 황태자가 죽을 거야.",
    failIf: [
      /알고\s*있(?:었|다)/,
      /예견/,
      /이미\s*(?:알|들)/,
      /knew\s/i,
      /운명(?:대로|처럼)/,
    ],
    passIf: [/무슨\s*(?:소리|말)|뭐라|말도\s*안|터무니|황맹|그게\s*무슨/],
    notes: "정상: 부정·혼란. 실패: 이미 알고 있었다.",
  },
  {
    id: "test3",
    name: "세계관-only — 중립 유저, PLAYER/회귀 선제 언급 금지",
    userMessage: "…오늘 테라스 바람이 시원하네.",
    failIf: [
      /(?:3|세)\s*번째\s*회귀/,
      /회귀(?:했|한|를)/,
      /현대(?:인|에서)/,
      /빙의/,
      /교통\s*사고/,
      /두\s*번(?:이나)?\s*실패/,
      /NEET/,
      /세렌티아.*왕족.*회귀/,
    ],
    notes: "설정-only 정보를 레온이 먼저 말하면 실패.",
  },
  {
    id: "test4",
    name: "NPC/유저 비밀 — 렌의 숨겨진 마력",
    userMessage: "…너도 알고 있었어? 내 몸속에 숨겨진 마력 말이야.",
    failIf: [
      /(?:알고\s*있(?:었|다)|알(?:았|아)\s*있)/,
      /강대한\s*마력.*(?:알|느)/,
      /숨겨(?:진|둔)\s*마력.*(?:알|느|본)/,
      /체내.*마력.*(?:알|느)/,
      /처음\s*부터\s*(?:알|느)/,
    ],
    passIf: [/모르|몰랐|무슨\s*(?:소리|말)|처음\s*듣|비밀.*(?:모르|몰)/],
    notes: "유저 페르소나 비밀 — 레온은 모름.",
  },
];

function stripForAnalysis(text: string): string {
  return text
    .replace(/<<<STATUS[\s\S]*$/i, "")
    .replace(/📅[\s\S]*$/m, "")
    .trim();
}

function scoreTest(test: TestCase, raw: string): { verdict: Verdict; reasons: string[] } {
  const text = stripForAnalysis(raw);
  const reasons: string[] = [];
  let fail = false;

  for (const re of test.failIf) {
    if (re.test(text)) {
      fail = true;
      const m = text.match(re);
      reasons.push(`FAIL pattern ${re}: …${m?.[0] ?? ""}…`);
    }
  }

  if (fail) return { verdict: "FAIL", reasons };

  if (test.passIf?.length) {
    const anyPass = test.passIf.some((re) => re.test(text));
    if (anyPass) {
      reasons.push("PASS signal matched");
      return { verdict: "PASS", reasons };
    }
    return { verdict: "WARN", reasons: ["No fail pattern, but no explicit pass signal — review manually"] };
  }

  reasons.push("No fail pattern matched");
  return { verdict: "PASS", reasons };
}

async function buildFixture(chatId: number, userMessage: string) {
  const { loadFromDb } = await import("./dump-system-prompt");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } = await import("../src/lib/chatModels");

  const db = await loadFromDb({
    chatId,
    provider: "openrouter",
    modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  });

  const built = buildContext({
    charName: db.charName,
    chunks: db.chunks,
    userNickname: db.userNickname,
    userPersona: db.userPersonaPrompt,
    userNote: db.userNotePrompt,
    longTermMemory: db.longTermMemory,
    memoryMeta: db.memoryMeta,
    shortTermHistory: [],
    currentUserMessage: userMessage,
    nsfw: db.nsfw,
    gender: db.gender,
    assetTags: db.assetTags,
    completedTurns: db.completedTurns,
    userPersonaGender: db.userPersonaGender,
    provider: "openrouter",
    genres: db.genres,
    userImpersonation: db.userImpersonation,
    novelModeEnabled: db.novelModeEnabled,
    personaDisplayName: db.personaDisplayName,
    targetResponseChars: db.targetResponseChars,
    modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  });

  return { db, built, modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL };
}

async function main() {
  const chatId = Number(process.argv.find((a) => a.startsWith("--chat-id="))?.slice(10) ?? 39);

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY required");
    process.exit(1);
  }

  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { visibleAssistantDisplayCharCount } = await import("../src/lib/chatDisplayLength");

  const results: Record<string, unknown>[] = [];
  const lines: string[] = [
    `Knowledge boundary API tests — chat ${chatId} — ${new Date().toISOString()}`,
    "",
  ];

  for (const test of TESTS) {
    console.log(`\n=== ${test.id}: ${test.name} ===`);
    console.log(`User: ${test.userMessage}`);

    const { db, built, modelId } = await buildFixture(chatId, test.userMessage);
    const result = await callOpenRouterAdult(
      built.systemPrompt,
      [{ role: "user", content: test.userMessage }],
      modelId,
      db.targetResponseChars,
      { charName: db.charName, systemSplit: built.openRouterSystemSplit },
      { chargeTurnBudget: false, requestKind: `kb-${test.id}` }
    );

    const prose = stripForAnalysis(result.text);
    const { verdict, reasons } = scoreTest(test, result.text);
    const chars = visibleAssistantDisplayCharCount(result.text);

    console.log(`Verdict: ${verdict} (${chars} chars, ${result.usage.outputTokens} tok)`);
    for (const r of reasons) console.log(`  ${r}`);
    console.log(`---\n${prose.slice(0, 800)}${prose.length > 800 ? "…" : ""}`);

    lines.push(`## ${test.id} — ${test.name}`);
    lines.push(`User: ${test.userMessage}`);
    lines.push(`Verdict: **${verdict}** (${chars} chars)`);
    lines.push(...reasons.map((r) => `- ${r}`));
    lines.push("");
    lines.push("```");
    lines.push(prose);
    lines.push("```");
    lines.push("");

    results.push({ id: test.id, verdict, chars, reasons, prose });
  }

  const summary = {
    pass: results.filter((r) => r.verdict === "PASS").length,
    warn: results.filter((r) => r.verdict === "WARN").length,
    fail: results.filter((r) => r.verdict === "FAIL").length,
  };

  lines.unshift(
    `Summary: PASS ${summary.pass} · WARN ${summary.warn} · FAIL ${summary.fail}`,
    ""
  );

  const outPath = path.join("output", "knowledge-boundary-api-test-report.md");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`\n=== SUMMARY: PASS ${summary.pass} WARN ${summary.warn} FAIL ${summary.fail} ===`);
  console.log(`Report: ${outPath}`);

  if (summary.fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
