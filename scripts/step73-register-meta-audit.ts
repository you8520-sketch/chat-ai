/**
 * Step 7.3 — Dialogue Register & Meta Narration Audit
 * Usage:
 *   npm.cmd exec tsx -- scripts/step73-register-meta-audit.ts
 *   npm.cmd exec tsx -- scripts/step73-register-meta-audit.ts --generate
 *   npm.cmd exec tsx -- scripts/step73-register-meta-audit.ts --report
 */
import "./lib/server-only-mock";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import type { CharacterGenre } from "@/lib/characterGenres";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { resolveDeepSeekTemperatureForTarget } from "@/lib/openRouterClient";
import {
  buildProductionContextForScene,
  type ProductionValidationScene,
} from "./lib/production-prompt-fixture";
import {
  REGISTER_AUDIT_SOURCES,
  collectRegisterKeywordHits,
  evaluateStep73Sample,
  type RegisterAuditKeyword,
  type Step73SampleVerdict,
} from "@/lib/registerMetaAudit";
import { SPEECH_METADATA_INVISIBLE_RULE } from "@/lib/speechMetadataPolicy";
import { PROSE_STYLE_SECTION } from "@/lib/advancedProseNsfwGuidelines";
import { buildNarrativeStyleLayer } from "@/lib/narrativeStyle";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT_JSON = join(process.cwd(), "output", "step73-rp-validation.json");
const OUT_MD = join(process.cwd(), "output", "step73-register-meta-audit.md");

const KEYWORDS: RegisterAuditKeyword[] = [
  "존댓말",
  "공손",
  "격식",
  "귀족",
  "기사",
  "절제",
  "품위",
  "formal",
  "polite",
  "noble",
  "court",
  "historical",
  "classical",
  "하오",
  "이오",
  "합니다",
  "register",
];

const SOURCE_FILES = [
  "src/lib/speechMetadataPolicy.ts",
  "src/lib/advancedProseNsfwGuidelines.ts",
  "src/lib/narrativeStyle.ts",
  "src/lib/speechCreatorFields.ts",
  "src/lib/speechLock/patterns.ts",
  "src/lib/speechLock/deriveProfile.ts",
  "src/lib/speechLock/validator.ts",
  "src/lib/userPersonas.ts",
  "src/lib/narrativeRules.ts",
  "src/lib/openRouterProsePolicy.ts",
];

type Step73Scene = ProductionValidationScene & {
  bucket: "daily" | "romance" | "fantasy" | "wuxia" | "action" | "horror";
};

