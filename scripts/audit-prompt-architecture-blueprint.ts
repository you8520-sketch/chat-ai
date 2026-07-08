/**
 * Step 4 — Prompt architecture blueprint token audit (design only).
 * Usage: npx tsx scripts/audit-prompt-architecture-blueprint.ts
 */
import "./lib/server-only-mock";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildAdvancedProseNsfwGuidelines, PROSE_STYLE_SECTION } from "@/lib/advancedProseNsfwGuidelines";
import { buildLengthInstruction } from "@/lib/responseLength";
import { buildTurnHandoffAndPacingBlock, SCENE_CONTINUATION_PRIORITY_BLOCK } from "@/lib/turnHandoffAndPacing";
import {
  buildWebnovelOutputLayoutRecencyBlock,
  WEBNOVEL_OUTPUT_FORMAT_BLOCK,
} from "@/lib/webnovelOutputFormat";
import { buildNarrativeStyleLayer } from "@/lib/narrativeStyle";
import {
  NARRATIVE_DENSITY_BLOCK,
  MOMENT_TO_MOMENT_WRITING_BLOCK,
  NO_INPUT_ECHO_RULE,
} from "@/lib/sceneExpansionPolicy";
import { UNIVERSAL_FLOW_NOTATION, SCENE_MODE_OVERLAYS } from "./lib/style-mechanism-patterns";

function estTok(text: string): number {
  return Math.max(1, Math.ceil(text.length * 0.9));
}

type Layer = "REGISTER" | "FLOW" | "STYLE" | "LAYOUT";

type RuleInventory = {
  id: string;
  source: string;
  layer: Layer;
  text: string;
  tok: number;
  action: "keep" | "merge" | "remove" | "move";
  target?: string;
};

function inv(
  id: string,
  source: string,
  layer: Layer,
  text: string,
  action: RuleInventory["action"],
  target?: string
): RuleInventory {
  return { id, source, layer, text: text.trim(), tok: estTok(text), action, target };
}

/** Proposed vNext blocks */
const FLOW_PROCESS_VNEXT = `[GENERATION PROCESS — BEAT FLOW]
Follow this order each turn. Scene mode: {calm|tension|combat} from [SCENE MODE].

1 establish → orient (mid|long); max 2 nar sentences before first "
2 exchange → alternation; maxNarWithoutDlg per mode
3 withhold → delay 1 key fact (short)
4 reveal → 1 fact only (mid)
5 pause → 1-line cognitive break (micro)
6 hook → unresolved; invite next input
7 handoff → return to user; do not close all withhold cycles

[SCENE MODE]
calm: maxNar=3 dominant=mid withhold=long hook=statement
tension: maxNar=2 dominant=short withhold=short hook=?
combat: maxNar=1 dominant=micro withhold=none hook=action_cliff

Expand turn by repeating steps 1→6 loops; never stack narration-only blocks.`.trim();

const REGISTER_VNEXT = `[REGISTER]
해체(-다/-했다/-이었다). 번역투·명사 단편·...... 금지.
말줄임 ... 은 실제 망설임·끊김·여운에만.`.trim();

const STYLE_VNEXT = `[STYLE — content constraints only]
지문 craft. 대사·줄바꿈·분량·리듬은 FLOW/LAYOUT SoT.
감정 라벨("슬프다") 지문 금지. 현재 장면 무관 설정 나열 금지.
Stage-direction/meta narration 금지. 순간 요약 금지.
Turn 간 동일 반응 패턴·문장 구조 재사용 금지.`.trim();

const LAYOUT_VNEXT = buildWebnovelOutputLayoutRecencyBlock();

const LENGTH_VNEXT = `[LENGTH CONTROL]
TARGET_LENGTH: {aim}+ · MINIMUM_FLOOR: {min}+
${NO_INPUT_ECHO_RULE}
- mirroring 금지; 새 서사 비트로 확장
- 분량은 [GENERATION PROCESS] loop count로 충족; narration-only stack 금지`.trim();

