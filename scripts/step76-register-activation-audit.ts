/**
 * Step 7.6 — Character Register Activation Audit (read-only).
 *
 * Usage: npm.cmd exec tsx -- scripts/step76-register-activation-audit.ts
 */
import "./lib/server-only-mock";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  buildLeonSceneActivationMap,
  buildSaveVsRuntimeCanonAudit,
  rankFailureCauses,
  runParserProbes,
  summarizePatchJson,
  LEON_SPEECH_RAW,
} from "./lib/registerActivationAuditLib";

const OUT_MD = join(process.cwd(), "output", "step76-register-activation-audit.md");
const OUT_JSON = join(process.cwd(), "output", "step76-register-activation-audit.json");

const ACTIVATION_MAP = `
Register Activation Map (Production)

┌─────────────────────────────────────────────────────────────────────────┐
│ SAVE TIME (characterFormSave → composeExampleDialog)                      │
├─────────────────────────────────────────────────────────────────────────┤
│ speech_traits / speech_personality → formatSpeechSectionAsMetadata()      │
│   └─ register_by_context: in [예시 대화] chunk ONLY                      │
│ speech in systemPrompt (# 말투) → stored RAW (no metadata transform)      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PARSE (characterParser / characterSettingSections)                      │
├─────────────────────────────────────────────────────────────────────────┤
│ # 말투 / [말투] headers → category "speech" (CRITICAL chunk)              │
│ collectCharacterSettingText() → joins all chunks verbatim               │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ RUNTIME CANON (buildStructuredCharacterCanonBlock) — EVERY TURN          │
├─────────────────────────────────────────────────────────────────────────┤
│ Production: formatSection() → plain "공적인 자리: …" prose in CHARACTER CANON │
│ Patch B only: formatSpeechSectionAsMetadata() → register_by_context       │
│ Patch D only: buildCharacterSpeechRecencyTail() at dynamic tail           │
│ ✗ NO scene-context matcher (공적/둘만/침대) → active register selection     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ CONTEXT ASSEMBLY (contextBuilder.buildContext)                          │
├─────────────────────────────────────────────────────────────────────────┤
│ [2] CHARACTER CANON (early, cacheRules) — all 3 context rules static      │
│ [1.4] Prose bundle — SPEECH METADATA invisible rule; NARRATION -다 only   │
│ [7] narrative-style — [genre_tone] atmosphere (Patch A prod, no dialogue) │
│ History + user message — scene cues only (no register injection)          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ GENERATION (model inference)                                              │
├─────────────────────────────────────────────────────────────────────────┤
│ Model must: (1) read scene cues (2) map to card label (3) pick endings    │
│ Post-gen: validateSpeechLock NOT wired in chat/route.ts                   │
└─────────────────────────────────────────────────────────────────────────┘
`;

function mdSection(title: string, body: string): string {
  return `\n## ${title}\n\n${body.trim()}\n`;
}