const STEP73_SCENES: Step73Scene[] = [
  ...([0, 1, 2, 3, 4] as const).map((i) => ({
    id: `daily-${i}`,
    bucket: "daily" as const,
    label: "Daily",
    genres: ["현대/일상"] as CharacterGenre[],
    currentUserMessage: [
      "민수: 오늘도 커피 맛있네. 요즘 바쁘지?",
      "민수: 창가 자리 비었네. 앉아도 될까?",
      "민수: …요즘 날씨 참 좋다. 산책이라도 할까?",
      "민수: 알바 끝나면 같이 밥 먹을래?",
      "민수: 이 케이크, 너희 가게 시그니처 맞지?",
    ][i]!,
    shortTermHistory: [
      { role: "user" as const, content: "아메리카노 하나 주세요." },
      { role: "assistant" as const, content: `서연은 메뉴판에서 시선을 들어 올렸다.\n\n"네, 잠시만요."` },
    ],
  })),
  ...([0, 1, 2, 3, 4] as const).map((i) => ({
    id: `romance-${i}`,
    bucket: "romance" as const,
    label: "Romance",
    genres: ["로맨스"] as CharacterGenre[],
    currentUserMessage: [
      "현우: …우산, 같이 쓸래?",
      "현우: 오늘 밤, 잠깐만 같이 걸을래?",
      "현우: …손, 괜찮아?",
      "현우: 너 요즘 왜 그렇게 멀리 있는 것 같아?",
      "현우: 비 그치면… 커피라도 마실래?",
    ][i]!,
    shortTermHistory: [
      { role: "user" as const, content: "비가 갑자기 내리네." },
      { role: "assistant" as const, content: `지우는 현관 처마 아래 서서 하늘을 올려다봤다.\n\n"…갑자기 오네."` },
    ],
  })),
  ...([0, 1, 2, 3, 4] as const).map((i) => ({
    id: `fantasy-${i}`,
    bucket: "fantasy" as const,
    label: "Fantasy/SF",
    genres: ["판타지/SF"] as CharacterGenre[],
    currentUserMessage: [
      "…저 문양, 전설에서 본 것 같은데.",
      "…마법진이 갑자기 빛나기 시작했어.",
      "…저 수정, 손대도 될까?",
      "…성벽 너머에서 뭔가 움직였어.",
      "…계약의 문구, 다시 읽어봐야 할 것 같아.",
    ][i]!,
    shortTermHistory: [
      { role: "user" as const, content: "고대 유적 입구에 도착했다." },
      { role: "assistant" as const, content: `백하율은 낡은 석문 위의 문양을 가리켰다.\n\n"…이건 기록과 다릅니다."` },
    ],
  })),
  ...([0, 1, 2, 3, 4] as const).map((i) => ({
    id: `wuxia-${i}`,
    bucket: "wuxia" as const,
    label: "Wuxia/Historical",
    genres: ["무협/시대극"] as CharacterGenre[],
    currentUserMessage: [
      "…문 앞에 서 있는 자, 누구냐?",
      "…검을 거두고 말을 하거라.",
      "…주점에서 들은 소문, 사실이오?",
      "…사형, 이 길이 맞소?",
      "…적이 성 아래까지 왔나?",
    ][i]!,
    shortTermHistory: [
      { role: "user" as const, content: "산길을 따라 올라왔다." },
      { role: "assistant" as const, content: `그는 검집에 손을 얹은 채 돌아보았다.\n\n"…늦었구나."` },
    ],
  })),
  ...([0, 1, 2, 3, 4] as const).map((i) => ({
    id: `action-${i}`,
    bucket: "action" as const,
    label: "Action",
    genres: ["코믹/액션"] as CharacterGenre[],
    currentUserMessage: [
      "레온, 적이 검을 들어 올린다. 어떻게 대응할 것인가?",
      "레온, 적이 좌측으로 돌진한다!",
      "레온, 성벽 가장자리까지 밀렸어!",
      "레온, 적 둘이 동시에 달려든다!",
      "레온, 지금이야 — 반격할 타이밍이야!",
    ][i]!,
    shortTermHistory: [
      { role: "user" as const, content: "성벽 위에서 적을 발견했다." },
      { role: "assistant" as const, content: `레온은 검 손잡이를 조여 쥐었다.\n\n"…왔군."` },
    ],
  })),
  ...([0, 1, 2, 3, 4] as const).map((i) => ({
    id: `horror-${i}`,
    bucket: "horror" as const,
    label: "Horror",
    genres: ["공포/추리"] as CharacterGenre[],
    currentUserMessage: [
      "…방금 소리, 들었어? 뭔가 따라오는 것 같아.",
      "…저쪽 골목, 불빛이 방금 꺼졌어.",
      "…발소리야. 우리 뒤인 것 같아.",
      "…창문 밖에 누가 서 있는 것 같아.",
      "…핸드폰 신호가 끊겼어. 여기서 나가자.",
    ][i]!,
    shortTermHistory: [
      { role: "user" as const, content: "오늘도 밤산책 갈래? 거리가 좀 이상한 것 같아." },
      {
        role: "assistant" as const,
        content: `백하율은 창밖의 어두운 거리를 잠시 바라본 뒤, 조용히 고개를 끄덕였다.\n\n"…이상하다고 느끼셨군요."`,
      },
    ],
  })),
];

const STEP7_DELETED_META_REGISTER = [
  {
    id: "OR-NO-META-WRITING",
    step43Owner: "OpenRouter TOP (removed Step 7)",
    step73Owner: "[NO STAGE DIRECTIONS] + [SPEECH METADATA — INVISIBLE INSTRUCTIONS]",
    regression: "Step 7 removed OpenRouter meta-writing line; speech-specific ban weakened when SPEECH-METADATA-COMPRESS merged block to 1 line",
    fix: "Restored SPEECH_METADATA_INVISIBLE_RULE forbidden patterns (Step 7.3)",
  },
  {
    id: "SPEECH-METADATA-COMPRESS",
    step43Owner: "SPEECH METADATA — INVISIBLE INSTRUCTIONS (full block)",
    step73Owner: "SPEECH METADATA — INVISIBLE INSTRUCTIONS",
    regression: "Compressed to single line — lost honorific-level ban + example forbidden phrases",
    fix: "Restored full block without adding new policy section",
  },
  {
    id: "REGISTER label collision",
    step43Owner: "[REGISTER] in PROSE STYLE (narration -다체)",
    step73Owner: "[NARRATION REGISTER]",
    regression: "Same label as dialogue register confused models",
    fix: "Renamed header; cross-ref SPEECH METADATA in prose line",
  },
  {
    id: "Genre dialogue register",
    step43Owner: "genre_tone (atmosphere only)",
    step73Owner: "[genre_tone] + dialogue register hints",
    regression: "No genre-based dialogue register → archaic leak in fantasy/SF",
    fix: "Extended existing GENRE_TONE_HINTS (not new section)",
  },
] as const;

