#!/usr/bin/env node
/**
 * Generates docs/audits/comic-panel-spec-benchmark/REVIEW_PACKET.md
 * Run: node --import tsx scripts/generate-comic-panel-spec-review-packet.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildChatComicImagePrompt } from "../src/lib/chatComicGeneration";
import {
  compileChatComicPanelSpec,
  renderChatComicPanelSpecSection,
} from "../src/lib/chatComicPanelSpec";
import {
  COMIC_PANEL_BENCHMARK_FIXTURES,
  scenePlanForFixture,
} from "../src/lib/chatComicPanelSpec.fixtures";
import { formatApprovedScenePlanForComic } from "../src/lib/chatImageScenePlan";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs/audits/comic-panel-spec-benchmark");
const OUT_FILE = join(OUT_DIR, "REVIEW_PACKET.md");

function summarize(text: string, max = 1200): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}\n\n… (truncated ${trimmed.length - max} chars)`;
}

const sections: string[] = [
  "# Comic Panel Spec Compiler — REVIEW PACKET",
  "",
  "`QUALITY_SCORING_BY_CURSOR=false`",
  "`PROVIDER_IMAGE_CALLS=0`",
  "",
  "Compare arms:",
  "- **A (legacy):** `formatApprovedScenePlanForComic` prose block",
  "- **B (new):** `compileChatComicPanelSpec` + `renderChatComicPanelSpecSection`",
  "",
  "Scores are **PENDING** — for GPT/human review only.",
  "",
  "---",
  "",
];

for (const fixture of COMIC_PANEL_BENCHMARK_FIXTURES) {
  const plan = scenePlanForFixture(fixture);
  const spec = compileChatComicPanelSpec({
    plan,
    personaName: fixture.expectedCast.persona,
    characterName: fixture.expectedCast.character,
  });
  const armA = formatApprovedScenePlanForComic(plan);
  const armB = renderChatComicPanelSpecSection(spec);

  sections.push(`## ${fixture.id} — ${fixture.title}`);
  sections.push("");
  sections.push(`- **Format:** ${fixture.formatLabel} (${fixture.panelCount} panels)`);
  sections.push(`- **Expected cast:** A=${fixture.expectedCast.persona}, B=${fixture.expectedCast.character}`);
  sections.push(`- **Expected key beat:** ${fixture.expectedKeyBeat}`);
  sections.push(`- **Expected dialogue:** ${fixture.expectedDialogue.join(" | ") || "(silent)"}`);
  sections.push(`- **Expected progression:** ${fixture.expectedPanelProgression.join(" → ")}`);
  sections.push("");
  sections.push("### Source scene");
  sections.push("");
  sections.push("```text");
  sections.push(fixture.sourceScene);
  sections.push("```");
  sections.push("");
  sections.push("### Selected scene (ScenePlan)");
  sections.push("");
  sections.push(`- heroScene: ${plan.heroScene}`);
  sections.push(`- heroEventIds: ${plan.heroEventIds.join(", ")}`);
  sections.push(`- panelCount: ${plan.panels.length}`);
  sections.push("");
  sections.push("### Arm A — legacy panel section");
  sections.push("");
  sections.push("```text");
  sections.push(summarize(armA));
  sections.push("```");
  sections.push("");
  sections.push("### Arm B — structured panel spec section");
  sections.push("");
  sections.push("```text");
  sections.push(summarize(armB));
  sections.push("```");
  sections.push("");
  sections.push("### Full prompt panel region (Arm B integrated)");
  sections.push("");
  sections.push("```text");
  sections.push(
    summarize(
      buildChatComicImagePrompt({
        characterName: fixture.expectedCast.character,
        characterGender: "male",
        personaName: fixture.expectedCast.persona,
        personaGender: "female",
        plan,
      }).split("COMIC PANEL SPEC")[1] ?? ""
    )
  );
  sections.push("```");
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

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, sections.join("\n"), "utf8");
console.log(`Wrote ${OUT_FILE}`);
