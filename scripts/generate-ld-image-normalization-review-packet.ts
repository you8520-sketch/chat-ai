#!/usr/bin/env node
/**
 * Generates docs/audits/ld-image-normalization/REVIEW_PACKET.md
 * Run: node --import tsx scripts/generate-ld-image-normalization-review-packet.ts
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  countMalformedAttributionBenchmarkCorpus,
  countMalformedAttributionLdFixtures,
  countFakeAttributionBubbleCorpus,
} from "../src/lib/chatImageAttributionAudit";
import {
  auditComicDialogueWhitelist,
  buildChatComicImagePrompt,
} from "../src/lib/chatComicGeneration";
import { renderChatComicPanelSpecSection, compileChatComicPanelSpec } from "../src/lib/chatComicPanelSpec";
import { duoVisualSubjectsForCast } from "../src/lib/chatComicPanelSpec.fixtures";
import {
  CHAT_IMAGE_SCENE_BRIEF_DEFAULT_MODEL,
  CHAT_IMAGE_SCENE_BRIEF_FALLBACK_MODEL,
  resolveChatImageSceneBriefModel,
} from "../src/lib/chatImageSceneBrief";
import { isCheaperInferenceModel } from "../src/lib/chatModels";
import { SCENE_PLAN_MAX_PROVIDER_ATTEMPTS } from "../src/lib/chatImageScenePlan";
import {
  applyUserPanelEdits,
  addPanelDialogueLine,
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  collectApprovedComicText,
  extractDeterministicEvents,
  formatApprovedScenePlanForComic,
  formatApprovedScenePlanForIllustration,
  projectComicPanelBeat,
  updatePanelDialogueAtIndex,
} from "../src/lib/chatImageScenePlan";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs/audits/ld-image-normalization");
const OUT_FILE = join(OUT_DIR, "REVIEW_PACKET.md");

function gitSha(ref: string): string {
  return execSync(`git rev-parse ${ref}`, { cwd: ROOT, encoding: "utf8" }).trim();
}

const MAIN_SHA = gitSha("origin/main");
const GENERATED_FROM_SOURCE_SHA = gitSha("HEAD");
const PERSONA = "렌";
const CHARACTER = "태형";

const ATTRIBUTION_SOURCE = '태현이 렌의 손목을 붙잡고 "가지 마."라고 말했다.';
const messages = buildSceneSourceMessages([
  { id: 1, role: "assistant", content: ATTRIBUTION_SOURCE },
]);
const plan = buildDeterministicScenePlan(messages, 2);
const events = extractDeterministicEvents(messages);
const illustration = formatApprovedScenePlanForIllustration(plan);
const duoSubjects = duoVisualSubjectsForCast({
  characterName: CHARACTER,
  personaName: PERSONA,
});

const comicSpec = renderChatComicPanelSpecSection(
  compileChatComicPanelSpec({
    plan,
    personaName: PERSONA,
    characterName: CHARACTER,
    subjects: duoSubjects,
  })
);
const comicPrompt = buildChatComicImagePrompt({
  characterName: CHARACTER,
  characterGender: "male",
  personaName: PERSONA,
  personaGender: "female",
  plan,
  subjects: duoSubjects,
});
const armA = formatApprovedScenePlanForComic(plan);

const duoMessages = buildSceneSourceMessages([
  { id: 1, role: "user", content: '*후드 귀를 만진다*\n"같이 갈래?"' },
  { id: 2, role: "assistant", content: '렌이 후드를 만지자 태형이 고개를 돌렸다. "그래."' },
]);
const duoPlan = buildDeterministicScenePlan(duoMessages, 2);
const characterPanel = duoPlan.panels.find((panel) =>
  panel.dialogue.some((line) => line.text.includes("그래"))
);
const characterLineIndex =
  characterPanel?.dialogue.findIndex((line) => line.text.includes("그래")) ?? -1;
const duoEdited =
  characterPanel && characterLineIndex >= 0
    ? updatePanelDialogueAtIndex(duoPlan, characterPanel.index, characterLineIndex, {
        text: "좋아.",
      })
    : duoPlan;
const audit = auditComicDialogueWhitelist({
  plan: duoEdited,
  personaName: PERSONA,
  characterName: CHARACTER,
});

const primaryModel = resolveChatImageSceneBriefModel();
const fallbackModel = CHAT_IMAGE_SCENE_BRIEF_FALLBACK_MODEL;
const primaryProvider = isCheaperInferenceModel(primaryModel)
  ? "CheaperInference"
  : "OpenRouter";
const fallbackProvider = isCheaperInferenceModel(fallbackModel)
  ? "CheaperInference"
  : "OpenRouter";

function dialogueEditorSection(
  label: string,
  reviewPlan: ReturnType<typeof buildDeterministicScenePlan>,
  edited?: ReturnType<typeof buildDeterministicScenePlan>
) {
  const active = edited ?? reviewPlan;
  const whitelist = collectApprovedComicText(active);
  const spec = compileChatComicPanelSpec({
    plan: active,
    personaName: PERSONA,
    characterName: CHARACTER,
    subjects: duoSubjects,
  });
  const rows: string[] = [`### ${label}`, ""];
  for (const panel of active.panels) {
    const beat = projectComicPanelBeat(active, panel, { personaVisible: true });
    const bubbles = spec.panels.find((row) => row.index === panel.index)?.speechBubbles ?? [];
    rows.push(`#### Panel ${panel.index}`);
    rows.push(`- VISIBLE SCENE DESCRIPTION: ${beat.situation}`);
    if (!panel.dialogue.length) {
      rows.push("- VISIBLE DIALOGUE: (silent)");
    }
    for (const [index, line] of panel.dialogue.entries()) {
      const bubble = bubbles.find((_, bubbleIndex) => bubbleIndex === index);
      rows.push(`- LINE ${index + 1}`);
      rows.push(
        `  - VISIBLE SPEAKER NAME: ${line.speaker === "persona" ? PERSONA : line.speaker === "character" ? CHARACTER : "기타"}`
      );
      rows.push(`  - VISIBLE DIALOGUE TEXT: ${line.text || "(empty)"}`);
      rows.push(`  - PROVENANCE: ${line.provenance}`);
      rows.push(`  - SOURCE EVENT ID: ${line.sourceEventId ?? "(none)"}`);
      rows.push(`  - FINAL BUBBLE: ${bubble?.text ?? "(silent)"}`);
    }
    rows.push("");
  }
  rows.push(`- FINAL WHITELIST: ${whitelist.map((text) => `"${text}"`).join(", ") || "(none)"}`);
  rows.push("");
  return rows.join("\n");
}

const malformedCount =
  countMalformedAttributionLdFixtures() + countMalformedAttributionBenchmarkCorpus();
const fakeBubbleCount = countFakeAttributionBubbleCorpus();

const keystrokePlan = (() => {
  const base = buildDeterministicScenePlan(
    buildSceneSourceMessages([{ id: 1, role: "assistant", content: '"안녕."' }]),
    2
  );
  const withLine = addPanelDialogueLine(base, 1, "persona");
  let edited = withLine;
  for (const step of ["같이", "같이 ", "같이 가", "같이 가자", "같이 가자."]) {
    edited = updatePanelDialogueAtIndex(edited, 1, 0, { text: step });
  }
  return edited;
})();

const lines = [
  "# LD Image Normalization — REVIEW PACKET",
  "",
  `**CURRENT_MAIN_SHA:** \`${MAIN_SHA}\``,
  `**GENERATED_FROM_SOURCE_SHA:** \`${GENERATED_FROM_SOURCE_SHA}\``,
  `**PR_NUMBER:** 808`,
  "",
  "## Flagship fixture",
  "",
  "### RAW SOURCE",
  "```text",
  ATTRIBUTION_SOURCE,
  "```",
  "",
  "### CANONICAL EVENTS",
  "```json",
  JSON.stringify(events, null, 2),
  "```",
  "",
  "### HERO EVENT IDS",
  plan.heroEventIds.join(", "),
  "",
  "### USER-FACING VISUAL DESCRIPTION",
  "```text",
  plan.heroScene,
  "```",
  "",
  "### DOWNSTREAM DIALOGUE (Key dialogue / panels)",
  "```text",
  illustration.split("Key dialogue")[1]?.split("\n").slice(0, 4).join("\n") ??
    plan.panels.flatMap((p) => p.dialogue.map((d) => d.text)).join("\n"),
  "```",
  "",
  "### FINAL ILLUSTRATION PROMPT (scene section excerpt)",
  "```text",
  illustration,
  "```",
  "",
  "### COMIC PANEL SPEC",
  "```text",
  comicSpec,
  "```",
  "",
  "### Arm A — legacy panel section (untruncated)",
  "```text",
  armA,
  "```",
  "",
  "### FINAL COMIC PROMPT (full, untruncated)",
  "```text",
  comicPrompt,
  "```",
  "",
  "## DIALOGUE_EDITOR_REVIEW",
  "",
  dialogueEditorSection("2-panel duo (source)", duoPlan),
  dialogueEditorSection("2-panel duo (user text edit: 그래. → 좋아.)", duoPlan, duoEdited),
  dialogueEditorSection("3-panel duo", buildDeterministicScenePlan(duoMessages, 3)),
  "",
  "## KEYSTROKE_EDIT_REVIEW",
  "",
  dialogueEditorSection("2-panel keystroke (같이 → 같이 가자.)", keystrokePlan),
  "",
  "## USER_ATTRIBUTION_REVIEW",
  "",
  (() => {
    const userAttr = buildDeterministicScenePlan(
      buildSceneSourceMessages([{ id: 1, role: "user", content: '"좋아."라고 말했다.' }]),
      2
    );
    return [
      "### Source",
      "```text",
      '"좋아."라고 말했다.',
      "```",
      "",
      `- CANONICAL DIALOGUE: ${userAttr.events.filter((e) => e.kind === "dialogue").map((e) => e.text).join(" | ")}`,
      `- FAKE ATTRIBUTION IN EVENTS: ${userAttr.events.some((e) => e.kind === "dialogue" && /라고/.test(e.text))}`,
      "",
    ].join("\n");
  })(),
  "",
  "## Invariant checks (computed)",
  "",
  `- USER_VISIBLE_NO_VERBATIM_DIALOGUE: ${!/가지 마/.test(plan.heroScene)}`,
  `- NO_DANGLING_ATTRIBUTION: ${!/라고 말했다/.test(plan.heroScene)}`,
  `- HERO_IDS_INCLUDE_DIALOGUE: ${plan.heroEventIds.some((id) => plan.events.find((e) => e.id === id)?.kind === "dialogue")}`,
  `- DOWNSTREAM_KEY_DIALOGUE: ${illustration.includes("가지 마")}`,
  `- MALFORMED_ATTRIBUTION_COUNT: ${malformedCount}`,
  `- FAKE_ATTRIBUTION_BUBBLE_COUNT: ${fakeBubbleCount}`,
  `- PANEL_TEXT_WHITELIST_MISMATCH_COUNT: ${audit.panelTextWhitelistMismatchCount}`,
  `- USER_EDIT_DIALOGUE_MISMATCH_COUNT: ${audit.userEditDialogueMismatchCount}`,
  "",
  "## Provenance semantics",
  "",
  "- UNCHANGED SOURCE LINE: provenance=source, sourceEventId preserved",
  "- TEXT OR SPEAKER EDIT: provenance=user_edit, sourceEventId removed",
  "- REORDER ONLY (unchanged text/speaker): source provenance + sourceEventId preserved; presentation order is user-controlled",
  "",
  "## AI auto panel planning",
  "",
  "**AI_AUTO_PANEL_PLANNING_STATUS:** IMPLEMENTED_COMIC_DEFAULT_ONE_CALL",
  "",
  `- CLIENT_SCENE_PLAN_REQUESTS_PER_SOURCE: 1`,
  `- LOGICAL_SCENE_PLANNER_RUNS_PER_SOURCE: 1`,
  `- MAX_PHYSICAL_PROVIDER_ATTEMPTS_PER_LOGICAL_RUN: ${SCENE_PLAN_MAX_PROVIDER_ATTEMPTS}`,
  `- ACTUAL_PRIMARY_PROVIDER: ${primaryProvider}`,
  `- ACTUAL_PRIMARY_MODEL: ${primaryModel}`,
  `- ACTUAL_FALLBACK_PROVIDER: ${fallbackProvider}`,
  `- ACTUAL_FALLBACK_MODEL: ${fallbackModel}`,
  `- PANEL_SWITCH_EXTRA_CLIENT_REQUESTS: 0`,
  `- PANEL_SWITCH_EXTRA_PROVIDER_ATTEMPTS: 0`,
  "",
  "## Scores",
  "",
  "**GPT_SCORE:** PENDING",
  "**HUMAN_SCORE:** PENDING",
  "",
  "**COMPLETION_STATUS:** (see PR system delta report after full CI green)",
  "",
];

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, lines.join("\n"), "utf8");
console.log(`Wrote ${OUT_FILE}`);