function readSources(): Map<string, string> {
  const m = new Map<string, string>();
  for (const rel of SOURCE_FILES) {
    const p = join(process.cwd(), rel);
    if (existsSync(p)) m.set(rel, readFileSync(p, "utf8"));
  }
  return m;
}

async function buildProductionPrompt(): Promise<string> {
  const { buildContext } = await import("@/services/contextBuilder");
  const scene = STEP73_SCENES[0]!;
  return buildContext(buildProductionContextForScene(scene)).systemPrompt;
}

function phaseA(productionPrompt: string, sources: Map<string, string>): string[] {
  const lines: string[] = ["## Phase A — Register Audit", ""];
  lines.push("### Keyword hits (production system prompt)");
  lines.push("| keyword | hits |");
  lines.push("|---------|------|");
  for (const kw of KEYWORDS) {
    lines.push(`| ${kw} | ${collectRegisterKeywordHits(productionPrompt, kw)} |`);
  }
  lines.push("");
  lines.push("### Register rule inventory");
  lines.push("| file | owner | impact | duplicate | snippet |");
  lines.push("|------|-------|--------|-----------|---------|");
  for (const row of REGISTER_AUDIT_SOURCES) {
    lines.push(
      `| ${row.file} | ${row.owner} | ${row.impact} | ${row.duplicateOf ?? "—"} | ${row.snippet.replace(/\|/g, "/").slice(0, 80)} |`
    );
  }
  lines.push("");
  lines.push("### Source file keyword scan");
  lines.push("| file | keyword hits (sum) |");
  lines.push("|------|-------------------|");
  for (const [file, text] of sources) {
    const sum = KEYWORDS.reduce((n, kw) => n + collectRegisterKeywordHits(text, kw), 0);
    if (sum > 0) lines.push(`| ${file} | ${sum} |`);
  }
  return lines;
}

function phaseB(): string[] {
  return [
    "## Phase B — Register Policy (existing rules only)",
    "",
    "- **Modern / Western fantasy / SF / apocalypse (인외·판타지/SF·현대*)**: dialogue `합니다·입니다·그렇습니다`; no `하오·이오·소이다·하였소`.",
    "- **동양 / wuxia / historical (`무협/시대극`)**: `하오·이오` allowed; one register per character per turn.",
    "- **Per-character consistency**: no mixing `합니다↔하오↔해요↔이오` within one turn.",
    "",
    "Owners: `[SPEECH METADATA — INVISIBLE INSTRUCTIONS]`, `[genre_tone]` in `narrativeStyle.ts`, character speech metadata chunks.",
    "",
  ];
}

function phaseC(): string[] {
  return [
    "## Phase C — Meta Narration Audit",
    "",
    "Narration must not explain speech register. Forbidden examples (now in SPEECH_METADATA_INVISIBLE_RULE):",
    "",
    "- `해요체로 바뀌었다`",
    "- `존댓말을 사용`",
    "- `말투가 공손해졌다`",
    "- `반말로 말했다`",
    "",
    "Show register only via dialogue, action, expression, reaction.",
    "",
    `[SPEECH METADATA — INVISIBLE INSTRUCTIONS] (${SPEECH_METADATA_INVISIBLE_RULE.length} chars):`,
    "```",
    SPEECH_METADATA_INVISIBLE_RULE,
    "```",
    "",
    `[NARRATION REGISTER] excerpt:`,
    "```",
    PROSE_STYLE_SECTION.split("\n").slice(0, 4).join("\n"),
    "```",
    "",
  ];
}

function phaseD(): string[] {
  const lines = ["## Phase D — Regression vs Step 4.3 / Step 7", ""];
  lines.push("| deleted/conflict | Step 4.3 owner | Step 7.3 owner | regression | fix |");
  lines.push("|------------------|---------------|----------------|------------|-----|");
  for (const row of STEP7_DELETED_META_REGISTER) {
    lines.push(
      `| ${row.id} | ${row.step43Owner} | ${row.step73Owner} | ${row.regression} | ${row.fix} |`
    );
  }
  return lines;
}

