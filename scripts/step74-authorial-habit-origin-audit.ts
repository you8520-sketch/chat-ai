/**
 * Step 7.4 — Authorial Habit Origin Audit
 * Usage: npm.cmd exec tsx -- scripts/step74-authorial-habit-origin-audit.ts
 */
import "./lib/server-only-mock";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  HABIT_FIX_RECOMMENDATIONS,
  HABIT_LABELS,
  HABIT_ORIGIN_RULE_INVENTORY,
  buildProductionPromptSliceForOriginAudit,
  duplicateClusters,
  rulesForHabit,
  type HabitTarget,
} from "@/lib/authorialHabitOriginAudit";

const OUT_MD = join(process.cwd(), "output", "step74-authorial-habit-origin-audit.md");
const OUT_JSON = join(process.cwd(), "output", "step74-authorial-habit-origin-audit.json");
const HABIT_AUDIT = join(process.cwd(), "output", "authorial-habit-audit.json");

function sectionFocusOwners(): string[] {
  return [
    "NARRATION REGISTER",
    "RHYTHM",
    "SENSATION",
    "EMOTION",
    "MOVEMENT & SPACE",
    "WEBNOVEL BREATH",
    "GENERATION PROCESS",
    "SCENE CONTINUATION",
    "NARRATIVE DENSITY",
  ];
}

function loadHabitStats(): Record<string, { prevalence: number; density: number }> | null {
  if (!existsSync(HABIT_AUDIT)) return null;
  const j = JSON.parse(readFileSync(HABIT_AUDIT, "utf8")) as {
    rankedPatterns?: { id: string; label: string; prevalence: number; density: number }[];
  };
  const map: Record<string, { prevalence: number; density: number }> = {};
  for (const r of j.rankedPatterns ?? []) {
    map[r.label] = { prevalence: r.prevalence, density: r.density };
  }
  return map;
}

function mdTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const header = rows[0]!;
  const sep = header.map(() => "---");
  const body = rows.slice(1);
  return [
    `| ${header.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...body.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

function main() {
  const promptSlice = buildProductionPromptSliceForOriginAudit();
  const habitStats = loadHabitStats();
  const focus = sectionFocusOwners();

  const inventoryRows: string[][] = [
    ["Rule ID", "Owner", "위치", "습관", "영향도", "중복", "삭제 가능", "비고"],
  ];
  for (const r of HABIT_ORIGIN_RULE_INVENTORY) {
    inventoryRows.push([
      r.id,
      r.owner,
      r.section,
      r.habits.map((h) => HABIT_LABELS[h]).join("; ") || "—",
      r.impact,
      r.duplicateOf ?? "—",
      r.deletable,
      r.snippet.slice(0, 60).replace(/\|/g, "/"),
    ]);
  }

  const focusRules = HABIT_ORIGIN_RULE_INVENTORY.filter((r) =>
    focus.some((f) => r.owner.includes(f.replace(" & SPACE", "")) || r.owner === f)
  );

  const dupRows: string[][] = [["Owner block", "동일 습관 중복 요청", "습관"]];
  for (const { habit, cluster } of duplicateClusters()) {
    dupRows.push([cluster.join(" + "), cluster.length >= 3 ? "⚠ triple+" : "double", HABIT_LABELS[habit]]);
  }

  const recSections: string[] = [];
  for (const habit of Object.keys(HABIT_FIX_RECOMMENDATIONS) as HabitTarget[]) {
    const rec = HABIT_FIX_RECOMMENDATIONS[habit];
    const rules = rulesForHabit(habit);
    recSections.push(
      `### ${HABIT_LABELS[habit]}`,
      "",
      habitStats
        ? `_Corpus (Step 7.3 habit audit): see authorial-habit-audit.json_`
        : "_Run scripts/authorial-habit-audit.ts for corpus stats_",
      "",
      "**유도 Rule:**",
      ...rules.map((r) => `- \`${r.id}\` (${r.owner}, ${r.impact})`),
      "",
      `**추천:** **${rec.approach}** — ${rec.rationale}`,
      ""
    );
  }

  const focusOverlap = focusRules.filter((r) => r.habits.length > 0);
  const focusTable: string[][] = [["Section", "Rules with habit overlap", "Primary habit"]];
  for (const sec of focus) {
    const matched = focusOverlap.filter(
      (r) => r.owner.startsWith(sec.split(" ")[0]!) || r.owner === sec
    );
    if (matched.length === 0) continue;
    focusTable.push([
      sec,
      matched.map((m) => m.id).join(", "),
      [...new Set(matched.flatMap((m) => m.habits))].map((h) => HABIT_LABELS[h]).join("; "),
    ]);
  }

  const md = [
    "# Step 7.4 — Authorial Habit Origin Audit",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Corpus link (Step 7.3)",
    "",
    habitStats
      ? "Authorial habit frequencies: `output/authorial-habit-audit.md` (61 samples ≥1200 chars, 3000자+ 출력 상태)."
      : "⚠ Run `scripts/authorial-habit-audit.ts` first.",
    "",
    "## Production prompt slice audited",
    "",
    `\`${promptSlice.length.toLocaleString()}\` chars — PROSE STYLE + LENGTH + SCENE blocks.`,
    "",
    "## Full rule inventory",
    "",
    mdTable(inventoryRows),
    "",
    "## Focus sections — habit overlap",
    "",
    mdTable(focusTable),
    "",
    "## Duplicate clusters (same habit, multiple owners)",
    "",
    mdTable(dupRows),
    "",
    "## Per-habit fix recommendation (no new rules)",
    "",
    ...recSections,
    "",
    "## Notes",
    "",
    "- **REGISTER / RHYTHM:** 대상 습관 직접 유인 약함 — 유지.",
    "- **TERMINAL 3200+ floor:** 습관 원인은 아니나 pad 반복 **증폭기** — Removal 불가, LENGTH/Merge로 pad 다양화.",
    "- **NO GENERIC REACTIONS** vs **EMOTION 침묵:** 충돌 — Merge/Rewrite 대상.",
    "",
  ].join("\n");

  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  writeFileSync(OUT_MD, md);
  writeFileSync(
    OUT_JSON,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        promptSliceChars: promptSlice.length,
        inventory: HABIT_ORIGIN_RULE_INVENTORY,
        recommendations: HABIT_FIX_RECOMMENDATIONS,
        duplicateClusters: duplicateClusters(),
        focusSections: focus,
      },
      null,
      2
    )
  );

  console.log(`Report: ${OUT_MD}`);
}

main();
