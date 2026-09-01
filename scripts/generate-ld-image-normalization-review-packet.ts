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
  auditComicDialogueWhitelist,
  buildChatComicImagePrompt,
} from "../src/lib/chatComicGeneration";
import { renderChatComicPanelSpecSection, compileChatComicPanelSpec } from "../src/lib/chatComicPanelSpec";
import { buildLdSceneGenerationPlan } from "../src/lib/chatLdIllustrationGeneration";
import {
  applyUserPanelEdits,
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  collectApprovedComicText,
  extractDeterministicEvents,
  formatApprovedScenePlanForComic,
  formatApprovedScenePlanForIllustration,
  projectComicPanelBeat,
} from "../src/lib/chatImageScenePlan";
import { resolveChatImageSceneBriefModel } from "../src/lib/chatImageSceneBrief";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs/audits/ld-image-normalization");
const OUT_FILE = join(OUT_DIR, "REVIEW_PACKET.md");

function gitSha(ref: string): string {
  return execSync(`git rev-parse ${ref}`, { cwd: ROOT, encoding: "utf8" }).trim();
}

const MAIN_SHA = gitSha("origin/main");
const HEAD_SHA = gitSha("HEAD");
const PERSONA = "렌";
const CHARACTER = "태현";

const ATTRIBUTION_SOURCE = '태현이 렌의 손목을 붙잡고 "가지 마."라고 말했다.';
const messages = buildSceneSourceMessages([
  { id: 1, role: "assistant", content: ATTRIBUTION_SOURCE },
]);
const plan = buildDeterministicScenePlan(messages, 2);
const events = extractDeterministicEvents(messages);
const illustration = formatApprovedScenePlanForIllustration(plan);
const ld = buildLdSceneGenerationPlan({
  characterName: CHARACTER,
  characterGender: "male",
  personaName: PERSONA,
  personaGender: "female",
  characterImageUrl: "/synthetic/hero.webp",
  characterSavedAppearance: "",
  characterAppearanceMode: "image_only",
  personaImageUrl: "/synthetic/user.webp",
  personaSavedAppearance: "",
  personaAppearanceMode: "image_only",
  approvedScenePlan: plan,
  contentKind: "character",
});
const comicSpec = renderChatComicPanelSpecSection(
  compileChatComicPanelSpec({
    plan,
    personaName: PERSONA,
    characterName: CHARACTER,
  })
);
const comicPrompt = buildChatComicImagePrompt({
  characterName: CHARACTER,
  characterGender: "male",
  personaName: PERSONA,
  personaGender: "female",
  plan,
});
const armA = formatApprovedScenePlanForComic(plan);

const duoMessages = buildSceneSourceMessages([
  { id: 1, role: "user", content: '*후드 귀를 만진다*\n"같이 갈래?"' },
  { id: 2, role: "assistant", content: '렌이 후드를 만지자 태형이 고개를 돌렸다. "그래."' },
]);
const duoPlan = buildDeterministicScenePlan(duoMessages, 2);
const duoEdited = applyUserPanelEdits(duoPlan, 1, {
  dialogue: duoPlan.panels[0]!.dialogue.map((line) =>
    line.text.includes("그래")
      ? { ...line, text: "좋아.", provenance: "user_edit" as const }
      : line
  ),
});
const audit = auditComicDialogueWhitelist({
  plan: duoEdited,
  personaName: PERSONA,
  characterName: CHARACTER,
});

function dialogueEditorSection(
  label: string,
  reviewPlan: ReturnType<typeof buildDeterministicScenePlan>,
  edited?: ReturnType<typeof applyUserPanelEdits>
) {
  const active = edited ?? reviewPlan;
  const whitelist = collectApprovedComicText(active);
  const spec = compileChatComicPanelSpec({
    plan: active,
    personaName: PERSONA,
    characterName: CHARACTER,
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
      const bubble = bubbles[index];
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

const lines = [
  "# LD Image Normalization — REVIEW PACKET",
  "",
  `**CURRENT_MAIN_SHA:** \`${MAIN_SHA}\``,
  `**PR_NUMBER:** 808`,
  `**PR_HEAD_SHA:** \`${HEAD_SHA}\``,
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
  dialogueEditorSection("2-panel duo (user text edit)", duoPlan, duoEdited),
  dialogueEditorSection("3-panel duo", buildDeterministicScenePlan(duoMessages, 3)),
  "",
  "## Invariant checks (computed)",
  "",
  `- USER_VISIBLE_NO_VERBATIM_DIALOGUE: ${!/가지 마/.test(plan.heroScene)}`,
  `- NO_DANGLING_ATTRIBUTION: ${!/라고 말했다/.test(plan.heroScene)}`,
  `- HERO_IDS_INCLUDE_DIALOGUE: ${plan.heroEventIds.some((id) => plan.events.find((e) => e.id === id)?.kind === "dialogue")}`,
  `- DOWNSTREAM_KEY_DIALOGUE: ${illustration.includes("가지 마")}`,
  `- PANEL_TEXT_WHITELIST_MISMATCH_COUNT: ${audit.panelTextWhitelistMismatchCount}`,
  `- USER_EDIT_DIALOGUE_MISMATCH_COUNT: ${audit.userEditDialogueMismatchCount}`,
  "",
  "## AI auto panel planning",
  "",
  "**AI_AUTO_PANEL_PLANNING_STATUS:** IMPLEMENTED_COMIC_DEFAULT_ONE_CALL",
  "",
  `- SCENE_PLANNER_MODEL: ${resolveChatImageSceneBriefModel()}`,
  `- SCENE_PLANNER_PROVIDER: OpenRouter (via planChatImageScene / chatImageScenePlanner)`,
  `- COMIC_DEFAULT_SCENE_PLANNER_CALLS_BEFORE: 0 (manual opt-in only)`,
  `- COMIC_DEFAULT_SCENE_PLANNER_CALLS_AFTER: 1 per source session when comic mode active`,
  `- COMIC_PANEL_SWITCH_EXTRA_CALLS: 0`,
  `- IMAGE_PROVIDER_CALLS_AFTER: unchanged (1 per generation)`,
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
