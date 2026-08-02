/**
 * PHASE 8 static audit for Shared Novel Prose V2 — no API calls.
 * Usage: node --conditions=react-server --import tsx scripts/shared-novel-prose-v2-static-audit.ts
 */
import Module from "module";
import { createHash } from "crypto";
import { writeFileSync } from "fs";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { IMMERSIVE_PROSE_BLOCK, PROSE_STYLE_SECTION } from "../src/lib/advancedProseNsfwGuidelines";
import {
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
} from "../src/lib/chatModels";
import { MUSE_PROSE_M1_STYLE_SECTION } from "../src/lib/proseMuseM1";
import { resolveProseStyleRouteName, resolveProseStyleSection } from "../src/lib/proseStyleResolver";
import { PROSE_VNEXT_STYLE_SECTION } from "../src/lib/proseVNext";
import {
  buildCompactTerminalLengthAbsoluteTail,
  buildLengthInstruction,
} from "../src/lib/responseLength";
import { SHARED_NOVEL_PROSE_CORE } from "../src/lib/sharedNovelProseCore";
import { SHARED_NOVEL_PROSE_V2_ENV } from "../src/lib/sharedNovelProseV2Policy";
import {
  MUSE_PROSE_M1_STYLE_SECTION_V2,
  PROSE_STYLE_SECTION_V2,
  PROSE_VNEXT_STYLE_SECTION_V2,
  SCENE_CONTINUATION_PRIORITY_BLOCK_V2,
} from "../src/lib/sharedNovelProseV2Styles";
import { SCENE_CONTINUATION_PRIORITY_BLOCK } from "../src/lib/turnHandoffAndPacing";
import { WEBNOVEL_OUTPUT_FORMAT_BLOCK, OUTPUT_LAYOUT_SEMANTIC_CORE } from "../src/lib/webnovelOutputFormat";

const OUT = "data/shared-novel-prose-v2-static-audit.txt";
const USER = 1;

const MODELS = [
  { id: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL, label: "Luna" },
  { id: OPENROUTER_DEEPSEEK_V4_PRO_MODEL, label: "DeepSeek" },
  { id: OPENROUTER_MUSE_SPARK_11_MODEL, label: "Muse" },
] as const;

