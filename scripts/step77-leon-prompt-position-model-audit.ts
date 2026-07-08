/**
 * Step 7.7 — Leon speech block position + scene trigger audit + Qwen/Gemini register test
 *
 * Usage: npm.cmd exec tsx -- scripts/step77-leon-prompt-position-model-audit.ts
 *        npm.cmd exec tsx -- scripts/step77-leon-prompt-position-model-audit.ts --generate
 */
import "./lib/server-only-mock";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import { estimateTokens } from "@/lib/tokenEstimate";
import { evaluateRegisterCompliance } from "@/lib/characterRegisterCompliance";
import {
  OPENROUTER_QWEN_37_MAX_MODEL,
  OPENROUTER_GEMINI_25_PRO_MODEL,
} from "@/lib/chatModels";
import { buildRegisterValidationContext } from "./lib/leon-ren-register-fixtures";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT_DIR = join(process.cwd(), "output");
const OUT_MD = join(OUT_DIR, "step77-leon-prompt-position-model-audit.md");
const OUT_JSON = join(OUT_DIR, "step77-leon-prompt-position-model-audit.json");
const CACHE_JSON = join(OUT_DIR, "step77-model-register-samples.json");

const SCENE_ID = "leon-private-0";
const RUNS_PER_MODEL = 3;

type BlockHit = {
  label: string;
  charStart: number;
  charEnd: number;
  tokensFromPromptStart: number;
  snippet: string;
};

function findBlock(system: string, patterns: RegExp[], label: string): BlockHit | null {
  for (const re of patterns) {
    const m = system.match(re);
    if (m?.index != null) {
      const start = m.index;
      const end = start + m[0].length;
      return {
        label,
        charStart: start,
        charEnd: end,
        tokensFromPromptStart: estimateTokens(system.slice(0, start)),
        snippet: m[0].slice(0, 120).replace(/\n/g, " ↵ "),
      };
    }
  }
  return null;
}

