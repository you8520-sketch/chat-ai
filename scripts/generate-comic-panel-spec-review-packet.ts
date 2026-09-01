#!/usr/bin/env node
/**
 * Generates docs/audits/comic-panel-spec-benchmark/REVIEW_PACKET.md
 * Run: node --import tsx scripts/generate-comic-panel-spec-review-packet.ts
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileChatComicPanelSpec,
  countActionDirectiveDuplicates,
  renderChatComicPanelSpecSection,
} from "../src/lib/chatComicPanelSpec";
import {
  buildProductionDuoGenerationPlanForFixture,
  compilerOnlyDuoVisualSubjects,
  COMIC_PANEL_BENCHMARK_FIXTURES,
  PRODUCTION_COMIC_TEMPLATE_URL,
  scenePlanForFixture,
} from "../src/lib/chatComicPanelSpec.fixtures";
import { formatApprovedScenePlanForComic } from "../src/lib/chatImageScenePlan";
import {
  auditPromptIdentityBinding,
  buildPromptSubjectMap,
  productionReferenceOwnerMap,
} from "../src/lib/chatImagePromptSubjectMap";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs/audits/comic-panel-spec-benchmark");
const OUT_FILE = join(OUT_DIR, "REVIEW_PACKET.md");

function gitSha(ref: string): string {
  return execSync(`git rev-parse ${ref}`, { cwd: ROOT, encoding: "utf8" }).trim();
}

const CURRENT_MAIN_SHA = gitSha("origin/main");
const GENERATED_FROM_SOURCE_SHA = gitSha("HEAD");

const FULL_PROMPT_FIXTURE_IDS = new Set([
  "F01-2panel-invite",
  "F04-3koma-rain",
  "F08-4panel-chase",
]);

const sections: string[] = [
  "# Comic Panel Spec Compiler — REVIEW PACKET",
  "",
  "`QUALITY_SCORING_BY_CURSOR=false`",
  "`PROVIDER_IMAGE_CALLS=0`",
  "",
  `- **CURRENT_MAIN_SHA:** \`${CURRENT_MAIN_SHA}\``,
  `- **GENERATED_FROM_SOURCE_SHA:** \`${GENERATED_FROM_SOURCE_SHA}\``,
  "",
  "Compare arms:",
  "- **A (legacy):** `formatApprovedScenePlanForComic` prose block",
  "- **B (new):** `compileChatComicPanelSpec` + `renderChatComicPanelSpecSection` (compiler-only subjects)",
  "- **FULL PROMPT:** `buildChatComicGenerationPlan()` production path",
  "",
  "Scores are **PENDING** — for GPT/human review only.",
  "",
  "---",
  "",
];

let truncationCount = 0;
let subjectLabelConflictTotal = 0;
let referenceOwnerConflictTotal = 0;
let templateReferenceOwnerConflictTotal = 0;
let referenceSlotConflictTotal = 0;
let actionOwnerConflictTotal = 0;
let speechOwnerConflictTotal = 0;
let actionDuplicateCount = 0;
let legacyGenreLabelCount = 0;

for (const fixture of COMIC_PANEL_BENCHMARK_FIXTURES) {
  const plan = scenePlanForFixture(fixture);
  const production = buildProductionDuoGenerationPlanForFixture({
    plan,
    characterName: fixture.expectedCast.character,
    personaName: fixture.expectedCast.persona,
  });
  const compilerSubjects = compilerOnlyDuoVisualSubjects({
    characterName: fixture.expectedCast.character,
    personaName: fixture.expectedCast.persona,
  });
  const subjectMap = buildPromptSubjectMap(production.subjects);
  const spec = compileChatComicPanelSpec({
    plan,
    personaName: fixture.expectedCast.persona,
    characterName: fixture.expectedCast.character,
    subjects: production.subjects,
  });
  const armA = formatApprovedScenePlanForComic(plan);
  const armB = renderChatComicPanelSpecSection(spec);
  const fullPrompt = production.prompt;
  const panelRegion = fullPrompt.split("COMIC PANEL SPEC")[1] ?? fullPrompt;
  const identityAudit = auditPromptIdentityBinding(fullPrompt);
  const productionRefs = productionReferenceOwnerMap({
    referenceUrls: production.referenceUrls,
    subjects: production.subjects,
    templateUrl: PRODUCTION_COMIC_TEMPLATE_URL,
  });

  subjectLabelConflictTotal += identityAudit.subjectLabelConflictCount;
  referenceOwnerConflictTotal += identityAudit.referenceOwnerConflictCount;
  templateReferenceOwnerConflictTotal += identityAudit.templateReferenceOwnerConflictCount;
  referenceSlotConflictTotal += identityAudit.referenceSlotConflictCount;
  actionOwnerConflictTotal += identityAudit.actionOwnerConflictCount;
  speechOwnerConflictTotal += identityAudit.speechOwnerConflictCount;
  actionDuplicateCount += countActionDirectiveDuplicates(spec);
  if (
    fixture.expectedPanelProgression.some((label) =>
      /punchline|Climax|Escalation|Turn|Setup|Payoff|Establish|Resolution|Development/i.test(label)
    )
  ) {
    legacyGenreLabelCount += 1;
  }

  sections.push(`## ${fixture.id} — ${fixture.title}`);
  sections.push("");
  sections.push(`- **Format:** ${fixture.formatLabel} (${fixture.panelCount} panels)`);
  if (FULL_PROMPT_FIXTURE_IDS.has(fixture.id)) {
    sections.push("- **PRODUCTION REFERENCE MAP:**");
    for (const ref of productionRefs) {
      sections.push(`  - Image ${ref.image} → ${ref.owner}`);
    }
    sections.push("- **CANONICAL SUBJECT MAP:**");
    for (const subject of subjectMap.subjects) {
      sections.push(`  - ${subject.label} → ${subject.name} (${subject.role})`);
    }
  } else {
    sections.push(
      `- **Compiler-only subject map:** ${subjectMap.subjects.map((subject) => `${subject.label}=${subject.name}`).join(", ")}`
    );
  }
  sections.push(`- **Expected key beat:** ${fixture.expectedKeyBeat}`);
  sections.push(`- **Expected dialogue:** ${fixture.expectedDialogue.join(" | ") || "(silent)"}`);
  sections.push(`- **Expected progression:** ${fixture.expectedPanelProgression.join(" → ")}`);
  sections.push(
    `- **Identity audit:** SUBJECT_LABEL=${identityAudit.subjectLabelConflictCount}, TEMPLATE_SLOT=${identityAudit.templateReferenceOwnerConflictCount}, REF_SLOT=${identityAudit.referenceSlotConflictCount}, ACTION=${identityAudit.actionOwnerConflictCount}, SPEECH=${identityAudit.speechOwnerConflictCount}`
  );
  sections.push("");
  sections.push("### Source scene");
  sections.push("");
  sections.push("```text");
  sections.push(fixture.sourceScene);
  sections.push("```");
  sections.push("");
  sections.push("### Selected scene (ScenePlan summary, untruncated)");
  sections.push("");
  sections.push(`- heroScene: ${plan.heroScene}`);
  sections.push(`- heroEventIds: ${plan.heroEventIds.join(", ")}`);
  sections.push(`- panelCount: ${plan.panels.length}`);
  for (const panel of plan.panels) {
    sections.push(
      `- panel ${panel.index}: ${panel.situation} | dialogue: ${panel.dialogue.map((line) => `${line.speaker}:"${line.text}"`).join(", ") || "(silent)"}`
    );
  }
  if (fixture.id === "F04-3koma-rain") {
    sections.push("");
    sections.push("### F04 umbrella action audit");
    sections.push("");
    const hasInEvents = plan.events.some((event) => event.text.includes("서연이 우산을"));
    sections.push(`- F04_SOURCE_ACTION_PRESENT_IN_EVENTS: ${hasInEvents}`);
    sections.push(`- F04_SOURCE_ACTION_PRESENT_IN_PLAN: ${plan.panels.some((panel) => panel.situation.includes("서연이 우산을"))}`);
    const closing = spec.panels[2];
    const panelText = [
      closing?.situation ?? "",
      closing?.sceneAction ?? "",
      ...(closing?.subjectActions.map((action) => action.text) ?? []),
    ].join(" ");
    sections.push(`- F04_SOURCE_ACTION_PRESENT_IN_FINAL_PANEL_SPEC: ${panelText.includes("서연이 우산을")}`);
  }
  if (fixture.id === "F08-4panel-chase") {
    const closing = plan.panels[3];
    sections.push("");
    sections.push("### F08 closing action audit");
    sections.push("");
    sections.push(`- SOURCE CLOSING ACTION: 한별이 코너에서 시우의 소매를 붙잡는다.`);
    sections.push(`- PANEL 4 situation: ${closing?.situation ?? "(missing)"}`);
    sections.push(
      `- PANEL 4 subjectActions: ${spec.panels[3]?.subjectActions.map((action) => `${action.label}/${action.name}: ${action.text}`).join(" | ") || "(none)"}`
    );
    sections.push(`- PANEL 4 sceneAction: ${spec.panels[3]?.sceneAction ?? "(none)"}`);
  }
  sections.push("");
  sections.push("### Arm A — legacy panel section (untruncated)");
  sections.push("");
  sections.push("```text");
  sections.push(armA);
  sections.push("```");
  sections.push("");
  sections.push("### Arm B — structured panel spec section (compiler-only subjects, untruncated)");
  sections.push("");
  sections.push("```text");
  sections.push(armB);
  sections.push("```");
  sections.push("");
  if (FULL_PROMPT_FIXTURE_IDS.has(fixture.id)) {
    sections.push("### FULL FINAL ASSEMBLED PROMPT — production `buildChatComicGenerationPlan()` (untruncated)");
    sections.push("");
    sections.push("```text");
    sections.push(fullPrompt);
    sections.push("```");
  } else {
    sections.push("### Full prompt panel region (production path, untruncated)");
    sections.push("");
    sections.push("```text");
    sections.push(panelRegion);
    sections.push("```");
  }
  sections.push("");
  sections.push("### Results");
  sections.push("");
  sections.push("- **GPT SCORE:** PENDING");
  sections.push("- **HUMAN SCORE:** PENDING");
  sections.push("- **Notes:** Compare panel clarity, cast layout, bubble separation, continuity rules.");
  sections.push("");
  sections.push("---");
  sections.push("");
}

sections.push("## Audit counters");
sections.push("");
sections.push(`- ACTION_DIRECTIVE_DUPLICATE_COUNT: ${actionDuplicateCount}`);
sections.push(`- REVIEW_ARTIFACT_LEGACY_GENRE_LABEL_COUNT: ${legacyGenreLabelCount}`);
sections.push(`- REVIEW_PACKET_TRUNCATION_COUNT: ${truncationCount}`);
sections.push(`- SUBJECT_LABEL_CONFLICT_COUNT: ${subjectLabelConflictTotal}`);
sections.push(`- REFERENCE_OWNER_CONFLICT_COUNT: ${referenceOwnerConflictTotal}`);
sections.push(`- TEMPLATE_REFERENCE_OWNER_CONFLICT_COUNT: ${templateReferenceOwnerConflictTotal}`);
sections.push(`- REFERENCE_SLOT_CONFLICT_COUNT: ${referenceSlotConflictTotal}`);
sections.push(`- ACTION_OWNER_CONFLICT_COUNT: ${actionOwnerConflictTotal}`);
sections.push(`- SPEECH_OWNER_CONFLICT_COUNT: ${speechOwnerConflictTotal}`);
sections.push("");

mkdirSync(OUT_DIR, { recursive: true });
const output = sections.join("\n").split("\n").map((line) => line.replace(/\s+$/, "")).join("\n");
writeFileSync(OUT_FILE, output, "utf8");
console.log(`Wrote ${OUT_FILE}`);
