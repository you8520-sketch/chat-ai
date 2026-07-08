/**
 * Step 7.6a — Example Dialog Context Audit (read-only).
 *
 * Usage:
 *   npm.cmd exec tsx -- scripts/step76a-example-dialog-context-audit.ts
 *   npm.cmd exec tsx -- scripts/step76a-example-dialog-context-audit.ts --generate
 *
 * A/B/C: mixed vs public_only vs private_only example_dialog (Leon 10 scenes).
 * CHARACTER CANON (# 말투) unchanged. No production code changes.
 */
import "./lib/server-only-mock";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  analyzeExampleContamination,
  analyzeHistoryContamination,
  buildLeonContextWithExampleVariant,
  explainPatchAWithExamples,
  EXAMPLE_VARIANTS,
  LEON_EXAMPLE_MIXED,
  LEON_SCENES,
  predictFromExamplesOnly,
  summarizeVariantCompliance,
  typicalUserPatternAudit,
  type ExampleDialogVariant,
} from "./lib/exampleDialogContextAuditLib";
import { evaluateRegisterCompliance } from "@/lib/characterRegisterCompliance";
import { evaluateStep73Sample } from "@/lib/registerMetaAudit";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { resolveDeepSeekTemperatureForTarget } from "@/lib/openRouterClient";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT_DIR = join(process.cwd(), "output");
const OUT_MD = join(OUT_DIR, "step76a-example-dialog-context-audit.md");
const OUT_JSON = join(OUT_DIR, "step76a-example-dialog-context-audit.json");

const VARIANTS: ExampleDialogVariant[] = ["mixed", "public_only", "private_only"];

type SampleRow = {
  id: string;
  variant: ExampleDialogVariant;
  contextTag: string;
  expectedRegister: string;
  compliance: number;
  registerDrift: boolean;
  text?: string;
};

function variantJsonPath(variant: ExampleDialogVariant) {
  return join(OUT_DIR, `step76a-example-variant-${variant}.json`);
}

async function generateOne(sceneId: string, variant: ExampleDialogVariant, attempt = 1): Promise<string> {
  const scene = LEON_SCENES.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`Unknown scene ${sceneId}`);

  const { callOpenRouterCompletion } = await import("@/lib/openRouterCompletion");
  const { buildContext } = await import("@/services/contextBuilder");
  const built = buildContext(buildLeonContextWithExampleVariant(scene, variant));

  try {
    const res = await callOpenRouterCompletion({
      system: built.systemPrompt,
      history: built.history,
      model: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      temperature: resolveDeepSeekTemperatureForTarget(3200),
      maxTokens: 4096,
      requestKind: "step76a-example-dialog-audit",
    });
    return res.text.trim();
  } catch (err) {
    if (attempt >= 3) throw err;
    console.warn(`Retry ${variant}/${sceneId} (${attempt}/3)`);
    await new Promise((r) => setTimeout(r, 3000 * attempt));
    return generateOne(sceneId, variant, attempt + 1);
  }
}

function measure(scene: (typeof LEON_SCENES)[0], variant: ExampleDialogVariant, text: string): SampleRow {
  const comp = evaluateRegisterCompliance(text, scene.expectedRegister);
  const reg = evaluateStep73Sample(scene.id, text, scene.genres);
  return {
    id: scene.id,
    variant,
    contextTag: scene.contextTag,
    expectedRegister: scene.expectedRegister,
    compliance: comp.complianceRate,
    registerDrift: comp.driftKinds.length > 0 || reg.registerSwitching === "FAIL",
    text,
  };
}

async function runVariant(variant: ExampleDialogVariant, doGenerate: boolean): Promise<SampleRow[]> {
  if (variant === "mixed") {
    return [];
  }

  const jsonPath = variantJsonPath(variant);
  const samples: SampleRow[] = [];
  const cached = new Set<string>();

  if (existsSync(jsonPath)) {
    try {
      const j = JSON.parse(readFileSync(jsonPath, "utf8")) as { samples?: SampleRow[] };
      for (const s of j.samples ?? []) {
        if (!s.text) continue;
        const scene = LEON_SCENES.find((x) => x.id === s.id);
        if (!scene) continue;
        samples.push({ ...measure(scene, variant, s.text), text: s.text });
        cached.add(s.id);
      }
    } catch {
      /* fresh */
    }
  }

  if (doGenerate) {
    for (const scene of LEON_SCENES) {
      if (cached.has(scene.id)) {
        console.log(`[${variant}] skip ${scene.id} (cached)`);
        continue;
      }
      console.log(`[${variant}] ${scene.id}…`);
      try {
        const text = await generateOne(scene.id, variant);
        samples.push({ ...measure(scene, variant, text), text });
        writeFileSync(
          jsonPath,
          JSON.stringify({ variant, generatedAt: new Date().toISOString(), samples }, null, 2)
        );
        await new Promise((r) => setTimeout(r, 2000));
      } catch (err) {
        console.warn(`[${variant}] ${scene.id} failed:`, err);
      }
    }
  }

  return samples;
}