function main() {
  mkdirSync(join(process.cwd(), "output"), { recursive: true });

  const parserProbes = runParserProbes();
  const parserOkRate = parserProbes.filter((p) => p.parseOk).length / parserProbes.length;

  const saveVsRuntime = buildSaveVsRuntimeCanonAudit();
  const sceneRows = buildLeonSceneActivationMap(["production", "B"]);

  let complianceByContext: ReturnType<typeof summarizePatchJson> = [];
  let patchACompliance: number | undefined;
  let patchBCompliance: number | undefined;

  const patchAPath = join(process.cwd(), "output", "step75-register-patch-A.json");
  const patchBPath = join(process.cwd(), "output", "step75-register-patch-B.json");

  if (existsSync(patchAPath)) {
    const data = JSON.parse(readFileSync(patchAPath, "utf8")) as {
      samples: { id: string; expectedRegister: string; text: string; compliance: number }[];
      avgCompliance: number;
    };
    complianceByContext = summarizePatchJson(data.samples);
    patchACompliance = data.avgCompliance;
  }
  if (existsSync(patchBPath)) {
    const data = JSON.parse(readFileSync(patchBPath, "utf8")) as { avgCompliance: number };
    patchBCompliance = data.avgCompliance;
  }

  const prodRow = sceneRows.find((r) => r.patch === "production");
  const failureCauses = rankFailureCauses({
    parserOkRate,
    productionHasMetadataWire: prodRow?.promptHasRegisterByContext ?? false,
    complianceByContext,
    patchACompliance,
    patchBCompliance,
  });

  const contextRecognition = [
    {
      condition: "공적인 자리",
      inCanonProduction: /공적인 자리[:：]/.test(saveVsRuntime.runtimeCanonFromRawCard),
      registerByContextProduction: /register_by_context:/.test(saveVsRuntime.runtimeCanonFromRawCard),
      runtimeSelector: false,
      activationMechanism: "Model maps scene cues (전장/회의/병영) → canon label",
    },
    {
      condition: "유저와 둘만",
      inCanonProduction: /둘만/.test(saveVsRuntime.runtimeCanonFromRawCard),
      registerByContextProduction: /register_by_context:/.test(saveVsRuntime.runtimeCanonFromRawCard),
      runtimeSelector: false,
      activationMechanism: "Model maps intimacy cues + user note → canon label",
    },
    {
      condition: "침대",
      inCanonProduction: /침대[:：]/.test(saveVsRuntime.runtimeCanonFromRawCard),
      registerByContextProduction: /register_by_context:/.test(saveVsRuntime.runtimeCanonFromRawCard),
      runtimeSelector: false,
      activationMechanism: "Model maps bed/intimacy cues → canon label (same register as 둘만)",
    },
  ];

  const json = {
    generatedAt: new Date().toISOString(),
    parserProbes,
    parserOkRate,
    saveVsRuntime: {
      saveHasRegisterByContext: /register_by_context:/.test(saveVsRuntime.saveTimeExampleDialog),
      runtimeCanonHasRegisterByContext: /register_by_context:/.test(saveVsRuntime.runtimeCanonFromRawCard),
      patchBCanonHasRegisterByContext: /register_by_context:/.test(saveVsRuntime.runtimeCanonIfPatchB),
      patchDRecencyTailLen: saveVsRuntime.recencyTailPatchD.length,
    },
    contextRecognition,
    sceneActivation: sceneRows,
    complianceByContext,
    failureCauses,
  };

  writeFileSync(OUT_JSON, JSON.stringify(json, null, 2), "utf8");

  const lines: string[] = [
    "# Step 7.6 — Character Register Activation Audit",
    "",
    `Generated: ${json.generatedAt}`,
    "",
    "**Scope:** Audit only — no production code changes, no new rules.",
    "",
    mdSection("Register Activation Map", ACTIVATION_MAP),
    mdSection(
      "Context condition runtime recognition",
      [
        "| Condition | In CHARACTER CANON (prod) | register_by_context in prompt | Runtime selector | Activation mechanism |",
        "|---|:---:|:---:|:---:|---|",
        ...contextRecognition.map(
          (r) =>
            `| ${r.condition} | ${r.inCanonProduction ? "✓" : "✗"} | ${r.registerByContextProduction ? "✓" : "✗"} | ✗ | ${r.activationMechanism} |`
        ),
        "",
        "**Measurement:** 0% code-level context recognition — all three rules are always present in canon; none is selected per scene at runtime.",
      ].join("\n")
    ),
    mdSection(
      "Parser — register_by_context auto-extraction",
      [
        `Probe pass rate: **${Math.round(parserOkRate * 100)}%** (${parserProbes.filter((p) => p.parseOk).length}/${parserProbes.length})`,
        "",
        "| Probe | isSpeech | pairs | OK | Notes |",
        "|---|:---:|:---:|:---:|---|",
        ...parserProbes.map(
          (p) =>
            `| ${p.label} | ${p.isSpeechSection ? "✓" : "✗"} | ${p.extractedPairs.length} | ${p.parseOk ? "✓" : "✗"} | ${p.parseNotes.join("; ") || "—"} |`
        ),
        "",
        "**Leon production card:** 3/3 pairs (`공적인 자리`, `유저와 둘만 있을 때`, `침대`) extract correctly.",
        "",
        "**Auto-extraction verdict:** Parser works on standard `context: register` lines. Not wired to generation unless Patch B/D. Save path puts metadata in exampleDialog chunk only, not `# 말투` in systemPrompt.",
      ].join("\n")
    ),
    mdSection(
      "Save vs runtime wiring",
      [
        "| Path | register_by_context present |",
        "|---|:---:|",
        `| composeExampleDialog (save) | ${/register_by_context:/.test(saveVsRuntime.saveTimeExampleDialog) ? "✓" : "✗"} |`,
        `| buildStructuredCharacterCanonBlock (prod) | ${/register_by_context:/.test(saveVsRuntime.runtimeCanonFromRawCard) ? "✓" : "✗"} |`,
        `| buildStructuredCharacterCanonBlock (Patch B) | ${/register_by_context:/.test(saveVsRuntime.runtimeCanonIfPatchB) ? "✓" : "✗"} |`,
        `| buildCharacterSpeechRecencyTail (Patch D) | ${saveVsRuntime.recencyTailPatchD.length > 0 ? "✓" : "✗"} (${saveVsRuntime.recencyTailPatchD.length} chars) |`,
        "",
        "Production canon speech snippet:",
        "```",
        saveVsRuntime.runtimeCanonFromRawCard
          .split("\n")
          .filter((l) => /말투|공적|둘만|침대|예시/.test(l))
          .slice(0, 12)
          .join("\n"),
        "```",
      ].join("\n")
    ),
    mdSection(
      "Same-scene register selection — logical path (Leon samples)",
      sceneRows
        .map(
          (r) =>
            `### ${r.sceneId} (${r.contextTag}) — patch ${r.patch}\n\n` +
            `- Expected register: **${r.expectedRegister}**\n` +
            `- Canon has matching context rule: **${r.canonHasContextRule ? "yes" : "no"}**\n` +
            `- promptHasRegisterByContext: **${r.promptHasRegisterByContext}**\n` +
            `- Scene cues: ${r.sceneCueKeywords.join(", ") || "none"}\n` +
            `- Section indices: canon #${r.characterCanonIndex}, prose #${r.proseBundleIndex}, genre_tone #${r.genreToneIndex ?? "—"}\n` +
            `- speechVsProseGap: ${r.speechVsProseGap} (prose after canon)\n\n` +
            `Logical path:\n${r.logicalPath.map((l) => `- ${l}`).join("\n")}\n`
        )
        .join("\n")
    ),
    mdSection(
      "When character speech loses to prose rules",
      [
        "1. **Not narration register conflict** — `[NARRATION REGISTER]` applies to -다 narration only; prose bundle explicitly defers dialogue to SPEECH METADATA / examples.",
        "2. **Recency / stack position** — CHARACTER CANON is early ([2]); prose bundle + genre_tone come later. Pre-Patch A, `[genre_tone]` dialogue register mandates could override canon private 해요 (priority issue, fixed in prod Patch A).",
        "3. **SPEECH CONSISTENCY** — Example dialog (`괜찮아요` + `각오하십시오`) lives in canon; model may anchor to whichever example fits scene tone, not `# 말투` labels.",
        "4. **No active-register injection** — Prose rules never say 'use 해요 this turn'; they only ban meta-narration. Failure mode is model defaulting to webnovel 합니다/해요 mix, not prose explicitly commanding wrong register.",
      ].join("\n")
    ),
    complianceByContext.length
      ? mdSection(
          "Validation compliance by context (Patch A samples, if cached)",
          [
            "| contextTag | n | avg compliance | fail (<70%) |",
            "|---|---:|---:|---|",
            ...complianceByContext.map(
              (c) => `| ${c.contextTag} | ${c.count} | ${c.avgCompliance}% | ${c.failIds.join(", ") || "—"} |`
            ),
            "",
            patchACompliance !== undefined ? `Overall Patch A avg: **${patchACompliance}%**` : "",
          ].join("\n")
        )
      : mdSection(
          "Validation compliance by context",
          "_No cached `output/step75-register-patch-A.json` — run step75 validation to populate._"
        ),
    mdSection(
      "Activation failure causes — ranked",
      [
        "| Rank | Category | Weight | Rewrite-only fix? | Evidence |",
        "|---:|---|---:|:---:|---|",
        ...failureCauses.map(
          (c) => `| ${c.rank} | ${c.category} | ${c.weight} | ${c.rewriteOnlyFix} | ${c.evidence} |`
        ),
      ].join("\n")
    ),
    mdSection(
      "Taxonomy verdict",
      [
        "| Layer | Issue? | Detail |",
        "|---|:---:|---|",
        "| **Parser** | Minor | Leon `context: register` lines parse; bullet/English/no-colon formats fail or degrade |",
        "| **Priority** | Reduced (post Patch A) | genre_tone no longer mandates dialogue register in production |",
        "| **Runtime wiring** | **Primary** | No per-scene register activation; metadata path dead at canon build; validator not wired |",
        "| **Model inference** | **Primary** | Static rules + scene cues → model must infer; ~48% compliance on Patch A |",
        "| **Card content** | Secondary | Mixed examples + implicit mapping; user note reinforces mood not endings |",
      ].join("\n")
    ),
    mdSection(
      "Rewrite-only feasibility",
      [
        "| Fix | Rewrite-only? | Notes |",
        "|---|:---:|---|",
        "| Align example dialog per context (public vs private lines) | **yes** | SPEECH CONSISTENCY — examples win; highest leverage without code |",
        "| Sharpen `# 말투` prose labels | partial | Already present; model still ignores ~50% without selector |",
        "| Move speech to save-form traits field only | partial | Metadata in exampleDialog chunk still not in main canon unless B |",
        "| register_by_context in prompt | **no** | Requires runtime wiring (Patch B); B validated worse than A |",
        "| Per-scene active register line | **no** | Requires contextBuilder injection (out of scope — new rule) |",
        "| Post-gen speechLock | **no** | Validator exists but not wired |",
      ].join("\n")
    ),
    mdSection(
      "Conclusion",
      [
        "Register rules **exist** in CHARACTER CANON every turn but **do not activate** conditionally at runtime.",
        "Activation is 100% model-side: scene history/user message → map to card label → apply endings.",
        "Primary gaps are **runtime wiring** (no selector, metadata dead path) and **model inference**, not parser failure on Leon-format cards.",
        "Rewrite-only can improve via **context-split example dialog**; cannot reliably fix without wiring or post-gen validation.",
      ].join("\n")
    ),
    "",
    `Full JSON: \`${OUT_JSON}\``,
  ];

  writeFileSync(OUT_MD, lines.join("\n"), "utf8");
  console.log(`Wrote ${OUT_MD}`);
  console.log(`Wrote ${OUT_JSON}`);
}

main();