function phaseE(results: { id: string; genres: CharacterGenre[]; text: string; verdict: Step73SampleVerdict }[]): string[] {
  const lines = ["## Phase E — Validation (30 RP samples)", ""];
  lines.push(
    "| id | register | meta | narr explains | speech | voice | overall | notes |"
  );
  lines.push(
    "|----|----------|------|---------------|--------|-------|---------|-------|"
  );
  for (const r of results) {
    const v = r.verdict;
    const overall =
      v.registerSwitching === "PASS" &&
      v.metaNarration === "PASS" &&
      v.narrationExplainingDialogue === "PASS" &&
      v.speechConsistency === "PASS" &&
      v.characterVoiceConsistency === "PASS"
        ? "PASS"
        : "FAIL";
    lines.push(
      `| ${r.id} | ${v.registerSwitching} | ${v.metaNarration} | ${v.narrationExplainingDialogue} | ${v.speechConsistency} | ${v.characterVoiceConsistency} | ${overall} | ${v.notes.join("; ").slice(0, 80) || "—"} |`
    );
  }
  const pass = results.filter(
    (r) =>
      r.verdict.registerSwitching === "PASS" &&
      r.verdict.metaNarration === "PASS" &&
      r.verdict.speechConsistency === "PASS"
  ).length;
  lines.push("", `**Summary:** ${pass}/${results.length} samples pass register+meta+speech checks.`, "");
  return lines;
}

async function generateSample(
  scene: Step73Scene,
  callOpenRouterCompletion: typeof import("@/lib/openRouterCompletion").callOpenRouterCompletion
) {
  const { buildContext } = await import("@/services/contextBuilder");
  const built = buildContext(buildProductionContextForScene(scene));
  const history = built.history.slice(0, -1);
  const last = built.history[built.history.length - 1];
  const userContent = last?.role === "user" ? last.content : scene.currentUserMessage;
  const model = OPENROUTER_DEEPSEEK_V4_PRO_MODEL;
  const temperature = resolveDeepSeekTemperatureForTarget(3200);

  let text = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await callOpenRouterCompletion({
        system: built.systemPrompt,
        history: [...history, { role: "user", content: userContent }],
        model,
        temperature,
        maxTokens: 4096,
        requestKind: "step73-register-meta-audit",
      });
      text = res.text.trim();
      if (text.length >= 600) break;
    } catch (err) {
      if (attempt === 4) throw err;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  if (text.length < 300) {
    throw new Error(`${scene.id}: completion too short (${text.length})`);
  }
  return { id: scene.id, genres: scene.genres, userMessage: userContent, text };
}

async function runGeneration() {
  const { callOpenRouterCompletion } = await import("@/lib/openRouterCompletion");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : STEP73_SCENES.length;
  const scenes = STEP73_SCENES.slice(0, limit);
  const out: Awaited<ReturnType<typeof generateSample>>[] = [];
  for (const scene of scenes) {
    console.log(`Generating ${scene.id}…`);
    out.push(await generateSample(scene, callOpenRouterCompletion));
  }
  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), samples: out }, null, 2));
  console.log(`Wrote ${OUT_JSON}`);
  return out;
}

function loadSamplesFromJson(): Awaited<ReturnType<typeof generateSample>>[] {
  if (!existsSync(OUT_JSON)) return [];
  const raw = JSON.parse(readFileSync(OUT_JSON, "utf8")) as { samples?: Awaited<ReturnType<typeof generateSample>>[] };
  return raw.samples ?? [];
}

async function main() {
  const doGenerate = process.argv.includes("--generate");
  const sources = readSources();
  const productionPrompt = await buildProductionPrompt();

  let samples = loadSamplesFromJson();
  if (doGenerate || samples.length === 0) {
    if (doGenerate) {
      samples = await runGeneration();
    }
  }

  const evaluated = samples.map((s) => ({
    ...s,
    verdict: evaluateStep73Sample(s.id, s.text, s.genres),
  }));

  const md = [
    "# Step 7.3 — Dialogue Register & Meta Narration Audit",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    ...phaseA(productionPrompt, sources),
    ...phaseB(),
    ...phaseC(),
    ...phaseD(),
    ...(evaluated.length > 0 ? phaseE(evaluated) : ["## Phase E", "", "_No RP samples — run with `--generate`._", ""]),
    "",
    "### Genre layer sample (판타지/SF)",
    "```",
    buildNarrativeStyleLayer({ genres: ["판타지/SF"], mode: "standard" }),
    "```",
  ].join("\n");

  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  writeFileSync(OUT_MD, md);
  console.log(`Report: ${OUT_MD}`);

  if (evaluated.length > 0) {
    const fail = evaluated.filter(
      (r) =>
        r.verdict.registerSwitching === "FAIL" ||
        r.verdict.metaNarration === "FAIL" ||
        r.verdict.speechConsistency === "FAIL"
    );
    console.log(`Phase E: ${evaluated.length - fail.length}/${evaluated.length} PASS (register+meta+speech)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