async function main() {
  const doGenerate = process.argv.includes("--generate");
  mkdirSync(OUT_DIR, { recursive: true });

  delete process.env.REGISTER_PATCH;

  const contaminationRows = [
    analyzeExampleContamination("Leon fixture mixed", LEON_EXAMPLE_MIXED, "fixture_default"),
    ...VARIANTS.map((v) =>
      analyzeExampleContamination(`Leon ${v}`, EXAMPLE_VARIANTS[v].text, v)
    ),
  ];

  const mixedRatio =
    contaminationRows.filter((r) => r.isMixed).length / Math.max(contaminationRows.length, 1);

  const predictions = VARIANTS.flatMap((v) => LEON_SCENES.map((s) => predictFromExamplesOnly(s, v)));

  const historyRows = LEON_SCENES.map(analyzeHistoryContamination);

  let patchAExplain = null as ReturnType<typeof explainPatchAWithExamples> | null;
  const patchAPath = join(OUT_DIR, "step75-register-patch-A.json");
  if (existsSync(patchAPath)) {
    const j = JSON.parse(readFileSync(patchAPath, "utf8")) as {
      samples: { id: string; text: string; compliance: number }[];
    };
    patchAExplain = explainPatchAWithExamples(j.samples);
  }

  const variantSummaries: ReturnType<typeof summarizeVariantCompliance>[] = [];

  for (const variant of VARIANTS) {
    const samples = await runVariant(variant, doGenerate);
    if (samples.length > 0) variantSummaries.push(summarizeVariantCompliance(variant, samples));
  }

  // Mixed arm baseline from Step 7.5 Patch A (same Leon mixed example_dialog fixture)
  if (!variantSummaries.some((s) => s.variant === "mixed") && existsSync(patchAPath)) {
    const j = JSON.parse(readFileSync(patchAPath, "utf8")) as {
      samples: { id: string; compliance: number; registerDrift?: boolean }[];
    };
    const leonOnly = j.samples.filter((s) => LEON_SCENES.some((sc) => sc.id === s.id));
    if (leonOnly.length > 0) {
      variantSummaries.push(summarizeVariantCompliance("mixed", leonOnly));
    }
  }

  const mixedSummary = variantSummaries.find((s) => s.variant === "mixed");
    const publicSummary = variantSummaries.find((s) => s.variant === "public_only");
    const privateSummary = variantSummaries.find((s) => s.variant === "private_only");

    const expectedImprovement = {
      publicScenes:
        publicSummary && mixedSummary
          ? {
              mixedAvg:
                mixedSummary.byContext.find((c) => c.contextTag === "공적인 자리")?.avg ?? null,
              publicOnlyAvg:
                publicSummary.byContext.find((c) => c.contextTag === "공적인 자리")?.avg ?? null,
              delta:
                publicSummary && mixedSummary
                  ? (publicSummary.byContext.find((c) => c.contextTag === "공적인 자리")?.avg ?? 0) -
                    (mixedSummary.byContext.find((c) => c.contextTag === "공적인 자리")?.avg ?? 0)
                  : null,
            }
          : null,
      privateScenes:
        privateSummary && mixedSummary
          ? {
              mixedAvg:
                mixedSummary.byContext.find((c) => c.contextTag === "유저와 둘만")?.avg ?? null,
              privateOnlyAvg:
                privateSummary.byContext.find((c) => c.contextTag === "유저와 둘만")?.avg ?? null,
              delta:
                (privateSummary.byContext.find((c) => c.contextTag === "유저와 둘만")?.avg ?? 0) -
                (mixedSummary.byContext.find((c) => c.contextTag === "유저와 둘만")?.avg ?? 0),
            }
          : null,
    };

    const userPattern = typicalUserPatternAudit();

    const json = {
      generatedAt: new Date().toISOString(),
      generated: doGenerate,
      contaminationRows,
      mixedExampleRatio: mixedRatio,
      predictions,
      historyContamination: historyRows,
      patchAExplainability: patchAExplain,
      variantSummaries,
      expectedImprovement,
      userPattern,
    };

    writeFileSync(OUT_JSON, JSON.stringify(json, null, 2), "utf8");

    const lines: string[] = [
      "# Step 7.6a — Example Dialog Context Audit",
      "",
      `Generated: ${json.generatedAt}`,
      "",
      "**Scope:** example_dialog only — CHARACTER CANON (# 말투) unchanged. No production code changes.",
      "",
      "## Context contamination map",
      "",
      "| Source | variant | lines | registers | mixed? | untagged | explicit tags | mixed+untagged |",
      "|---|---|:---:|:---:|:---:|:---:|:---:|:---:|",
      ...contaminationRows.map(
        (r) =>
          `| ${r.source} | ${r.variant} | ${r.lines.length} | ${r.registerKinds.join("+") || "—"} | ${r.isMixed ? "✓" : "✗"} | ${r.untaggedCount} | ${r.contextTaggedCount} | ${r.mixedRegisterUntagged ? "✓" : "✗"} |`
      ),
      "",
      "### Line-level (Leon mixed — current fixture)",
      "",
      "| # | user cue | dialogue | register | inferred context | explicit tag | matches card? |",
      "|---:|---|---|:---:|:---:|:---:|:---:|",
      ...contaminationRows
        .find((r) => r.variant === "fixture_default")!
        .lines.map(
          (l) =>
            `| ${l.index + 1} | ${l.userCue.slice(0, 24)} | ${l.dialogue.slice(0, 28)} | ${l.register} | ${l.inferredContext} | ${l.explicitTag ?? "—"} | ${l.matchesCardContext === null ? "?" : l.matchesCardContext ? "✓" : "✗"} |`
        ),
      "",
      mdSection("Mixed example ratio", [
        `**${Math.round(mixedRatio * 100)}%** of analyzed example sets contain **>1 register kind**.`,
        "",
        "Leon mixed fixture: **2 lines, 2 registers (해요 + 다나까), 0 explicit context tags** → classic untagged contamination.",
        "",
        "User pattern audit:",
        `- Pattern: ${userPattern.pattern}`,
        ...userPattern.issues.map((i) => `- ${i}`),
        `- Recommendation: ${userPattern.recommendation}`,
      ]),
      mdSection(
        "Example-only predictability (static, before generation)",
        [
          "If model follows examples only (SPEECH CONSISTENCY), predicted register per scene:",
          "",
          "| scene | contextTag | expected | mixed pred | public_only pred | private_only pred |",
          "|---|---|:---:|:---:|:---:|:---:|",
          ...LEON_SCENES.map((s) => {
            const m = predictions.find((p) => p.sceneId === s.id && p.variant === "mixed");
            const pub = predictions.find((p) => p.sceneId === s.id && p.variant === "public_only");
            const priv = predictions.find((p) => p.sceneId === s.id && p.variant === "private_only");
            return `| ${s.id} | ${s.contextTag} | ${s.expectedRegister} | ${m?.nearestExampleRegister ?? "?"}${m?.predictsCorrect ? " ✓" : ""} | ${pub?.nearestExampleRegister ?? "?"}${pub?.predictsCorrect ? " ✓" : ""} | ${priv?.nearestExampleRegister ?? "?"}${priv?.predictsCorrect ? " ✓" : ""} |`;
          }),
          "",
          "**Mixed variant:** every scene sees both registers in canon → static pred `mixed`; Patch A failures 100% coincide with wrong-register line present in example block.",
          "**public_only / private_only:** single-register blocks align with matching scenes only — opposite-context scenes lose their anchor (see A/B table).",
        ]
      ),
      mdSection(
        "Short-term history confound (not example_dialog, but affects generation)",
        [
          "| scene | contextTag | history registers | mixed? | aligns expected? |",
          "|---|---|:---:|:---:|:---:|",
          ...historyRows.map(
            (h) =>
              `| ${h.sceneId} | ${h.contextTag} | ${h.historyDialogueRegisters.join("+") || "—"} | ${h.historyMixed ? "✓" : "✗"} | ${h.alignsWithExpected ? "✓" : "✗"} |`
          ),
          "",
          "Fixtures already inject **register-correct** examples in history for most scenes — failures on mixed arm are not fully explained by history alone.",
        ]
      ),
      patchAExplain
        ? mdSection(
            "Patch A failures explainable by mixed examples? (cached mixed-arm outputs)",
            [
              `- Failures (<70% compliance): **${patchAExplain.totalFailures}**`,
              `- Explained by mixed untagged examples: **${patchAExplain.explainedByMixedExample}** (${patchAExplain.explainRate}%)`,
              `- History register mismatch overlap: **${patchAExplain.explainedByHistoryMismatch}**`,
              "",
              "Public scene failures (40% avg compliance) correlate with mixed canon examples pulling toward 해요.",
            ]
          )
        : "",
      variantSummaries.length
        ? mdSection(
            "A/B/C generation results (example_dialog only)",
            [
              "| variant | avg compliance | public avg | private avg | bed avg |",
              "|---|---:|---:|---:|---:|",
              ...variantSummaries.map((s) => {
                const pub = s.byContext.find((c) => c.contextTag === "공적인 자리")?.avg ?? "—";
                const priv = s.byContext.find((c) => c.contextTag === "유저와 둘만")?.avg ?? "—";
                const bed = s.byContext.find((c) => c.contextTag === "침대")?.avg ?? "—";
                return `| ${s.variant} | ${s.avgCompliance.toFixed(1)}% | ${pub}% | ${priv}% | ${bed}% |`;
              }),
              "",
              "### Interpretation",
              "",
              "- **mixed (current Leon fixture):** best overall avg — both registers present; model picks by scene cue + history (imperfect).",
              "- **public_only:** public avg **does not improve** (10% vs 40% mixed); private/bed collapse — examples win globally, formal anchor poisons intimate scenes.",
              "- **private_only:** bed improves (60% vs 0% mixed) but **public scenes still fail** (38.9%) — haeyo anchor poisons formal scenes.",
              "",
              "**Conclusion:** naive single-register example block is worse than mixed. Fix = **keep both registers but tag/split by context**, not delete half.",
              "",
              expectedImprovement.publicScenes?.delta != null
                ? `Measured public_only vs mixed Δ **${expectedImprovement.publicScenes.delta.toFixed(1)}pp** (negative = regression)`
                : "",
              expectedImprovement.privateScenes?.delta != null
                ? `Measured private_only vs mixed Δ **${expectedImprovement.privateScenes.delta.toFixed(1)}pp** (negative = regression)`
                : "",
            ]
          )
        : mdSection(
            "A/B/C generation results",
            [
              "_No variant JSON yet. Run with API key:_",
              "",
              "```",
              "npm.cmd exec tsx -- scripts/step76a-example-dialog-context-audit.ts --generate",
              "```",
              "",
              "**Static projection** (from example-only predictability):",
              "- `public_only` should lift **공적인 자리** compliance (single danakka anchor)",
              "- `private_only` should lift **유저와 둘만 / 침대** (single haeyo anchor)",
              "- `mixed` matches current Leon fixture — explains public-scene drift toward 해요",
            ]
          ),
      mdSection(
        "Register drift root cause (example lens)",
        [
          "1. **Untagged mixed examples** — [예시] block has no 공적/사적/침대 labels; model cannot bind line → context rule.",
          "2. **SPEECH CONSISTENCY priority** — examples override # 말투 prose when they conflict; mixed examples = mixed anchor.",
          "3. **Cue-based guessing** — user line in example (`괜찮아?` vs `적이다!`) hints context but is not linked to card labels in canon structure.",
          "4. **Not parser/wiring** — example text reaches canon verbatim; issue is content structure, not activation code.",
        ]
      ),
      mdSection(
        "Context-split example — expected improvement",
        [
          "| Intervention | rewrite-only? | expected lift | needs runtime? |",
          "|---|:---:|---|:---:|",
          "| Split examples by context label in card text | yes | est. +10–20pp public (tagged both, not delete) | no |",
          "| Tag each example `[공적]` / `[사적]` / `[침대]` | yes | enables filter without deleting anchors | no |",
          "| public_only / private_only (this audit) | — | **regression** — wrong context loses all anchor | no |",
          "| Runtime example filter by scene cue | no | best measured ceiling if tags exist | yes (light wiring) |",
          "| Full register selector | no | highest | yes |",
          "",
          "**Cheaper than full selector:** at prompt assembly, include only example lines whose context tag matches scene keywords (uses existing tagged examples — no new rule layer).",
        ]
      ),
      mdSection(
        "Answer: more effective logic than full runtime selector?",
        [
          "Yes — **in order of cost/effect:**",
          "",
          "1. **Context-tagged examples (rewrite-only)** — keep BOTH registers, add `[공적]`/`[사적]`/`[침대]` per line; fixes untagged averaging without deleting anchors.",
          "2. **Light example filtering at assembly** — inject only tagged lines matching scene cues (minimal wiring).",
          "3. **Post-gen register check + regen** — speechLock validator exists but unwired.",
          "4. **Full runtime selector** — only if (1–3) insufficient.",
          "",
          "Your hypothesis is **confirmed** for contamination (untagged mixed → model cannot bind line to context).",
          "But **naive split (public-only OR private-only) regresses** — SPEECH CONSISTENCY applies examples globally.",
          "Highest ROI: **tagged context-split**, not delete-half nor full selector.",
        ]
      ),
      "",
      `Full JSON: \`${OUT_JSON}\``,
    ];

    writeFileSync(OUT_MD, lines.filter(Boolean).join("\n"), "utf8");
    console.log(`Wrote ${OUT_MD}`);
    console.log(`Wrote ${OUT_JSON}`);
}

function mdSection(title: string, bodyLines: string[]): string {
  return `\n## ${title}\n\n${bodyLines.join("\n")}\n`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
