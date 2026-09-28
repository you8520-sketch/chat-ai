/**
 * Creative OOC HTML bench — gpt-5.6-luna vs deepseek-v4-pro-0813
 *
 * Exactly 10 direct CheaperInference calls (5 cases × 2 models, interleaved).
 * Commits rawText + renderable .html under data/creative-ooc-html-bench/.
 * No winner/quality scoring — human review only.
 *
 * Usage:
 *   npx tsx --conditions=react-server scripts/creative-ooc-html-bench.ts
 */
import fs from "fs";
import path from "path";
import Module from "module";
import { loadEnvLocal } from "./load-env-local";
import { benchDirectCreativeOocHtmlCall } from "./creative-ooc-html-bench-lib";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
} from "../src/lib/chatModels";
import {
  buildHtmlFlashSystemPrompt,
  buildHtmlVisualCardFlashUserBlock,
  unwrapHtmlVisualCardInner,
  type HtmlVisualCardFlashContext,
} from "../src/lib/htmlVisualCardRecovery";
import {
  polishHtmlVisualCardInner,
  resolveHtmlFlashPlacement,
  type HtmlVisualCardPolicy,
} from "../src/lib/htmlVisualCardPolicy";
import { extractFencedHtmlBlock } from "../src/lib/chatRichContent";

const origLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: unknown,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return origLoad(request, parent as NodeModule, isMain);
};

loadEnvLocal();
process.env.MOCK_MODE = "false";
process.env.NODE_TEST_CONTEXT = "creative-ooc-html-bench";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const OUT = path.resolve("data/creative-ooc-html-bench");
const CHAR = "레온";
const PERSONA = "렌";

const MODEL_LUNA = CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;
const MODEL_PRO = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;

const FLASH_MODE = {
  oocCreativeBrief: true,
  chatOocExclusive: true,
  htmlOnlyDedicatedTurn: true,
} as const;

const POLICY: HtmlVisualCardPolicy = {
  enabled: true,
  standing: false,
  statusFieldLabels: [],
  policyBlock: "",
};

type CreativeOocCase = {
  id: string;
  label: string;
  ctx: HtmlVisualCardFlashContext;
};

const CASES: CreativeOocCase[] = [
  {
    id: "1_notice",
    label: "간단한 공지 카드",
    ctx: {
      chatId: 0,
      charName: CHAR,
      personaName: PERSONA,
      userMessage:
        "OOC: HTML로 공지 카드 하나만 띄워줘. 제목 '오늘의 일정', 본문 '19:00 정원 미팅 — 지각 금지'.",
      assistantProse: "",
    },
  },
  {
    id: "2_multi_field",
    label: "여러 필드 정보 카드",
    ctx: {
      chatId: 0,
      charName: CHAR,
      personaName: PERSONA,
      userMessage:
        "OOC: [시간] [장소] [속마음] [현재상황] 네 필드 HTML 카드로 만들어줘. 장면: 사무실 복도 21:10, 차분하지만 기대 섞임.",
      assistantProse: "",
      memoryBlock: "정원에서 커프링크스를 받았고, 내일 아침까지 답을 주기로 약속했다.",
    },
  },
  {
    id: "3_long_sections",
    label: "긴 한국어 + 강조/구획",
    ctx: {
      chatId: 0,
      charName: CHAR,
      personaName: PERSONA,
      userMessage:
        "OOC: [일정] [관계] [미해결] 세 섹션 HTML 카드로 자세히 정리해줘. 각 섹션 최소 3문장, 가독성 좋게.",
      assistantProse: "",
      memoryBlock:
        "연회장→정원→사무실 복도 이동. 청혼에 가까운 고백, 커프링크스 수령, 내일 아침 답변 약속.",
      loreBlock: "현대 판타지 IF — 지휘동과 연회장이 공존하는 세계.",
    },
  },
  {
    id: "4_conditional",
    label: "조건부 항목 카드",
    ctx: {
      chatId: 0,
      charName: CHAR,
      personaName: PERSONA,
      userMessage:
        "OOC: HTML 카드 — '참석'이 yes면 시간/장소 표시, no면 '불참 사유'만 표시. 이번 장면은 yes.",
      assistantProse: "",
      userNote: "참석=yes, 시간=22:00, 장소=지휘동 회의실",
    },
  },
  {
    id: "5_special_chars",
    label: "따옴표/특수문자/한글/숫자 혼합",
    ctx: {
      chatId: 0,
      charName: CHAR,
      personaName: PERSONA,
      userMessage:
        "OOC: HTML로 메시지함 mockup — 제목 \"익명 #127\" / 본문 \"'내일 09:30' & <비밀> 50% 확률\" + 🔔",
      assistantProse: "",
    },
  },
];

function modelSlug(modelId: string): string {
  if (modelId === MODEL_LUNA) return "gpt-5.6-luna";
  if (modelId === MODEL_PRO) return "deepseek-v4-pro-0813";
  return modelId.replace(/[^a-z0-9.-]+/gi, "-");
}