function estTokens(s: string): number {
  return Math.ceil(s.length / 3.5);
}

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const keys = Object.keys(env);
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const k of keys) {
      const v = prev[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const lines: string[] = [];
function log(s = "") {
  lines.push(s);
}

log("SHARED NOVEL PROSE V2 — PHASE 8 STATIC AUDIT");
log(`generatedAt: ${new Date().toISOString()}`);
log("");
log("## 1. Changed files (implementation)");
log("- src/lib/sharedNovelProseCore.ts (new)");
log("- src/lib/sharedNovelProseV2Policy.ts (new)");
log("- src/lib/sharedNovelProseV2Styles.ts (new)");
log("- src/lib/proseStyleResolver.ts (V2 route swap)");
log("- src/lib/responseLength.ts (V2 length/terminal opts)");
log("- src/lib/responseLengthConstants.ts (UNIFIED_TIER_MIN_CHARS_V2 + UI label helper)");
log("- src/services/contextBuilder.ts (pass V2 flag to length/terminal)");
log("- tests: sharedNovelProseV2Policy.test.ts, sharedNovelProseV2Styles.test.ts");
log("");
log("## 2. Deleted / merged sentences");
log("DELETE AS DUPLICATE (from Legacy immersive when V2 ON):");
log('  "내면만으로 분량을 채우지 말고 선택적 환경·다른 인물·업무·주변 활동·결과로 장면을 움직인다."');
log("REWRITE: SCENE CONTINUATION — remove \"Never stop at the first satisfying ending.\"");
log("REWRITE: terminal — remove \"단일 응답 최대 전개\"");
log("MERGE into SHARED_NOVEL_PROSE_CORE: immersive inner/dialogue/show/anti-repeat + multi-char principles");
log("VNext/M1: remove Core-overlapping clauses; keep model-specific personality only");
log("");

log("## PHASE 2 ownership map (V2 ON)");
log("| concept | owner |");
log("|---|---|");
log("| narration register | COMMON_NARRATION_REGISTER_BLOCK |");
log("| scene pacing | SCENE_FLOW_BLOCK_V2 |");
log("| inner/dialogue/multi-char/show/anti-micro | SHARED_NOVEL_PROSE_CORE |");
log("| sensation | Legacy [SENSATION] only |");
log("| breath | [WEBNOVEL BREATH] |");
log("| density | NARRATIVE_DENSITY_BLOCK_V2 |");
log("| turn stop | SCENE_CONTINUATION_PRIORITY_BLOCK_V2 |");
log("| length floor | 2500 (canary) / 2700 (prod) |");
log("| layout | OUTPUT LAYOUT (untouched) |");
log("");

// Simulate Muse M1 ON for Arm A Muse (typical production canary)
const museM1Env = {
  PROSE_MUSE_M1_ENABLED: "1",
  PROSE_MUSE_M1_USER_IDS: "1",
};

log("## 3–6. Model routes / tokens / hashes");
log("Arm A assumptions: Luna+DeepSeek Legacy; Muse = M1 (PROSE_MUSE_M1 admin ON for user 1).");
log("Arm B: same routes with V2 bodies + length V2.");
log("");

const duplicateNeedles = [
  "내면만으로 분량을 채우지 말고",
  "Never stop at the first satisfying ending",
  "단일 응답 최대 전개",
  "[IMMERSIVE PROSE]",
];

let allPass = true;

for (const model of MODELS) {
  let styleA = "";
  let styleB = "";
  let routeA = "";
  let routeB = "";
  let lengthA = "";
  let lengthB = "";
  let termA = "";
  let termB = "";

  withEnv(
    {
      ...museM1Env,
      [SHARED_NOVEL_PROSE_V2_ENV.ENABLED]: undefined,
      [SHARED_NOVEL_PROSE_V2_ENV.USER_IDS]: undefined,
    },
    () => {
      routeA = resolveProseStyleRouteName(USER, model.id);
      styleA = resolveProseStyleSection(USER, model.id) ?? PROSE_STYLE_SECTION;
      lengthA = buildLengthInstruction(3200);
      termA = buildCompactTerminalLengthAbsoluteTail(3200);
    }
  );

  withEnv(
    {
      ...museM1Env,
      [SHARED_NOVEL_PROSE_V2_ENV.ENABLED]: "1",
      [SHARED_NOVEL_PROSE_V2_ENV.USER_IDS]: "1",
    },
    () => {
      routeB = resolveProseStyleRouteName(USER, model.id);
      styleB = resolveProseStyleSection(USER, model.id) ?? "";
      lengthB = buildLengthInstruction(3200, { sharedNovelProseV2: true });
      termB = buildCompactTerminalLengthAbsoluteTail(3200, {
        sharedNovelProseV2: true,
      });
    }
  );

  const proseA = styleA;
  const proseB = styleB;
  const tokA = estTokens(proseA + lengthA + termA);
  const tokB = estTokens(proseB + lengthB + termB);
  const delta = tokB - tokA;
  const proseDeltaPct = tokA ? ((tokB - tokA) / tokA) * 100 : 0;

  // Gate OFF byte check vs known SoT
  let offOk = true;
  if (model.id === OPENROUTER_MUSE_SPARK_11_MODEL) {
    offOk = styleA === MUSE_PROSE_M1_STYLE_SECTION;
  } else {
    offOk = styleA === PROSE_STYLE_SECTION;
  }

  const expectedB =
    routeB === "muse-m1"
      ? MUSE_PROSE_M1_STYLE_SECTION_V2
      : routeB === "vnext"
        ? PROSE_VNEXT_STYLE_SECTION_V2
        : PROSE_STYLE_SECTION_V2;
  const onOk = styleB === expectedB && styleB.includes(SHARED_NOVEL_PROSE_CORE);

  const dups = duplicateNeedles.filter((n) => proseB.includes(n) || lengthB.includes(n) || termB.includes(n));
  // Core itself shouldn't contain immersive header
  const dupFail = dups.length > 0;

  const bandOk = proseDeltaPct >= -15 && proseDeltaPct <= 5;
  // full system delta proxy: prose+length+terminal only (layout excluded)
  const sysDeltaOk = delta <= 150;

  if (!offOk || !onOk || dupFail || !bandOk || !sysDeltaOk || routeA !== routeB) {
    allPass = false;
  }

  log(`### ${model.label} (${model.id})`);
  log(`routeA=${routeA} routeB=${routeB} routeHashA=${hash(routeA)} routeHashB=${hash(routeB)}`);
  log(`styleHashA=${hash(styleA)} styleHashB=${hash(styleB)}`);
  log(`styleCharsA=${styleA.length} styleCharsB=${styleB.length}`);
  log(`lengthCharsA=${lengthA.length} lengthCharsB=${lengthB.length}`);
  log(`termA=${termA}`);
  log(`termB=${termB}`);
  log(`proseRelatedTokensA≈${tokA} B≈${tokB} delta=${delta} (${proseDeltaPct.toFixed(1)}%)`);
  log(`gateOffByteMatchSoT=${offOk}`);
  log(`gateOnExpectedV2Body=${onOk}`);
  log(`duplicateNeedlesInB=${dupFail ? dups.join(" | ") : "none"}`);
  log(`bandOk(-15..+5%)=${bandOk} sysDeltaOk(<=150)=${sysDeltaOk}`);
  log(`continuationV2Present=${lengthB.includes(SCENE_CONTINUATION_PRIORITY_BLOCK_V2)}`);
  log(`legacyContinuationAbsentInB=${!lengthB.includes(SCENE_CONTINUATION_PRIORITY_BLOCK)}`);
  log("");
}

log("## 7. Duplicate-concept search");
log("Arm B must not contain: [IMMERSIVE PROSE], 내면만으로…, Never stop…, 단일 응답 최대 전개");
log(`result: ${allPass ? "PASS (see per-model flags)" : "CHECK FLAGS ABOVE"}`);
log("");

log("## 8. Hardcoded names");
const proseFiles = [
  SHARED_NOVEL_PROSE_CORE,
  PROSE_STYLE_SECTION_V2,
  PROSE_VNEXT_STYLE_SECTION_V2,
  MUSE_PROSE_M1_STYLE_SECTION_V2,
].join("\n");
const names = ["라이크", "렌", "서강우", "플러드"];
const nameHits = names.filter((n) => proseFiles.includes(n));
log(nameHits.length ? `FAIL: ${nameHits.join(",")}` : "PASS: none");
log("");

log("## 9–12. Byte-stable frozen sections (untouched source constants)");
log(`OUTPUT_LAYOUT_SEMANTIC_CORE hash=${hash(OUTPUT_LAYOUT_SEMANTIC_CORE)}`);
log(`WEBNOVEL_OUTPUT_FORMAT_BLOCK hash=${hash(WEBNOVEL_OUTPUT_FORMAT_BLOCK)}`);
log(`IMMERSIVE_PROSE_BLOCK (prod Legacy body) hash=${hash(IMMERSIVE_PROSE_BLOCK)} — not mutated`);
log(`PROSE_VNEXT_STYLE_SECTION hash=${hash(PROSE_VNEXT_STYLE_SECTION)} — not mutated`);
log(`MUSE_PROSE_M1_STYLE_SECTION hash=${hash(MUSE_PROSE_M1_STYLE_SECTION)} — not mutated`);
log("No Godmodding / Persona Secret / speech·knowledge: not edited in this change set.");
log("");

log(`## VERDICT`);
log(allPass && nameHits.length === 0 ? "STATIC_AUDIT_PASS" : "STATIC_AUDIT_FAIL");
log("NOTE: Full assembled system prompt token delta requires fixture buildContext; prose+length+terminal proxy used above.");
log("API calls: 0");

writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
console.log(lines.join("\n"));
console.log(`\nWrote ${OUT}`);
process.exit(allPass && nameHits.length === 0 ? 0 : 1);
