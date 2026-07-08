/**
 * Step 4.3 — Final prompt consolidation audit (design + refactor report).
 * Usage: npx tsx scripts/step43-final-prompt-consolidation.ts
 */
import "./lib/server-only-mock";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  buildAdvancedProseNsfwGuidelines,
  PROSE_STYLE_SECTION,
} from "@/lib/advancedProseNsfwGuidelines";
import { GENERATION_PROCESS_BEAT_FLOW_BLOCK } from "@/lib/generationProcessBeatFlow";
import { buildLengthInstruction } from "@/lib/responseLength";
import { buildTurnHandoffAndPacingBlock } from "@/lib/turnHandoffAndPacing";
import { buildNarrativeStyleLayer } from "@/lib/narrativeStyle";
import { buildWebnovelOutputLayoutRecencyBlock } from "@/lib/webnovelOutputFormat";
import { buildProductionContextForScene, PRODUCTION_VALIDATION_SCENES } from "./lib/production-prompt-fixture";

function estTok(text: string): number {
  return Math.max(1, Math.ceil(text.length * 0.9));
}

/** Pre-4.3 snippets (removed duplicates only — for diff) */
const REMOVED_LENGTH_DIALOGUE_CRAFT =
  "- 각 대사 전·후에 행동·반응·감각·분위기를 서사적으로 전개한다 — 장면 흐름을 채우라는 뜻이며, 지문과 대사를 한 문단에 병합하라는 뜻이 아니다";

const REMOVED_HANDOFF_BULLETS = `Never end immediately after a seemingly complete moment.
Continue through:
- emotional aftermath
- body language
- atmosphere change
- new interaction`;

type SectionAction = "KEEP" | "MERGE" | "DELETE";

type SectionRow = {
  id: string;
  layer: string;
  action: SectionAction;
  owner: string;
  rationale: string;
  beforeTok: number;
  afterTok: number;
};