function buildPrompts(ctx: HtmlVisualCardFlashContext) {
  const placement = resolveHtmlFlashPlacement(POLICY, {
    userMessage: ctx.userMessage,
    userNote: ctx.userNote,
    userPersona: ctx.userPersona,
    characterSetting: ctx.characterSetting,
  });
  const system = buildHtmlFlashSystemPrompt(POLICY, placement, FLASH_MODE);
  const user = buildHtmlVisualCardFlashUserBlock(ctx, POLICY, placement, FLASH_MODE);
  return { system, user, placement };
}

/** Production parse path — extract inner HTML for renderable artifact (no quality gate). */
function renderableInnerHtml(rawText: string): string {
  if (!rawText.trim()) return "";
  const fenced = extractFencedHtmlBlock(rawText.trim());
  const inner = polishHtmlVisualCardInner(
    unwrapHtmlVisualCardInner(fenced ?? rawText.trim())
  );
  return inner.trim();
}

function wrapRenderableDocument(innerHtml: string, title: string): string {
  if (!innerHtml) {
    return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><title>${title} — empty</title></head>
<body><p>(no renderable HTML extracted from model output)</p></body>
</html>`;
  }
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 16px; color: #222; background: #fafafa; }
  </style>
</head>
<body>
${innerHtml}
</body>
</html>`;
}

async function main() {
  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    console.error("CHEAPER_INFERENCE_API_KEY missing");
    process.exit(2);
  }

  fs.mkdirSync(OUT, { recursive: true });

  const manifest: {
    bench: "creative-ooc-html";
    generatedAt: string;
    provider: "CheaperInference";
    models: string[];
    callCount: number;
    interleave: string;
    productionPath: string;
    flags: Record<string, number | boolean>;
    calls: Array<Record<string, unknown>>;
  } = {
    bench: "creative-ooc-html",
    generatedAt: new Date().toISOString(),
    provider: "CheaperInference",
    models: [MODEL_LUNA, MODEL_PRO],
    callCount: 10,
    interleave: "luna,pro per case (A1 B1 A2 B2 ...)",
    productionPath:
      "buildHtmlFlashSystemPrompt + buildHtmlVisualCardFlashUserBlock (oocCreativeBrief/chatOocExclusive)",
    flags: {
      RETRY: 0,
      PROVIDER_FAILOVER: 0,
      DB_WRITES: 0,
      POINT_CHARGE: 0,
      BENCH_ONLY: true,
      PRODUCTION_ROUTING_CHANGED: false,
    },
    calls: [],
  };

  let callIndex = 0;
  for (const testcase of CASES) {
    const caseDir = path.join(OUT, testcase.id);
    fs.mkdirSync(caseDir, { recursive: true });
    const { system, user } = buildPrompts(testcase.ctx);

    for (const modelId of [MODEL_LUNA, MODEL_PRO]) {
      callIndex += 1;
      const slug = modelSlug(modelId);
      console.log(`[bench] call ${callIndex}/10 case=${testcase.id} model=${slug}`);

      const result = await benchDirectCreativeOocHtmlCall({
        modelId,
        system,
        userContent: user,
      });

      const rawPath = path.join(caseDir, `${slug}.raw.txt`);
      fs.writeFileSync(rawPath, result.rawText || result.error || "", "utf8");

      const inner = renderableInnerHtml(result.rawText);
      const htmlPath = path.join(caseDir, `${slug}.html`);
      fs.writeFileSync(
        htmlPath,
        wrapRenderableDocument(inner, `${testcase.id} — ${slug}`),
        "utf8"
      );

      manifest.calls.push({
        index: callIndex,
        caseId: testcase.id,
        caseLabel: testcase.label,
        modelId,
        modelSlug: slug,
        latencyMs: result.latencyMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        reasoningTokens: result.reasoningTokens,
        finishReason: result.finishReason,
        httpStatus: result.httpStatus,
        empty: result.empty,
        timeout: result.timeout,
        error: result.error,
        outboundThinkingOff: result.outboundThinkingOff,
        outboundReasoningNone: result.outboundReasoningNone,
        rawFile: path.relative(process.cwd(), rawPath),
        htmlFile: path.relative(process.cwd(), htmlPath),
        renderableInnerChars: inner.length,
      });
    }
  }

  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  fs.writeFileSync(
    path.join(OUT, "README.md"),
    `# Creative OOC HTML bench artifacts

Human review only — **no winner or quality scores computed by Cursor**.

- Models: \`gpt-5.6-luna\` vs \`deepseek-v4-pro-0813\` (CheaperInference direct)
- Calls: exactly 10 (5 Creative OOC HTML cases × 2 models, interleaved)
- Production prompts: \`buildHtmlFlashSystemPrompt\` + \`buildHtmlVisualCardFlashUserBlock\` with \`oocCreativeBrief\` / \`chatOocExclusive\`

Each case folder contains \`*.raw.txt\` (model output) and \`*.html\` (browser-openable render).

See \`manifest.json\` for call metadata. No secrets included.
`,
    "utf8"
  );

  console.log(JSON.stringify({ CALLS: 10, OUT, MANIFEST: path.join(OUT, "manifest.json") }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
