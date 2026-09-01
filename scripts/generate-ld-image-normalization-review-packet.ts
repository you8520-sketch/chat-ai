#!/usr/bin/env node
/**
 * Generates docs/audits/ld-image-normalization/REVIEW_PACKET.md
 * Run: node --import tsx scripts/generate-ld-image-normalization-review-packet.ts
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildChatComicImagePrompt } from "../src/lib/chatComicGeneration";
import { renderChatComicPanelSpecSection, compileChatComicPanelSpec } from "../src/lib/chatComicPanelSpec";
import { buildLdSceneGenerationPlan } from "../src/lib/chatLdIllustrationGeneration";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  extractDeterministicEvents,
  formatApprovedScenePlanForIllustration,
} from "../src/lib/chatImageScenePlan";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs/audits/ld-image-normalization");
const OUT_FILE = join(OUT_DIR, "REVIEW_PACKET.md");

function gitSha(ref: string): string {
  return execSync(`git rev-parse ${ref}`, { cwd: ROOT, encoding: "utf8" }).trim();
}

const MAIN_SHA = gitSha("origin/main");
const HEAD_SHA = gitSha("HEAD");

const ATTRIBUTION_SOURCE = '태현이 렌의 손목을 붙잡고 "가지 마."라고 말했다.';
const messages = buildSceneSourceMessages([
  { id: 1, role: "assistant", content: ATTRIBUTION_SOURCE },
]);
const plan = buildDeterministicScenePlan(messages, 2);
const events = extractDeterministicEvents(messages);
const illustration = formatApprovedScenePlanForIllustration(plan);
const ld = buildLdSceneGenerationPlan({
  characterName: "태현",
  characterGender: "male",
  personaName: "렌",
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
    personaName: "렌",
    characterName: "태현",
  })
);
const comicPrompt = buildChatComicImagePrompt({
  characterName: "태현",
  characterGender: "male",
  personaName: "렌",
  personaGender: "female",
  plan,
});

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
  "### FINAL COMIC PROMPT (panel region excerpt)",
  "```text",
  comicPrompt.split("COMIC PANEL SPEC")[1]?.slice(0, 2000) ?? comicPrompt.slice(0, 2000),
  "```",
  "",
  "## Invariant checks (generated)",
  "",
  `- USER_VISIBLE_NO_VERBATIM_DIALOGUE: ${!/가지 마/.test(plan.heroScene)}`,
  `- NO_DANGLING_ATTRIBUTION: ${!/라고 말했다/.test(plan.heroScene)}`,
  `- HERO_IDS_INCLUDE_DIALOGUE: ${plan.heroEventIds.some((id) => plan.events.find((e) => e.id === id)?.kind === "dialogue")}`,
  `- DOWNSTREAM_KEY_DIALOGUE: ${illustration.includes("가지 마")}`,
  "",
  "## AI auto panel planning",
  "",
  "**AI_AUTO_PANEL_PLANNING:** NOT_IMPLEMENTED_REQUIRES_PRODUCT_DECISION",
  "",
  "Default modal open uses deterministic ScenePlan (0 provider calls). AI planner runs only when user clicks optional AI 장면 제안.",
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