const TURN_HANDOFF_VNEXT = `<TURN_HANDOFF>
MINIMUM_FLOOR 미달 조기 종료 금지.
Turn ends at handoff phase (step 7); hook must stay partially open.`.trim();

const GENRE_VNEXT = `[SCENE MODE SELECT]
{genre} → calm|tension|combat (see [SCENE MODE] in FLOW).`.trim();

const DNR_VNEXT = `[DIALOGUE INTEGRITY]
- one utterance = one "
- no mid-quote narration split`.trim();

function main() {
  mkdirSync(join(process.cwd(), "output"), { recursive: true });

  const proseBundle = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: true });
  const lengthFull = buildLengthInstruction(3200, {
    statusWindowEveryTurn: false,
    htmlFlashOwned: true,
    proseStylePolicyOwnsSceneExpansion: true,
    statusWidgetActive: false,
  });
  const handoff = buildTurnHandoffAndPacingBlock();
  const layoutRecency = buildWebnovelOutputLayoutRecencyBlock();
  const genre = buildNarrativeStyleLayer({ genres: ["공포/추리"] }) ?? "";

  const inventory: RuleInventory[] = [
    // REGISTER
    inv("R01", "PROSE [REGISTER]", "REGISTER", PROSE_STYLE_SECTION.match(/\[REGISTER\][\s\S]*?(?=\n\[RHYTHM\])/)?.[0] ?? "", "keep"),
    inv("R02", "ABSOLUTE PROHIBITION", "STYLE", "=== 절대 금지 === 설정 나열", "keep"),
    inv("R03", "NO STAGE DIRECTIONS", "STYLE", "meta narration 금지", "merge", "STYLE_VNEXT"),

    // FLOW (currently scattered)
    inv("R04", "PROSE [RHYTHM]", "FLOW", PROSE_STYLE_SECTION.match(/\[RHYTHM\][\s\S]*?(?=\n\[SENSATION\])/)?.[0] ?? "", "merge", "FLOW_PROCESS"),
    inv("R05", "PROSE [SENSATION]", "FLOW", PROSE_STYLE_SECTION.match(/\[SENSATION\][\s\S]*?(?=\n\[EMOTION\])/)?.[0] ?? "", "remove", "FLOW establish/exchange"),
    inv("R06", "PROSE [EMOTION]", "FLOW", PROSE_STYLE_SECTION.match(/\[EMOTION\][\s\S]*?(?=\n\[MOVEMENT)/)?.[0] ?? "", "remove", "FLOW withhold/reveal"),
    inv("R07", "PROSE [MOVEMENT]", "FLOW", PROSE_STYLE_SECTION.match(/\[MOVEMENT[\s\S]*?(?=\n\[WEBNOVEL)/)?.[0] ?? "", "remove", "FLOW establish"),
    inv("R08", "PROSE [WEBNOVEL BREATH]", "FLOW", PROSE_STYLE_SECTION.match(/\[WEBNOVEL BREATH\][\s\S]*$/)?.[0] ?? "", "remove", "FLOW pause/hook"),
    inv("R09", "LENGTH pre/post dialogue", "FLOW", "각 대사 전·후 감각·분위기", "remove", "FLOW loop"),
    inv("R10", "NARRATIVE DENSITY", "FLOW", NARRATIVE_DENSITY_BLOCK, "remove", "FLOW mode"),
    inv("R11", "MOMENT-TO-MOMENT", "FLOW", MOMENT_TO_MOMENT_WRITING_BLOCK, "merge", "FLOW loop"),
    inv("R12", "SCENE CONTINUATION", "FLOW", SCENE_CONTINUATION_PRIORITY_BLOCK, "remove", "FLOW handoff"),
    inv("R13", "TURN HANDOFF bullets", "FLOW", "aftermath/body/atmosphere/new interaction", "remove", "FLOW handoff"),
    inv("R14", "genre_tone craft", "FLOW", genre, "merge", "SCENE MODE"),
    inv("R15", "CROSS-TURN", "STYLE", "Turn 간 패턴 재사용 금지", "keep"),

    // LAYOUT
    inv("R16", "WEBNOVEL OUTPUT FORMAT", "LAYOUT", WEBNOVEL_OUTPUT_FORMAT_BLOCK, "keep"),
    inv("R17", "OUTPUT LAYOUT recency", "LAYOUT", layoutRecency, "keep"),
    inv("R18", "DNR quote integrity", "LAYOUT", "[DIALOGUE & NARRATION] 2 lines", "merge", "DNR_VNEXT"),

    // STYLE (non-flow content)
    inv("R19", "19+ INTIMACY", "STYLE", "NSFW block", "keep"),
    inv("R20", "NO ABSTRACT SUMMARIES", "STYLE", "순간 요약 금지", "keep"),
    inv("R21", "LENGTH numeric only part", "STYLE", "TARGET/FLOOR/mirror", "keep", "LENGTH_VNEXT"),
  ];

  const beforeBlocks = {
    proseBundle,
    proseStyleOnly: PROSE_STYLE_SECTION,
    lengthFull,
    handoff,
    layoutRecency,
    genre,
    dnr: "[DIALOGUE & NARRATION]\n- quote rules",
  };

  const beforeTok = {
    proseBundle: estTok(proseBundle),
    lengthFull: estTok(lengthFull),
    handoff: estTok(handoff),
    layoutRecency: estTok(layoutRecency),
    layoutFormat: estTok(WEBNOVEL_OUTPUT_FORMAT_BLOCK),
    genre: estTok(genre),
  };

  const afterBlocks = {
    register: REGISTER_VNEXT,
    flow: FLOW_PROCESS_VNEXT,
    style: STYLE_VNEXT + "\n\n[19+ INTIMACY] … (unchanged)",
    layout: WEBNOVEL_OUTPUT_FORMAT_BLOCK + "\n\n" + LAYOUT_VNEXT + "\n\n" + DNR_VNEXT,
    length: LENGTH_VNEXT.replace("{aim}", "3,200").replace("{min}", "2,400"),
    handoff: TURN_HANDOFF_VNEXT,
    genre: GENRE_VNEXT.replace("{genre}", "공포/추리 → tension"),
  };

  const layerBefore = {
    REGISTER: estTok(PROSE_STYLE_SECTION.match(/\[REGISTER\][\s\S]*?(?=\n\[RHYTHM\])/)?.[0] ?? ""),
    FLOW:
      estTok(
        [
          PROSE_STYLE_SECTION.replace(/\[REGISTER\][\s\S]*?(?=\n\[RHYTHM\])/, "").replace(/\[PROSE STYLE\][^\n]*\n/, ""),
          lengthFull,
          handoff,
          genre,
        ].join("\n")
      ) - estTok(SCENE_CONTINUATION_PRIORITY_BLOCK), // counted in length
    STYLE: estTok(
      [
        "=== 절대 금지 ===",
        "NO STAGE",
        "NO ABSTRACT",
        "CROSS-TURN",
        "NSFW",
        NO_INPUT_ECHO_RULE,
      ].join("\n")
    ),
    LAYOUT: beforeTok.layoutRecency + beforeTok.layoutFormat + estTok("[DIALOGUE & NARRATION]"),
  };

  const layerAfter = {
    REGISTER: estTok(afterBlocks.register),
    FLOW: estTok(afterBlocks.flow) + estTok(afterBlocks.length) + estTok(afterBlocks.handoff) + estTok(afterBlocks.genre),
    STYLE: estTok(afterBlocks.style),
    LAYOUT: estTok(afterBlocks.layout),
  };

  const styleRelatedBefore = Object.values(layerBefore).reduce((a, b) => a + b, 0);
  const styleRelatedAfter = Object.values(layerAfter).reduce((a, b) => a + b, 0);

  const payload = {
    generatedAt: new Date().toISOString(),
    designOnly: true,
    layerBefore,
    layerAfter,
    layerDelta: {
      REGISTER: layerAfter.REGISTER - layerBefore.REGISTER,
      FLOW: layerAfter.FLOW - layerBefore.FLOW,
      STYLE: layerAfter.STYLE - layerBefore.STYLE,
      LAYOUT: layerAfter.LAYOUT - layerBefore.LAYOUT,
      total: styleRelatedAfter - styleRelatedBefore,
    },
    inventory,
    afterBlocks,
    universalFlowReference: UNIVERSAL_FLOW_NOTATION,
    sceneModeOverlays: SCENE_MODE_OVERLAYS,
  };

  writeFileSync(join(process.cwd(), "output", "step4-prompt-architecture-blueprint.json"), JSON.stringify(payload, null, 2));

  const removalMap = [
    ["LENGTH", "각 대사 전·후 감각·분위기 전개", "FLOW exchange/withhold"],
    ["LENGTH", "NARRATIVE DENSITY", "FLOW scene mode"],
    ["LENGTH", "MOMENT-TO-MOMENT craft lines", "FLOW loop instruction"],
    ["LENGTH", "SCENE CONTINUATION (in LENGTH block)", "FLOW handoff"],
    ["TURN HANDOFF", "emotional aftermath / body language / atmosphere", "FLOW pause→hook"],
    ["TURN HANDOFF", "new interaction expansion craft", "FLOW handoff step 7"],
    ["genre_tone", "감정·시선·호흡 craft hints", "FLOW SCENE MODE selector"],
    ["PROSE", "[RHYTHM][SENSATION][EMOTION][MOVEMENT][WEBNOVEL BREATH]", "FLOW process steps"],
    ["PROSE", "duplicate pacing with LENGTH", "removed"],
  ];

  const md = [
    "# Step 4 — Prompt Architecture Refactor (Blueprint)",
    "",
    "**Design only — Production 미적용.**",
    "",
    "목표: 문체 향상 + 중복 제거 + prompt 축소 + responsibility 단일화 + process 추종성.",
    "",
    "---",
    "",
    "## 1. Four-Layer Architecture",
    "",
    "| Layer | Responsibility | Owns | Must NOT own |",
    "|-------|----------------|------|--------------|",
    "| **REGISTER** | 형식·어미·금지 표기 | 해체, ellipsis, 번역투 | rhythm, paragraph, length |",
    "| **FLOW** | 생성 **순서**(process) | establish→exchange→withhold→reveal→pause→hook→handoff, scene mode, expansion loops | quote format, 해체 |",
    "| **STYLE** | content guardrails | NSFW, meta ban, setting dump ban, cross-turn dedupe | pacing, paragraph breaks |",
    "| **LAYOUT** | output shape | \", paragraph breaks, markdown ban | pacing semantics, emotion craft |",
    "",
    "**단일 소유:** 각 규칙은 정확히 1 layer.",
    "",
    "---",
    "",
    "## 2. Generation Process (rules → process)",
    "",
    "Mechanism extraction phases를 **규칙 bullet** 대신 **실행 순서**로 치환:",
    "",
    "```",
    FLOW_PROCESS_VNEXT,
    "```",
    "",
    "모델은 checklist가 아니라 **step order**를 따름.",
    "",
    "---",
    "",
    "## 3. PROSE STYLE → FLOW migration",
    "",
    "| Old section | Disposition | New home |",
    "|-------------|-------------|----------|",
    "| [RHYTHM] | **remove** | FLOW steps 1–2 + SCENE MODE length |",
    "| [SENSATION] | **remove** | FLOW establish (content free) |",
    "| [EMOTION] | **remove** | FLOW withhold/reveal indirect |",
    "| [MOVEMENT & SPACE] | **remove** | FLOW establish orient |",
    "| [WEBNOVEL BREATH] | **remove** | FLOW pause + hook |",
    "| [REGISTER] | **keep** | REGISTER layer |",
    "",
    "**STYLE vNext** (content only):",
    "",
    "```",
    STYLE_VNEXT,
    "```",
    "",
    "---",
    "",
    "## 4. Responsibility Map — removals from LENGTH / HANDOFF / genre",
    "",
    "| Source | Remove | Absorbed by |",
    "|--------|--------|-------------|",
    ...removalMap.map(([s, r, a]) => `| ${s} | ${r} | ${a} |`),
    "",
    "### LENGTH vNext",
    "",
    "```",
    afterBlocks.length,
    "```",
    "",
    "### TURN HANDOFF vNext",
    "",
    "```",
    afterBlocks.handoff,
    "```",
    "",
    "### genre_tone vNext",
    "",
    "```",
    afterBlocks.genre,
    "```",
    "",
    "---",
    "",
    "## 5. Token budget (style-related blocks, ~chars×0.9)",
    "",
    "| Layer | Before (tok) | After (tok) | Δ |",
    "|-------|-------------|-------------|---|",
    `| REGISTER | ${layerBefore.REGISTER} | ${layerAfter.REGISTER} | ${layerAfter.REGISTER - layerBefore.REGISTER} |`,
    `| FLOW | ${layerBefore.FLOW} | ${layerAfter.FLOW} | ${layerAfter.FLOW - layerBefore.FLOW} |`,
    `| STYLE | ${layerBefore.STYLE} | ${layerAfter.STYLE} | ${layerAfter.STYLE - layerBefore.STYLE} |`,
    `| LAYOUT | ${layerBefore.LAYOUT} | ${layerAfter.LAYOUT} | ${layerAfter.LAYOUT - layerBefore.LAYOUT} |`,
    `| **Total** | **${styleRelatedBefore}** | **${styleRelatedAfter}** | **${styleRelatedAfter - styleRelatedBefore}** |`,
    "",
    "Note: FLOW after includes slim LENGTH+HANDOFF+genre (numeric/mode only). Largest drop = PROSE 5 sections + LENGTH craft duplication.",
    "",
    "---",
    "",
    "## 6. Assembly order (blueprint)",
    "",
    "```",
    "1. [STYLE] content guards + NSFW (cached bundle)",
    "2. [REGISTER]",
    "3. [GENERATION PROCESS — BEAT FLOW] + [SCENE MODE]",
    "4. [LENGTH CONTROL] numeric + mirror ban only",
    "5. [DIALOGUE INTEGRITY] (ex-DNR, layout-adjacent)",
    "6. … volatile context …",
    "7. [SCENE MODE SELECT] (ex-genre_tone, 1 line)",
    "8. <TURN_HANDOFF> floor gate only",
    "9. [WEBNOVEL OUTPUT FORMAT] + [OUTPUT LAYOUT] recency",
    "10. terminal TARGET/FLOOR tail",
    "```",
    "",
    "---",
    "",
    "## 7. Rule inventory (reclassification)",
    "",
    "| ID | Source | Layer | Action | Target |",
    "|----|--------|-------|--------|--------|",
    ...inventory.map((r) => `| ${r.id} | ${r.source} | ${r.layer} | ${r.action} | ${r.target ?? "—"} |`),
    "",
    "---",
    "",
    "## 8. Expected outcomes",
    "",
    "- **문체:** process 추종 → alternation/withhold/hook structural adherence (Step 3-4 mechanisms)",
    "- **중복:** RHYTHM×LENGTH×HANDOFF×genre emotion craft 제거",
    "- **토큰:** style-related ~" + (styleRelatedBefore - styleRelatedAfter) + " tok net (estimate)",
    "- **SoT:** FLOW=semantic rhythm, LAYOUT=format, REGISTER=form, STYLE=content guard",
    "",
    `JSON: \`output/step4-prompt-architecture-blueprint.json\``,
  ].join("\n");

  writeFileSync(join(process.cwd(), "output", "step4-prompt-architecture-blueprint.md"), md, "utf8");
  console.log("Wrote output/step4-prompt-architecture-blueprint.json");
  console.log("Wrote output/step4-prompt-architecture-blueprint.md");
  console.log(`Style-related tokens: ${styleRelatedBefore} → ${styleRelatedAfter} (Δ ${styleRelatedAfter - styleRelatedBefore})`);
}

main();