const INVENTORY: SectionRow[] = [
  {
    id: "REGISTER",
    layer: "Prose",
    action: "KEEP",
    owner: "PROSE STYLE",
    rationale: "Production form SoT — unchanged",
    beforeTok: 0,
    afterTok: 0,
  },
  {
    id: "GENERATION_PROCESS",
    layer: "Flow",
    action: "MERGE",
    owner: "PROSE STYLE (generationProcessBeatFlow.ts)",
    rationale: "Blueprint Screening validated — alternation/withhold/hook",
    beforeTok: 0,
    afterTok: estTok(GENERATION_PROCESS_BEAT_FLOW_BLOCK),
  },
  {
    id: "RHYTHM",
    layer: "Prose",
    action: "KEEP",
    owner: "PROSE STYLE",
    rationale: "Within-turn sentence length — complements SCENE MODE",
    beforeTok: 0,
    afterTok: 0,
  },
  {
    id: "SENSATION",
    layer: "Prose",
    action: "KEEP",
    owner: "PROSE STYLE",
    rationale: "Calm arc sensory depth (Step 4.2)",
    beforeTok: 0,
    afterTok: 0,
  },
  {
    id: "EMOTION",
    layer: "Prose",
    action: "KEEP",
    owner: "PROSE STYLE",
    rationale: "Show-don't-tell — Production validated",
    beforeTok: 0,
    afterTok: 0,
  },
  {
    id: "MOVEMENT",
    layer: "Prose",
    action: "KEEP",
    owner: "PROSE STYLE",
    rationale: "Spatial clarity — Production validated",
    beforeTok: 0,
    afterTok: 0,
  },
  {
    id: "WEBNOVEL_BREATH",
    layer: "Breath",
    action: "KEEP",
    owner: "PROSE STYLE",
    rationale: "Calm immersion — spot check KEEP (Step 4.2)",
    beforeTok: 0,
    afterTok: 0,
  },
  {
    id: "NARRATIVE_DENSITY",
    layer: "Density",
    action: "KEEP",
    owner: "LENGTH CONTROL",
    rationale: "Calm slow-build — spot check KEEP",
    beforeTok: 0,
    afterTok: 0,
  },
  {
    id: "MOMENT_TO_MOMENT",
    layer: "Density",
    action: "KEEP",
    owner: "LENGTH CONTROL",
    rationale: "Scene progression without paragraph merge",
    beforeTok: 0,
    afterTok: 0,
  },
  {
    id: "SCENE_CONTINUATION",
    layer: "Handoff",
    action: "KEEP",
    owner: "LENGTH CONTROL",
    rationale: "Calm arc floor — not replaced by FLOW alone",
    beforeTok: 0,
    afterTok: 0,
  },
  {
    id: "LENGTH_DIALOGUE_PREPOST",
    layer: "Flow",
    action: "DELETE",
    owner: "(was LENGTH)",
    rationale: "Duplicate of GENERATION PROCESS exchange — Step 4.3 dedup",
    beforeTok: estTok(REMOVED_LENGTH_DIALOGUE_CRAFT),
    afterTok: 0,
  },
  {
    id: "HANDOFF_CRAFT_BULLETS",
    layer: "Handoff",
    action: "DELETE",
    owner: "TURN HANDOFF",
    rationale: "Replaced by pointer to GENERATION step 7 + SCENE CONTINUATION/DENSITY",
    beforeTok: estTok(REMOVED_HANDOFF_BULLETS),
    afterTok: 0,
  },
  {
    id: "GENRE_TONE",
    layer: "Genre",
    action: "KEEP",
    owner: "narrativeStyle.ts",
    rationale: "Genre atmosphere hints — Production validated",
    beforeTok: 0,
    afterTok: 0,
  },
  {
    id: "SCENE_MODE",
    layer: "Genre",
    action: "MERGE",
    owner: "narrativeStyle.ts + PROSE [SCENE MODE]",
    rationale: "Blueprint validated mode select — additive, not replacement",
    beforeTok: 0,
    afterTok: estTok(buildNarrativeStyleLayer({ genres: ["공포/추리"] })),
  },
  {
    id: "OUTPUT_LAYOUT",
    layer: "Output",
    action: "KEEP",
    owner: "webnovelOutputFormat.ts",
    rationale: "Format SoT unchanged",
    beforeTok: 0,
    afterTok: 0,
  },
  {
    id: "DIALOGUE_NARRATION",
    layer: "Output",
    action: "KEEP",
    owner: "ADVANCED PROSE",
    rationale: "Quote integrity — Layout-adjacent",
    beforeTok: 0,
    afterTok: 0,
  },
];

const RESPONSIBILITY_MAP: { layer: string; soleOwner: string; rules: string }[] = [
  {
    layer: "Flow (order)",
    soleOwner: "[GENERATION PROCESS — BEAT FLOW]",
    rules: "establish→exchange→withhold→reveal→pause→hook→handoff; SCENE MODE numeric caps",
  },
  {
    layer: "Breath",
    soleOwner: "[WEBNOVEL BREATH]",
    rules: "pause before key moment; transition reset; trailing air",
  },
  {
    layer: "Density",
    soleOwner: "[NARRATIVE DENSITY] + [MOMENT-TO-MOMENT]",
    rules: "slow important beats; no skipped steps; not paragraph merge",
  },
  {
    layer: "Emotion",
    soleOwner: "[EMOTION]",
    rules: "show via body/space; no emotion labels",
  },
  {
    layer: "Movement",
    soleOwner: "[MOVEMENT & SPACE]",
    rules: "position/direction/result; slo-mo only at turns",
  },
  {
    layer: "Length",
    soleOwner: "[LENGTH CONTROL]",
    rules: "TARGET/FLOOR; NO INPUT ECHO; mirror ban; points to FLOW for alternation",
  },
  {
    layer: "Turn Handoff",
    soleOwner: "<TURN_HANDOFF_AND_PACING>",
    rules: "floor gate; step-7 handoff; calm arc → SCENE CONTINUATION + NARRATIVE DENSITY",
  },
  {
    layer: "Genre",
    soleOwner: "[genre_tone] + [SCENE MODE]",
    rules: "atmosphere hint + calm|tension|combat pointer",
  },
  {
    layer: "Output",
    soleOwner: "[WEBNOVEL OUTPUT FORMAT] + [OUTPUT LAYOUT] + [DIALOGUE & NARRATION]",
    rules: "markdown ban; paragraph breaks; quote integrity",
  },
];

