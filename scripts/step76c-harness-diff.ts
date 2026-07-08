/**
 * Diff fixture-only vs staging-path prompts for holdout scenes.
 *
 * Usage:
 *   npm.cmd exec tsx -- scripts/step76c-harness-diff.ts
 */
import "./lib/server-only-mock";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  buildLeonContextWithExampleVariant,
  LEON_SCENES,
} from "./lib/exampleDialogContextAuditLib";
import { buildStagingContextFromDb } from "./lib/step76LeonStagingContext";
import { buildContext } from "@/services/contextBuilder";
import { extractExampleDialogSectionBody } from "@/lib/exampleDialogSceneFilter";
import { collectCharacterSettingText } from "@/lib/bodyHairRules";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}
if (!process.env.DATA_DIR) {
  process.env.DATA_DIR = "data";
}

const OUT = join(process.cwd(), "output", "step76c-harness-diff.md");
const SCENE_IDS = ["leon-private-0", "leon-bed-alt"];

const LEON_BED_ALT = {
  id: "leon-bed-alt",
  character: "leon" as const,
  label: "침대·이불",
  genres: ["판타지/SF", "로맨스 판타지"] as const,
  expectedRegister: "haeyo" as const,
  contextTag: "침대",
  currentUserMessage: "렌: …이불, 같이 덮을래?",
  shortTermHistory: [
    { role: "user" as const, content: "…방 불 좀 어둡게 할까?" },
    { role: "assistant" as const, content: `레온은 잠시 망설이다 고개를 끄덕였다.\n\n"…그래요."` },
  ],
};

function resolveScene(sceneId: string) {
  if (sceneId === "leon-bed-alt") return LEON_BED_ALT;
  return LEON_SCENES.find((s) => s.id === sceneId);
}

function exampleDialogSnippet(systemPrompt: string): string {
  const m = systemPrompt.match(/\[예시 대화\]\s*([\s\S]{0,800})/);
  return (m?.[1] ?? "(missing)").trim();
}

function firstDiffIndex(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : n;
}

function diffBlock(label: string, fixtureSys: string, stagingSys: string): string[] {
  const idx = firstDiffIndex(fixtureSys, stagingSys);
  const lines = [
    `### ${label}`,
    "",
    `| path | system chars | example_dialog snippet chars |`,
    `|------|--------------|------------------------------|`,
    `| fixture-only | ${fixtureSys.length} | ${exampleDialogSnippet(fixtureSys).length} |`,
    `| staging (DB Leon) | ${stagingSys.length} | ${exampleDialogSnippet(stagingSys).length} |`,
    "",
  ];
  if (idx >= 0) {
    lines.push(
      `First diff at char **${idx}**:`,
      "",
      "```",
      `fixture: …${fixtureSys.slice(Math.max(0, idx - 40), idx + 120)}…`,
      `staging: …${stagingSys.slice(Math.max(0, idx - 40), idx + 120)}…`,
      "```",
      ""
    );
  } else if (fixtureSys.length !== stagingSys.length) {
    lines.push(`Same prefix; length delta ${stagingSys.length - fixtureSys.length}`, "");
  } else {
    lines.push("**Identical** system prompts.", "");
  }
  return lines;
}

function main() {
  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  const md: string[] = [
    "# Step 7.6c — Harness path diff (fixture vs staging DB Leon)",
    "",
    `Generated: ${new Date().toISOString()}`,
    `DATA_DIR: ${process.env.DATA_DIR}`,
    "",
    "Staging rollout tagged arm uses **DB Leon + EXAMPLE_DIALOG_SCENE_FILTER=1**.",
    "Prior independence gate tagged arm used **fixture tagged + filter** — not the same path.",
    "",
  ];

  for (const sceneId of SCENE_IDS) {
    const scene = resolveScene(sceneId);
    if (!scene) {
      md.push(`## ${sceneId}`, "", "Scene not found.", "");
      continue;
    }
    md.push(`## ${sceneId}`, "");

    // Mixed — staging also uses fixture mixed (step76b)
    const fixtureMixed = buildContext(buildLeonContextWithExampleVariant(scene, "mixed"));
    md.push(...diffBlock("mixed_baseline (both paths use fixture mixed in step76b)", fixtureMixed.systemPrompt, fixtureMixed.systemPrompt));

    // Tagged — the critical diff
    process.env.EXAMPLE_DIALOG_SCENE_FILTER = "1";
    const fixtureTagged = buildContext(buildLeonContextWithExampleVariant(scene, "tagged"));
    const stagingTagged = buildContext(buildStagingContextFromDb(scene));
    md.push(...diffBlock("tagged+filter (FIX vs DB — this was the bug)", fixtureTagged.systemPrompt, stagingTagged.systemPrompt));

    const fixtureEx = extractExampleDialogSectionBody(collectCharacterSettingText(buildLeonContextWithExampleVariant(scene, "tagged").chunks)) ?? "";
    const stagingEx = extractExampleDialogSectionBody(collectCharacterSettingText(buildStagingContextFromDb(scene).chunks)) ?? "";
    md.push(
      "**Filtered example_dialog body (tagged arm):**",
      "",
      `- fixture tagged filtered: ${fixtureEx.length} chars`,
      `- DB Leon filtered: ${stagingEx.length} chars`,
      "",
      fixtureEx !== stagingEx
        ? "Example blocks **differ** (canon / chunk assembly not identical)."
        : "Filtered example blocks **match** — diff is elsewhere in system prompt (canon chunks, world, speech rules).",
      ""
    );
  }

  writeFileSync(OUT, md.join("\n"));
  console.log(`Wrote ${OUT}`);
}

main();