function findSpeechBlock(system: string): BlockHit | null {
  const patterns = [
    /\[말투\][\s\S]{0,400}?(?=침대:|유저와 둘만|\[예시|\[CHARACTER|\[WORLD|$)/,
    /# 말투[\s\S]{0,400}?(?=침대:|유저와 둘만|\[예시|$)/,
    /레온의 말투[\s\S]{0,400}?(?=침대:|유저와 둘만|\[예시|$)/i,
    /공적인 자리[:：][^\n]+[\s\S]{0,200}?침대[:：][^\n]+/,
  ];
  return findBlock(system, patterns, "speech_register_block");
}

function analyzePromptLayout(system: string, sections: { id: string; text: string }[]) {
  const totalTokens = estimateTokens(system);
  const speech = findSpeechBlock(system);
  const prose = findBlock(system, [/\[PROSE STYLE\]/], "PROSE_STYLE_marker");
  const speechMeta = findBlock(system, [/\[SPEECH METADATA[^\]]*\]/], "SPEECH_METADATA");
  const canon = findBlock(system, [/\[CHARACTER CANON[^\]]*\]/], "CHARACTER_CANON_header");

  const proseSection = sections.find((s) => s.id === "prose-style-xml-bundle");
  const canonSection = sections.find((s) => s.id === "character-core-identity");

  let gapChars: number | null = null;
  let gapTokens: number | null = null;
  if (speech && prose) {
    gapChars = prose.charStart - speech.charEnd;
    gapTokens = estimateTokens(system.slice(speech.charEnd, prose.charStart));
  }

  return {
    totalTokens,
    totalChars: system.length,
    speech,
    prose,
    speechMeta,
    canon,
    canonSectionIndex: sections.findIndex((s) => s.id === "character-core-identity") + 1,
    proseSectionIndex: sections.findIndex((s) => s.id === "prose-style-xml-bundle") + 1,
    gapSpeechToProse: { chars: gapChars, tokens: gapTokens },
    canonSectionTokens: canonSection ? estimateTokens(canonSection.text) : null,
    proseSectionTokens: proseSection ? estimateTokens(proseSection.text) : null,
    sectionOrder: sections.map((s, i) => ({ index: i + 1, id: s.id, tokens: estimateTokens(s.text) })),
  };
}

const SCENE_TRIGGER_AUDIT = {
  verdict: "NO_RUNTIME_SCENE_TRIGGER",
  privateBedActivation: "always_static — all context rules injected every turn; no per-scene selector",
  findings: [
    {
      location: "src/services/contextBuilder.ts + src/app/api/chat/route.ts",
      mechanism: "No keyword/LLM scene classifier for 공적/사적/침대 in chat generation path",
      trigger: "never — CHARACTER CANON includes all three rules statically",
    },
    {
      location: "src/lib/speechMetadataPolicy.ts :: isSpeechMetadataSection",
      mechanism: "Regex keyword match on speech *section body* at parse/save (공적|사적|침대)",
      trigger: "save/canon classify only — NOT scene runtime",
    },
    {
      location: "src/lib/narrativeStyle.ts :: buildSceneModeHint",
      mechanism: "Genre → calm/tension/combat (NOT speech register)",
      trigger: "every turn from genre — unrelated to private/bed",
    },
    {
      location: "src/lib/emotionTag.ts / vision.ts",
      mechanism: "침대 keyword in image tag examples",
      trigger: "portrait tag selection only — not dialogue register",
    },
    {
      location: "scripts/lib/exampleDialogContextAuditLib.ts (audit harness only)",
      mechanism: "Heuristic PUBLIC/PRIVATE/BED cue regex on fixture user messages",
      trigger: "audit scripts only — not production",
    },
    {
      location: "src/lib/characterRegisterCompliance.ts",
      mechanism: "Post-hoc dialogue ending classifier for validation reports",
      trigger: "measurement only — not injected into prompt",
    },
    {
      location: "src/lib/speechLock/*",
      mechanism: "Post-gen validator (deriveProfile, patterns)",
      trigger: "NOT wired in api/chat/route.ts",
    },
  ],
};

async function generateSample(model: string, run: number): Promise<{ text: string; compliance: number }> {
  const { buildContext } = await import("@/services/contextBuilder");
  const { callOpenRouterCompletion } = await import("@/lib/openRouterCompletion");
  const { resolveDeepSeekTemperatureForTarget } = await import("@/lib/openRouterClient");

  const scene = (await import("./lib/leon-ren-register-fixtures")).REGISTER_VALIDATION_SCENES.find(
    (s) => s.id === SCENE_ID
  );
  if (!scene) throw new Error("scene missing");

  const built = buildContext(buildRegisterValidationContext(scene));
  const res = await callOpenRouterCompletion({
    system: built.systemPrompt,
    history: built.history,
    model,
    temperature: resolveDeepSeekTemperatureForTarget(3200),
    maxTokens: 4096,
    timeoutMs: 240_000,
    requestKind: "step77-register-model-audit",
  });
  const text = res.text.trim();
  const comp = evaluateRegisterCompliance(text, "haeyo");
  return { text, compliance: comp.complianceRate };
}

async function runModelTrials(model: string, label: string, doGenerate: boolean) {
  const cached: { model: string; label: string; runs: { run: number; compliance: number; text: string }[] } = {
    model,
    label,
    runs: [],
  };

  if (existsSync(CACHE_JSON)) {
    try {
      const all = JSON.parse(readFileSync(CACHE_JSON, "utf8")) as typeof cached[];
      const hit = all.find((x) => x.model === model);
      if (hit?.runs.length >= RUNS_PER_MODEL) return hit;
      if (hit) cached.runs = hit.runs;
    } catch {
      /* fresh */
    }
  }

  if (doGenerate) {
    for (let run = cached.runs.length + 1; run <= RUNS_PER_MODEL; run++) {
      console.log(`[${label}] run ${run}/${RUNS_PER_MODEL}…`);
      try {
        const { text, compliance } = await generateSample(model, run);
        cached.runs.push({ run, compliance, text });
        const all = existsSync(CACHE_JSON)
          ? (JSON.parse(readFileSync(CACHE_JSON, "utf8")) as typeof cached[]).filter((x) => x.model !== model)
          : [];
        all.push(cached);
        writeFileSync(CACHE_JSON, JSON.stringify(all, null, 2));
        await new Promise((r) => setTimeout(r, 2500));
      } catch (err) {
        console.warn(`[${label}] run ${run} failed:`, err);
      }
    }
  }

  const avg =
    cached.runs.length > 0
      ? Math.round((cached.runs.reduce((a, r) => a + r.compliance, 0) / cached.runs.length) * 10) / 10
      : null;

  return { ...cached, avgCompliance: avg };
}

async function main() {
  const doGenerate = process.argv.includes("--generate");
  mkdirSync(OUT_DIR, { recursive: true });
  delete process.env.REGISTER_PATCH;

  const { buildContext } = await import("@/services/contextBuilder");
  const scene = (await import("./lib/leon-ren-register-fixtures")).REGISTER_VALIDATION_SCENES.find(
    (s) => s.id === SCENE_ID
  )!;
  const built = buildContext(buildRegisterValidationContext(scene));
  const sections = (built.meta?.trackedSections ?? []).map((s) => ({ id: s.id, text: s.text }));
  const layout = analyzePromptLayout(built.systemPrompt, sections);

  const modelResults = await Promise.all([
    runModelTrials(OPENROUTER_QWEN_37_MAX_MODEL, "Qwen3.7-Max", doGenerate),
    runModelTrials(OPENROUTER_GEMINI_25_PRO_MODEL, "Gemini-2.5-Pro", doGenerate),
  ]);

  const json = {
    generatedAt: new Date().toISOString(),
    sceneId: SCENE_ID,
    sceneContext: scene.contextTag,
    expectedRegister: "haeyo",
    promptLayout: layout,
    sceneTriggerAudit: SCENE_TRIGGER_AUDIT,
    modelResults,
  };

  writeFileSync(OUT_JSON, JSON.stringify(json, null, 2), "utf8");

  const lines = [
    "# Step 7.7 — Leon speech block position + scene trigger + model register test",
    "",
    `Scene: **${SCENE_ID}** (${scene.contextTag}, expected **haeyo**)`,
    "",
    "## 1. [말투] block position vs [PROSE STYLE]",
    "",
    "| Metric | Value |",
    "|---|---|",
    `| System prompt total | ${layout.totalTokens} tokens (${layout.totalChars} chars) |`,
    layout.speech
      ? `| Speech block char offset | ${layout.speech.charStart}–${layout.speech.charEnd} |`
      : `| Speech block | not found as single contiguous match |`,
    layout.speech ? `| Speech block tokens from prompt start | **${layout.speech.tokensFromPromptStart}** |` : "",
    layout.prose
      ? `| [PROSE STYLE] char offset | ${layout.prose.charStart} |`
      : `| [PROSE STYLE] | not found |`,
    layout.prose ? `| [PROSE STYLE] tokens from prompt start | **${layout.prose.tokensFromPromptStart}** |` : "",
    layout.gapSpeechToProse.tokens != null
      ? `| Gap speech end → PROSE STYLE (tokens) | **${layout.gapSpeechToProse.tokens}** (${layout.gapSpeechToProse.chars} chars) |`
      : "",
    layout.gapSpeechToProse.tokens != null && layout.speech && layout.prose
      ? `| Relative: PROSE STYLE is **${layout.prose.tokensFromPromptStart - layout.speech.tokensFromPromptStart}** tokens after speech block start |`
      : "",
    `| Section index: character-core-identity | #${layout.canonSectionIndex} |`,
    `| Section index: prose-style-xml-bundle | #${layout.proseSectionIndex} |`,
    "",
    layout.speech ? `Speech snippet: \`${layout.speech.snippet}\`` : "",
    "",
    "### Section order (tracked)",
    "",
    "| # | section id | tokens |",
    "|---:|---|---:|",
    ...layout.sectionOrder.map((s) => `| ${s.index} | ${s.id} | ${s.tokens} |`),
    "",
    "## 2. Private / bed scene trigger",
    "",
    "**Verdict: no runtime trigger — rules are always active in CHARACTER CANON.**",
    "",
    "| Location | Mechanism | Triggers at generation? |",
    "|---|---|---|",
    ...SCENE_TRIGGER_AUDIT.findings.map(
      (f) => `| ${f.location} | ${f.mechanism} | ${f.trigger} |`
    ),
    "",
    "## 3. Qwen / Gemini haeyo compliance (3 runs each, same prompt)",
    "",
    modelResults.every((m) => m.runs.length === 0)
      ? "_No samples yet. Run:_ `npm.cmd exec tsx -- scripts/step77-leon-prompt-position-model-audit.ts --generate`"
      : [
          "| Model | runs | avg haeyo compliance | per-run |",
          "|---|---:|---:|---|",
          ...modelResults.map(
            (m) =>
              `| ${m.label} | ${m.runs.length} | ${m.avgCompliance ?? "—"}% | ${m.runs.map((r) => `${r.compliance}%`).join(", ") || "—"} |`
          ),
        ].join("\n"),
    "",
    `JSON: \`${OUT_JSON}\``,
  ];

  writeFileSync(OUT_MD, lines.filter(Boolean).join("\n"), "utf8");
  console.log(`Wrote ${OUT_MD}`);
  console.log(`Wrote ${OUT_JSON}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