async function main() {
  mkdirSync(join(process.cwd(), "output"), { recursive: true });

  const proseBundle = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: true });
  const lengthBlock = buildLengthInstruction(3200, {
    statusWindowEveryTurn: false,
    htmlFlashOwned: true,
    proseStylePolicyOwnsSceneExpansion: true,
    statusWidgetActive: false,
  });
  const handoff = buildTurnHandoffAndPacingBlock();
  const layout = buildWebnovelOutputLayoutRecencyBlock();
  const genre = buildNarrativeStyleLayer({ genres: ["공포/추리"] });

  const styleCoreAfter =
    PROSE_STYLE_SECTION.length + lengthBlock.length + handoff.length + genre.length + layout.length;

  const deletedTok =
    estTok(REMOVED_LENGTH_DIALOGUE_CRAFT) + estTok(REMOVED_HANDOFF_BULLETS);
  const addedTok = estTok(GENERATION_PROCESS_BEAT_FLOW_BLOCK);

  const beforeStyleCoreEst = styleCoreAfter - addedTok + deletedTok - 45;
  const afterStyleCoreEst = styleCoreAfter;

  const { buildContext } = await import("@/services/contextBuilder");
  const scene = PRODUCTION_VALIDATION_SCENES[0]!;
  const systemAfter = buildContext(buildProductionContextForScene(scene)).systemPrompt;

  const beforePath = join(process.cwd(), "output", "prose-bundle-before.txt");
  const proseBundleBeforeChars = existsSync(beforePath)
    ? readFileSync(beforePath, "utf8").length
    : null;
  const proseBundleAfterChars = proseBundle.length;

  const md = [
    "# Step 4.3 — Final Prompt Consolidation",
    "",
    "> 검증된 요소만 재배치. 새 규칙·새 문체 없음.",
    "> Production 유지: WEBNOVEL BREATH, NARRATIVE DENSITY, calm arc blocks.",
    "> Blueprint 흡수: GENERATION PROCESS (+ SCENE MODE hint).",
    "",
    "## Token estimate (style-related core blocks)",
    "",
    "| Block | Before (est.) | After (est.) | Δ |",
    "|-------|---------------|--------------|---|",
    `| PROSE STYLE | ~${estTok(PROSE_STYLE_SECTION) - estTok(GENERATION_PROCESS_BEAT_FLOW_BLOCK)} | ~${estTok(PROSE_STYLE_SECTION)} | +${estTok(GENERATION_PROCESS_BEAT_FLOW_BLOCK)} |`,
    `| LENGTH + expansion | ~${estTok(lengthBlock) + estTok(REMOVED_LENGTH_DIALOGUE_CRAFT)} | ~${estTok(lengthBlock)} | −${estTok(REMOVED_LENGTH_DIALOGUE_CRAFT)} |`,
    `| TURN HANDOFF | ~${estTok(handoff) + estTok(REMOVED_HANDOFF_BULLETS)} | ~${estTok(handoff)} | −${estTok(REMOVED_HANDOFF_BULLETS)} |`,
    `| Genre layer | +0 | +[SCENE MODE] line | ~+40 |`,
    `| **Style core subtotal** | **~${beforeStyleCoreEst}** | **~${afterStyleCoreEst}** | **~${afterStyleCoreEst - beforeStyleCoreEst}** |`,
    "",
    proseBundleBeforeChars != null
      ? `| ADVANCED prose bundle (file) | ${proseBundleBeforeChars} chars | ${proseBundleAfterChars} chars | ${proseBundleAfterChars - proseBundleBeforeChars} |`
      : "",
    "",
    `| **Full assembled system (horror scene)** | — | **~${estTok(systemAfter)} tok** | — |`,
    "",
    "## Section inventory (KEEP / MERGE / DELETE)",
    "",
    "| ID | Layer | Action | Owner | Rationale |",
    "|----|-------|--------|-------|-----------|",
    ...INVENTORY.map(
      (r) => `| ${r.id} | ${r.layer} | **${r.action}** | ${r.owner} | ${r.rationale} |`
    ),
    "",
    "## Responsibility map (one rule → one layer)",
    "",
    "| Layer | Sole owner | Scope |",
    "|-------|------------|-------|",
    ...RESPONSIBILITY_MAP.map((r) => `| ${r.layer} | ${r.soleOwner} | ${r.rules} |`),
    "",
    "## Diff summary",
    "",
    "### MERGE (into Production)",
    "",
    "- `[GENERATION PROCESS — BEAT FLOW]` → `src/lib/generationProcessBeatFlow.ts` → PROSE STYLE",
    "- `[SCENE MODE]` genre line → `narrativeStyle.ts` (additive)",
    "",
    "### DELETE (duplicate only)",
    "",
    "- LENGTH: pre/post dialogue craft (→ GENERATION exchange)",
    "- TURN HANDOFF: aftermath/body/atmosphere bullet list (→ step 7 + SCENE CONTINUATION + NARRATIVE DENSITY pointers)",
    "",
    "### KEEP (Production advantages — Step 4.2 calm)",
    "",
    "- [WEBNOVEL BREATH], [NARRATIVE DENSITY], [MOMENT-TO-MOMENT], [SCENE CONTINUATION]",
    "- [RHYTHM][SENSATION][EMOTION][MOVEMENT], [genre_tone]",
    "",
    "## Calm regression guard",
    "",
    "Blueprint full swap caused calm early-exit (Step 4.2). This refactor:",
    "",
    "1. **Does not remove** BREATH / DENSITY / MOMENT-TO-MOMENT / SCENE CONTINUATION",
    "2. **Adds** GENERATION PROCESS for alternation/hook **without** replacing breath/density SoT",
    "3. HANDOFF points calm arc back to LENGTH blocks — not FLOW-only handoff",
    "",
    "## Files changed (Production)",
    "",
    "- `src/lib/generationProcessBeatFlow.ts` (new SoT)",
    "- `src/lib/advancedProseNsfwGuidelines.ts`",
    "- `src/lib/responseLength.ts`",
    "- `src/lib/turnHandoffAndPacing.ts`",
    "- `src/lib/narrativeStyle.ts`",
    "",
    `JSON: \`output/step43-final-prompt-consolidation.json\``,
  ].join("\n");

  const payload = {
    generatedAt: new Date().toISOString(),
    design: "merge-validated-only",
    tokenEstimate: {
      proseStyleAfter: estTok(PROSE_STYLE_SECTION),
      generationProcessAdded: estTok(GENERATION_PROCESS_BEAT_FLOW_BLOCK),
      lengthDialogueCraftRemoved: estTok(REMOVED_LENGTH_DIALOGUE_CRAFT),
      handoffBulletsRemoved: estTok(REMOVED_HANDOFF_BULLETS),
      styleCoreBeforeEst: beforeStyleCoreEst,
      styleCoreAfterEst: afterStyleCoreEst,
      styleCoreDeltaEst: afterStyleCoreEst - beforeStyleCoreEst,
      fullSystemHorrorSceneTok: estTok(systemAfter),
    },
    inventory: INVENTORY,
    responsibilityMap: RESPONSIBILITY_MAP,
    proseBundleChars: { before: proseBundleBeforeChars, after: proseBundleAfterChars },
  };

  writeFileSync(join(process.cwd(), "output", "step43-final-prompt-consolidation.json"), JSON.stringify(payload, null, 2));
  writeFileSync(join(process.cwd(), "output", "step43-final-prompt-consolidation.md"), md, "utf8");

  console.log("Step 4.3 consolidation report");
  console.log(`Style core Δ (est.): ${payload.tokenEstimate.styleCoreDeltaEst} tok`);
  console.log(`Full system (horror): ~${payload.tokenEstimate.fullSystemHorrorSceneTok} tok`);
  console.log("Wrote output/step43-final-prompt-consolidation.md");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
